#!/usr/bin/env node
// Records the identity of a built `godot-host-broker.exe`.
//
// The executor refuses to run a broker whose sha256 does not match the pin, so
// the pin has to be produced by whoever builds the shipped binary rather than
// copied from a different tree. Usage:
//
//   node desktop/godot/sandbox/broker-identity.mjs <broker.exe> [--write <path>]
//
// Without `--write` the JSON is printed to stdout. The source digest covers
// every file the broker is compiled from, so a pin always names the exact
// source it was measured against.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sandbox = path.dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function rustFiles(directory,prefix='src'){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const relative=prefix+'/'+entry.name;
    if(entry.isSymbolicLink())throw Error('BROKER_SOURCE_LINK_DENIED');
    return entry.isDirectory()?rustFiles(path.join(directory,entry.name),relative):entry.name.endsWith('.rs')?[relative]:[];
  });
}
const SOURCE_FILES = ['Cargo.toml', 'Cargo.lock', ...rustFiles(path.join(sandbox,'src'))];

function sourceDigest() {
  const records = SOURCE_FILES.filter(relative => fs.existsSync(path.join(sandbox, relative)))
    .map(relative => ({path:relative.split(path.sep).join('/'),
      sha256:sha256(fs.readFileSync(path.join(sandbox, relative)))}))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {digest:sha256(JSON.stringify(records)), files:records};
}

const [binary, ...rest] = process.argv.slice(2);
if (!binary) {
  process.stderr.write('usage: node broker-identity.mjs <broker.exe> [--write <path>]\n');
  process.exit(2);
}
if (!fs.existsSync(binary)) {
  process.stderr.write('broker binary not found: ' + binary + '\n');
  process.exit(2);
}
const writeAt = rest.indexOf('--write');
const source = sourceDigest();
const identity = {
  format:'craftmine.godot-broker-identity/1',
  profile:process.env.CRAFTMINE_BROKER_PROFILE ?? 'debug',
  protocolVersion:1,
  policyVersion:'craftmine.windows.lpac-registry.v1',
  recoveryPolicyVersion:'craftmine.windows.recovery-journal.v1',
  sourceCommit:process.env.CRAFTMINE_BROKER_SOURCE_COMMIT ?? null,
  sourceDigest:source.digest,
  sourceFiles:source.files,
  sha256:sha256(fs.readFileSync(binary)),
  bytes:fs.statSync(binary).size,
  // A debug build embeds absolute paths, so its hash depends on the build
  // directory. The shipped pin must be generated from the canonical release
  // build; this field records what was actually measured.
  builtFrom:path.resolve(binary),
  recordedAt:new Date().toISOString(),
};
const text = JSON.stringify(identity, null, 2) + '\n';
if (writeAt >= 0) {
  const target = rest[writeAt + 1];
  if (!target) { process.stderr.write('--write requires a path\n'); process.exit(2); }
  fs.writeFileSync(target, text);
  process.stderr.write('wrote ' + target + ' sha256=' + identity.sha256 + '\n');
} else {
  process.stdout.write(text);
}
