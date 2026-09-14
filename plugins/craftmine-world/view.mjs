import {createWorkbench} from './workbench-ui.mjs';
import {applyPresentation} from './apply-presentation.mjs';
import {candidateIdentity} from './godot-candidate-view.mjs';
import {assertPreviewControl} from './preview-control.mjs';
import {canonicalJSON} from '../../app/canonical.mjs';
import {createWorldKeyboardRelay} from '../../app/world-keyboard.mjs';
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
let current, nonce, loaded=false, busy=false, closing=false, lastSaved='', backupFrozen=false;
let activeOperation=Promise.resolve();
let closeOperation, closeGeneration=0;
const checksPanel=document.getElementById('checks-panel');
const previewPanel=document.getElementById('preview-panel');
let previewFrame=null;
let preview=null,checkOffset=0,checkWorld=null,checksLoading=false,evidenceJob=null,evidenceNext=null;
let previewReview=null,reviewLoading=false,applicationAttempt=null;
let reviewError=null,applyError=null;
let godotIdentity=null;
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
let initializingSurfaceWorld=null;
let openingWorldId=null;
let recoverySequence=0;
let loadRecovery=null;
let immersionHeld=false;
const keyboardRelay=createWorldKeyboardRelay({
  state:()=>({worldId:current?.id,nonce,enabled:!!bridge&&!!current&&loaded&&!godot&&!closing&&!backupFrozen&&!immersionHeld
    &&document.body.dataset.immersive==='true'&&!preview&&!applicationAttempt&&!workbench?.tab&&checksPanel.hidden,
    editing:!!document.activeElement?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')}),
  send:(type,payload)=>send(type,payload),
});
document.addEventListener('keydown',keyboardRelay.handle);
document.addEventListener('keyup',keyboardRelay.handle);
addEventListener('blur',keyboardRelay.reset);
addEventListener('pagehide',keyboardRelay.reset);
const godotStateLabels={loading:'载入中',ready:'已就绪',paused:'已暂停',saving:'保存中',saved:'已保存',failed:'运行失败',closed:'已关闭'};
const godotLoadingStates=new Set(['loading','failed']);
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
  bridge.on?.('craftmine-world-list-changed',()=>{void refreshList().catch(showError);});
  bridge.on?.('craftmine-runtime-recovered',value=>{void recoverMaintainedWorld(value?.worldId).catch(showError);});
  bridge.on?.('craftmine-presentation',value=>{
    const active=value?.active===true;
    const entering=active&&document.body.dataset.immersive!=='true';
    document.body.dataset.immersive=String(active);
    keyboardRelay.sync();
    // Showing the world changes presentation only; never discard a candidate
    // application or preview that the player is still deciding on.
    if(entering&&!preview&&!applicationAttempt)setMode(false);
    if(!godot&&current)send('immersion',{paused:immersionHeld,active});
  });
  bridge.on?.('craftmine-immersion',value=>{
    immersionHeld=value===true;
    keyboardRelay.sync();
    if(!godot&&current)send('immersion',{paused:immersionHeld,active:document.body.dataset.immersive==='true'});
    if(previewFrame&&preview)previewFrame.contentWindow.postMessage({channel:'craftmine-host/1',nonce:preview.nonce,type:'immersion',paused:immersionHeld},'*');
  });
}

async function recoverMaintainedWorld(worldId) {
  const targetsWorld=()=>openingWorldId?openingWorldId===worldId:current?.id===worldId;
  if(typeof worldId!=='string'||!targetsWorld())return;
  const sequence=++recoverySequence,generation=closeGeneration;
  const eligible=()=>sequence===recoverySequence&&generation===closeGeneration&&!closing&&!preview&&!applicationAttempt&&
    !restoreOperation&&targetsWorld();
  // A successful host repair may overtake the rejected first open. Preserve
  // that request's error, then reconcile after its normal finally releases busy.
  while(busy&&eligible())await activeOperation.catch(()=>{});
  if(!eligible()||(loaded&&current?.id===worldId&&!openingWorldId))return;
  await action(async()=>{
    const before=current,opening=openingWorldId;
    const unchanged=()=>eligible()&&current===before&&openingWorldId===opening;
    if(!unchanged())return;
    const selected=await bridge.invoke('world.list');
    if(!unchanged()||selected.activeWorldId!==worldId)return;
    const state=await bridge.invoke('godot.runtimeState',{worldId});
    if(!unchanged()||!['ready','paused','saved'].includes(state?.state)||state.worldId!==worldId)return;
    const record=await bridge.invoke('world.read',{id:worldId});
    if(!unchanged())return;
    if(record.id!==worldId||record.world?.build?.id!==state.buildId)throw Error('WORLD_RECOVERY_IDENTITY_CHANGED');
    const selectedAfter=await bridge.invoke('world.list');
    if(!unchanged()||selectedAfter.activeWorldId!==worldId)return;
    const stateAfter=await bridge.invoke('godot.runtimeState',{worldId});
    if(!unchanged()||stateAfter?.worldId!==worldId||stateAfter.buildId!==state.buildId||stateAfter.instanceId!==state.instanceId||!['ready','paused','saved'].includes(stateAfter.state))return;
    mount(record);errorBox.hidden=true;
  });
}

// State is broadcast by the Electron host; this page never infers it.
function onGodotState(payload) {
  if(!payload)return;
  // world.open awaits the native runtime. Before mount there is no current
  // record, but its startup events must already update the visible loader.
  if(openingWorldId&&payload.worldId===openingWorldId) {
    if(payload.state==='loading'||payload.state==='failed')renderWorldLoading(payload);
    return;
  }
  if(openingWorldId)return;
  if(!godot||payload.worldId!==current?.id)return;
  // The live instance identity is host-owned; keep the last one so readers can
  // see exactly which world/build/instance they observed.
  if(typeof payload.instanceId==='string')godotIdentity={worldId:payload.worldId,buildId:String(payload.buildId||''),instanceId:payload.instanceId};
  const state=String(payload.state||'');
  if(state==='ready')backupFrozen=false;
  const label=godotStateLabels[state]||state;
  const recoveringLoadError=document.getElementById('godot-loading')?.dataset.state==='failed';
  document.body.dataset.godotState=state;
  renderWorldLoading(payload);
  status.textContent=label;
  if(state==='failed') {
    // Reuse the shared error banner, but keep the state label in the status.
    showError(Error(payload.error||'Godot 世界运行失败'));
    status.textContent=label;
  } else delete status.dataset.error;
  if(state==='ready'||state==='saved'||state==='paused'){
    if(recoveringLoadError)errorBox.hidden=true;
    loaded=true;document.body.dataset.worldLoaded='true';controls();
    // A placeholder was mounted before its first runtime existed. Only this
    // initial readiness transition releases the loading surface; later pause/
    // save events must not reveal a world hidden by a preview or another sheet.
    if(initializingSurfaceWorld===current.id&&!openingWorldId&&!preview&&!applicationAttempt&&!closing&&checksPanel.hidden&&!workbench?.tab){
      const worldId=current.id;initializingSurfaceWorld=null;
      void bridge.invoke('godot.runtimeSurface',{worldId,visible:true}).catch(error=>{
        if(current?.id===worldId){initializingSurfaceWorld=worldId;showError(error);}
      });
    }
  }
  else if(state==='loading'||state==='failed'||state==='closed'){loaded=false;delete document.body.dataset.worldLoaded;controls();}
}

function renderWorldLoading(payload) {
  const state=String(payload.state||'loading');
  const loading=document.getElementById('godot-loading');
  if(loading) {
    const visible=godotLoadingStates.has(state);
    loading.setAttribute('aria-hidden',String(!visible));
    loading.dataset.state=state;
    const title=document.getElementById('godot-loading-title');
    const detail=document.getElementById('godot-loading-detail');
    if(title)title.textContent=state==='failed'?'世界加载失败':'正在加载世界…';
    const stageDetails={resources:'正在读取并校验世界资源…',engine:'正在启动图形引擎…',scene:'正在载入场景和恢复世界进度…'};
    if(detail)detail.textContent=state==='failed' ? String(payload.error||'运行时没有完成初始化。请返回工作台检查错误并重试。') : payload.initializing ? '正在初始化世界并确认首次构建，请稍候。' : stageDetails[payload.loadingStage]||'世界正在准备场景和运行资源，请稍候。首次加载可能需要更长时间。';
    document.getElementById('godot-loading-actions').hidden=state!=='failed';
    document.getElementById('godot-loading-back').hidden=!loadRecovery?.previous;
  }
}

async function openWorldWithLoading(id,{previous=current?.id||null}={}) {
  recoverySequence++;
  loadRecovery={id,previous:previous!==id?previous:null};openingWorldId=id;
  renderWorldLoading({state:'loading'});
  // The native game is a sibling above this page; reveal the loading layer
  // before waiting for save/open/engine completion.
  try {
    if(godot&&current?.id) {
      try {await bridge.invoke('godot.runtimeSurface',{worldId:current.id,visible:false});}
      catch(error){if(!String(error?.message||error).includes('GODOT_WORLD_CHANGED'))throw error;}
    }
    const record=await bridge.invoke('world.open',{id});
    mount(record);
    return record;
  }catch(error){renderWorldLoading({state:'failed',error:String(error?.message||error)});throw error;}
}

document.getElementById('godot-loading-retry').onclick=()=>{
  if(loadRecovery?.request){void navigate(loadRecovery.request).catch(()=>{});return;}
  void action(async()=>{
  if(loadRecovery?.id)await openWorldWithLoading(loadRecovery.id,{previous:loadRecovery.previous});
  else await initializeWorld();
  });
};
document.getElementById('godot-loading-back').onclick=()=>void action(async()=>{
  if(loadRecovery?.previous)await openWorldWithLoading(loadRecovery.previous,{previous:null});
});

function send(type, value = {}) {
  if(type==='resume')backupFrozen=false;
  // Godot worlds never speak the voxel host protocol; the host owns the game view.
  if(godot){
    if(type==='resume')void bridge.invoke('godot.runtimeResume',{worldId:current.id}).catch(showError);
    return;
  }
  frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type,...value}, '*');
}

function showError(error) {
  if(openingWorldId||!current||!loaded)renderWorldLoading({state:'failed',error:String(error.message||error)});
  errorBox.textContent=String(error.message||error);errorBox.hidden=false;
  status.textContent='操作未完成';status.dataset.error='true';
}

function controls() {
  keyboardRelay.sync();
  document.getElementById('godot-loading-retry').disabled=busy||closing;
  document.getElementById('godot-loading-back').disabled=busy||closing;
  select.disabled=!bridge||busy||closing||!!preview||!!applicationAttempt||!!workbench?.busy;newButton.disabled=select.disabled;saveButton.disabled=select.disabled||!loaded;
  if(godot){saveButton.title='保存世界进度';saveButton.setAttribute('aria-label','保存世界进度');}
  else {saveButton.removeAttribute('title');saveButton.removeAttribute('aria-label');}
  importButton.disabled=select.disabled;
  document.getElementById('close-preview').disabled=busy||closing||!!applicationAttempt;
  document.getElementById('apply-world').textContent=applicationAttempt?.godot?'确认应用结果':'应用到世界';
  document.getElementById('world-mode').disabled=!!preview||!!applicationAttempt;document.getElementById('checks-mode').disabled=!!preview||!!applicationAttempt;
  const presentation=applyPresentation({busy,closing,preview,review:previewReview,reviewLoading,reviewError,attempt:applicationAttempt,applyError});
  document.getElementById('apply-world').disabled=presentation.primaryDisabled;
  const warnings=document.getElementById('apply-world-warnings');
  warnings.hidden=presentation.warningHidden;
  warnings.disabled=presentation.warningDisabled;
  const explanation=document.getElementById('apply-explanation');
  explanation.dataset.reason=presentation.code;
  document.getElementById('apply-reason').textContent=presentation.reason;
  document.getElementById('apply-next-step').textContent=presentation.next;
  document.getElementById('refresh-apply-state').hidden=!preview||!!preview.godot;
  document.getElementById('refresh-apply-state').disabled=busy||closing||reviewLoading||!!applicationAttempt;
  const failure=reviewError||applyError;
  document.getElementById('apply-error-details').hidden=!failure;
  document.getElementById('apply-error-text').textContent=failure||'';
  document.getElementById('retry-review').disabled=busy||closing||!!applicationAttempt;
  document.getElementById('cancel-review').disabled=busy||closing;
  frame.inert=closing||!!applicationAttempt;
}

function action(run,{resumeOnError=true}={}) {
  if(busy||closing)return Promise.resolve();
  busy=true;controls();errorBox.hidden=true;delete status.dataset.error;
  activeOperation=(async()=>{
    try {return await run();}catch(error){if(resumeOnError&&!applicationAttempt)send('resume');showError(error);}
    finally {busy=false;controls();}
  })();
  return activeOperation;
}

function snapshot({freeze=false}={}) {
  // Kept callable for Godot worlds: the host snapshots the running game itself.
  // The identity is the host-reported live instance, never inferred here.
  if(godot)return Promise.resolve({godot:true,snapshot:null,identity:godotIdentity});
  if(!loaded)return Promise.reject(Error('世界仍在载入'));
  return new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();
    const timer=setTimeout(()=>{requests.delete(requestId);reject(Error('读取世界超时'));},5000);
    requests.set(requestId,{resolve,reject,timer});send('snapshot',{requestId,freeze});
  });
}

async function save({freeze=false,background=false}={}) {
  // The Electron host owns the Godot save transaction; this page must not
  // snapshot or call world.saveProgress for a Godot world.
  if(godot){
    const worldId=current.id;
    let receipt;
    if(background){
      const result=await bridge.invoke('godot.runtimeAutosave',{worldId});
      if(result?.worldId!==worldId)throw Error('GODOT_WORLD_CHANGED');
      if(result.status==='deferred'&&result.reason==='GODOT_CANDIDATE_ACTIVE')return result;
      if(result.status!=='saved'||!result.receipt)throw Error('GODOT_AUTOSAVE_UNCONFIRMED');
      receipt=result.receipt;
    }else receipt=await bridge.invoke('godot.runtimeSave',{worldId,freeze});
    if(current?.id!==worldId)throw Error('GODOT_WORLD_CHANGED');
    current={...current,revision:receipt.revision,contentHash:receipt.contentHash};
    if(!background||errorBox.hidden)status.textContent='已保存';
    return {worldId:current.id,revision:receipt.revision,buildId:receipt.buildId};
  }
  if(applicationAttempt)await reconcileApplication();
  if(!bridge||!loaded||!current?.id)return;
  const result=await snapshot({freeze});
  const serialized=canonicalJSON(result.snapshot);
  if(freeze||serialized!==lastSaved) {
    status.textContent='保存中…';
    current=await bridge.invoke('world.saveProgress',{id:current.id,revision:current.revision,baseBuild:current.world.build.id,snapshot:result.snapshot});
    lastSaved=serialized;
  }
  if(!background||errorBox.hidden)status.textContent='已保存';
  return {worldId:current.id,revision:current.revision,buildId:current.world.build.id};
}

function autosave() {
  if(!loaded||busy||closing||preview||backupFrozen||!bridge)return Promise.resolve();
  const worldId=current?.id;busy=true;controls();
  // Background work must not dismiss an earlier real error or resume a world
  // owned by the candidate coordinator after an expected deferred save.
  activeOperation=(async()=>{
    try{return await save({background:true});}
    catch(error){if(current?.id===worldId)showError(error);}
    finally{busy=false;controls();}
  })();
  return activeOperation;
}

async function saveManually() {
  try{return await save();}
  catch(error){
    if(/(?:^|: )GODOT_CANDIDATE_ACTIVE$/.test(String(error?.message||error)))
      throw Error('世界正在预览或应用新内容，请完成后再保存。（GODOT_CANDIDATE_ACTIVE）');
    throw error;
  }
}

function cancelClose() {
  closeGeneration++;closing=false;controls();if(!applicationAttempt)send('resume');
}

let restoreOperation=null;
async function beginRestore({operationId}) {
  if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId))throw Error('INVALID_RESTORE_OPERATION');
  if(restoreOperation===operationId)return {locked:true};
  if(restoreOperation||closing||applicationAttempt||preview)throw Error('WORLD_BUSY');
  // This is invoked by Main while the backup action is awaiting its IPC reply.
  // Waiting for activeOperation here would wait on that very same reply.
  recoverySequence++;restoreOperation=operationId;closing=true;controls();send('pause');
  try {
    if(!godot&&loaded) {
      const result=await snapshot({freeze:true});
      if(canonicalJSON(result.snapshot)!==lastSaved)throw Error('BACKUP_PROGRESS_CHANGED_REINSPECT');
    }
    return {locked:true};
  } catch(error) {restoreOperation=null;cancelClose();throw error;}
}
async function finishRestore({operationId,record,empty=false}) {
  if(restoreOperation!==operationId)throw Error('RESTORE_OPERATION_CHANGED');
  restoreOperation=null;closing=false;controls();
  if(record)mount(record);
  else if(empty){loaded=false;current=null;godotIdentity=null;frame.removeAttribute('srcdoc');delete document.body.dataset.worldLoaded;delete document.body.dataset.worldId;status.textContent='备份中没有世界，请新建世界。';controls();}
  else if(!applicationAttempt)send('resume');
  return {unlocked:true};
}

function prepareClose() {
  if(restoreOperation)return Promise.resolve({loaded:false,restorePending:true});
  if(closing&&closeOperation)return closeOperation;
  const generation=++closeGeneration, previous=activeOperation;
  closing=true;controls();
  closeOperation=(async()=>{
    try {
      // Wait for the prior transaction to settle, but do not replay an error
      // already delivered to its caller/loading UI as a new shutdown failure.
      // Current reconciliation and checkpoint below retain their own errors.
      await previous.catch(()=>{});
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
  godotIdentity=null;
  checkWorld=null;checkOffset=0;document.getElementById('check-detail').hidden=true;
  document.getElementById('checks-list').replaceChildren();setMode(false,{notify:false});
  for(const pending of requests.values()){clearTimeout(pending.timer);pending.reject(Error('世界已切换'));}requests.clear();
  current=record;openingWorldId=null;loaded=false;nonce=crypto.randomUUID();lastSaved=canonicalJSON(record.world.snapshot);
  godot=isGodotWorld(record);
  initializingSurfaceWorld=godot&&record?.world?.build?.godot?.initializing===true?record.id:null;
  document.getElementById('import-result').hidden=true;
  document.body.dataset.worldId=record.id||'';delete document.body.dataset.worldLoaded;delete document.body.dataset.worldError;
  delete document.body.dataset.godotState;
  if(godot) {
    // Godot worlds are rendered by a sibling Electron view over #godot-surface;
    // this page only draws the chrome and the placeholder region.
    document.body.dataset.godot='true';
    frame.removeAttribute('srcdoc');
    status.textContent='载入中';
    renderWorldLoading({state:'loading'});
    void bridge.invoke('godot.candidateClose',{worldId:record.id}).then(result=>{
      if(current?.id!==record.id)return null;
      if(result.status==='applied'){mount(result.record);return null;}
      return bridge.invoke('godot.runtimeState',{worldId:record.id});
    }).then(async state=>{
      if(!state)return;
      if(current?.id!==record.id)return;
      onGodotState(state);
      if(state.initializing)return;
      await bridge.invoke('godot.runtimeSurface',{worldId:record.id,visible:true});
    }).catch(error=>{if(current?.id===record.id)showError(error);});
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
  if(message.type==='ready')send('load',{...current.world,worldId:current.id,immersionPaused:immersionHeld,immersionActive:document.body.dataset.immersive==='true'});
  if(message.type==='selection')void workbench?.setSelection(message);
  if(message.type==='loaded') {
    if(message.version!==current.world.build.id){showError(Error('载入版本不一致'));return;}
    loaded=true;status.textContent=bridge?'已保存':'本地预览';
    renderWorldLoading({state:'ready'});
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
globalThis.craftmineView=Object.freeze({snapshot,prepareClose,cancelClose,beginRestore,finishRestore,navigate,showSurface,pickDirectory,previewControl,showChecks:()=>setMode(true),showWorkbench:tab=>openWorkbench(tab),review:id=>action(async()=>{setMode(true);await showEvidence(id);}),preview:id=>action(()=>openPreview(id)),closePreview});

function previewControlState() {
  if(!preview?.godot||preview.worldId!==current?.id)return null;
  const presentation=applyPresentation({busy,closing,preview,attempt:applicationAttempt,applyError});
  return {
    worldId:preview.worldId,candidateId:preview.candidateId,buildId:preview.buildId,previewId:preview.nonce,
    applyDisabled:presentation.primaryDisabled,closeDisabled:busy||closing||!!applicationAttempt,
    applyLabel:applicationAttempt?'确认应用结果':'应用到世界',reason:presentation.reason,next:presentation.next,
    error:applyError||(!errorBox.hidden?errorBox.textContent:'')||'',
  };
}
async function previewControl(request) {
  assertPreviewControl(request,previewControlState());
  if(request.action!=='state') {
    if(busy||closing||workbench?.busy)throw Error('PREVIEW_BUSY');
    busy=true;controls();errorBox.hidden=true;
    activeOperation=(async()=>{
      try {
        if(['open','adopt'].includes(request.action)) {
          if(request.worldId!==current?.id||!godot||!loaded)throw Error('CREATION_RESULT_CONTEXT_CHANGED');
          await openGodotPreview(request.candidateId,request.buildId);
          if(request.action==='adopt')await applyCandidate();
        } else if(request.action==='apply')await applyCandidate();
        else await closePreview();
      } catch(error){showError(error);throw error;}
      finally{busy=false;controls();}
    })();
    await activeOperation;
    // applyCandidate retains an uncertain transaction for reconciliation.
    if(applicationAttempt||applyError)throw Error(applyError||'应用结果尚待确认，请在预览操作中重试确认');
  }
  return previewControlState();
}

// Surfaces requested by the left column. Only surfaces this page can actually
// show are accepted; an unknown workbench tab is refused instead of silently
// falling back to another panel.
async function showSurface(request) {
  const surface=request?.surface;
  if(!surface||typeof surface!=='object')throw Error('INVALID_SURFACE_REQUEST');
  // Sidebar routes must obey the same lock as the page's disabled tab buttons.
  // Mutating the tab first would leave it out of sync with a refused native hide.
  if(busy||closing||preview||applicationAttempt)throw Error('WORLD_BUSY');
  if(surface.kind==='checks'){setMode(true);return {ok:true,shown:'checks'};}
  if(surface.kind==='world'){setMode(false);return {ok:true,shown:'world'};}
  if(surface.kind!=='workbench'||typeof surface.tab!=='string'||!surface.tab)throw Error('INVALID_SURFACE_REQUEST');
  if(!document.querySelector(`[data-workbench-tab="${surface.tab}"]`))throw Error('UNKNOWN_WORKBENCH_TAB');
  await openWorkbench(surface.tab);
  if(workbench?.tab!==surface.tab)throw Error('WORLD_BUSY');
  return {ok:true,shown:'workbench',tab:surface.tab};
}

// The asset panel lives in the main window but the directory grant belongs to
// this trusted page, exactly like the legacy import picker.
async function pickDirectory() {
  if(!bridge)throw Error('桌面服务尚未连接');
  const picked=await bridge.invoke('fs.requestDirectory');
  const sourceRoot=typeof picked==='string'?picked:picked?.path;
  return typeof sourceRoot==='string'&&sourceRoot?{sourceRoot}:null;
}

// Both navigation columns use the same live-view save sequence. Reject busy
// requests explicitly; action() deliberately absorbs errors for DOM handlers.
async function navigate(request) {
  if(busy||closing||preview||applicationAttempt||workbench?.busy)throw Error('WORLD_BUSY');
  if(!bridge||(!loaded&&!godot)||!current?.id)throw Error('WORLD_VIEW_UNAVAILABLE');
  if(!['switch','create','copy'].includes(request?.operation))throw Error('INVALID_NAVIGATION_REQUEST');
  if(request.operation==='switch'&&request.id===current.id){
    if(!godot)return {ok:true,activeWorldId:current.id};
    busy=true;controls();
    activeOperation=(async()=>{
      const worldId=current.id;
      const runtime=await bridge.invoke('godot.runtimeState',{worldId});
      if(runtime?.worldId===worldId&&runtime.state==='failed') {
        await openWorldWithLoading(worldId,{previous:loadRecovery?.previous||null});
        return {ok:true,activeWorldId:worldId};
      }
      if(['ready','paused','saved'].includes(runtime?.state)&&!runtime.initializing){
        setMode(false,{notify:false});
        await bridge.invoke('godot.runtimeSurface',{worldId,visible:true});
        initializingSurfaceWorld=null;
      }
      return {ok:true,activeWorldId:worldId};
    })().finally(()=>{busy=false;controls();});
    return activeOperation;
  }
  if(request.operation==='create'&&!request.operationId)request={...request,operationId:crypto.randomUUID()};
  const retryingCreate=request.operation==='create'&&loadRecovery?.request?.operationId===request.operationId;
  busy=true;controls();errorBox.hidden=true;
  const previous=current.id;
  activeOperation=(async()=>{
    try {
      let target;
      if(request.operation==='copy') {
        const {operation,...payload}=request;
        const result=await bridge.invoke('world.copy',payload);
        const record=await bridge.invoke('world.read',{id:result.targetWorldId});
        mount(record);
        await refreshList().catch(showError);
        return result;
      }
      if(request.operation==='switch') {
        target=await bridge.invoke('world.read',{id:request.id});
      }
      if(loaded&&!retryingCreate)await save({freeze:true});
      loadRecovery={previous,request};
      renderWorldLoading({state:'loading',initializing:request.operation==='create'});
      // The durable initialization placeholder has no native instance yet.
      // Cancelling its creation must still reach world.open for the previous
      // world; requireCurrent intentionally rejects a surface write here.
      if(godot&&!retryingCreate&&!(initializingSurfaceWorld===current.id&&!loaded))await bridge.invoke('godot.runtimeSurface',{worldId:current.id,visible:false});
      if(request.operation==='create')openingWorldId='__creating__';
      if(request.operation==='create')target=await bridge.invoke('world.create',{
        title:request.title,baseId:request.baseId,starterId:request.starterId,operationId:request.operationId,activate:false,
        ...(request.libraryRef?{libraryRef:{...request.libraryRef}}:{}),
      });
      const record=await openWorldWithLoading(target.id,{previous});
      // A failed list refresh cannot undo a completed switch.
      await refreshList().catch(showError);
      // Factory state is authoritative: opening the durable placeholder does
      // not mean its first build/check has completed. Keep creation recovery
      // metadata intact so callers wait for actual readiness.
      return request.operation==='create'?{...target,id:record.id,title:record.title}:{ok:true,activeWorldId:record.id};
    } catch(error) {
      if(current?.id===previous&&!openingWorldId){send('resume');renderWorldLoading({state:'failed',error:String(error?.message||error)});}
      showError(error);throw error;
    } finally {busy=false;controls();select.value=current?.id||'';}
  })();
  return activeOperation;
}

const checkLabels={queued:'等待检查',running:'后台检查中',passed:'机器检查通过',failed:'检查未通过',cancelled:'已取消',interrupted:'已中断'};
function setMode(checks,{notify=true}={}) {
  const leavingWorkbench=!!workbench?.tab;
  void workbench?.show(null);
  for(const item of document.querySelectorAll('[data-workbench-tab]'))item.setAttribute('aria-selected','false');
  checksPanel.hidden=!checks;
  document.getElementById('world-mode').setAttribute('aria-selected',String(!checks));
  document.getElementById('checks-mode').setAttribute('aria-selected',String(checks));
  if(notify&&godot&&current?.id)void bridge.invoke('godot.runtimeSurface',{worldId:current.id,visible:!checks}).catch(showError);
  if(checks){send('pause');void refreshChecks(true);}
  else if(notify&&leavingWorkbench&&loaded&&!applicationAttempt&&!preview)send('resume');
}
function openWorkbench(tab){
  if(busy||closing||preview||applicationAttempt)return;
  if(godot&&current?.id)void bridge.invoke('godot.runtimeSurface',{worldId:current.id,visible:false}).catch(showError);
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
    if(godot){await refreshGodotCandidates(worldId,reset);return;}
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
async function refreshGodotCandidates(worldId,reset) {
  const result=await bridge.invoke('godot.candidateList',{worldId,offset:checkOffset,limit:8});
  if(current?.id!==worldId)return;
  const list=document.getElementById('checks-list');if(reset||!checkOffset)list.replaceChildren();
  for(const candidate of result.items){
    const candidateId=candidateIdentity(candidate);
    const row=document.createElement('article');row.className='check-row';row.dataset.candidateId=candidateId;
    const title=document.createElement('h3');title.textContent=`Godot 草稿 ${candidate.sourceRevision}`;
    const state=document.createElement('p');state.textContent=({ready:'检查通过 · 可以预览',applied:'已应用',stale:'草稿已更新'})[candidate.status]||candidate.status;
    const button=document.createElement('button');button.textContent='预览副本';button.disabled=candidate.status!=='ready';button.onclick=()=>void action(()=>openGodotPreview(candidateId));
    row.append(title,state,button);list.append(row);
  }
  document.getElementById('checks-empty').hidden=list.children.length>0;
  document.getElementById('checks-more').hidden=result.nextOffset===null;
}
async function openGodotPreview(candidateId,expectedBuildId=null) {
  if(preview)await closePreview();
  const worldId=current.id;
  const result=await bridge.invoke('godot.candidatePreview',{worldId,candidateId});
  if(current.id!==worldId)throw Error('世界已切换');
  if(expectedBuildId&&result.buildId!==expectedBuildId){await bridge.invoke('godot.candidateClose',{worldId});throw Error('CREATION_RESULT_STALE');}
  preview={godot:true,candidateId,worldId,buildId:result.buildId,nonce:crypto.randomUUID()};previewReview=null;reviewError=null;applyError=null;
  previewPanel.hidden=false;document.getElementById('preview-title').textContent='Godot 草稿预览';
  document.getElementById('preview-review').hidden=true;
  document.getElementById('apply-world-warnings').hidden=true;
  document.body.dataset.previewLoaded='true';controls();
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
async function closePreview(resume=true) {
  if(!preview)return;
  const closingPreview=preview;
  if(closingPreview.godot&&resume)await bridge.invoke('godot.candidateClose',{worldId:closingPreview.worldId});
  document.getElementById('preview-review').hidden=false;
  preview=null;previewReview=null;reviewError=null;applyError=null;previewPanel.hidden=true;previewFrame?.remove();previewFrame=null;delete document.body.dataset.previewLoaded;
  if(resume)send('resume');controls();
}
async function openPreview(id) {
  // Draft previews mount the voxel srcdoc runner; Godot worlds run elsewhere.
  if(godot)return openGodotPreview(id);
  if(preview)closePreview(false);
  await save({freeze:true});
  const result=await bridge.invoke('verification.preview',{id});
  const state={nonce:crypto.randomUUID(),world:result.world,job:result.job};preview=state;previewReview=null;reviewError=null;applyError=null;
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
  if(!preview||preview.godot||reviewLoading||closing)return;
  const state=preview;reviewLoading=true;controls();
  try{
    const records=await bridge.invoke('review.list',{verificationId:state.job.id});
    if(preview!==state)return;
    const review=records[0]||null;previewReview=review;reviewError=null;
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
  }catch(error){if(preview!==state)return;document.getElementById('review-state').textContent='读取评审失败：'+error.message;previewReview=null;reviewError=String(error?.message||error).slice(0,600);}
  finally{reviewLoading=false;controls();}
}

async function applyCandidate(acknowledgeReviewWarnings=false) {
  if(applicationAttempt){await reconcileApplication();return;}
  applyError=null;
  if(preview?.godot){
    const attempt={godot:true,worldId:preview.worldId,candidateId:preview.candidateId,buildId:preview.buildId};applicationAttempt=attempt;
    try{
      const result=await bridge.invoke('godot.candidateApply',{worldId:attempt.worldId,candidateId:attempt.candidateId});
      if(result.status!=='applied')throw Error('应用尚未提交');
      applicationAttempt=null;mount(result.record);await refreshList();return;
    }catch(error){applyError=String(error?.message||error).slice(0,600);await reconcileApplication().catch(()=>{});if(!applicationAttempt&&current?.world?.build?.id===attempt.buildId)return;throw error;}
  }
  const state=preview,review=previewReview;
  if(!state||!review?.current||review.status!=='completed'||(!review.acceptance?.passed&&!(acknowledgeReviewWarnings===true&&review.acceptance?.passed===false)))throw Error('请先完成这份草稿的需求检查与评审');
  try{await save({freeze:true});}catch(error){applyError=String(error?.message||error).slice(0,600);throw error;}
  const args={operationId:crypto.randomUUID(),verificationId:state.job.id,reviewId:review.id,worldId:current.id,revision:current.revision,...(acknowledgeReviewWarnings?{acknowledgeReviewWarnings:true}:{})};
  applicationAttempt=args;status.textContent='正在检查最新进度并应用…';
  try{
    const result=await bridge.invoke('candidate.apply',args);
    if(result.status!=='applied')throw Error('应用尚未提交');
    applicationAttempt=null;mount(result.record);await refreshList();
  }catch(error){
    applyError=String(error?.message||error).slice(0,600);
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
  if(attempt.godot){
    const result=await bridge.invoke('godot.candidateState',{worldId:attempt.worldId,candidateId:attempt.candidateId});
    if(applicationAttempt!==attempt)return;
    if(result.status==='applied'){applicationAttempt=null;mount(result.record);await refreshList();return;}
    // The host reports an unchanged preview when apply was rejected before an
    // application began (for example its operation mutex was busy). Only this
    // exact candidate identity may release the local uncertain-attempt guard.
    if(result.status==='preview'&&result.worldId===attempt.worldId&&result.candidateId===attempt.candidateId){applicationAttempt=null;return;}
    if(['closed','aborted','interrupted'].includes(result.status)){applicationAttempt=null;await closePreview(false);return;}
    throw Error('应用结果尚在确认，原世界保持暂停。');
  }
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
document.getElementById('close-preview').onclick=()=>void action(()=>closePreview());
document.getElementById('apply-form').onsubmit=event=>{event.preventDefault();const acknowledged=event.submitter?.id==='apply-world-warnings';void action(()=>applyCandidate(acknowledged));};
document.getElementById('refresh-apply-state').onclick=()=>void refreshReview();
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
  onChange:controls,replaceWorld:mount,saveBeforeBackup:async()=>{const receipt=await save({freeze:true});backupFrozen=true;return receipt;},
  reloadWorld:async()=>{const result=await bridge.invoke('world.list');const next=result.worlds.find(item=>item.id===result.activeWorldId)||result.worlds[0];if(next){await openWorldWithLoading(next.id);await refreshList();}},
  run:async fn=>{
    if(busy||closing||applicationAttempt||preview)throw Error('请先完成当前世界操作');
    busy=true;controls();activeOperation=Promise.resolve().then(fn);
    try{return await activeOperation;}finally{busy=false;controls();}
  },
});
for(const item of document.querySelectorAll('[data-workbench-tab]'))item.addEventListener('click',()=>void openWorkbench(item.dataset.workbenchTab));
document.getElementById('refresh-workbench').onsubmit=event=>{event.preventDefault();if(!busy&&!closing)void workbench.refreshCapabilities();};
setInterval(()=>{if(!busy&&!closing){if(workbench.tab==='task')void workbench.refresh();else if(workbench.tab)void workbench.refreshPending();}},4000);

saveButton.addEventListener('click',()=>void action(saveManually,{resumeOnError:false}));
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
setInterval(()=>{void autosave();},10000);

async function initializeWorld(){
  renderWorldLoading({state:'loading'});
  if(!bridge) {mount({title:initialWorld.build.scene.title,world:initialWorld});select.options[0].textContent=initialWorld.build.scene.title;return;}
  const state=await bridge.invoke('world.list');
  const selected=state.worlds.find(world=>world.id===state.activeWorldId)||state.worlds[0];
  if(selected){
    // A reloaded page has no local preview object, but Main may still own its
    // prepared or uncertain application. Reconcile before world.open, which
    // correctly refuses while that application owns the selected world.
    if(state.activeWorldId===selected.id)await bridge.invoke('godot.candidateClose',{worldId:selected.id});
    await openWorldWithLoading(selected.id,{previous:null});
  }
  else {
    renderWorldLoading({state:'loading',initializing:true});
    const record=await bridge.invoke('world.create',{title:'我的第一个世界',activate:false});
    await openWorldWithLoading(record.id,{previous:null});
  }
  await refreshList();
}
void action(initializeWorld);
