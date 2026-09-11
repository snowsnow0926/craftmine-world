import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'../..');
test('fixed mesh picker uses actual Godot triangles and fails closed on unsupported coverage',async()=>{
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 const out=fs.mkdtempSync(path.join(root,'test-results/mesh-pick-')),project=path.join(out,'project');fs.mkdirSync(project);
 fs.copyFileSync(path.join(root,'desktop/godot/shared/scene_mesh_picker.gd'),path.join(project,'scene_mesh_picker.gd'));
 fs.copyFileSync(path.join(root,'tests/mesh-pick/probe.gd'),path.join(project,'probe.gd'));
 fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Fixed mesh picking probe"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
 const env=await createGodotProbeEnvironment(out);
 const stdout=await env.run('probe',['--path',project,'--script','res://probe.gd','--quit-after','180']);
 const line=stdout.split(/\r?\n/).find(line=>line.startsWith('MESH_PICK_RESULT='));assert.ok(line);
 const report=JSON.parse(line.slice('MESH_PICK_RESULT='.length));assert.deepEqual(report.failures,[]);assert.ok(report.checks>=20);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({...report,engine:env.actualVersion,runs:env.runs},null,2));
 console.log('mesh_picker_evidence='+out);
});
