import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'../..');
test('actual AnimationPlayer poses retain precise rigid-part and forest selection',async()=>{
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/rigid-animation-')),project=path.join(out,'project');fs.mkdirSync(project);
 fs.copyFileSync(path.join(root,'desktop/godot/shared/scene_mesh_picker.gd'),path.join(project,'scene_mesh_picker.gd'));
 fs.copyFileSync(path.join(root,'tests/mesh-pick/rigid-animation.gd'),path.join(project,'probe.gd'));
 fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Rigid animation native picking probe"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
 const probe=await createGodotProbeEnvironment(out);const log=await probe.run('rigid-animation',['--path',project,'--script','res://probe.gd','--quit-after','120'],{timeout:10000});
 const line=log.split(/\r?\n/).find(line=>line.startsWith('RIGID_ANIMATION_RESULT='));assert.ok(line);const result=JSON.parse(line.slice('RIGID_ANIMATION_RESULT='.length));assert.deepEqual(result.failures,[]);assert.ok(result.checks>=17);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({engine:probe.actualVersion,...result,runs:probe.runs},null,2));console.log('rigid_animation_evidence='+out);
});
