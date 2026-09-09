#!/usr/bin/env node
// Arithmetic gate check for the side-view base.
//
// This is deliberately independent of the physics run: it derives the reachable
// height from the same parameters the runtime loads, and compares it with the
// geometry declared in the world data. If a later tuning change makes a single
// jump able to clear the vault ledge, this check fails before any play test.
//
// Usage:
//   node tools/gate-metrics.mjs [--params <file>] [--world <file>] [--json <out>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(here, '..');

export function singleJumpRise(params) {
  const v = params.movement.jumpVelocity;
  return (v * v) / (2 * params.movement.gravity);
}

export function doubleJumpExtraRise(params) {
  const v = params.movement.doubleJumpVelocity;
  return (v * v) / (2 * params.movement.gravity);
}

export function doubleJumpTotalRise(params) {
  return singleJumpRise(params) + doubleJumpExtraRise(params);
}

export function singleJumpAirTime(params) {
  return (2 * Math.abs(params.movement.jumpVelocity)) / params.movement.gravity;
}

export function singleJumpHorizontalReach(params) {
  return params.movement.runSpeed * singleJumpAirTime(params);
}

// Horizontal reach with a second impulse fired at the apex of the first.
export function doubleJumpHorizontalReach(params) {
  const g = params.movement.gravity;
  const t1 = Math.abs(params.movement.jumpVelocity) / g;
  const t2 = (2 * Math.abs(params.movement.doubleJumpVelocity)) / g;
  return params.movement.runSpeed * (t1 + t2);
}

export function computeGateReport(params, world) {
  const gate = world.gate;
  if (!gate) throw new Error('world data has no gate block');
  const required = gate.requiredRise;
  const single = singleJumpRise(params);
  const total = doubleJumpTotalRise(params);
  const minSingle = params.gates?.minimumSingleJumpMargin ?? 16;
  const minDouble = params.gates?.minimumDoubleJumpMargin ?? 16;
  const singleMargin = required - single;
  const doubleMargin = total - required;
  return {
    format: 'craftmine.godot-sideview-gate/1',
    gateId: gate.id,
    requiredAbility: gate.requiredAbility,
    requiredRise: required,
    singleJumpRise: round(single),
    doubleJumpTotalRise: round(total),
    singleJumpMargin: round(singleMargin),
    doubleJumpMargin: round(doubleMargin),
    minimumSingleJumpMargin: minSingle,
    minimumDoubleJumpMargin: minDouble,
    singleJumpBlocked: singleMargin >= minSingle,
    doubleJumpPasses: doubleMargin >= minDouble,
    singleJumpHorizontalReach: round(singleJumpHorizontalReach(params)),
    doubleJumpHorizontalReach: round(doubleJumpHorizontalReach(params)),
    singleJumpAirTime: round(singleJumpAirTime(params)),
    paramsFormat: params.format,
    worldId: world.worldId,
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function defaultPaths() {
  return {
    params: path.join(baseDir, 'params', 'side_view_params.json'),
    world: path.join(baseDir, 'worlds', 'ruins', 'world.json'),
  };
}

function main() {
  const args = process.argv.slice(2);
  const defaults = defaultPaths();
  let paramsFile = defaults.params;
  let worldFile = defaults.world;
  let jsonOut = '';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--params') paramsFile = path.resolve(args[++i]);
    else if (args[i] === '--world') worldFile = path.resolve(args[++i]);
    else if (args[i] === '--json') jsonOut = path.resolve(args[++i]);
  }
  const report = computeGateReport(loadJson(paramsFile), loadJson(worldFile));
  report.paramsFile = paramsFile;
  report.worldFile = worldFile;
  const text = JSON.stringify(report, null, 2);
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, `${text}\n`);
  }
  console.log(text);
  const ok = report.singleJumpBlocked && report.doubleJumpPasses;
  if (!ok) {
    console.error('GATE METRIC FAILED: singleJumpBlocked=%s doubleJumpPasses=%s', report.singleJumpBlocked, report.doubleJumpPasses);
    process.exit(1);
  }
  console.log('GATE_METRICS_OK');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
