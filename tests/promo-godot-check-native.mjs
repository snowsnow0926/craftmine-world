// Authored blank-base integration, with real brokers and the product verifier.
// No model call, source fix, user input or application/adoption claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {main} from '../scripts/codex-world-author.mjs';
import {readState} from '../scripts/lib/codex-world-session.mjs';
import {CodexWorldHost} from '../scripts/lib/codex-world-host.mjs';
import {startPromoGodotCheckService} from '../scripts/lib/promo-godot-check-service.mjs';

const [runtime, plugin] = process.argv.slice(2);
assert.ok(runtime && plugin && path.isAbsolute(runtime) && path.isAbsolute(plugin), 'Pass absolute runtime and built plugin directories');
const parent = path.resolve('test-results/codex-promo/check-native');
await fs.mkdir(parent, {recursive: true});
const directory = await fs.mkdtemp(path.join(parent, 'run-'));
const data = path.join(directory, 'world');
await main(['init', '--data', data, '--runtime', runtime, '--plugin', plugin, '--world', 'check-' + randomUUID()]);
const state = readState(data);
const service = await startPromoGodotCheckService({directory: path.join(directory, 'checks')});
const host = new CodexWorldHost({state, data, services: {verifier: service.verifier}});
const context = {projectId: state.projectId, sessionId: state.sessionId, turnId: randomUUID()};
const report = {scope: 'real authored blank-base check; no model call or gameplay claim', directory, passed: false};
let started = false, sequence = 0;
const call = (name, args = {}) => host.tools.find(t => t.name === name).execute(args,
  {...context, toolCallId: 'fixture-' + ++sequence, executionId: 'promo-check-fixture'});
try {
  await host.start(); await host.begin(context, 'Check the unchanged shipped blank source.'); started = true;
  const before = await call('godot_project_index');
  const job = await call('godot_build_start', {revision: before.revision, manifestHash: before.manifestHash, mode: 'check'});
  report.jobId = job.jobId;
  for (;;) {
    report.job = await call('godot_build_read', {jobId: job.jobId});
    if (['passed', 'failed', 'blocked', 'cancelled', 'interrupted'].includes(report.job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(report.job.status, 'passed', JSON.stringify(report.job));
  assert.ok(report.job.candidateId);
  const after = await call('godot_project_index');
  assert.equal(after.revision, before.revision); assert.equal(after.manifestHash, before.manifestHash);
  report.frame = service.capture(job.jobId); assert.ok(report.frame?.file);
  const bytes = await fs.readFile(report.frame.file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  report.sourceUnchanged = true; report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  if (started) await host.end(context, report.passed ? 'completed' : 'error');
  await host.stop(); await service.close();
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({passed: report.passed, directory, jobId: report.jobId, frame: report.frame, error: report.error}));
