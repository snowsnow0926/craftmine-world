// Pure, bounded source interpretation for two audited static module wrappers.
// The caller supplies a Core-pinned index, exact text bytes and fresh live refs.
// No file IO, script execution, configure call, source write, or authorization.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseScene} from '../../desktop/godot/shared/scene_materializer.mjs';
import {validateAssetLock,assetLockHash} from './asset-lock.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,detail={})=>{throw Object.assign(Error(code),{code,errorCode:code,...detail});};
const need=(condition,code)=>{if(!condition)fail(code);};
const prefix='MODULE_PARAMETERS_';
const safePath=value=>typeof value==='string'&&value.length>0&&value.length<=240&&!/[\\:\x00-\x1f\x7f]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const objectId=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value);
const known={
 'kenney-city-building':{kind:'building',resourceHash:'0ae7883b4548e9ec46e7219696f8dc40875322b2d36bd5a3ece9238b3731e598',scriptHash:'e2341b41e564ddd2b573039aa82f9dbdc9d4637ad4c7e004d527216f3bece4b5',sceneHash:'cb3ed0aa6602a50b0f63f8a2ec357a0d460ec3d114172415692030b8b671244f'},
 'kenney-city-road':{kind:'road',resourceHash:'f1e90f5d5ba7b749555933a7d1672944c9999e0c0df38f6428e00b249fce7a79',scriptHash:'12a73befca09b843f02d732b186a27715b07d67cdc39c4bac3f23386c4f5cd7a',sceneHash:'379f322035574519600cd6c1607504765ec568568ce3f8ac4d04faff8785658a'},
};
const keys=['model_scale_percent','quarter_turns','solid','label'];
const descriptors={
 model_scale_percent:{type:'integer',minimum:25,maximum:800,unit:'percent',scope:'instance-visual-and-collision'},
 quarter_turns:{type:'integer',minimum:0,maximum:3,unit:'quarter-turn',scope:'instance-visual-and-collision'},
 solid:{type:'boolean',scope:'instance-collision'},
 label:{type:'string',maxLength:80,scope:'instance-metadata',visibleRename:false},
};
function indexOf(source){
 const manifest=source?.manifestFiles instanceof Map?[...source.manifestFiles.values()]:source?.manifestFiles;
 need(plain(source)&&safeId(source.worldId)&&Number.isSafeInteger(source.revision)&&source.revision>=0&&digest(source.manifestHash)&&source.files instanceof Map&&Array.isArray(manifest)&&manifest.length<=512,prefix+'SOURCE_REQUIRED');
 if(source.manifestFiles instanceof Map)for(const [key,file]of source.manifestFiles)need(key===file?.path,prefix+'SOURCE_INDEX_INVALID');
 const files=new Map(),folded=new Set();
 for(const file of manifest){
  need(plain(file)&&safePath(file.path)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&digest(file.sha256)&&!files.has(file.path)&&!folded.has(file.path.toLowerCase()),prefix+'SOURCE_INDEX_INVALID');
  files.set(file.path,{path:file.path,bytes:file.bytes,sha256:file.sha256});folded.add(file.path.toLowerCase());
 }
 return files;
}
function reader(source,index,readFiles){
 return name=>{
  need(safePath(name)&&index.has(name),prefix+'SOURCE_DEPENDENCY_MISSING');
  if(!source.files.has(name))fail(prefix+'SOURCE_TEXT_REQUIRED',{requiredPaths:[name]});
  const bytes=source.files.get(name),entry=index.get(name);
  need(Buffer.isBuffer(bytes)&&bytes.length<=1024*1024&&bytes.length===entry.bytes&&hash(bytes)===entry.sha256,prefix+'SOURCE_BYTES_MISMATCH');
  const text=bytes.toString('utf8');
  need(!text.includes('\0')&&!text.includes('\ufeff')&&Buffer.from(text).equals(bytes),prefix+'SOURCE_TEXT_INVALID');
  readFiles.set(name,entry);return text;
 };
}
function ownerOf(capture){
 const target=capture?.sceneObjectTarget;
 need(target?.identityScope==='runtime-instance'&&target.sourceUse==='context-only'&&objectId(target.objectId)&&Array.isArray(target.ancestors)&&target.ancestors.length<=4,prefix+'SCENE_REFERENCE_REQUIRED');
 const references=[target,...target.ancestors],seen=new Set();
 for(const node of references){
  need(plain(node)&&objectId(node.objectId)&&!seen.has(node.objectId)&&safePath(node.nodePath)&&typeof node.nodeClass==='string'&&/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(node.nodeClass),prefix+'SCENE_REFERENCE_REQUIRED');seen.add(node.objectId);
  for(const key of ['scriptPath','scenePath'])need(node[key]==null||node[key]===''||typeof node[key]==='string'&&node[key].startsWith('res://')&&safePath(node[key].slice(6)),prefix+'SCENE_REFERENCE_REQUIRED');
 }
 const owners=references.filter(node=>node.nodeClass==='StaticBody3D'&&Object.keys(known).some(id=>node.scriptPath==='res://addons/'+id+'/module.gd'&&node.scenePath==='res://addons/'+id+'/module.tscn'));
 need(owners.length===1,prefix+'WRAPPER_UNSUPPORTED');
 const owner=owners[0];need(objectId(owner.objectId)&&safePath(owner.nodePath),prefix+'SCENE_REFERENCE_REQUIRED');
 const assetId=Object.keys(known).find(id=>owner.scriptPath==='res://addons/'+id+'/module.gd');
 return {target,owner,assetId,installPath:'addons/'+assetId,profile:known[assetId]};
}
function mainScene(read){
 const project=read('project.godot');
 const paths=[...project.matchAll(/^run\/main_scene\s*=\s*"res:\/\/([^"\r\n]+)"\s*$/gm)];
 need(paths.length===1&&safePath(paths[0][1])&&paths[0][1].endsWith('.tscn'),prefix+'MAIN_SCENE_UNSUPPORTED');
 return paths[0][1];
}
/** Read project.godot first, then fetch only these six Core-indexed text files. */
export function requiredModuleParameterPaths({source,capture}){
 const index=indexOf(source),read=reader(source,index,new Map()),owner=ownerOf(capture);
 const paths=['project.godot',mainScene(read),'craftmine.instances.json','craftmine.assets.lock.json',owner.installPath+'/module.tscn',owner.installPath+'/module.gd'];
 for(const name of paths)need(index.has(name),prefix+'SOURCE_DEPENDENCY_MISSING');
 return [...new Set(paths)];
}
function liveIdentity(capture,live,now){
 need(capture?.format==='craftmine.creation-target/1'&&safeId(capture.worldId)&&typeof capture.snapshotId==='string'&&capture.snapshotId.length>0,prefix+'CAPTURE_REQUIRED');
 for(const key of ['worldId','buildId','instanceId'])need(typeof capture[key]==='string'&&capture[key].length>0&&live?.[key]===capture[key],prefix+'LIVE_IDENTITY_CHANGED');
 const age=now-Date.parse(live.sampledAt);
 need(Number.isFinite(now)&&Number.isFinite(age)&&age>=-5000&&age<=30000,prefix+'LIVE_SAMPLE_STALE');
 need(Array.isArray(live.sceneObjectRefs)&&live.sceneObjectRefs.length<=32,prefix+'LIVE_REFERENCE_REQUIRED');
 const target=capture.sceneObjectTarget,matches=live.sceneObjectRefs.filter(node=>node?.objectId===target?.objectId);
 need(matches.length===1,prefix+'LIVE_REFERENCE_CHANGED');
 const current=matches[0];need(Array.isArray(current.ancestors)&&current.ancestors.length===target.ancestors.length,prefix+'LIVE_REFERENCE_CHANGED');
 const before=[target,...target.ancestors],after=[current,...current.ancestors];
 for(let i=0;i<before.length;i++)for(const key of ['objectId','nodePath','nodeClass','scriptPath','scenePath']){
  const resource=key==='scriptPath'||key==='scenePath';
  const left=resource?(before[i]?.[key]||null):(before[i]?.[key]??null),right=resource?(after[i]?.[key]||null):(after[i]?.[key]??null);
  need(left===right,prefix+'LIVE_REFERENCE_CHANGED');
 }
}
function scene(text){
 need(/^\[gd_scene\b[^\r\n]*\bformat=3\]/.test(text),prefix+'SCENE_UNSUPPORTED');
 need(!/\r(?!\n)/.test(text)&&!(text.includes('\r\n')&&/(?<!\r)\n/.test(text)),prefix+'MIXED_NEWLINES_UNSUPPORTED');
 const parsed=parseScene(text),paths=new Set(),exts=new Map();
 need(parsed.nodes.length<=512&&(text.match(/^\[node\b/gm)??[]).length===parsed.nodes.length&&(text.match(/^\[ext_resource\b/gm)??[]).length===parsed.extResources.length,prefix+'SCENE_UNSUPPORTED');
 for(const ext of parsed.extResources){need(!exts.has(ext.id),prefix+'SCENE_AMBIGUOUS');exts.set(ext.id,ext);}
 const roots=parsed.nodes.filter(node=>node.parent===null);
 need(roots.length===1&&!/\binstance=/.test(roots[0].header),prefix+'INHERITED_SCENE_UNSUPPORTED');
 for(const node of parsed.nodes){
  node.nodePath=node.parent===null?'.':node.parent==='.'?node.name:node.parent+'/'+node.name;
  need(!paths.has(node.nodePath)&&node.duplicateProperties.length===0,prefix+'SCENE_AMBIGUOUS');paths.add(node.nodePath);
  for(const key of ['name','parent','type','instance'])need((node.header.match(new RegExp('(?:^|\\s)'+key+'=','g'))??[]).length<=1,prefix+'SCENE_AMBIGUOUS');
  need(!node.lines.some(line=>new RegExp('^[ \\t]+(?:entity_id|'+keys.join('|')+')[ \\t]*=').test(line)),prefix+'PROPERTY_EXPRESSION_UNSUPPORTED');
 }
 return {...parsed,exts};
}
function literalIdentity(value){
 const match=/^&?"([A-Za-z0-9][A-Za-z0-9._-]{0,127})"$/.exec(value??'');
 need(match,prefix+'EXPLICIT_ENTITY_ID_REQUIRED');return match[1];
}
function valueValid(key,value){
 if(key==='model_scale_percent')return Number.isInteger(value)&&value>=25&&value<=800;
 if(key==='quarter_turns')return Number.isInteger(value)&&value>=0&&value<=3;
 if(key==='solid')return typeof value==='boolean';
 return typeof value==='string'&&Array.from(value).length<=80&&!/[\x00-\x1f\x7f]/.test(value);
}
function literal(key,raw){
 if(key==='model_scale_percent'||key==='quarter_turns')need(/^(?:0|[1-9][0-9]*)$/.test(raw),prefix+'PROPERTY_EXPRESSION_UNSUPPORTED');
 let value;try{value=JSON.parse(raw);}catch{fail(prefix+'PROPERTY_EXPRESSION_UNSUPPORTED');}
 need(valueValid(key,value),prefix+'VALUE_INVALID');return value;
}
function effectiveValues(node,profile,scenePath,sceneHash,scriptPath,scriptHash){
 const defaults={model_scale_percent:100,quarter_turns:0,solid:true,label:profile.kind},values={},sources={};
 for(const key of keys){
  const explicit=Object.hasOwn(node.properties,key);
  values[key]=explicit?literal(key,node.properties[key]):defaults[key];
  sources[key]={kind:explicit?'instance-override':'audited-script-default',path:explicit?scenePath:scriptPath,sha256:explicit?sceneHash:scriptHash};
 }
 return {values,sources,defaults};
}
function resolve({source,capture,live,now=Date.now()}){
 const index=indexOf(source),readFiles=new Map(),read=reader(source,index,readFiles),selected=ownerOf(capture);
 liveIdentity(capture,live,now);
 need(source.worldId===capture.worldId&&source.revision===capture.sourceRevision&&source.manifestHash===capture.manifestHash,prefix+'SOURCE_PIN_CHANGED');
 const scenePath=mainScene(read),sceneText=read(scenePath),parsed=scene(sceneText);
 const matches=parsed.nodes.filter(node=>node.nodePath===selected.owner.nodePath);
 need(matches.length===1,prefix+'SOURCE_INSTANCE_NOT_FOUND');const node=matches[0];
 need(node.parent==='.'&&!Object.hasOwn(node.properties,'script'),prefix+'NESTED_OR_SCRIPT_OVERRIDE_UNSUPPORTED');
 const instance=/\binstance=(ExtResource\("([A-Za-z0-9_-]+)"\))/.exec(node.header);
 need(instance&&parsed.exts.get(instance[2])?.type==='PackedScene'&&parsed.exts.get(instance[2])?.path===selected.owner.scenePath,prefix+'PACKED_SCENE_MISMATCH');
 need(!parsed.nodes.some(other=>other!==node&&(other.parent===node.nodePath||other.parent?.startsWith(node.nodePath+'/'))),prefix+'CHILD_OVERRIDE_UNSUPPORTED');
 const allowed=new Set(['entity_id',...keys,'position','rotation','rotation_degrees','scale','transform']);
 need(Object.keys(node.properties).every(key=>allowed.has(key)),prefix+'INSTANCE_OVERRIDE_UNSUPPORTED');
 const entityId=literalIdentity(node.properties.entity_id),ids=new Set();
 for(const peer of parsed.nodes)if(Object.hasOwn(peer.properties,'entity_id')){const id=literalIdentity(peer.properties.entity_id);need(!ids.has(id),prefix+'DUPLICATE_ENTITY_ID');ids.add(id);}
 const scriptPath=selected.installPath+'/module.gd',moduleScene=selected.installPath+'/module.tscn';
 read(scriptPath);read(moduleScene);
 need(index.get(scriptPath).sha256===selected.profile.scriptHash&&index.get(moduleScene).sha256===selected.profile.sceneHash,prefix+'AUDITED_WRAPPER_CHANGED');
 let registry,lock;try{registry=JSON.parse(read('craftmine.instances.json'));lock=validateAssetLock(JSON.parse(read('craftmine.assets.lock.json')));}catch(error){if(error?.code?.startsWith(prefix))throw error;fail(prefix+'INSTALL_RECORD_INVALID');}
 const lockHash=assetLockHash(lock);
 need(registry?.format==='craftmine.godot-draft-instances/1'&&registry.worldId===source.worldId&&registry.assetLockHash===lockHash&&Array.isArray(registry.instances)&&registry.instances.length<=1024,prefix+'INSTALL_RECORD_INVALID');
 const registryIds=new Set(),instanceIds=new Set();let instanceRecord;
 for(const item of registry.instances){
  need(plain(item)&&safeId(item.instanceId)&&!instanceIds.has(item.instanceId)&&plain(item.entityMap)&&Object.keys(item.entityMap).length<=1024,prefix+'INSTALL_RECORD_INVALID');instanceIds.add(item.instanceId);
  for(const id of Object.values(item.entityMap)){
   need(safeId(id)&&!registryIds.has(id)&&registryIds.size<4096,prefix+'DUPLICATE_ENTITY_ID');registryIds.add(id);
   if(id===entityId){need(!instanceRecord,prefix+'DUPLICATE_ENTITY_ID');instanceRecord=item;}
  }
 }
 const resourceRef={assetId:selected.assetId,version:1,contentHash:selected.profile.resourceHash};
 need(instanceRecord&&instanceRecord.assetId===resourceRef.assetId&&instanceRecord.version===1&&instanceRecord.contentHash===resourceRef.contentHash&&instanceRecord.installPath===selected.installPath&&Object.keys(instanceRecord.entityMap).length===1&&instanceRecord.entityMap[selected.profile.kind]===entityId,prefix+'INSTANCE_BINDING_MISMATCH');
 need(Array.isArray(instanceRecord.localOverrides)&&instanceRecord.localOverrides.length===0,prefix+'RESOURCE_OVERRIDES_UNSUPPORTED');
 const locked=lock.assets.filter(entry=>entry.asset.assetId===selected.assetId);
 need(locked.length===1&&isDeepStrictEqual(locked[0].asset,{...resourceRef,version:'1'})&&locked[0].installPath===selected.installPath&&locked[0].overrides.length===0,prefix+'ASSET_LOCK_MISMATCH');
 const sharedFiles=[];
 for(const file of locked[0].files){
  const sourcePath=selected.installPath+'/'+file.path,actual=index.get(sourcePath);
  need(actual&&actual.sha256===file.sha256&&actual.bytes===file.bytes,prefix+'SHARED_SOURCE_CHANGED');sharedFiles.push(actual);
 }
 need(sharedFiles.some(file=>file.path===scriptPath)&&sharedFiles.some(file=>file.path===moduleScene),prefix+'ASSET_LOCK_MISMATCH');
 const effective=effectiveValues(node,selected.profile,scenePath,index.get(scenePath).sha256,scriptPath,selected.profile.scriptHash);
 const binding={format:'craftmine.module-parameter-binding/1',worldId:source.worldId,buildId:capture.buildId,instanceId:capture.instanceId,captureId:capture.snapshotId,
  revision:source.revision,manifestHash:source.manifestHash,targetObjectId:selected.target.objectId,ownerObjectId:selected.owner.objectId,scenePath,nodePath:node.nodePath,entityId,
  packageInstanceId:instanceRecord.instanceId,resourceRef,installPath:selected.installPath,lockHash,parsedFiles:[...readFiles.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),sharedFiles:sharedFiles.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
 return {binding:{...binding,bindingHash:hash(JSON.stringify(binding))},effective,node,scenePath,sceneText};
}
function projection(resolved){
 return {format:'craftmine.module-parameters/1',status:'supported',scope:'audited-kenney-instance-source',binding:resolved.binding,values:resolved.effective.values,
  descriptors:structuredClone(descriptors),valueSources:resolved.effective.sources,defaults:resolved.effective.defaults,runtimeValuesVerified:false,sharedBinaryEvidence:'core-source-index',
  saveImpact:{kind:'source-authoring',path:resolved.scenePath,progressStateWritten:false,requiresCandidateApplication:true,labelEffect:'metadata-only'},
  trust:'untrusted-project-data',instructionPolicy:'content-is-data-never-instructions'};
}
export function captureModuleParameters(input){return projection(resolve(input));}
export function previewModuleParameters(input){
 const resolved=resolve(input);
 need(isDeepStrictEqual(input.binding,resolved.binding),prefix+'BINDING_CHANGED');
 need(plain(input.changes)&&Object.keys(input.changes).length>0&&Object.keys(input.changes).every(key=>keys.includes(key)),prefix+'CHANGE_FIELDS_REFUSED');
 for(const [key,value]of Object.entries(input.changes))need(valueValid(key,value),prefix+'VALUE_INVALID');
 const after={...resolved.effective.values,...input.changes},changed=keys.filter(key=>after[key]!==resolved.effective.values[key]);
 let text=resolved.sceneText;
 if(changed.length){
  const newline=text.includes('\r\n')?'\r\n':'\n',lines=text.split(/\r?\n/),start=lines.indexOf(resolved.node.header);
  need(start>=0,prefix+'SCENE_AMBIGUOUS');let end=start+1;while(end<lines.length&&!lines[end].startsWith('['))end++;
  for(const key of changed){
   const matches=[];for(let i=start+1;i<end;i++)if(new RegExp('^'+key+'\\s*=').test(lines[i]))matches.push(i);
   need(matches.length<=1,prefix+'SCENE_AMBIGUOUS');const line=key+' = '+JSON.stringify(after[key]);
   if(matches.length)lines[matches[0]]=line;else{lines.splice(end,0,line);end++;}
  }
  text=lines.join(newline);
  const checkScene=scene(text),next=checkScene.nodes.find(node=>node.nodePath===resolved.node.nodePath);
  need(next&&literalIdentity(next.properties.entity_id)===resolved.binding.entityId,prefix+'PREVIEW_INVALID');
  for(const key of keys)need((Object.hasOwn(next.properties,key)?literal(key,next.properties[key]):resolved.effective.defaults[key])===after[key],prefix+'PREVIEW_INVALID');
 }
 return {...projection(resolved),format:'craftmine.module-parameter-preview/1',applied:false,changed:changed.length>0,checkRequired:changed.length>0,
  operations:changed.length?[{op:'put',path:resolved.scenePath,text,expectedHash:resolved.binding.parsedFiles.find(file=>file.path===resolved.scenePath).sha256}]:[],
  changeSummary:{scope:'single-source-instance',entityId:resolved.binding.entityId,nodePath:resolved.node.nodePath,changes:changed.map(key=>({property:key,before:resolved.effective.values[key],after:after[key]})),sharedResourcesModified:false,progressStateWritten:false},
  proposedValues:after};
}
