import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { materializeBase } from '../../desktop/godot/shared/materialize.mjs';
import { createGodotProbeEnvironment } from '../../desktop/godot/toolchain.mjs';

const root = process.cwd(), out = fs.mkdtempSync(path.resolve('test-results/combat-vitals-')), project = path.join(out, 'project');
const report = { format: 'craftmine.combat-vitals-test/1', modelCalls: 0, passed: false, phases: [] };
try {
  materializeBase({ baseId: 'creation-sandbox', worldId: 'vitals-world', out: project });
  fs.cpSync(path.join(root, 'desktop/godot/components/combat-vitals'), path.join(project, 'components/combat-vitals'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests/godot-components/combat-vitals.gd'), path.join(project, 'driver.gd'));
  fs.writeFileSync(path.join(project, 'vitals-world.tscn'), '[gd_scene load_steps=3 format=3]\n[ext_resource type="PackedScene" path="res://scenes/creation.tscn" id="base"]\n[ext_resource type="Script" path="res://components/combat-vitals/scripts/combat_vitals.gd" id="vitals"]\n[node name="CreationWorld" instance=ExtResource("base")]\n[node name="Vitals" type="Node3D" parent="."]\nscript = ExtResource("vitals")\nentity_id = "player-vitals"\n');
  const env = await createGodotProbeEnvironment(out);
  await env.run('import', ['--path', project, '--editor', '--import']);
  let stateFile;
  for (const phase of ['damaged', 'dead', 'revived']) {
    const saveFile = path.join(out, phase + '-state.json');
    fs.writeFileSync(path.join(project, 'test-config.json'), JSON.stringify({ phase, saveFile, ...(stateFile ? { stateFile } : {}) }));
    const stdout = await env.run(phase, ['--path', project, '--script', 'res://driver.gd']);
    const line = stdout.split(/\r?\n/).find(line => line.startsWith('COMBAT_VITALS='));
    assert.ok(line, 'missing component test report');
    const result = JSON.parse(line.slice('COMBAT_VITALS='.length));
    report.phases.push(result);
    assert.deepEqual(Object.keys(result.snapshot.body.player).sort(), ['onFloor', 'pitch', 'position', 'yaw']);
    assert.equal(result.snapshot.body.components['player-vitals'].health, { damaged: 65, dead: 0, revived: 100 }[phase]);
    stateFile = saveFile;
  }
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, passed: report.passed, error: report.error }));
}
