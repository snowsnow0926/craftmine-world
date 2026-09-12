// Audited ZIP bytes, real isolated catalog, actual model-facing read bindings.
// Catalog import does not execute Godot or certify source-package compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {previewAsset} from '../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/preview-service.mjs';
const require=createRequire(import.meta.url);
const {CoreClient}=require('../../plugins/craftmine-world/core-client.cjs');
const {createLibraryBinding}=require('../../plugins/craftmine-world/godot-library.cjs');
const root=fileURLToPath(new URL('../../',import.meta.url));
const binary=process.env.CRAFTMINE_CORE_BIN;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const packages=[
 {name:'building',id:'kenney-city-building-trial',label:'Kenney 城市建筑',tag:'建筑',sha256:'351f4774db7a9c9fb8154bd79b96609267b15f7b3de05f52341b3629278766d5'},
 {name:'road',id:'kenney-city-road-trial',label:'Kenney 城市道路',tag:'道路',sha256:'3144cb5dedd450677282045f9aae9d78dbea84989fe940e55888b4b722537314'},
];

test('ZIP catalog previews never claim archive validation or execute package contents',async()=>{
 for(const bytes of [Buffer.from('not a valid archive'),await readFile(path.join(root,'docs/evidence/gu6-kenney-modules-20260912/building.zip'))]){
  const result=previewAsset({assetId:'zip-fixture',version:1,contentHash:hash(bytes),mediaType:'application/zip',bytes,path:'building.zip'});
  assert.equal(result.status,'failed');assert.equal(result.detail,'ARCHIVE_REQUIRES_PACKAGE_CHECK');
  assert.deepEqual(result.facts,{picture:false,playable:false,executed:false,archiveValidated:false});
 }
});

test('audited Kenney source ZIPs are searchable after explicit catalog import without inventing checks',{skip:binary?false:'CRAFTMINE_CORE_BIN required'},async t=>{
 const directory=await mkdtemp(path.join(root,'test-results/gu6-library-'));
 let core=new CoreClient(binary,path.join(directory,'data'));t.after(()=>core.stop());await core.start();
 const report={format:'craftmine.gu6-library-trial/1',binarySha256:hash(await readFile(binary)),directory,modelCalls:0,godotExecutions:0,imports:[],reads:[],scope:'explicit host import into isolated real catalog, then model-facing read bindings; no player or install claim'};
 const makeBinding=()=>createLibraryBinding({core,worldId:'library-test-world',context:{projectId:'library-test',sessionId:'library-test',turnId:'library-test'}});
 let library=makeBinding();
 assert.equal((await library.assetSearch({scope:'local-library'})).result.items.length,0);
 const scan=await core.call('asset.scan',{sourceRoot:path.join(root,'docs/evidence/gu6-kenney-modules-20260912')});
 for(const item of packages)assert.ok(scan.items.some(file=>file.path===item.name+'.zip'&&file.mediaType==='application/zip'),JSON.stringify(scan));
 assert.equal((await library.assetSearch({scope:'local-library'})).result.items.length,0,'scan cannot import');report.scan=scan;
 for(const item of packages){
  const sourcePath=path.join(root,'docs/evidence/gu6-kenney-modules-20260912',item.name+'.zip');
  assert.equal(hash(await readFile(sourcePath)),item.sha256);
  const args={operationId:'catalog-'+item.name,sourceRoot:path.dirname(sourcePath),sourcePath,assetId:item.id,version:1,kind:'object',mediaKind:'package',path:item.name+'.zip',mediaType:'application/zip',displayName:item.label,source:{origin:'https://github.com/KenneyNL/Starter-Kit-City-Builder',author:'Kenney; Craftmine trial adapter',license:'Upstream code MIT; models CC0; adapter and detailed attribution retained inside ZIP',licenseStatus:'unverified'},tags:['Kenney','城市',item.tag]};
  const imported=await core.call('asset.import',args);
  const replay=await core.call('asset.import',args);
  assert.equal(replay.contentHash,imported.contentHash);assert.equal(replay.assetId,item.id);
  report.imports.push({name:item.name,zipSha256:item.sha256,result:imported});
  const found=await library.assetSearch({scope:'local-library',query:item.tag,kind:'object',mediaKind:'package',tags:['Kenney']});
  assert.equal(found.available,true);assert.equal(found.result.items.length,1);assert.equal(found.result.items[0].assetId,item.id);
  const read=await library.assetRead({assetId:item.id,version:1});assert.equal(read.available,true);
  assert.equal(read.result.version_.files[0].sha256,item.sha256);
  assert.deepEqual(read.result.state,{indexed:true,previewable:false,baseChecked:null,appliedToSource:null});
  const probe=await core.call('asset.probe',{assetId:item.id,version:1});
  assert.equal(probe.probeOk,false);assert.equal(probe.reason,'ARCHIVE_REQUIRES_PACKAGE_CHECK');assert.equal(probe.facts.archiveValidated,false);
  const versions=await library.assetVersions({assetId:item.id});assert.equal(versions.available,true);
  report.reads.push({name:item.name,search:found,read,versions,probe});
  const changed=path.join(directory,item.name+'.zip');await writeFile(changed,Buffer.from('changed archive'));
  await assert.rejects(core.call('asset.import',{...args,operationId:'conflict-'+item.name,sourceRoot:directory,sourcePath:changed}),error=>error.errorCode==='ASSET_VERSION_CONFLICT');
  const retained=await library.assetRead({assetId:item.id,version:1});assert.equal(retained.result.version_.files[0].sha256,item.sha256);
 }
 await core.stop(); core=new CoreClient(binary,path.join(directory,'data'));await core.start();library=makeBinding();
 const cold=await library.assetSearch({scope:'local-library',query:'Kenney',kind:'object',mediaKind:'package'});
 assert.equal(cold.result.items.length,2);
 assert.deepEqual(cold.result.items.map(item=>item.assetId).sort(),packages.map(item=>item.id).sort());
 const current=await library.assetSearch({scope:'current-world'});assert.equal(current.result.items.length,0,'indexing must not claim installation into the bound world');
 report.cold=cold;report.currentWorld=current;report.passed=true;
 await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('library_trial_report='+path.join(directory,'report.json'));
});
