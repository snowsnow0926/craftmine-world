import {createHash} from 'node:crypto';
import {validateModule,MODULE_RUNTIME} from '../../app/memory.mjs';
import {captureCreation,creationGroups,creationDependencies,creationHasCapabilities,materializeCreation} from '../../app/creation.mjs';
import {compileScene,upgradeScene,withAppearanceFormat,canonicalJSON} from '../../app/scene.mjs';
import {SYSTEMS,exactKeys,identifier} from '../../app/gameplay.mjs';
import {objectContentBounds,sceneAssetReferences} from '../../app/asset-binding.mjs';
import {validatePackedAssets,moduleAssetsScene} from '../../app/asset-packages.mjs';
import {validateExtension,extensionRequirement} from '../../app/harness/extension.mjs';

const sha=value=>createHash('sha256').update(typeof value==='string'?value:canonicalJSON(value)).digest('hex');
const requireValue=(condition,code)=>{if(!condition)throw Error(code);};
const keys=(value,allowed)=>{requireValue(value&&typeof value==='object'&&!Array.isArray(value),'OBJECT_REQUIRED');requireValue(Object.keys(value).every(key=>allowed.includes(key)),'UNKNOWN_FIELD');};
const checkRef=ref=>{exactKeys(ref,['id','version','hash']);requireValue(identifier(ref.id)&&Number.isInteger(ref.version)&&ref.version>0&&ref.version<=100000&&/^[a-f0-9]{64}$/.test(ref.hash),'INVALID_MODULE_REFERENCE');};
function dependencyClosure(module,available){
  const selected=new Map(),pending=module.dependencies.filter(r=>r.startsWith('ext:'));
  while(pending.length){const ref=pending.pop();if(selected.has(ref))continue;const extension=available.find(e=>extensionRequirement(e.id,e.version)===ref);requireValue(extension,'MISSING_EXTENSION: '+ref);validateExtension(extension);selected.set(ref,structuredClone(extension));pending.push(...extension.requires);}
  return [...selected.values()].sort((a,b)=>extensionRequirement(a.id,a.version).localeCompare(extensionRequirement(b.id,b.version)));
}
function validateBundle(bundle){
  exactKeys(bundle,['format','module','assets','extensions']);requireValue(bundle.format==='craftmine.library-bundle/1','INVALID_LIBRARY_BUNDLE');
  const module=validateModule(bundle.module),assets=validatePackedAssets(moduleAssetsScene(module),bundle.assets);
  requireValue(Array.isArray(bundle.extensions)&&bundle.extensions.length<=32,'EXTENSION_LIMIT');
  const extensions=dependencyClosure(module,bundle.extensions);requireValue(extensions.length===bundle.extensions.length,'EXTRANEOUS_EXTENSION');
  return {format:bundle.format,module,assets,extensions};
}
function captureBundle(artifact,args,application){
  const scene=upgradeScene(artifact.build.scene);let payload,definition,kind=args.kind;
  if(kind==='creation'){
    const group=creationGroups(scene).find(g=>g.id===args.resourceId||g.behaviors.some(b=>b.id===args.resourceId));requireValue(group,'RESOURCE_NOT_FOUND');
    payload=captureCreation(group,scene);definition=group.behaviors[0];
  }else{
    requireValue(['object','gameplay'].includes(kind),'INVALID_MODULE_KIND');definition=scene[kind==='object'?'objects':'systems'].find(d=>d.id===args.resourceId);requireValue(definition,'RESOURCE_NOT_FOUND');
    payload=kind==='object'?{name:definition.name,parts:structuredClone(definition.parts),components:structuredClone(definition.components),...(definition.appearance?{appearance:structuredClone(definition.appearance)}:{})}:{name:definition.name,type:definition.type,config:structuredClone(definition.config)};
  }
  const assets=!!(payload.appearance||payload.objects?.some(o=>o.appearance)),capable=kind==='creation'&&creationHasCapabilities(payload);
  const module=validateModule({format:capable?'craftmine.module/4':assets?'craftmine.module/3':kind==='creation'?'craftmine.module/2':'craftmine.module/1',runtime:capable?'craftmine-web/5':assets?'craftmine-web/4':kind==='creation'?'craftmine-web/3':MODULE_RUNTIME,
    id:args.id??`saved-${sha(args.operationId).slice(0,32)}`,version:args.version??1,kind,hash:sha({kind,payload}),name:payload.name,description:args.description??'',
    dependencies:kind==='creation'?creationDependencies(payload):kind==='gameplay'?SYSTEMS[payload.type].dependencies:[...(payload.components.contactDamage>0?['geometry@2','health@1']:['geometry@2']),...(assets?['assets@1']:[])],payload,
    origin:{build:artifact.build.id,definition:definition.id,time:application.createdAt}});
  const refs=sceneAssetReferences(moduleAssetsScene(module));
  const packed=refs.map(ref=>{const asset=(artifact.build.assets||[]).find(a=>a.id===ref.id&&a.version===ref.version&&a.hash===ref.hash);requireValue(asset,'MISSING_FIXED_ASSET');return asset;});
  return {resourceId:definition.id,bundle:validateBundle({format:'craftmine.library-bundle/1',module,assets:packed,extensions:dependencyClosure(module,artifact.extensions||[])})};
}
function mergeFixed(existing,incoming,key){
  const result=structuredClone(existing);for(const item of incoming){const old=result.find(value=>key(value)===key(item));if(old){requireValue(canonicalJSON(old)===canonicalJSON(item),'FIXED_DEPENDENCY_CONFLICT: '+key(item));}else{result.push(structuredClone(item));}}return result;
}
function checkExtensions(extensions){
  const commands=new Map();for(const extension of extensions){validateExtension(extension);for(const command of extension.provides.commands){requireValue(!commands.has(command.type),'EXTENSION_COMMAND_CONFLICT: '+command.type);commands.set(command.type,extension.id);}for(const ref of extension.requires)requireValue(extensions.some(e=>extensionRequirement(e.id,e.version)===ref),'MISSING_EXTENSION: '+ref);}
}
export function createLibraryService({call}){
  requireValue(typeof call==='function','DOMAIN_CALL_REQUIRED');
  async function prepare(context,args,instanceSeed){
    keys(args,['ref','revision','position']);checkRef(args.ref);requireValue(Number.isSafeInteger(args.revision)&&args.revision>=0,'INVALID_REVISION');
    const workspace=await call('workspace.inspect',{context});requireValue(workspace.task.status==='running','TASK_INACTIVE');requireValue(workspace.task.revision===args.revision,'STALE_DRAFT');
    const record=await call('library.read',{ref:args.ref}),bundle=validateBundle(record.bundle),module=bundle.module;
    const world=await call('world.read',{id:workspace.worldId});requireValue(world.world.build.id===workspace.task.binding.baseBuild,'WORLD_BUILD_CONFLICT');
    const before=upgradeScene(workspace.task.draft.scene),next=structuredClone(before),source={id:module.id,version:module.version};
    const extensions=mergeFixed(workspace.task.draft.extensions??world.world.extensions,bundle.extensions,e=>e.id+'@'+e.version);checkExtensions(extensions);
    const availableAssets=mergeFixed(workspace.task.draft.assets??world.world.build.assets??[],bundle.assets,a=>a.id+'@'+a.version);
    const instanceId='reuse-'+sha(instanceSeed).slice(0,24);let generated,idMap={objects:{},behaviors:{},systems:{},sharedItems:{}};
    let position=args.position;if(position){exactKeys(position,['x','y','z']);requireValue(Object.values(position).every(n=>Number.isFinite(n)&&n>=-80&&n<=80),'INVALID_PLACEMENT');}
    if(!position){const player=world.world.snapshot.player;const ranges=(module.kind==='creation'?module.payload.objects:module.kind==='object'?[{...module.payload,position:{x:0,y:0,z:0}}]:[]).map(objectContentBounds);position={x:Math.max(-38,Math.min(38,player.x-Math.sin(player.yaw)*7)),y:6-Math.min(0,...ranges.map(b=>b.min.y)),z:Math.max(-38,Math.min(38,player.z-Math.cos(player.yaw)*7))};}
    if(module.kind==='creation'){
      generated=materializeCreation(module.payload,source,position,instanceId);next.format=before.format==='craftmine.scene/4'?before.format:'craftmine.scene/3';
      next.objects.push(...generated.objects);next.behaviors=[...(next.behaviors||[]),...generated.behaviors];
      module.payload.objects.forEach((o,i)=>{idMap.objects[o.key]=generated.objects[i].id;});module.payload.scripts.forEach((s,i)=>{idMap.behaviors[s.key]=generated.behaviors[i].id;});
      for(const system of generated.systems){const old=next.systems.find(s=>s.type===system.type);if(old){requireValue(canonicalJSON(old.config)===canonicalJSON(system.config),'SYSTEM_CONFIG_CONFLICT: '+system.type);idMap.systems[system.id]=old.id;}else{const id=instanceId+'-s'+Object.keys(idMap.systems).length;idMap.systems[system.id]=id;next.systems.push({...system,id});}}
    }else if(module.kind==='object'){
      const object={id:instanceId+'-o0',...structuredClone(module.payload),position,source};next.objects.push(object);idMap.objects[module.origin.definition]=object.id;
    }else{
      const old=next.systems.find(s=>s.type===module.payload.type);requireValue(!old,'SYSTEM_ALREADY_EXISTS: '+module.payload.type);const id=instanceId+'-s0';next.systems.push({id,...structuredClone(module.payload),source});idMap.systems[module.origin.definition]=id;
    }
    const scene=compileScene(withAppearanceFormat(next),{extensions:new Set(extensions.map(e=>extensionRequirement(e.id,e.version)))}).scene;
    const needed=sceneAssetReferences(scene),assets=validatePackedAssets(scene,needed.map(ref=>availableAssets.find(a=>a.id===ref.id&&a.version===ref.version&&a.hash===ref.hash)));
    const operations=[];for(const [kind,group]of Object.entries({object:'objects',behavior:'behaviors',system:'systems'})){for(const item of scene[group]||[]){if(!(before[group]||[]).some(old=>old.id===item.id))operations.push({op:'add',kind,id:item.id,expectedHash:null,value:item});}}
    const draft={...workspace.task.draft,scene,...(assets.length?{assets}:{}),...(extensions.length?{extensions}:{})};requireValue(Buffer.byteLength(JSON.stringify(draft))<=2000000,'DOCUMENT_TOO_LARGE: dependency package exceeds current draft limit');
    return {workspace,draft,operations,idMap,dependencies:{assets:bundle.assets.map(({id,version,hash})=>({id,version,hash})),extensions:bundle.extensions.map(e=>({id:e.id,version:e.version,hash:sha(e)})),sharedItems:'authored IDs remain shared'},conflicts:[],packageHash:record.packageHash,revision:workspace.task.revision};
  }
  return {
    search:args=>call('library.search',args),
    async read(args){keys(args,['ref','start','limit']);checkRef(args.ref);const record=await call('library.read',{ref:args.ref});validateBundle(record.bundle);const text=JSON.stringify(record.bundle.module,null,2),start=args.start??0,limit=args.limit??12000;requireValue(Number.isSafeInteger(start)&&start>=0&&start<=text.length&&Number.isSafeInteger(limit)&&limit>=1&&limit<=16000,'INVALID_PAGE');const end=Math.min(text.length,start+limit);return {...record.metadata,packageHash:record.packageHash,source:{text:text.slice(start,end),start,next:end<text.length?end:null,totalChars:text.length}};},
    async capture(args){keys(args,['operationId','applicationId','worldId','kind','resourceId','id','version','tags','scope','description']);requireValue(typeof args.operationId==='string'&&args.operationId.length>0&&args.operationId.length<=240,'OPERATION_ID_REQUIRED');
      const application=await call('application.read',{id:args.applicationId});requireValue(application.status==='applied'&&application.input.worldId===args.worldId,'APPLIED_SOURCE_REQUIRED');
      const check=await call('verification.read',{id:application.input.verificationId});requireValue(check.status==='passed'&&check.outputHash===application.input.verificationOutputHash,'APPLIED_EVIDENCE_MISMATCH');
      const captured=captureBundle(check.output.artifact,args,application);return call('library.capture',{operationId:args.operationId,applicationId:args.applicationId,worldId:args.worldId,kind:args.kind,resourceId:captured.resourceId,bundle:captured.bundle,scope:args.scope,tags:args.tags??[]});
    },
    async prepareInstall(context,args){const {workspace,draft,...projection}=await prepare(context,args,'preview-'+canonicalJSON(args));return projection;},
    async install(context,toolCallId,args){keys(args,['ref','revision','position']);const request={operation:'library.install',...args};const previous=await call('workspace.receipt',{context,toolCallId,request});if(previous)return {receipt:previous,replayed:true};const prepared=await prepare(context,args,toolCallId);const receipt=await call('workspace.commit',{context,binding:prepared.workspace.task.binding,toolCallId,revision:args.revision,request,draft:prepared.draft});return {receipt,ref:args.ref,packageHash:prepared.packageHash,idMap:prepared.idMap,dependencies:prepared.dependencies,applied:false};},
  };
}
