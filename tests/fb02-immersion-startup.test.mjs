import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const desktop=path.resolve('vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const {buildSync,transformSync}=require('esbuild');
function load(file){
  const module={exports:{}};
  const result=buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false});
  vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports});
  return module.exports;
}
const layout=load(path.join(desktop,'src/lib/craftmine-layout.ts'));
const protocol=load(path.resolve('vendor/pi-desktop/packages/shared/src/protocol.ts'));
const immersion=load(path.join(desktop,'shared/craftmine-immersion.ts'));
const storage=value=>({getItem:()=>value});

test('fresh/corrupt profiles retain mode choice; saved create and play restore without a hidden modal',()=>{
  for(const value of [null,'bad','null','{}','{"mode":"invalid"}']) assert.equal(layout.hasSavedCraftmineMode(storage(value)),false);
  for(const mode of ['create','play']) assert.equal(layout.hasSavedCraftmineMode(storage(JSON.stringify({mode}))),true);
});

test('retained automatic world can restore play while an explicit create preference remains respected',()=>{
  const input={worldId:'retained',enteredWorldId:'retained',playWhenWorldActivates:true,playing:false};
  assert.equal(layout.decideCraftmineActivation(input).switchToPlay,true);
  assert.equal(layout.decideCraftmineActivation({...input,playWhenWorldActivates:false}).switchToPlay,false);
  assert.equal(layout.decideCraftmineActivation({...input,playing:true}).switchToPlay,false);
});

const mainSource=fs.readFileSync(path.join(desktop,'electron/main/index.ts'),'utf8');
const nativeFunction=mainSource.slice(mainSource.indexOf('function executeNativeMenuAction('),mainSource.indexOf('function dispatchNativeMenuAction('));
let quitRequested=0;
const execute=vm.runInNewContext(transformSync(nativeFunction,{loader:'ts'}).code+'\nexecuteNativeMenuAction',{app:{quit:()=>quitRequested++}});
test('allowed native enter action is idempotent across duplicate calls and stale renderer state',()=>{
  assert.ok(protocol.NATIVE_MENU_ACTIONS.includes('enterFullScreen'));
  let fullScreen=false;
  const calls=[];
  const window={webContents:{},isDestroyed:()=>false,isMaximized:()=>false,isFullScreen:()=>fullScreen,setFullScreen:value=>{calls.push(value);fullScreen=value;}};
  execute('enterFullScreen',window);
  execute('enterFullScreen',window);
  assert.equal(fullScreen,true);
  assert.deepEqual(calls,[true,true]);
  execute('exitFullScreen',window);
  assert.equal(fullScreen,false);
  assert.ok(protocol.NATIVE_MENU_ACTIONS.includes('quit'));
  execute('quit',window);
  assert.equal(quitRequested,1);
});

test('actual App entry effect requests fullscreen without receiving any initial window event',()=>{
  const source=fs.readFileSync(path.join(desktop,'src/App.tsx'),'utf8');
  const begin=source.indexOf('  const immersionFullscreenEntered = useRef(false);');
  const normalized=source.replaceAll('\r\n','\n');
  const start=normalized.indexOf('  const immersionFullscreenEntered = useRef(false);');
  const finish=normalized.indexOf('  useEffect(() => {\n    if (!craftmineWorldFirst)',start);
  assert.ok(begin>=0 && finish>start);
  const calls=[];
  const context={useRef:()=>({current:false}),useEffect:fn=>fn(),modeChosen:true,modeEntryOpen:false,craftmineImmersive:true,api:{nativeMenuAction:async action=>calls.push(action)}};
  const effect=transformSync(normalized.slice(start,finish),{loader:'ts'}).code;
  vm.runInNewContext(effect,context);
  assert.deepEqual(calls,['enterFullScreen']);
  for(const patch of [{modeChosen:false},{modeEntryOpen:true},{craftmineImmersive:false}]){
    calls.length=0;
    vm.runInNewContext(effect,{...context,...patch});
    assert.deepEqual(calls,[]);
  }
});

test('main native F2 uses the child-surface route exactly once, leaving Escape to DOM layers',()=>{
  const start=mainSource.indexOf('  window.webContents.on("before-input-event", (event, input) => {');
  const end=mainSource.indexOf('  // Fullscreen hides the macOS traffic lights',start);
  let listener;
  const actions=[];
  const context={window:{webContents:{on:(_name,fn)=>{listener=fn}}},immersionState:{active:true,blocked:false,overlay:'closed'},immersionShortcut:immersion.immersionShortcut,
    nativeFullscreenKeyDecision:()=>({preventDefault:false}),forwardImmersionShortcut:action=>actions.push(action),process:{platform:'win32'},pluginLauncherBinding:'',developerMode:false};
  vm.runInNewContext(transformSync(mainSource.slice(start,end),{loader:'ts'}).code,context);
  let prevented=0;
  listener({preventDefault:()=>prevented++},{type:'keyDown',key:'F2'});
  assert.equal(prevented,1);assert.deepEqual(actions,['compact']);
  listener({preventDefault:()=>prevented++},{type:'keyDown',key:'Escape'});
  assert.equal(prevented,1);assert.equal(actions.length,1);
  listener({preventDefault:()=>prevented++},{type:'keyDown',key:'F2',shift:true});
  assert.equal(prevented,2);assert.deepEqual(actions,['compact','full']);
});
