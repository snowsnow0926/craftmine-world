import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'../..');
test('native static ArrayMesh triangles, surface materials and refusal boundaries',async()=>{
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/arraymesh-pick-')),project=path.join(out,'project');fs.mkdirSync(project);
 for(const [from,to] of [['desktop/godot/shared/scene_mesh_picker.gd','scene_mesh_picker.gd'],['tests/mesh-pick/arraymesh.gd','probe.gd']])fs.copyFileSync(path.join(root,from),path.join(project,to));
 fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Static array mesh observation fixture"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
 const assets=process.env.CRAFTMINE_CURATED_COMPONENT_ROOT,assetProofs=[];
 if(assets){assert.ok(path.isAbsolute(assets));for(const file of ['nature/tree_oak.glb','nature/rock_smallA.glb','castle/wall-doorway.glb','castle/Textures/colormap.png']){const bytes=fs.readFileSync(path.join(assets,'models',file));const target=path.join(project,'models',file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);assetProofs.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});}}
 const env=await createGodotProbeEnvironment(out);if(assets)await env.run('import',['--editor','--path',project,'--import']);
 const stdout=await env.run('probe',['--path',project,'--script','res://probe.gd','--quit-after','180']);const line=stdout.split(/\r?\n/).find(line=>line.startsWith('ARRAYMESH_PICK_RESULT='));assert.ok(line);const report=JSON.parse(line.slice('ARRAYMESH_PICK_RESULT='.length));assert.deepEqual(report.failures,[]);assert.ok(report.checks>=20);if(assets)assert.equal(report.imported.length,3);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({...report,assetProofs,engine:env.actualVersion,runs:env.runs},null,2));console.log('arraymesh_picker_evidence='+out);
});
