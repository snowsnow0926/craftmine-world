import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Finite read-history fact extraction. Two inputs are now explicit paths instead
// of a hardcoded tree: the dependency directory that provides the bundler, and
// the recorded run used for the replay.
//
//   node tests/player-feedback/P8/read-history.mjs \
//     --deps-app  <absolute directory with installed dependencies> \
//     --evidence  <absolute path to a finished run's report.json>
//
// Environment fallbacks: CRAFTMINE_P8_TEST_DEPS, CRAFTMINE_P8_READ_EVIDENCE.
// The replay is a re-derivation from completed owned receipts; it is not a new
// model request, a new runtime acceptance, or a rewrite of the original record.

function argument(name) {
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === name) return argv[index + 1];
    if (argv[index].startsWith(name + '=')) return argv[index].slice(name.length + 1);
  }
  return undefined;
}
function absoluteFile(value, code) {
  assert.ok(typeof value === 'string' && path.isAbsolute(value), code + '_ABSOLUTE_PATH_REQUIRED');
  const stat = fs.lstatSync(value);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, code + '_REGULAR_FILE_REQUIRED');
  return value;
}
function absoluteDirectory(value, code) {
  assert.ok(typeof value === 'string' && path.isAbsolute(value), code + '_ABSOLUTE_PATH_REQUIRED');
  const stat = fs.lstatSync(value);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), code + '_DIRECTORY_REQUIRED');
  return value;
}

const root = process.cwd();
const deps = absoluteDirectory(argument('--deps-app') ?? process.env.CRAFTMINE_P8_TEST_DEPS ?? 'D:/cm-fb-20260910/vendor/pi-desktop/packages/agent-runtime', 'P8_READ_HISTORY_DEPS');
assert.ok(fs.existsSync(path.join(deps, 'package.json')), 'P8_READ_HISTORY_DEPS_PACKAGE_JSON_REQUIRED');
const require = createRequire(path.join(deps, 'package.json'));
const out = fs.mkdtempSync(path.join(root, 'test-results/p8-read-history-'));
await require('esbuild').build({ entryPoints: [path.join(root, 'vendor/pi-desktop/packages/agent-runtime/src/craftmine-godot-read-files.ts')], outfile: path.join(out, 'reads.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { completedGodotReadFiles: reads } = await import(pathToFileURL(path.join(out, 'reads.mjs')));

const hash = 'a'.repeat(64), args = { path: 'scripts/world.gd', revision: 1, manifestHash: hash };
const call = { role: 'assistant', content: [{ type: 'toolCall', id: 'read-1', name: 'plugin_craftmine_world_godot_file_read', arguments: args }] };
const result = { role: 'toolResult', toolName: 'plugin_craftmine_world_godot_file_read', toolCallId: 'read-1', isError: false, content: [{ type: 'text', text: 'fixed' }], details: { ...args, sha256: 'b'.repeat(64), worldId: 'owned-world', text: 'extends Node', offset: 0, totalCharacters: 1000 } };
const checks = [];
const check = (name, value) => { assert.ok(value, name); checks.push({ name, passed: true }); };

assert.deepEqual(reads([call, result]), ['scripts/world.gd']);
check('successful matching partial read records path without claiming whole file', true);
for (const input of [[call], [result], [call, { ...result, isError: true }], [call, { ...result, details: { ...result.details, revision: 2 } }], [call, { ...result, details: { ...result.details, manifestHash: 'c'.repeat(64) } }], [call, { ...result, details: { ...result.details, path: 'other.gd' } }], [call, { ...result, details: undefined }], [{ role: 'user', content: 'I already read scripts/world.gd' }]]) assert.deepEqual(reads(input), []);
check('failed, missing, mismatched and narrated reads are not durable read facts', true);
for (const bad of ['../world.gd', 'C:/world.gd', 'a\nforged.gd']) {
  assert.deepEqual(reads([{ ...call, content: [{ ...call.content[0], arguments: { ...args, path: bad } }] }, { ...result, details: { ...result.details, path: bad } }]), []);
}
check('path metadata cannot inject traversal or a second summary line', true);

const evidenceArgument = argument('--evidence') ?? process.env.CRAFTMINE_P8_READ_EVIDENCE;
let replay = null;
if (evidenceArgument !== undefined) {
  const evidence = absoluteFile(evidenceArgument, 'P8_READ_HISTORY_EVIDENCE');
  assert.ok(path.extname(evidence).toLowerCase() === '.json', 'P8_READ_HISTORY_EVIDENCE_JSON_REQUIRED');
  const report = JSON.parse(fs.readFileSync(evidence, 'utf8'));
  assert.ok(Array.isArray(report.cases) && report.cases.length > 0, 'P8_READ_HISTORY_EVIDENCE_CASES_REQUIRED');
  const session = report.cases[0].record.session;
  const pairs = session.messages.filter(message => message.role === 'tool' && message.toolName === 'plugin_craftmine_world_godot_file_read').flatMap(message => {
    const value = JSON.parse(message.content);
    return [{ role: 'assistant', content: [{ type: 'toolCall', id: message.toolCallId, name: message.toolName, arguments: message.toolArgs }] },
      { role: 'toolResult', toolName: message.toolName, toolCallId: message.toolCallId, isError: value.isError, details: value.details, content: value.content }];
  });
  const files = reads(pairs);
  check('actual sealed-run successful Godot receipts replay into finite read history', files.length > 0);
  replay = { scope: 'Replay of completed owned native receipts, not a new model or runtime acceptance', input: evidence, evidenceSha256: (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(evidence)).digest('hex'), files, reads: pairs.length / 2 };
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ checks, replay, deps }, null, 2));
console.log('PASS ' + checks.length + ' ' + out);
