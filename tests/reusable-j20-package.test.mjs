import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildReusableJ20Package,REUSABLE_J20_ID,APPROVED_J20_SHA256} from '../desktop/build-reusable-j20-package.mjs';
import {buildBuiltinSourceLibrary} from '../desktop/build-builtin-source-library.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
const repository=path.resolve('.'),sha=b=>createHash('sha256').update(b).digest('hex');
test('drivable J20 packages exact accepted visual and scoped flight requirements within source limits',()=>{
 const built=buildReusableJ20Package({repository}),r=unpackStaticPackage(built.bytes).resources[0],c=r.manifest.content;
 assert.equal(c.assetId,REUSABLE_J20_ID);assert.equal(sha(r.files.get('model.glb')),APPROVED_J20_SHA256);assert.equal(r.files.get('model.glb').length,1130080);
 assert.ok(c.files.reduce((n,f)=>n+f.bytes,0)<4*1024*1024);assert.ok(built.bytes.length<5*1024*1024);
 assert.ok(c.entry.capabilities.includes('runway-takeoff'));assert.ok(c.entry.capabilities.includes('persistent-flight'));assert.equal(c.entry.airspaceRequirements.runwayLengthM,2400);
 assert.equal(c.entry.lineage.model.regeneratedForLibrary,false);assert.equal(c.state.format,'craftmine.reusable-j20-state/1');assert.equal(c.licenses.modelLicenseStatus,'unverified');
 assert.ok(!c.entry.sourceRequirements.some(f=>f.path==='scripts/creation_world.gd'),'An authored large flight world may retain its own source');
 assert.equal(c.entry.preview.capture.scope,'formal');assert.equal(c.entry.preview.sha256,sha(r.files.get('preview.png')));assert.match(c.entry.preview.note,/does not certify/);
});
test('new raw J20 and drivable J20 entries stay distinct without changing the original 22 package hashes',()=>{
 fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/j20-library-'));const catalog=buildBuiltinSourceLibrary({output:out});
 const model=catalog.entries.find(e=>e.assetId==='cw.model.approved-j20'),component=catalog.entries.find(e=>e.assetId===REUSABLE_J20_ID);
 assert.equal(model.mediaKind,'model');assert.equal(model.sha256,APPROVED_J20_SHA256);assert.equal(component.kind,'module');assert.ok(model.tags.includes('reusable-world-content'));assert.ok(component.tags.includes('reusable-world-content'));
 assert.equal(model.preview,undefined);assert.equal(component.preview.scope,'component-view');assert.equal(sha(fs.readFileSync(path.join(out,component.preview.file))),component.preview.sha256);
 const baseline=JSON.parse(fs.readFileSync('tests/fixtures/builtin-source-library-approved-20260913-sha256.json'));
 // The accepted Pom pair was added after this 20-entry fixture. These two
 // hashes come from the sealed 7fde6778 Windows client's actual catalog.
 Object.assign(baseline,{'cw.module.approved-pomeranian.zip':'b3070a8780f26a44e2602fe5b75e4b1ffe8e3cff9e4305ea52ba6b333ae4c4f8','cw.model.approved-pomeranian.glb':'1ab9f354598df75504b061fb06e1e5e386bd59c878afcec3bad8388832dadd0b'});
 assert.equal(Object.keys(baseline).length,22);
 for(const [file,hash]of Object.entries(baseline)){const actual=catalog.entries.find(e=>e.file===file);assert.ok(actual);assert.equal(actual.sha256,hash);}
});
test('a changed aircraft source cannot retain an earlier captured thumbnail',()=>{
 const temp=fs.mkdtempSync(path.resolve('test-results/j20-preview-source-'));fs.cpSync(path.join(repository,'desktop/godot/components/reusable-j20'),temp,{recursive:true});
 fs.appendFileSync(path.join(temp,'aircraft.gd'),'\n# Changed source must receive a fresh actual capture.\n');
 assert.throws(()=>buildReusableJ20Package({repository,root:temp}),/J20_PREVIEW_SOURCE_CHANGED/);
});
