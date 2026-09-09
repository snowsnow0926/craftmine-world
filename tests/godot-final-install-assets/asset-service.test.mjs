import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createAssetService} from '../../plugins/craftmine-world/asset-service.mjs';
import {createAssetPreviewHost} from '../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/host-service.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const slots=new Map(),operations=new Map();let attempts=0;
 const call=async(method,args)=>{
  if(method==='asset.read')return {version_:{contentHash:'a'.repeat(64),files:[{path:'a.png',sha256:sha('A'),mediaType:'image/png'},{path:'b.png',sha256:sha('B'),mediaType:'image/png'}]}};
  const key=args.settingsHash;
  if(method==='asset.previewBegin'){
   const prior=slots.get(key);
   if(prior&&['pending','ok'].includes(prior.status))return {cacheKey:key,cached:true,preview:prior,claim:prior.status==='pending'?prior.claim:null};
   const claim={attempt:++attempts,claimId:'claim-'+attempts};slots.set(key,{status:'pending',claim});return {cacheKey:key,claim,retried:!!prior,timeoutMs:1000};
  }
  if(method==='asset.previewFinish'){
   const old=operations.get(args.operationId),text=JSON.stringify(args);if(old){assert.equal(old.text,text);return old.result;}
   const current=slots.get(key);if(current?.claim?.claimId!==args.claimId||current.status!=='pending')return {applied:false,stale:true};
   slots.set(key,{status:args.status,claim:null,facts:args.facts});const result={applied:true,status:args.status};operations.set(args.operationId,{text,result});return result;
  }
  throw Error(method);
 };
 return {call,slots};
}
const args={assetId:'image',version:1};
test('concurrent service calls run one worker and cancellation rejects its late result',async()=>{
 const f=fixture(),started=defer(),release=defer();let runs=0,cancels=0;
 const service=createAssetService({call:f.call,runPreview:async input=>{runs++;assert.equal(input.bytes,undefined);started.resolve();await release.promise;return {status:'ok',facts:{decoder:'test',digest:'b'.repeat(64)}};},cancelPreview:async()=>{cancels++;}});
 const a=service.preview(args),b=service.preview(args);await started.promise;assert.equal(runs,1);
 await service.cancel(args);release.resolve();assert.equal((await a).stale,true);await b;assert.equal(cancels,1);assert.equal([...f.slots.values()][0].status,'cancelled');
});
test('file identity separates caches and exceptions finish the attempt before retry',async()=>{
 const f=fixture();let runs=0;const service=createAssetService({call:f.call,runPreview:async()=>{if(++runs===1)throw Error('read failed');return {status:'ok',facts:{decoder:'test',digest:'b'.repeat(64)}};}});
 assert.equal((await service.preview(args)).status,'failed');assert.equal((await service.preview(args)).status,'ok');
 await service.preview({...args,path:'b.png'});assert.equal(runs,3);assert.equal(f.slots.size,2);
});
test('host resolves and verifies bytes; duplicate job shares execution and cancel is explicit',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asset-host-'));const file=path.join(dir,'blob');await fs.writeFile(file,'A');let runs=0;const started=defer();
 const host=createAssetPreviewHost({resolveBody:async()=>({blobPath:file,bytes:1,sha256:sha('A'),mediaType:'image/png'}),runPreview:async(input,{signal})=>{runs++;assert.equal(input.bytes.toString(),'A');started.resolve();return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({status:'cancelled'}),{once:true}));}});
 const input={jobId:'job-1',assetId:'a',version:1,path:'a.png',settingsHash:'default',engineVersion:'test',attempt:1,claimId:'c'};
 const a=host.preview(input),b=host.preview(input);await started.promise;await host.cancel({jobId:'job-1'});assert.equal((await a).status,'cancelled');await b;assert.equal(runs,1);
 await fs.writeFile(file,'B');await assert.rejects(host.preview({...input,jobId:'job-2'}),/CORRUPT_ASSET_BODY/);
 assert.throws(()=>host.preview({...input,blobPath:file}),/INVALID_ASSET_PREVIEW_REQUEST/);await host.dispose();
});
