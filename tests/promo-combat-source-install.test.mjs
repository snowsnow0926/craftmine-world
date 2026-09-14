import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {createManagedPackageInstaller} from '../plugins/craftmine-world/reuse-service.mjs';
import {buildPromoCombatPackages} from '../desktop/build-promo-combat-packages.mjs';
const require=createRequire(import.meta.url);
const {createSourceLibraryService}=require('../plugins/craftmine-world/source-library-service.cjs');

test('actual Core installs each promo stage through archive refs, source CAS and check requests',{skip:!process.env.CRAFTMINE_CORE_BIN},async t=>{
  await fs.mkdir('test-results',{recursive:true});
  const root=await fs.mkdtemp(path.resolve('test-results/promo-combat-install-'));
  const core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(root,'core'));
  const worldId='promo-combat-contract',context={projectId:'promo-contract',sessionId:'promo-session',turnId:'promo-turn'};
  const report={worldId,stages:[],modelCalls:0,engineStarted:false},calls=[];
  const call=async(method,args)=>{calls.push(method);return core.call(method,args,120000);};
  const indexAll=async()=>{
    let first=null,offset=0;const files=[];
    for(;;){const page=await call('godotProject.index',{context,worldId,offset,limit:32,...(first?{revision:first.revision,manifestHash:first.manifestHash}:{})});first??=page;files.push(...page.files);if(page.nextOffset==null)break;offset=page.nextOffset;}
    return {...first,files};
  };
  const readJSON=async(index,file)=>{
    let offset=0,text='';
    for(;;){const page=await call('godotProject.read',{context,worldId,revision:index.revision,manifestHash:index.manifestHash,path:file,offset,limit:16000});text+=page.text;if(page.nextOffset==null)break;offset=page.nextOffset;}
    return JSON.parse(text);
  };
  t.after(async()=>{await core.stop();await fs.writeFile(path.join(root,'report.json'),JSON.stringify({...report,calls},null,2));});
  await core.start();
  await call('world.create',{id:worldId,title:'Promo source contract CPU fixture',world:{build:{id:'base-promo-contract',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
  await call('workspace.open',{context,selectedWorld:worldId});
  const base=path.resolve('desktop/godot/bases/creation-sandbox');
  let source=await call('godotProject.create',{context,worldId,toolCallId:'source-create',baseBuild:'base-promo-contract',baseId:'creation-sandbox',files:[{path:'project.godot',text:await fs.readFile(path.join(base,'project.godot'),'utf8')}]});
  const files=[];
  async function walk(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(entry.name==='.godot')continue;const file=path.join(directory,entry.name);if(entry.isDirectory())await walk(file);else{const name=path.relative(base,file).replaceAll('\\','/');if(name!=='project.godot'&&!name.endsWith('.mjs'))files.push({path:name,bytesBase64:(await fs.readFile(file)).toString('base64'),expectedHash:null});}}}
  await walk(base);
  source=await call('godotProject.applyFiles',{context,worldId,toolCallId:'base-files',revision:source.revision,manifestHash:source.manifestHash,files});
  await call('content.migrate.apply',{worldId});
  const queued=[];
  const installer=createManagedPackageInstaller({call,enqueue:async request=>{queued.push(request);},stagingRoot:path.join(root,'installs'),bind:async(worldId,operationId)=>{
    const worldRecord=await call('world.read',{id:worldId}),status=await call('content.status',{worldId}),index=await call('godotProject.index',{context,worldId,offset:0,limit:1});
    return {context,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:index.branchId,expectedHeadOid:status.branches.find(b=>b.name==='refs/heads/'+index.branchId).oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};
  }});
  const service=createSourceLibraryService({call,installSource:installer,directory:path.join(root,'proposals')});
  const built=buildPromoCombatPackages();
  const refs=[];
  for(const item of built){
    const sourcePath=path.join(root,item.file);await fs.writeFile(sourcePath,item.bytes);
    await call('asset.import',{operationId:'seed-'+item.entry.assetId,sourceRoot:root,sourcePath,assetId:item.entry.assetId,version:1,kind:'module',mediaKind:'package',path:item.file,mediaType:'application/x-godot-package',displayName:item.entry.label,source:item.entry.source,tags:item.entry.tags});
    const read=await call('asset.read',{assetId:item.entry.assetId,version:1});refs.push({assetId:item.entry.assetId,version:1,contentHash:read.version_.contentHash});
  }
  const initial=await indexAll();
  const earlyHunt=await service.tool({mode:'propose',ref:refs.find(x=>x.assetId.endsWith('hunt'))},context,worldId,'early-hunt');
  await assert.rejects(service.installProposal({worldId,proposalId:earlyHunt.proposal.proposalId}),/PACKAGE_BASE_SOURCE_MISMATCH/);
  assert.equal((await call('godotProject.index',{context,worldId,offset:0,limit:1})).manifestHash,initial.manifestHash);
  for(const ref of refs){
    const before=await indexAll();
    const proposed=await service.tool({mode:'propose',ref},context,worldId,'propose-'+ref.assetId);
    const installed=await service.installProposal({worldId,proposalId:proposed.proposal.proposalId});
    assert.equal(installed.applied,false);assert.equal(installed.instanceIds.length,1);
    const after=await indexAll();
    assert(after.revision>before.revision);
    for(const old of before.files){
      if(old.path==='scenes/creation.tscn')continue;
      // These two ordinary package ledgers append the new installed resource;
      // existing declaration entries must remain exactly intact.
      if(['craftmine.assets.lock.json','craftmine.instances.json'].includes(old.path)){
        const previous=await readJSON(before,old.path),current=await readJSON(after,old.path);
        const key=old.path==='craftmine.assets.lock.json'?'assets':'instances';
        assert.equal(current[key].length,previous[key].length+1);
        for(const entry of previous[key])assert(current[key].some(row=>JSON.stringify(row)===JSON.stringify(entry)),old.path+' preserves prior entry');
      }else assert.equal(after.files.find(f=>f.path===old.path)?.sha256,old.sha256,'existing source preserved: '+old.path);
    }
    assert(after.files.some(f=>f.path==='addons/'+ref.assetId+'/model.glb'));
    assert(installed.job?.jobId);
    if(installed.job.status==='blocked')assert.equal(installed.job.blockedReason,'GODOT_EXECUTION_UNAVAILABLE');
    else {assert.equal(queued.at(-1)?.jobId,installed.job.jobId);await call('godotBuild.cancel',{worldId,jobId:installed.job.jobId});}
    report.stages.push({ref,installed,sourceRevision:after.revision,manifestHash:after.manifestHash,checkExecution:'not-executed-in-CPU-source-transaction-fixture; see actual job status and separate engine evidence'});
  }
  const final=await indexAll();
  const scene=await call('godotProject.read',{context,worldId,revision:final.revision,manifestHash:final.manifestHash,path:'scenes/creation.tscn',offset:0,limit:20000});
  assert.equal((scene.text.match(/entity_id = /g)??[]).length,4);
  report.passed=true;report.normalSourceTransactions=4;
});
