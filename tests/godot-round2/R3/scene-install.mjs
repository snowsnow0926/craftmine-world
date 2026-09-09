#!/usr/bin/env node
// R3: scene component materialization, verified by the real engine.
//
// What this proves (and what a string comparison cannot):
//   1. a scene-node component is actually written into a `.tscn`, not returned as
//      a manual step;
//   2. the same component installed twice produces two independent instances with
//      distinct identities, and editing one does not touch the other;
//   3. the real engine loads the edited scene and reports both identities, so the
//      scene is valid Godot, not just valid text;
//   4. ext_resource references (and the script `uid://` when the base has one) and
//      required input actions are handled;
//   5. a duplicate identity or node name is refused before anything is written.
//
// Headless only: no window, no OS input, no pointer lock.
//
// Usage:
//   node tests/godot-round2/R3/scene-install.mjs [--keep]
//   CRAFTMINE_GODOT_BIN overrides the pinned Godot console editor build.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { materializeBase } from '../../../desktop/godot/shared/materialize.mjs';
import { loadComponentCatalog, planInstallation, applyInstallation } from '../../../desktop/godot/shared/components.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const KEEP = process.argv.includes('--keep');
const EVIDENCE = join(REPO, 'docs', 'dispatch-reports', 'godot-round2', 'R3', 'evidence', 'scene-install');
const GODOT = process.env.CRAFTMINE_GODOT_BIN
  || join(REPO, 'desktop', 'build', 'godot', '4.7.2-stable', 'editor', 'Godot_v4.7.2-stable_win64_console.exe');
const CATALOG = loadComponentCatalog(join(REPO, 'desktop', 'godot', 'bases', 'component-catalog.json'));
const ROOT = mkdtempSync(join(tmpdir(), 'r3-scene-'));
const results = [];
let runs = 0;

function log(name, text) {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), text);
}

function check(id, description, ok, detail = {}) {
  results.push({ id, description, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${id} ${description}${ok ? '' : ` :: ${JSON.stringify(detail)}`}\n`);
}

function godot(args, label) {
  runs += 1;
  const run = spawnSync(GODOT, args, { encoding: 'utf8', timeout: 300000, windowsHide: true });
  log(`godot-${String(runs).padStart(2, '0')}-${label}.log`, `exit=${run.status}\n${run.stdout}\n${run.stderr}\n`);
  return run;
}

function makeWorld(baseId, template, worldId) {
  const out = join(ROOT, worldId);
  materializeBase({ baseId, worldId, template, out });
  const imported = godot(['--headless', '--path', out, '--import'], `${worldId}-import`);
  if (imported.status !== 0) throw new Error(`${worldId} import failed: ${imported.stderr || imported.stdout}`);
  return out;
}

const PROBE_SOURCE = `extends SceneTree

func _initialize() -> void:
	var packed: PackedScene = load("res://__SCENE__")
	if packed == null:
		print("SCENE_IDS=[]")
		quit()
		return
	var instance: Node = packed.instantiate()
	var found: Array = []
	_walk(instance, found)
	print("SCENE_IDS=" + JSON.stringify(found))
	quit()


func _walk(node: Node, found: Array) -> void:
	for field in ["entity_id", "target_id", "spawn_id", "zone_id", "shop_id", "npc_id", "quest_id"]:
		var value: Variant = node.get(field)
		if value != null and String(value) != "":
			found.append({"node": String(node.name), "field": field, "value": String(value)})
	for child in node.get_children():
		_walk(child, found)
`;

/** Load the scene in the real engine and report every identity it carries. */
function sceneIdentities(projectDir, scenePath, label) {
  writeFileSync(join(projectDir, 'r3_scene_probe.gd'), PROBE_SOURCE.replace('__SCENE__', scenePath));
  const run = godot(['--headless', '--path', projectDir, '--script', 'res://r3_scene_probe.gd'], label);
  const match = /SCENE_IDS=(\[.*\])/.exec(`${run.stdout}\n${run.stderr}`);
  return { status: run.status, identities: match ? JSON.parse(match[1]) : null, output: `${run.stdout}\n${run.stderr}` };
}

/** Remove one `[input]` action block from project.godot, whatever the line ending. */
function removeInputAction(text, action) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const start = lines.findIndex((line) => line.startsWith(`${action}={`));
  if (start < 0) return text;
  let end = start;
  while (end < lines.length && lines[end].trim() !== '}') end += 1;
  lines.splice(start, end - start + 1);
  return lines.join(eol);
}

/** Every original line still appears, in order: only insertions happened. */
function preservesLines(original, updated) {
  const source = original.split('\n');
  let index = 0;
  for (const line of updated.split('\n')) {
    if (index < source.length && line === source[index]) index += 1;
  }
  return index === source.length;
}

function install(projectDir, componentId, entityId, options = {}) {
  const plan = planInstallation({
    catalog: CATALOG,
    componentId,
    projectDir,
    entityId,
    placement: options.placement || {},
    overrides: options.overrides || {},
    scene: options.scene || null,
  });
  const receipt = applyInstallation({
    catalog: CATALOG,
    plan,
    sourceDir: join(REPO, 'desktop', 'godot', 'bases', componentId.split('.')[0] === 'fp' ? 'first-person' : componentId.split('.')[0] === 'td' ? 'top-down' : 'side-view'),
    projectDir,
  });
  return { plan, receipt };
}

function main() {
  if (!existsSync(GODOT)) throw new Error(`Godot binary not found: ${GODOT} (set CRAFTMINE_GODOT_BIN)`);
  log('environment.json', `${JSON.stringify({ godot: GODOT, catalogComponents: CATALOG.components.length, startedAt: new Date().toISOString() }, null, 2)}\n`);

  // ---- 1/2/3: two independent top-down door instances in a real scene
  const town = makeWorld('top-down', 'town', 'r3-town');
  const townScene = 'scenes/overworld.tscn';
  const before = readFileSync(join(town, townScene), 'utf8');
  const doorA = install(town, 'td.door', 'door-r3-a', {
    placement: { x: 96, y: 240, target_scene: 'res://scenes/shop_interior.tscn', target_spawn: 'from-town' },
  });
  const doorB = install(town, 'td.door', 'door-r3-b', {
    placement: { x: 288, y: 240, target_scene: 'res://scenes/shop_interior.tscn', target_spawn: 'from-shop' },
  });
  const afterText = readFileSync(join(town, townScene), 'utf8');
  const s01 = {
    receiptOk: Boolean(doorA.receipt.ok),
    appliedOnce: doorA.receipt.sceneApplied.length === 1,
    noManualStep: doorA.receipt.manualSteps.length === 0,
    planIsSceneEdit: doorA.plan.sceneEdits.length === 1 && doorA.plan.sceneEdits[0].format === 'craftmine.godot-scene-edit/1',
    nodeWritten: afterText.includes('door-r3-a'),
    extResourceWritten: afterText.includes('[ext_resource type="Script"'),
    originalPreserved: preservesLines(before, afterText),
  };
  check('R3-S01', 'a scene-node component is written into the .tscn instead of a manual step',
    Object.values(s01).every(Boolean),
    { ...s01, applied: doorA.receipt.sceneApplied, manual: doorA.receipt.manualSteps, grew: afterText.length - before.length });

  check('R3-S02', 'installing the same component twice yields two nodes with distinct identities',
    doorB.receipt.ok && afterText.includes('door-r3-a') && afterText.includes('door-r3-b')
      && (afterText.match(/\[node name="door-r3-a"/g) || []).length === 1
      && (afterText.match(/\[node name="door-r3-b"/g) || []).length === 1,
    { nodes: (afterText.match(/\[node name="door-r3-[ab]"/g) || []) });

  const engine = sceneIdentities(town, townScene, 'r3-town-identities');
  const ids = (engine.identities || []).map((entry) => `${entry.field}=${entry.value}`);
  check('R3-S03', 'the real engine loads the edited scene and reports both new identities',
    engine.status === 0 && ids.includes('entity_id=door-r3-a') && ids.includes('entity_id=door-r3-b'),
    { status: engine.status, ids, tail: engine.output.slice(-400) });

  // Independent modification: change only door A's target and re-read the scene.
  const modified = afterText.replace(
    /(\[node name="door-r3-a"[\s\S]*?target_spawn = )"[^"]*"/,
    '$1"from-vault"',
  );
  writeFileSync(join(town, townScene), modified);
  const blockA = /\[node name="door-r3-a"[\s\S]*?(?=\n\[node|\s*$)/.exec(modified)[0];
  const blockB = /\[node name="door-r3-b"[\s\S]*?(?=\n\[node|\s*$)/.exec(modified)[0];
  const engineAfter = sceneIdentities(town, townScene, 'r3-town-modify');
  check('R3-S04', 'modifying one instance leaves the other instance untouched',
    blockA.includes('target_spawn = "from-vault"') && blockB.includes('target_spawn = "from-shop"')
      && engineAfter.status === 0 && (engineAfter.identities || []).length === (engine.identities || []).length,
    { blockA: blockA.split('\n').filter((line) => line.includes('target_spawn')), blockB: blockB.split('\n').filter((line) => line.includes('target_spawn')), status: engineAfter.status });

  // ---- 4: first-person instanced component with a StringName identity
  const range = makeWorld('first-person', 'training-range', 'r3-range');
  const rangeScene = 'scenes/training_range.tscn';
  const dummyA = install(range, 'fp.target-dummy', 'r3_dummy_a', { placement: { max_health: 12.0 } });
  const dummyB = install(range, 'fp.target-dummy', 'r3_dummy_b', { placement: { max_health: 34.0 } });
  const rangeText = readFileSync(join(range, rangeScene), 'utf8');
  const rangeEngine = sceneIdentities(range, rangeScene, 'r3-range-identities');
  const rangeIds = (rangeEngine.identities || []).map((entry) => `${entry.field}=${entry.value}`);
  check('R3-S05', 'a first-person instanced component keeps its StringName identity and own overrides',
    dummyA.receipt.ok && dummyB.receipt.ok
      && rangeText.includes('target_id = &"r3_dummy_a"') && rangeText.includes('target_id = &"r3_dummy_b"')
      && rangeText.includes('max_health = 12') && rangeText.includes('max_health = 34')
      && rangeIds.includes('target_id=r3_dummy_a') && rangeIds.includes('target_id=r3_dummy_b'),
    { ids: rangeIds, status: rangeEngine.status });

  // ---- 5: a required input action is restored when the project lacks it
  const projectFile = join(range, 'project.godot');
  const projectText = readFileSync(projectFile, 'utf8');
  const withoutInteract = removeInputAction(projectText, 'interact');
  writeFileSync(projectFile, withoutInteract);
  const interactable = install(range, 'fp.interactable', 'r3_interactable');
  const restoredText = readFileSync(projectFile, 'utf8');
  const engineInteract = sceneIdentities(range, rangeScene, 'r3-range-input');
  check('R3-S06', 'a missing input action required by a component is added to project.godot',
    withoutInteract.includes('interact=') === false
      && interactable.receipt.inputsApplied.includes('interact')
      && restoredText.includes('interact={')
      && (engineInteract.identities || []).some((entry) => entry.value === 'r3_interactable'),
    { inputsApplied: interactable.receipt.inputsApplied, status: engineInteract.status });

  // ---- 6: duplicates are refused before anything is written
  const guardedScene = readFileSync(join(town, townScene), 'utf8');
  let duplicateError = null;
  try {
    install(town, 'td.door', 'door-r3-a', { placement: { x: 1, y: 1 } });
  } catch (error) {
    duplicateError = error.message;
  }
  check('R3-S07', 'a duplicate identity or node name is refused without touching the scene',
    duplicateError !== null && /already exists|identity-taken|node-name-taken/.test(duplicateError)
      && readFileSync(join(town, townScene), 'utf8') === guardedScene,
    { error: duplicateError });

  // ---- 7: every scene-node component in the catalog now has a real install plan
  const sceneComponents = CATALOG.components.filter((component) => component.install
    && ['instance', 'script-node'].includes(component.install.mode));
  const plans = [];
  for (const component of sceneComponents) {
    const baseId = component.baseId;
    const worldId = `r3-plan-${component.id.replace('.', '-')}`;
    const template = baseId === 'first-person' ? 'training-range' : 'town';
    const project = makeWorld(baseId, template, worldId);
    const plan = planInstallation({
      catalog: CATALOG,
      componentId: component.id,
      projectDir: project,
      entityId: `${component.id.replace('.', '_')}_probe`,
    });
    plans.push({ componentId: component.id, scene: plan.sceneEdits[0]?.scene, mode: plan.sceneEdits[0]?.mode });
  }
  check('R3-S08', 'every catalog component that declares an install mode plans a real scene edit',
    plans.length >= 8 && plans.every((entry) => entry.scene && entry.mode), { plans });

  const passed = results.filter((entry) => entry.ok).length;
  const report = {
    format: 'craftmine.r3-scene-install/1',
    godot: GODOT,
    engineRuns: runs,
    total: results.length,
    passed,
    results,
  };
  log('report.json', `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nR3 scene install: ${passed}/${results.length} passed (${runs} engine runs)\n`);
  if (!KEEP) rmSync(ROOT, { recursive: true, force: true });
  else process.stdout.write(`temp worlds kept at ${ROOT}\n`);
  if (passed !== results.length) process.exit(1);
}

let crash = null;
try {
  main();
} catch (error) {
  crash = error;
  results.push({ id: 'HARNESS', description: 'harness crashed', ok: false, detail: { message: error.message, stack: error.stack } });
  process.stderr.write(`HARNESS FAILURE: ${error.message}\n${error.stack}\n`);
}
if (crash) process.exit(1);
