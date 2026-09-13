import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'../..');
test('actual native oversized static meshes use ray-local uncertainty without reading their arrays',async()=>{
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/oversized-static-')),project=path.join(out,'project');fs.mkdirSync(path.join(project,'craftmine_shared'),{recursive:true});
 for(const name of ['scene_mesh_picker.gd','scene_mesh_picker_v2.gd'])fs.copyFileSync(path.join(root,'desktop/godot/shared',name),path.join(project,'craftmine_shared',name));
 fs.copyFileSync(path.join(root,'tests/mesh-pick/oversized-static.gd'),path.join(project,'probe.gd'));
 fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Bounded mesh uncertainty"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
 const probe=await createGodotProbeEnvironment(out);const log=await probe.run('oversized-static',['--path',project,'--script','res://probe.gd','--quit-after','120'],{timeout:15000});
 const line=log.split(/\r?\n/).find(line=>line.startsWith('OVERSIZED_STATIC_RESULT='));assert(line,log);const result=JSON.parse(line.slice('OVERSIZED_STATIC_RESULT='.length));assert.deepEqual(result.failures,[]);assert.equal(result.checks,7);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({engine:probe.actualVersion,...result,runs:probe.runs},null,2));console.log('oversized_static_evidence='+out);
});
