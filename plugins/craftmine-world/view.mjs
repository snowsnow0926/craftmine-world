const initialWorld = CRAFTMINE_BOOT_WORLD;
const gameDocument = CRAFTMINE_GAME_DOCUMENT;
const frame = document.querySelector('iframe');
const status = document.getElementById('world-status');
const select = document.getElementById('world-list');
const saveButton = document.getElementById('save-world');
const newButton = document.getElementById('new-world');
const form = document.getElementById('create-form');
const errorBox = document.getElementById('error');
const bridge = globalThis.pluginBridge;
const requests = new Map();
let current, nonce, loaded=false, busy=false, lastSaved='';

function applyAppearance(appearance) {
  if(appearance?.base==='light'||appearance?.base==='dark') {
    document.documentElement.style.colorScheme=appearance.base;
    document.documentElement.dataset.theme=appearance.base;
  }
}
if(bridge) {
  void bridge.invoke('app.getAppearance').then(applyAppearance).catch(()=>{});
  bridge.on?.('appearance:changed',applyAppearance);
}

function send(type, value = {}) {
  frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type,...value}, '*');
}

function showError(error) {
  errorBox.textContent=String(error.message||error);errorBox.hidden=false;
  status.textContent='未保存';status.dataset.error='true';
}

function controls() {
  select.disabled=!bridge||busy;newButton.disabled=!bridge||busy;saveButton.disabled=!bridge||busy||!loaded;
}

async function action(run) {
  if(busy)return;
  busy=true;controls();errorBox.hidden=true;delete status.dataset.error;
  try {return await run();}catch(error){showError(error);}
  finally {busy=false;controls();}
}

function snapshot() {
  if(!loaded)return Promise.reject(Error('世界仍在载入'));
  return new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();
    const timer=setTimeout(()=>{requests.delete(requestId);reject(Error('读取世界超时'));},5000);
    requests.set(requestId,{resolve,reject,timer});send('snapshot',{requestId});
  });
}

async function save() {
  if(!bridge||!loaded||!current?.id)return;
  const result=await snapshot();
  const serialized=JSON.stringify(result.snapshot);
  if(serialized!==lastSaved) {
    status.textContent='保存中…';
    current=await bridge.invoke('world.saveProgress',{id:current.id,revision:current.revision,baseBuild:current.world.build.id,snapshot:result.snapshot});
    lastSaved=serialized;
  }
  status.textContent='已保存';
}

async function refreshList() {
  const {worlds}=await bridge.invoke('world.list');
  select.replaceChildren(...worlds.map(world=>{const option=document.createElement('option');option.value=world.id;option.textContent=world.title;return option;}));
  if(current)select.value=current.id;
}

function mount(record) {
  for(const pending of requests.values()){clearTimeout(pending.timer);pending.reject(Error('世界已切换'));}requests.clear();
  current=record;loaded=false;nonce=crypto.randomUUID();lastSaved=JSON.stringify(record.world.snapshot);
  document.body.dataset.worldId=record.id||'';delete document.body.dataset.worldLoaded;delete document.body.dataset.worldError;
  status.textContent='正在载入';controls();
  frame.srcdoc=gameDocument.replace('__CRAFTMINE_NONCE__',nonce);
}

addEventListener('message',event=>{
  const message=event.data;
  if(event.source!==frame.contentWindow||message?.channel!=='craftmine-game/1'||message.nonce!==nonce)return;
  if(message.type==='ready')send('load',current.world);
  if(message.type==='loaded') {
    loaded=true;status.textContent=bridge?'已保存':'本地预览';
    document.body.dataset.worldLoaded='true';controls();
  }
  if(message.type==='error') {
    showError(Error(message.message));document.body.dataset.worldError=message.message;
  }
  const pending=requests.get(message.requestId);
  if(pending){requests.delete(message.requestId);clearTimeout(pending.timer);message.type==='error'?pending.reject(Error(message.message)):pending.resolve(message);}
});

// A read-only diagnostics surface also used by the isolated resource probe.
globalThis.craftmineView=Object.freeze({snapshot});

saveButton.addEventListener('click',()=>void action(save));
newButton.addEventListener('click',()=>{form.hidden=!form.hidden;});
document.getElementById('cancel-create').addEventListener('click',()=>{form.hidden=true;});
form.addEventListener('submit',event=>{
  event.preventDefault();
  void action(async()=>{
    await save();
    const record=await bridge.invoke('world.create',{title:document.getElementById('world-name').value});
    form.hidden=true;form.reset();mount(record);await refreshList();
  });
});
select.addEventListener('change',()=>{
  const id=select.value;
  void action(async()=>{await save();mount(await bridge.invoke('world.open',{id}));await refreshList();}).finally(()=>{select.value=current?.id||'';});
});
setInterval(()=>{if(loaded&&!busy&&bridge)void action(save);},10000);

void action(async()=>{
  if(!bridge) {mount({title:initialWorld.build.scene.title,world:initialWorld});select.options[0].textContent=initialWorld.build.scene.title;return;}
  const state=await bridge.invoke('world.list');
  const selected=state.worlds.find(world=>world.id===state.activeWorldId)||state.worlds[0];
  const record=selected?await bridge.invoke('world.open',{id:selected.id}):await bridge.invoke('world.create',{title:'我的第一个世界'});
  mount(record);await refreshList();
});
