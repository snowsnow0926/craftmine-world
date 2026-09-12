// 真实 Godot 遭遇战验收；仅使用 probe 的有限操作，不发送 OS 输入。
import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {createGodotProbeEnvironment,godotLock} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=path.join(root,'desktop/godot/bases/first-person'),out=fs.mkdtempSync(path.join(root,'test-results/monster-encounter-')),project=path.join(out,'project');
fs.cpSync(base,project,{recursive:true,filter:s=>path.basename(s)!=='.godot'});
let scene=fs.readFileSync(path.join(project,'scenes/training_range.tscn'),'utf8');
scene=scene.replace('[ext_resource type="PackedScene" path="res://scenes/actors/target_dummy.tscn" id="11_target"]','[ext_resource type="PackedScene" path="res://scenes/actors/target_dummy.tscn" id="11_target"]\n[ext_resource type="PackedScene" path="res://scenes/actors/monster_encounter.tscn" id="20_monster"]');
scene=scene.replace('[node name="Props" type="Node3D" parent="."]','[node name="Monster" parent="Targets" instance=ExtResource("20_monster")]\ntransform = Transform3D(1,0,0,0,1,0,0,0,1,0,0,-6)\n\n[node name="Props" type="Node3D" parent="."]');
scene=scene.replace('[node name="Inventory" type="Node" parent="."]','[node name="Inventory" type="Node" parent="."]\ncapacity = 2');
fs.writeFileSync(path.join(project,'scenes/training_range.tscn'),scene);
const commands=[{op:'look',args:{yaw:0,pitch:0}},{op:'attack'},{op:'wait',args:{frames:30}},{op:'attack'},{op:'wait',args:{frames:30}},{op:'attack'},{op:'wait',args:{frames:30}},{op:'attack'},{op:'wait',args:{frames:30}},{op:'attack'},{op:'wait',args:{frames:2}},{op:'walk',args:{forward:1,frames:120}},{op:'interact'},{op:'save'}];fs.writeFileSync(path.join(project,'encounter.json'),JSON.stringify(commands));
const env=await createGodotProbeEnvironment(out);await env.run('import',['--path',project,'--editor','--import']);const run=async(name,ops)=>{fs.writeFileSync(path.join(project,name+'.json'),JSON.stringify(ops));const text=await env.run(name,['--path',project,'scenes/training_range.tscn','--','--base-script=res://'+name+'.json','--base-world-id=encounter-world']);const line=text.split(/\r?\n/).find(x=>x.startsWith('CRAFTMINE_FP_BASE='));assert.ok(line);return JSON.parse(line.slice(18));};
commands.splice(commands.findIndex(x=>x.op==='interact'),1,{op:'interact'},{op:'interact'},{op:'inventory-remove',args:{id:'repair_kit'}},{op:'interact'});const report=await run('encounter',commands);const attacks=report.results.filter(x=>x.op==='attack').map(x=>x.result);assert.ok(attacks.some(x=>x.hits?.some(h=>h.damage>0)),'真实射线必须命中怪物');assert.ok(attacks.at(-1).hits.some(h=>h.damage>0));const interactions=report.results.filter(x=>x.op==='interact').map(x=>x.result);assert.equal(interactions[0]?.handled,true);assert.equal(interactions[1]?.handled,false,'重复领取不应改变状态');assert.equal(interactions[2]?.handled,false);const saved=report.results.find(x=>x.op==='save')?.result; assert.equal(saved?.written,true);
const invalid=structuredClone(saved.snapshot); invalid.targets.find(x=>x.id==='monster-one').lootTaken='bad'; const invalidRun=await run('invalid',[{op:'restore-state',args:{state:invalid}} ,{op:'snapshot'}]); assert.ok(invalidRun.results[0].error,'无效扩展字段必须拒绝'); assert.equal(invalidRun.results[1].result.targets.find(x=>x.id==='monster-one').health,60,'拒绝恢复不得半写');
const reopened=await run('reopened',[{op:'restore'},{op:'snapshot'},{op:'interact'},{op:'respawn-target',args:{id:'monster-one'}},{op:'attack'}]);const restored=reopened.results.find(x=>x.op==='restore')?.result;assert.equal(restored.targets.find(x=>x.id==='monster-one').lootTaken,true,'冷重开保留掉落领取状态');assert.equal(reopened.results.find(x=>x.op==='interact')?.result?.handled,false,'冷重开后不能重复领取');assert.equal(reopened.results.find(x=>x.op==='respawn-target')?.result?.respawned,true);assert.ok(reopened.results.find(x=>x.op==='attack')?.result?.hits?.some(x=>x.damage>0),'复活后可再次被真实射线命中');
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({format:'craftmine.monster-encounter-headless/1',engine:godotLock.version,checks:['ray-attack','loot-interact','save','cold-reopen','no-duplicate-loot','respawn-attack'],raw:{first:report,reopened}},null,2));console.log('MONSTER_ENCOUNTER_HEADLESS='+JSON.stringify({out,passed:true,engine:godotLock.version}));















