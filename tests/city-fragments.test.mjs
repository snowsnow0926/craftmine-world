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

test('ground clearance preserves existing GLB bytes and publishes measured approach/interior waypoints',()=>{
 const expected={'ward-building':'45f0bf31440d1d7f9e3776a127295f76017511e5696eb4868523c417e72ba80c','gate-section':'2918ee5b765e447274c73bae088cda7bc4ad298d232d36a48ad45b3a4e64fd6f','ward-street':'843f585b1c100ea88715d6e772621f494391bc79826758c663128bef10ffcccb'};
 for(const [slug,hash]of Object.entries(expected))assert.equal(sha(fs.readFileSync(path.join(root,'desktop/godot/components/city-fragments',slug,'geometry.glb'))),hash);
 const street=buildCityFragmentPackages({repository:root}).find(p=>p.entry.assetId==='cw.city.ward-street');
 const entry=unpackStaticPackage(street.bytes).resources[0].manifest.content.entry;
 assert.equal(entry.ground.surfaceClearanceMm,20);assert.equal(entry.ground.colliderMatchesSurface,true);assert.equal(entry.preview.receivingGroundY,0);
 assert.equal(entry.navigation.coordinates,'component-local-millimetres');assert.match(entry.navigation.meaning,/not exact doorway/);
 assert.deepEqual(entry.navigation.routes.find(r=>r.id==='first-house-entry').approachMm,[4000,20,17928]);
 assert.deepEqual(entry.navigation.routes.find(r=>r.id==='second-house-entry').interiorMm,[-1000,20,-10000]);
});
