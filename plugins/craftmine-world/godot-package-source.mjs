// Read-only managed-source component extraction. Never executes authored code.
import {createHash} from 'node:crypto';
import {parseScene} from '../../desktop/godot/shared/scene_materializer.mjs';
import {contentHash} from './package-format.mjs';
import path from 'node:path';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,errorCode:code});};
const check=(yes,code)=>{if(!yes)fail(code);};
const fields=(input,keys)=>check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(key=>keys.includes(key)),'INVALID_PARAMS');
const texts=/\.(gd|tscn|tres|json|svg|obj|mtl)$/;
const literal=value=>/^&?"([^"\\]*)"$/.exec(value??'')?.[1];
const refs=value=>[...value.matchAll(/res:\/\/([^"'\s)]+)/g)].map(match=>match[1]);
function dependencies(name,body) {
  const result=refs(body);
  if(name.endsWith('.obj'))for(const match of body.matchAll(/^mtllib\s+([^\r\n]+)$/gm))result.push(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1].trim())));
  if(name.endsWith('.mtl'))for(const match of body.matchAll(/^map_\w+\s+([^\r\n]+)$/gm)){check(!match[1].startsWith('-'),'PACKAGE_MATERIAL_OPTIONS_UNSUPPORTED');result.push(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1].trim())));}
  return result;
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
export function createManagedPackageSourceService({call,bind}) {
  check(typeof call==='function'&&typeof bind==='function','PACKAGE_SOURCE_HOST_REQUIRED');
  async function read(args) {
    const bound=await bind(args.worldId);check(bound?.worldRecord?.id===args.worldId&&bound.context,'PACKAGE_BINDING_MISMATCH');
    const files=new Map();let offset=0,identity,total=0;
    do {
      const index=await call('godotProject.index',{context:bound.context,worldId:args.worldId,offset,limit:32,...(identity?{revision:identity.revision,manifestHash:identity.manifestHash}:args.revision!==undefined?{revision:args.revision,manifestHash:args.manifestHash}:{})});
      identity??=index;check(index.worldId===args.worldId&&index.revision===identity.revision&&index.manifestHash===identity.manifestHash,'PACKAGE_SOURCE_CHANGED');
      for(const file of index.files) {
        let next=0;const chunks=[];
        do {const part=await call('godotProject.read',{context:bound.context,worldId:args.worldId,revision:identity.revision,manifestHash:identity.manifestHash,path:file.path,offset:next,limit:16000});check(part.sha256===file.sha256,'PACKAGE_SOURCE_CHANGED');chunks.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text,'utf8'));next=part.nextOffset;}while(next!==null&&next!==undefined);
        const bytes=Buffer.concat(chunks);total+=bytes.length;check(total<=64*1024*1024&&bytes.length===file.bytes&&hash(bytes)===file.sha256,'PACKAGE_SOURCE_CORRUPT');files.set(file.path,bytes);
      }offset=index.nextOffset;
    }while(offset!==null&&offset!==undefined);
    const mainScene=/run\/main_scene\s*=\s*"res:\/\/([^"]+)"/.exec(files.get('project.godot')?.toString('utf8')??'')?.[1];check(mainScene&&files.has(mainScene),'PACKAGE_MAIN_SCENE_REQUIRED');
    return {identity,files,mainScene,bound};
  }
  return {
    async listSource(args) {
      fields(args,['worldId']);const {identity,files,mainScene}=await read(args),classes=classIndex(files),items=[];
      let truncated=false;
      for(const node of parseScene(files.get(mainScene).toString('utf8')).nodes) {
        if(node.parent===null)continue;const entity=identityFor(files,mainScene,node,classes);if(!entity)continue;
        let supported=true,reason;try{extractSubtree(files.get(mainScene).toString('utf8'),nodePath(node));}catch(error){supported=false;reason=error.code;}
        if(items.length>=512){truncated=true;break;}items.push({nodePath:nodePath(node),name:node.name,entityId:entity.id,supported,...(reason?{reason}:{})});
      }
      return {worldId:args.worldId,revision:identity.revision,manifestHash:identity.manifestHash,mainScene,items,truncated};
    },
    async exportSource(args) {
      const {packStaticPackage}=await import('./package-zip.mjs');
      fields(args,['worldId','revision','manifestHash','nodePath','assetId','version']);check(/^[a-z0-9][a-z0-9._-]{0,79}$/.test(args.assetId)&&Number.isSafeInteger(args.version)&&args.version>=1&&args.version<=100000&&Number.isSafeInteger(args.revision)&&/^[a-f0-9]{64}$/.test(args.manifestHash),'INVALID_PARAMS');
      const {identity,files,mainScene,bound}=await read(args),classes=classIndex(files);
      const node=parseScene(files.get(mainScene).toString('utf8')).nodes.find(node=>nodePath(node)===args.nodePath);check(node,'PACKAGE_COMPONENT_MISSING');
      const entity=identityFor(files,mainScene,node,classes);check(entity,'PACKAGE_COMPONENT_IDENTITY_REQUIRED');
      check(!files.has('_craftmine_component.tscn'),'PACKAGE_RESERVED_PATH');
      const component=extractSubtree(files.get(mainScene).toString('utf8'),args.nodePath),payload=new Map([['_craftmine_component.tscn',Buffer.from(component)]]),required=new Map(),queue=refs(component);
      while(queue.length) {const name=queue.shift();if(payload.has(name))continue;check(name!=='project.godot'&&name!==mainScene,'PACKAGE_WORLD_DEPENDENCY_REFUSED');const bytes=files.get(name);check(bytes,'PACKAGE_SOURCE_DEPENDENCY_MISSING');payload.set(name,bytes);if(texts.test(name))queue.push(...dependencies(name,bytes.toString('utf8')));check(payload.size<=256,'PACKAGE_COMPONENT_TOO_LARGE');}
      // Named base classes remain exact, externally required source files. This
      // avoids copying another Interactable global class into a receiving base.
      const globalQueue=[];
      for(const [name,bytes]of payload)if(/^scripts\/(core|base)\/.+\.gd$/.test(name)&&/^\s*class_name\s+\w+/m.test(bytes.toString('utf8'))){payload.delete(name);globalQueue.push(name);}
      for(const [name,bytes]of payload)if(name.endsWith('.gd')) {const body=bytes.toString('utf8'),own=/^\s*class_name\s+(\w+)/m.exec(body)?.[1];for(const [className,classPath]of classes)if(className!==own&&new RegExp('\\b'+className+'\\b').test(body)&&!payload.has(classPath))globalQueue.push(classPath);}
      while(globalQueue.length) {const name=globalQueue.shift();if(required.has(name)||payload.has(name))continue;const bytes=files.get(name);check(bytes,'PACKAGE_SOURCE_DEPENDENCY_MISSING');required.set(name,{path:name,sha256:hash(bytes)});if(texts.test(name)){const body=bytes.toString('utf8');globalQueue.push(...dependencies(name,body));for(const [className,classPath]of classes)if(new RegExp('\\b'+className+'\\b').test(body)&&classPath!==name)globalQueue.push(classPath);}check(required.size<=256,'PACKAGE_COMPONENT_TOO_LARGE');}
      const rewritten={},inputActions=new Set();let total=0;
      for(const [name,bytes]of payload) {
        let output=bytes;
        if(texts.test(name)) {let body=bytes.toString('utf8');body=body.replace(/res:\/\/([^"'\s)]+)/g,(full,ref)=>payload.has(ref)?'res://addons/'+args.assetId+'/'+ref:full).replace(/ uid="uid:\/\/[^"]+"/g,'');for(const match of body.matchAll(/Input\.(?:is_action_\w+|get_action_strength)\("([^"]+)"/g))inputActions.add(match[1]);output=Buffer.from(body);}
        total+=output.length;check(output.length<=4*1024*1024&&total<=4*1024*1024,'PACKAGE_COMPONENT_TOO_LARGE');rewritten[name]=output;
      }
      for(const name of Object.keys(rewritten))if(name.endsWith('.gd')) {
        // A short leading-b hexadecimal UID stays within Godot's positive ID
        // range and is deterministic for this installed asset/path namespace.
        const uid=Buffer.from('uid://b'+hash(args.assetId+'/'+name).slice(0,11)+'\n');rewritten[name+'.uid']=uid;total+=uid.length;
      }
      check(total<=4*1024*1024,'PACKAGE_COMPONENT_TOO_LARGE');
      const content={assetId:args.assetId,version:args.version,kind:'object',files:Object.entries(rewritten).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),dependencies:[],entry:{entities:[entity.id],sceneInstall:{mode:'instance',sceneFile:'_craftmine_component.tscn',identityField:entity.field,identityType:entity.type,inputActions:[...inputActions]},sourceRequirements:[...required.values()]},interfaces:{},compatibility:{base:identity.baseId,...(bound.worldRecord.world.snapshot?.baseVersion?{baseVersion:bound.worldRecord.world.snapshot.baseVersion}:{}),engine:identity.engineVersion},state:{},licenses:{}};
      const archive=packStaticPackage({root:{id:args.assetId,version:args.version},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files:rewritten}]});check(archive.length<=5*1024*1024,'PACKAGE_COMPONENT_TOO_LARGE');
      return {archiveBase64:archive.toString('base64'),archiveSha256:hash(archive),files:Object.keys(rewritten).length,bytes:archive.length,source:{worldId:args.worldId,revision:identity.revision,manifestHash:identity.manifestHash,mainScene,nodePath:args.nodePath},requiredSourceFiles:required.size};
    },
  };
}
