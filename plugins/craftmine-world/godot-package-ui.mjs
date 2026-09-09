// Godot component presentation. Files, source authority and installation stay native.
const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
const field=(label,type='input')=>{const wrapper=text('label',''),control=document.createElement(type);wrapper.append(text('span',label),control);return {wrapper,control};};
export function createGodotPackageUI({element,request,getWorldId,action=run=>run()}) {
  let generation=0,source=null,grant=null,attempt=null;
  const notice=text('p',''),choices=field('选择要导出的对象','select'),asset=field('作品编号'),version=field('版本号');
  notice.className='workbench-notice';
  notice.setAttribute('role','status');asset.control.value='my-component';asset.control.pattern='[a-z0-9][a-z0-9._-]{0,79}';asset.control.required=true;
  version.control.type='number';version.control.min='1';version.control.max='100000';version.control.value='1';version.control.required=true;
  const submit=(label,run)=>{const form=document.createElement('form'),button=text('button',label);form.className='workbench-form';button.type='submit';form.append(button);form.onsubmit=event=>{event.preventDefault();void action(run);};return {form,button};};
  async function invoke(method,params={}) {const epoch=generation,worldId=getWorldId();if(!worldId)throw Error('请先打开世界');const result=await request('package.request',{worldId,method,params:{...params,worldId}});if(epoch!==generation||worldId!==getWorldId())throw Error('WORLD_CHANGED');return result;}
  function showInstall(result) {
    if(result.status==='cancelled'){notice.textContent='已取消选择文件。';return;}
    grant=result.grantId??result.importGrantId??grant;repeat.button.disabled=!grant;
    const count=result.instanceIds?.length??0;
    notice.textContent=result.status==='source-saved-check-blocked'?`已加入 ${count} 个独立对象。检查暂不可用：${result.job?.error?.code??result.job?.reason??'请检查引擎状态'}。`:`已加入 ${count} 个独立对象并提交检查。通过后请到顶部“检查记录”预览并应用。`;
    const job=result.job;if(job?.id)notice.dataset.jobId=job.id;
  }
  async function install(method,params={}) {
    if(attempt&&attempt.method!==method)throw Error('请先重试上次结果未确认的安装。');
    attempt??={method,params:{operationId:crypto.randomUUID(),...params}};
    const result=await invoke(method,attempt.params);showInstall(result);attempt=null;
  }
  const importer=submit('导入作品 ZIP 并检查',()=>install('importSource'));
  const repeat=submit('再次安装为独立对象',async()=>{if(!grant)throw Error('请先导入作品');return install('repeatImportSource',{grantId:grant});});repeat.button.disabled=true;
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
    notice.textContent=`已读取源码版本 ${result.revision}。导出不会包含玩家当前进度。`;
  }
  return {async show(){generation++;source=null;grant=null;attempt=null;repeat.button.disabled=true;element.replaceChildren(text('h2','Godot 作品'),text('p','导出一个对象及其子节点，或把作品 ZIP 加入当前源码。安装后需检查、预览并应用。'),notice,importer.form,repeat.form,refresh.form,list,exporter.form);await refreshSource();},clear(){generation++;source=null;grant=null;attempt=null;},refresh:refreshSource};
}
