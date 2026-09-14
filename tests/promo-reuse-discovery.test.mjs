import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildBuiltinSourceLibrary} from '../desktop/build-builtin-source-library.mjs';
const require=createRequire(import.meta.url);
const {CoreClient}=require('../plugins/craftmine-world/core-client.cjs');
const {seedBuiltinSourceLibrary}=require('../plugins/craftmine-world/builtin-source-library.cjs');
const {createSourceLibraryService}=require('../plugins/craftmine-world/source-library-service.cjs');

test('real bundled catalog finds all six promo components with player vocabulary and reads exact live archive refs',
  {skip:!process.env.CRAFTMINE_CORE_BIN},async t=>{
    await fs.mkdir('test-results',{recursive:true});
    const out=await fs.mkdtemp(path.resolve('test-results/promo-reuse-discovery-'));
    const directory=path.join(out,'library');buildBuiltinSourceLibrary({output:directory});
    const core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(out,'core'));
    const report={out,modelCalls:0,worldWrites:0,scope:'Real Core catalog and source-library read; no receiving-world compatibility or gameplay claim',searches:[]};
    t.after(async()=>{await core.stop();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));});
    await core.start();const call=(...args)=>core.call(...args);
    report.seed=await seedBuiltinSourceLibrary({directory,call});assert.deepEqual(report.seed.conflicts,[]);
    const service=createSourceLibraryService({call,directory:path.join(out,'proposals'),installSource:async()=>{throw Error('DISCOVERY_MUST_NOT_INSTALL');}});
    for(const [query,id] of [
      ['树','cw.nature.promo-broadleaf'],['花草','cw.scene.promo-meadow'],
      ['怪物','cw.module.promo-monsters'],['剑','cw.module.promo-heavyblade'],
      ['重剑','cw.module.promo-heavyblade'],['大怪物','cw.module.promo-hunt'],
      ['怪猎','cw.module.promo-hunt'],['AK47','cw.module.promo-ak47'],
    ]){
      const search=await service.tool({mode:'search',query},{},'no-active-world','query-'+id);
      const entry=search.result.items.find(item=>item.assetId===id);
      assert(entry,`Default search must expose ${id} for ${query}`);
      const read=await service.tool(entry.readRequest,{},'no-active-world','read-'+id);
      assert.equal(read.rootRef.id,id);assert.equal(read.applied,false);
      assert.equal(read.automaticInstallation.status,'declared');
      assert.equal(read.targetCompatibility.runtimeVerified,false);
      assert.equal(read.targetCompatibility.status,'unknown');
      assert(Array.isArray(read.resources[0].dependencies));
      report.searches.push({query,assetId:id,position:search.result.items.indexOf(entry)+1,archiveRef:entry.archiveRef,
        automaticInstallation:read.automaticInstallation.status,compatibility:read.targetCompatibility.status});
    }
    const old=await call('asset.read',{assetId:'cw.module.sandbox-combat',version:1});
    assert.equal(old.version_.files[0].sha256,'bf763ccd427c0135b59b0e8db9024136c80dd7810de8d5e004157fc526aeaf63');
    const latest=await call('asset.search',{scope:'local-library',mediaKind:'package',query:'cw.module.sandbox-combat',offset:0,limit:20});
    assert.deepEqual(latest.items.filter(item=>item.assetId==='cw.module.sandbox-combat').map(item=>item.version),[2]);
    report.passed=true;
  });
