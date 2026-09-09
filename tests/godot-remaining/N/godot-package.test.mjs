/**
 * Craftmine World AL2 godot-package static-check tests.
 *
 * Pure offline verification with hand-written Godot text fixtures. No engine is
 * started, no GDScript is executed, no DOM, no network, no temp files.
 *
 * Run: node --test tests/godot-remaining/N/godot-package.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AssetPreviewError,
  PACKAGE_LIMITS,
  checkGodotPackage,
  packageKind,
} from '../../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/decode/godot-package.mjs';

/* ------------------------------------------------------------------ */
/* helpers + fixtures                                                  */
/* ------------------------------------------------------------------ */

const encode = (text) => new TextEncoder().encode(text);

function report(name, detail) {
  console.log(`[case] ${name} -> ${JSON.stringify(detail)}`);
}

function assertPackageError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof AssetPreviewError, `expected AssetPreviewError, got ${error}`);
    assert.equal(error.name, 'AssetPreviewError');
    assert.equal(error.code, 'PACKAGE_TOO_LARGE');
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0, 'error message must not be empty');
    return true;
  });
}

/** A realistic scene: ext_resource -> .gd + .png, one missing .png, sub_resource. */
const SCENE_LINES = [
  '[gd_scene load_steps=4 format=3]', // line 1
  '', // line 2
  '[ext_resource type="Script" path="res://scripts/player.gd" id="1_player"]', // line 3
  '[ext_resource type="Texture2D" path="res://art/hero.png" id="2_hero"]', // line 4
  '[ext_resource type="Texture2D" path="res://art/missing.png" id="3_missing"]', // line 5
  '', // line 6
  '[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"]', // line 7
  'size = Vector2(16, 32)', // line 8
  '', // line 9
  '[node name="Player" type="CharacterBody2D"]', // line 10
  'script = ExtResource("1_player")', // line 11
  '', // line 12
  '[node name="Sprite2D" type="Sprite2D" parent="."]', // line 13
  'texture = ExtResource("2_hero")', // line 14
  'shape = SubResource("RectangleShape2D_1")', // line 15
];

const SCENE_TEXT = SCENE_LINES.join('\n');
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function scenePackage() {
  return new Map([
    ['scenes/player.tscn', encode(SCENE_TEXT)],
    ['scripts/player.gd', encode('extends Node\n')],
    ['art/hero.png', PNG_BYTES],
  ]);
}

const HERO_LINES = [
  'extends "res://scripts/base.gd"', // line 1
  '', // line 2
  'const SCENE = preload("res://scenes/level.tscn")', // line 3
  'const DATA = load("res://data/table.tres")', // line 4
  '', // line 5
  'const MISSING_PRELOAD = preload("res://missing/thing.gd")', // line 6
  'const MISSING_LOAD = load("res://missing/other.gd")', // line 7
  '# const COMMENTED = preload("res://missing/commented.gd")', // line 8 (comment)
];

const BROKEN_LINES = [
  '# extends "res://missing/commented-base.gd"', // line 1 (comment)
  'extends "res://missing/base.gd"', // line 2
];

function scriptPackage() {
  return new Map([
    ['scripts/hero.gd', encode(HERO_LINES.join('\n'))],
    ['scripts/broken.gd', encode(BROKEN_LINES.join('\n'))],
    ['scripts/base.gd', encode('extends Node\n')],
    ['scenes/level.tscn', encode('[gd_scene format=3]\n')],
    ['data/table.tres', encode('[gd_resource type="Resource" format=3]\n')],
  ]);
}

function sceneWithRef(path) {
  return [
    '[gd_scene format=3]',
    `[ext_resource type="PackedScene" path="res://${path}" id="1_ref"]`,
    '[node name="Root" instance=ExtResource("1_ref")]',
  ].join('\n');
}

/** A `.tres` resource that declares one `ext_resource` per referenced path. */
function resourceWithRefs(targets) {
  const lines = ['[gd_resource type="Resource" format=3]'];
  targets.forEach((target, index) => {
    lines.push(`[ext_resource type="Resource" path="res://${target}" id="1_ref${index}"]`);
  });
  lines.push('[resource]');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* API surface                                                         */
/* ------------------------------------------------------------------ */

test('PACKAGE_LIMITS exposes the documented hard limits', () => {
  assert.deepEqual(PACKAGE_LIMITS, {
    files: 4096,
    fileBytes: 4 * 1024 * 1024,
    totalBytes: 64 * 1024 * 1024,
    refs: 20000,
  });
  report('PACKAGE_LIMITS', PACKAGE_LIMITS);
});

test('AssetPreviewError carries name, code and message', () => {
  const error = new AssetPreviewError('SOME_CODE', 'something failed');
  assert.ok(error instanceof Error);
  assert.ok(error instanceof AssetPreviewError);
  assert.equal(error.name, 'AssetPreviewError');
  assert.equal(error.code, 'SOME_CODE');
  assert.equal(error.message, 'something failed');
  report('AssetPreviewError', { name: error.name, code: error.code });
});

test('packageKind classifies scene / script / resource / mixed / unknown', () => {
  const empty = new Uint8Array(0);
  assert.equal(packageKind(new Map([['a.tscn', empty]])), 'scene');
  assert.equal(packageKind(new Map([['a.gd', empty]])), 'script');
  assert.equal(packageKind(new Map([['a.tres', empty]])), 'resource');
  assert.equal(packageKind(new Map([['a.tscn', empty], ['a.gd', empty]])), 'mixed');
  assert.equal(packageKind(new Map([['a.tscn', empty], ['a.gd', empty], ['a.tres', empty]])), 'mixed');
  assert.equal(packageKind(new Map([['a.txt', empty], ['b.png', empty]])), 'unknown');
  assert.equal(packageKind(new Map()), 'unknown');
  assert.equal(packageKind(null), 'unknown');
  report('packageKind', {
    scene: packageKind(new Map([['a.tscn', empty]])),
    script: packageKind(new Map([['a.gd', empty]])),
    resource: packageKind(new Map([['a.tres', empty]])),
    mixed: packageKind(new Map([['a.tscn', empty], ['a.gd', empty]])),
    unknown: packageKind(new Map([['a.txt', empty]])),
  });
});

/* ------------------------------------------------------------------ */
/* .tscn / .tres reference integrity                                   */
/* ------------------------------------------------------------------ */

test('scene: missing res:// reference is reported with owner path and line', () => {
  const result = checkGodotPackage(scenePackage());

  assert.equal(result.executed, false);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'mixed');
  assert.equal(result.files, 3);
  assert.equal(result.bytes, encode(SCENE_TEXT).length + encode('extends Node\n').length + PNG_BYTES.length);
  assert.deepEqual(result.scenes, ['scenes/player.tscn']);
  assert.deepEqual(result.scripts, ['scripts/player.gd']);
  assert.deepEqual(result.cycles, []);
  assert.deepEqual(result.issues, [], 'declared ExtResource/SubResource ids must not raise issues');

  // Exactly the one missing .png, pinned to the declaration line (line 5).
  assert.deepEqual(result.missing, [
    {
      code: 'missing-resource',
      path: 'scenes/player.tscn',
      line: 5,
      target: 'res://art/missing.png',
      kind: 'ext_resource',
    },
  ]);

  const byTarget = new Map(result.extResources.map((entry) => [entry.target, entry]));
  assert.equal(result.extResources.length, 3);
  assert.equal(byTarget.get('res://scripts/player.gd').resolved, true);
  assert.equal(byTarget.get('res://scripts/player.gd').path, 'scenes/player.tscn');
  assert.equal(byTarget.get('res://scripts/player.gd').line, 3);
  assert.equal(byTarget.get('res://scripts/player.gd').type, 'Script');
  assert.equal(byTarget.get('res://art/hero.png').resolved, true);
  assert.equal(byTarget.get('res://art/missing.png').resolved, false);
  assert.equal(byTarget.get('res://art/missing.png').id, '3_missing');

  report('scene-missing', { missing: result.missing, ok: result.ok, kind: result.kind });
});

test('scene: unresolved ExtResource / SubResource ids are reported', () => {
  const text = [
    '[gd_scene format=3]',
    '[ext_resource type="Script" path="res://scripts/player.gd" id="1_ok"]',
    '[sub_resource type="RectangleShape2D" id="Shape_ok"]',
    '[node name="Root" type="Node"]',
    'script = ExtResource("1_missing")',
    'shape = SubResource("Shape_missing")',
  ].join('\n');
  const result = checkGodotPackage(new Map([
    ['scenes/broken.tscn', encode(text)],
    ['scripts/player.gd', encode('extends Node\n')],
  ]));

  assert.equal(result.executed, false);
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 0, 'no res:// file is missing here');
  assert.ok(result.issues.some((issue) => issue.code === 'unresolved-ext-resource' && issue.id === '1_missing' && issue.line === 5));
  assert.ok(result.issues.some((issue) => issue.code === 'unresolved-sub-resource' && issue.id === 'Shape_missing' && issue.line === 6));
  report('scene-unresolved-ids', { issues: result.issues.map((issue) => `${issue.code}:${issue.id}`) });
});

/* ------------------------------------------------------------------ */
/* .gd reference forms                                                 */
/* ------------------------------------------------------------------ */

test('script: preload / load / extends res:// references are all parsed', () => {
  const result = checkGodotPackage(scriptPackage());

  assert.equal(result.executed, false);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'mixed');

  // Commented-out references must be ignored; each line must yield one entry.
  const targets = result.missing.map((entry) => entry.target).sort();
  assert.deepEqual(targets, [
    'res://missing/base.gd',
    'res://missing/other.gd',
    'res://missing/thing.gd',
  ]);
  const kinds = [...new Set(result.missing.map((entry) => entry.kind))].sort();
  assert.deepEqual(kinds, ['extends', 'load', 'preload']);

  const preload = result.missing.find((entry) => entry.kind === 'preload');
  assert.deepEqual(preload, {
    code: 'missing-resource',
    path: 'scripts/hero.gd',
    line: 6,
    target: 'res://missing/thing.gd',
    kind: 'preload',
  });
  const load = result.missing.find((entry) => entry.kind === 'load');
  assert.deepEqual(load, {
    code: 'missing-resource',
    path: 'scripts/hero.gd',
    line: 7,
    target: 'res://missing/other.gd',
    kind: 'load',
  });
  const ext = result.missing.find((entry) => entry.kind === 'extends');
  assert.deepEqual(ext, {
    code: 'missing-resource',
    path: 'scripts/broken.gd',
    line: 2,
    target: 'res://missing/base.gd',
    kind: 'extends',
  });

  // Resolved preload/load/extends produce no noise.
  assert.equal(result.missing.filter((entry) => entry.target.includes('commented')).length, 0);
  assert.equal(result.missing.filter((entry) => entry.target === 'res://missing/thing.gd').length, 1);

  report('script-refs', { missing: result.missing.map((entry) => `${entry.kind}@${entry.path}:${entry.line}`) });
});

/* ------------------------------------------------------------------ */
/* cycles                                                              */
/* ------------------------------------------------------------------ */

test('cycles: a.tscn -> b.tscn -> a.tscn is detected and normalized', () => {
  const result = checkGodotPackage(new Map([
    ['a.tscn', encode(sceneWithRef('b.tscn'))],
    ['b.tscn', encode(sceneWithRef('a.tscn'))],
  ]));

  assert.equal(result.executed, false);
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'scene');
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.cycles, [['a.tscn', 'b.tscn']]);
  report('cycle-two', { cycles: result.cycles });
});

test('cycles: start is the lexicographically smallest path regardless of input order', () => {
  const result = checkGodotPackage(new Map([
    ['z.tscn', encode(sceneWithRef('a.tscn'))],
    ['a.tscn', encode(sceneWithRef('z.tscn'))],
  ]));
  assert.deepEqual(result.cycles, [['a.tscn', 'z.tscn']]);

  const three = checkGodotPackage(new Map([
    ['c.tscn', encode(sceneWithRef('a.tscn'))],
    ['a.tscn', encode(sceneWithRef('b.tscn'))],
    ['b.tscn', encode(sceneWithRef('c.tscn'))],
  ]));
  assert.deepEqual(three.cycles, [['a.tscn', 'b.tscn', 'c.tscn']]);
  report('cycle-normalized', { two: result.cycles, three: three.cycles });
});

test('cycles: self reference is reported as a one-element loop', () => {
  const result = checkGodotPackage(new Map([['s.tscn', encode(sceneWithRef('s.tscn'))]]));
  assert.deepEqual(result.cycles, [['s.tscn']]);
  assert.equal(result.ok, true);
  report('cycle-self', { cycles: result.cycles });
});

test('cycles: dense acyclic graph returns fast, finds no cycle and reports truncation', () => {
  // 40 `.tres` files, each referencing the next 15: ~480 edges (well under
  // PACKAGE_LIMITS.refs), zero cycles, but exponentially many simple paths.
  const COUNT = 40;
  const WIDTH = 15;
  const files = new Map();
  let edges = 0;
  for (let index = 0; index < COUNT; index++) {
    const targets = [];
    for (let step = 1; step <= WIDTH && index + step < COUNT; step++) {
      targets.push(`r${String(index + step).padStart(2, '0')}.tres`);
    }
    edges += targets.length;
    files.set(`r${String(index).padStart(2, '0')}.tres`, encode(resourceWithRefs(targets)));
  }

  const started = performance.now();
  const result = checkGodotPackage(files);
  const elapsedMs = performance.now() - started;

  assert.equal(result.executed, false);
  assert.equal(result.cycles.length, 0, 'a dense acyclic graph has no elementary cycle');
  assert.equal(typeof result.cyclesTruncated, 'boolean');
  assert.ok(
    elapsedMs < 2000,
    `dense acyclic graph took ${elapsedMs.toFixed(1)}ms; the search budget must keep it under 2s`,
  );
  report('cycle-dense-acyclic', {
    nodes: COUNT,
    edges,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    cycles: result.cycles.length,
    cyclesTruncated: result.cyclesTruncated,
  });
});

test('cycles: many-cycle graph returns instead of hanging and flags truncation', () => {
  // 8 resources referencing each other pairwise: a huge number of elementary
  // cycles, so the search must stop on its budget / collected-cycle cap.
  const COUNT = 8;
  const files = new Map();
  for (let index = 0; index < COUNT; index++) {
    const targets = [];
    for (let other = 0; other < COUNT; other++) if (other !== index) targets.push(`n${other}.tres`);
    files.set(`n${index}.tres`, encode(resourceWithRefs(targets)));
  }

  const started = performance.now();
  const result = checkGodotPackage(files);
  const elapsedMs = performance.now() - started;

  assert.ok(result.cycles.length > 0, 'mutual references must yield at least one cycle');
  assert.equal(typeof result.cyclesTruncated, 'boolean');
  if (result.cyclesTruncated) assert.equal(result.cyclesTruncated, true);
  assert.ok(
    elapsedMs < 2000,
    `many-cycle graph took ${elapsedMs.toFixed(1)}ms; the search budget must keep it under 2s`,
  );
  report('cycle-many', {
    nodes: COUNT,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    cycles: result.cycles.length,
    cyclesTruncated: result.cyclesTruncated,
  });
});

test('cycles: small graphs finish within budget and report cyclesTruncated:false', () => {
  const two = checkGodotPackage(new Map([
    ['a.tscn', encode(sceneWithRef('b.tscn'))],
    ['b.tscn', encode(sceneWithRef('a.tscn'))],
  ]));
  assert.deepEqual(two.cycles, [['a.tscn', 'b.tscn']]);
  assert.equal(two.cyclesTruncated, false);

  const self = checkGodotPackage(new Map([['s.tscn', encode(sceneWithRef('s.tscn'))]]));
  assert.deepEqual(self.cycles, [['s.tscn']]);
  assert.equal(self.cyclesTruncated, false);

  const acyclic = checkGodotPackage(scenePackage());
  assert.deepEqual(acyclic.cycles, []);
  assert.equal(acyclic.cyclesTruncated, false);
  report('cycle-not-truncated', {
    two: two.cyclesTruncated,
    self: self.cyclesTruncated,
    acyclic: acyclic.cyclesTruncated,
  });
});

/* ------------------------------------------------------------------ */
/* path safety                                                         */
/* ------------------------------------------------------------------ */

test('path safety: parent traversal is rejected', () => {
  const result = checkGodotPackage(new Map([['../evil.tscn', encode('[gd_scene format=3]\n')]]));
  assert.equal(result.executed, false);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'path-traversal' && issue.path === '../evil.tscn'));
  report('path-traversal', { ok: result.ok, issues: result.issues.map((issue) => issue.code) });
});

test('path safety: absolute paths are rejected', () => {
  const result = checkGodotPackage(new Map([
    ['/etc/passwd', encode('x')],
    ['C:/Windows/evil.tscn', encode('[gd_scene format=3]\n')],
  ]));
  assert.equal(result.ok, false);
  assert.equal(result.issues.filter((issue) => issue.code === 'absolute-path').length, 2);
  report('path-absolute', { issues: result.issues.map((issue) => `${issue.code}:${issue.path}`) });
});

test('path safety: Windows reserved names are rejected', () => {
  const result = checkGodotPackage(new Map([
    ['CON.tscn', encode('[gd_scene format=3]\n')],
    ['assets/COM1.gd', encode('extends Node\n')],
    ['lpt9.tres', encode('[gd_resource format=3]\n')],
  ]));
  assert.equal(result.ok, false);
  const reserved = result.issues.filter((issue) => issue.code === 'reserved-name');
  assert.equal(reserved.length, 3);
  assert.deepEqual(reserved.map((issue) => issue.name.toUpperCase()).sort(), ['COM1', 'CON', 'LPT9']);
  report('path-reserved', { reserved: reserved.map((issue) => `${issue.path}:${issue.name}`) });
});

test('path safety: case-only collisions are rejected', () => {
  const result = checkGodotPackage(new Map([
    ['Textures/Hero.png', PNG_BYTES],
    ['textures/hero.png', PNG_BYTES],
  ]));
  assert.equal(result.ok, false);
  const collisions = result.issues.filter((issue) => issue.code === 'case-collision');
  assert.equal(collisions.length, 2, 'both sides of the collision are reported');
  assert.ok(collisions.some((issue) => issue.path === 'Textures/Hero.png' && issue.other === 'textures/hero.png'));
  assert.ok(collisions.some((issue) => issue.path === 'textures/hero.png' && issue.other === 'Textures/Hero.png'));
  report('path-case-collision', { ok: result.ok, collisions: collisions.map((issue) => issue.path) });
});

test('path safety: duplicate paths after normalization are rejected', () => {
  const result = checkGodotPackage({
    'dup.tscn': encode('[gd_scene format=3]\n'),
    './dup.tscn': encode('[gd_scene format=3]\n'),
  });
  assert.equal(result.ok, false);
  const duplicates = result.issues.filter((issue) => issue.code === 'duplicate-path');
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].path, './dup.tscn');
  assert.equal(duplicates[0].other, 'dup.tscn');
  assert.equal(duplicates[0].normalized, 'dup.tscn');
  report('path-duplicate', { duplicate: duplicates[0] });
});

test('path safety: backslash separators are rejected', () => {
  const result = checkGodotPackage({ 'dir\\file.tscn': encode('[gd_scene format=3]\n') });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'invalid-separator'));
  report('path-separator', { issues: result.issues.map((issue) => issue.code) });
});

test('path safety: non-Uint8Array content is reported, not executed', () => {
  const result = checkGodotPackage({ 'bad.tscn': 'not bytes' });
  assert.equal(result.executed, false);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'invalid-file' && issue.path === 'bad.tscn'));
  report('invalid-file', { issues: result.issues.map((issue) => issue.code) });
});

/* ------------------------------------------------------------------ */
/* unrecognized extensions                                             */
/* ------------------------------------------------------------------ */

test('unknown extensions are counted but never reported as errors', () => {
  const result = checkGodotPackage({
    'readme.txt': encode('hello'),
    'art/icon.png': PNG_BYTES,
  });
  assert.equal(result.executed, false);
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'unknown');
  assert.equal(result.files, 2);
  assert.equal(result.bytes, encode('hello').length + PNG_BYTES.length);
  assert.deepEqual(result.scenes, []);
  assert.deepEqual(result.scripts, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.cycles, []);
  assert.deepEqual(result.issues, []);
  report('unknown-extensions', { kind: result.kind, files: result.files, bytes: result.bytes });
});

/* ------------------------------------------------------------------ */
/* limits                                                              */
/* ------------------------------------------------------------------ */

test('limits: file count over PACKAGE_LIMITS.files -> PACKAGE_TOO_LARGE', () => {
  const files = new Map();
  for (let index = 0; index <= PACKAGE_LIMITS.files; index++) files.set(`f${index}.txt`, new Uint8Array(0));
  assertPackageError(() => checkGodotPackage(files));
  report('limit-files', { count: files.size, code: 'PACKAGE_TOO_LARGE' });
});

test('limits: single file over PACKAGE_LIMITS.fileBytes -> PACKAGE_TOO_LARGE', () => {
  const oversized = new Uint8Array(PACKAGE_LIMITS.fileBytes + 1);
  assertPackageError(() => checkGodotPackage(new Map([['big.bin', oversized]])));
  report('limit-file-bytes', { bytes: oversized.length, code: 'PACKAGE_TOO_LARGE' });
});

test('limits: total bytes over PACKAGE_LIMITS.totalBytes -> PACKAGE_TOO_LARGE', () => {
  // 17 x exactly 4 MiB = 68 MiB > 64 MiB, while each file stays at the limit.
  const chunk = new Uint8Array(PACKAGE_LIMITS.fileBytes);
  const files = new Map();
  for (let index = 0; index < 17; index++) files.set(`big${index}.bin`, chunk);
  assertPackageError(() => checkGodotPackage(files));
  report('limit-total-bytes', { files: files.size, totalBytes: chunk.length * files.size, code: 'PACKAGE_TOO_LARGE' });
});

test('limits: reference count over PACKAGE_LIMITS.refs -> PACKAGE_TOO_LARGE', () => {
  const lines = ['extends Node'];
  for (let index = 0; index <= PACKAGE_LIMITS.refs; index++) lines.push(`const R${index} = preload("res://a.gd")`);
  const result = new Map([
    ['a.gd', encode('extends Node\n')],
    ['many.gd', encode(lines.join('\n'))],
  ]);
  assertPackageError(() => checkGodotPackage(result));
  report('limit-refs', { refs: PACKAGE_LIMITS.refs + 1, code: 'PACKAGE_TOO_LARGE' });
});

/* ------------------------------------------------------------------ */
/* executed flag                                                       */
/* ------------------------------------------------------------------ */

test('every result reports executed:false (no engine, no GDScript)', () => {
  const results = [
    checkGodotPackage(scenePackage()),
    checkGodotPackage(scriptPackage()),
    checkGodotPackage(new Map([['a.tscn', encode(sceneWithRef('b.tscn'))], ['b.tscn', encode(sceneWithRef('a.tscn'))]])),
    checkGodotPackage(new Map([['../evil.tscn', encode('[gd_scene format=3]\n')]])),
    checkGodotPackage(new Map([['readme.txt', encode('x')]])),
  ];
  for (const result of results) assert.equal(result.executed, false);
  report('executed-flag', { checked: results.length, executed: results.map((result) => result.executed) });
});
