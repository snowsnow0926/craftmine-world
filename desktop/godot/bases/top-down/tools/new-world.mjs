#!/usr/bin/env node
// Creates a world project from the top-down base.
//
// A world is a standalone Godot project assembled from:
//   core/            base runtime scripts, original assets, project template
//   templates/<t>/   world-specific scenes, data, maps
//
// The generated world starts from the template's *initial progress*, never from
// the template author's played state. This script fails if a template ships a
// claimed reward or a completed quest, so "create a new world from the example"
// cannot inherit a finished quest.
//
// Usage:
//   node tools/new-world.mjs --template town --world-id my-town --name "我的小镇" --out <dir> [--force]
//   node tools/new-world.mjs --check-template <template-directory>

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
const TEMPLATE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

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
    else if (token === '--check-template') args.checkTemplate = argv[++i];
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

function jsonStringContent(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

// Reads a template's world manifest and refuses anything that would let a new
// world start with progress the template author already earned.
function loadTemplateWorld(templateDir, worldId = 'template-check', name = 'template-check') {
  const file = join(templateDir, 'world.json.template');
  if (!existsSync(file)) fail(`template has no world.json.template: ${templateDir}`);
  const substituted = substitute(readFileSync(file, 'utf8'), {
    WORLD_ID: worldId,
    WORLD_NAME: jsonStringContent(name),
  });
  let world;
  try {
    world = JSON.parse(substituted);
  } catch (error) {
    fail(`template world.json.template is not valid JSON: ${error.message}`);
  }
  assertInitialProgress(world, templateDir);
  return world;
}

function assertInitialProgress(world, source) {
  const initial = world.initialProgress || {};
  for (const quest of initial.quests || []) {
    if (quest.rewarded === true) {
      fail(`${source} ships a claimed reward for quest ${quest.id}`);
    }
    if (quest.status === 'completed') {
      fail(`${source} ships a completed quest ${quest.id}`);
    }
  }
  if (initial.grantedRewards && Object.keys(initial.grantedRewards).length > 0) {
    fail(`${source} ships a non-empty grantedRewards ledger`);
  }
  if (initial.inventory && initial.inventory.some((entry) => Number(entry.count) < 0)) {
    fail(`${source} ships a negative inventory count`);
  }
  if (initial.coins !== undefined && Number(initial.coins) < 0) {
    fail(`${source} ships negative coins`);
  }
}

function checkTemplate(directory) {
  const dir = resolve(directory);
  if (!existsSync(dir)) fail(`template directory does not exist: ${dir}`);
  loadTemplateWorld(dir);
  process.stdout.write(`new-world: template ${dir} ships initial progress only\n`);
}

function guardOutput(out) {
  const baseRoot = resolve(BASE_DIR);
  const coreRoot = resolve(CORE_DIR);
  const templatesRoot = resolve(TEMPLATES_DIR);
  for (const protectedDir of [baseRoot, coreRoot, templatesRoot]) {
    if (out === protectedDir) fail(`--out must not be ${protectedDir}`);
    // out being a parent of a protected directory would delete it on --force.
    if (protectedDir.startsWith(out + sep)) fail(`--out ${out} contains ${protectedDir}`);
  }
  if (out.startsWith(coreRoot + sep) || out.startsWith(templatesRoot + sep)) {
    fail(`--out must not be inside the base runtime or its templates: ${out}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.checkTemplate) {
    checkTemplate(args.checkTemplate);
    return;
  }

  if (!args.template) fail('--template is required');
  if (!args.worldId) fail('--world-id is required');
  if (!args.out) fail('--out is required');
  if (!TEMPLATE_NAME_PATTERN.test(args.template)) {
    fail('--template must match ^[a-z0-9][a-z0-9-]{0,31}$');
  }
  if (!WORLD_ID_PATTERN.test(args.worldId)) {
    fail('--world-id must match ^[a-z0-9][a-z0-9-]{1,47}$');
  }
  if (args.name !== undefined && /[\r\n]/.test(args.name)) fail('--name must not contain line breaks');
  if (args.description !== undefined && /[\r\n]/.test(args.description)) fail('--description must not contain line breaks');

  const templateDir = join(TEMPLATES_DIR, args.template);
  if (!existsSync(templateDir)) fail(`unknown template: ${args.template}`);
  const templateWorld = loadTemplateWorld(templateDir, args.worldId, args.name || args.worldId);

  const out = resolve(args.out);
  guardOutput(out);
  if (existsSync(out)) {
    if (!args.force) fail(`output directory already exists: ${out} (use --force to replace)`);
    const entries = readdirSync(out);
    if (entries.length > 0 && !entries.includes('world.json')) {
      fail(`refusing to delete ${out}: it is not a generated world (no world.json)`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });

  const userDir = `craftmine-topdown-${args.worldId}`;
  const projectValues = {
    WORLD_NAME: JSON.stringify(args.name || args.worldId),
    WORLD_DESCRIPTION: JSON.stringify(args.description || templateWorld.description || ''),
    MAIN_SCENE: JSON.stringify(templateWorld.entryScene),
    USER_DIR: JSON.stringify(userDir),
  };

  // 1. Base runtime and original assets.
  copyTree(join(CORE_DIR, 'scripts'), join(out, 'scripts', 'base'));
  copyTree(join(CORE_DIR, 'assets'), join(out, 'assets'));
  writeFileSync(join(out, 'icon.svg'), readFileSync(join(CORE_DIR, 'icon.svg')));

  // 2. World-specific content. A template may only contribute world content:
  //    the base runtime above is never overridden by a template file.
  for (const entry of readdirSync(templateDir)) {
    if (entry === 'world.json.template') continue;
    if (entry === 'scripts') fail(`${args.template} must not ship scripts/; the base runtime is not replaceable`);
    copyTree(join(templateDir, entry), join(out, entry));
  }

  // 3. Project file and world manifest.
  writeFileSync(
    join(out, 'project.godot'),
    substitute(readFileSync(join(CORE_DIR, 'project.godot.template'), 'utf8'), projectValues),
  );
  writeFileSync(join(out, 'world.json'), `${JSON.stringify(templateWorld, null, 2)}\n`);

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
    worldId: templateWorld.worldId,
    template: args.template,
    entryScene: templateWorld.entryScene,
    stateVersion: templateWorld.stateVersion,
    initialProgress: templateWorld.initialProgress,
    userDirName: userDir,
    files,
  };
  writeFileSync(join(out, 'world-build.json'), `${JSON.stringify(receipt, null, 2)}\n`);

  process.stdout.write(
    `new-world: ${args.template} -> ${out}\n` +
      `  worldId=${templateWorld.worldId} files=${files.length} userDir=${userDir}\n`,
  );
}

main();
