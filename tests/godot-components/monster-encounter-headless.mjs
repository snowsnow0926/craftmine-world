// 真实武器、掉落和冷重开；独立 SceneTree 夹具覆盖容量和视线边界。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGodotProbeEnvironment, godotLock } from '../../desktop/godot/toolchain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = fs.mkdtempSync(path.join(root, 'test-results/monster-encounter-'));
const project = path.join(out, 'project');
const report = { format: 'craftmine.monster-encounter-headless/2', engine: godotLock.version, passed: false, runs: {} };
const result = (run, op) => run.results.find(entry => entry.op === op)?.result;
try {
  fs.cpSync(path.join(root, 'desktop/godot/bases/first-person'), project, { recursive: true, filter: source => path.basename(source) !== '.godot' });
  fs.copyFileSync(path.join(root, 'tests/godot-components/monster-encounter-contract.gd'), path.join(project, 'encounter-contract.gd'));
  const scenePath = path.join(project, 'scenes/training_range.tscn');
  let scene = fs.readFileSync(scenePath, 'utf8');
  scene = scene.replace('[ext_resource type="PackedScene" path="res://scenes/actors/target_dummy.tscn" id="11_target"]', '$&\n[ext_resource type="PackedScene" path="res://scenes/actors/monster_encounter.tscn" id="20_monster"]');
  scene = scene.replace('[node name="Props" type="Node3D" parent="."]', '[node name="Monster" parent="Targets" instance=ExtResource("20_monster")]\nposition = Vector3(0, 0, -6)\n\n$&');
  // Keep the original training scene for the independent contract fixture.
  fs.writeFileSync(path.join(project, 'scenes/encounter.tscn'), scene);
  const env = await createGodotProbeEnvironment(out);
  await env.run('import', ['--path', project, '--editor', '--import']);
  async function run(name, commands) {
    fs.writeFileSync(path.join(project, name + '.json'), JSON.stringify(commands));
    const stdout = await env.run(name, ['--path', project, 'scenes/encounter.tscn', '--', '--base-script=res://' + name + '.json', '--base-world-id=encounter-world']);
    const line = stdout.split(/\r?\n/).find(line => line.startsWith('CRAFTMINE_FP_BASE='));
    assert.ok(line, 'missing headless result');
    const raw = JSON.parse(line.slice('CRAFTMINE_FP_BASE='.length));
    report.runs[name] = raw;
    assert.ok(raw.results.every(entry => !entry.error), 'unexpected operation failure');
    return raw;
  }
  const commands = [{ op: 'look', args: { yaw: 0, pitch: 0 } }];
  for (let shot = 0; shot < 5; shot++) commands.push({ op: 'attack' }, { op: 'wait', args: { frames: 30 } });
  commands.push({ op: 'walk', args: { forward: 1, frames: 120 } }, { op: 'interact' }, { op: 'save' });
  const first = await run('first', commands);
  assert.ok(first.results.filter(entry => entry.op === 'attack').every(entry => entry.result.hits.some(hit => hit.damage > 0)));
  assert.equal(result(first, 'interact').handled, true);
  assert.deepEqual(result(first, 'interact').items, ['coin', 'fang']);
  assert.equal(result(first, 'save').written, true);
  const reopened = await run('reopened', [{ op: 'restore' }, { op: 'interact' }, { op: 'state' }]);
  const target = result(reopened, 'restore').targets.find(target => target.id === 'monster-one');
  assert.equal(target.health, 0);
  assert.equal(target.lootTaken, true);
  assert.equal(result(reopened, 'interact').handled, false);
  assert.deepEqual(result(reopened, 'state').inventory, result(first, 'save').snapshot.inventory);
  const stdout = await env.run('contract', ['--path', project, '--script', 'res://encounter-contract.gd']);
  assert.ok(stdout.includes('MONSTER_ENCOUNTER_CONTRACT=PASS'), 'missing contract success');
  report.checks = ['real-weapon-hits', 'loot', 'cold-reopen', 'no-duplicate-loot', 'capacity-atomicity', 'wall-occlusion', 'nonzero-cooldown-restore', 'invalid-state-atomicity', 'respawn-real-attack'];
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('MONSTER_ENCOUNTER_HEADLESS=' + JSON.stringify({ out, passed: report.passed }));
}
