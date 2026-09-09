// Godot component presentation. Files, source authority and installation stay native.
import {createGodotWindowsExportUI} from './godot-windows-export-ui.mjs';
const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
const field=(label,type='input')=>{const wrapper=text('label',''),control=document.createElement(type);wrapper.append(text('span',label),control);return {wrapper,control};};
export function createGodotPackageUI({element,request,getWorldId,action=run=>run()}) {
  let generation=0,source=null,grant=null,attempt=null,activeWorld=null,pending=null,installing=false,timer=null,visible=false;
  const gameExportElement=document.createElement('section'),gameExport=createGodotWindowsExportUI({element:gameExportElement,request,getWorldId});
  const notice=text('p',''),choices=field('选择要导出的对象','select'),asset=field('作品编号'),version=field('版本号');
  notice.className='workbench-notice';
  notice.setAttribute('role','status');asset.control.value='my-component';asset.control.pattern='[a-z0-9][a-z0-9._-]{0,79}';asset.control.required=true;
  version.control.type='number';version.control.min='1';version.control.max='100000';version.control.value='1';version.control.required=true;
  const submit=(label,run)=>{const form=document.createElement('form'),button=text('button',label);form.className='workbench-form';button.type='submit';form.append(button);form.onsubmit=event=>{event.preventDefault();void action(run);};return {form,button};};
  async function invoke(method,params={}) {const epoch=generation,worldId=getWorldId();if(!worldId)throw Error('请先打开世界');const result=await request('package.request',{worldId,method,params:{...params,worldId}});if(epoch!==generation||worldId!==getWorldId())throw Error('WORLD_CHANGED');return result;}
  function buttons() {importer.button.disabled=installing||!!pending;repeat.button.disabled=installing||!!pending||!grant;}
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
  function showInstall(result) {
    if(result.status==='cancelled'){notice.textContent='已取消选择文件。';return;}
    grant=result.grantId??result.importGrantId??grant;
    const count=result.instanceIds?.length??0;
    notice.textContent=result.status==='source-saved-check-blocked'?`已加入 ${count} 个独立对象。检查暂不可用：${result.job?.error?.code??result.job?.reason??'请检查引擎状态'}。`:`已加入 ${count} 个独立对象并提交检查。通过后请到顶部“检查记录”预览并应用。`;
    const job=result.job;if(job?.id){notice.dataset.jobId=job.id;pending={id:job.id,count};buttons();void pollJob();}
  }
  async function install(method,params={}) {
    if(pending||installing)throw Error('请等待本次检查结束。');
    if(attempt&&attempt.method!==method)throw Error('请先重试上次结果未确认的安装。');
    attempt??={method,params:{operationId:crypto.randomUUID(),...params}};
    const epoch=generation;installing=true;buttons();
    try {const result=await invoke(method,attempt.params);showInstall(result);attempt=null;}
    finally {if(epoch===generation){installing=false;buttons();}}
  }
  const importer=submit('导入作品 ZIP 并检查',()=>install('importSource'));
  const repeat=submit('再次安装为独立对象',async()=>{if(!grant)throw Error('请先导入作品');return install('repeatImportSource',{grantId:grant});});repeat.button.disabled=true;
  const retryQuery=submit('重试查询本次检查',()=>pollJob());retryQuery.form.hidden=true;
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
    if(!pending)notice.textContent=`已读取源码版本 ${result.revision}。导出不会包含玩家当前进度。${result.truncated?'当前只列出前 512 个对象。':''}`;
  }
  return {async show(){generation++;stopPolling();visible=true;source=null;installing=false;if(activeWorld!==getWorldId()){activeWorld=getWorldId();grant=null;attempt=null;pending=null;}buttons();retryQuery.form.hidden=true;gameExport.clear();gameExport.show();element.replaceChildren(text('h2','Godot 作品'),text('p','导出一个对象及其子节点，或把作品 ZIP 加入当前源码。安装后需检查、预览并应用。'),gameExportElement,notice,importer.form,repeat.form,retryQuery.form,refresh.form,list,exporter.form);if(pending)void pollJob();await refreshSource();},clear(){generation++;stopPolling();visible=false;source=null;installing=false;gameExport.clear();},refresh:refreshSource};
}
