// Read-only managed-source component extraction. Never executes authored code.
import {createHash} from 'node:crypto';
import {parseScene} from '../../desktop/godot/shared/scene_materializer.mjs';
import {contentHash} from './package-format.mjs';
import {createInstanceSourceDeclaration,resolveInstanceParameterDeclaration} from './godot-instance-declaration.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,errorCode:code});};
const check=(yes,code)=>{if(!yes)fail(code);};
const fields=(input,keys)=>check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(key=>keys.includes(key)),'INVALID_PARAMS');
const texts=/\.(gd|tscn|tres|json|svg|obj|mtl)$/;
const literal=value=>/^&?"([^"\\]*)"$/.exec(value??'')?.[1];
const refs=value=>[...value.matchAll(/res:\/\/([^"'\s)]+)/g)].map(match=>match[1]);
// Only the bounded GLB 2 container and standard images/buffers URI surfaces.
// External buffers are identified but rejected: managed source has no .bin
// file kind. Embedded BIN/image bufferViews remain inside the measured GLB.
export function glbDependencies(name,input){
  const bytes=Buffer.from(input);check(bytes.length>=20&&bytes.length<=4*1024*1024&&bytes.readUInt32LE(0)===0x46546c67&&bytes.readUInt32LE(4)===2&&bytes.readUInt32LE(8)===bytes.length,'PACKAGE_GLB_INVALID');
  let offset=12,json=null,bin=false;
  while(offset<bytes.length){
    check(offset+8<=bytes.length,'PACKAGE_GLB_INVALID');const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);offset+=8;
    check(length%4===0&&offset+length<=bytes.length,'PACKAGE_GLB_INVALID');
    if(type===0x4e4f534a){check(json===null&&offset===20,'PACKAGE_GLB_INVALID');try{json=JSON.parse(bytes.subarray(offset,offset+length).toString('utf8'));}catch{fail('PACKAGE_GLB_INVALID');}}
    else if(type===0x004e4942){check(json!==null&&!bin,'PACKAGE_GLB_INVALID');bin=true;}
    else fail('PACKAGE_GLB_CHUNK_UNSUPPORTED');
    offset+=length;
  }
  check(json&&json.asset?.version==='2.0','PACKAGE_GLB_INVALID');const result=[];
  for(const kind of ['images','buffers']){
    const entries=json[kind]??[];check(Array.isArray(entries)&&entries.length<=256,'PACKAGE_GLB_INVALID');
    for(const entry of entries){
      check(entry&&typeof entry==='object'&&!Array.isArray(entry),'PACKAGE_GLB_INVALID');
      if(entry.uri===undefined)continue;
      const uri=entry.uri;check(typeof uri==='string'&&uri.length>0&&uri.length<=240,'PACKAGE_GLB_URI_INVALID');
      check(!uri.startsWith('data:'),'PACKAGE_GLB_DATA_URI_UNSUPPORTED');
      check(!/^[\/\\]|[:\\%?#\x00-\x20]/.test(uri),'PACKAGE_GLB_URI_UNSAFE');
      const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),uri));
      check(!resolved.startsWith('../')&&!path.posix.isAbsolute(resolved)&&resolved.split('/').every(part=>/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part)),'PACKAGE_GLB_URI_UNSAFE');
      if(kind==='buffers')fail('PACKAGE_GLB_EXTERNAL_BUFFER_UNSUPPORTED');
      check(/\.(png|jpg|jpeg|webp|svg)$/i.test(resolved),'PACKAGE_GLB_IMAGE_FORMAT_UNSUPPORTED');result.push(resolved);
    }
  }
  return [...new Set(result)];
}
function dependencies(name,body) {
  if(name.toLowerCase().endsWith('.glb'))return glbDependencies(name,body);
  const result=refs(body);
  if(name.endsWith('.obj'))for(const match of body.matchAll(/^mtllib\s+([^\r\n]+)$/gm))result.push(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1].trim())));
  if(name.endsWith('.mtl'))for(const match of body.matchAll(/^map_\w+\s+([^\r\n]+)$/gm)){check(!match[1].startsWith('-'),'PACKAGE_MATERIAL_OPTIONS_UNSUPPORTED');result.push(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1].trim())));}
  return result;
}
// Installed components already carry an addons/<asset> prefix. Re-exporting
// that path verbatim nests every previous installation on Windows. Relocate
// their payload into bounded groups, keeping opaque relative model references
// together. A fresh extraction wrapper stays outside these groups.
function payloadPaths(payload){
  const paths=new Map([...payload.keys()].map(name=>[name,name]));
  if(![...payload.keys()].some(name=>name.startsWith('addons/')))return paths;
  const names=[...payload.keys()].filter(name=>name!=='_craftmine_component.tscn').sort(),parents=new Map(names.map(name=>[name,name]));
  const root=name=>{let current=name;while(parents.get(current)!==current)current=parents.get(current);return current;};
  const join=(a,b)=>{check(parents.has(b),'PACKAGE_SOURCE_DEPENDENCY_MISSING');parents.set(root(b),root(a));};
  for(const name of names){
    if(/\.(glb|obj|mtl)$/i.test(name))for(const dependency of dependencies(name,name.toLowerCase().endsWith('.glb')?payload.get(name):payload.get(name).toString('utf8')))join(name,dependency);
    if(name.endsWith('.glb')&&payload.has(name+'.import'))join(name,name+'.import');
  }
  const groups=new Map();for(const name of names){const key=root(name);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(name);}
  let index=0;
  for(const group of groups.values()){
    const prefix=path.posix.dirname(group[0]).split('/').filter(part=>part!=='.');
    for(const name of group.slice(1)){const directory=path.posix.dirname(name).split('/');while(prefix.length&&!prefix.every((part,i)=>directory[i]===part))prefix.pop();}
    const skip=prefix.length?prefix.join('/').length+1:0;
    for(const name of group)paths.set(name,'r/'+index+'/'+name.slice(skip));
    index++;
  }
  check(new Set(paths.values()).size===paths.size,'PACKAGE_RELOCATION_COLLISION');return paths;
}
const nodePath=node=>node.parent===null?'.':node.parent==='.'?node.name:node.parent+'/'+node.name;
function sections(text){return text.replace(/\r\n/g,'\n').split(/(?=^\[(?:gd_scene|ext_resource|sub_resource|node|connection|editable)\b)/m).filter(value=>value.trim());}
function extractSubtree(sceneText,wanted) {
  const parsed=parseScene(sceneText),root=parsed.nodes.find(node=>nodePath(node)===wanted);
  check(root&&root.parent!==null,'PACKAGE_SELECT_COMPONENT_NOT_WORLD');
  const selected=new Set(parsed.nodes.filter(node=>nodePath(node)===wanted||nodePath(node).startsWith(wanted+'/')).map(nodePath));
  const all=sections(sceneText),nodes=[],resources=new Map(),connections=[];
  for(const section of all) {
    if(section.startsWith('[ext_resource')||section.startsWith('[sub_resource')) {
      const kind=section.startsWith('[ext_resource')?'ExtResource':'SubResource',id=/\bid="([^"]+)"/.exec(section.split('\n')[0])?.[1];
      if(id)resources.set(kind+':'+id,section);continue;
    }
    if(section.startsWith('[node')) {
      const node=parseScene(section).nodes[0],at=nodePath(node);if(!selected.has(at))continue;
      if(at!==wanted)check(!Object.entries(node.properties).some(([key,value])=>['entity_id','target_id'].includes(key)&&literal(value)),'PACKAGE_MULTIPLE_IDENTITIES_UNSUPPORTED');
      let changed=section;
      if(at===wanted)changed=changed.replace(/ parent="[^"]*"/,'');
      else changed=changed.replace(/ parent="([^"]*)"/,(_,parent)=>' parent="'+(parent===wanted?'.':parent.slice(wanted.length+1))+'"');
      check(!/NodePath\("(?:\.\.\/|\/root)/.test(changed),'PACKAGE_EXTERNAL_NODE_DEPENDENCY');nodes.push(changed);
    }
    if(section.startsWith('[connection')) {
      const from=/\bfrom="([^"]*)"/.exec(section)?.[1],to=/\bto="([^"]*)"/.exec(section)?.[1];
      if(selected.has(from)||selected.has(to)) {
        check(selected.has(from)&&selected.has(to),'PACKAGE_EXTERNAL_SIGNAL_DEPENDENCY');
        connections.push(section.replace(/\b(from|to)="([^"]*)"/g,(_,key,value)=>`${key}="${value===wanted?'.':value.slice(wanted.length+1)}"`));
      }
    }
  }
  const used=new Map(),queue=[...nodes,...connections];
  while(queue.length)for(const match of queue.shift().matchAll(/\b(ExtResource|SubResource)\("([^"]+)"\)/g)) {
    const key=match[1]+':'+match[2];if(used.has(key))continue;const section=resources.get(key);check(section,'PACKAGE_SCENE_RESOURCE_MISSING');used.set(key,section);queue.push(section);
  }
  return '[gd_scene load_steps='+(used.size+1)+' format=3]\n\n'+[...used.values(),...nodes,...connections].join('\n');
}
function classIndex(files) {const classes=new Map();for(const [name,bytes]of files)if(name.endsWith('.gd')){const found=/^\s*class_name\s+(\w+)/m.exec(bytes.toString('utf8'));if(found)classes.set(found[1],name);}return classes;}
function identityFor(files,scenePath,node,classes,seen=new Set()) {
  if(!node)return null;
  for(const field of ['entity_id','target_id'])if(literal(node.properties[field]))return {field,id:literal(node.properties[field]),type:node.properties[field].startsWith('&')?'stringname':'string'};
  const parsed=parseScene(files.get(scenePath)?.toString('utf8')??'');
  const scriptId=/ExtResource\("([^"]+)"\)/.exec(node.properties.script??'')?.[1];
  const instanceId=/instance=ExtResource\("([^"]+)"\)/.exec(node.header)?.[1];
  const resource=parsed.extResources.find(item=>item.id===(scriptId??instanceId));
  const resourcePath=resource?.path?.replace(/^res:\/\//,'');
  if(resourcePath&&!seen.has(resourcePath)) {
    seen.add(resourcePath);const body=files.get(resourcePath)?.toString('utf8');if(!body)return null;
    if(resourcePath.endsWith('.tscn'))return identityFor(files,resourcePath,parseScene(body).nodes[0],classes,seen);
    let current=body;
    for(let i=0;i<16;i++) {
      for(const field of ['entity_id','target_id'])if(new RegExp('@export[^\\n]*\\bvar\\s+'+field+'\\b').test(current))return {field,id:node.name,type:new RegExp('\\b'+field+'\\s*:\\s*StringName').test(current)?'stringname':'string'};
      const parent=/^\s*extends\s+(\w+)/m.exec(current)?.[1],parentPath=classes.get(parent);if(!parentPath||seen.has(parentPath))break;seen.add(parentPath);current=files.get(parentPath).toString('utf8');
    }
  }
  return null;
}
export function createManagedPackageSourceService({call,bind,recoverCatalogDeclaration=false}) {
  check(typeof call==='function'&&typeof bind==='function','PACKAGE_SOURCE_HOST_REQUIRED');
  async function read(args,{listing=false,assertActive=()=>{}}={}) {
    const bound=await bind(args.worldId);check(bound?.worldRecord?.id===args.worldId&&bound.context,'PACKAGE_BINDING_MISMATCH');
    const files=new Map(),descriptors=new Map();let offset=0,identity,total=0;
    async function loadFile(name){
      if(files.has(name))return files.get(name);const file=descriptors.get(name);check(file,'PACKAGE_SOURCE_DEPENDENCY_MISSING');
      let next=0;const chunks=[];
      do {assertActive();const part=await call('godotProject.read',{context:bound.context,worldId:args.worldId,revision:identity.revision,manifestHash:identity.manifestHash,path:file.path,offset:next,limit:16000});check(part.sha256===file.sha256,'PACKAGE_SOURCE_CHANGED');chunks.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text,'utf8'));next=part.nextOffset;}while(next!==null&&next!==undefined);
      const bytes=Buffer.concat(chunks);check(bytes.length===file.bytes&&hash(bytes)===file.sha256,'PACKAGE_SOURCE_CORRUPT');files.set(file.path,bytes);return bytes;
    }
    do {
      const index=await call('godotProject.index',{context:bound.context,worldId:args.worldId,offset,limit:32,...(identity?{revision:identity.revision,manifestHash:identity.manifestHash}:args.revision!==undefined?{revision:args.revision,manifestHash:args.manifestHash}:{})});
      identity??=index;check(index.worldId===args.worldId&&index.revision===identity.revision&&index.manifestHash===identity.manifestHash,'PACKAGE_SOURCE_CHANGED');
      for(const file of index.files) {
        descriptors.set(file.path,file);total+=file.bytes;check(total<=64*1024*1024,'PACKAGE_SOURCE_CORRUPT');
        // Listing identities needs scenes and scripts, not every model/texture.
        // Binary and ancillary export dependencies are loaded lazily from the
        // same pinned index. Unrelated world assets never cross the IPC bridge.
        if(file.path!=='project.godot'&&!/\.(gd|tscn)$/.test(file.path)&&(listing||!['craftmine.instances.json','craftmine.assets.lock.json'].includes(file.path)))continue;
        await loadFile(file.path);
      }offset=index.nextOffset;
    }while(offset!==null&&offset!==undefined);
    const mainScene=/run\/main_scene\s*=\s*"res:\/\/([^"]+)"/.exec(files.get('project.godot')?.toString('utf8')??'')?.[1];check(mainScene&&files.has(mainScene),'PACKAGE_MAIN_SCENE_REQUIRED');
    return {identity,files,mainScene,bound,loadFile,hasSourceFile:name=>descriptors.has(name)};
  }
  async function recoverDeclaration(args,files,mainScene,node,loadFile){
    if(!recoverCatalogDeclaration||!files.has('craftmine.instances.json'))return;
    let map;try{map=JSON.parse(files.get('craftmine.instances.json').toString('utf8'));}catch{return;}
    if(map.worldId!==args.worldId||!Array.isArray(map.instances))return;
    const matches=map.instances.filter(instance=>Object.values(instance.entityMap??{}).some(id=>['entity_id','target_id'].some(field=>literal(node.properties[field])===id)));
    if(matches.length!==1)return;const instance=matches[0];if(instance.sourceDeclaration?.status==='source-declared')return;
    // Older installers omitted the manifest. Recover only from a measured
    // catalog archive and the exact lock identity; never guess requirements.
    let record;try{record=await call('asset.read',{assetId:instance.assetId,version:instance.version});}catch(error){if([error.code,error.errorCode,error.message].includes('ASSET_NOT_FOUND'))fail('PACKAGE_COMPONENT_CATALOG_SOURCE_REQUIRED');throw error;}
    const version=record.version_,file=version?.files?.[0];check(version?.assetId===instance.assetId&&version.version===instance.version&&version.files.length===1&&file.mediaType==='application/x-godot-package'&&file.bytes<=5*1024*1024,'PACKAGE_COMPONENT_CATALOG_SOURCE_REQUIRED');
    const body=await call('asset.bodyPath',{assetId:instance.assetId,version:instance.version,path:file.path});
    check(body.sha256===file.sha256&&body.bytes===file.bytes&&path.isAbsolute(body.blobPath),'PACKAGE_COMPONENT_CATALOG_SOURCE_REQUIRED');
    const stat=await fs.lstat(body.blobPath);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===file.bytes,'PACKAGE_COMPONENT_CATALOG_SOURCE_REQUIRED');
    const bytes=await fs.readFile(body.blobPath);check(bytes.length===file.bytes&&hash(bytes)===file.sha256,'PACKAGE_COMPONENT_CATALOG_SOURCE_REQUIRED');
    const {unpackStaticPackage}=await import('./package-zip.mjs'),archive=unpackStaticPackage(bytes);
    const resource=archive.resources.find(item=>item.manifest.content.assetId===instance.assetId&&item.manifest.content.version===instance.version&&item.manifest.contentHash===instance.contentHash)?.manifest;
    check(resource,'PACKAGE_COMPONENT_CATALOG_SOURCE_REQUIRED');const spec=resource.content.entry.sceneInstall;check(spec,'PACKAGE_COMPONENT_CATALOG_SOURCE_REQUIRED');
    for(const file of resource.content.files)await loadFile(instance.installPath+'/'+file.path);
    const managedFiles=resource.content.files.map(file=>{const target=instance.installPath+'/'+file.path,bytes=files.get(target);check(bytes,'PACKAGE_DECLARATION_INSTALLED_SOURCE_CHANGED');return {path:target,bytes,sha256:hash(bytes)};});
    instance.sourceDeclaration=createInstanceSourceDeclaration({resource,instance,managedFiles,sceneEdit:{scene:mainScene,nodeName:node.name,parent:node.parent,mode:spec.mode,extResource:{path:instance.installPath+'/'+(spec.mode==='instance'?spec.sceneFile:spec.script)},identity:{field:spec.identityField}}});
    // This is read-only export memory. The original source and instance map are
    // untouched; the normal declaration resolver checks lock/wrapper/file pins.
    files.set('craftmine.instances.json',Buffer.from(JSON.stringify(map)));
  }
  return {
    async listSource(args) {
      fields(args,['worldId']);const {identity,files,mainScene}=await read(args,{listing:true}),classes=classIndex(files),items=[];
      let truncated=false;
      for(const node of parseScene(files.get(mainScene).toString('utf8')).nodes) {
        if(node.parent===null)continue;const entity=identityFor(files,mainScene,node,classes);if(!entity)continue;
        let supported=true,reason;try{extractSubtree(files.get(mainScene).toString('utf8'),nodePath(node));}catch(error){supported=false;reason=error.code;}
        if(items.length>=512){truncated=true;break;}items.push({nodePath:nodePath(node),name:node.name,entityId:entity.id,supported,...(reason?{reason}:{})});
      }
      return {worldId:args.worldId,revision:identity.revision,manifestHash:identity.manifestHash,mainScene,items,truncated};
    },
    async exportSource(args,{assertActive=()=>{}}={}) {
      const {packStaticPackage}=await import('./package-zip.mjs');
      fields(args,['worldId','revision','manifestHash','nodePath','assetId','version']);check(/^[a-z0-9][a-z0-9._-]{0,79}$/.test(args.assetId)&&Number.isSafeInteger(args.version)&&args.version>=1&&args.version<=100000&&Number.isSafeInteger(args.revision)&&/^[a-f0-9]{64}$/.test(args.manifestHash),'INVALID_PARAMS');
      const {identity,files,mainScene,bound,loadFile,hasSourceFile}=await read(args,{assertActive}),classes=classIndex(files);
      const node=parseScene(files.get(mainScene).toString('utf8')).nodes.find(node=>nodePath(node)===args.nodePath);check(node,'PACKAGE_COMPONENT_MISSING');
      const entity=identityFor(files,mainScene,node,classes);check(entity,'PACKAGE_COMPONENT_IDENTITY_REQUIRED');
      await recoverDeclaration(args,files,mainScene,node,loadFile);
      // The declaration resolver measures every original payload file, even
      // sidecars omitted from the selected subtree's dependency closure.
      if(files.has('craftmine.instances.json')){
        let map;try{map=JSON.parse(files.get('craftmine.instances.json').toString('utf8'));}catch{}
        for(const instance of map?.instances??[])if(Object.values(instance.entityMap??{}).some(id=>['entity_id','target_id'].some(field=>literal(node.properties[field])===id)))for(const item of instance.sourceDeclaration?.managedFiles??[])await loadFile(item.path);
      }
      const parameterDeclaration=resolveInstanceParameterDeclaration({worldId:args.worldId,files,mainScene,nodePath:args.nodePath});
      check(!files.has('_craftmine_component.tscn'),'PACKAGE_RESERVED_PATH');
      const component=extractSubtree(files.get(mainScene).toString('utf8'),args.nodePath),payload=new Map([['_craftmine_component.tscn',Buffer.from(component)]]),required=new Map(),queue=refs(component);
      const original=parameterDeclaration.resourceDeclaration?.resource?.content;
      // Runtime integration (player controller / persistence bridge) may have no
      // static res:// reference from a component. Preserve only exact measured
      // requirements from its hash-validated installation declaration.
      if(original){
        const requirements=[...(original.entry.sourceRequirements??[])];
        if(original.entry.sourceRequirementProfiles){
          const profile=original.entry.sourceRequirementProfiles.find(candidate=>candidate.requirements.every(item=>files.has(item.path)&&hash(files.get(item.path))===item.sha256));
          check(profile,'PACKAGE_BASE_PROFILE_MISMATCH');requirements.push(...profile.requirements);
        }
        for(const item of requirements){check(files.has(item.path)&&hash(files.get(item.path))===item.sha256,'PACKAGE_BASE_SOURCE_MISMATCH');required.set(item.path,item);}
        // Include referenced package attribution sidecars without inventing a
        // new license grant. Their original bytes are already hash-validated.
        for(const item of original.files)if(/(?:^|\/)(?:LICENSE[^/]*|provenance\.json)$/i.test(item.path))queue.push(parameterDeclaration.resourceDeclaration.installPath+'/'+item.path);
      }
      while(queue.length) {const name=queue.shift();if(payload.has(name))continue;check(name!=='project.godot'&&name!==mainScene,'PACKAGE_WORLD_DEPENDENCY_REFUSED');const bytes=await loadFile(name);payload.set(name,bytes);if(texts.test(name)||name.toLowerCase().endsWith('.glb'))queue.push(...dependencies(name,name.toLowerCase().endsWith('.glb')?bytes:bytes.toString('utf8')));if(name.endsWith('.glb')&&hasSourceFile(name+'.import'))queue.push(name+'.import');check(payload.size<=256,'PACKAGE_COMPONENT_TOO_LARGE');}
      // Named base classes remain exact, externally required source files. This
      // avoids copying another Interactable global class into a receiving base.
      const globalQueue=[];
      for(const [name,bytes]of payload)if(/^scripts\/(core|base)\/.+\.gd$/.test(name)&&/^\s*class_name\s+\w+/m.test(bytes.toString('utf8'))){payload.delete(name);globalQueue.push(name);}
      for(const [name,bytes]of payload)if(name.endsWith('.gd')) {const body=bytes.toString('utf8'),own=/^\s*class_name\s+(\w+)/m.exec(body)?.[1];for(const [className,classPath]of classes)if(className!==own&&new RegExp('\\b'+className+'\\b').test(body)&&!payload.has(classPath))globalQueue.push(classPath);}
      // A namespaced payload copy cannot satisfy an unchanged shared base's
      // original res:// path. Keep both records for dual-use dependencies.
      while(globalQueue.length) {const name=globalQueue.shift();if(required.has(name))continue;const bytes=await loadFile(name);required.set(name,{path:name,sha256:hash(bytes)});if(name.toLowerCase().endsWith('.glb')){globalQueue.push(...dependencies(name,bytes));if(hasSourceFile(name+'.import'))globalQueue.push(name+'.import');}else if(texts.test(name)){const body=bytes.toString('utf8');globalQueue.push(...dependencies(name,body));for(const [className,classPath]of classes)if(new RegExp('\\b'+className+'\\b').test(body)&&classPath!==name)globalQueue.push(classPath);}check(required.size<=256,'PACKAGE_COMPONENT_TOO_LARGE');}
      const relocated=payloadPaths(payload),rewritten={},inputActions=new Set();let total=0;
      for(const [name,bytes]of payload) {
        let output=bytes;
        if(texts.test(name)) {let body=bytes.toString('utf8');body=body.replace(/res:\/\/([^"'\s)]+)/g,(full,ref)=>payload.has(ref)?'res://addons/'+args.assetId+'/'+relocated.get(ref):full).replace(/ uid="uid:\/\/[^"]+"/g,'');for(const match of body.matchAll(/Input\.(?:is_action_\w+|get_action_strength)\("([^"]+)"/g))inputActions.add(match[1]);output=Buffer.from(body);}
        total+=output.length;check(output.length<=4*1024*1024&&total<=4*1024*1024,'PACKAGE_COMPONENT_TOO_LARGE');rewritten[relocated.get(name)]=output;
      }
      for(const name of Object.keys(rewritten))if(name.endsWith('.gd')) {
        // A short leading-b hexadecimal UID stays within Godot's positive ID
        // range and is deterministic for this installed asset/path namespace.
        const uid=Buffer.from('uid://b'+hash(args.assetId+'/'+name).slice(0,11)+'\n');rewritten[name+'.uid']=uid;total+=uid.length;
      }
      check(total<=4*1024*1024,'PACKAGE_COMPONENT_TOO_LARGE');
      // Preserve only explicit scene attribution references, never infer rights
      // from an image, a filename or unreferenced sidecars. The declaration is
      // source-authored data; hashing its bytes does not verify a legal claim.
      const sourceDeclarations=new Map();
      for(const [name,bytes]of payload)if(name.endsWith('.tscn'))for(const candidate of parseScene(bytes.toString('utf8')).nodes){
        const value=candidate.properties['metadata/craftmine_attribution'];if(value===undefined)continue;
        const ref=literal(value);check(ref?.startsWith('res://'),'PACKAGE_ATTRIBUTION_REFERENCE_INVALID');const declarationPath=ref.slice(6),original=payload.get(declarationPath);
        check(original&&original.length<=65536,'PACKAGE_ATTRIBUTION_MISSING');let declaration;try{declaration=JSON.parse(original.toString('utf8'));}catch{fail('PACKAGE_ATTRIBUTION_INVALID');}
        check(declaration?.format==='craftmine.resource-attribution/1'&&declaration.licenses&&typeof declaration.licenses==='object'&&!Array.isArray(declaration.licenses),'PACKAGE_ATTRIBUTION_INVALID');
        const relocatedPath=relocated.get(declarationPath);sourceDeclarations.set(relocatedPath,{path:relocatedPath,sha256:hash(rewritten[relocatedPath]),status:'source-declared'});
      }
      const licenses=sourceDeclarations.size?{sourceDeclarations:[...sourceDeclarations.values()]}:{};
      const content={assetId:args.assetId,version:args.version,kind:'object',files:Object.entries(rewritten).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),dependencies:[],entry:{entities:[entity.id],sceneInstall:{mode:'instance',sceneFile:'_craftmine_component.tscn',identityField:entity.field,identityType:entity.type,inputActions:[...inputActions]},sourceRequirements:[...required.values()],...(original?{sourceLineage:{resourceRef:parameterDeclaration.resourceRef,licenseStatus:'source-declared',licenses:original.licenses},...(original.entry.capabilities?{capabilities:original.entry.capabilities}:{})}:{})},interfaces:parameterDeclaration.status==='source-declared'?{parameters:parameterDeclaration.parameters}:{},compatibility:{base:identity.baseId,...(bound.worldRecord.world.snapshot?.baseVersion?{baseVersion:bound.worldRecord.world.snapshot.baseVersion}:{}),engine:identity.engineVersion},state:original?.state??{},licenses};
      const archive=packStaticPackage({root:{id:args.assetId,version:args.version},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files:rewritten}]});check(archive.length<=5*1024*1024,'PACKAGE_COMPONENT_TOO_LARGE');
      return {archiveBase64:archive.toString('base64'),archiveSha256:hash(archive),files:Object.keys(rewritten).length,bytes:archive.length,source:{worldId:args.worldId,revision:identity.revision,manifestHash:identity.manifestHash,mainScene,nodePath:args.nodePath},parameterDeclaration,requiredSourceFiles:required.size};
    },
  };
}
