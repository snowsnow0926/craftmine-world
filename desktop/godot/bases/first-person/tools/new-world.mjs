#!/usr/bin/env node
// Creates a first-person world project from the authored base.
//
// The product creates a world by copying the base source and selecting one
// template. This tool does exactly that and writes the same receipts the other
// two bases write, so the host (E) and the packaging task (H) do not need a
// per-base special case:
//
//   world.json        craftmine.godot-first-person-world/1  (identity + initial state)
//   world-build.json  craftmine.godot-world-build/1         (file hashes + build identity)
//
// It copies files only. It never runs Godot, never builds, never exports and
// never writes a save. It refuses a template that ships completed progress, so
// "create a new world from the training range" cannot inherit the author's
// finished quest.
//
// Usage:
//   node tools/new-world.mjs --template blank|training-range --world-id <id> --out <dir> [--name "..."] [--force]
//   node tools/new-world.mjs --check-template <blank|training-range>

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.resolve(HERE, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'base_manifest.json'), 'utf8'));

const WORLD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;
const EXCLUDED = new Set(['.godot', 'tests', 'docs', 'tools', '.git', '.gitignore']);

function fail(message) {
  process.stderr.write(`new-world: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { force: false, name: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--force') args.force = true;
    else if (token === '--template') args.template = argv[++i];
    else if (token === '--world-id') args.worldId = argv[++i];
    else if (token === '--name') args.name = argv[++i];
    else if (token === '--out') args.out = path.resolve(argv[++i]);
    else if (token === '--check-template') args.checkTemplate = argv[++i];
  }
  return args;
}

function hashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listFiles(root) {
  const result = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (EXCLUDED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else result.push(full);
    }
  };
  walk(root);
  return result;
}

function templateOf(id) {
  const template = (MANIFEST.templates || []).find((entry) => entry.id === id);
  if (!template) fail(`unknown template '${id}'. Available: ${(MANIFEST.templates || []).map((entry) => entry.id).join(', ')}`);
  return template;
}

/**
 * Refuse a template that already carries finished progress. Progress in this
 * base lives in `user://` saves, not in the project, so the only in-project
 * claims to reject are a completed quest resource or a claimed reward flag.
 */
function assertInitialState(template) {
  const problems = [];
  for (const file of listFiles(BASE_DIR)) {
    if (!file.endsWith('.tres') && !file.endsWith('.tscn') && !file.endsWith('.json')) continue;
    const relative = path.relative(BASE_DIR, file).split(path.sep).join('/');
    if (relative.startsWith('tests/') || relative.startsWith('docs/')) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/rewardGranted\s*=\s*true/.test(text)) problems.push(`${relative} ships rewardGranted = true`);
    if (/status\s*=\s*2\b/.test(text)) problems.push(`${relative} ships a completed quest status`);
    if (/taken\s*=\s*true/.test(text)) problems.push(`${relative} ships a claimed pickup`);
    if (/usesLeft\s*=\s*0/.test(text)) problems.push(`${relative} ships an exhausted interactable`);
  }
  if (template.kind === 'blank-start') {
    for (const file of listFiles(BASE_DIR)) {
      const relative = path.relative(BASE_DIR, file).split(path.sep).join('/');
      if (relative !== template.source) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const group of ['base_targets', 'base_interactables']) {
        if (text.includes(group)) problems.push(`${template.source} ships a ${group} node`);
      }
      if (text.includes('data/quests/')) problems.push(`${template.source} references a quest resource`);
    }
  }
  if (problems.length > 0) fail(`template '${template.id}' is not a clean starting point:\n  ${problems.join('\n  ')}`);
}

function copyProject(out, template) {
  fs.mkdirSync(out, { recursive: true });
  const copy = (dir, relative = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (EXCLUDED.has(entry.name)) continue;
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const source = path.join(dir, entry.name);
      const target = path.join(out, next);
      if (entry.isDirectory()) copy(source, next);
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
    }
  };
  copy(BASE_DIR);

  // Point the copied project at the selected entry scene and record the name.
  const projectFile = path.join(out, 'project.godot');
  let project = fs.readFileSync(projectFile, 'utf8');
  project = project.replace(/run\/main_scene="[^"]*"/, `run/main_scene="${template.entryScene}"`);
  if (template.kind === 'blank-start') {
    project = project.replace(/config\/name="[^"]*"/, `config/name="${template.label} World"`);
  }
  fs.writeFileSync(projectFile, project);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.checkTemplate) {
    assertInitialState(templateOf(args.checkTemplate));
    process.stdout.write(`new-world: template ${args.checkTemplate} ships initial progress only\n`);
    return;
  }

  if (!args.template) fail('--template is required');
  if (!args.worldId) fail('--world-id is required');
  if (!args.out) fail('--out is required');
  const template = templateOf(args.template);
  if (!WORLD_ID_PATTERN.test(args.worldId)) fail('--world-id must match ^[a-z0-9][a-z0-9-]{1,47}$');
  if (args.name && /[\r\n]/.test(args.name)) fail('--name must not contain line breaks');
  assertInitialState(template);

  const out = path.resolve(args.out);
  if (out === BASE_DIR || out.startsWith(BASE_DIR + path.sep)) fail('--out must not be inside the base');
  if (fs.existsSync(out)) {
    if (!args.force) fail(`output directory already exists: ${out} (use --force to replace)`);
    const entries = fs.readdirSync(out);
    if (entries.length > 0 && !entries.includes('project.godot')) {
      fail(`refusing to delete ${out}: it is not a generated Godot project`);
    }
    fs.rmSync(out, { recursive: true, force: true });
  }
  copyProject(out, template);

  const world = {
    format: 'craftmine.godot-first-person-world/1',
    baseId: MANIFEST.baseId,
    baseVersion: MANIFEST.baseVersion,
    baseProtocolVersion: MANIFEST.protocols.baseProtocolVersion,
    worldId: args.worldId,
    templateId: template.id,
    kind: template.kind,
    displayName: args.name || template.label,
    entryScene: template.entryScene,
    stateFormat: MANIFEST.protocols.stateFormat,
    stateVersion: MANIFEST.stateFormat.version,
    initialState: template.initialState,
  };
  fs.writeFileSync(path.join(out, 'world.json'), `${JSON.stringify(world, null, 2)}\n`);

  const files = listFiles(out)
    .map((file) => ({
      path: path.relative(out, file).split(path.sep).join('/'),
      bytes: fs.statSync(file).size,
      sha256: hashFile(file),
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
    godotVersion: MANIFEST.engine.version,
    worldId: args.worldId,
    template: template.id,
    entryScene: template.entryScene,
    stateVersion: MANIFEST.stateFormat.version,
    initialState: template.initialState,
    userDirName: `craftmine-first-person-${args.worldId}`,
    files,
  };
  fs.writeFileSync(path.join(out, 'world-build.json'), `${JSON.stringify(receipt, null, 2)}\n`);

  process.stdout.write(
    `new-world: ${template.id} -> ${out}\n` +
      `  worldId=${args.worldId} files=${files.length} entry=${template.entryScene}\n`,
  );
}

main();
