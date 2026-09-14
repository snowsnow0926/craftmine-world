import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildApprovedPomeranianPackage} from '../desktop/build-approved-pomeranian-package.mjs';
import {buildBuiltinPetPackage} from '../desktop/build-builtin-pet-package.mjs';
import {buildBuiltinSourceLibrary} from '../desktop/build-builtin-source-library.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
const require=createRequire(import.meta.url),{loadBuiltinPackages}=require('../plugins/craftmine-world/builtin-source-library.cjs');
const repository=path.resolve(import.meta.dirname,'..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const released=[
  [buildApprovedPomeranianPackage,1,'b3070a8780f26a44e2602fe5b75e4b1ffe8e3cff9e4305ea52ba6b333ae4c4f8'],
  [buildApprovedPomeranianPackage,2,'2c9c38faca756f6be9cdd787f8565243571ca736308706405710a5aa7225068a'],
  [buildApprovedPomeranianPackage,3,'186f0fa94cc396d7c625a45cdfdb6352d71891fab104ba54f961b2a16c171718'],
  [buildBuiltinPetPackage,2,'22614b01b614b9ef60a961c16dacbab5340dcc20e1765ac919bc687fbe08bb17'],
  [buildBuiltinPetPackage,3,'19e1d424316bc3621e9b9200f45ddceefec42813e2d24c2aebeb1b69ddffd1c3'],
];

test('every previously released companion archive remains byte-for-byte pinned',()=>{
  for(const [builder,version,expected] of released)assert.equal(builder({repository,version}).entry.sha256,expected);
});

test('v4 changes only heading construction in package source and preserves receiving-world contracts',()=>{
  for(const builder of [buildApprovedPomeranianPackage,buildBuiltinPetPackage]){
    const previous=unpackStaticPackage(builder({repository,version:3}).bytes).resources[0];
    const built=builder({repository,version:4}),next=unpackStaticPackage(built.bytes).resources[0];
    const oldContent=previous.manifest.content,content=next.manifest.content;
    assert.equal(content.version,4);assert.equal(content.assetId,oldContent.assetId);
    for(const field of ['state','interfaces','compatibility'])assert.deepEqual(content[field],oldContent[field]);
    for(const field of ['positionValidation','editableSettings','sourceRequirements','sourceRequirementProfiles','sceneInstall','playerBinding','interaction','appearances','placement'])assert.deepEqual(content.entry[field],oldContent.entry[field],field);
    let changed=0;
    for(const [name,bytes] of previous.files){
      const actual=next.files.get(name);
      if(name.endsWith('.gd')){
        assert.equal(actual.toString(),bytes.toString().replace('global_rotation.y = value','global_basis = Basis(Vector3.UP, value)'));
        assert.deepEqual(content.entry.upgradeFrom,{versions:[3],script:name,sha256:sha(bytes),mode:'same-script-path-preserve-entity-and-state'});
        changed++;
      }else assert.deepEqual(actual,bytes,name);
    }
    assert.equal(changed,1);assert.equal(next.files.size,previous.files.size);
    assert(built.entry.tags.includes('reusable-world-content'));
    assert(built.file.endsWith('.v4.zip'));
  }
});

test('the validated builtin inventory includes v4 as each companion latest version without replacing earlier rows',()=>{
  fs.mkdirSync(path.join(repository,'test-results'),{recursive:true});
  const output=fs.mkdtempSync(path.join(repository,'test-results/heading-library-'));
  const catalog=buildBuiltinSourceLibrary({repository,output});
  const verified=loadBuiltinPackages(output);
  for(const id of ['cw.module.approved-pomeranian','cw.module.pet-companion']){
    const entries=verified.entries.filter(row=>row.assetId===id);
    assert.equal(Math.max(...entries.map(row=>row.version)),4);
    assert(entries.some(row=>row.version===3));
    assert(entries.find(row=>row.version===4).tags.includes('reusable-world-content'));
    assert.equal(catalog.entries.find(row=>row.assetId===id&&row.version===4).sha256,entries.find(row=>row.version===4).sha256);
  }
  fs.writeFileSync(path.join(output,'heading-v4-receipt.json'),JSON.stringify({entries:verified.entries.filter(row=>row.version===4).map(({assetId,version,sha256,rootContentHash,bytes})=>({assetId,version,sha256,rootContentHash,bytes}))},null,2));
});
