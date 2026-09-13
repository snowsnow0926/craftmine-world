// Source declarations are evidence about a pinned package, never edit authority.
import {createHash} from 'node:crypto';
import {validateResourceManifest} from './package-format.mjs';
import {validateAssetLock,assetLockHash} from './asset-lock.mjs';
import {parseScene} from '../../desktop/godot/shared/scene_materializer.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(value,code)=>{if(!value)throw Object.assign(Error(code),{code,errorCode:code});};
const literal=value=>/^&?"([^"\\]*)"$/.exec(value??'')?.[1];
const nodePath=node=>node.parent===null?'.':node.parent==='.'?node.name:node.parent+'/'+node.name;
const unknown=reason=>({status:'unknown',reason});
export const INSTANCE_DECLARATION_FORMAT='craftmine.instance-source-declaration/1';

export function createInstanceSourceDeclaration({resource,instance,managedFiles,sceneEdit}){
  if(!resource)return {format:INSTANCE_DECLARATION_FORMAT,...unknown('ORIGINAL_RESOURCE_MANIFEST_MISSING')};
  const manifest=validateResourceManifest(resource);
  check(manifest.content.assetId===instance.assetId&&manifest.content.version===instance.version&&manifest.contentHash===instance.contentHash,'DRAFT_DECLARATION_REF_MISMATCH');
  const bindings=manifest.content.files.map(file=>{
    const installed=managedFiles.find(candidate=>candidate.path===instance.installPath+'/'+file.path);
    // Today's installer relocates files without rewriting bytes. Measure its
    // output and verify that mapping, rather than accepting arbitrary new hashes.
    check(installed&&installed.sha256===file.sha256&&installed.bytes.length===file.bytes,'DRAFT_DECLARATION_TRANSFORM_UNSUPPORTED');
    return {sourcePath:file.path,path:installed.path,bytes:installed.bytes.length,sha256:installed.sha256};
  });
  return {format:INSTANCE_DECLARATION_FORMAT,status:'source-declared',resource:structuredClone(manifest),managedFiles:bindings,
    scene:sceneEdit?{path:sceneEdit.scene,nodePath:sceneEdit.parent==='.'?sceneEdit.nodeName:sceneEdit.parent+'/'+sceneEdit.nodeName,
      mode:sceneEdit.mode,resourcePath:sceneEdit.extResource.path,identityField:sceneEdit.identity.field}:null};
}

export function resolveInstanceParameterDeclaration({worldId,files,mainScene,nodePath:wanted}){
  const bytes=files.get('craftmine.instances.json');if(!bytes)return unknown('INSTANCE_METADATA_MISSING');
  let map;try{map=JSON.parse(bytes.toString('utf8'));}catch{check(false,'PACKAGE_INSTANCE_METADATA_INVALID');}
  check(map?.format==='craftmine.godot-draft-instances/1'&&map.worldId===worldId&&Array.isArray(map.instances)&&map.instances.every(instance=>instance&&typeof instance==='object'&&!Array.isArray(instance)&&instance.entityMap&&typeof instance.entityMap==='object'&&!Array.isArray(instance.entityMap)),'PACKAGE_INSTANCE_METADATA_INVALID');
  const parsed=parseScene(files.get(mainScene)?.toString('utf8')??'');
  const nodes=parsed.nodes.filter(node=>nodePath(node)===wanted);check(nodes.length===1,'PACKAGE_DECLARATION_NODE_AMBIGUOUS');
  const node=nodes[0];
  const matches=map.instances.filter(instance=>Object.values(instance.entityMap??{}).some(id=>
    [instance.sourceDeclaration?.scene?.identityField,'entity_id','target_id'].filter(Boolean).some(field=>literal(node.properties[field])===id)));
  if(!matches.length)return unknown('INSTANCE_DECLARATION_NOT_FOUND');
  check(matches.length===1,'PACKAGE_DECLARATION_INSTANCE_AMBIGUOUS');
  const instance=matches[0],declaration=instance.sourceDeclaration;
  if(!declaration)return unknown('ORIGINAL_RESOURCE_MANIFEST_MISSING');
  check(declaration.format===INSTANCE_DECLARATION_FORMAT,'PACKAGE_DECLARATION_INVALID');
  if(declaration.status==='unknown'&&!declaration.resource)return unknown('ORIGINAL_RESOURCE_MANIFEST_MISSING');
  check(declaration.status==='source-declared','PACKAGE_DECLARATION_INVALID');
  let resource;try{resource=validateResourceManifest(declaration.resource);}catch{check(false,'PACKAGE_DECLARATION_RESOURCE_HASH_MISMATCH');}
  check(resource.content.assetId===instance.assetId&&resource.content.version===instance.version&&resource.contentHash===instance.contentHash,'PACKAGE_DECLARATION_REF_MISMATCH');
  let lock;try{lock=validateAssetLock(JSON.parse(files.get('craftmine.assets.lock.json')?.toString('utf8')??''));}catch{check(false,'PACKAGE_DECLARATION_LOCK_INVALID');}
  check(assetLockHash(lock)===map.assetLockHash,'PACKAGE_DECLARATION_LOCK_HASH_MISMATCH');
  const entry=lock.assets.find(value=>value.asset.assetId===instance.assetId&&value.asset.version===String(instance.version));
  check(entry&&entry.asset.contentHash===instance.contentHash&&entry.installPath===instance.installPath,'PACKAGE_DECLARATION_LOCK_REF_MISMATCH');
  check(Array.isArray(declaration.managedFiles)&&declaration.managedFiles.length===resource.content.files.length,'PACKAGE_DECLARATION_FILES_INVALID');
  for(const file of resource.content.files){
    const expectedPath=entry.installPath+'/'+file.path,bindings=declaration.managedFiles.filter(value=>value.sourcePath===file.path);
    check(bindings.length===1,'PACKAGE_DECLARATION_FILES_INVALID');const binding=bindings[0],locked=entry.files.find(value=>value.path===file.path);
    check(binding.path===expectedPath&&binding.sha256===file.sha256&&binding.bytes===file.bytes&&locked?.sha256===file.sha256&&locked?.bytes===file.bytes,'PACKAGE_DECLARATION_FILE_BINDING_MISMATCH');
    const current=files.get(expectedPath);check(current&&current.length===binding.bytes&&hash(current)===binding.sha256,'PACKAGE_DECLARATION_INSTALLED_SOURCE_CHANGED');
  }
  for(const required of resource.content.entry.sourceRequirements??[]){const current=files.get(required.path);check(current&&hash(current)===required.sha256,'PACKAGE_DECLARATION_REQUIRED_SOURCE_CHANGED');}
  const scene=declaration.scene,spec=resource.content.entry.sceneInstall;
  check(scene&&spec&&scene.path===mainScene&&scene.nodePath===wanted&&scene.mode===spec.mode&&scene.identityField===spec.identityField,'PACKAGE_DECLARATION_SCENE_BINDING_MISMATCH');
  const entityId=literal(node.properties[spec.identityField]);
  check(entityId&&Object.values(instance.entityMap).includes(entityId)&&parsed.nodes.filter(value=>literal(value.properties[spec.identityField])===entityId).length===1,'PACKAGE_DECLARATION_ENTITY_AMBIGUOUS');
  const expectedPath=entry.installPath+'/'+(spec.mode==='instance'?spec.sceneFile:spec.script);
  const resourceId=spec.mode==='instance'?/instance=ExtResource\("([^"]+)"\)/.exec(node.header)?.[1]:/^ExtResource\("([^"]+)"\)$/.exec(node.properties.script??'')?.[1];
  const reference=parsed.extResources.find(value=>value.id===resourceId);
  check(scene.resourcePath===expectedPath&&reference?.path==='res://'+expectedPath&&reference.type===(spec.mode==='instance'?'PackedScene':'Script')&&(spec.mode!=='instance'||node.properties.script===undefined)&&(spec.mode!=='script-node'||node.type===(spec.nodeType||'Node2D')),'PACKAGE_DECLARATION_WRAPPER_CHANGED');
  const parameters=resource.content.interfaces.parameters;
  // Export may preserve measured source requirements and attribution even when
  // a component declares no editable parameters. This is still source evidence.
  const resourceDeclaration={resource:structuredClone(resource),installPath:instance.installPath};
  if(parameters===undefined)return {...unknown('PARAMETERS_NOT_DECLARED'),resourceRef:{assetId:instance.assetId,version:instance.version,contentHash:instance.contentHash},resourceDeclaration};
  check(parameters&&typeof parameters==='object'&&!Array.isArray(parameters),'PACKAGE_PARAMETER_DECLARATION_INVALID');
  return {status:'source-declared',parameters:structuredClone(parameters),resourceRef:{assetId:instance.assetId,version:instance.version,contentHash:instance.contentHash},instanceId:instance.instanceId,resourceDeclaration,
    sourceBinding:{worldId,mainScene,nodePath:wanted,entityId,resourcePath:expectedPath},note:'Original CP0 parameter declarations match the installed source; no setter, permission or runtime behavior is inferred.'};
}
