import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/sandbox-weapon-'));
const project=path.join(out,'project');
fs.cpSync(path.join(root,'desktop/godot/bases/creation-sandbox'),project,{recursive:true,filter:p=>path.basename(p)!=='.godot'});
for(const [src,dest] of [
 ['desktop/godot/components/sandbox-weapon/scripts/sandbox_weapon.gd','sandbox_weapon.gd'],
 ['desktop/godot/components/combat-vitals/scripts/combat_vitals.gd','combat_vitals.gd'],
 ['desktop/godot/shared/component_state.gd','component_state.gd'],
 ['tests/godot-components/sandbox-weapon.gd','test.gd'],
 ['tests/godot-components/sandbox-weapon-reopen.gd','reopen.gd'],
]) fs.copyFileSync(path.join(root,src),path.join(project,dest));
const sceneFile=path.join(project,'scenes/creation.tscn');
let scene=fs.readFileSync(sceneFile,'utf8').replace('load_steps=5','load_steps=7');
scene=scene.replace('[sub_resource type="CapsuleShape3D"', '[ext_resource type="Script" path="res://sandbox_weapon.gd" id="test_weapon"]\n[ext_resource type="Script" path="res://combat_vitals.gd" id="test_vitals"]\n[sub_resource type="CapsuleShape3D"');
scene+='\n[node name="Vitals" type="Node3D" parent="."]\nscript = ExtResource("test_vitals")\nentity_id = "vitals-1"\n\n[node name="Weapon" type="Node3D" parent="."]\nscript = ExtResource("test_weapon")\nentity_id = "weapon-1"\n';
fs.writeFileSync(sceneFile,scene);
const env=await createGodotProbeEnvironment(out);
await env.run('import',['--path',project,'--editor','--import']);
const run=await env.run('weapon',['--path',project,'--script','res://test.gd']);
const result=JSON.parse(run.split(/\r?\n/).find(x=>x.startsWith('WEAPON_RESULT=')).slice('WEAPON_RESULT='.length));
assert.deepEqual(result.errors,[]);
const reopened=await env.run('reopen',['--path',project,'--script','res://reopen.gd']);
const cold=JSON.parse(reopened.split(/\r?\n/).find(x=>x.startsWith('WEAPON_REOPEN=')).slice('WEAPON_REOPEN='.length));
assert.equal(cold.restored,true);
assert.deepEqual(cold.state,result.evidence.saved);
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,result,cold,runs:env.runs},null,2));
console.log(JSON.stringify({passed:true,out,checks:result.checks.length+1}));
