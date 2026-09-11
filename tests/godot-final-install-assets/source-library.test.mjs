import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {packStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../plugins/craftmine-world/package-format.mjs';
const {createSourceLibraryService}=createRequire(import.meta.url)('../../plugins/craftmine-world/source-library-service.cjs');
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
 const call=async(method,args)=>{calls.push({method,args});if(method==='asset.read')return {version_:version};if(method==='asset.bodyPath')return {...version.files[0],blobPath};if(method==='asset.search')return {items:[{...ref,tags:['builtin','prefab','nature'],source:version.source}]};if(method==='godotProject.index')return {worldId:'world',revision:state.revision,manifestHash:state.manifestHash};throw Error(method);};
 const installSource=async args=>{installs.push(args);assert.deepEqual(args.expectedSource,{revision:1,manifestHash:'a'.repeat(64)});if(state.resultError)throw Error('LOST_REPLY');return {worldId:'world',applied:false,archiveSha256:sha(archive),instanceIds:['tree-instance'],status:'check-queued',source:{revision:2,manifestHash:'b'.repeat(64)},job:{jobId:'gjob-'+'1'.repeat(64),status:'queued'}};};
 const groupInstalls=[];
 const installSourceGroup=async args=>{
   groupInstalls.push(args);if(args.expectedSource.revision!==state.revision)throw Error('PACKAGE_PROPOSAL_SOURCE_CHANGED');if(state.resultError)throw Error('LOST_REPLY');
   const archives=args.items.map((item,index)=>({archiveSha256:sha(Buffer.from(item.archiveBase64,'base64')),instanceIds:['tree-instance-'+index]}));
   if(state.badGroupReceipt)archives[1].archiveSha256='e'.repeat(64);
   return {worldId:'world',applied:false,archives,instanceIds:archives.flatMap(a=>a.instanceIds),status:'check-queued',source:{revision:2,manifestHash:'b'.repeat(64)},job:{jobId:'gjob-'+'1'.repeat(64),status:'queued'}};
 };
 const create=()=>createSourceLibraryService({call,installSource,installSourceGroup,directory:path.join(directory,'proposals')});
 const context={projectId:'p',sessionId:'s',turnId:'t'};return {ref,archive,blobPath,calls,installs,groupInstalls,state,version,create,context,tool:(service,args)=>service.tool(args,context,'world','call-one')};
}
test('modern catalog ZIP discovery retains provenance and distinct root identity without exposing bodies',async t=>{
 const f=await fixture(t),s=f.create();const search=await f.tool(s,{mode:'search',query:'tree'});assert.deepEqual(search.result.items[0].tags,['builtin','prefab','nature']);assert.equal(f.calls[0].args.mediaKind,'package');
 const read=await f.tool(s,{mode:'read',ref:f.ref});assert.deepEqual(read.archiveRef,f.ref);assert.notEqual(read.rootRef.sha256,f.ref.contentHash);assert.equal(read.resources[0].entry.sceneInstall.nodeType,'Node3D');assert.equal(read.source.license,'CC0-1.0');
 assert.equal(JSON.stringify(read).includes(f.blobPath),false);assert.equal(JSON.stringify(read).includes('base64'),false);assert.equal(f.installs.length,0);
});
test('host-frozen proposal persists across restart and installs only through the normal source installer',async t=>{
 const f=await fixture(t),s=f.create(),result=await f.tool(s,{mode:'propose',ref:f.ref});const p=result.proposal;
 assert.equal(p.requiresPlayerAction,true);assert.equal(f.installs.length,0);assert.equal((await s.proposals({worldId:'other'})).items.length,0);
 await assert.rejects(s.installProposal({worldId:'other',proposalId:p.proposalId}),/WORLD_MISMATCH/);
 const restarted=f.create();assert.equal((await restarted.proposals({worldId:'world'})).items.length,1);
 const applied=await restarted.installProposal({worldId:'world',proposalId:p.proposalId});assert.equal(applied.applied,false);assert.equal(f.installs.length,1);
 assert.deepEqual(await f.create().installProposal({worldId:'world',proposalId:p.proposalId}),applied);assert.equal(f.installs.length,1);assert.equal((await s.proposals({worldId:'world'})).items.length,0);
 assert.equal(f.calls.some(c=>['package.check','package.install','world.update'].includes(c.method)),false);
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
