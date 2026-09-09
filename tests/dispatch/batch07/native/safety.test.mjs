import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {installNativeGameAcceptance} from '../../../../app/craftmine-acceptance-game.mjs';
import {NATIVE_ACCEPTANCE_SOURCE} from '../../../../vendor/pi-desktop/apps/desktop/electron/shared/craftmine-native-acceptance-source.mjs';
const require=createRequire(new URL('../../../../vendor/pi-desktop/apps/desktop/package.json',import.meta.url)),ts=require('typescript');
const source=fs.readFileSync(new URL('../../../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-acceptance-batch07.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function controller(enabled=true,env={CRAFTMINE_BATCH07_NATIVE:'1'}){
  const listeners=[],sent=[],calls=[],exports={};
  vm.runInNewContext(js,{exports,require,process:{env,send:m=>sent.push(m),on:(_event,listener)=>listeners.push(listener)},Error,Object,JSON});
  exports.installBatch07NativeAcceptance({enabled,call:async(...args)=>calls.push(args),world:()=>null,window:()=>null});
  return {listeners,calls,async request(message){listeners[0]?.({type:'craftmine-acceptance-batch07',id:'fixture',...message});await new Promise(resolve=>setImmediate(resolve));return sent.at(-1);}};
}
test('normal processes expose neither parent controller nor game callback',()=>{
  assert.equal(controller(false).listeners.length,0);assert.equal(controller(true,{}).listeners.length,0);
  installNativeGameAcceptance({getEngine:()=>{throw Error('Ordinary process must not expose engine');}});
  assert.equal(globalThis.__craftmineNativeAcceptance,undefined);
});
test('unknown events and arbitrary fields are rejected before any host or page access',async()=>{
  const fixture=controller();assert.match((await fixture.request({method:'initialize',source:'untrusted code'})).error,/Unexpected/);
  assert.match((await fixture.request({method:'game:arbitrary'})).error,/Unknown fixed game/);
  assert.equal(fixture.calls.length,0);
});
test('formal runtime keeps ordinary preview message rejection despite native capability',()=>{
  const game=fs.readFileSync(new URL('../../../../app/game.js',import.meta.url),'utf8');
  assert.match(game,/if\(m.type==='request-observe'\|\|m.type==='request-step'\)\{\s*if\(!preview\)throw Error/);
  const preload=fs.readFileSync(new URL('../../../../vendor/pi-desktop/apps/desktop/electron/preload/craftmine-headless.ts',import.meta.url),'utf8');
  assert.match(preload,/new MutationObserver\(inject\)/);
  assert.doesNotMatch(preload,/if\s*\(.*globalThis\.__craftmineNativeAcceptance/);
  const realm=vm.createContext({});vm.runInContext(NATIVE_ACCEPTANCE_SOURCE,realm);
  const descriptor=Object.getOwnPropertyDescriptor(realm,'__craftmineNativeAcceptance');
  assert.equal(descriptor.configurable,false);assert.equal(descriptor.writable,false);
  assert.throws(()=>realm.__craftmineNativeAcceptance.invoke('arbitrary'),/unavailable/);
});
