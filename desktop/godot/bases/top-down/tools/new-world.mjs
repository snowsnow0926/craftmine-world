#!/usr/bin/env node
// Creates a world project from the top-down base.
//
// A world is a standalone Godot project assembled from:
//   core/            base runtime scripts, original assets, project template
//   templates/<t>/   world-specific scenes, data, maps
//
// The generated world starts from the template's *initial progress*, never from
// the template author's played state. This script fails if a template ships a
// claimed reward, so "create a new world from the example" cannot inherit a
// finished quest.
//
// Usage:
//   node tools/new-world.mjs --template town --world-id my-town --name "我的小镇" --out <dir> [--force]

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = resolve(HERE, '..');
const CORE_DIR = join(BASE_DIR, 'core');
const TEMPLATES_DIR = join(BASE_DIR, 'templates');
const MANIFEST = JSON.parse(readFileSync(join(BASE_DIR, 'manifest.json'), 'utf8'));

const WORLD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

function parseArgs(argv) {
  const args = { force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--force') args.force = true;
    else if (token === '--template') args.template = argv[++i];
    else if (token === '--world-id') args.worldId = argv[++i];
    else if (token === '--name') args.name = argv[++i];
    else if (token === '--description') args.description = argv[++i];
    else if (token === '--out') args.out = argv[++i];
  }
  return args;
}

function fail(message) {
  process.stderr.write(`new-world: ${message}\n`);
  process.exit(1);
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFiles(root) {
  const result = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else result.push(full);
    }
  };
  if (existsSync(root)) walk(root);
  return result;
}

function copyTree(from, to) {
  cpSync(from, to, { recursive: true });
}

function substitute(text, values) {
  return text.replace(/__([A-Z_]+)__/g, (match, key) => {
    if (!(key in values)) fail(`template placeholder ${match} has no value`);
    return values[key];
  });
}

function assertInitialProgress(worldPath) {
  const world = JSON.parse(readFileSync(worldPath, 'utf8'));
  const initial = world.initialProgress || {};
  for (const quest of initial.quests || []) {
    if (quest.rewarded === true) fail(`template ships a claimed reward for quest ${quest.id}`);
  }
  if (initial.grantedRewards && Object.keys(initial.grantedRewards).length > 0) {
    fail('template ships a non-empty grantedRewards ledger');
  }
  return world;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.template) fail('--template is required');
  if (!args.worldId) fail('--world-id is required');
  if (!args.out) fail('--out is required');
  if (!WORLD_ID_PATTERN.test(args.worldId)) {
    fail('--world-id must match ^[a-z0-9][a-z0-9-]{1,47}$');
  }
  const templateDir = join(TEMPLATES_DIR, args.template);
  if (!existsSync(templateDir)) fail(`unknown template: ${args.template}`);

  const out = resolve(args.out);
  if (existsSync(out)) {
    if (!args.force) fail(`output directory already exists: ${out} (use --force to replace)`);
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });

  const templateWorld = JSON.parse(
    substitute(readFileSync(join(templateDir, 'world.json.template'), 'utf8'), {
      WORLD_ID: args.worldId,
      WORLD_NAME: args.name || args.worldId,
    }),
  );

  const values = {
    WORLD_ID: args.worldId,
    WORLD_NAME: args.name || args.worldId,
    WORLD_DESCRIPTION: args.description || templateWorld.description || '',
    MAIN_SCENE: templateWorld.entryScene,
    USER_DIR: `craftmine-topdown-${args.worldId}`,
  };

  // 1. Base runtime and original assets.
  copyTree(join(CORE_DIR, 'scripts'), join(out, 'scripts', 'base'));
  copyTree(join(CORE_DIR, 'assets'), join(out, 'assets'));
  writeFileSync(join(out, 'icon.svg'), readFileSync(join(CORE_DIR, 'icon.svg')));

  // 2. World-specific content.
  for (const entry of readdirSync(templateDir)) {
    if (entry === 'world.json.template') continue;
    copyTree(join(templateDir, entry), join(out, entry));
  }

  // 3. Project file and world manifest.
  writeFileSync(
    join(out, 'project.godot'),
    substitute(readFileSync(join(CORE_DIR, 'project.godot.template'), 'utf8'), values),
  );
  writeFileSync(join(out, 'world.json'), `${JSON.stringify(templateWorld, null, 2)}\n`);
  const world = assertInitialProgress(join(out, 'world.json'));

  // 4. Build receipt for the build/run services (task B/C integration).
  const files = listFiles(out)
    .map((path) => ({
      path: relative(out, path).split(sep).join('/'),
      bytes: statSync(path).size,
      sha256: hashFile(path),
    }))
    .filter((entry) => entry.path !== 'world-build.json')
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  const receipt = {
    format: 'craftmine.godot-world-build/1',
    baseId: MANIFEST.baseId,
    baseVersion: MANIFEST.baseVersion,
    baseProtocolVersion: MANIFEST.protocols.baseProtocolVersion,
    worldFormat: MANIFEST.protocols.worldFormat,
    stateFormat: MANIFEST.protocols.stateFormat,
    progressFormat: MANIFEST.protocols.progressFormat,
    probeFormat: MANIFEST.protocols.probeFormat,
    godotVersion: MANIFEST.godotVersion,
    worldId: world.worldId,
    template: args.template,
    entryScene: world.entryScene,
    stateVersion: world.stateVersion,
    initialProgress: world.initialProgress,
    userDirName: values.USER_DIR,
    files,
  };
  writeFileSync(join(out, 'world-build.json'), `${JSON.stringify(receipt, null, 2)}\n`);

  process.stdout.write(
    `new-world: ${args.template} -> ${out}\n` +
      `  worldId=${world.worldId} files=${files.length} userDir=${values.USER_DIR}\n`,
  );
}

main();
