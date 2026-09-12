import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'package-native-')),{build}=createRequire(path.join(process.env.CRAFTMINE_DEPS_ROOT||path.resolve('vendor/pi-desktop/packages/agent-runtime'),'package.json'))('esbuild');
await build({entryPoints:[path.resolve('vendor/pi-desktop/apps/desktop/electron/main/craftmine-package-service.ts')],outfile:path.join(root,'native.mjs'),bundle:true,platform:'node',format:'esm'});
const {createCraftminePackageService}=await import(pathToFileURL(path.join(root,'native.mjs'))),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('modern source proposals use only the fixed private installer route and omit private receipts',async()=>{
 let selected='alpha';const calls=[],proposalId='source-'+'a'.repeat(48);
 const service=createCraftminePackageService({selection:()=>selected,pickFile:async()=>{throw Error('picker forbidden');},domainCall:async(channel,input)=>{
   calls.push({channel,input});if(input.method==='sourceProposals')return {worldId:'alpha',items:[{proposalId,worldId:'alpha',displayName:'Tree',source:{revision:1,manifestHash:'a'.repeat(64)}}]};
   assert.equal(input.method,'installSourceProposal');return {worldId:'alpha',applied:false,status:'check-queued',instanceIds:['tree'],archiveSha256:'b'.repeat(64),source:{revision:2,manifestHash:'c'.repeat(64),privatePath:'hidden'},job:{jobId:'gjob-'+'d'.repeat(64),status:'queued',request:{secret:'hidden'}}};
 }});
 const invoke=(method,extra={})=>service.request('package.request',{worldId:'alpha',method,params:{worldId:'alpha',...extra}});
 assert.equal((await invoke('sourceProposals')).items.length,1);const result=await invoke('installSourceProposal',{proposalId});assert.equal(result.applied,false);assert.equal(JSON.stringify(result).includes('hidden'),false);assert.equal(calls[1].channel,'package.request');
 await assert.rejects(invoke('installSourceProposal',{proposalId,archiveBase64:'forged'}),/INVALID_PARAMS/);selected='beta';await assert.rejects(invoke('installSourceProposal',{proposalId}),/WORLD_CHANGED/);
});

test('group confirmation projects ordered member identities and rejects inconsistent receipts',async()=>{
 const result={worldId:'alpha',applied:false,status:'check-queued',instanceIds:['first','second'],archives:[{archiveSha256:'a'.repeat(64),instanceIds:['first'],privatePath:'hidden'},{archiveSha256:'b'.repeat(64),instanceIds:['second']}],source:{revision:2,manifestHash:'c'.repeat(64),privatePath:'hidden'},job:{jobId:'gjob-'+'d'.repeat(64),status:'queued',request:{secret:'hidden'}}};
 const calls=[],service=createCraftminePackageService({selection:()=> 'alpha',pickFile:async()=>{throw Error('picker forbidden');},domainCall:async(channel,input)=>{calls.push({channel,input});return result;}});
 const invoke=()=>service.request('package.request',{worldId:'alpha',method:'installSourceProposal',params:{worldId:'alpha',proposalId:'source-'+'a'.repeat(48)}});
 const projected=await invoke();assert.deepEqual(projected.archives,[{archiveSha256:'a'.repeat(64),instanceIds:['first']},{archiveSha256:'b'.repeat(64),instanceIds:['second']}]);assert.equal(JSON.stringify(projected).includes('hidden'),false);assert.equal('archiveSha256' in projected,false);
 assert.deepEqual(calls[0].input.args,{worldId:'alpha',proposalId:'source-'+'a'.repeat(48)});
 result.archives[1].instanceIds=['first'];await assert.rejects(invoke(),/INSTALL_RECEIPT_INVALID/);result.archives[1].instanceIds=['second'];
 result.archives[1].archiveSha256='bad';await assert.rejects(invoke(),/INSTALL_RECEIPT_INVALID/);result.archives[1].archiveSha256='b'.repeat(64);
 result.archives.reverse();await assert.rejects(invoke(),/INSTALL_RECEIPT_INVALID/);
});
async function fixture() {
 const dir=await fs.mkdtemp(path.join(root,'case-')),file=path.join(dir,'component.zip'),bytes=Buffer.from('fixed opaque test ZIP bytes');await fs.writeFile(file,bytes);
 const state={world:'alpha',now:0,fail:false,calls:[],pick:file,picks:0};
 const service=createCraftminePackageService({selection:async()=>state.world,now:()=>state.now,pickFile:async()=>{state.picks++;return state.pick;},domainCall:async(channel,input)=>{assert.equal(channel,'package.request');state.calls.push(input);if(input.method==='installSource'){if(state.fail){state.fail=false;throw Object.assign(Error('lost'),{code:'TRANSPORT_LOST'});}return{worldId:input.args.worldId,status:'check-queued',applied:false,archiveSha256:sha(Buffer.from(input.args.archiveBase64,'base64')),instanceIds:['i-'+input.args.operationId],source:{revision:1,manifestHash:'a'.repeat(64),privatePath:dir},job:{jobId:'gjob-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',status:'queued',request:{body:'private source'},root:dir}};}if(input.method==='exportSource')return{archiveBase64:bytes.toString('base64'),archiveSha256:sha(bytes),files:2};if(input.method==='sourceList')return{worldId:state.world,revision:1,manifestHash:'a'.repeat(64),mainScene:'world.tscn',items:[],archiveBase64:'never-render',privatePath:dir};throw Error('unknown');}});
 const call=(method,args={})=>service.request('package.request',{worldId:state.world,method,params:{worldId:state.world,...args}});return {dir,file,bytes,state,service,call};
}
test('lost import result retries exact bytes and operation without opening another picker',async()=>{const f=await fixture();f.state.fail=true;await assert.rejects(f.call('importSource',{operationId:'same-operation'}),/TRANSPORT_LOST/);const result=await f.call('importSource',{operationId:'same-operation'});assert.equal(f.state.picks,1);assert.deepEqual(f.state.calls[0],f.state.calls[1]);assert.equal(JSON.stringify(result).includes('private source'),false);assert.equal(JSON.stringify(result).includes(f.dir),false);assert.ok(result.grantId);const repeat=await f.call('repeatImportSource',{operationId:'new-operation',grantId:result.grantId});assert.notDeepEqual(result.instanceIds,repeat.instanceIds);});
test('world, hash and expiration grants reject before another install',async()=>{const f=await fixture(),receipt=await f.call('importSource',{operationId:'first-operation'});f.state.world='beta';await assert.rejects(f.call('repeatImportSource',{operationId:'wrong-world-op',grantId:receipt.grantId}),/WORLD_MISMATCH/);f.state.world='alpha';await fs.writeFile(f.file,'changed');await assert.rejects(f.call('repeatImportSource',{operationId:'changed-file-op',grantId:receipt.grantId}),/FILE_CHANGED/);await fs.writeFile(f.file,f.bytes);f.state.now=700000;await assert.rejects(f.call('repeatImportSource',{operationId:'expired-file-op',grantId:receipt.grantId}),/GRANT_EXPIRED/);assert.equal(f.state.calls.filter(call=>call.method==='installSource').length,1);});
test('source responses are projected and renderer paths cannot become authority',async()=>{const f=await fixture();const list=await f.call('sourceList');assert.equal('archiveBase64'in list,false);assert.equal('privatePath'in list,false);await assert.rejects(f.call('importSource',{operationId:'inject-path-op',archivePath:f.file}),/INVALID_PARAMS/);await assert.rejects(f.service.request('package.request',{worldId:'alpha',method:'sourceList',params:{worldId:'beta'}}),/WORLD_MISMATCH/);});
test('oversized and linked files reject without invoking a core installer',async()=>{const f=await fixture();const handle=await fs.open(f.file,'w');await handle.truncate(5*1024*1024+1);await handle.close();await assert.rejects(f.call('importSource',{operationId:'oversized-file-op'}),/TOO_LARGE/);const target=path.join(f.dir,'owned-target'),link=path.join(f.dir,'owned-link');await fs.mkdir(target);await fs.writeFile(path.join(target,'component.zip'),f.bytes);await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');f.state.pick=path.join(link,'component.zip');await assert.rejects(f.call('importSource',{operationId:'linked-file-op'}),/LINK_DENIED/);assert.equal(f.state.calls.length,0);});
test('native export saves verified bytes and returns no archive payload',async()=>{const f=await fixture();f.state.pick=path.join(f.dir,'export.zip');const result=await f.call('exportSource',{revision:1,manifestHash:'a'.repeat(64),nodePath:'Door',assetId:'door',version:1});assert.equal(result.status,'completed');assert.deepEqual(await fs.readFile(f.state.pick),f.bytes);assert.equal('archiveBase64'in result,false);f.service.dispose();await assert.rejects(f.call('sourceList'),/DISPOSED/);});
console.log('PACKAGE_NATIVE_FIXTURE '+root);

test('normal source-file import freezes finite placement into its exact retry identity',async()=>{
 const f=await fixture(),position={x:3,y:0,z:-4};f.state.fail=true;
 await assert.rejects(f.call('importSource',{operationId:'placed-import',position}),/TRANSPORT_LOST/);
 assert.deepEqual(f.state.calls[0].args.position,position);
 await assert.rejects(f.call('importSource',{operationId:'placed-import',position:{x:4,y:0,z:-4}}),/PACKAGE_OPERATION_CONFLICT/);
 await f.call('importSource',{operationId:'placed-import',position});assert.deepEqual(f.state.calls[0],f.state.calls[1]);assert.equal(f.state.picks,1);
 for(const bad of [{x:81,y:0,z:0},{x:0,y:NaN,z:0},{x:0,z:0},{x:0,y:0,z:0,extra:1}])await assert.rejects(f.call('importSource',{operationId:'bad-position',position:bad}),/INVALID_PLACEMENT|INVALID_PARAMS/);
 assert.equal(f.state.picks,1);
});

test('sourceJob queries exact world/job only and projects no source, token or private paths',async()=>{
 const jobId='gjob-'+'b'.repeat(64),calls=[];let selected='alpha',wrong=false,status='running';
 const service=createCraftminePackageService({selection:()=>selected,pickFile:async()=>{throw Error('picker forbidden');},domainCall:async(method,args)=>{calls.push({method,args});return{worldId:wrong?'beta':'alpha',jobId,status,source:{text:'private script'},request:{token:'private'},artifactsRoot:'private path'};}});
 const call=(extra={})=>service.request('package.request',{worldId:'alpha',method:'sourceJob',params:{worldId:'alpha',jobId,...extra}});
 assert.deepEqual(await call(),{worldId:'alpha',jobId,status:'running',terminal:false});
 assert.deepEqual(calls,[{method:'package.sourceJob',args:{worldId:'alpha',jobId}}]);
 status='blocked';assert.equal((await call()).terminal,false);
 status='passed';assert.equal((await call()).terminal,true);
 status='unexpected';await assert.rejects(call(),/JOB_RECEIPT_INVALID/);status='running';
 wrong=true;await assert.rejects(call(),/JOB_RECEIPT_INVALID/);wrong=false;
 const before=calls.length;await assert.rejects(call({jobId:'bad'}),/INVALID_PARAMS/);await assert.rejects(call({sourcePath:'x'}),/INVALID_PARAMS/);assert.equal(calls.length,before);
 selected='beta';await assert.rejects(call(),/WORLD_CHANGED/);service.dispose();
});
