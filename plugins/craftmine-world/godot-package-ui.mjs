// Godot component presentation. Files, source authority and installation stay native.
import {createGodotWindowsExportUI} from './godot-windows-export-ui.mjs';
const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
const field=(label,type='input')=>{const wrapper=text('label',''),control=document.createElement(type);wrapper.append(text('span',label),control);return {wrapper,control};};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fixedRef=value=>value&&typeof value.assetId==='string'&&value.assetId.length>0&&value.assetId.length<=80&&Number.isSafeInteger(value.version)&&value.version>=1&&hash(value.contentHash)
  ?{assetId:value.assetId,version:value.version,contentHash:value.contentHash}:null;
const sameRef=(left,right)=>left&&right&&left.assetId===right.assetId&&left.version===right.version&&left.contentHash===right.contentHash;
// A later preflight failure cannot disprove an earlier lost installer receipt.
const catalogPreflightErrors=new Set(['PACKAGE_CATALOG_IDENTITY_MISMATCH','PACKAGE_CATALOG_SINGLE_ZIP_REQUIRED','PACKAGE_CATALOG_ZIP_INVALID','PACKAGE_CATALOG_BODY_MISMATCH','PACKAGE_CATALOG_BLOB_MISMATCH']);
export function createGodotPackageUI({element,request,getWorldId,action=run=>run()}) {
  let generation=0,source=null,grant=null,lastCatalogRef=null,lastCatalogHash=null,attempt=null,activeWorld=null,pending=null,installing=false,timer=null,visible=false;
  let catalogBusy=false,catalogToken=0,catalogItems=[],catalogSelection=null,catalogOffset=0,catalogNext=null,catalogFilter={query:'',kind:''};
  const gameExportElement=document.createElement('section'),gameExport=createGodotWindowsExportUI({element:gameExportElement,request,getWorldId});
  const notice=text('p',''),choices=field('选择要导出的对象','select'),asset=field('作品编号'),version=field('版本号');
  notice.className='workbench-notice';
  notice.setAttribute('role','status');asset.control.value='my-component';asset.control.pattern='[a-z0-9][a-z0-9._-]{0,79}';asset.control.required=true;
  version.control.type='number';version.control.min='1';version.control.max='100000';version.control.value='1';version.control.required=true;
  const submit=(label,run)=>{const form=document.createElement('form'),button=text('button',label);form.className='workbench-form';button.type='submit';form.append(button);form.onsubmit=event=>{event.preventDefault();void action(run);};return {form,button};};
  async function invoke(method,params={}) {const epoch=generation,worldId=getWorldId();if(!worldId)throw Error('请先打开世界');const result=await request('package.request',{worldId,method,params:{...params,worldId}});if(epoch!==generation||worldId!==getWorldId())throw Error('WORLD_CHANGED');return result;}
  function buttons() {
    importer.button.disabled=installing||!!pending||!!(attempt&&attempt.method!=='importSource');
    repeat.button.disabled=installing||!!pending||!!attempt||(!grant&&!lastCatalogRef);
    retryInstall.form.hidden=!attempt||installing;retryInstall.button.disabled=installing||!!pending;
    catalogInstall.button.disabled=installing||!!pending||!!attempt||catalogBusy||!catalogSelection;
    catalogSearch.button.disabled=catalogBusy;catalogInspect.button.disabled=catalogBusy||!catalogItems.length;catalogChoice.control.disabled=catalogBusy;
    catalogPrevious.button.disabled=catalogBusy||catalogOffset===0;catalogMore.button.disabled=catalogBusy||catalogNext===null;
  }
  function stopPolling() {if(timer!==null)clearTimeout(timer);timer=null;}
  async function pollJob() {
    stopPolling();if(!pending||!visible)return;
    const epoch=generation,job=pending;
    retryQuery.form.hidden=true;
    try {
      const result=await invoke('sourceJob',{jobId:job.id});
      if(epoch!==generation||pending!==job||!visible)return;
      if(result.jobId!==job.id||!['blocked','queued','claimed','running','passed','failed','cancelled','interrupted'].includes(result.status))throw Error('PACKAGE_JOB_RECEIPT_INVALID');
      if(['passed','failed','cancelled','interrupted'].includes(result.status)) {
        pending=null;buttons();
        notice.textContent=result.status==='passed'?`已加入 ${job.count} 个独立对象，检查通过。请到顶部“检查记录”预览并应用；也可再次安装独立对象。`:`本次检查已结束（${result.status}）。对象源码已保留，请查看检查记录；现在可再次安装。`;
      } else {
        notice.textContent=`已加入 ${job.count} 个独立对象，${result.status==='blocked'?'检查暂不可用':'正在检查'}。本次检查结束前暂不能再次安装。`;
        if(result.status==='blocked')retryQuery.form.hidden=false;
        else timer=setTimeout(()=>void pollJob(),800);
      }
    } catch(error) {
      if(epoch!==generation||pending!==job||!visible)return;
      notice.textContent='暂时无法查询本次检查。安装结果已保留，请重试查询；不会重复导入作品。';retryQuery.form.hidden=false;
    }
  }
  function showInstall(result,method,params,archiveHash) {
    if(result?.status==='cancelled'){if(method==='importCatalogSource'||result.worldId!==getWorldId()||result.operationId!==params.operationId)throw Error('PACKAGE_INSTALL_RECEIPT_INVALID');notice.textContent='已取消选择文件。';return;}
    if(!['check-queued','source-saved-check-blocked'].includes(result.status)||!Array.isArray(result.instanceIds)||!result.instanceIds.every(id=>typeof id==='string')||!/^gjob-[a-f0-9]{64}$/.test(result.job?.id??''))throw Error('PACKAGE_INSTALL_RECEIPT_INVALID');
    if(method==='importCatalogSource'){
      if(result.applied!==false||result.worldId!==getWorldId()||result.operationId!==params.operationId||!sameRef(result.catalogRef,params.ref)||!hash(result.archiveSha256)||result.archiveSha256!==archiveHash)throw Error('PACKAGE_INSTALL_RECEIPT_INVALID');
      lastCatalogRef={...params.ref};lastCatalogHash=result.archiveSha256;grant=null;
      if(sameRef(catalogSelection?.ref,params.ref))catalogSelection.statusNode.textContent='本次安装已提交检查，请以上方检查状态为准；通过后仍需预览并应用。';
    }else{grant=result.grantId??result.importGrantId??grant;lastCatalogRef=null;lastCatalogHash=null;}
    const count=result.instanceIds.length;
    notice.textContent=result.status==='source-saved-check-blocked'?`已加入 ${count} 个独立对象。检查暂不可用：${result.job?.error?.code??result.job?.reason??'请检查引擎状态'}。`:`已加入 ${count} 个独立对象并提交检查。通过后请到顶部“检查记录”预览并应用。`;
    const job=result.job;if(job?.id){notice.dataset.jobId=job.id;pending={id:job.id,count};buttons();void pollJob();}
  }
  async function install(method,params={}) {
    if(pending||installing)throw Error('请等待本次检查结束。');
    if(attempt&&(attempt.method!==method||(method==='importCatalogSource'&&!sameRef(attempt.params.ref,params.ref))))throw Error('请先重试上次结果未确认的安装。');
    const archiveHash=method==='importCatalogSource'?(sameRef(catalogSelection?.ref,params.ref)?catalogSelection.file.sha256:sameRef(lastCatalogRef,params.ref)?lastCatalogHash:null):null;
    if(!attempt&&method==='importCatalogSource'&&!hash(archiveHash))throw Error('请先核对所选版本');
    attempt??={method,params:{operationId:crypto.randomUUID(),...params},archiveHash,uncertain:false};
    const operation=attempt;
    const epoch=generation;installing=true;buttons();
    try {const result=await invoke(method,attempt.params);showInstall(result,method,attempt.params,attempt.archiveHash);attempt=null;}
    catch(error){
      const code=error?.errorCode??error?.code??error?.message;
      if(epoch===generation&&attempt===operation&&method==='importCatalogSource'&&!operation.uncertain&&catalogPreflightErrors.has(code)){
        attempt=null;catalogSelection=null;catalogDetail.replaceChildren();
        notice.textContent='所选资源未被接受，未派发源码安装。请刷新资源库或重新选择版本。';
      }else{
        operation.uncertain=true;
        if(epoch===generation)notice.textContent='上次安装结果尚未确认。请重试确认上次安装；将使用原操作编号和固定版本，不会改装其他作品。';
      }
      throw error;
    }
    finally {if(epoch===generation){installing=false;buttons();}}
  }
  const importer=submit('导入作品 ZIP 并检查',()=>install('importSource'));
  const repeat=submit('再次安装为独立对象',async()=>{if(lastCatalogRef)return install('importCatalogSource',{ref:{...lastCatalogRef}});if(!grant)throw Error('请先导入作品');return install('repeatImportSource',{grantId:grant});});repeat.button.disabled=true;
  const retryInstall=submit('重试确认上次安装',()=>{if(!attempt)throw Error('没有待确认的安装');return install(attempt.method,attempt.params);});retryInstall.form.hidden=true;
  const retryQuery=submit('重试查询本次检查',()=>pollJob());retryQuery.form.hidden=true;
  const catalogArea=text('section',''),catalogQuery=field('作品名称或编号'),catalogKind=field('作品类型','select'),catalogChoice=field('资源库固定版本','select'),catalogStatus=text('p','输入名称或编号，查找资源库中已收录的作品。'),catalogDetail=text('div','');
  catalogArea.dataset.catalogSource='true';catalogQuery.control.maxLength=120;
  for(const [value,label]of [['','全部类型'],['object','物体'],['raw','原始素材'],['creation','组合作品'],['world-template','世界模板']]){const option=text('option',label);option.value=value;catalogKind.control.append(option);}
  catalogKind.control.value='';
  const catalogSearch=submit('检索资源库',()=>searchCatalog(0,{query:catalogQuery.control.value.trim(),kind:catalogKind.control.value}));
  catalogSearch.form.prepend(catalogQuery.wrapper,catalogKind.wrapper);
  const catalogPrevious=submit('上一页资源',()=>searchCatalog(Math.max(0,catalogOffset-20),catalogFilter));
  const catalogMore=submit('下一页资源',()=>searchCatalog(catalogNext,catalogFilter));
  const catalogInspect=submit('核对所选版本',inspectCatalog);
  const catalogInstall=submit('安装所选资源库 ZIP 并检查',()=>{if(!catalogSelection)throw Error('请先核对所选版本');return install('importCatalogSource',{ref:{...catalogSelection.ref}});});
  catalogChoice.control.onchange=()=>{catalogToken++;catalogSelection=null;catalogDetail.replaceChildren();buttons();};
  catalogArea.append(text('h3','从资源库选择 ZIP 并检查'),text('p','按名称或编号查找建议的固定版本。核对后由你选择安装；收录记录不代表已经通过当前世界检查。'),catalogSearch.form,catalogStatus,catalogChoice.wrapper,catalogPrevious.form,catalogMore.form,catalogInspect.form,catalogDetail,catalogInstall.form);
  async function assetCall(channel,params) {
    const epoch=generation,worldId=getWorldId();if(!worldId)throw Error('请先打开世界');
    // The asset panel uses ownerWorldId; asset.read forbids a worldId field.
    const result=await request(channel,{ownerWorldId:worldId,...params});
    if(epoch!==generation||worldId!==getWorldId())throw Error('WORLD_CHANGED');return result;
  }
  async function searchCatalog(offset,filter) {
    if(catalogBusy)return;
    if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw Error('资源分页范围无效');
    if(new TextEncoder().encode(filter.query).length>120)throw Error('搜索内容过长，请缩短名称或编号');
    const epoch=generation,token=++catalogToken;catalogBusy=true;catalogSelection=null;catalogDetail.replaceChildren();buttons();
    try{
      const result=await assetCall('asset.search',{scope:'local-library',query:filter.query,mediaKind:'package',...(filter.kind?{kind:filter.kind}:{}),latestOnly:false,offset,limit:20});
      if(token!==catalogToken)return;
      if(!Array.isArray(result.items)||result.items.length>20||!Number.isSafeInteger(result.total)||result.total<0||(result.nextOffset!==null&&(!Number.isSafeInteger(result.nextOffset)||result.nextOffset<=offset||result.nextOffset>10000)))throw Error('ASSET_SEARCH_RECEIPT_INVALID');
      const items=result.items.map(item=>({...item,ref:fixedRef(item)}));if(items.some(item=>!item.ref))throw Error('ASSET_SEARCH_RECEIPT_INVALID');
      catalogItems=items;catalogOffset=offset;catalogNext=result.nextOffset;catalogFilter={...filter};catalogChoice.control.replaceChildren();
      for(const [index,item]of items.entries()){const option=text('option',`${item.displayName||item.assetId} · ${item.assetId} · v${item.version} · ${item.ref.contentHash.slice(0,12)}…`);option.value=String(index);catalogChoice.control.append(option);}
      catalogChoice.control.value=items.length?'0':'';
      catalogStatus.textContent=items.length?`显示第 ${offset+1}—${offset+items.length} 项，共 ${result.total} 项包记录。请选择并核对是否为单个 ZIP。${result.truncated?'检索范围受限，结果可能不完整；请缩小条件。':''}`:`未找到包记录。${result.truncated?'检索范围受限，不能据此认定资源不存在。':''}`;
    }finally{if(epoch===generation){catalogBusy=false;buttons();}}
  }
  async function inspectCatalog() {
    if(catalogBusy)return;
    const chosen=catalogItems[Number(catalogChoice.control.value)];if(!chosen)throw Error('请先选择资源库版本');
    const epoch=generation,token=++catalogToken;catalogBusy=true;catalogSelection=null;catalogDetail.replaceChildren();buttons();
    try{
      const result=await assetCall('asset.read',{assetId:chosen.ref.assetId,version:chosen.ref.version});
      if(token!==catalogToken)return;
      const record=result?.version_,ref=fixedRef(record),files=record?.files;
      if(!sameRef(ref,chosen.ref))throw Error('ASSET_VERSION_CHANGED');
      if(record.mediaKind!=='package'||record.fileCount!==1||!Array.isArray(files)||files.length!==1||files[0].mediaType!=='application/zip')throw Error('所选固定版本不是单个 ZIP 作品，请选择其他记录');
      const file=files[0];if(typeof file.path!=='string'||!hash(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>5*1024*1024)throw Error('ZIP 文件信息无效或超过 5 MiB 导入上限');
      const statusNode=text('p','所选版本尚未经过本次安装检查。资源库记录本身不提供当前世界的兼容性结论。');
      catalogSelection={ref,file,statusNode};const origin=record.source??{};
      const hashes=text('details','');hashes.append(text('summary','核对完整版本哈希'),text('p',`资源库版本哈希：${ref.contentHash}`),text('p',`ZIP 文件 SHA-256：${file.sha256}`));
      catalogDetail.append(text('p',`${record.displayName||ref.assetId} · ${ref.assetId} · 固定版本 v${ref.version}`),
        text('p',`来源：${origin.origin||'未注明'}；作者：${origin.author||'未注明'}`),
        text('p',`许可声明：${origin.license||'未注明'}（记录状态：${origin.licenseStatus||'未知'}）`),
        text('p',`文件：${file.path} · ${file.bytes} 字节`),
        statusNode,hashes);
    }finally{if(epoch===generation){catalogBusy=false;buttons();}}
  }
  function resetCatalog(){catalogToken++;catalogBusy=false;catalogItems=[];catalogSelection=null;catalogOffset=0;catalogNext=null;catalogFilter={query:'',kind:''};catalogQuery.control.value='';catalogKind.control.value='';catalogChoice.control.replaceChildren();catalogDetail.replaceChildren();catalogStatus.textContent='输入名称或编号，查找资源库中已收录的作品。';}
  const exporter=submit('导出所选对象为 ZIP',async()=>{
    if(!source||!choices.control.value)throw Error('没有可导出的对象');
    const result=await invoke('exportSource',{revision:source.revision,manifestHash:source.manifestHash,nodePath:choices.control.value,assetId:asset.control.value.trim(),version:Number(version.control.value)});
    notice.textContent=result.status==='cancelled'?'已取消导出。':`已导出所选对象和 ${result.files??'所需'} 项文件。接收世界需要满足该作品的底座依赖。`;
  });exporter.form.prepend(choices.wrapper,asset.wrapper,version.wrapper);
  const list=text('div',''),refresh=submit('刷新当前源码对象',()=>refreshSource());
  async function refreshSource() {
    const result=await invoke('sourceList');source=result;choices.control.replaceChildren();list.replaceChildren();
    for(const item of result.items??[]) {
      const row=text('p',`${item.name} · ${item.nodePath}${item.supported?'':' · 暂不支持：'+item.reason}`);list.append(row);
      if(item.supported){const option=text('option',item.name+' · '+item.nodePath);option.value=item.nodePath;choices.control.append(option);}
    }
    exporter.button.disabled=!choices.control.options.length;
    if(!result.items?.length)list.append(text('p','入口场景中还没有可复用的独立对象。创建带稳定身份的门、箱子或目标后可在这里导出。'));
    if(!pending&&!attempt)notice.textContent=`已读取源码版本 ${result.revision}。导出不会包含玩家当前进度。${result.truncated?'当前只列出前 512 个对象。':''}`;
  }
  return {async show(){generation++;stopPolling();visible=true;source=null;installing=false;resetCatalog();if(activeWorld!==getWorldId()){activeWorld=getWorldId();grant=null;lastCatalogRef=null;lastCatalogHash=null;attempt=null;pending=null;}buttons();retryQuery.form.hidden=true;gameExport.clear();gameExport.show();element.replaceChildren(text('h2','Godot 作品'),text('p','导出一个对象及其子节点，或把作品 ZIP 加入当前源码。安装后需检查、预览并应用。'),gameExportElement,notice,importer.form,repeat.form,retryInstall.form,retryQuery.form,catalogArea,refresh.form,list,exporter.form);if(pending)void pollJob();await refreshSource();},clear(){generation++;stopPolling();visible=false;source=null;installing=false;resetCatalog();gameExport.clear();},refresh:refreshSource};
}
