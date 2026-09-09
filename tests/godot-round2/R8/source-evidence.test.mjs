// Offline tests for the R8 source-level evidence heuristics.
// These are logic tests: they prove the heuristics cannot be satisfied by a
// comment or by a project that only centres a reticle. They are NOT real-model
// acceptance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceEvidence} from './run-real-requirement.mjs';

const project = {path: 'project.godot', text: '[application]\nconfig/name="R8"\n'};

test('a real authored project satisfies every source-level check', () => {
  const evidence = sourceEvidence([
    project,
    {path: 'scripts/crosshair.gd', text: 'extends Control\nfunc _ready():\n\tset_anchors_preset(Control.PRESET_FULL_RECT)\nfunc _draw():\n\tdraw_circle(size * 0.5, 2, Color.WHITE)\n'},
    {path: 'scripts/player.gd', text: 'const WEAPON_GUN: String = "gun"\nconst WEAPON_SWORD: String = "sword"\nvar camera: Camera3D = null\nfunc _ready():\n\tcamera = Camera3D.new()\n\tcamera.add_child(view_model)\nfunc _switch():\n\tview_model.equip(WEAPON_SWORD)\n'},
  ]);
  assert.equal(evidence.projectGodot, true);
  assert.equal(evidence.hasScripts, true);
  assert.equal(evidence.crosshairCentered, true);
  assert.equal(evidence.weaponUnderCamera, true);
  assert.equal(evidence.equipmentSwitch, true);
});

test('comments alone never satisfy a source-level check', () => {
  const evidence = sourceEvidence([
    project,
    {path: 'scripts/crosshair.gd', text: 'extends Control\n# 视口正中央的准星：size * 0.5，anchor_left = 0.5\n# camera.add_child(view_model)，equip("gun") 和 "sword"\n'},
  ]);
  assert.equal(evidence.crosshairCentered, false);
  assert.equal(evidence.weaponUnderCamera, false);
  assert.equal(evidence.equipmentSwitch, false);
});

test('a centred reticle without a camera-attached weapon is only half true', () => {
  const evidence = sourceEvidence([
    project,
    {path: 'scripts/crosshair.gd', text: 'extends Control\nfunc _draw():\n\tdraw_circle(size * 0.5, 2, Color.WHITE)\n'},
  ]);
  assert.equal(evidence.crosshairCentered, true);
  assert.equal(evidence.weaponUnderCamera, false);
  assert.equal(evidence.equipmentSwitch, false);
});

test('a weapon attached to the camera without centring is only half true', () => {
  const evidence = sourceEvidence([
    project,
    {path: 'scripts/player.gd', text: 'var camera: Camera3D = null\nfunc _ready():\n\tcamera = Camera3D.new()\n\tcamera.add_child(weapon_view)\n'},
  ]);
  assert.equal(evidence.crosshairCentered, false);
  assert.equal(evidence.weaponUnderCamera, true);
  assert.equal(evidence.equipmentSwitch, false);
});

test('a project without project.godot or scripts is reported as such', () => {
  const evidence = sourceEvidence([{path: 'readme.md', text: 'nothing'}]);
  assert.equal(evidence.projectGodot, false);
  assert.equal(evidence.hasScripts, false);
});
