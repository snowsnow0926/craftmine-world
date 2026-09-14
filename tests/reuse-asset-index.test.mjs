import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildBuiltinSourceLibrary} from '../desktop/build-builtin-source-library.mjs';
import {buildReuseAssetIndex} from '../desktop/build-reuse-asset-index.mjs';

test('checked-in reuse index describes exactly the current built library and keeps reference-only IDs non-installable',()=>{
  fs.mkdirSync('test-results',{recursive:true});
  const output=fs.mkdtempSync(path.resolve('test-results/reuse-index-'));
  buildBuiltinSourceLibrary({output});
  const built=buildReuseAssetIndex({catalogBytes:fs.readFileSync(path.join(output,'catalog.json'))});
  const published=JSON.parse(fs.readFileSync('plugins/craftmine-world/reuse-catalog/asset-index.json'));
  const identities=index=>index.components.map(item=>({assetId:item.assetId,versions:item.versions,route:item.route,latestListedVersion:item.latestListedVersion}));
  assert.deepEqual(identities(published),identities(built),'Regenerate the asset index explicitly after changing the bundled catalog');
  assert.equal(published.assetCount,built.assetCount);
  assert.equal(published.versionCount,built.versionCount);
  assert.deepEqual(published.sourceFeatures.map(item=>[item.id,item.status,item.relatedAssetId,item.plannedComponentId]),
    built.sourceFeatures.map(item=>[item.id,item.status,item.relatedAssetId,item.plannedComponentId]));
  for(const item of built.sourceFeatures){
    if(item.status==='reference-only'){
      assert(item.plannedComponentId);assert.equal(item.relatedAssetId,undefined);assert.equal(item.searchRequest,undefined);
    }else{
      assert(built.components.some(component=>component.assetId===item.relatedAssetId));
      assert.equal(item.searchRequest.query,item.relatedAssetId);
    }
  }
  assert(built.referenceWorlds.every(world=>world.codeReadRoute===null));
  const model=built.components.find(item=>item.assetId==='cw.model.approved-pomeranian');
  assert.equal(model.route,'asset_library-model-only');assert.equal(model.searchRequest,undefined);
});
