import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../vendor/pi-desktop/apps/desktop/package.json',import.meta.url));
const ts=require('typescript');
const source=fs.readFileSync(new URL('../../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-acceptance-f-agent.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(enabled=true,env={CRAFTMINE_F_AGENT:'1'}){
  const listeners=[],sent=[],calls=[];
  const fakeProcess={env,send:message=>sent.push(message),on:(name,fn)=>listeners.push(fn)};
  const exports={};vm.runInNewContext(js,{exports,require,process:fakeProcess,Error,Object,JSON});
  exports.installNativeAgentAcceptance({enabled,call:async(method,args)=>{calls.push({method,args});return method==='session.create'?{session:{id:'isolated'}}:{provider:{id:'provider'}};},panel:async()=>({activeWorldId:'world'}),window:()=>null,world:()=>null,active:()=>false});
  return {listeners,sent,calls,async request(message){listeners[0]?.({type:'craftmine-acceptance-f',id:'test',...message});await new Promise(resolve=>setTimeout(resolve,10));return sent.at(-1);}};
}
test('fixed native controller is absent in ordinary processes',()=>{
  assert.equal(fixture(false).listeners.length,0);assert.equal(fixture(true,{}).listeners.length,0);
});
test('fixed native controller rejects arbitrary fields before any call',async()=>{
  const f=fixture();const result=await f.request({method:'initialize',source:'arbitrary code'});
  assert.match(result.error,/Unexpected/);assert.equal(f.calls.length,0);
});
test('fixed native controller refuses missing authorized provider and premature commands',async()=>{
  const f=fixture();assert.match((await f.request({method:'initialize'})).error,/authorized/);assert.equal(f.calls.length,0);
  assert.match((await f.request({method:'prompt'})).error,/Initialize/);
});
test('initialization response never includes the provider credential',async()=>{
  const f=fixture(true,{CRAFTMINE_F_AGENT:'1',CRAFTMINE_F_MODEL:'deepseek-test',CRAFTMINE_F_KEY:'isolated-test-secret'});
  const reply=await f.request({method:'initialize'});assert.equal(reply.result.sessionId,'isolated');assert.ok(!JSON.stringify(reply).includes('isolated-test-secret'));
  assert.match((await f.request({method:'initialize'})).error,/already initialized/);
});
