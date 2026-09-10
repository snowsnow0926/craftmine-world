import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/index.ts',import.meta.url),'utf8');
const begin=source.indexOf('shutdownPromise = (async () => {');
const end=source.indexOf('await godotExports.dispose();',begin)+'await godotExports.dispose();'.length;
assert.ok(begin>0&&end>begin);
const fragment=source.slice(begin,end).replace('shutdownPromise = ','')+'})()';
for(const fail of [false,true]) test(`actual Main awaits preview exit before next owner, rejection=${fail}`,async()=>{
  const events=[];let resolve,reject;
  const gate=new Promise((a,b)=>{resolve=a;reject=b;});
  const pending=vm.runInNewContext(fragment,{assetPreviews:{dispose:()=>gate},godotExports:{async dispose(){events.push('next-owner');}},recordHeadlessShutdownFailure:(service,error)=>events.push([service,error.message]),logger:{app:()=>events.push('log')}});
  await Promise.resolve();assert.deepEqual(events,[]);
  fail?reject(Error('ASSET_PREVIEW_WORKER_STOP_TIMEOUT')):resolve();
  await pending;
  assert.deepEqual(events,fail?[['asset-previews','ASSET_PREVIEW_WORKER_STOP_TIMEOUT'],'log','next-owner']:['next-owner']);
});
