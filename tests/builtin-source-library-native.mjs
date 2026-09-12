// Real Rust asset catalog; imports packaged resources only. No world/model/UI.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {CoreClient}=require('../plugins/craftmine-world/core-client.cjs');
const {seedBuiltinSourceLibrary,loadBuiltinPackages}=require('../plugins/craftmine-world/builtin-source-library.cjs');
const [binary,directory,pluginDirectory]=process.argv.slice(2);assert.ok(binary&&directory&&path.isAbsolute(binary)&&path.isAbsolute(directory),'Pass real core executable and built library directory');
const output=fs.mkdtempSync(path.resolve('test-results/builtin-core-'));
const core=new CoreClient(binary,path.join(output,'data')),report={format:'craftmine.builtin-library-native/1',binary,directory,modelCalls:0,worldWrites:0};
try{
  await core.start();const call=(...args)=>core.call(...args);
  report.first=await seedBuiltinSourceLibrary({directory,call});assert.equal(report.first.conflicts.length,0);
  const inventory=loadBuiltinPackages(directory);assert.equal(report.first.imported.length,inventory.entries.length);
  report.second=await seedBuiltinSourceLibrary({directory,call});assert.equal(report.second.imported.length,0);assert.equal(report.second.existing.length,inventory.entries.length);
  const search=await call('asset.search',{scope:'local-library',query:'橡树',offset:0,limit:20});
  assert.ok(JSON.stringify(search).includes('cw.nature.tree-oak'),'Real Chinese catalog search must find the shipped object');
  const entry=inventory.entries[0];const body=await call('asset.bodyPath',{assetId:entry.assetId,version:entry.version,path:entry.file});
  assert.deepEqual(fs.readFileSync(body.blobPath),fs.readFileSync(entry.filename));
  if(pluginDirectory){
    assert.ok(path.isAbsolute(pluginDirectory));
    const {createSourceLibraryService}=require(path.join(pluginDirectory,'source-library-service.cjs'));
    const service=createSourceLibraryService({call,directory:path.join(output,'proposals'),installSource:async()=>{throw Error('NO_WORLD_WRITES_EXPECTED');},ensureBuiltin:()=>seedBuiltinSourceLibrary({directory,call})});
    const record=await call('asset.read',{assetId:entry.assetId,version:entry.version});
    const summary=await service.tool({mode:'read',ref:{assetId:entry.assetId,version:entry.version,contentHash:record.version_.contentHash}},{},'unused-world','unused-read');
    assert.equal(summary.rootRef.id,entry.assetId);assert.equal(summary.rootRef.sha256,entry.rootContentHash);assert.equal(summary.applied,false);
    assert.ok(summary.resources[0].entry.sceneInstall);report.bundledServiceRead=true;
  }
  report.search=search;report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack??error);process.exitCode=1;}
finally{await core.stop();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,report:path.join(output,'report.json'),error:report.error?.split('\n')[0]}));}
