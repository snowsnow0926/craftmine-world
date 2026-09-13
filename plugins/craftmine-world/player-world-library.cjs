// Player-owned whole-world archives. Rust owns catalog records and formal source.
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,code)=>{if(!condition)throw Error(code);};
const exact=(value,keys)=>check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key)),'WORLD_TEMPLATE_INVALID_PARAMS');
const op=value=>check(typeof value==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(value),'WORLD_TEMPLATE_OPERATION_REQUIRED');
const text=(value,max)=>check(typeof value==='string'&&value.trim()&&Buffer.byteLength(value)<=max&&!/[\x00-\x1f]/.test(value),'WORLD_TEMPLATE_INVALID_METADATA');
const limits={maxEntries:4096,maxEntryBytes:4*1024*1024,maxTotalBytes:64*1024*1024,maxCompressedBytes:64*1024*1024,maxDepth:32,maxNameBytes:240,maxRatio:200};
const sourceExtensions=new Set(['.godot','.gd','.tscn','.tres','.gdshader','.gdshaderinc','.json','.cfg','.txt','.md','.csv','.svg','.obj','.mtl','.uid','.png','.jpg','.jpeg','.webp','.glb','.ogg','.wav']);
const identity=s=>({worldId:s.worldId,buildId:s.buildId,contentOid:s.contentOid,revision:s.revision,snapshotHash:sha(JSON.stringify(s.snapshot))});
const equal=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>a[key]===b[key]);
function reference(value){exact(value,['assetId','version','contentHash']);check(typeof value.assetId==='string'&&/^player\.world\.[a-z0-9_-]{1,60}$/.test(value.assetId)&&Number.isInteger(value.version)&&value.version>0&&value.version<=100000&&/^[a-f0-9]{64}$/.test(value.contentHash),'WORLD_TEMPLATE_INVALID_REF');return {assetId:value.assetId,version:value.version,contentHash:value.contentHash};}
function metadata(value){
 text(value.displayName,120);check(typeof value.description==='string'&&Buffer.byteLength(value.description)<=1200,'WORLD_TEMPLATE_INVALID_METADATA');
 check(Array.isArray(value.tags)&&value.tags.length<=30,'WORLD_TEMPLATE_INVALID_METADATA');for(const tag of value.tags)text(tag,40);
 check(typeof value.assetId==='string'&&/^player\.world\.[a-z0-9_-]{1,60}$/.test(value.assetId)&&Number.isInteger(value.version)&&value.version>0&&value.version<=100000,'WORLD_TEMPLATE_INVALID_METADATA');
 check(value.initialState==='saved-progress','WORLD_TEMPLATE_INITIAL_STATE_CHOICE_REQUIRED');
}
async function zipTools(){return import('./package-zip.mjs');}
async function validateArchive(bytes){
 check(bytes.length<=limits.maxCompressedBytes,'WORLD_TEMPLATE_TOO_LARGE');
 const {readZip,assertShareablePath}=await zipTools();const {entries}=readZip(bytes,limits);const files=new Map(entries.map(e=>[e.name,e.bytes]));
 check(files.has('world-template.json'),'WORLD_TEMPLATE_ARCHIVE_INVALID');const manifest=JSON.parse(files.get('world-template.json'));
 check(manifest.format==='craftmine.player-world-template/1'&&manifest.baseId==='creation-sandbox'&&manifest.baseVersion==='1.0.0','WORLD_TEMPLATE_INCOMPATIBLE');metadata(manifest);
 check(typeof manifest.worldId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(manifest.worldId)&&typeof manifest.sourceWorldId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(manifest.sourceWorldId),'WORLD_TEMPLATE_IDENTITY_INVALID');
 check(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=4092,'WORLD_TEMPLATE_ARCHIVE_INVALID');
 const allowed=new Set(['world-template.json','initial.json']);const seen=new Set();
 for(const file of manifest.files){
  text(file.path,220);assertShareablePath(file.path);
  check(!file.path.split('/').some(part=>['.godot','.import'].includes(part.toLowerCase())),'WORLD_TEMPLATE_SOURCE_PATH_INVALID');
  const extension=path.posix.extname(file.path).toLowerCase(),assetPath=file.path.slice(0,-7);
  // Match Core's authored source policy; accepting image/audio originals does
  // not mean their generated import settings are supported source files.
  const importSettings=file.path.endsWith('.glb.import')&&manifest.files.some(asset=>asset.path===assetPath);
  check((sourceExtensions.has(extension)||importSettings)&&!['managed-base.json','.creation-owner.json','craftmine_initial_state.json'].includes(file.path),'WORLD_TEMPLATE_SOURCE_PATH_INVALID');
  const key=file.path.normalize('NFC').toLowerCase();check(!seen.has(key),'WORLD_TEMPLATE_SOURCE_ALIAS');seen.add(key);
  const name='source/'+file.path,body=files.get(name);check(body&&body.length===file.bytes&&sha(body)===file.sha256,'WORLD_TEMPLATE_SOURCE_CHANGED');allowed.add(name);
 }
 check(seen.has('project.godot'),'WORLD_TEMPLATE_PROJECT_REQUIRED');
 const initial=files.get('initial.json');check(initial&&initial.length<=1024*1024&&sha(initial)===manifest.initialSha256,'WORLD_TEMPLATE_INITIAL_STATE_INVALID');
 const snapshot=JSON.parse(initial);check(snapshot.format==='craftmine.godot-progress/1'&&snapshot.stateVersion===1&&snapshot.worldId===manifest.worldId&&snapshot.baseId===manifest.baseId&&snapshot.baseVersion===manifest.baseVersion&&snapshot.body?.worldId===manifest.worldId,'WORLD_TEMPLATE_INITIAL_STATE_INVALID');
 if(manifest.preview){const preview=files.get('preview.png');check(manifest.preview.scope==='source-world-view'&&preview&&preview.length<=2*1024*1024&&sha(preview)===manifest.preview.sha256&&preview.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'WORLD_TEMPLATE_PREVIEW_INVALID');allowed.add('preview.png');}
 check(entries.length===allowed.size&&entries.every(e=>allowed.has(e.name)),'WORLD_TEMPLATE_UNDECLARED_FILE');
 return {manifest,files,snapshot,archiveSha256:sha(bytes)};
}
function summary(archive,ref){const m=archive.manifest;return {format:m.format,ref,displayName:m.displayName,description:m.description,tags:m.tags,baseId:m.baseId,baseVersion:m.baseVersion,initialState:m.initialState,source:m.source,kind:'world',installableComponent:false,action:'create-new-world',compatibility:{baseId:m.baseId,baseVersion:m.baseVersion,requiresCheckAndFirstLoad:true},...(m.preview?{preview:'data:image/png;base64,'+archive.files.get('preview.png').toString('base64'),previewScope:m.preview.scope}:{}),archiveSha256:archive.archiveSha256};}
async function writeJson(file,value){const temporary=file+'.tmp';await fs.writeFile(temporary,JSON.stringify(value));await fs.rename(temporary,file);}
async function materializeArchive(archive,worldId,directory,ref){
 const m=archive.manifest,files=new Map(m.files.map(f=>[f.path.toLowerCase(),{path:f.path,bytes:archive.files.get('source/'+f.path)}]));
 const config=files.get('project.godot');let count=0,section='';
 config.bytes=Buffer.from(config.bytes.toString('utf8').split(/(?<=\n)/).map(line=>{
  if(/^\s*\[.*\]\s*$/.test(line))section=line.trim();
  if(section==='[craftmine]'&&/^runtime\/world_id\s*=/.test(line)){const old=JSON.parse(line.slice(line.indexOf('=')+1).trim());check(old===m.sourceWorldId||old===m.worldId,'WORLD_TEMPLATE_RUNTIME_IDENTITY_INVALID');count++;return line.replace(JSON.stringify(old),JSON.stringify(worldId));}return line;
 }).join(''));check(count===1,'WORLD_TEMPLATE_RUNTIME_IDENTITY_INVALID');
 const journal=files.get('world/creation-operations.json');if(journal){const value=JSON.parse(journal.bytes);check(value.format==='craftmine.creation-operations/1'&&Array.isArray(value.operations),'WORLD_TEMPLATE_RECEIPT_INVALID');for(const operation of value.operations){check([m.sourceWorldId,m.worldId].includes(operation.receipt?.worldId),'WORLD_TEMPLATE_RECEIPT_INVALID');operation.receipt.originWorldId??=operation.receipt.worldId;operation.receipt.worldId=worldId;}journal.bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');}
 const instances=files.get('craftmine.instances.json');if(instances){
  let value;try{value=JSON.parse(instances.bytes);}catch{throw Error('WORLD_TEMPLATE_INSTANCE_MAP_INVALID');}
  check(value?.format==='craftmine.godot-draft-instances/1'&&typeof value.worldId==='string'&&[m.sourceWorldId,m.worldId].includes(value.worldId)&&Array.isArray(value.instances)&&value.instances.length<=1024,'WORLD_TEMPLATE_INSTANCE_MAP_INVALID');
  // Instance/resource identities are local to the copied world and its source
  // declarations. Only the registry's world binding changes, never script data.
  value.worldId=worldId;instances.bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 }
 const body={...archive.snapshot.body,worldId};files.set('craftmine_initial_state.json',{path:'craftmine_initial_state.json',bytes:Buffer.from(JSON.stringify({format:'craftmine.materialized-initial-state/1',worldId,baseId:m.baseId,template:'library',initialState:m.initialState,initialProgress:body}))});
 const manifest={format:'craftmine.managed-base-source/1',baseId:m.baseId,baseVersion:m.baseVersion,worldId,template:'library',protocol:'craftmine.godot-runtime/2',progressFormat:'craftmine.godot-progress/1',stateVersion:archive.snapshot.stateVersion,templateSource:ref,initialState:m.initialState,files:[...files.values()].map(f=>({path:f.path,bytes:f.bytes.length,sha256:sha(f.bytes)})).sort((a,b)=>a.path.localeCompare(b.path))};
 await fs.mkdir(directory,{recursive:true});check(!(await fs.lstat(directory)).isSymbolicLink(),'WORLD_TEMPLATE_STAGING_LINK');
 for(const file of [...files.values(),{path:'managed-base.json',bytes:Buffer.from(JSON.stringify(manifest))}]){
  let parent=directory;for(const part of file.path.split('/').slice(0,-1)){parent=path.join(parent,part);await fs.mkdir(parent,{recursive:true});check(!(await fs.lstat(parent)).isSymbolicLink(),'WORLD_TEMPLATE_STAGING_LINK');}
  const target=path.join(directory,file.path);try{await fs.writeFile(target,file.bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;check((await fs.lstat(target)).isFile()&&!(await fs.lstat(target)).isSymbolicLink()&&sha(await fs.readFile(target))===sha(file.bytes),'WORLD_TEMPLATE_OPERATION_CONFLICT');}
 }
 return manifest;
}
function createPlayerWorldLibrary({call,directory,selected}){
 check(typeof call==='function'&&typeof selected==='function'&&path.isAbsolute(directory),'WORLD_TEMPLATE_HOST_REQUIRED');const running=new Map();
 async function ensureDirectory(...parts){await fs.mkdir(directory,{recursive:true});check(await fs.realpath(directory)===path.resolve(directory),'WORLD_TEMPLATE_STAGING_LINK');let parent=directory;for(const part of parts){parent=path.join(parent,part);await fs.mkdir(parent,{recursive:true});check(!(await fs.lstat(parent)).isSymbolicLink()&&await fs.realpath(parent)===path.resolve(parent),'WORLD_TEMPLATE_STAGING_LINK');}return parent;}
 const load=async operationId=>{const filename=path.join(directory,operationId,'operation.json');const stat=await fs.lstat(filename);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4*1024*1024,'WORLD_TEMPLATE_OPERATION_INVALID');return JSON.parse(await fs.readFile(filename,'utf8'));};
 const persist=async entry=>{await ensureDirectory(entry.operationId);await writeJson(path.join(directory,entry.operationId,'operation.json'),entry);};
 async function source(worldId){check(await selected()===worldId,'GODOT_WORLD_CHANGED');const result=await call('godotRuntime.exportSource',{worldId});check(result.worldId===worldId&&result.baseId==='creation-sandbox'&&result.baseVersion==='1.0.0','WORLD_TEMPLATE_INCOMPATIBLE');return result;}
 async function read(ref){ref=reference(ref);const record=await call('asset.read',{assetId:ref.assetId,version:ref.version}),v=record.version_;check(v?.contentHash===ref.contentHash&&v.kind==='world'&&v.mediaKind==='package'&&v.files?.length===1,'WORLD_TEMPLATE_ASSET_CHANGED');const file=v.files[0];check(file.mediaType==='application/zip'&&file.bytes<=limits.maxCompressedBytes,'WORLD_TEMPLATE_ARCHIVE_INVALID');const body=await call('asset.bodyPath',{assetId:ref.assetId,version:ref.version,path:file.path});check(body.sha256===file.sha256&&body.bytes===file.bytes&&path.isAbsolute(body.blobPath),'WORLD_TEMPLATE_ASSET_CHANGED');const stat=await fs.lstat(body.blobPath);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===file.bytes,'WORLD_TEMPLATE_ASSET_CHANGED');const bytes=await fs.readFile(body.blobPath);check(sha(bytes)===file.sha256,'WORLD_TEMPLATE_ASSET_CHANGED');const archive=await validateArchive(bytes);check(archive.manifest.assetId===ref.assetId&&archive.manifest.version===ref.version,'WORLD_TEMPLATE_ASSET_CHANGED');return {archive,bytes,ref};}
 async function commit(entry,bytes){
  const archive=await validateArchive(bytes),m=archive.manifest,filename=path.join(directory,entry.operationId,'world.zip');
  await ensureDirectory(entry.operationId);
  try{await fs.writeFile(filename,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;const stat=await fs.lstat(filename);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===bytes.length&&sha(await fs.readFile(filename))===sha(bytes),'WORLD_TEMPLATE_OPERATION_CONFLICT');}entry.archiveSha256=sha(bytes);entry.status='committing';await persist(entry);
  // Cancellation before this point prevents the import. Once committing starts,
  // the immutable native receipt is authoritative even if the caller disconnects.
  const result=await call('asset.import',{operationId:'world-template-'+entry.operationId,sourceRoot:path.dirname(filename),sourcePath:filename,assetId:m.assetId,version:m.version,kind:'world',mediaKind:'package',path:'world.zip',mediaType:'application/zip',displayName:m.displayName,source:{origin:'player-world-template',author:'player',license:'Not specified by author',licenseStatus:'unknown'},tags:[...m.tags,'world-template',m.initialState]});
  const v=(await call('asset.read',{assetId:m.assetId,version:m.version})).version_;check(v?.files?.[0]?.sha256===entry.archiveSha256,'WORLD_TEMPLATE_IMPORT_RECEIPT_INVALID');
  entry.result=summary(archive,{assetId:m.assetId,version:m.version,contentHash:v.contentHash});entry.status='saved';delete entry.error;await persist(entry);return entry.result;
 }
 return {
  async describe(args){exact(args,['worldId']);const s=await source(args.worldId);return {worldId:s.worldId,baseId:s.baseId,baseVersion:s.baseVersion,expectedSource:identity(s),initialStates:['saved-progress'],files:s.files.length,bytes:s.files.reduce((n,f)=>n+f.bytes,0)};},
  async save(args){
   exact(args,['worldId','operationId','displayName','description','tags','assetId','version','initialState','expectedSource','preview']);op(args.operationId);metadata(args);check(args.expectedSource&&args.expectedSource.worldId===args.worldId,'WORLD_TEMPLATE_SOURCE_REQUIRED');
   const request={...args};delete request.preview;const requestHash=sha(JSON.stringify(request));
   let prior;try{prior=await load(args.operationId);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(prior){check(prior.requestHash===requestHash,'WORLD_TEMPLATE_OPERATION_CONFLICT');if(prior.result)return prior.result;if(prior.status==='cancelled')throw Error('WORLD_TEMPLATE_CANCELLED');}
   if(running.has(args.operationId)){check(running.get(args.operationId).requestHash===requestHash,'WORLD_TEMPLATE_OPERATION_CONFLICT');return running.get(args.operationId).promise;}
   const control={cancelled:false,promise:null,requestHash};running.set(args.operationId,control);
   control.promise=(async()=>{const entry=prior??{operationId:args.operationId,requestHash,status:'capturing'};await persist(entry);
    const active=async()=>{check(!control.cancelled,'WORLD_TEMPLATE_CANCELLED');check(await selected()===args.worldId,'GODOT_WORLD_CHANGED');};
    try{
     if(entry.status==='committing'){const bytes=await fs.readFile(path.join(directory,args.operationId,'world.zip'));check(sha(bytes)===entry.archiveSha256,'WORLD_TEMPLATE_SOURCE_CHANGED');return await commit(entry,bytes);}
     await active();const s=await source(args.worldId);check(equal(identity(s),args.expectedSource),'WORLD_TEMPLATE_SOURCE_CHANGED');
     const {writeZip,assertShareablePath}=await zipTools();const entries=[],files=[];let total=0;
     for(const f of s.files){await active();if(['managed-base.json','.creation-owner.json','craftmine_initial_state.json'].includes(f.path))continue;assertShareablePath(f.path);check(f.bytes<=limits.maxEntryBytes,'WORLD_TEMPLATE_FILE_TOO_LARGE');total+=f.bytes;check(total<=60*1024*1024&&files.length<4092,'WORLD_TEMPLATE_TOO_LARGE');const result=await call('content.readFile',{worldId:s.worldId,rev:s.contentOid,path:f.path,encoding:'base64'});const bytes=Buffer.from(result.base64,'base64');check(bytes.length===f.bytes&&sha(bytes)===f.sha256,'WORLD_TEMPLATE_SOURCE_CHANGED');files.push(f);entries.push({name:'source/'+f.path,bytes});}
     const initial=Buffer.from(JSON.stringify(s.snapshot));const manifest={format:'craftmine.player-world-template/1',assetId:args.assetId,version:args.version,displayName:args.displayName,description:args.description,tags:args.tags,baseId:s.baseId,baseVersion:s.baseVersion,worldId:s.worldId,sourceWorldId:s.sourceWorldId,initialState:args.initialState,source:identity(s),files,initialSha256:sha(initial)};
     entries.push({name:'initial.json',bytes:initial});
     if(args.preview){exact(args.preview,['pngBase64','sha256','worldId','buildId']);check(args.preview.worldId===s.worldId&&args.preview.buildId===s.buildId,'WORLD_TEMPLATE_PREVIEW_STALE');const png=Buffer.from(args.preview.pngBase64,'base64');check(sha(png)===args.preview.sha256,'WORLD_TEMPLATE_PREVIEW_INVALID');manifest.preview={sha256:sha(png),scope:'source-world-view'};entries.push({name:'preview.png',bytes:png});}
     entries.push({name:'world-template.json',bytes:Buffer.from(JSON.stringify(manifest))});const bytes=writeZip(entries);await validateArchive(bytes);
     await active();check(equal(identity(await source(args.worldId)),args.expectedSource),'WORLD_TEMPLATE_SOURCE_CHANGED');await active();control.committing=true;return await commit(entry,bytes);
    }catch(error){entry.status=control.committing||entry.status==='committing'?'committing':control.cancelled?'cancelled':'failed';entry.error=String(error.message);await persist(entry);throw error;}
   })().finally(()=>running.delete(args.operationId));return control.promise;
  },
  async status(args){exact(args,['operationId']);op(args.operationId);let entry;try{entry=await load(args.operationId);}catch(error){if(error.code!=='ENOENT')throw error;entry={operationId:args.operationId,status:'unknown'};}return {operationId:entry.operationId,status:entry.status,error:entry.error??null,result:entry.result??null};},
  async cancel(args){exact(args,['operationId']);op(args.operationId);const control=running.get(args.operationId);let entry;try{entry=await load(args.operationId);}catch(error){if(error.code!=='ENOENT')throw error;entry={operationId:args.operationId,status:'cancelled'};}if(entry.status==='saved'||entry.status==='committing'||control?.committing)return {cancelled:false,status:entry.status,result:entry.result??null};if(control)control.cancelled=true;else{entry.status='cancelled';await persist(entry);}return {cancelled:true,status:'cancelled'};},
  async list(args={}){exact(args,['query','offset','limit']);const result=await call('asset.search',{scope:'local-library',kind:'world',mediaKind:'package',query:args.query??'',offset:args.offset??0,limit:args.limit??24});return {...result,kind:'world',installableComponent:false,action:'create-new-world'};},
  async read(args){exact(args,['ref']);const value=await read(args.ref);return summary(value.archive,value.ref);},
  async prepare(args){exact(args,['ref','worldId','operationId']);op(args.operationId);check(typeof args.worldId==='string'&&/^[a-z0-9][a-z0-9-]{1,47}$/.test(args.worldId),'INVALID_WORLD_ID');const value=await read(args.ref);const sourceDirectory=await ensureDirectory('prepared',args.operationId);const manifest=await materializeArchive(value.archive,args.worldId,sourceDirectory,value.ref);return {sourceDirectory,manifest,...summary(value.archive,value.ref)};},
  async importArchive(args){exact(args,['operationId','archivePath','archiveSha256']);op(args.operationId);check(path.isAbsolute(args.archivePath),'WORLD_TEMPLATE_FILE_GRANT_REQUIRED');const requestHash=sha(JSON.stringify(args));let prior;try{prior=await load(args.operationId);}catch(error){if(error.code!=='ENOENT')throw error;}if(prior){check(prior.requestHash===requestHash,'WORLD_TEMPLATE_OPERATION_CONFLICT');if(prior.result)return prior.result;}const stat=await fs.lstat(args.archivePath);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limits.maxCompressedBytes,'WORLD_TEMPLATE_ARCHIVE_INVALID');const bytes=await fs.readFile(args.archivePath);check(sha(bytes)===args.archiveSha256,'WORLD_TEMPLATE_SOURCE_CHANGED');return commit({operationId:args.operationId,requestHash,status:'committing'},bytes);},
  async exportArchive(args){exact(args,['ref','destination']);check(path.isAbsolute(args.destination),'WORLD_TEMPLATE_FILE_GRANT_REQUIRED');const value=await read(args.ref);await fs.writeFile(args.destination,value.bytes,{flag:'wx'});return {ref:value.ref,bytes:value.bytes.length,sha256:sha(value.bytes)};},
  async drain(){for(const c of running.values())if(!c.committing)c.cancelled=true;await Promise.allSettled([...running.values()].map(c=>c.promise));},
 };
}
module.exports={createPlayerWorldLibrary,validateArchive,materializeArchive,reference,worldTemplateSummary:summary};
