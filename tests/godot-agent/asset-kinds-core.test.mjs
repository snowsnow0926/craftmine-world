import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {compileScene,INITIAL_SNAPSHOT} from '../../app/scene.mjs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const canonical=['base','world','module','object','scene','raw','data'];
const aliases={creation:'module','world-template':'world'};
const binary=process.env.CRAFTMINE_CORE_BIN;
const bundle=path.join(root,'desktop/build/craftmine.world');
test('canonical kinds and legacy aliases round-trip through real core and packaged model broker',{skip:binary&&fs.existsSync(path.join(bundle,'world-tools.cjs'))?false:'Set CRAFTMINE_CORE_BIN and build plugin'},async t=>{
  const {CoreClient}=require('../../plugins/craftmine-world/core-client.cjs');
  const {createWorldTools}=require(path.join(bundle,'world-tools.cjs'));
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/asset-kinds-'));
  const core=new CoreClient(binary,path.join(out,'data'));t.after(()=>core.stop());await core.start();
  const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const report={format:'craftmine.asset-kinds-core-trial/1',binary,binarySha256:sha(binary),modelCalls:0,godotExecutions:0,imports:[],reads:[],scope:'Explicit isolated catalog/world setup; real packaged read tool; no installation or player acceptance'};
  try{
    const context={projectId:'kind-project',sessionId:'kind-session',turnId:'kind-turn'};
    const scene=compileScene({format:'craftmine.scene/3',title:'Kind query diagnostic',night:false,objects:[],systems:[],behaviors:[]});
    await core.call('world.create',{id:'kind-world',title:'Kind query diagnostic',world:{build:{...scene,id:'v-'+scene.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]}});
    await core.call('workspace.open',{context,selectedWorld:'kind-world'});
    const file=path.join(out,'fixture.zip');fs.copyFileSync(path.join(root,'docs/evidence/gu6-kenney-modules-20260912/building.zip'),file);
    for(const kind of [...canonical,...Object.keys(aliases)]){
      const imported=await core.call('asset.import',{operationId:'seed-'+kind,sourceRoot:out,sourcePath:file,assetId:'kind-'+kind,version:1,kind,mediaKind:'package',path:'fixture.zip',mediaType:'application/zip',displayName:'Kind '+kind,source:{origin:'local fixture',author:'Craftmine diagnostic',license:'Original attribution retained in audited fixture ZIP',licenseStatus:'unverified'}});
      report.imports.push({requestedKind:kind,assetId:imported.assetId});
    }
    const direct=await core.call('asset.search',{scope:'local-library',kind:'module',latestOnly:false,offset:0,limit:100});
    assert.ok(direct.items.some(item=>item.assetId==='kind-module'));report.directModule=direct;
    const tool=createWorldTools(core,async()=>({activeWorldId:'kind-world',discussionOnly:true})).find(tool=>tool.name==='asset_library');
    const invocation={...context,toolCallId:'kind-query',executionId:'kind-execution'};
    // Before the fix this throws INVALID_ASSET_KIND, after direct Core succeeded.
    const moduleResult=await tool.execute({mode:'search',scope:'local-library',kind:'module',limit:100},invocation);
    assert.ok(moduleResult.result.items.some(item=>item.assetId==='kind-module'));
    const all=await tool.execute({mode:'search',scope:'local-library',latestOnly:false,limit:100},invocation);
    assert.equal(all.result.items.length,9);
    for(const item of all.result.items){
      assert.ok(canonical.includes(item.kind));
      const filtered=await tool.execute({mode:'search',scope:'local-library',kind:item.kind,limit:100},invocation);
      assert.ok(filtered.result.items.some(found=>found.assetId===item.assetId),'returned kind must be usable verbatim');
      report.reads.push({assetId:item.assetId,returnedKind:item.kind,filteredIds:filtered.result.items.map(found=>found.assetId)});
    }
    for(const [alias,kind] of Object.entries(aliases)){
      const old=await tool.execute({mode:'search',scope:'local-library',kind:alias,limit:100},invocation);
      const current=await tool.execute({mode:'search',scope:'local-library',kind,limit:100},invocation);
      assert.deepEqual(old.result.items,current.result.items);
      assert.ok(old.result.items.some(item=>item.assetId==='kind-'+alias&&item.kind===kind));
    }
    const definition=require(path.join(bundle,'manifest.json')).contributes.agentTools.find(tool=>tool.name==='asset_library');
    assert.deepEqual(definition.schema.properties.kind.enum,[...canonical,...Object.keys(aliases)]);
    assert.equal(definition.risk,'low');
    for(const name of ['godot-library.cjs','manifest.json'])assert.equal(sha(path.join(bundle,name)),sha(path.join(root,'plugins/craftmine-world',name)));
    await assert.rejects(tool.execute({mode:'search',scope:'local-library',kind:'invented'},invocation),/INVALID_ASSET_KIND/);
    report.passed=true;
  }catch(error){report.passed=false;report.error=error.message;throw error;}
  finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('asset_kinds_evidence='+path.join(out,'report.json'));}
});
