import {createWorkbench} from './workbench-ui.mjs';
const initialWorld = CRAFTMINE_BOOT_WORLD;
const gameDocument = CRAFTMINE_GAME_DOCUMENT;
const frame = document.querySelector('iframe');
const status = document.getElementById('world-status');
const select = document.getElementById('world-list');
const saveButton = document.getElementById('save-world');
const newButton = document.getElementById('new-world');
const importButton = document.getElementById('import-world');
const form = document.getElementById('create-form');
const errorBox = document.getElementById('error');
const bridge = globalThis.pluginBridge;
const requests = new Map();
let current, nonce, loaded=false, busy=false, closing=false, lastSaved='';
let activeOperation=Promise.resolve();
let closeOperation, closeGeneration=0;
const checksPanel=document.getElementById('checks-panel');
const previewPanel=document.getElementById('preview-panel');
let previewFrame=null;
let preview=null,checkOffset=0,checkWorld=null,checksLoading=false,evidenceJob=null,evidenceNext=null;
let previewReview=null,reviewLoading=false,applicationAttempt=null;
let workbench;
// Height in CSS pixels that the Electron host reserves at the top of the panel
// for this page's chrome (header + modes bar). A sibling WebContentsView with
// the Godot game is positioned directly below that offset, so the placeholder
// region must start exactly here. Keep in sync with WORLD_CHROME_HEIGHT in
// desktop/godot/web/runtime.mjs.
const GODOT_CHROME_HEIGHT = 76;
document.documentElement.style.setProperty('--godot-chrome',GODOT_CHROME_HEIGHT+'px');
// Godot worlds run in the sibling Electron view, not in the voxel srcdoc iframe.
let godot=false;
const godotStateLabels={loading:'载入中',ready:'已就绪',paused:'已暂停',saving:'保存中',saved:'已保存',failed:'运行失败',closed:'已关闭'};
function isGodotWorld(record) {
  return record?.world?.build?.engine?.kind==='godot-web' ||
    record?.world?.build?.scene?.format==='craftmine.godot-scene/1';
}

function applyAppearance(appearance) {
  if(appearance?.base==='light'||appearance?.base==='dark') {
    document.documentElement.style.colorScheme=appearance.base;
    document.documentElement.dataset.theme=appearance.base;
  }
}
if(bridge) {
  void bridge.invoke('app.getAppearance').then(applyAppearance).catch(()=>{});
  bridge.on?.('appearance:changed',applyAppearance);
  bridge.on?.('godot-world:state',onGodotState);
}

// State is broadcast by the Electron host; this page never infers it.
function onGodotState(payload) {
  if(!godot||!payload||payload.worldId!==current?.id)return;
  const state=String(payload.state||'');
  const label=godotStateLabels[state]||state;
  document.body.dataset.godotState=state;
  status.textContent=label;
  if(state==='failed') {
    // Reuse the shared error banner, but keep the state label in the status.
    showError(Error(payload.error||'Godot 世界运行失败'));
    status.textContent=label;
  } else delete status.dataset.error;
  if(state==='ready'||state==='saved')document.body.dataset.worldLoaded='true';
  else if(state==='loading'||state==='failed'||state==='closed')delete document.body.dataset.worldLoaded;
}

function send(type, value = {}) {
  // Godot worlds never speak the voxel host protocol; the host owns the game view.
  if(godot)return;
  frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type,...value}, '*');
}

function showError(error) {
  errorBox.textContent=String(error.message||error);errorBox.hidden=false;
  status.textContent='操作未完成';status.dataset.error='true';
}

function controls() {
  select.disabled=!bridge||busy||closing||!!preview||!!applicationAttempt||!!workbench?.busy;newButton.disabled=select.disabled;saveButton.disabled=select.disabled||!loaded||godot;
  if(godot){saveButton.title='Godot 世界由宿主自动保存';saveButton.setAttribute('aria-label','保存（Godot 世界由宿主自动保存）');}
  else {saveButton.removeAttribute('title');saveButton.removeAttribute('aria-label');}
  importButton.disabled=select.disabled;
  document.getElementById('close-preview').disabled=busy||closing||!!applicationAttempt;
  document.getElementById('apply-world').disabled=busy||closing||!!applicationAttempt||!preview||!previewReview?.current||previewReview.status!=='completed'||!previewReview.acceptance?.passed;
  const warnings=document.getElementById('apply-world-warnings');
  warnings.hidden=previewReview?.status!=='completed'||previewReview.acceptance?.passed!==false;
  warnings.disabled=busy||closing||!!applicationAttempt||!preview||!previewReview?.current||warnings.hidden;
  document.getElementById('retry-review').disabled=busy||closing||!!applicationAttempt;
  document.getElementById('cancel-review').disabled=busy||closing;
  frame.inert=closing||!!applicationAttempt;
}

function action(run) {
  if(busy||closing)return Promise.resolve();
  busy=true;controls();errorBox.hidden=true;delete status.dataset.error;
  activeOperation=(async()=>{
    try {return await run();}catch(error){if(!applicationAttempt)send('resume');showError(error);}
    finally {busy=false;controls();}
  })();
  return activeOperation;
}

function snapshot({freeze=false}={}) {
  // Kept callable for Godot worlds: the host snapshots the running game itself.
  if(godot)return Promise.resolve({godot:true,snapshot:null});
  if(!loaded)return Promise.reject(Error('世界仍在载入'));
  return new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();
    const timer=setTimeout(()=>{requests.delete(requestId);reject(Error('读取世界超时'));},5000);
    requests.set(requestId,{resolve,reject,timer});send('snapshot',{requestId,freeze});
  });
}

async function save({freeze=false}={}) {
  // The Electron host owns the Godot save transaction; this page must not
  // snapshot or call world.saveProgress for a Godot world.
  if(godot)throw Error('Godot 世界保存服务尚未接入，未切换世界');
  if(applicationAttempt)await reconcileApplication();
  if(!bridge||!loaded||!current?.id)return;
  const result=await snapshot({freeze});
  const serialized=JSON.stringify(result.snapshot);
  if(freeze||serialized!==lastSaved) {
    status.textContent='保存中…';
    current=await bridge.invoke('world.saveProgress',{id:current.id,revision:current.revision,baseBuild:current.world.build.id,snapshot:result.snapshot});
    lastSaved=serialized;
  }
  status.textContent='已保存';
  return {worldId:current.id,revision:current.revision,buildId:current.world.build.id};
}

function cancelClose() {
  closeGeneration++;closing=false;controls();if(!applicationAttempt)send('resume');
}

function prepareClose() {
  // Nothing to snapshot from this page for a Godot world: the host saves and
  // exits the sibling runtime view before the panel view closes.
  if(godot)return Promise.resolve({loaded:false,godot:true});
  if(closing&&closeOperation)return closeOperation;
  const generation=++closeGeneration, previous=activeOperation;
  closing=true;controls();
  closeOperation=(async()=>{
    try {
      await previous;
      if(applicationAttempt)await reconcileApplication();
      if(generation!==closeGeneration)throw Error('退出已取消');
      busy=true;controls();
      closePreview(false);
      if(!loaded)return {loaded:false};
      const checkpoint=await save({freeze:true});
      if(generation!==closeGeneration)throw Error('退出已取消');
      return {loaded:true,...checkpoint};
    }catch(error){
      if(generation===closeGeneration)cancelClose();
      showError(error);throw error;
    }finally{busy=false;controls();}
  })();
  activeOperation=closeOperation.catch(()=>{});
  return closeOperation;
}

async function refreshList() {
  const {worlds}=await bridge.invoke('world.list');
  select.replaceChildren(...worlds.map(world=>{const option=document.createElement('option');option.value=world.id;option.textContent=world.title;return option;}));
  if(current)select.value=current.id;
}

function mount(record) {
  closePreview(false);
  checkWorld=null;checkOffset=0;document.getElementById('check-detail').hidden=true;
  document.getElementById('checks-list').replaceChildren();setMode(false);
  for(const pending of requests.values()){clearTimeout(pending.timer);pending.reject(Error('世界已切换'));}requests.clear();
  current=record;loaded=false;nonce=crypto.randomUUID();lastSaved=JSON.stringify(record.world.snapshot);
  godot=isGodotWorld(record);
  document.getElementById('import-result').hidden=true;
  document.body.dataset.worldId=record.id||'';delete document.body.dataset.worldLoaded;delete document.body.dataset.worldError;
  delete document.body.dataset.godotState;
  if(godot) {
    // Godot worlds are rendered by a sibling Electron view over #godot-surface;
    // this page only draws the chrome and the placeholder region.
    document.body.dataset.godot='true';
    frame.removeAttribute('srcdoc');
    status.textContent='载入中';
  } else {
    delete document.body.dataset.godot;
    status.textContent='正在载入';
    frame.srcdoc=gameDocument.replace('__CRAFTMINE_NONCE__',nonce).replace('__CRAFTMINE_INPUT_GUARD__',globalThis.__craftmineHeadless?CRAFTMINE_INPUT_GUARD:'');
  }
  controls();
  void workbench?.setWorld();
}

addEventListener('message',event=>{
  const message=event.data;
  if(godot)return;
  if(event.source!==frame.contentWindow||message?.channel!=='craftmine-game/1'||message.nonce!==nonce)return;
  if(message.type==='ready')send('load',{...current.world,worldId:current.id});
  if(message.type==='selection')void workbench?.setSelection(message);
  if(message.type==='loaded') {
    if(message.version!==current.world.build.id){showError(Error('载入版本不一致'));return;}
    loaded=true;status.textContent=bridge?'已保存':'本地预览';
    document.body.dataset.worldLoaded='true';controls();
  }
  if(message.type==='error') {
    showError(Error(message.message));document.body.dataset.worldError=message.message;
  }
  const pending=requests.get(message.requestId);
  if(pending){requests.delete(message.requestId);clearTimeout(pending.timer);message.type==='error'?pending.reject(Error(message.message)):pending.resolve(message);}
});

// Only the trusted product panel owns this lifecycle surface. Authored code
// lives in the opaque game iframe and cannot reach it.
globalThis.craftmineView=Object.freeze({snapshot,prepareClose,cancelClose,navigate,showChecks:()=>setMode(true),showWorkbench:tab=>openWorkbench(tab),review:id=>action(async()=>{setMode(true);await showEvidence(id);}),preview:id=>action(()=>openPreview(id)),closePreview});

// Both navigation columns use the same live-view save sequence. Reject busy
// requests explicitly; action() deliberately absorbs errors for DOM handlers.
async function navigate(request) {
  if(busy||closing||preview||applicationAttempt||workbench?.busy)throw Error('WORLD_BUSY');
  if(!bridge||!loaded||!current?.id)throw Error('WORLD_VIEW_UNAVAILABLE');
  if(!['switch','create'].includes(request?.operation))throw Error('INVALID_NAVIGATION_REQUEST');
  if(request.operation==='switch'&&request.id===current.id)return {ok:true,activeWorldId:current.id};
  busy=true;controls();errorBox.hidden=true;
  const previous=current.id;
  activeOperation=(async()=>{
    try {
      let target;
      if(request.operation==='switch') {
        target=await bridge.invoke('world.read',{id:request.id});
        if(isGodotWorld(target))throw Error('GODOT_RUNTIME_UNAVAILABLE');
      }
      await save({freeze:true});
      if(request.operation==='create')target=await bridge.invoke('world.create',{
        title:request.title,baseId:request.baseId,starterId:request.starterId,activate:false,
      });
      const record=await bridge.invoke('world.open',{id:target.id});
      mount(record);
      // A failed list refresh cannot undo a completed switch.
      await refreshList().catch(showError);
      return request.operation==='create'?{id:record.id,title:record.title}:{ok:true,activeWorldId:record.id};
    } catch(error) {
      if(current?.id===previous)send('resume');
      showError(error);throw error;
    } finally {busy=false;controls();select.value=current?.id||'';}
  })();
  return activeOperation;
}

const checkLabels={queued:'等待检查',running:'后台检查中',passed:'机器检查通过',failed:'检查未通过',cancelled:'已取消',interrupted:'已中断'};
function setMode(checks) {
  const leavingWorkbench=!!workbench?.tab;
  void workbench?.show(null);
  for(const item of document.querySelectorAll('[data-workbench-tab]'))item.setAttribute('aria-selected','false');
  checksPanel.hidden=!checks;
  document.getElementById('world-mode').setAttribute('aria-selected',String(!checks));
  document.getElementById('checks-mode').setAttribute('aria-selected',String(checks));
  if(checks){send('pause');void refreshChecks(true);}
  else if(leavingWorkbench&&loaded&&!applicationAttempt&&!preview)send('resume');
}
function openWorkbench(tab){
  if(busy||closing||preview||applicationAttempt)return;
  checksPanel.hidden=true;
  document.getElementById('world-mode').setAttribute('aria-selected','false');document.getElementById('checks-mode').setAttribute('aria-selected','false');
  for(const item of document.querySelectorAll('[data-workbench-tab]'))item.setAttribute('aria-selected',String(item.dataset.workbenchTab===tab));
  return workbench.show(tab);
}
async function refreshChecks(reset=false) {
  if(!bridge||!current?.id||checksLoading||closing)return;
  checksLoading=true;
  const worldId=current.id;
  try {
    if(reset||checkWorld!==worldId){checkOffset=0;checkWorld=worldId;}
    const jobs=await bridge.invoke('verification.list',{worldId,offset:checkOffset,limit:8});
    if(current.id!==worldId)return;
    const list=document.getElementById('checks-list');
    if(!checkOffset)list.replaceChildren();
    for(const job of jobs) {
      const row=document.createElement('article');row.className='check-row';row.dataset.jobId=job.id;row.dataset.state=job.status;
      const title=document.createElement('h3');title.textContent=job.summary;
      const meta=document.createElement('div');meta.className='check-meta';
      meta.textContent=`${checkLabels[job.status]||job.status} · 草稿 ${job.workspaceRevision}${job.current?'':' · 历史版本'} · ${new Date(job.createdAt).toLocaleTimeString()}`;
      const actions=document.createElement('div');actions.className='check-actions';
      const details=document.createElement('button');details.textContent='查看结果';details.onclick=()=>void action(()=>showEvidence(job.id));actions.append(details);
      if(job.status==='passed') {
        const form=document.createElement('form');form.dataset.previewJob=job.id;
        const button=document.createElement('button');button.type='submit';button.textContent='预览副本';
        if(godot){button.disabled=true;button.title='Godot 世界由独立视图运行，暂不支持草稿预览';}
        form.append(button);form.onsubmit=event=>{event.preventDefault();void action(()=>openPreview(job.id));};actions.append(form);
      }
      if(['queued','running'].includes(job.status)) {
        const cancel=document.createElement('button');cancel.textContent='取消检查';
        cancel.onclick=()=>void action(async()=>{await bridge.invoke('verification.cancel',{id:job.id});await refreshChecks(true);});actions.append(cancel);
      }
      row.append(title,meta,actions);list.append(row);
    }
    document.getElementById('checks-empty').hidden=list.children.length>0;
    document.getElementById('checks-more').hidden=jobs.length<8;
    document.getElementById('checks-mode').textContent=jobs.some(j=>['queued','running'].includes(j.status))?'检查记录 · 进行中':'检查记录';
  }catch(error){showError(error);}finally{checksLoading=false;}
}
async function showEvidence(id,start=0) {
  const worldId=current?.id;
  const result=await bridge.invoke('verification.read',{id,start,limit:12000});
  if(current?.id!==worldId)return;
  evidenceJob=id;evidenceNext=result.next;
  document.getElementById('check-detail').hidden=false;
  if(!start) {
    const overview=document.getElementById('check-overview');overview.replaceChildren();
    const line=text=>{const paragraph=document.createElement('p');paragraph.textContent=text;overview.append(paragraph);};
    line(result.overview.checks.map(check=>`${check.passed===true?'✓':check.passed===false?'×':'—'} ${check.name}`).join('　'));
    for(const change of result.overview.changes)if(change.objects+change.behaviors+change.systems)line(`${change.name}：${change.objects} 个对象，${change.behaviors} 个代码玩法，${change.systems} 个系统`);
    if(result.overview.error)line(result.overview.error);
    line(result.current?'打开预览可以查看需求检查、评审建议，并决定是否应用。':'这是历史版本的检查记录。');
  }
  const text=document.getElementById('check-evidence');
  const prefix=`${checkLabels[result.status]||result.status}${result.current?'':' · 历史版本'}\n\n`;
  text.textContent=start?text.textContent+result.text:prefix+result.text;
  document.getElementById('evidence-more').hidden=evidenceNext===null;
}
function closePreview(resume=true) {
  if(!preview)return;
  preview=null;previewReview=null;previewPanel.hidden=true;previewFrame?.remove();previewFrame=null;delete document.body.dataset.previewLoaded;
  if(resume)send('resume');controls();
}
async function openPreview(id) {
  // Draft previews mount the voxel srcdoc runner; Godot worlds run elsewhere.
  if(godot)throw Error('Godot 世界由独立视图运行，暂不支持草稿预览');
  if(preview)closePreview(false);
  await save({freeze:true});
  const result=await bridge.invoke('verification.preview',{id});
  const state={nonce:crypto.randomUUID(),world:result.world,job:result.job};preview=state;previewReview=null;
  previewFrame=document.createElement('iframe');previewFrame.title='草稿预览副本';previewFrame.setAttribute('sandbox','allow-scripts allow-pointer-lock');
  previewPanel.append(previewFrame);
  previewPanel.hidden=false;document.getElementById('preview-title').textContent=result.job.summary;
  document.getElementById('review-state').textContent='正在读取评审…';
  document.getElementById('review-notes').replaceChildren();
  await refreshReview();
  try {
    await new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(timer);removeEventListener('message',receive);error?reject(error):resolve();};
      const receive=event=>{
        const message=event.data;
        if(preview!==state||event.source!==previewFrame.contentWindow||message?.channel!=='craftmine-game/1'||message.nonce!==state.nonce)return;
        if(message.type==='ready')previewFrame.contentWindow.postMessage({channel:'craftmine-host/1',nonce:state.nonce,type:'load',...state.world,preview:true},'*');
        if(message.type==='error')finish(Error(message.message));
        if(message.type==='loaded'){
          if(message.version!==state.world.build.id){finish(Error('预览版本不一致'));return;}
          document.body.dataset.previewLoaded='true';finish();
        }
      };
      const timer=setTimeout(()=>finish(Error('预览载入超时')),15000);
      addEventListener('message',receive);
      previewFrame.srcdoc=gameDocument.replace('__CRAFTMINE_NONCE__',state.nonce).replace('__CRAFTMINE_INPUT_GUARD__',globalThis.__craftmineHeadless?CRAFTMINE_INPUT_GUARD:'');
    });
  }catch(error){closePreview();throw error;}
}
async function refreshReview() {
  if(!preview||reviewLoading||closing)return;
  const state=preview;reviewLoading=true;
  try{
    const records=await bridge.invoke('review.list',{verificationId:state.job.id});
    if(preview!==state)return;
    const review=records[0]||null;previewReview=review;
    const labels={running:'正在评审与检查需求…',failed:'评审未完成',cancelled:'评审已取消',interrupted:'评审已中断'};
    document.getElementById('review-state').textContent=!review?'尚未完成评审':!review.current?'历史草稿 · 请检查最新草稿':
      review.status==='completed'?(review.acceptance?.passed?'评审检查通过 · 可以应用':'评审发现问题 · 请查看后决定是否应用'):labels[review.status]||review.status;
    const notes=document.getElementById('review-notes');notes.replaceChildren();
    const line=text=>{const p=document.createElement('p');p.textContent=text;notes.append(p);};
    if(review?.request?.text)line('你的需求：'+review.request.text);
    if(review?.summary)line(review.summary);
    if(review?.suggestions?.length){line('评审建议（由你决定）：');const ul=document.createElement('ul');for(const text of review.suggestions){const li=document.createElement('li');li.textContent=text;ul.append(li);}notes.append(ul);}
    for(const text of review?.limitations||[])line('仍需体验：'+text);
    for(const assertion of review?.acceptance?.assertions||[])line(`${assertion.passed?'✓':'×'} ${assertion.why||assertion.id}：${assertion.detail}`);
    if(review?.status==='completed'&&review.acceptance?.passed===false)line('以上评审检查未通过。你可以继续修改，或选择“带评审提示应用”；这些结果会保留在记录中。');
    if(review?.error)line(review.error);
    if(!review)line('新检查会自动使用对话里的原始需求与模型评审。旧记录需要在对话中重新提交检查。');
    document.getElementById('retry-review').hidden=!review||!review.current||review.status==='running';
    document.getElementById('cancel-review').hidden=review?.status!=='running';
    if(review?.verdict==='block'||review?.acceptance?.passed===false||review?.error)document.getElementById('review-details').open=true;
  }catch(error){document.getElementById('review-state').textContent='读取评审失败：'+error.message;previewReview=null;}
  finally{reviewLoading=false;controls();}
}

async function applyCandidate(acknowledgeReviewWarnings=false) {
  const state=preview,review=previewReview;
  if(!state||!review?.current||review.status!=='completed'||(!review.acceptance?.passed&&!(acknowledgeReviewWarnings===true&&review.acceptance?.passed===false)))throw Error('请先完成这份草稿的需求检查与评审');
  await save({freeze:true});
  const args={operationId:crypto.randomUUID(),verificationId:state.job.id,reviewId:review.id,worldId:current.id,revision:current.revision,...(acknowledgeReviewWarnings?{acknowledgeReviewWarnings:true}:{})};
  applicationAttempt=args;status.textContent='正在检查最新进度并应用…';
  try{
    const result=await bridge.invoke('candidate.apply',args);
    if(result.status!=='applied')throw Error('应用尚未提交');
    applicationAttempt=null;mount(result.record);await refreshList();
  }catch(error){
    try{
      const recovered=await bridge.invoke('candidate.applicationState',{operationId:args.operationId,worldId:args.worldId});
      if(recovered.status==='applied'){applicationAttempt=null;mount(recovered.record);await refreshList();return;}
      if(['aborted','interrupted'].includes(recovered.status))applicationAttempt=null;
    }catch{}
    throw error;
  }
}
async function reconcileApplication() {
  const attempt=applicationAttempt;if(!attempt)return;
  let result;
  try{result=await bridge.invoke('candidate.applicationState',{operationId:attempt.operationId,worldId:attempt.worldId});}
  catch(error){if(String(error.message).includes('APPLICATION_NOT_FOUND')){applicationAttempt=null;return;}throw error;}
  if(applicationAttempt!==attempt)return;
  if(result.status==='applied'){applicationAttempt=null;mount(result.record);await refreshList();return;}
  if(['aborted','interrupted'].includes(result.status)){applicationAttempt=null;send('resume');return;}
  throw Error('应用结果尚在确认，原世界保持暂停。');
}
document.getElementById('world-mode').onclick=()=>setMode(false);
document.getElementById('checks-mode').onclick=()=>setMode(true);
document.getElementById('close-preview').onclick=()=>closePreview();
document.getElementById('apply-form').onsubmit=event=>{event.preventDefault();const acknowledged=event.submitter?.id==='apply-world-warnings';void action(()=>applyCandidate(acknowledged));};
document.getElementById('retry-review').onclick=()=>void action(async()=>{await bridge.invoke('review.start',{verificationId:preview.job.id});await refreshReview();});
document.getElementById('cancel-review').onclick=()=>void action(async()=>{await bridge.invoke('review.cancel',{id:previewReview.id});await refreshReview();});
document.getElementById('checks-more').onclick=()=>{checkOffset+=8;void refreshChecks();};
document.getElementById('evidence-more').onclick=()=>void action(()=>showEvidence(evidenceJob,evidenceNext));
setInterval(()=>{if(!busy&&!closing&&!checksPanel.hidden&&!preview&&checkOffset===0)void refreshChecks();},2500);
setInterval(()=>{if(preview&&!busy&&!closing)void refreshReview();},2500);
setInterval(()=>{if(applicationAttempt&&!busy&&!closing)void action(reconcileApplication);},2500);

workbench=createWorkbench({
  element:document.getElementById('workbench-panel'),selectionElement:document.getElementById('selection-context'),
  request:(channel,payload)=>bridge?bridge.invoke(channel,payload):Promise.reject(Error('桌面服务尚未连接')),
  getWorld:()=>current,pause:()=>send('pause'),isLocked:()=>busy||closing||!!applicationAttempt||!!preview,
  onChange:controls,replaceWorld:mount,saveBeforeBackup:()=>save({freeze:true}),
  reloadWorld:async()=>{const result=await bridge.invoke('world.list');const next=result.worlds.find(item=>item.id===result.activeWorldId)||result.worlds[0];if(next){mount(await bridge.invoke('world.open',{id:next.id}));await refreshList();}},
  run:async fn=>{
    if(busy||closing||applicationAttempt||preview)throw Error('请先完成当前世界操作');
    busy=true;controls();activeOperation=Promise.resolve().then(fn);
    try{return await activeOperation;}finally{busy=false;controls();}
  },
});
for(const item of document.querySelectorAll('[data-workbench-tab]'))item.addEventListener('click',()=>void openWorkbench(item.dataset.workbenchTab));
document.getElementById('refresh-workbench').onsubmit=event=>{event.preventDefault();if(!busy&&!closing)void workbench.refreshCapabilities();};
setInterval(()=>{if(!busy&&!closing){if(workbench.tab==='task')void workbench.refresh();else if(workbench.tab)void workbench.refreshPending();}},4000);

saveButton.addEventListener('click',()=>void action(save));
newButton.addEventListener('click',()=>{form.hidden=!form.hidden;});
document.getElementById('import-form').addEventListener('submit',event=>{
  event.preventDefault();void action(async()=>{
  await save({freeze:true});
  status.textContent='选择旧项目文件夹…';
  const picked=await bridge.invoke('fs.requestDirectory');
  if(!picked){send('resume');status.textContent='已保存';return;}
  status.textContent='正在备份并导入…';
  const result=await bridge.invoke('world.importLegacy');
  mount(result.record);await refreshList();
  const note=document.getElementById('import-result');
  note.textContent=`旧世界已导入，${result.archive.files} 个原始文件已备份。历史作品、候选和草稿保存在备份中。`;
  note.hidden=false;
  });
});
document.getElementById('cancel-create').addEventListener('click',()=>{form.hidden=true;});
form.addEventListener('submit',event=>{
  event.preventDefault();
  void navigate({operation:'create',title:document.getElementById('world-name').value})
    .then(()=>{form.hidden=true;form.reset();}).catch(()=>{});
});
select.addEventListener('change',()=>{
  const id=select.value;
  void navigate({operation:'switch',id}).catch(()=>{select.value=current?.id||'';});
});
setInterval(()=>{if(loaded&&!busy&&!closing&&!preview&&bridge)void action(save);},10000);

void action(async()=>{
  if(!bridge) {mount({title:initialWorld.build.scene.title,world:initialWorld});select.options[0].textContent=initialWorld.build.scene.title;return;}
  const state=await bridge.invoke('world.list');
  const selected=state.worlds.find(world=>world.id===state.activeWorldId)||state.worlds[0];
  const record=selected?await bridge.invoke('world.open',{id:selected.id}):await bridge.invoke('world.create',{title:'我的第一个世界'});
  mount(record);await refreshList();
});
