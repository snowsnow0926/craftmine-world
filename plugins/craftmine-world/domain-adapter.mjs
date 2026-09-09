import {compileScene, INITIAL_SNAPSHOT, validateSnapshot, upgradeScene, OUTPUT_SCHEMA} from '../../app/scene.mjs';
import {validatePackedAssets} from '../../app/asset-packages.mjs';
import {sceneAssetReferences} from '../../app/asset-binding.mjs';
import {validateExtension, extensionRequirement} from '../../app/harness/extension.mjs';
import {patchWorkspaceScene,workspaceResource} from '../../app/harness/resource-patch.mjs';
import {contentHash,fields,integer,HARNESS_LIMITS} from '../../app/harness/contracts.mjs';
import {capabilitiesCatalog} from '../../app/harness/capabilities.mjs';
import {BEHAVIOR_API_GUIDE} from '../../app/behavior-contracts.mjs';

const groups={object:'objects',behavior:'behaviors',system:'systems'};

function page(text,{start=0,limit=12000}={}) {
  integer(start,0,2000000,'读取起点');integer(limit,1,16000,'读取长度');
  const chars=Array.from(text);
  if(start>chars.length)throw Error('读取起点超过末尾');
  const end=Math.min(start+limit,chars.length);
  return {text:chars.slice(start,end).join(''),start,next:end<chars.length?end:null,totalChars:chars.length};
}

export function inspectDraft(workspace,args) {
  fields(args,[],['offset','limit']);
  const {offset=0,limit=24}=args;
  integer(offset,0,256,'目录起点');integer(limit,1,32,'目录数量');
  const scene=upgradeScene(workspace.task.draft.scene);
  const resources=Object.entries(groups).flatMap(([kind,key])=>(scene[key]||[]).map(value=>({kind,id:value.id,name:value.name,hash:contentHash(value)})));
  return {worldId:workspace.worldId,taskId:workspace.task.binding.taskId,baseBuild:workspace.task.binding.baseBuild,
    title:scene.title,workspaceRevision:workspace.task.revision,status:workspace.task.status,
    resumedFrom:workspace.resumedFrom,resources:resources.slice(offset,offset+limit),next:offset+limit<resources.length?offset+limit:null,total:resources.length,
    publishingAvailable:false};
}

export function readDraftResource(workspace,args) {
  fields(args,['kind','id'],['start','limit']);
  const value=workspaceResource(workspace.task.draft.scene,args.kind,args.id);
  return {kind:args.kind,id:args.id,hash:contentHash(value),workspaceRevision:workspace.task.revision,...page(JSON.stringify(value,null,2),args)};
}

export function patchDraft(workspace,args,world) {
  if(args.workspaceRevision!==workspace.task.revision)throw Error('STALE_DRAFT: 草稿已改变，请重新读取');
  if(workspace.task.revision>=HARNESS_LIMITS.calls)throw Error('CALL_LIMIT: 本轮草稿修改次数已达上限');
  const extensions=new Set(world.extensions.map(extension=>extensionRequirement(extension.id,extension.version)));
  const patched=patchWorkspaceScene(workspace.task.draft.scene,args,{reads:workspace.reads,extensions,baseScene:world.build.scene});
  // Asset references must remain satisfiable by the actual immutable packages.
  validatePackedAssets(patched.scene,world.build.assets||[]);
  return {draft:{scene:patched.scene},changed:patched.changed};
}

export function readCapabilities(args,extensions,scene) {
  fields(args,[],['section','start','limit']);
  const {section='objects'}=args;
  let text;
  if(section==='objects'||section==='systems') {
    const format=scene?.format==='craftmine.scene/4'?'craftmine.scene/4':'craftmine.scene/3';
    const schema=OUTPUT_SCHEMA.properties.scene.anyOf.find(s=>s.properties?.format.enum.includes(format));
    text=JSON.stringify({format,groundY:6,instructions:[
      'Use workspace_patch to add or replace one complete resource. The schema below matches the current world format; do not add fields from another format.',
      'Coordinates are in meters. Each part offset is its MINIMUM corner relative to object.position, not its center. Minimum world corner = position + offset; maximum = position + offset + size.',
      'For a rooted tree at position.y=6, the trunk bottom has offset.y=0. Center a canopy on the trunk by subtracting half its size from its desired center. Keep trunk, branches and canopy connected.',
      'Small plants use thin non-solid parts, not full-sized building blocks. Leaves normally use solid:false so players can move through foliage.',
    ],schema:schema.properties[section]},null,2);
  } else if(section==='behaviors')text=BEHAVIOR_API_GUIDE;
  else if(section==='catalog')text=JSON.stringify(capabilitiesCatalog({extensions}),null,2);
  else throw Error('未知能力章节');
  return {section,...page(text,args)};
}

export function emptyWorld(title) {
  const build = compileScene({format:'craftmine.scene/3',title,night:false,objects:[],systems:[],behaviors:[]});
  return {build:{...build,id:'v-'+build.hash.slice(0,20)},snapshot:structuredClone(INITIAL_SNAPSHOT),extensions:[]};
}

export {validateSnapshot};
export {fields};

export async function prepareLegacyWorld(project, read) {
  if(project?.format!=='craftmine.project/1'||!/^v-[a-f0-9]{20}$/.test(project.current))throw Error('旧世界格式或版本无效');
  if(project.extensions!==undefined&&(!Array.isArray(project.extensions)||project.extensions.length>64))throw Error('旧世界的扩展清单无效');
  const extensions=(project.extensions||[]).map(validateExtension);
  const extensionIds=new Set(), requirements=new Set(), commands=new Set();
  for(const extension of extensions) {
    if(extensionIds.has(extension.id))throw Error('旧世界存在重复的扩展版本');
    extensionIds.add(extension.id);requirements.add(extensionRequirement(extension.id,extension.version));
    for(const command of extension.provides.commands) {
      if(commands.has(command.type))throw Error('旧世界的扩展命令冲突');
      commands.add(command.type);
    }
  }
  for(const extension of extensions)for(const dependency of extension.requires) {
    if(!requirements.has(dependency))throw Error('旧世界缺少扩展依赖：'+dependency);
  }
  const stored=await read(`builds/${project.current}/build.json`);
  const compiled=compileScene(stored.scene,{extensions:requirements});
  if(stored.hash!==compiled.hash||project.current!=='v-'+compiled.hash.slice(0,20))throw Error('旧世界源码与版本哈希不一致');
  // Format 1 hashes depend on insertion order, which JSON object transports
  // cannot promise. Verify the original bytes first, then migrate the playable
  // copy to the existing order-independent format. The archive retains v1.
  const playable=compiled.scene.format==='craftmine.scene/1'?compileScene(upgradeScene(compiled.scene)):compiled;
  const assets=[];
  for(const ref of sceneAssetReferences(compiled.scene)) {
    const entry=project.assets?.find(asset=>asset.id===ref.id)?.versions.find(item=>item.version===ref.version);
    if(!entry||entry.hash!==ref.hash)throw Error('旧世界缺少对应版本的素材索引');
    assets.push(await read(`assets/${ref.id}/${ref.version}.json`));
  }
  const checkedAssets=validatePackedAssets(compiled.scene,assets);
  return {
    build:{...playable,id:'v-'+playable.hash.slice(0,20),...(checkedAssets.length?{assets:checkedAssets}:{})},
    snapshot:validateSnapshot(project.snapshot),extensions,
  };
}
