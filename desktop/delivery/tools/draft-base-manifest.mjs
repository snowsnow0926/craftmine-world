#!/usr/bin/env node
// Draft or check per-base provenance manifests (`craftmine.base-assets/1`).
//
// This tool never blesses bytes. `--check` only reports drift and exits non-zero.
// `--out` / `--out-dir` write a DRAFT to an explicit path; a human must review
// origin, author, licence and redistribution before committing it. The delivery
// preflight intentionally exposes no auto-refresh command, because accepting new
// bytes has to be a reviewed change, not a side effect of running a tool
// (docs/dispatch-reports/godot-parallel/H/SPEC_H_ASSET_MANIFEST.md section 8).
//
// Usage
//   node desktop/delivery/tools/draft-base-manifest.mjs --base <id> --out <file>
//   node desktop/delivery/tools/draft-base-manifest.mjs --all --out-dir <dir>
//   node desktop/delivery/tools/draft-base-manifest.mjs --check [--base <id>]
//
// Options
//   --base <id>     first-person | side-view | top-down (repeatable)
//   --all           every shipped base
//   --out <file>    write one draft manifest to this path
//   --out-dir <dir> write one draft per selected base into this directory
//   --check         compare the committed manifests with the current tree; no writes
//   --root <dir>    repository root to inspect (default: this worktree)
//   --json          print the machine-readable result
//
// Exit code: 0 on success, 1 on drift or a missing input, 2 on a usage error.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from '../lib/preflight-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..', '..');
const BASE_ASSETS_DIR = 'desktop/delivery/base-assets';
const REVIEWED_AT = '2026-09-10';

// Identity is read from the base's own manifest; these entries only fix the
// directory and the review metadata for the delivery provenance manifest.
const BASES = {
  'first-person': {
    directory: 'desktop/godot/bases/first-person',
    displayName: '3D first-person base (shipped base directory)',
    identityFiles: ['base_manifest.json'],
    rightsDocument: 'desktop/delivery/base-assets/rights/first-person.md'
  },
  'side-view': {
    directory: 'desktop/godot/bases/side-view',
    displayName: '2D side-view base (shipped base directory)',
    identityFiles: ['manifest.json'],
    rightsDocument: 'desktop/delivery/base-assets/rights/side-view.md'
  },
  'top-down': {
    directory: 'desktop/godot/bases/top-down',
    displayName: '2D top-down base (shipped base directory)',
    identityFiles: ['manifest.json'],
    rightsDocument: 'desktop/delivery/base-assets/rights/top-down.md'
  }
};

const argumentsList = process.argv.slice(2);
const option = name => {
  const index = argumentsList.indexOf('--' + name);
  return index === -1 ? null : argumentsList[index + 1];
};
const options = name => argumentsList.reduce((all, value, index) => {
  if (value === '--' + name) all.push(argumentsList[index + 1]);
  return all;
}, []);
const flag = name => argumentsList.includes('--' + name);
const fail = (code, message) => {
  console.error(code + ': ' + message);
  process.exit(2);
};

const root = path.resolve(option('root') ?? DEFAULT_ROOT);
if (!fs.existsSync(root)) fail('ROOT_ABSENT', root);

const selected = options('base');
if (flag('all')) selected.push(...Object.keys(BASES));
if (!selected.length && !flag('check')) fail('BASE_REQUIRED', 'Pass --base <id>, --all, --check or --out-dir.');
for (const id of selected) if (!BASES[id]) fail('BASE_UNKNOWN', id + ' is not a shipped base');

const relative = file => path.relative(root, file).replaceAll('\\', '/');
const exists = file => fs.existsSync(file);

/** Every regular file below a directory, sorted, links refused. */
function walkFiles(directory, prefix = '') {
  const found = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const target = path.join(directory, name);
    const info = fs.lstatSync(target);
    const relativePath = (prefix ? prefix + '/' : '') + name;
    if (info.isSymbolicLink()) throw new Error('LINK_DENIED: ' + relativePath);
    if (info.isDirectory()) found.push(...walkFiles(target, relativePath));
    else if (info.isFile()) found.push(relativePath);
  }
  return found;
}

function readBaseIdentity(base, directory) {
  for (const name of base.identityFiles) {
    const file = path.join(directory, name);
    if (!exists(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed.baseId !== undefined && parsed.baseId !== Object.keys(BASES).find(key => BASES[key] === base)) {
      throw new Error('BASE_ID_MISMATCH: ' + name + ' declares ' + parsed.baseId);
    }
    return {
      baseVersion: parsed.baseVersion ?? null,
      godotVersion: parsed.godotVersion ?? parsed.engine?.version ?? null,
      renderer: parsed.renderer ?? parsed.engine?.renderer ?? null,
      language: parsed.language ?? parsed.engine?.scriptLanguage ?? null
    };
  }
  throw new Error('BASE_IDENTITY_MISSING: ' + base.identityFiles.join(', '));
}

/**
 * Rights classification for one shipped base file.
 *
 * The only files that already carry a formal licence text are the first-person
 * geometry, materials and icon covered by licenses/ORIGINAL_ASSETS_LICENSE.txt
 * (MIT). Everything else is project-authored; its formal licence application is
 * tracked in desktop/delivery/licensing/inventory.json and summarised in the
 * per-base rights document, so the preflight keeps reporting the pending state.
 */
function classify(baseId, relativePath) {
  const name = relativePath.split('/').at(-1);
  const extension = name.includes('.') ? '.' + name.split('.').at(-1).toLowerCase() : '';
  const firstPersonMit = baseId === 'first-person'
    && (relativePath === 'icon.svg' || /^assets\/(?:meshes|materials)\//.test(relativePath));
  const developmentOnly = relativePath.startsWith('tests/')
    || relativePath.startsWith('tools/')
    || extension === '.md'
    || name === '.gitignore'
    || name === '.gitattributes';

  let role = 'asset';
  let origin = 'authored';
  let notes = 'Project-authored content shipped with this base.';
  if (extension === '.gd') {
    role = 'source';
    notes = 'Authored GDScript executed by the base runtime.';
  } else if (extension === '.tscn') {
    role = 'scene';
    notes = 'Authored scene; no third-party model, texture or audio is referenced.';
  } else if (extension === '.tres') {
    role = 'asset';
    notes = 'Hand-written Godot resource holding numeric or colour parameters only.';
  } else if (extension === '.obj') {
    role = 'asset';
    origin = 'generated';
    notes = 'Generated by tools/generate_meshes.mjs from authored vertex data.';
  } else if (extension === '.png') {
    role = 'asset';
    origin = 'generated';
    notes = 'Generated by tools/make-assets.mjs (project-authored pixel art, fixed seed).';
  } else if (extension === '.svg') {
    role = 'asset';
    notes = 'Hand-authored SVG icon in this repository.';
  } else if (extension === '.uid') {
    role = 'generated';
    origin = 'generated';
    notes = 'Godot-generated UID sidecar for the adjacent authored file.';
  } else if (extension === '.md') {
    role = 'doc';
    notes = 'Project documentation; not loaded by the running game.';
  } else if (extension === '.mjs') {
    role = relativePath.startsWith('tests/') ? 'test' : 'tool';
    notes = 'Development-only Node script; never shipped to players.';
  } else if (['.json', '.godot', '.template', '.gitignore', '.gitattributes'].includes(extension)
    || name === 'project.godot' || name.endsWith('.godot.template')) {
    role = 'config';
    notes = 'Project or base configuration.';
  }

  return {
    role,
    origin,
    author: 'Craftmine World project',
    license: firstPersonMit ? 'MIT' : 'project-authored',
    licenseFile: firstPersonMit ? 'licenses/ORIGINAL_ASSETS_LICENSE.txt' : null,
    licenseDocument: firstPersonMit ? null : 'desktop/delivery/base-assets/rights/' + baseId + '.md',
    redistribution: 'permitted',
    distribution: developmentOnly ? ['development-only'] : ['app-bundle', 'user-export'],
    targetLicense: firstPersonMit
      ? 'MIT (applied: licenses/ORIGINAL_ASSETS_LICENSE.txt)'
      : developmentOnly
        ? 'AGPL-3.0-only or commercial (creation core, formal application pending)'
        : 'MIT (export runtime, formal application pending)',
    notes
  };
}

function requiredNotices(root) {
  const notices = [];
  const lockPath = path.join(root, 'desktop/godot/toolchain.lock.json');
  if (exists(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8').replace(/^\uFEFF/, ''));
    for (const entry of lock.licenses ?? []) {
      notices.push({
        path: 'desktop/godot/' + entry.file,
        sha256: entry.sha256,
        appliesTo: ['app-bundle', 'user-export'],
        notes: 'Pinned engine notice; must travel with the base and with every export.'
      });
    }
  }
  return notices;
}

function buildManifest(root, baseId) {
  const base = BASES[baseId];
  const directory = path.join(root, base.directory);
  if (!exists(directory)) throw new Error('SOURCE_MISSING: ' + base.directory);
  const identity = readBaseIdentity(base, directory);
  const entries = walkFiles(directory).map(relativePath => {
    const file = path.join(directory, relativePath);
    const facts = classify(baseId, relativePath);
    return {
      path: relativePath,
      role: facts.role,
      origin: facts.origin,
      author: facts.author,
      version: identity.baseVersion ?? '0.1.0',
      license: facts.license,
      licenseFile: facts.licenseFile,
      licenseDocument: facts.licenseDocument,
      targetLicense: facts.targetLicense,
      redistribution: facts.redistribution,
      distribution: facts.distribution,
      bytes: fs.statSync(file).size,
      sha256: sha256(file),
      notes: facts.notes
    };
  });
  const notices = requiredNotices(root);
  if (baseId === 'first-person') {
    const license = 'desktop/godot/bases/first-person/licenses/ORIGINAL_ASSETS_LICENSE.txt';
    notices.push({
      path: license,
      sha256: sha256(path.join(root, license)),
      appliesTo: ['app-bundle', 'user-export'],
      notes: 'MIT grant covering the original geometry, materials and icon of this base.'
    });
  }
  return {
    format: 'craftmine.base-assets/1',
    baseId,
    displayName: base.displayName,
    provenanceScope: 'shipped-base-directory',
    baseVersion: identity.baseVersion ?? '0.1.0',
    engine: {
      version: identity.godotVersion ?? '4.7.2-stable',
      renderer: identity.renderer ?? 'gl_compatibility',
      language: identity.language ?? 'GDScript'
    },
    sourceDirectory: base.directory,
    reviewedCommit: null,
    reviewedAt: REVIEWED_AT,
    rightsStatus: 'pending-formal-application',
    rightsNote: 'Every file below this base is project-authored or project-generated. '
      + 'The target licences are MIT for the export runtime and AGPL-3.0-only or commercial for the creation core, '
      + 'per docs/LICENSING_STRATEGY.md. Formal per-module application is still open and tracked in '
      + 'desktop/delivery/licensing/inventory.json; the rights statement is ' + base.rightsDocument + '.',
    rightsDocument: base.rightsDocument,
    entries,
    externalEntries: [],
    requiredNotices: notices,
    hashReviewNote: 'Drafted from the working tree by desktop/delivery/tools/draft-base-manifest.mjs. '
      + 'reviewedCommit is set to the commit that introduces this manifest; bytes and hashes must be re-reviewed, not auto-blessed.'
  };
}

/** The commit whose tree was reviewed; read-only, no repository mutation. */
function headCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true}).trim();
  } catch {
    return null;
  }
}

if (flag('check')) {
  const ids = selected.length ? selected : Object.keys(BASES);
  const drift = [];
  for (const baseId of ids) {
    const committed = path.join(root, BASE_ASSETS_DIR, 'bases-' + baseId + '.json');
    if (!exists(committed)) {
      drift.push({baseId, code: 'MANIFEST_ABSENT', path: relative(committed)});
      continue;
    }
    const recorded = JSON.parse(fs.readFileSync(committed, 'utf8').replace(/^\uFEFF/, ''));
    const generated = buildManifest(root, baseId);
    const declared = new Map((recorded.entries ?? []).map(entry => [entry.path, entry]));
    for (const entry of generated.entries) {
      const found = declared.get(entry.path);
      if (!found) drift.push({baseId, code: 'UNDECLARED_FILE', path: entry.path});
      else if (found.bytes !== entry.bytes) drift.push({baseId, code: 'BYTES_MISMATCH', path: entry.path, recorded: found.bytes, actual: entry.bytes});
      else if (found.sha256 !== entry.sha256) drift.push({baseId, code: 'HASH_MISMATCH', path: entry.path});
      else if (!found.license || !found.redistribution) drift.push({baseId, code: 'RIGHTS_FIELD_MISSING', path: entry.path});
    }
    const actual = new Set(generated.entries.map(entry => entry.path));
    for (const entry of recorded.entries ?? []) if (!actual.has(entry.path)) drift.push({baseId, code: 'DECLARED_FILE_ABSENT', path: entry.path});
    if (recorded.rightsStatus !== generated.rightsStatus) drift.push({baseId, code: 'RIGHTS_STATUS_DRIFT', recorded: recorded.rightsStatus, actual: generated.rightsStatus});
  }
  if (flag('json')) console.log(JSON.stringify({ok: drift.length === 0, drift}, null, 2));
  else {
    for (const item of drift) console.log('DRIFT ' + item.baseId + ' ' + item.code + ' ' + item.path);
    console.log(drift.length ? 'DRIFT DETECTED: ' + drift.length + ' item(s)' : 'NO DRIFT: committed base manifests match the tree');
  }
  process.exit(drift.length ? 1 : 0);
}

const outFile = option('out');
const outDirectory = option('out-dir');
if (!outFile && !outDirectory) fail('OUTPUT_REQUIRED', 'Pass --out <file> or --out-dir <dir>; this tool never overwrites the committed manifests by itself.');
if (outFile && selected.length !== 1) fail('OUT_USAGE', '--out accepts exactly one --base');
if (outFile && outDirectory) fail('OUT_USAGE', 'Pass either --out or --out-dir');

for (const baseId of selected) {
  const manifest = buildManifest(root, baseId);
  manifest.reviewedCommit = headCommit(root);
  const target = outFile ?? path.join(path.resolve(outDirectory), 'bases-' + baseId + '.json');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n');
  console.log('DRAFT ' + relative(target) + ' entries=' + manifest.entries.length + ' notices=' + manifest.requiredNotices.length);
}
console.log('Review origin/author/licence/redistribution and set reviewedCommit before committing.');
