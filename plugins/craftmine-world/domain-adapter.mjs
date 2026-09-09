import {compileScene, INITIAL_SNAPSHOT, validateSnapshot, upgradeScene} from '../../app/scene.mjs';
import {validatePackedAssets} from '../../app/asset-packages.mjs';
import {sceneAssetReferences} from '../../app/asset-binding.mjs';
import {validateExtension, extensionRequirement} from '../../app/harness/extension.mjs';

export function emptyWorld(title) {
  const build = compileScene({format:'craftmine.scene/3',title,night:false,objects:[],systems:[],behaviors:[]});
  return {build:{...build,id:'v-'+build.hash.slice(0,20)},snapshot:structuredClone(INITIAL_SNAPSHOT),extensions:[]};
}

export {validateSnapshot};

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
