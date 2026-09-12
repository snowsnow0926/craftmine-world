// 真实 Godot 遭遇战验收；仅使用 probe 的有限操作，不发送 OS 输入。
import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {createGodotProbeEnvironment,godotLock} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=path.join(root,'desktop/godot/bases/first-person'),out=fs.mkdtempSync(path.join(root,'test-results/monster-encounter-')),project=path.join(out,'project');
fs.cpSync(base,project,{recursive:true,filter:s=>path.basename(s)!=='.godot'});
let scene=fs.readFileSync(path.join(project,'scenes/training_range.tscn'),'utf8');
scene=scene.replace('[ext_resource type="PackedScene" path="res://scenes/actors/target_dummy.tscn" id="11_target"]','[ext_resource type="PackedScene" path="res://scenes/actors/target_dummy.tscn" id="11_target"]\n[ext_resource type="PackedScene" path="res://scenes/actors/monster_encounter.tscn" id="20_monster"]');
scene=scene.replace('[node name="Props" type="Node3D" parent="."]','[node name="Monster" parent="Targets" instance=ExtResource("20_monster")]\ntransform = Transform3D(1,0,0,0,1,0,0,0,1,0,0,-6)\n\n[node name="Props" type="Node3D" parent="."]');
fs.writeFileSync(path.join(project,'scenes/training_range.tscn'),scene);
const commands=[{op:'look',args:{yaw:0,pitch:0}},{op:'attack'},{op:'wait',args:{frames:30}},{op:'attack'},{op:'wait',args:{frames:30}},{op:'attack'},{op:'wait',args:{frames:30}},{op:'attack'},{op:'wait',args:{frames:30}},{op:'attack'},{op:'wait',args:{frames:2}},{op:'walk',args:{forward:1,frames:120}},{op:'interact'},{op:'save'}];fs.writeFileSync(path.join(project,'encounter.json'),JSON.stringify(commands));
const env=await createGodotProbeEnvironment(out);await env.run('import',['--path',project,'--editor','--import']);const stdout=await env.run('encounter',['--path',project,'scenes/training_range.tscn','--','--base-script=res://encounter.json','--base-world-id=encounter-world']);const line=stdout.split(/\r?\n/).find(x=>x.startsWith('CRAFTMINE_FP_BASE='));assert.ok(line);const report=JSON.parse(line.slice(18));const attacks=report.results.filter(x=>x.op==='attack').map(x=>x.result);assert.ok(attacks.some(x=>x.hits?.some(h=>h.damage>0)),'真实射线必须命中怪物');assert.ok(attacks.at(-1).hits.some(h=>h.damage>0));console.log(report.results.filter(x=>x.op==='attack').map(x=>x.result.snapshot.targets.find(t=>t.id==='monster-one'))); const interaction=report.results.find(x=>x.op==='interact')?.result;assert.equal(interaction?.handled,true);assert.deepEqual(interaction.items,['coin','fang']);const saved=report.results.find(x=>x.op==='save')?.result;assert.equal(saved.written,true);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({format:'craftmine.monster-encounter-headless/1',engine:godotLock.version,checks:['ray-attack','loot-interact','save'],raw:report},null,2));console.log('MONSTER_ENCOUNTER_HEADLESS='+JSON.stringify({out,passed:true,engine:godotLock.version}));







