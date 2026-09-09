#!/usr/bin/env node
// Materialize one side-view world as a standalone Godot project.
//
// The host (task B) materializes a build's `source/` directory from a source
// revision. This tool produces exactly that input for a side-view world: the
// shared runtime plus one world's data, with worlds/default.json pointing at it.
// It copies files only; it never runs Godot, never builds and never exports.
//
// Usage:
//   node tools/new-world.mjs --world ruins --out <dir> [--force]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(here, '..');

const SHARED = ['project.godot', 'manifest.json', 'params', 'scripts', 'scenes'];

function parseArgs(argv) {
  const args = { world: '', worldId: '', out: '', force: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--world') args.world = argv[i + 1];
    else if (argv[i] === '--world-id') args.worldId = argv[i + 1];
    else if (argv[i] === '--out') args.out = path.resolve(argv[i + 1]);
    else if (argv[i] === '--force') args.force = true;
  }
  return args;
}

function listWorlds() {
  const root = path.join(baseDir, 'worlds');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'world.json')))
    .map((entry) => entry.name)
    .sort();
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const worlds = listWorlds();
  if (!args.world || !args.out) {
    console.error(`Usage: node tools/new-world.mjs --world <${worlds.join('|')}> --out <dir> [--force]`);
    process.exit(2);
  }
  if (!worlds.includes(args.world)) {
    console.error(`Unknown world '${args.world}'. Available: ${worlds.join(', ')}`);
    process.exit(2);
  }
  const worldId = args.worldId || randomUUID();
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId)) throw Error('World identity must be a portable lowercase id (2-48 chars)');
  if (fs.existsSync(args.out) && !args.force) {
    console.error(`Output directory already exists: ${args.out} (pass --force to overwrite)`);
    process.exit(2);
  }
  if (fs.existsSync(args.out) && (fs.lstatSync(args.out).isSymbolicLink() || fs.readdirSync(args.out).length)) {
    throw Error('Refusing to replace a link or nonempty output directory; choose a fresh managed directory');
  }
  fs.mkdirSync(args.out, { recursive: true });

  for (const item of SHARED) {
    const source = path.join(baseDir, item);
    const target = path.join(args.out, item);
    if (fs.statSync(source).isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
  copyDir(path.join(baseDir, 'worlds', args.world), path.join(args.out, 'worlds', args.world));
  fs.writeFileSync(
    path.join(args.out, 'worlds', 'default.json'),
    `${JSON.stringify({ format: 'craftmine.godot-sideview-default/1', worldId: args.world, instanceId: worldId }, null, 2)}\n`,
  );
  // The copied world data records the new world identity and the template it
  // came from, so two worlds created from the same template are never confused.
  const worldFile = path.join(args.out, 'worlds', args.world, 'world.json');
  const world = JSON.parse(fs.readFileSync(worldFile, 'utf8'));
  world.worldId = worldId;
  world.templateId = args.world;
  fs.writeFileSync(worldFile, `${JSON.stringify(world, null, 2)}\n`);
  const manifest = JSON.parse(fs.readFileSync(path.join(baseDir, 'manifest.json'), 'utf8'));
  const receipt = {
    format: 'craftmine.godot-sideview-materialize/1',
    baseId: 'side-view',
    baseVersion: manifest.baseVersion,
    worldId,
    instanceId: worldId,
    templateId: args.world,
    worldKind: world.kind,
    stateVersion: world.stateVersion,
    entryScene: 'res://scenes/main.tscn',
    output: args.out,
  };
  fs.writeFileSync(path.join(args.out, 'MATERIALIZED.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}

main();
