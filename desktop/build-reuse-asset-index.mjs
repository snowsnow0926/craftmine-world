import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (condition, message) => {if (!condition) throw Error(message);};
const features = [
  {id:'promo-broadleaf', title:'宣传片同款阔叶树', assetId:'cw.nature.promo-broadleaf', keywords:['树','阔叶树','宣传片同款'], files:['assets/blender/broadleaf.glb','scripts/broadleaf_world.gd']},
  {id:'promo-meadow', title:'宣传片同款草地与野花', assetId:'cw.scene.promo-meadow', keywords:['花草','草地','草甸','野花'], files:['assets/blender/meadow.glb']},
  {id:'promo-monsters', title:'宣传片角怪与遭遇战', assetId:'cw.module.promo-monsters', keywords:['小怪','怪物','角怪','战斗'], files:['assets/blender/hornling.glb','scripts/monsters/hornling.gd','scripts/monsters/encounter.gd']},
  {id:'promo-heavyblade', title:'宣传片重剑与挥砍', assetId:'cw.module.promo-heavyblade', keywords:['剑','重剑','大剑','近战'], files:['assets/blender/heavyblade.glb','scripts/hunt/duel.gd']},
  {id:'promo-hunt', title:'宣传片裂岳兽与巨兽试炼', assetId:'cw.module.promo-hunt', keywords:['怪猎','巨兽','大怪物','狩猎','boss'], files:['assets/blender/riftbeast.glb','scripts/hunt/riftbeast.gd','scripts/hunt/duel.gd']},
  {id:'promo-ak47', title:'宣传片 AK47 与射击', assetId:'cw.module.promo-ak47', keywords:['AK47','AK','枪','步枪','射击'], files:['assets/blender/ak47.glb','scripts/weapons/ak47.gd']},
];
const related = {
  'promo-mainline':['cw.module.approved-pomeranian',...features.map(feature=>feature.assetId)],
  'promo-flight':['cw.module.reusable-j20'],
  'promo-rain':['cw.module.rain-control'],
  'promo-city':['cw.city.ward-building','cw.city.gate-section','cw.city.ward-street'],
};

/** A discoverability index, never a catalog AssetRef or installation receipt. */
export function buildReuseAssetIndex({catalogBytes, repository=repositoryRoot}) {
  const catalog=JSON.parse(catalogBytes);
  check(catalog.format==='craftmine.builtin-source-library/1'&&Array.isArray(catalog.entries),'REUSE_INDEX_CATALOG_INVALID');
  const byId=new Map();
  for(const entry of catalog.entries){
    check(/^cw\.[a-z0-9._-]+$/.test(entry.assetId)&&Number.isSafeInteger(entry.version)&&entry.version>0&&typeof entry.label==='string','REUSE_INDEX_ENTRY_INVALID');
    const versions=byId.get(entry.assetId)??[];
    check(!versions.some(prior=>prior.version===entry.version),'REUSE_INDEX_VERSION_DUPLICATE');
    versions.push(entry);byId.set(entry.assetId,versions);
  }
  const components=[...byId].map(([assetId,versions])=>{
    versions.sort((a,b)=>a.version-b.version);const latest=versions.at(-1),archive=latest.file.endsWith('.zip');
    return {assetId,title:latest.label,latestListedVersion:latest.version,versions:versions.map(entry=>entry.version),kind:latest.kind,
      route:archive?'godot_source_library':'asset_library-model-only',
      ...(archive?{searchRequest:{mode:'search',query:assetId}}:{lookupAssetId:assetId}),
      bytes:latest.bytes,source:latest.source};
  });
  const templateRoot=path.join(repository,'desktop/godot/shared/promo-templates');
  const templateCatalog=JSON.parse(fs.readFileSync(path.join(templateRoot,'catalog.json'),'utf8'));
  const worlds=templateCatalog.templates.map(entry=>{
    check(/^promo-[a-z-]+$/.test(entry.id),'REUSE_INDEX_TEMPLATE_INVALID');
    const manifest=fs.readFileSync(path.join(templateRoot,entry.id,'manifest.json'));
    return {templateId:entry.id,title:entry.label,version:entry.version,description:entry.description,
      scope:'complete-world-template',route:'existing-world-picker',codeReadRoute:null,
      manifestSha256:sha(manifest),relatedListedComponents:(related[entry.id]??[]).filter(id=>byId.has(id))};
  });
  const manifest=JSON.parse(fs.readFileSync(path.join(templateRoot,'promo-mainline/manifest.json'),'utf8'));
  const sourceFeatures=features.map(feature=>({id:feature.id,title:feature.title,keywords:feature.keywords,templateId:'promo-mainline',
    status:byId.has(feature.assetId)?'component-listed':'reference-only',relatedAssetId:feature.assetId,
    ...(byId.has(feature.assetId)?{searchRequest:{mode:'search',query:feature.assetId}}:{}),
    originalFiles:feature.files.map(file=>{
      const record=manifest.files.find(entry=>entry.path===file);check(record,'REUSE_INDEX_REFERENCE_MISSING');
      const bytes=fs.readFileSync(path.join(templateRoot,'promo-mainline/source',file)),actual=sha(bytes);
      const normalized=sha(Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')));
      check(actual===record.sha256||!file.endsWith('.glb')&&normalized===record.sha256,'REUSE_INDEX_REFERENCE_CHANGED: '+file);
      return {path:file,bytes:record.bytes,sha256:record.sha256,...(actual!==record.sha256?{checkoutSha256:actual,textNormalization:'LF'}:{})};
    })}));
  return {format:'craftmine.reuse-asset-index/1',catalogSha256:sha(catalogBytes),assetCount:components.length,versionCount:catalog.entries.length,
    policy:{scope:'bundled-discovery-metadata',authority:'Lookup IDs in the live catalog and use its exact returned archiveRef/readRequest. These hashes are provenance, never installation refs.',
      inspection:'Read entry, dependencies, interfaces, state and automaticInstallation before choosing an exact compatible component. Model-only is not playable behavior. A listed version is not proof of target compatibility or gameplay.',
      referenceWorlds:'Whole worlds use the existing world picker. This index exposes summaries and original-file metadata, not a cross-world source-reading tool. Reference-only content is not independently installable.',
      efficiency:'Search relevant keywords first; read only matching candidates. Do not reload the complete index or every source file each turn.'},
    components,referenceWorlds:worlds,sourceFeatures};
}

const cell=value=>String(value??'').replaceAll('|','\\|').replace(/\r?\n/g,' ');
export function reuseAssetInventoryMarkdown(index){
  const rows=index.components.map(entry=>`| ${cell(entry.title)} | \`${entry.assetId}\` | ${entry.latestListedVersion} | ${entry.route==='godot_source_library'?'源素材包':'纯模型'} | ${(entry.bytes/1024).toFixed(1)} |`);
  return `# 已有素材清单与复用优先方案\n\n本表由实际内置素材目录生成，目前有 **${index.assetCount} 类素材、${index.versionCount} 个版本记录**，另有 **${index.referenceWorlds.length} 个完整宣传片世界**。数字随目录重新生成，不靠手工维护。\n\n## 已入库内容\n\n“源素材包”表示已有可检索包，不保证任意世界都能直接使用；需读取当前版本的依赖、安装说明和兼容性并完成检查。“纯模型”只提供外观，不能当成带完整行为的组件。版本列是最新已收录版本，实际选择仍以目标世界兼容性为准。\n\n| 名称 | 素材 ID | 版本 | 当前形式 | 大小 KiB |\n| --- | --- | ---: | --- | ---: |\n${rows.join('\n')}\n\n## 宣传片成品中的可复用内容\n\n| 内容 | 当前状态 | 对应素材 ID |\n| --- | --- | --- |\n${index.sourceFeatures.map(entry=>`| ${entry.title} | ${entry.status==='component-listed'?'已收录组件，需按目标世界检查':'原世界成品存在，独立组件待补齐'} | \`${entry.relatedAssetId}\` |`).join('\n')}\n\n原始模型和代码的来源路径、哈希保存在同源 JSON 索引中。来源文件的哈希不是可以直接传给安装接口的素材引用。\n\n## 完整世界\n\n${index.referenceWorlds.map(world=>`- **${world.title}**（\`${world.templateId}\`）：${world.description}。`).join('\n')}\n\n完整世界通过现有世界入口打开或创建副本。索引不冒充“已经把整套世界拆成组件”，也不宣称 AI 已获得跨世界读取全部源码的接口。\n\n## 默认创作流程\n\n1. 先看当前世界是否已有可以直接调整或复制的实例。\n2. 从本地素材库搜索相关外观和玩法；只读少量相关候选的用法、依赖与状态说明。\n3. 有匹配内容就复用，并配置位置、数量、颜色和交互；缺少连接逻辑时只适配需要的部分。\n4. 没有合适内容才新建，不要求模型穷举全库或反复尝试已知坏版本。\n5. 检查、应用后验证画面、交互和保存。成功制作的内容通过既有素材保存流程留供下次复用。\n\n## 本次落地范围\n\n- 统一由目录生成玩家可读清单和 AI 可按需读取的索引。\n- 调整 AI 默认检索顺序，补齐依赖与用法说明；不降低模型或另加任务 token/时长上限。\n- 将宣传片同款阔叶树、草甸、小怪、重剑、巨兽试炼和 AK47 接成独立可复用内容，保留原模型字节；必要的脚本适配和新的存档格式分别记录。\n- 按“树 → 花草 → 小怪 → 剑 → 大怪物 → AK47”重新实测。新增组件不提前出现尚未请求的巨兽、武器或竞技场，不重置已有进度。\n- 本地素材保存不等于远程发布；来源及许可证声明保留原状态，未核实的信息不标成已验证。\n\n当前索引目录 SHA-256：\`${index.catalogSha256}\`。\n`;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  check(args.length===6&&['--catalog','--index','--markdown'].every(name=>args.includes(name)&&value(name)),'Usage: --catalog FILE --index FILE --markdown FILE');
  const index=buildReuseAssetIndex({catalogBytes:fs.readFileSync(value('--catalog'))});
  for(const [file,text] of [[value('--index'),JSON.stringify(index,null,2)+'\n'],[value('--markdown'),reuseAssetInventoryMarkdown(index)]]){
    fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});fs.writeFileSync(file,text);
  }
  console.log(JSON.stringify({assetCount:index.assetCount,versionCount:index.versionCount,referenceWorlds:index.referenceWorlds.length,sourceFeatures:index.sourceFeatures.map(item=>({id:item.id,status:item.status}))}));
}
