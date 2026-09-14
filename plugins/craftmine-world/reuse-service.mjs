// Reuse service: thin, strictly validated wrappers over the host RPC channels
// for packages, full backups and legacy conversion. Pure helpers at the bottom
// (explain / compatibilityMatrix / migrationReport) never touch the host.
export {createManagedPackageSourceService} from './godot-package-source.mjs';
import {validatePositionBounds,resolveSourceConfiguration} from './source-configuration.cjs';
const requireValue=(condition,code)=>{if(!condition)throw Error(code);};
const exactKeys=(value,allowed)=>{requireValue(value&&typeof value==='object'&&!Array.isArray(value),'OBJECT_REQUIRED');requireValue(Object.keys(value).every(key=>allowed.includes(key)),'UNKNOWN_FIELD');};
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const isHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identifier=(value,max=240)=>requireValue(text(value,max),'INVALID_INSTANCE_ID');
const operationId=value=>requireValue(text(value,240),'INVALID_OPERATION_ID');
const revision=value=>requireValue(integer(value,0,Number.MAX_SAFE_INTEGER),'INVALID_REVISION');
const state=value=>requireValue(isObject(value),'INVALID_STATE');
const archive=value=>requireValue(isObject(value),'OBJECT_REQUIRED');
const checkRef=ref=>{exactKeys(ref,['id','version','hash']);requireValue(text(ref.id,80)&&integer(ref.version,1,100000)&&isHash(ref.hash),'INVALID_REFERENCE');};
const placement=position=>{exactKeys(position,['x','y','z']);requireValue(['x','y','z'].every(key=>Number.isFinite(position[key])&&Math.abs(position[key])<=80),'INVALID_PLACEMENT');};

export function createReuseService({call,installSource,sourceList,exportSource}) {
  requireValue(typeof call==='function','DOMAIN_CALL_REQUIRED');
  return {
    async installSource(args){requireValue(typeof installSource==='function','PACKAGE_INSTALL_HOST_UNAVAILABLE');return installSource(args);},
    async sourceList(args){requireValue(typeof sourceList==='function','PACKAGE_SOURCE_HOST_UNAVAILABLE');return sourceList(args);},
    async exportSource(args){requireValue(typeof exportSource==='function','PACKAGE_SOURCE_HOST_UNAVAILABLE');return exportSource(args);},
    async check(args){
      exactKeys(args,['ref','target']);checkRef(args.ref);exactKeys(args.target,['base','baseVersion','engine','stateFormat']);
      // target describes the reference environment, so invalid text is INVALID_REFERENCE.
      requireValue(['base','baseVersion','engine','stateFormat'].every(key=>text(args.target[key],80)),'INVALID_REFERENCE');
      return call('package.check',args);
    },
    async install(args){
      exactKeys(args,['operationId','ref','worldId','mode','sourceInstanceId','position']);
      operationId(args.operationId);checkRef(args.ref);identifier(args.worldId);
      requireValue(args.mode==='initial'||args.mode==='copy','INVALID_MODE');
      if(args.mode==='copy')requireValue(text(args.sourceInstanceId,240),'SOURCE_INSTANCE_REQUIRED');
      else requireValue(args.sourceInstanceId===undefined,'UNKNOWN_FIELD');
      if(args.position!==undefined)placement(args.position);
      return call('package.install',args);
    },
    async list(args){
      exactKeys(args,['worldId','status','offset','limit']);
      requireValue(integer(args.offset,0,4096)&&integer(args.limit,1,50),'INVALID_PAGE');
      return call('package.list',args);
    },
    async read(args){exactKeys(args,['instanceId']);identifier(args.instanceId);return call('package.read',args);},
    async progress(args){exactKeys(args,['operationId','instanceId','revision','state']);operationId(args.operationId);identifier(args.instanceId);revision(args.revision);state(args.state);return call('package.progress',args);},
    async grant(args){exactKeys(args,['operationId','instanceId','key','reward']);operationId(args.operationId);identifier(args.instanceId);identifier(args.key);requireValue(isObject(args.reward),'OBJECT_REQUIRED');return call('package.grant',args);},
    async upgrade(args){exactKeys(args,['operationId','instanceId','toRef']);operationId(args.operationId);identifier(args.instanceId);checkRef(args.toRef);return call('package.upgrade',args);},
    async uninstall(args){exactKeys(args,['operationId','instanceId','expectedRevision']);operationId(args.operationId);identifier(args.instanceId);revision(args.expectedRevision);return call('package.uninstall',args);},
    async restore(args){exactKeys(args,['operationId','instanceId']);operationId(args.operationId);identifier(args.instanceId);return call('package.restore',args);},
    async exportPackage(args){exactKeys(args,['operationId','instanceId']);operationId(args.operationId);identifier(args.instanceId);return call('package.export',args);},
    async importPackage(args){
      exactKeys(args,['operationId','package']);operationId(args.operationId);
      requireValue(isObject(args.package)&&args.package.format==='craftmine.work-package/1','INVALID_PACKAGE');
      return call('package.import',args);
    },
    async usage(args){exactKeys(args,['ref']);checkRef(args.ref);return call('package.usage',args);},
    async backupFull(args){exactKeys(args,['operationId']);operationId(args.operationId);return call('backup.export-full',args);},
    async backupVerify(args){exactKeys(args,['archive']);archive(args.archive);return call('backup.verify',args);},
    async backupRestoreFull(args){
      exactKeys(args,['operationId','archive','expectedCurrentHash']);operationId(args.operationId);archive(args.archive);
      requireValue(isHash(args.expectedCurrentHash),'INVALID_HASH');
      return call('backup.restore-full',args);
    },
    async legacyConvert(args){
      exactKeys(args,['operationId','importId','title','compiled']);operationId(args.operationId);identifier(args.importId);
      requireValue(text(args.title,80),'INVALID_TITLE');
      if(args.compiled!==undefined)requireValue(isObject(args.compiled),'OBJECT_REQUIRED');
      return call('legacy.convert',args);
    },
    explain:code=>explain(code),
  };
}

const ERRORS={
  PACKAGE_VERSION_NOT_FOUND:['找不到作品版本','作品库里没有这个精确版本，可能已被删除或从未发布。','确认版本号，或重新发布该版本后重试。'],
  PACKAGE_DEPENDENCY_MISSING:['缺少依赖作品','该作品依赖的其他作品没有安装，或不在作品库里。','先安装提示中列出的依赖作品，再重新安装。'],
  PACKAGE_DEPENDENCY_CYCLE:['依赖关系成环','作品之间互相依赖，无法确定安装顺序。','请作品作者去掉循环依赖后重新发布。'],
  PACKAGE_DEPENDENCY_HASH_MISMATCH:['依赖内容不一致','依赖作品的实际内容与清单里登记的哈希不符。','重新获取该依赖的对应版本，或让作者重新发布。'],
  PACKAGE_VERSION_CONFLICT:['同版本内容冲突','同一个编号、同一个版本出现了两份不同的内容。','保留其中一份，删除或改名另一份后重试。'],
  PACKAGE_INCOMPATIBLE_BASE:['底座不匹配','作品要求的底座与目标世界的底座不是同一个。','换用匹配底座的世界，或选择为该底座发布的作品。'],
  PACKAGE_INCOMPATIBLE_BASE_VERSION:['底座版本过低','目标世界的底座版本低于作品要求的最低版本。','升级世界的底座版本，或安装要求更低的作品。'],
  PACKAGE_INCOMPATIBLE_ENGINE:['引擎版本不匹配','作品要求的引擎版本与目标世界使用的引擎版本不同。','把世界升级到相同引擎版本，或安装对应引擎的作品。'],
  PACKAGE_INCOMPATIBLE_STATE_FORMAT:['状态格式不匹配','作品记录进度的格式与目标世界使用的格式不同。','升级世界或作品到同一状态格式后重试。'],
  PACKAGE_INCOMPATIBLE_SCENE_FORMAT:['场景格式不匹配','作品的场景格式与目标世界的场景格式不同。','升级到同一场景格式后再安装。'],
  PACKAGE_MIGRATION_MISSING:['缺少升级迁移','没有从当前状态版本到目标版本的迁移方案。','让作品作者补充迁移声明，或先升级到中间版本。'],
  PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS:['升级会丢失进度','迁移会丢弃仍有数据的字段或实体，且没有对应的保留声明。','确认哪些内容需要保留，补上迁移声明后再升级。'],
  PACKAGE_MIGRATION_TARGET_EXISTS:['迁移目标已存在','迁移要创建的对象、行为或字段在实例里已经存在。','先处理同名内容，或让作者调整迁移目标名称。'],
  PACKAGE_DOWNGRADE_UNSUPPORTED:['不支持降级','作品不支持从更高的状态版本回退到更低版本。','保持当前版本，或安装更高版本的作品。'],
  PACKAGE_UPGRADE_KIND_MISMATCH:['升级类型不一致','目标版本的作品类型与已安装实例的类型不同。','先卸载旧实例，再安装新类型的作品。'],
  PACKAGE_VERSION_UNAVAILABLE:['版本已不可用','该版本已经无法获取，不能恢复或重装。','换用仍然可用的版本，或重新发布原版本。'],
  PACKAGE_INSTANCE_REVISION_CONFLICT:['实例修订冲突','实例的修订号与本次操作期望的不一致，可能已被其他操作修改。','重新读取实例当前状态，再重试本次操作。'],
  PACKAGE_INSTANCE_UNINSTALLED:['实例已卸载','该实例当前处于已卸载状态，不能直接写入进度。','先用恢复操作把实例恢复为已安装状态。'],
  PACKAGE_SOURCE_INCOMPATIBLE:['复制来源不兼容','要复制的来源实例与目标世界的底座或格式不兼容。','改用初始状态安装，或选择兼容的来源实例。'],
  PACKAGE_EXPORT_CONTAINS_PRIVATE_DATA:['导出包含私密数据','作品包中检测到用户凭据或会话等私密内容。','移除私密内容后重新导出，不要把凭据打包分享。'],
  WORK_PACKAGE_CONTENT_HASH_MISMATCH:['作品包内容校验失败','作品包的实际内容与声明的哈希不一致，可能在传输中被改动。','重新获取原始作品包后再导入。'],
  IMMUTABLE_VERSION_CONFLICT:['不可变版本冲突','同一个不可变版本已存在且内容不同，不能覆盖。','发布为新版本，不要修改已经发布的版本。'],
  REPLAY_MISMATCH:['重放参数不一致','同一个操作编号被用于不同的参数，结果无法确定。','为新的参数使用新的操作编号。'],
  BACKUP_HASH_MISMATCH:['备份哈希不符','备份中的文件内容与清单登记的哈希不一致。','使用完整且未损坏的备份重新校验。'],
  BACKUP_VERSION_UNSUPPORTED:['备份版本不支持','备份使用的格式版本高于当前程序支持的版本。','升级程序后再恢复该备份。'],
  BACKUP_CONTENT_INCOMPLETE:['备份内容不完整','备份缺少清单中声明的文件，无法完整恢复。','找回缺失文件，或使用更完整的备份。'],
  BACKUP_TOO_LARGE:['备份体积过大','备份内容超过了允许的大小上限。','精简备份内容后重新导出。'],
  CORRUPT_LEGACY_ARCHIVE:['旧世界归档损坏','旧世界归档无法解析，或哈希、路径校验失败。','换用未损坏的原始归档重新转换。'],
  LEGACY_COPY_EXISTS:['旧世界副本已存在','目标编号上已经有转换出来的副本。','改名或删除已有副本后再转换。'],
  LEGACY_PROJECT_FORMAT:['旧世界工程格式无效','旧工程文件不是受支持的格式或版本。','确认这是受支持的旧世界工程后再试。'],
  LEGACY_SNAPSHOT_REQUIRED:['缺少进度快照','旧世界工程里没有可用的进度快照，无法保留玩家进度。','提供包含快照的旧工程，或接受从头开始。'],
  WORLD_NOT_FOUND:['找不到世界','目标世界不存在或已被删除。','确认世界编号，或先创建世界。'],
  PACKAGE_INSTANCE_NOT_FOUND:['找不到作品实例','该作品实例不存在，可能已被删除。','重新安装作品，或确认实例编号。'],
};

// Pure offline mapping from an error string/code to user-facing Chinese text.
export function explain(code){
  const key=String(code??'').split(':')[0].trim(),entry=ERRORS[key];
  return entry?{code:key,title:entry[0],detail:entry[1],action:entry[2],unknown:false}
    :{code:key,title:key,detail:'未收录的错误码',action:'请把原始错误码反馈给开发',unknown:true};
}

const DIMENSIONS=['base','baseVersion','engine','stateFormat','sceneFormat'];
const DIMENSION_CODES={PACKAGE_INCOMPATIBLE_BASE:'base',PACKAGE_INCOMPATIBLE_BASE_VERSION:'baseVersion',PACKAGE_INCOMPATIBLE_ENGINE:'engine',PACKAGE_INCOMPATIBLE_STATE_FORMAT:'stateFormat',PACKAGE_INCOMPATIBLE_SCENE_FORMAT:'sceneFormat'};

// Pure projection of a package.check report into per-dimension rows.
export function compatibilityMatrix(report){
  const reasons=Array.isArray(report?.reasons)?report.reasons:[],failed=new Map();
  for(const reason of reasons){
    const raw=typeof reason==='string'?reason:typeof reason?.code==='string'?reason.code+(reason.detail?': '+reason.detail:''):'';
    const dimension=DIMENSION_CODES[raw.split(':')[0].trim()];
    if(dimension&&!failed.has(dimension))failed.set(dimension,raw.slice(raw.indexOf(':')+1).trim()||'不兼容');
  }
  const closure=Array.isArray(report?.closure)?report.closure:[];
  const rows=[...DIMENSIONS.map(name=>({name,value:failed.get(name)??'符合要求',passed:!failed.has(name)})),
    {name:'dependencies',value:String(closure.length),passed:true}];
  const incompatible=rows.filter(row=>!row.passed).map(row=>row.name);
  const compatible=report?.compatible===true&&incompatible.length===0;
  const summary=compatible?'与目标世界兼容，可以安装':`与目标世界不兼容：${incompatible.length?incompatible.join('、'):'存在未列出的兼容性问题'}`;
  return {compatible,rows,summary};
}

// Pure projection of a package.upgrade receipt into display rows and warnings.
export function migrationReport(receipt){
  const from=receipt?.fromRef??{},to=receipt?.toRef??{};
  const migration=Array.isArray(receipt?.migration)?receipt.migration:[],preserved=Array.isArray(receipt?.preservedOnce)?receipt.preservedOnce:[];
  const counts=new Map();
  for(const item of migration){const op=typeof item?.op==='string'?item.op:'unknown';counts.set(op,(counts.get(op)??0)+1);}
  const rows=[{name:'fromRef',value:`${from.id??'?'}@${from.version??'?'}`},{name:'toRef',value:`${to.id??'?'}@${to.version??'?'}`},
    {name:'fromStateVersion',value:String(receipt?.fromStateVersion??'?')},{name:'toStateVersion',value:String(receipt?.toStateVersion??'?')},
    ...[...counts.keys()].sort().map(op=>({name:'op:'+op,value:String(counts.get(op))})),
    {name:'preservedOnce',value:String(preserved.length)}];
  const warnings=preserved.length?[]:['升级后没有保留任何一次性奖励记录，请确认这是预期结果。'];
  return {rows,warnings};
}

/** Trusted product installer. A page supplies a package, never a context or OS root. */
export function createManagedPackageInstaller({call,bind,enqueue,stagingRoot,turns}) {
  requireValue(typeof call==='function'&&typeof bind==='function'&&typeof enqueue==='function','PACKAGE_INSTALL_HOST_REQUIRED');
  const active=new Map();
  const executeInstall=async function(args,group=false){
    exactKeys(args,group?['operationId','worldId','items','scene','expectedSource']:['operationId','worldId','archiveBase64','scene','expectedSource','position','positionBounds']);operationId(args.operationId);identifier(args.worldId);
    if(args.position!==undefined)placement(args.position);
    if(group)requireValue(isObject(args.expectedSource),'PACKAGE_SOURCE_IDENTITY_REQUIRED');
    if(args.expectedSource!==undefined){exactKeys(args.expectedSource,['revision','manifestHash']);revision(args.expectedSource.revision);requireValue(isHash(args.expectedSource.manifestHash),'PACKAGE_SOURCE_IDENTITY_REQUIRED');}
    const items=group?args.items:[{archiveBase64:args.archiveBase64,...(args.position?{position:args.position}:{}),...(args.positionBounds!==undefined?{positionBounds:args.positionBounds}:{})}];
    if(group)requireValue(Array.isArray(items)&&items.length>=2&&items.length<=8,'PACKAGE_GROUP_ITEM_LIMIT');
    for(const item of items){exactKeys(item,['archiveBase64','position','positionBounds']);if(item.position!==undefined)placement(item.position);if(item.positionBounds!==undefined)validatePositionBounds(item.positionBounds);requireValue(typeof item.archiveBase64==='string'&&item.archiveBase64.length<=7*1024*1024&&/^[A-Za-z0-9+/]*={0,2}$/.test(item.archiveBase64),'PACKAGE_ARCHIVE_TOO_LARGE');}
    if(group)requireValue(items.reduce((total,item)=>total+Buffer.byteLength(item.archiveBase64,'base64'),0)<=6*1024*1024,'PACKAGE_GROUP_ARCHIVE_TOO_LARGE');
    if(args.scene!==undefined)requireValue(text(args.scene,240),'INVALID_SCENE_PATH');
    const fs=await import('node:fs/promises'),path=await import('node:path'),{createHash}=await import('node:crypto');
    requireValue(path.isAbsolute(stagingRoot),'PACKAGE_STAGING_ROOT_REQUIRED');
    const hash=value=>createHash('sha256').update(value).digest('hex');
    const requestHash=hash(JSON.stringify(args)),key=hash(JSON.stringify([args.worldId,args.operationId]));
    const previous=active.get(key);if(previous){requireValue(previous.requestHash===requestHash,'OPERATION_CONFLICT');return previous.promise;}
    const entry={requestHash};active.set(key,entry);
    let ownedContext=null,handedOff=false,completed=false;
    entry.promise=(async()=>{
      const {unpackStaticPackage,DEFAULT_LIMITS}=await import('./package-zip.mjs');
      const {planDraftInstall}=await import('../../desktop/godot/shared/draft_install.mjs');
      const {planSceneInsertion,applySceneInsertion,parseScene}=await import('../../desktop/godot/shared/scene_materializer.mjs');
      const directory=path.join(stagingRoot,key),intentFile=path.join(directory,'intent.json');
      await fs.mkdir(directory,{recursive:true});
      const save=async value=>{const file=intentFile+'.new';const fd=await fs.open(file,'w');try{await fd.writeFile(JSON.stringify(value));await fd.sync();}finally{await fd.close();}await fs.rename(file,intentFile);};
      let intent;try{intent=JSON.parse(await fs.readFile(intentFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(intent)requireValue(intent.requestHash===requestHash,'OPERATION_CONFLICT');
      if(intent?.ownsTurn)ownedContext=intent.context;
      if(!intent){
        const bound=await bind(args.worldId,args.operationId);
        if(bound?.ownsTurn){requireValue(turns,'PACKAGE_TURN_LIFECYCLE_REQUIRED');ownedContext=bound.context;}
        requireValue(bound?.worldRecord?.id===args.worldId&&bound.operation?.worldId===args.worldId&&bound.operation?.operationId===args.operationId&&isObject(bound.context),'PACKAGE_BINDING_MISMATCH');
        const context=bound.context,world=bound.worldRecord.world;
        const archives=[];let groupBytes=0;
        for(const item of items){
          const archive=unpackStaticPackage(Buffer.from(item.archiveBase64,'base64'),{...DEFAULT_LIMITS,maxEntryBytes:4*1024*1024,maxTotalBytes:6*1024*1024,maxCompressedBytes:6*1024*1024,maxEntries:1024});
          if(item.position!==undefined)requireValue(archive.resources.filter(r=>r.manifest.content.entry?.sceneInstall).length===1,'PACKAGE_POSITION_REQUIRES_SINGLE_INSTANCE');
          groupBytes+=archive.packageJson.files.reduce((sum,file)=>sum+file.bytes,0);if(group)requireValue(groupBytes<=6*1024*1024,'PACKAGE_GROUP_PAYLOAD_TOO_LARGE');archives.push(archive);
        }
        const projectDir=await fs.mkdtemp(path.join(directory,'source-'));
        const safe=relative=>{requireValue(typeof relative==='string'&&!relative.includes('\\')&&!relative.includes(':')&&!relative.split('/').some(s=>!s||s==='.'||s==='..'),'PACKAGE_SOURCE_PATH_REFUSED');const full=path.resolve(projectDir,relative);requireValue(full.startsWith(projectDir+path.sep),'PACKAGE_SOURCE_PATH_REFUSED');return full;};
        let offset=0,index,identity,sourceBytes=0;const originals=new Map(),sourceFiles=new Map();
        do {
          index=await call('godotProject.index',{context,worldId:args.worldId,...(bound.operation.branchId?{branchId:bound.operation.branchId}:{}),offset,limit:32,...(identity?{revision:identity.revision,manifestHash:identity.manifestHash}:{})});
          identity??=index;
          if(args.expectedSource)requireValue(identity.revision===args.expectedSource.revision&&identity.manifestHash===args.expectedSource.manifestHash,'PACKAGE_PROPOSAL_SOURCE_CHANGED');
          requireValue(index.worldId===args.worldId&&index.revision===identity.revision&&index.manifestHash===identity.manifestHash,'PACKAGE_SOURCE_CHANGED');
          for(const file of index.files){
            let next=0;const chunks=[];
            do {const part=await call('godotProject.read',{context,worldId:args.worldId,...(bound.operation.branchId?{branchId:bound.operation.branchId}:{}),revision:identity.revision,manifestHash:identity.manifestHash,path:file.path,offset:next,limit:16000});requireValue(part.sha256===file.sha256,'PACKAGE_SOURCE_CHANGED');chunks.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text,'utf8'));next=part.nextOffset;}while(next!==null&&next!==undefined);
            const bytes=Buffer.concat(chunks);requireValue(bytes.length===file.bytes&&hash(bytes)===file.sha256,'PACKAGE_SOURCE_CORRUPT');sourceBytes+=bytes.length;requireValue(sourceBytes<=64*1024*1024,'PACKAGE_SOURCE_TOO_LARGE');
            const target=safe(file.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);originals.set(file.path,file.sha256);sourceFiles.set(file.path,bytes);
          }
          offset=index.nextOffset;
        }while(offset!==null&&offset!==undefined);
        const projectText=await fs.readFile(safe('project.godot'),'utf8');
        const scene=args.scene??/run\/main_scene\s*=\s*"res:\/\/([^"]+)"/.exec(projectText)?.[1];
        const inventory={inputActions:[],autoloads:[],globalClasses:[],uids:[],paths:[...originals.keys()],entityIds:[]};
        for(const [name,bytes]of sourceFiles){
          if(name.endsWith('.gd')){const match=/^\s*class_name\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(bytes.toString('utf8'));if(match)inventory.globalClasses.push(match[1]);}
          if(name.endsWith('.uid'))inventory.uids.push(bytes.toString('utf8').trim());
          if(name.endsWith('.tscn'))for(const node of parseScene(bytes.toString('utf8')).nodes)for(const [key,value]of Object.entries(node.properties))if(key.endsWith('_id'))inventory.entityIds.push(value.replace(/^&?"|"$/g,''));
        }
        for(const [section,key]of [['input','inputActions'],['autoload','autoloads']]){
          const lines=projectText.split(/\r?\n/);let inside=false;
          for(const line of lines){if(line.startsWith('[')){inside=line==='['+section+']';continue;}if(inside){const match=/^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);if(match)inventory[key].push(match[1]);}}
        }
        const target={worldId:args.worldId,base:identity.baseId,baseVersion:world.snapshot?.baseVersion??'1.0.0',engine:identity.engineVersion,stateFormat:world.snapshot?.format??'craftmine.godot-progress/1',inventory};
        for(const resource of archives.flatMap(archive=>archive.resources)) {
          const requirements=resource.manifest.content.entry?.sourceRequirements??[];requireValue(Array.isArray(requirements)&&requirements.length<=256,'PACKAGE_BASE_REQUIREMENTS_INVALID');
          for(const required of requirements) {
          exactKeys(required,['path','sha256']);requireValue(isHash(required.sha256)&&originals.get(required.path)===required.sha256,'PACKAGE_BASE_SOURCE_MISMATCH');
          }
          const profiles=resource.manifest.content.entry?.sourceRequirementProfiles;
          if(profiles!==undefined){
            requireValue(Array.isArray(profiles)&&profiles.length>=1&&profiles.length<=8,'PACKAGE_BASE_PROFILES_INVALID');
            for(const profile of profiles){
              exactKeys(profile,['id','requirements']);requireValue(text(profile.id,100)&&Array.isArray(profile.requirements)&&profile.requirements.length>=1&&profile.requirements.length<=32,'PACKAGE_BASE_PROFILES_INVALID');
              for(const required of profile.requirements){exactKeys(required,['path','sha256']);requireValue(text(required.path,240)&&isHash(required.sha256),'PACKAGE_BASE_PROFILES_INVALID');}
            }
            requireValue(profiles.some(profile=>profile.requirements.every(required=>originals.get(required.path)===required.sha256)),'PACKAGE_BASE_PROFILE_MISMATCH');
          }
        }
        const indexedFiles=new Map([...originals].map(([path,sha256])=>[path,{path,sha256}]));
        // Resolve before planInstall/applyFiles. Explicit configuration is pinned
        // to the same current source revision that the final CAS will consume.
        const configurations=archives.map((archive,index)=>resolveSourceConfiguration(archive,indexedFiles,identity,items[index].positionBounds));
        const appliedConfigurations=[];
        const plans=[];
        for(const [index,archive]of archives.entries()){
          const plan=await call('package.planInstall',{operationId:group?'group-'+hash(JSON.stringify([args.worldId,args.operationId,index])):args.operationId,resources:archive.resources.map(r=>r.manifest),target,options:{allowInputActionRemap:false}});
          if(plan.ok!==true)throw Object.assign(Error('PACKAGE_PLAN_CONFLICT: '+JSON.stringify(plan.conflicts??[])),{code:'PACKAGE_PLAN_CONFLICT',conflicts:plan.conflicts??[]});plans.push(plan);
        }
        const merged=group?(await import('./group-source-install.mjs')).mergeSourceInstallPlans({archives,plans,operationId:args.operationId,worldId:args.worldId,sourceFiles}):null;
        const plan=merged?.plan??plans[0],payload=merged?.payload??[],sceneEdits=[],inputActions=[],scenes=new Map();
        for(const [itemIndex,archive]of archives.entries())for(const resource of archive.resources){
          if(!group)for(const [file,bytes]of resource.files)payload.push({contentHash:resource.contentHash,path:file,bytes});
          const spec=resource.manifest.content.entry?.sceneInstall;
          if(!spec){requireValue(!['object','scene','module'].includes(resource.manifest.content.kind),'PACKAGE_INSTALL_DECLARATION_REQUIRED');continue;}
          requireValue(scene,'PACKAGE_TARGET_SCENE_REQUIRED');safe(scene);
          const instance=plans[itemIndex].instances.find(i=>i.assetId===resource.manifest.content.assetId&&i.version===resource.manifest.content.version);
          requireValue(instance,'PACKAGE_INSTANCE_REQUIRED');
          const ids=Object.values(instance.entityMap);requireValue(ids.length===1,'PACKAGE_SINGLE_ENTITY_DECLARATION_REQUIRED');
          const current=scenes.get(scene)??await fs.readFile(safe(scene),'utf8');
          const linked={...spec,parent:spec.parent??'.',script:spec.script?instance.installPath+'/'+spec.script:undefined,sceneFile:spec.sceneFile?instance.installPath+'/'+spec.sceneFile:undefined};
          const itemPosition=items[itemIndex].position;
          if(itemPosition!==undefined){
            let nodeType=spec.mode==='script-node'?spec.nodeType:undefined,sceneFile=spec.sceneFile;
            // A player export may wrap an already instanced PackedScene. Follow
            // only package-local static scene roots, without executing scripts.
            const seen=new Set();
            while(spec.mode==='instance'&&sceneFile&&!nodeType&&!seen.has(sceneFile)&&seen.size<16){
              seen.add(sceneFile);const parsed=parseScene(resource.files.get(sceneFile)?.toString('utf8')??''),sceneRoot=parsed.nodes.find(n=>n.parent===null);
              nodeType=/(?:^|\s)type="([^"]+)"(?:\s|$)/.exec(sceneRoot?.attributes??'')?.[1];
              const inherited=/instance=ExtResource\("([^"]+)"\)/.exec(sceneRoot?.header??'')?.[1],ref=parsed.extResources.find(item=>item.id===inherited);
              const prefix='res://addons/'+resource.manifest.content.assetId+'/';sceneFile=ref?.path?.startsWith(prefix)?ref.path.slice(prefix.length):null;
            }
            requireValue(typeof nodeType==='string'&&nodeType.endsWith('3D'),'PACKAGE_POSITION_REQUIRES_3D_NODE');
          }
          const configuration=configurations[itemIndex].find(row=>row.resourceId===resource.manifest.content.assetId);
          const overrides=configuration?.properties?Object.fromEntries(Object.entries(configuration.properties).map(([name,value])=>[name,`Vector3(${value.join(', ')})`])):{};
          const edit=planSceneInsertion({sceneText:current,scenePath:scene,spec:linked,entityId:ids[0],overrides,...(itemPosition?{placement:{position:`Vector3(${itemPosition.x}, ${itemPosition.y}, ${itemPosition.z})`}}:{})});requireValue(edit.ok,'PACKAGE_SCENE_MATERIALIZATION_FAILED');
          if(configuration)appliedConfigurations.push({...configuration,instanceId:instance.instanceId,entityId:ids[0]});
          sceneEdits.push(edit.edit);scenes.set(scene,applySceneInsertion(current,edit.edit));inputActions.push(...(spec.inputActions??[]));
        }
        const resourceManifests=[...new Map(archives.flatMap(archive=>archive.resources).map(resource=>[resource.manifest.contentHash,resource.manifest])).values()];
        const draft=planDraftInstall({plan,payload,projectDir,sceneEdits,inputActions,resourceManifests});if(!draft.ok)throw Object.assign(Error('PACKAGE_DRAFT_CONFLICT: '+JSON.stringify(draft.errors??draft.conflicts??draft.reason??draft)),{code:'PACKAGE_DRAFT_CONFLICT'});
        const files=draft.files.filter(f=>originals.get(f.path)!==f.sha256).map(f=>({path:f.path,bytesBase64:f.bytes.toString('base64'),expectedHash:originals.get(f.path)??null}));
        requireValue(files.length>0,'PACKAGE_NO_CHANGES');
        const toolCallId='package-'+key.slice(0,40);
        const applyRequest={context,worldId:args.worldId,toolCallId,revision:identity.revision,manifestHash:identity.manifestHash,operation:bound.operation,files};
        requireValue(Buffer.byteLength(JSON.stringify(applyRequest))<=8*1024*1024,'PACKAGE_INSTALL_REQUEST_TOO_LARGE');
        intent={requestHash,applyRequest,toolCallId,context,ownsTurn:bound.ownsTurn===true,worldId:args.worldId,...(group?{archives:merged.archives}:{archiveSha256:archives[0].archiveSha256}),instanceIds:plan.instances.map(i=>i.instanceId),sourceConfigurations:appliedConfigurations};await save(intent);
      }
      if(!intent.receipt){intent.receipt=await call('godotProject.applyFiles',intent.applyRequest);requireValue(Number.isSafeInteger(intent.receipt.revision)&&typeof intent.receipt.manifestHash==='string','PACKAGE_SOURCE_RECEIPT_REQUIRED');await save(intent);}
      if(!intent.job||!group&&intent.job.status==='blocked'&&!intent.ownsTurn){intent.checkAttempt=(intent.checkAttempt??0)+1;requireValue(intent.checkAttempt<=32,'PACKAGE_CHECK_RETRY_LIMIT');intent.job=await call('godotBuild.start',{context:intent.context,worldId:intent.worldId,...(intent.applyRequest.operation?.branchId?{branchId:intent.applyRequest.operation.branchId}:{}),toolCallId:intent.toolCallId+'-check-'+intent.checkAttempt,revision:intent.receipt.revision,manifestHash:intent.receipt.manifestHash,mode:'check'});await save(intent);}
      if(intent.job.status!=='blocked'){
        if(ownedContext){turns.watch({...intent.job,worldId:intent.worldId},ownedContext);handedOff=true;}
        await enqueue(intent.job,intent.context);
      }
      completed=true;
      return {status:intent.job.status==='blocked'?'source-saved-check-blocked':'check-queued',applied:false,worldId:intent.worldId,...(intent.archives?{archives:intent.archives}:{archiveSha256:intent.archiveSha256}),instanceIds:intent.instanceIds,...(intent.sourceConfigurations?.length?{sourceConfigurations:intent.sourceConfigurations}:{}),source:intent.receipt,job:intent.job};
    })().finally(async()=>{try{if(ownedContext&&!handedOff)await turns.finish(ownedContext,completed?'completed':'error');}finally{if(active.get(key)===entry)active.delete(key);}});
    return entry.promise;
  };
  const installSource=args=>executeInstall(args);
  installSource.group=args=>executeInstall(args,true);
  // Private operation recovery. The caller must never project this intent's
  // task context or staged source bytes to a renderer.
  installSource.readOperation=async args=>{
    exactKeys(args,['worldId','operationId']);identifier(args.worldId);operationId(args.operationId);
    const fs=await import('node:fs/promises'),path=await import('node:path'),{createHash}=await import('node:crypto');
    const key=createHash('sha256').update(JSON.stringify([args.worldId,args.operationId])).digest('hex');
    try{return JSON.parse(await fs.readFile(path.join(stagingRoot,key,'intent.json'),'utf8'));}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  };
  installSource.drain=()=>Promise.allSettled([...active.values()].map(entry=>entry.promise));
  return installSource;
}
