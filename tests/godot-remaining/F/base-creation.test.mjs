// F task: every delivered base must be creatable from its catalog entry with a
// new identity, a clean initial state and a hashed build receipt. These are
// real tool invocations (file copies only, no engine), not mocks.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const BASES = 'desktop/godot/bases';
const CATALOG = JSON.parse(fs.readFileSync(path.join(BASES, 'base-catalog.json'), 'utf8'));

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `craftmine-f-${name}-`));
}

function run(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true });
}

test('the catalog describes a blank and an example template for every base', () => {
  assert.deepEqual(CATALOG.bases.map((entry) => entry.baseId), ['first-person', 'mining-sandbox', 'side-view', 'top-down']);
  for (const base of CATALOG.bases) {
    assert.equal(base.templates.filter((template) => template.kind === 'blank-start').length, 1, base.baseId);
    assert.equal(base.templates.filter((template) => template.kind === 'example').length, 1, base.baseId);
    assert.match(base.worldIdPattern, /\^\[a-z0-9\]/);
    for (const template of base.templates) {
      assert.equal(template.create.tool, 'tools/new-world.mjs');
      assert.ok(template.create.args.includes('<worldId>'));
      assert.ok(template.entryScene.startsWith('res://'));
    }
  }
});

test('first-person refuses a template that ships finished progress and creates both templates', () => {
  const base = path.join(BASES, 'first-person');
  for (const template of ['blank', 'training-range']) {
    const check = run(['tools/new-world.mjs', '--check-template', template], base);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /ships initial progress only/);
  }
  const out = path.join(tempDir('fp-blank'), 'world');
  const created = run(['tools/new-world.mjs', '--template', 'blank', '--world-id', 'f-test-blank', '--out', out], base);
  assert.equal(created.status, 0, created.stderr);
  const world = JSON.parse(fs.readFileSync(path.join(out, 'world.json'), 'utf8'));
  assert.equal(world.format, 'craftmine.godot-first-person-world/1');
  assert.equal(world.worldId, 'f-test-blank');
  assert.equal(world.templateId, 'blank');
  assert.equal(world.entryScene, 'res://scenes/blank_start.tscn');
  const scene = fs.readFileSync(path.join(out, 'scenes', 'blank_start.tscn'), 'utf8');
  for (const group of ['base_targets', 'base_interactables']) assert.ok(!scene.includes(group), group);
  assert.ok(!scene.includes('data/quests/'), 'blank start has no quest');
  assert.ok(scene.includes('balance_profile'), 'blank start has a balance profile');
  const project = fs.readFileSync(path.join(out, 'project.godot'), 'utf8');
  assert.match(project, /run\/main_scene="res:\/\/scenes\/blank_start\.tscn"/);
  const build = JSON.parse(fs.readFileSync(path.join(out, 'world-build.json'), 'utf8'));
  assert.equal(build.format, 'craftmine.godot-world-build/1');
  assert.equal(build.worldId, 'f-test-blank');
  assert.equal(build.godotVersion, '4.7.2-stable');
  assert.ok(build.files.length > 20);
  for (const file of build.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.ok(fs.existsSync(path.join(out, file.path)), file.path);
  }
  const example = path.join(tempDir('fp-range'), 'world');
  const range = run(['tools/new-world.mjs', '--template', 'training-range', '--world-id', 'f-test-range', '--out', example], base);
  assert.equal(range.status, 0, range.stderr);
  const rangeWorld = JSON.parse(fs.readFileSync(path.join(example, 'world.json'), 'utf8'));
  assert.equal(rangeWorld.templateId, 'training-range');
  assert.equal(rangeWorld.entryScene, 'res://scenes/training_range.tscn');
});

test('side-view materializes a new identity while keeping the template directory pointer', () => {
  const base = path.join(BASES, 'side-view');
  const out = path.join(tempDir('sv'), 'world');
  const created = run(['tools/new-world.mjs', '--world', 'blank', '--world-id', 'f-side-blank', '--out', out], base);
  assert.equal(created.status, 0, created.stderr);
  const pointer = JSON.parse(fs.readFileSync(path.join(out, 'worlds', 'default.json'), 'utf8'));
  assert.equal(pointer.worldId, 'blank', 'the world directory pointer still names the template');
  assert.equal(pointer.instanceId, 'f-side-blank');
  const world = JSON.parse(fs.readFileSync(path.join(out, 'worlds', 'blank', 'world.json'), 'utf8'));
  assert.equal(world.worldId, 'f-side-blank');
  assert.equal(world.templateId, 'blank');
  const receipt = JSON.parse(fs.readFileSync(path.join(out, 'MATERIALIZED.json'), 'utf8'));
  assert.equal(receipt.worldId, 'f-side-blank');
  assert.equal(receipt.templateId, 'blank');
  assert.equal(receipt.baseVersion, '1.0.0');
  const targets = (world.rooms || []).flatMap((room) => room.targets || []);
  assert.deepEqual(targets, [], 'the blank start ships no target');
  assert.deepEqual((world.rooms || []).flatMap((room) => room.rewards || []), []);
  assert.deepEqual((world.rooms || []).flatMap((room) => room.checkpoints || []), []);
});

test('top-down creates a world from its template with a hashed receipt', () => {
  const base = path.join(BASES, 'top-down');
  const check = run(['tools/new-world.mjs', '--check-template', 'templates/blank'], base);
  assert.equal(check.status, 0, check.stderr);
  const out = path.join(tempDir('td'), 'world');
  const created = run(['tools/new-world.mjs', '--template', 'blank', '--world-id', 'f-town-blank', '--out', out], base);
  assert.equal(created.status, 0, created.stderr);
  const world = JSON.parse(fs.readFileSync(path.join(out, 'world.json'), 'utf8'));
  assert.equal(world.format, 'craftmine.godot-topdown-world/1');
  assert.equal(world.worldId, 'f-town-blank');
  assert.equal(world.initialProgress.coins, 0);
  assert.deepEqual(world.initialProgress.quests, []);
  const build = JSON.parse(fs.readFileSync(path.join(out, 'world-build.json'), 'utf8'));
  assert.equal(build.format, 'craftmine.godot-world-build/1');
  assert.equal(build.template, 'blank');
  assert.equal(build.worldId, 'f-town-blank');
  assert.ok(build.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
});

test('a world id outside the portable rule is rejected by every creation tool', () => {
  const cases = [
    [path.join(BASES, 'first-person'), ['tools/new-world.mjs', '--template', 'blank', '--world-id', 'Bad_Id', '--out', path.join(tempDir('bad1'), 'w')]],
    [path.join(BASES, 'side-view'), ['tools/new-world.mjs', '--world', 'blank', '--world-id', 'Bad_Id', '--out', path.join(tempDir('bad2'), 'w')]],
    [path.join(BASES, 'top-down'), ['tools/new-world.mjs', '--template', 'blank', '--world-id', 'Bad_Id', '--out', path.join(tempDir('bad3'), 'w')]],
  ];
  for (const [cwd, args] of cases) {
    const result = run(args, cwd);
    assert.notEqual(result.status, 0, `${cwd} accepted Bad_Id`);
    assert.match(`${result.stdout}${result.stderr}`, /world-id|World identity|portable/i);
  }
});
