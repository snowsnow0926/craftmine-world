const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="craftmine-token"]').content;
let client = sessionStorage.getItem('craftmine-client');
if (!client) { client = crypto.randomUUID(); sessionStorage.setItem('craftmine-client',client); }
let project, activeFrame, selected=null, target=null, applying=false, connected=false, currentView='play';
let saveChain=Promise.resolve(), refreshing=false, renderKey='', messagesKey='', toastTimer;
const frames=new Map(), requests=new Map();
async function api(route, body) {
  const response=await fetch(route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Craftmine-Token':token,'X-Craftmine-Client':client},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'本地服务请求失败');return result;
}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,7000);}
function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function button(text,action){const e=node('button',text,'subtle');e.type='button';e.onclick=()=>action().catch(error=>toast(error.message));return e;}
function post(frame,type,payload={}){frame.element.contentWindow.postMessage({channel:'craftmine-host/1',nonce:frame.nonce,type,...payload},'*');}
function removeFrame(frame){if(!frame)return;frames.delete(frame.nonce);frame.element.remove();clearTimeout(frame.timer);}
function mount(build,snapshot){return new Promise((resolve,reject)=>{
  const nonce=crypto.randomUUID(),element=document.createElement('iframe');
  element.title='可游玩的 3D 世界';element.className='staging';element.setAttribute('sandbox','allow-scripts allow-pointer-lock');element.src='/game#'+nonce;
  const record={nonce,element,build,snapshot,version:build.id,resolve,reject};frames.set(nonce,record);
  record.timer=setTimeout(()=>{removeFrame(record);reject(Error('世界载入超时，原版本仍保留'));},20000);
  $('game-wrap').append(element);
});}
function requestSnapshot(frame,freeze=false){return new Promise((resolve,reject)=>{
  if(!frame){reject(Error('世界还没有载入'));return;}
  const requestId=crypto.randomUUID(),timer=setTimeout(()=>{requests.delete(requestId);reject(Error('读取最新进度超时，未应用更新'));},5000);
  requests.set(requestId,{resolve,reject,timer,frame});post(frame,'snapshot',{requestId,freeze});
});}
window.addEventListener('message',event=>{
  const m=event.data,frame=frames.get(m?.nonce);
  if(!frame||event.source!==frame.element.contentWindow||m.channel!=='craftmine-game/1'||event.origin!=='null')return;
  if(m.type==='ready')post(frame,'load',{build:frame.build,snapshot:frame.snapshot});
  if(m.type==='loaded'){
    if(m.version!==frame.version){frame.reject?.(Error('运行版本不匹配'));return;}
    frame.snapshot=m.snapshot;frame.renderer=m.renderer;clearTimeout(frame.timer);frame.resolve?.(frame);frame.resolve=null;frame.reject=null;
  }
  if(m.type==='error'){
    if(frame.reject){clearTimeout(frame.timer);frame.reject(Error(m.message));removeFrame(frame);}
    else if(frame===activeFrame)toast(m.message);
  }
  if(m.type==='snapshot'){
    const request=requests.get(m.requestId);if(!request||request.frame!==frame)return;
    clearTimeout(request.timer);requests.delete(m.requestId);frame.snapshot=m.snapshot;request.resolve(m.snapshot);
  }
  if(frame!==activeFrame||applying)return;
  if(m.type==='state'){
    frame.snapshot=m.snapshot;target=m.selected;
    $('renderer').textContent=`${m.renderer} · ${m.fps||'—'} FPS`;
    const p=m.snapshot.player;$('position').textContent=`${p.x.toFixed(1)} · ${p.y.toFixed(1)} · ${p.z.toFixed(1)}`;
  }
  if(m.type==='agent'){selected=m.selected;updateContext();$('prompt').focus();}
});
function activate(frame){const old=activeFrame;activeFrame=frame;frame.element.classList.remove('staging');if(old&&old!==frame)removeFrame(old);$('loading').hidden=true;updateWorld();}
function updateWorld(){if(!activeFrame)return;const scene=activeFrame.build.scene;$('world-title').textContent=scene.title;$('world-count').textContent=scene.objects.length?`${scene.objects.length} 个对象 · 由你的想法创造`:'一片空地，等一个想法。';if(!scene.objects.some(o=>o.id===selected))selected=null;updateContext();}
function updateContext(){const object=activeFrame?.build.scene.objects.find(o=>o.id===selected);$('context-label').textContent=object?'◎ '+object.name+' · '+object.id:'◎ 当前世界';$('clear-context').hidden=!object;}
function switchView(view){currentView=view;for(const name of ['play','develop','assets'])$(name).hidden=name!==view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view!=='play'&&activeFrame)post(activeFrame,'pause');}
function render(){
  if(!project)return;
  $('provider').textContent=project.provider.available?'● Codex 已登录':'○ 需要连接 LLM';$('provider').title=project.provider.message;
  $('version').textContent='v'+(project.history.length)+ ' · 当前可玩';
  const task=project.tasks.at(-1),running=task&&['running','validating','cancelling'].includes(task.status);
  $('send').disabled=!connected||applying||!project.provider.available||($('intent').value==='execute'&&(!!running||!!project.candidate));
  $('apply').disabled=applying;$('discard').disabled=applying;
  const statuses={running:'正在创造',validating:'正在检查',cancelling:'正在停止执行',ready:'候选已就绪',failed:'任务未完成',cancelled:'任务已取消',interrupted:'任务已中断',discussed:'讨论已完成',unchanged:'场景没有变化',applied:'已应用到世界',discarded:'候选已丢弃'};
  $('task-status').hidden=!task;
  if(task){$('task-stage').textContent=statuses[task.status]||task.status;$('task-log').textContent=task.error||task.logs.at(-1)?.text||'';$('cancel').hidden=!running;$('cancel').disabled=task.status==='cancelling';}
  const c=project.candidate;$('candidate').hidden=!c;
  if(c){$('candidate-title').textContent=c.summary;const systems=c.diff.systems,changes=systems?[...systems.added,...systems.changed,...systems.removed]:[];$('candidate-detail').textContent=`对象：新增 ${c.diff.added.length} · 修改 ${c.diff.changed.length} · 移除 ${c.diff.removed.length}。${changes.length?'玩法：'+changes.join('、')+'。':''}应用时保存最新进度，成功后记住新成果。`;}
  const mk=JSON.stringify(project.messages);
  if(mk!==messagesKey){messagesKey=mk;if(project.messages.length){const atBottom=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<80;$('messages').replaceChildren();for(const m of project.messages){const e=node('div',undefined,'message '+m.role);e.append(node('div',m.role==='user'?'你':m.role==='assistant'?'创作助手':'项目记录','who'),node('div',m.text));$('messages').append(e);}if(atBottom||project.messages.at(-1)?.role==='user')$('messages').scrollTop=$('messages').scrollHeight;}}
  const rk=JSON.stringify([project.tasks,project.history,project.current,project.library,project.candidate?.id]);if(rk===renderKey)return;renderKey=rk;
  $('task-list').replaceChildren();
  if(!project.tasks.length)$('task-list').append(node('p','从右侧描述第一个想法，开发记录会出现在这里。','empty'));
  for(const t of [...project.tasks].reverse()){
    const e=node('article',undefined,'record'),row=node('div');row.append(node('strong',t.prompt),node('small',statuses[t.status]||t.status));e.append(row);
    const details=node('details'),summary=node('summary','执行记录'),logs=node('ol');for(const log of t.logs)logs.append(node('li',new Date(log.time).toLocaleTimeString()+' · '+log.text));details.append(summary,logs);
    if(t.usage)details.append(node('p',`实际用量：输入 ${t.usage.input_tokens??'—'} / 输出 ${t.usage.output_tokens??'—'} tokens`));
    if(t.memories?.length)details.append(node('p','读取的创作记忆：'+t.memories.map(m=>`${m.name} v${m.version}`).join('、')));
    if(t.usedModules?.length)details.append(node('p','生成结果引用了 '+t.usedModules.length+' 个模块版本。'));
    if(t.error)details.append(node('p',t.error));
    if(t.build)details.append(button('查看实际场景产物',async()=>{const build=await api('/api/build?id='+t.build);const code=node('pre',JSON.stringify(build.scene,null,2));code.className='source-preview';details.append(code);}));
    e.append(details);$('task-list').append(e);
  }
  $('history-list').replaceChildren();
  for(const h of [...project.history].reverse()){
    const e=node('article',undefined,'record'),row=node('div');row.append(node('strong',h.summary));
    if(h.id===project.current)row.append(node('small','当前场景'));else row.append(button('准备恢复此版本',async()=>{await api('/api/rollback',{id:h.id});await refresh();}));
    e.append(row,node('p',`${new Date(h.time).toLocaleString()} · ${h.id}`));$('history-list').append(e);
  }
  renderObjects();
}
function renderObjects(){
  $('object-list').replaceChildren();const objects=activeFrame?.build.scene.objects||[];
  if(!objects.length)$('object-list').append(node('p','世界里还没有对象。先说说你想创造什么。','empty'));
  for(const o of objects){const e=node('article',undefined,'object-card');e.append(node('div','◇','object-icon'),node('h3',o.name),node('p',`${o.parts.length} 个几何部分 · ${o.parts.some(p=>p.solid!==false)?'含实体碰撞':'可自由穿行'}${o.components?.health?' · 生命值 '+o.components.health:''}`),button('选中并继续修改 ↗',async()=>{selected=o.id;updateContext();$('prompt').focus();}));const binding=project.moduleBindings?.object[o.id];if(binding)e.append(node('small','已记住 · v'+binding.version,'memory-badge'));$('object-list').append(e);}
  $('system-list').replaceChildren();
  for(const s of activeFrame?.build.scene.systems||[]){const e=node('article',undefined,'system-card');e.append(node('strong',s.name),node('small',s.type==='health'?'显示生命值 · 受伤与复活':s.type==='ranged'?'1 装备 · 左键射击 · R 换弹':'2 装备 · 左键 / F 近战'));$('system-list').append(e);}
  if(!$('system-list').children.length)$('system-list').append(node('p','还没有启用玩法。可以说：“增加 100 点生命值”或“增加射击和一个训练靶”。','empty'));
  renderLibrary();
}
function downloadJSON(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function reuseModule(id,moduleVersion){if(applying)throw Error('请等待当前更新结束');const snap=await requestSnapshot(activeFrame);await api('/api/modules/reuse',{id,moduleVersion,version:activeFrame.version,player:snap.player});await refresh();switchView('play');toast('已从记忆中读取模块。应用候选后进入世界，无需重新生成。');}
function renderLibrary(){
  const list=$('memory-list');list.replaceChildren();const query=$('memory-search').value.trim().toLowerCase();
  const modules=(project.library||[]).filter(m=>(m.name+' '+m.description).toLowerCase().includes(query));
  $('memory-count').textContent=(project.library||[]).length+' 个创作模块';
  if(!modules.length)list.append(node('p',query?'没有匹配的记忆。':'应用一次创造后，这里会记住它。模块会保存在本机，关闭程序后也能复用。','empty'));
  for(const m of [...modules].reverse()){
    const e=node('article',undefined,'module-card');e.dataset.moduleId=m.id;
    const title=node('div',undefined,'module-heading');title.append(node('span',m.kind==='object'?'◇':'⚙','module-icon'),node('h3',m.name),node('small',m.kind==='object'?'对象':'玩法'));e.append(title);
    e.append(node('p',m.description||'来自你的创作','module-description'));
    const versions=node('select');versions.setAttribute('aria-label',m.name+' 的版本');for(const v of [...m.versions].reverse()){const option=node('option',`v${v.version}${v.version===m.latest?' · 最新':''}`);option.value=String(v.version);versions.append(option);}
    const actions=node('div',undefined,'module-actions'),use=button('复用到世界 ↗',async()=>reuseModule(m.id,Number(versions.value)));use.disabled=!!project.candidate||applying||project.tasks.some(t=>['running','validating','cancelling'].includes(t.status));actions.append(versions,use);
    actions.append(button('导出',async()=>{const module=await api('/api/modules/export?id='+encodeURIComponent(m.id)+'&version='+versions.value);downloadJSON(module,`craftmine-module-${m.id}-v${versions.value}.json`);}));e.append(actions);
    const details=node('details'),summary=node('summary','查看保存的定义'),content=node('pre',undefined,'source-preview');details.append(summary,content);details.ontoggle=async()=>{if(details.open)try{content.textContent=JSON.stringify(await api('/api/modules/export?id='+encodeURIComponent(m.id)+'&version='+versions.value),null,2);}catch(error){toast(error.message);}};versions.onchange=()=>{details.open=false;};e.append(details);list.append(e);
  }
}
async function refresh(){if(refreshing)return;refreshing=true;try{project=await api('/api/state');connected=true;render();}catch(error){connected=false;$('send').disabled=true;$('save-status').textContent='○ 连接中断：'+error.message;}finally{refreshing=false;}}
function saveCurrent(){
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    if(applying||!activeFrame)return;
    const frame=activeFrame,snapshot=await requestSnapshot(frame);await api('/api/save',{version:frame.version,snapshot});$('save-status').textContent='● 最新进度已保存在本机';
  });return saveChain;
}
async function applyCandidate(){
  if(applying||!project?.candidate)return;applying=true;render();switchView('play');
  let transaction,next,uncertain=false;const old=activeFrame;
  try {
    await saveChain.catch(()=>{});
    const latest=await requestSnapshot(old,true);
    transaction=await api('/api/apply/prepare',{candidateId:project.candidate.id,version:old.version,snapshot:latest});
    $('loading').textContent='正在让你的想法进入世界…';$('loading').hidden=false;
    next=await mount(await api('/api/build?id='+transaction.candidate),transaction.loadSnapshot);
    await api('/api/apply/commit',{id:transaction.id,snapshot:next.snapshot});
    activate(next);toast('世界已更新。继续走走，看看你的创造。');
  }catch(error){
    if(!transaction){const remote=await api('/api/state').catch(()=>null);if(remote?.applying?.previous===old.version)transaction=remote.applying;else if(!remote)uncertain=true;}
    if(transaction){
      const remote=await api('/api/state').catch(()=>null);
      if(remote?.lastCommit===transaction.id&&!remote.applying&&next){activate(next);toast('更新已保存，连接已恢复。');}
      else if(remote&&remote.current===transaction.previous){
        try { await api('/api/apply/abort',{id:transaction.id});removeFrame(next);post(old,'resume');$('loading').hidden=true;toast('未应用更新，已回到原世界：'+error.message); }
        catch { uncertain=true; }
      }else uncertain=true;
    }else {post(old,'resume');toast('没有切换世界：'+error.message);}
  }finally{
    if(uncertain){$('loading').hidden=false;$('loading').textContent='连接中断，已保留存档。请刷新工作台以核对当前版本。';}
    else{applying=false;await refresh();renderObjects();}
  }
}
$('composer').onsubmit=async event=>{
  event.preventDefault();const prompt=$('prompt').value.trim();if(!prompt||$('send').disabled)return;
  $('send').disabled=true;
  try{const snapshot=await requestSnapshot(activeFrame);await api('/api/tasks',{prompt,intent:$('intent').value,version:activeFrame.version,context:{player:snapshot.player,selected}});$('prompt').value='';await refresh();}catch(error){toast(error.message);render();}
};
$('prompt').addEventListener('focus',()=>{if(activeFrame)post(activeFrame,'pause');});
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('composer').requestSubmit();}});
$('intent').onchange=render;
$('memory-search').oninput=renderLibrary;
$('module-import-button').onclick=()=>$('module-import-file').click();
$('module-import-file').onchange=async()=>{const file=$('module-import-file').files[0];if(!file)return;try{if(file.size>300000)throw Error('模块文件过大');await api('/api/modules/import',JSON.parse(await file.text()));await refresh();toast('模块已记入本地库，可选择版本复用到世界。');}catch(error){toast(error.message);}finally{$('module-import-file').value='';}};
$('example').onclick=()=>{$('prompt').value='我想要有树';$('prompt').focus();};
$('clear-context').onclick=()=>{selected=null;target=null;updateContext();};
$('apply').onclick=applyCandidate;
$('discard').onclick=async()=>{try{await api('/api/discard',{});await refresh();}catch(error){toast(error.message);}};
$('cancel').onclick=async()=>{try{await api('/api/cancel',{});await refresh();}catch(error){toast(error.message);}};
$('respawn').onclick=()=>{if(activeFrame&&!applying)post(activeFrame,'respawn');};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('export').onclick=async()=>{try{if(applying)throw Error('请等待当前更新结束');await saveCurrent();const data=await api('/api/export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='craftmine-world-save-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('完整场景和最新位置已导出。');}catch(error){toast(error.message);}};
$('import-button').onclick=()=>$('import-file').click();
$('import-file').onchange=async()=>{
  const file=$('import-file').files[0];if(!file)return;
  try{
    if(applying)throw Error('请等待当前更新结束');if(file.size>1_500_000)throw Error('文件超过大小限制');
    const data=JSON.parse(await file.text());await saveCurrent();
    await api('/api/import',data);await refresh();switchView('play');toast('存档校验通过。点击应用后恢复文件中的世界与位置，当前世界会先备份。');
  }catch(error){toast(error.message);}finally{applying=false;$('import-file').value='';await refresh();renderObjects();}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&activeFrame&&!applying){fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json','X-Craftmine-Token':token,'X-Craftmine-Client':client},body:JSON.stringify({version:activeFrame.version,snapshot:activeFrame.snapshot}),keepalive:true}).catch(()=>{});}});
async function boot(){
  try{await api('/api/session',{});project=await api('/api/state');if(project.applying){await api('/api/apply/abort',{id:project.applying.id});project=await api('/api/state');}connected=true;render();activate(await mount(await api('/api/build?id='+project.current),project.snapshot));renderObjects();$('save-status').textContent='● 世界已从本机载入';}
  catch(error){$('loading').textContent=error.message;toast(error.message);}
  setInterval(refresh,1800);
  setInterval(()=>saveCurrent().catch(error=>{$('save-status').textContent='○ 未保存：'+error.message;}),3000);
}
boot();
