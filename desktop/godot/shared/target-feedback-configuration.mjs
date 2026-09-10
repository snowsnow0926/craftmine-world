// Platform-owned CP configuration adapter. Pure text planning, no filesystem
// writes, runtime state writes, model calls, or arbitrary property operations.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseScene} from './scene_materializer.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const requireValue=(value,code)=>{if(!value)fail(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const SCRIPT='scripts/core/target_dummy.gd';
// The older target/profile implementation overwrote all instance values at
// world readiness, so accepting its hash would falsely claim edit support.
const SCRIPT_LF_SHA256='1ffc6e5419aaf8bc9d901a9671942472fdee86f97bdca069d6c33afb199d5ff3';
const WORLD_SCRIPT='scripts/core/base_world.gd';
const WORLD_SCRIPT_LF_SHA256='2782fcffd844a78b1e59e74a0e2234f8f1b649a089c93dc68c87610a498182f1';
const PROFILE_SCRIPT='scripts/core/balance_profile.gd';
const PROFILE_SCRIPT_LF_SHA256='9179b102a43800bb23a60cf401e7a02fed55f4762e0d0a7b9e0942fa09cbc5f3';
const PLAYER_SCENE='scenes/actors/player.tscn';
const PLAYER_SCENE_LF_SHA256='7536053578eabf51bf65378599436ce3d0159559248aa497f73626e27aa57c17';
const PLAYER_SCRIPT='scripts/core/player_controller.gd';
const PLAYER_SCRIPT_LF_SHA256='a4669c45bb12fb0465eb8573038696bc6b25aa0727dca20929f66699daf82324';
const PROPERTY='hit_flash_seconds';
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONFIG={format:'craftmine.interfaces.configuration/1',contractId:'fp.target.feedback/1',
 baseId:'first-person',baseVersion:'0.1.0',scope:'instance',identityField:'target_id',
 parameters:[{id:'hitFlashMilliseconds',label:'受击闪光时长',type:'integer',unit:'毫秒',default:120,minimum:1,maximum:1000}],
 preview:'checked-candidate',requiredChecks:['native-load','full-progress-round-trip','target-hit-feedback']};

/** CP resource manifests may carry this object at content.interfaces.configuration. */
export const targetFeedbackConfiguration=()=>clone(CONFIG);
export function validateTargetFeedbackConfiguration(value){
 requireValue(isDeepStrictEqual(value,CONFIG),'TARGET_CONFIGURATION_UNSUPPORTED');
 return clone(CONFIG);
}
const exact=(value,keys)=>requireValue(object(value)&&Object.keys(value).every(key=>keys.includes(key)),'TARGET_CONFIGURATION_INVALID_ARGUMENT');
function filePath(value){
 requireValue(typeof value==='string'&&value.length<=240&&!value.includes('\\')&&!value.includes(':')&&!value.split('/').some(part=>!part||part==='.'||part==='..'),'TARGET_CONFIGURATION_PATH_INVALID');
 return value;
}
function sourceText(value){
 const bytes=typeof value==='string'?Buffer.from(value):value;
 requireValue(Buffer.isBuffer(bytes)&&bytes.length<=4*1024*1024,'TARGET_CONFIGURATION_SOURCE_INVALID');
 const text=bytes.toString('utf8');
 requireValue(!text.includes('\0')&&!text.includes('\ufeff')&&Buffer.from(text).equals(bytes),'TARGET_CONFIGURATION_SOURCE_INVALID');
 return text;
}
const extId=value=>{const match=/^ExtResource\("([A-Za-z0-9_-]+)"\)$/.exec(value??'');requireValue(match,'TARGET_CONFIGURATION_EXPRESSION_REFUSED');return match[1];};
function literalId(value){
 const match=/^&?"([A-Za-z0-9][A-Za-z0-9._-]{0,127})"$/.exec(value??'');
 requireValue(match,'TARGET_CONFIGURATION_EXPLICIT_ID_REQUIRED');return match[1];
}
function parse(text){
 requireValue(/^\[gd_scene\b[^\r\n]*\bformat=3\]/.test(text),'TARGET_CONFIGURATION_SCENE_UNSUPPORTED');
 requireValue(!/^[ \t]+(?:target_id|hit_flash_seconds|script)[ \t]*=/m.test(text),'TARGET_CONFIGURATION_EXPRESSION_REFUSED');
 const parsed=parseScene(text),resources=new Map(),paths=new Set(),ids=new Set();
 for(const resource of parsed.extResources){requireValue(!resources.has(resource.id),'TARGET_CONFIGURATION_DUPLICATE_RESOURCE');resources.set(resource.id,resource);}
 // The existing parser owns node/property interpretation. These checks reject
 // its ambiguous subset instead of attempting a full Godot expression parser.
 requireValue((text.match(/^\[node\b/gm)??[]).length===parsed.nodes.length,'TARGET_CONFIGURATION_SCENE_UNSUPPORTED');
 requireValue((text.match(/^\[ext_resource\b/gm)??[]).length===resources.size,'TARGET_CONFIGURATION_SCENE_UNSUPPORTED');
 const roots=parsed.nodes.filter(node=>node.parent===null);
 requireValue(roots.length===1&&!/\binstance=/.test(roots[0].header),'TARGET_CONFIGURATION_INHERITED_SCENE');
 for(const node of parsed.nodes){
  for(const attribute of ['name','parent','type','instance'])requireValue((node.header.match(new RegExp('(?:^|\\s)'+attribute+'=','g'))??[]).length<=1,'TARGET_CONFIGURATION_SCENE_UNSUPPORTED');
  requireValue(!node.duplicateProperties.length,'TARGET_CONFIGURATION_DUPLICATE_PROPERTY');
  const propertyOrder=Object.keys(node.properties),scriptIndex=propertyOrder.indexOf('script');
  if(scriptIndex>=0)for(const property of ['target_id',PROPERTY,'balance_profile','player_path']){
   const index=propertyOrder.indexOf(property);requireValue(index<0||index>scriptIndex,'TARGET_CONFIGURATION_PROPERTY_BEFORE_SCRIPT');
  }
  const nodePath=node.parent===null?'.':node.parent==='.'?node.name:node.parent+'/'+node.name;
  requireValue(!paths.has(nodePath),'TARGET_CONFIGURATION_DUPLICATE_NODE');paths.add(nodePath);node.nodePath=nodePath;
  if(Object.hasOwn(node.properties,'target_id')){const id=literalId(node.properties.target_id);requireValue(!ids.has(id),'TARGET_CONFIGURATION_DUPLICATE_ID');ids.add(id);}
 }
 return {...parsed,resources};
}
function milliseconds(node,fallback=120){
 const raw=node.properties[PROPERTY];if(raw===undefined)return fallback;
 requireValue(/^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(raw),'TARGET_CONFIGURATION_VALUE_EXPRESSION');
 const value=Math.round(Number(raw)*1000);
 requireValue(Number.isInteger(value)&&value>=1&&value<=1000,'TARGET_CONFIGURATION_VALUE_INVALID');return value;
}
function knownScript(parsed,node,expectedPath,expectedHash,read){
 const resource=parsed.resources.get(extId(node.properties.script));
 requireValue(resource?.type==='Script'&&resource.path==='res://'+expectedPath,'TARGET_CONFIGURATION_UNKNOWN_SCRIPT');
 requireValue(hash(read(expectedPath).replaceAll('\r\n','\n'))===expectedHash,'TARGET_CONFIGURATION_UNKNOWN_SCRIPT');
}
function profileMilliseconds(text,read){
 // Reuse scene parsing for resource/property order and duplicate detection,
 // after converting only the two fixed resource section headers in memory.
 const lines=text.split(/\r?\n/);
 requireValue(/^\[gd_resource type="Resource"(?: script_class="BalanceProfile")?(?: load_steps=[1-9][0-9]*)? format=3\]$/.test(lines[0]),'TARGET_CONFIGURATION_PROFILE_UNSUPPORTED');
 const sections=lines.filter(line=>line.startsWith('['));
 requireValue(sections.filter(line=>line==='[resource]').length===1&&sections.at(-1)==='[resource]'&&sections.every((line,index)=>index===0||line==='[resource]'||line.startsWith('[ext_resource ')),'TARGET_CONFIGURATION_PROFILE_UNSUPPORTED');
 const bodyStart=lines.indexOf('[resource]');
 const allowed=['script','player_move_speed','player_jump_velocity','mouse_sensitivity_degrees','gravity_scale',PROPERTY];
 for(const line of lines.slice(bodyStart+1)){
  if(!line.trim()||/^;/.test(line))continue;
  const property=/^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.+)$/.exec(line);
  requireValue(property&&allowed.includes(property[1]),'TARGET_CONFIGURATION_PROFILE_UNSUPPORTED');
  if(property[1]!=='script')requireValue(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(property[2])&&Number.isFinite(Number(property[2])),'TARGET_CONFIGURATION_PROFILE_EXPRESSION');
 }
 lines[0]='[gd_scene format=3]';lines[bodyStart]='[node name="Profile" type="Resource"]';
 const parsed=parse(lines.join('\n')),profile=parsed.nodes[0];
 requireValue(parsed.nodes.length===1&&parsed.resources.size===1,'TARGET_CONFIGURATION_PROFILE_UNSUPPORTED');
 requireValue(Object.keys(profile.properties)[0]==='script','TARGET_CONFIGURATION_PROPERTY_BEFORE_SCRIPT');
 knownScript(parsed,profile,PROFILE_SCRIPT,PROFILE_SCRIPT_LF_SHA256,read);
 return milliseconds(profile);
}
function worldDefault(parsed,read){
 const root=parsed.nodes.find(node=>node.parent===null);
 requireValue(/\btype="Node3D"/.test(root.header),'TARGET_CONFIGURATION_WORLD_UNSUPPORTED');
 if(!Object.hasOwn(root.properties,'script')){
  requireValue(!Object.hasOwn(root.properties,'balance_profile'),'TARGET_CONFIGURATION_WORLD_UNSUPPORTED');return 120;
 }
 knownScript(parsed,root,WORLD_SCRIPT,WORLD_SCRIPT_LF_SHA256,read);
 const profile=root.properties.balance_profile;
 if(profile===undefined||profile==='null')return 120;
 // BalanceProfile returns without applying anything if BaseWorld cannot bind
 // a PlayerController. Only the fixed known scene path is proven here; custom
 // paths/player implementations must use the ordinary checked authoring flow.
 requireValue(root.properties.player_path===undefined||root.properties.player_path==='^"Player"','TARGET_CONFIGURATION_PLAYER_UNSUPPORTED');
 const player=parsed.nodes.find(node=>node.nodePath==='Player');
 requireValue(player&&player.parent==='.'&&!Object.hasOwn(player.properties,'script')&&!parsed.nodes.some(node=>node!==player&&(node.parent==='Player'||node.parent?.startsWith('Player/'))),'TARGET_CONFIGURATION_PLAYER_UNSUPPORTED');
 const instance=/\binstance=(ExtResource\("[A-Za-z0-9_-]+"\))/.exec(player.header);
 requireValue(instance,'TARGET_CONFIGURATION_PLAYER_UNSUPPORTED');
 const playerResource=parsed.resources.get(extId(instance[1]));
 requireValue(playerResource?.type==='PackedScene'&&playerResource.path==='res://'+PLAYER_SCENE,'TARGET_CONFIGURATION_PLAYER_UNSUPPORTED');
 const playerText=read(PLAYER_SCENE);
 requireValue(hash(playerText.replaceAll('\r\n','\n'))===PLAYER_SCENE_LF_SHA256,'TARGET_CONFIGURATION_PLAYER_UNSUPPORTED');
 const playerScene=parse(playerText),playerRoot=playerScene.nodes.find(node=>node.parent===null);
 requireValue(/\btype="CharacterBody3D"/.test(playerRoot.header),'TARGET_CONFIGURATION_PLAYER_UNSUPPORTED');
 knownScript(playerScene,playerRoot,PLAYER_SCRIPT,PLAYER_SCRIPT_LF_SHA256,read);
 const resource=parsed.resources.get(extId(profile));
 requireValue(resource?.type==='Resource'&&resource.path.startsWith('res://')&&resource.path.endsWith('.tres'),'TARGET_CONFIGURATION_PROFILE_UNSUPPORTED');
 return profileMilliseconds(read(resource.path.slice(6)),read);
}
function resolve(args){
 exact(args,['sceneText','scenePath','targetId','files']);
 const {sceneText,scenePath,targetId,files}=args;
 requireValue(typeof sceneText==='string'&&typeof targetId==='string'&&ID.test(targetId)&&files instanceof Map,'TARGET_CONFIGURATION_INVALID_ARGUMENT');
 filePath(scenePath);requireValue(scenePath.endsWith('.tscn'),'TARGET_CONFIGURATION_PATH_INVALID');sourceText(sceneText);
 requireValue(files.has(scenePath)&&sourceText(files.get(scenePath))===sceneText,'TARGET_CONFIGURATION_SOURCE_MISMATCH');
 const dependencies=new Map([[scenePath,hash(sceneText)]]);
 const read=name=>{filePath(name);requireValue(files.has(name),'TARGET_CONFIGURATION_DEPENDENCY_MISSING');const body=sourceText(files.get(name));dependencies.set(name,hash(body));return body;};
 const parsed=parse(sceneText),matches=parsed.nodes.filter(node=>node.properties.target_id!==undefined&&literalId(node.properties.target_id)===targetId);
 const defaultValue=worldDefault(parsed,read);
 requireValue(matches.length===1,'TARGET_CONFIGURATION_TARGET_NOT_FOUND');const node=matches[0];
 requireValue(node.parent!==null,'TARGET_CONFIGURATION_ROOT_TARGET_REFUSED');
 let definition=node,definitionScene=parsed;
 const instance=/\binstance=(ExtResource\("[A-Za-z0-9_-]+"\))/.exec(node.header);
 if(instance){
  requireValue(!Object.hasOwn(node.properties,'script'),'TARGET_CONFIGURATION_SCRIPT_OVERRIDE');
  const resource=parsed.resources.get(extId(instance[1]));
  requireValue(resource?.type==='PackedScene'&&resource.path.startsWith('res://'),'TARGET_CONFIGURATION_SCENE_UNSUPPORTED');
  definitionScene=parse(read(resource.path.slice(6)));definition=definitionScene.nodes.find(item=>item.parent===null);
  requireValue(!definitionScene.nodes.some(item=>item!==definition&&item.properties.target_id!==undefined),'TARGET_CONFIGURATION_NESTED_TARGET');
  requireValue(!parsed.nodes.some(item=>item!==node&&(item.parent===node.nodePath||item.parent?.startsWith(node.nodePath+'/'))),'TARGET_CONFIGURATION_INSTANCE_CHILD_OVERRIDE');
 }else requireValue(!/\binstance=/.test(node.header),'TARGET_CONFIGURATION_SCENE_UNSUPPORTED');
 requireValue(/\btype="StaticBody3D"/.test(definition.header),'TARGET_CONFIGURATION_SCENE_UNSUPPORTED');
 knownScript(definitionScene,definition,SCRIPT,SCRIPT_LF_SHA256,read);
 const fallback=milliseconds(definition,defaultValue);
 const value=milliseconds(node,fallback);
 return {node,value,binding:{format:'craftmine.target-configuration-binding/1',contractId:CONFIG.contractId,
  scenePath,targetId,nodePath:node.nodePath,sourceHash:hash(sceneText),dependencies:[...dependencies].sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,sha256])=>({path,sha256}))}};
}

export function describeTargetFeedback(args){
 const {value,binding}=resolve(args);
 return {configuration:targetFeedbackConfiguration(),binding,values:{hitFlashMilliseconds:value}};
}

export function patchTargetFeedback(args){
 exact(args,['sceneText','scenePath','targetId','files','binding','values']);
 exact(args.values,['hitFlashMilliseconds']);
 const value=args.values.hitFlashMilliseconds;
 requireValue(Number.isInteger(value)&&value>=1&&value<=1000,'TARGET_CONFIGURATION_VALUE_INVALID');
 const {node,value:oldValue,binding}=resolve({sceneText:args.sceneText,scenePath:args.scenePath,targetId:args.targetId,files:args.files});
 requireValue(isDeepStrictEqual(args.binding,binding),'TARGET_CONFIGURATION_STALE_BINDING');
 let text=args.sceneText;
 if(value!==oldValue){
  // Replace exactly one physical property line, or append to this node's block.
  // Script must already be bound before exported properties are deserialized.
  // No normalization or reserialization of other bytes.
  const headers=[...text.matchAll(/^\[node\b[^\r\n]*(?:\r?\n|$)/gm)];
  const header=headers.find(item=>item[0].replace(/\r?\n$/,'')===node.header);
  requireValue(header,'TARGET_CONFIGURATION_SCENE_UNSUPPORTED');
  const start=header.index+header[0].length;
  const next=/^\[/m.exec(text.slice(start));const end=next?start+next.index:text.length;
  const body=text.slice(start,end),literal=(value/1000).toString();
  const property=new RegExp('^'+PROPERTY+'[ \\t]*=[^\\r\\n]*','m');
  const match=property.exec(body);
  if(match){const equal=match[0].indexOf('=');const prefix=match[0].slice(0,equal+1)+(match[0].slice(equal+1).match(/^[ \t]*/)?.[0]??'');
   text=text.slice(0,start+match.index)+prefix+literal+text.slice(start+match.index+match[0].length);
  }else {const newline=text.includes('\r\n')?'\r\n':'\n';requireValue(/\r?\n$/.test(header[0]),'TARGET_CONFIGURATION_SCENE_UNSUPPORTED');text=text.slice(0,end)+(end>0&&!text.slice(0,end).endsWith('\n')?newline:'')+PROPERTY+' = '+literal+newline+text.slice(end);}
 }
 const files=new Map(args.files);files.set(args.scenePath,Buffer.from(text));
 const next=describeTargetFeedback({sceneText:text,scenePath:args.scenePath,targetId:args.targetId,files});
 requireValue(next.values.hitFlashMilliseconds===value,'TARGET_CONFIGURATION_PATCH_INVALID');
 return {text,changed:text!==args.sceneText,previousHash:binding.sourceHash,sha256:hash(text),binding:next.binding,values:next.values};
}
