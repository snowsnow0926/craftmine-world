import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {packStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../plugins/craftmine-world/package-format.mjs';
const {createSourceLibraryService}=createRequire(import.meta.url)(process.env.CRAFTMINE_SOURCE_LIBRARY_PLUGIN?path.join(path.resolve(process.env.CRAFTMINE_SOURCE_LIBRARY_PLUGIN),'source-library-service.cjs'):'../../plugins/craftmine-world/source-library-service.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'source-library-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const files={'tree.gd':Buffer.from('extends Node3D\n@export var entity_id: String = ""\n')};
 const content={assetId:'kenney-tree',version:1,kind:'object',files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),dependencies:[],entry:{entities:['tree'],sceneInstall:{mode:'script-node',script:'tree.gd',nodeType:'Node3D',identityField:'entity_id'}},interfaces:{},compatibility:{base:'creation-sandbox'},state:{},licenses:{}};
 const archive=packStaticPackage({root:{id:content.assetId,version:1},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files}]});
 const blobPath=path.join(directory,'archive.zip');await fs.writeFile(blobPath,archive);
 const ref={assetId:'builtin.tree',version:1,contentHash:'c'.repeat(64)},calls=[],installs=[];
 const version={...ref,mediaKind:'package',displayName:'精选树',source:{origin:'Kenney',author:'Kenney',license:'CC0-1.0',licenseStatus:'verified'},files:[{path:'tree.zip',sha256:sha(archive),bytes:archive.length,mediaType:'application/x-godot-package'}]};
 const state={revision:1,manifestHash:'a'.repeat(64),resultError:false};
 const call=async(method,args)=>{calls.push({method,args});if(method==='world.read')return {id:'world',runtimeKind:'godot'};if(method==='godotProject.sourceContext')return {context:{projectId:'source',sessionId:'read',turnId:'readonly'}};if(method==='godotBuild.read')return state.job;if(method==='godotCandidate.read')return state.candidate;if(method==='asset.read')return {version_:version};if(method==='asset.bodyPath')return {...version.files[0],blobPath};if(method==='asset.search')return {items:[{...ref,tags:['builtin','prefab','nature'],source:version.source}]};if(method==='godotProject.index')return {worldId:'world',revision:state.revision,manifestHash:state.manifestHash,...(state.sourceExtra??{})};throw Error(method);};
 const installSource=async args=>{installs.push(args);assert.deepEqual(args.expectedSource,{revision:1,manifestHash:'a'.repeat(64)});if(state.resultError)throw Error('LOST_REPLY');return {worldId:'world',applied:false,archiveSha256:sha(archive),instanceIds:['tree-instance'],status:'check-queued',source:{revision:2,manifestHash:'b'.repeat(64)},job:{jobId:'gjob-'+'1'.repeat(64),status:'queued'}};};
 installSource.readOperation=async()=>state.intent??null;
 const groupInstalls=[];
 const installSourceGroup=async args=>{
   groupInstalls.push(args);if(args.expectedSource.revision!==state.revision)throw Error('PACKAGE_PROPOSAL_SOURCE_CHANGED');if(state.resultError)throw Error('LOST_REPLY');
   const archives=args.items.map((item,index)=>({archiveSha256:sha(Buffer.from(item.archiveBase64,'base64')),instanceIds:['tree-instance-'+index]}));
   if(state.badGroupReceipt)archives[1].archiveSha256='e'.repeat(64);
   return {worldId:'world',applied:false,archives,instanceIds:archives.flatMap(a=>a.instanceIds),status:'check-queued',source:{revision:2,manifestHash:'b'.repeat(64)},job:{jobId:'gjob-'+'1'.repeat(64),status:'queued'}};
 };
 const create=(extra={})=>createSourceLibraryService({call,installSource,installSourceGroup,directory:path.join(directory,'proposals'),...extra});
 const context={projectId:'p',sessionId:'s',turnId:'t'};return {ref,archive,blobPath,calls,installs,groupInstalls,state,version,create,context,tool:(service,args)=>service.tool(args,context,'world','call-one')};
}
test('modern catalog ZIP discovery retains provenance and distinct root identity without exposing bodies',async t=>{
 const f=await fixture(t),s=f.create();const search=await f.tool(s,{mode:'search',query:'tree'});assert.deepEqual(search.result.items[0].tags,['builtin','prefab','nature']);assert.equal(f.calls[0].args.mediaKind,'package');
 const read=await f.tool(s,{mode:'read',ref:f.ref});assert.deepEqual(read.archiveRef,f.ref);assert.notEqual(read.rootRef.sha256,f.ref.contentHash);assert.equal(read.resources[0].entry.sceneInstall.nodeType,'Node3D');assert.equal(read.source.license,'CC0-1.0');
 assert.deepEqual(search.result.items[0].installRef,f.ref);assert.deepEqual(search.result.items[0].readRequest,{mode:'read',ref:f.ref});assert.deepEqual(read.installRef,f.ref);assert.match(read.referenceRoles.rootRef,/never substitute/);assert.equal(read.targetCompatibility.status,'unknown');
 assert.equal(JSON.stringify(read).includes(f.blobPath),false);assert.equal(JSON.stringify(read).includes('base64'),false);assert.equal(f.installs.length,0);
});

test('explicit author installation returns the real job and survives retries without creating a player confirmation',async t=>{
 const f=await fixture(t);let installed=0,release;
 const gate=new Promise(resolve=>release=resolve);
 const s=f.create({installAuthorSource:async(args,context,active,group)=>{installed++;active();assert.deepEqual(context,f.context);assert.equal(group,false);await gate;return {worldId:'world',applied:false,archiveSha256:sha(f.archive),instanceIds:['second-dog'],status:'check-queued',source:{revision:2,manifestHash:'b'.repeat(64)},job:{jobId:'gjob-'+'2'.repeat(64),status:'queued'}};}});
 const first=f.tool(s,{mode:'install',ref:f.ref});const second=f.tool(s,{mode:'install',ref:f.ref});release();
 const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);assert.equal(installed,1);assert.equal(a.jobId,'gjob-'+'2'.repeat(64));assert.equal(a.applied,false);assert.equal(a.proposal.requiresPlayerAction,false);assert.equal(a.proposal.execution,'author');
 f.state.revision=2;const replay=await f.tool(s,{mode:'install',ref:f.ref});assert.equal(replay.jobId,a.jobId);assert.equal(installed,1);
 await assert.rejects(f.tool(s,{mode:'install',ref:f.ref,position:{x:1,y:0,z:0}}),/PROPOSAL_CONFLICT/);
 assert.equal(f.installs.length,0,'The manual installer is never used');
});

test('failed author preparation stays retryable by the author and cannot cross into a manual task',async t=>{
 const f=await fixture(t),s=f.create({installAuthorSource:async()=>{throw Error('SOURCE_LIBRARY_AUTOMATIC_INSTALL_NOT_AUTHORIZED');}});
 await assert.rejects(f.tool(s,{mode:'install',ref:f.ref}),/NOT_AUTHORIZED/);
 const proposal=(await s.proposals({worldId:'world'})).items[0];assert.equal(proposal.execution,'author');assert.equal(proposal.requiresPlayerAction,false);
 await assert.rejects(s.installProposal({worldId:'world',proposalId:proposal.proposalId}),/AUTHOR_RETRY_REQUIRED/);
 assert.equal(f.installs.length,0);
});
test('host-frozen proposal persists across restart and installs only through the normal source installer',async t=>{
 const f=await fixture(t),s=f.create(),result=await f.tool(s,{mode:'propose',ref:f.ref});const p=result.proposal;
 assert.equal(p.requiresPlayerAction,true);assert.equal(f.installs.length,0);assert.equal((await s.proposals({worldId:'other'})).items.length,0);
 await assert.rejects(s.installProposal({worldId:'other',proposalId:p.proposalId}),/WORLD_MISMATCH/);
 const restarted=f.create();assert.equal((await restarted.proposals({worldId:'world'})).items.length,1);
 const applied=await restarted.installProposal({worldId:'world',proposalId:p.proposalId});assert.equal(applied.applied,false);assert.equal(f.installs.length,1);
 assert.deepEqual(await f.create().installProposal({worldId:'world',proposalId:p.proposalId}),applied);assert.equal(f.installs.length,1);
 const retained=(await f.create().proposals({worldId:'world'})).items[0];
 assert.equal(retained.requiresPlayerAction,false);assert.equal(retained.status,'check-queued');
 assert.deepEqual(retained.installation,{source:applied.source,instanceIds:['tree-instance'],job:{jobId:applied.job.jobId,status:'queued'}});
 assert.equal(retained.applied,false,'A retained check is not adoption evidence');
 assert.equal(f.calls.some(c=>['package.check','package.install','world.update'].includes(c.method)),false);
});

test('cancellation fences new proposals and preserves already existing retry records',async t=>{
 const f=await fixture(t),s=f.create();let checks=0;
 await assert.rejects(s.tool({mode:'propose',ref:f.ref},f.context,'world','cancelled-call',()=>{if(++checks===3)throw Error('TURN_ENDED');}),/TURN_ENDED/);
 assert.equal((await s.proposals({worldId:'world'})).items.length,0,'Late newly written proposal is removed');
 const existing=await f.tool(s,{mode:'propose',ref:f.ref});
 await assert.rejects(s.tool({mode:'propose',ref:f.ref},f.context,'world','call-one',()=>{throw Error('TURN_ENDED');}),/TURN_ENDED/);
 assert.equal((await s.proposals({worldId:'world'})).items[0].proposalId,existing.proposal.proposalId);
 assert.equal(f.installs.length,0);
});
test('bad references, changed ZIPs, arbitrary paths and forged source identity fail closed',async t=>{
 const f=await fixture(t),s=f.create();await assert.rejects(f.tool(s,{mode:'read',ref:{id:'legacy',version:1,hash:'a'.repeat(64)}}),/INVALID_ASSET_REF_FIELDS/);
 await assert.rejects(f.tool(s,{mode:'propose',ref:f.ref,worldId:'other'}),/INVALID_PARAMS/);
 await assert.rejects(f.tool(s,{mode:'propose',ref:f.ref,expectedSource:{revision:0}}),/INVALID_PARAMS/);
 const p=(await f.tool(s,{mode:'propose',ref:f.ref})).proposal;await fs.writeFile(f.blobPath,Buffer.alloc(f.archive.length));
 await assert.rejects(s.installProposal({worldId:'world',proposalId:p.proposalId}),/BODY_MISMATCH/);assert.equal(f.installs.length,0);
 await assert.rejects(s.installProposal({worldId:'world',proposalId:'../outside'}),/INVALID_PROPOSAL/);
});
test('lost installation response retries the same frozen operation; a changed proposal call cannot overwrite it',async t=>{
 const f=await fixture(t),s=f.create(),p=(await f.tool(s,{mode:'propose',ref:f.ref})).proposal;
 f.state.resultError=true;await assert.rejects(s.installProposal({worldId:'world',proposalId:p.proposalId}),/LOST_REPLY/);f.state.resultError=false;
 await f.create().installProposal({worldId:'world',proposalId:p.proposalId});assert.deepEqual(f.installs[0],f.installs[1]);
 f.state.revision=2;await assert.rejects(f.tool(s,{mode:'propose',ref:f.ref}),/PROPOSAL_CONFLICT/);
});

test('explicit finite placement is frozen, survives restart and cannot be overwritten at confirmation',async t=>{
 const f=await fixture(t),s=f.create(),position={x:2,y:0,z:-4};
 for(const bad of [{x:81,y:0,z:0},{x:0,y:Infinity,z:0},{x:0,z:0},{x:0,y:0,z:0,sourcePath:'forged'}])await assert.rejects(f.tool(s,{mode:'propose',ref:f.ref,position:bad}),/INVALID_POSITION|INVALID_PARAMS/);
 const p=(await f.tool(s,{mode:'propose',ref:f.ref,position})).proposal;assert.deepEqual(p.position,position);
 await assert.rejects(s.installProposal({worldId:'world',proposalId:p.proposalId,position:{x:9,y:0,z:0}}),/INVALID_PARAMS/);
 await f.create().installProposal({worldId:'world',proposalId:p.proposalId});assert.deepEqual(f.installs[0].position,position);
});

test('one group freezes ordered repeated refs and placements, restarts and installs once',async t=>{
 const f=await fixture(t),s=f.create(),items=[{ref:f.ref,position:{x:-3,y:0,z:1}},{ref:f.ref,position:{x:3,y:0,z:1}}];
 const result=await f.tool(s,{mode:'propose-group',items});assert.equal(result.items.length,2);assert.equal(result.proposal.kind,'group');
 assert.deepEqual(result.proposal.items.map(item=>item.position),items.map(item=>item.position));
 assert.equal(f.calls.filter(c=>c.method==='godotProject.index').length,1);assert.equal(f.calls.filter(c=>c.method==='asset.bodyPath').length,1);
 assert.equal(f.groupInstalls.length,0);assert.equal(JSON.stringify(result).includes(f.blobPath),false);assert.equal(JSON.stringify(result).includes('archiveBase64'),false);
 const restarted=f.create(),p=result.proposal;assert.equal((await restarted.proposals({worldId:'world'})).items[0].kind,'group');
 await assert.rejects(restarted.installProposal({worldId:'world',proposalId:p.proposalId,items:[]}),/INVALID_PARAMS/);
 const applied=await restarted.installProposal({worldId:'world',proposalId:p.proposalId});assert.equal(f.groupInstalls.length,1);assert.equal(f.installs.length,0);
 assert.deepEqual(f.groupInstalls[0].items.map(i=>i.position),items.map(i=>i.position));assert.equal(applied.instanceIds.length,2);
 assert.deepEqual(await f.create().installProposal({worldId:'world',proposalId:p.proposalId}),applied);assert.equal(f.groupInstalls.length,1);
});

test('group rejects invalid members before proposal and changed body before any installer call',async t=>{
 const f=await fixture(t),s=f.create(),item={ref:f.ref};
 for(const items of [[],[item],Array(9).fill(item),[item,{ref:f.ref,position:{x:90,y:0,z:0}}],[item,{ref:f.ref,archiveBase64:'forged'}]])await assert.rejects(f.tool(s,{mode:'propose-group',items}),/INVALID_GROUP|INVALID_POSITION|INVALID_PARAMS/);
 assert.equal((await s.proposals({worldId:'world'})).items.length,0);
 const p=(await f.tool(s,{mode:'propose-group',items:[item,item]})).proposal;
 await fs.writeFile(f.blobPath,Buffer.alloc(f.archive.length));await assert.rejects(s.installProposal({worldId:'world',proposalId:p.proposalId}),/BODY_MISMATCH/);
 assert.equal(f.groupInstalls.length,0);assert.equal(f.installs.length,0);
});

test('group preserves CAS, member receipt identities and exact retry operation after lost response',async t=>{
 const f=await fixture(t),s=f.create(),items=[{ref:f.ref,position:{x:-2,y:0,z:0}},{ref:f.ref,position:{x:2,y:0,z:0}}];
 const p=(await f.tool(s,{mode:'propose-group',items})).proposal;
 f.state.revision=2;await assert.rejects(s.installProposal({worldId:'world',proposalId:p.proposalId}),/PROPOSAL_SOURCE_CHANGED/);f.state.revision=1;
 f.state.resultError=true;await assert.rejects(s.installProposal({worldId:'world',proposalId:p.proposalId}),/LOST_REPLY/);f.state.resultError=false;
 f.state.badGroupReceipt=true;await assert.rejects(s.installProposal({worldId:'world',proposalId:p.proposalId}),/INSTALL_RECEIPT_INVALID/);f.state.badGroupReceipt=false;
 const result=await f.create().installProposal({worldId:'world',proposalId:p.proposalId});assert.equal(result.applied,false);
 assert.ok(f.groupInstalls.every(args=>JSON.stringify(args)===JSON.stringify(f.groupInstalls[0])));
 await assert.rejects(f.tool(s,{mode:'propose-group',items:[items[1],items[0]]}),/PROPOSAL_CONFLICT/);
});

test('direct inspection uses read-only Core source context and native installer freezes exact bytes',async t=>{
 const f=await fixture(t),s=f.create();const info=await s.directInspect({worldId:'world',ref:f.ref});assert.equal(info.eligible,true);assert.equal(info.compatibility,'unchecked');assert.equal(f.installs.length,0);assert.equal(f.calls.filter(c=>c.method==='godotProject.sourceContext').length,1);
 assert.equal(f.calls.some(c=>c.method==='turn.begin'),false);
 const result=await s.directInstall({worldId:'world',ref:f.ref,operationId:'direct-fixture-01',expectedSource:info.source,position:{x:1,y:0,z:2}});assert.equal(result.applied,false);assert.equal(f.installs.length,1);assert.deepEqual(Buffer.from(f.installs[0].archiveBase64,'base64'),f.archive);
 await assert.rejects(s.directInstall({worldId:'world',ref:{...f.ref,contentHash:'9'.repeat(64)},operationId:'direct-fixture-01',expectedSource:info.source}),/ASSET_CHANGED/);
 f.version.mediaKind='model';await assert.rejects(s.directInspect({worldId:'world',ref:f.ref}),/NOT_SOURCE_PACKAGE/);
});

test('direct recovery binds check, candidate and current draft; only durable adoption bypasses completed task reads',async t=>{
 const f=await fixture(t),s=f.create(),jobId='gjob-'+'1'.repeat(64),candidateId='candidate-direct';
 assert.equal((await s.directStatus({worldId:'world',operationId:'direct-fixture-01'})).status,'unknown');
 f.state.intent={worldId:'world',context:f.context,job:{id:jobId},receipt:{revision:1,manifestHash:f.state.manifestHash},instanceIds:['tree-instance'],applyRequest:{operation:{branchId:'main'}}};
 f.state.job={worldId:'world',jobId,candidateId,buildId:'build-direct',status:'passed',sourceRevision:1,manifestHash:f.state.manifestHash,outputHash:'d'.repeat(64),taskId:'task-direct',branchId:'main'};
 f.state.candidate={checkStatus:'passed',candidate:{worldId:'world',candidateId,status:'ready',buildId:'build-direct',checkJobId:jobId,sourceRevision:1,manifestHash:f.state.manifestHash,checkOutputHash:'d'.repeat(64)}};
 f.state.sourceExtra={currentTaskId:'task-direct'};
 assert.equal((await s.directStatus({worldId:'world',operationId:'direct-fixture-01'})).status,'ready');
 f.state.revision=2;await assert.rejects(s.directStatus({worldId:'world',operationId:'direct-fixture-01'}),/SOURCE_CHANGED/);
 f.state.candidate.adoption={worldId:'world',candidateId,buildId:'build-direct',wasApplied:true,inCurrentLineage:true};
 assert.equal((await s.directStatus({worldId:'world',operationId:'direct-fixture-01'})).status,'applied');
 f.state.candidate.candidate.checkOutputHash='f'.repeat(64);await assert.rejects(s.directStatus({worldId:'world',operationId:'direct-fixture-01'}),/UNVERIFIED/);
});
