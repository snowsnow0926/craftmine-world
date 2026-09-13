import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildCityFragments} from '../scripts/build-city-fragments.mjs';
import {buildCityFragmentPackages} from '../desktop/build-city-fragment-packages.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {sha} from '../scripts/lib/city-fragments.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('city fragments regenerate deterministically from approved original geometry without whole-city payloads',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'city-fragments-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const generated=buildCityFragments({output:temp}),original=JSON.parse(fs.readFileSync(path.join(root,'desktop/godot/components/city-fragments/manifest.json')));assert.deepEqual(generated,original);
 for(const entry of generated.entries){const m=JSON.parse(fs.readFileSync(path.join(temp,entry.slug,'component.json')));assert.equal(m.geometry.boundaryTrianglesExcluded,0);assert.ok(m.geometry.bytes<400000);assert.equal(m.geometry.bounds.min[1],0);for(const file of m.files)assert.equal(sha(fs.readFileSync(path.join(temp,entry.slug,file.path))),file.sha256);}
});
test('native library packages retain geometry provenance, one identity, placement and honest capability bounds',()=>{
 const packages=buildCityFragmentPackages({repository:root});assert.equal(packages.length,3);
 for(const pkg of packages){const archive=unpackStaticPackage(pkg.bytes),resource=archive.resources[0],entry=resource.manifest.content.entry;
  assert.equal(archive.resources.length,1);assert.deepEqual(entry.entities,['fragment']);assert.deepEqual(entry.sourceRequirements,[]);assert.ok(pkg.entry.tags.includes('reusable-world-content'));assert.equal(pkg.entry.source.licenseStatus,'unverified');assert.ok(entry.geometry.collisionTriangles>0);assert.equal(resource.manifest.content.state.kind,'static-component-no-player-state');
  assert.ok([...resource.files.keys()].every(file=>!['project.godot','world.tscn','creation_world.gd'].includes(file)));assert.ok(resource.files.has('city_surface.gdshader'));assert.ok(resource.files.has('ORIGINAL_ASSETS_LICENSE.txt'));assert.ok(entry.lineage.sources.every(source=>/^[a-f0-9]{64}$/.test(source.sourceSha256)));
 }
});
