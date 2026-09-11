import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import test from 'node:test';
const root=path.resolve('desktop/godot/components/curated-starter'),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),hash=data=>createHash('sha256').update(data).digest('hex');
test('curated items keep exact file identities, licenses and complete wrapper resource paths',()=>{
 assert.equal(manifest.items.length,16);assert.equal(new Set(manifest.items.map(i=>i.id)).size,16);
 const uids=new Set();
 for(const item of manifest.items){
  const files=new Set(item.files.map(file=>file.path));assert.ok(files.has(item.entryScene)&&files.has(item.sourceFile));
  assert.ok(files.has('licenses/CRAFTMINE_WRAPPERS_MIT.txt')&&files.has(manifest.sources[item.source].licenseFile));
  for(const file of item.files){const bytes=fs.readFileSync(path.join(root,file.path));assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.bytes);if(file.path.endsWith('.tscn'))for(const match of bytes.toString().matchAll(/res:\/\/addons\/([^/]+)\/([^"\n]+)/g)){assert.equal(match[1],item.id);assert.ok(files.has(match[2]),match[2]);}}
  assert.equal(hash(fs.readFileSync(path.join(root,item.sourceFile))),item.sourceSha256);
  assert.ok(files.has(item.importConfiguration.path));const settings=fs.readFileSync(path.join(root,item.importConfiguration.path),'utf8');assert.match(settings,/meshes\/generate_lods=false/);assert.ok(!/\.godot|[A-Z]:|source_file|dest_files|uid=/.test(settings));
  for(const script of item.files.filter(file=>file.path.endsWith('.gd'))){assert.ok(files.has(script.path+'.uid'));const uid=fs.readFileSync(path.join(root,script.path+'.uid'),'utf8').trim();assert.match(uid,/^uid:\/\/[a-z0-9]+$/);assert.ok(!uids.has(uid));uids.add(uid);}
  for(const dependency of item.dependencies.external){const relative=path.posix.join(path.posix.dirname(item.sourceFile),dependency);assert.ok(files.has(relative));}
  assert.ok(item.placement.dimensionsMm.every(Number.isInteger)&&item.placement.visualOffsetMm.every(Number.isInteger));
  assert.equal(item.geometry.animations,0);assert.equal(item.geometry.skins,0);
 }
});
test('recorded pinned-engine import matches this inventory and preserves the doorway opening',()=>{
 const validation=JSON.parse(fs.readFileSync(path.join(root,'engine-validation.json')));
 assert.equal(validation.sourceManifestSha256,hash(fs.readFileSync(path.join(root,'manifest.json'))));assert.equal(validation.passed,true);assert.equal(validation.scenes.length,26);assert.ok(Object.values(validation.doorway).every(Boolean));
 for(const scene of validation.scenes){const item=manifest.items.find(item=>item.id===scene.id);assert.equal(scene.triangles,item.geometry.triangles);assert.ok(scene.meshInstances>0);assert.equal(scene.surfacesWithLods,0);if(item.source==='castle')assert.ok(scene.texturedSurfaces>0);}
});
