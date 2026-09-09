#!/usr/bin/env node
// Generates the machine-readable base catalog (creation manifest for the UI task
// E) and the component catalog (packaging inputs for the reuse task H) from the
// three authored base manifests.
//
// The manifests are the source of truth. This script never invents a template or
// a component: it validates the contracts, hashes every declared file and writes
// deterministic JSON. `--check` re-generates in memory and fails on drift, so a
// manifest edit without regenerating the catalog is caught in CI/tests.
//
// Usage:
//   node desktop/godot/shared/tools/build-base-catalog.mjs [--check] [--out <dir>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_CATALOG_FORMAT,
  BASE_CONTRACT_FORMAT,
  COMPONENT_CATALOG_FORMAT,
  ENGINE_CONTRACT,
  baseContentHash,
  loadBaseContracts,
  sha256File,
} from '../base_contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GODOT_ROOT = path.resolve(HERE, '..', '..');
const BASES_DIR = path.join(GODOT_ROOT, 'bases');

/** Portable world id rule shared by the product creation flow and materializeBase. */
export const WORLD_ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,47}$';

function parseArgs(argv) {
  const args = { check: false, out: BASES_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--out') args.out = path.resolve(argv[i + 1]);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function substituteTemplate(text, values) {
  return text.replace(/__([A-Z_]+)__/g, (match, key) => (key in values ? values[key] : match));
}

function jsonStringContent(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

/** Read a template's declared starting progress from the real template data. */
function templateInitialState(baseId, template, contract, baseDir) {
  if (Array.isArray(contract.raw.templates) && template.initialState) return template.initialState;
  const source = template.source;
  if (typeof source === 'string' && source.endsWith('.tscn')) return template.initialState || {};
  const sourceDir = path.join(baseDir, source);
  const templateFile = path.join(sourceDir, 'world.json.template');
  if (fs.existsSync(templateFile)) {
    const world = JSON.parse(
      substituteTemplate(fs.readFileSync(templateFile, 'utf8'), {
        WORLD_ID: 'catalog-check',
        WORLD_NAME: jsonStringContent('catalog-check'),
      }),
    );
    return world.initialProgress || {};
  }
  const worldFile = path.join(sourceDir, 'world.json');
  if (fs.existsSync(worldFile)) {
    const world = readJson(worldFile);
    const summary = {
      startRoom: world.startRoom,
      startSpawn: world.startSpawn,
      abilities: [],
      checkpoints: [],
      rewards: [],
      targets: [],
      counters: {},
      inventory: {},
      entities: {},
    };
    for (const room of world.rooms || []) {
      summary.abilities.push(...(room.abilities || []).map((entry) => entry.id));
      summary.checkpoints.push(...(room.checkpoints || []).map((entry) => entry.id));
      summary.rewards.push(...(room.rewards || []).map((entry) => entry.id));
      summary.targets.push(...(room.targets || []).map((entry) => entry.id));
    }
    return summary;
  }
  return template.initialState || {};
}

function creationCommand(baseId, template) {
  if (baseId === 'top-down') {
    return {
      tool: 'tools/new-world.mjs',
      args: ['--template', template.id, '--world-id', '<worldId>', '--out', '<dir>'],
    };
  }
  if (baseId === 'side-view') {
    return {
      tool: 'tools/new-world.mjs',
      args: ['--world', template.id, '--world-id', '<worldId>', '--out', '<dir>'],
    };
  }
  return {
    tool: 'tools/new-world.mjs',
    args: ['--template', template.id, '--world-id', '<worldId>', '--out', '<dir>'],
  };
}

export function buildCatalogs({ basesDir = BASES_DIR } = {}) {
  const { bases, issues } = loadBaseContracts(basesDir);
  const blocking = issues.filter((entry) => entry.code !== 'missing-assets-manifest');
  if (blocking.length > 0) {
    const text = blocking.map((entry) => `${entry.code} @ ${entry.where}: ${entry.message}`).join('\n');
    throw new Error(`base contract validation failed:\n${text}`);
  }
  const catalogBases = [];
  const catalogComponents = [];
  for (const entry of bases) {
    const contract = entry.contract;
    const baseDir = entry.dir;
    const content = baseContentHash(baseDir, contract);
    const templates = contract.templates
      .slice()
      .sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind === 'blank-start' ? -1 : 1))
      .map((template) => ({
        id: template.id,
        kind: template.kind,
        label: template.label || template.id,
        entryScene: template.entryScene,
        description: template.description || '',
        source: template.source || null,
        initialState: templateInitialState(contract.baseId, template, contract, baseDir),
        create: creationCommand(contract.baseId, template),
      }));
    catalogBases.push({
      baseId: contract.baseId,
      baseVersion: contract.baseVersion,
      title: contract.title,
      status: contract.raw.status || null,
      engine: contract.engine,
      protocols: contract.protocols,
      state: contract.state,
      assets: contract.assets,
      contentHash: content.hash,
      worldIdPattern: WORLD_ID_PATTERN,
      entityIdScheme: contract.raw.entityIdScheme || null,
      capabilities: contract.raw.capabilities || [],
      templates,
      components: contract.components.map((component) => component.id).sort(),
      managedMaterialize: {
        function: 'materializeBase',
        module: 'desktop/godot/shared/materialize.mjs',
        args: { baseId: contract.baseId, worldId: '<worldId>', template: '<templateId>', out: '<dir>' },
      },
      tools: contract.tools,
      acceptance: contract.acceptance,
    });
    for (const component of contract.components) {
      catalogComponents.push({
        id: component.id,
        version: component.version,
        kind: component.kind,
        label: component.label || component.id,
        baseId: contract.baseId,
        baseVersion: contract.baseVersion,
        identity: component.identity,
        persistentState: component.persistentState,
        initialState: component.initialState,
        install: component.install ?? null,
        files: component.files.map((file) => {
          const rel = typeof file === 'string' ? file : file.path;
          const absolute = path.join(baseDir, rel);
          return {
            path: rel,
            bytes: fs.existsSync(absolute) ? fs.statSync(absolute).size : null,
            sha256: fs.existsSync(absolute) ? sha256File(absolute) : null,
          };
        }),
      });
    }
  }
  catalogBases.sort((a, b) => (a.baseId < b.baseId ? -1 : 1));
  catalogComponents.sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    baseCatalog: {
      format: BASE_CATALOG_FORMAT,
      generatedBy: 'desktop/godot/shared/tools/build-base-catalog.mjs',
      contractFormat: BASE_CONTRACT_FORMAT,
      engine: ENGINE_CONTRACT,
      worldIdPattern: WORLD_ID_PATTERN,
      bases: catalogBases,
    },
    componentCatalog: {
      format: COMPONENT_CATALOG_FORMAT,
      generatedBy: 'desktop/godot/shared/tools/build-base-catalog.mjs',
      contractFormat: BASE_CONTRACT_FORMAT,
      components: catalogComponents,
    },
  };
}

function writeOrCheck(file, value, check) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    if (!fs.existsSync(file)) return `missing generated file: ${file}`;
    if (fs.readFileSync(file, 'utf8') !== text) return `generated file is stale: ${file}`;
    return null;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { baseCatalog, componentCatalog } = buildCatalogs({ basesDir: BASES_DIR });
  const targets = [
    [path.join(args.out, 'base-catalog.json'), baseCatalog],
    [path.join(args.out, 'component-catalog.json'), componentCatalog],
  ];
  const problems = [];
  for (const [file, value] of targets) {
    const problem = writeOrCheck(file, value, args.check);
    if (problem) problems.push(problem);
  }
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`build-base-catalog: ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    args.check
      ? `build-base-catalog: ${baseCatalog.bases.length} bases and ${componentCatalog.components.length} components are current\n`
      : `build-base-catalog: wrote ${targets.map(([file]) => path.relative(GODOT_ROOT, file)).join(', ')}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
