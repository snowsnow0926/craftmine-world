// Real bundled plugin -> restricted Blender -> Rust source -> Godot integration.
// Authored fixtures only; no model calls, window activation, or input simulation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';

const runFile = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const binary = process.env.CRAFTMINE_CORE_BIN;
const runtimeRoot = process.env.CRAFTMINE_BLENDER_TEST_ROOT;
assert.ok(binary && path.isAbsolute(binary), 'Set CRAFTMINE_CORE_BIN to the current core binary');
assert.ok(runtimeRoot && path.isAbsolute(runtimeRoot), 'Set CRAFTMINE_BLENDER_TEST_ROOT to the staged Blender component');
await fs.mkdir(path.join(root, 'test-results'), {recursive: true});
const out = await fs.mkdtemp(path.join(root, 'test-results/bi-'));
const plugin = path.join(out, 'plugin');
await runFile(process.execPath, [path.join(root, 'desktop/build-world-plugin.mjs'), '--output', plugin], {cwd: root, windowsHide: true});
const require = createRequire(import.meta.url);
const {CoreClient} = require(path.join(plugin, 'core-client.cjs'));
const {createWorldTools} = require(path.join(plugin, 'world-tools.cjs'));
const {createBlenderJobs} = require(path.join(plugin, 'blender-jobs.cjs'));
const core = new CoreClient(binary, path.join(out, 'data'));
const context = {projectId: 'blender-project', sessionId: 'blender-session', turnId: 'blender-turn'};
const worldId = 'blender-world';
const jobs = createBlenderJobs(core, {dataPath: path.join(out, 'data'), toolchain: {
  broker: path.join(runtimeRoot, 'broker/blender-host-broker.exe'),
  brokerIdentity: path.join(runtimeRoot, 'broker/broker-identity.json'),
  runtimeRoot, toolchainLock: path.join(runtimeRoot, 'toolchain.lock.json'),
}});
const tools = createWorldTools(core, async () => ({activeWorldId: worldId}), () => false, undefined, undefined,
  {blenderTool: (name, args, binding) => jobs.tool(name, args, binding)});
let sequence = 0;
const call = (name, args = {}) => tools.find(tool => tool.name === name).execute(args,
  {...context, toolCallId: 'fixture-' + (++sequence), executionId: 'fixture-execution'});
const report = {format: 'craftmine.blender-integration/1', scope: 'authored-fixture-real-components',
  modelCalls: 0, inputSimulation: false, out, checks: [], jobs: [], passed: false};
const check = (name, value) => {report.checks.push({name, passed: !!value}); assert.ok(value, name); console.log('PASS ' + name);};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const terminal = new Set(['imported', 'generated', 'failed', 'cancelled', 'interrupted']);
async function waitForJob(jobId) {
  for (;;) {
    const result = await call('blender_job_read', {jobId});
    if (terminal.has(result.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}
async function readModel(result) {
  const chunks = [];
  let offset = 0;
  do {
    const page = await core.call('godotProject.read', {context, worldId,
      revision: result.imported.revision, manifestHash: result.imported.manifestHash,
      path: result.modelPath, offset, limit: 16000});
    assert.equal(page.encoding, 'base64'); chunks.push(Buffer.from(page.bytesBase64, 'base64'));
    offset = page.nextOffset;
  } while (offset !== null);
  const bytes = Buffer.concat(chunks);
  assert.equal(hash(bytes), result.imported.modelSha256);
  return bytes;
}
try {
  report.hello = await core.start();
  await jobs.start();
  const initial = JSON.parse(await fs.readFile(path.join(root, 'desktop/godot/shared/initial-states/creation-sandbox-blank.json'), 'utf8')).snapshot;
  initial.worldId = worldId; initial.body.worldId = worldId;
  await core.call('world.create', {id: worldId, title: 'Blender integration fixture', world: {
    build: {id: 'base-blender', scene: {format: 'craftmine.godot-scene/1', baseId: 'creation-sandbox'}, godot: {}},
    snapshot: initial, extensions: [],
  }});
  await call('godot_project_create', {baseId: 'creation-sandbox', files: [{path: 'project.godot',
    text: 'config_version=5\n[application]\nconfig/name="Blender fixture"\n'}]});
  await core.call('content.migrate.apply', {worldId});
  const originalWorld = await core.call('world.read', {id: worldId});
  const status = await call('blender_status'); report.status = status;
  check('actual bundled toolchain is available', status.available === true);
  let index = await call('godot_project_index');
  const first = await call('blender_generate', {name: 'house',
    script: await fs.readFile(path.join(root, 'tests/fixtures/blender/house.py'), 'utf8'),
    revision: index.revision, manifestHash: index.manifestHash, expectedHash: null});
  const generated = await waitForJob(first.jobId); report.jobs.push(generated);
  check('restricted Blender output is committed through the real Rust source transaction', generated.status === 'imported');
  check('generation preserves the editable source and original script', ['source.blend', 'script.py'].every(name => generated.artifacts.some(item => item.path === name && item.bytes > 0)));
  check('model generation makes no false application claim', generated.applied === false && generated.playableVerified === false);
  const history = await call('blender_status', {name: 'house', limit: 1});
  check('retained editable source is discoverable through the world-bound tool', history.jobs.items[0]?.sourceJobId === generated.jobId);
  check('global runtime status does not expose world job history', !Object.hasOwn(await jobs.status(), 'jobs'));
  const firstModel = await readModel(generated);
  const godot = await createGodotProbeEnvironment(path.join(out, 'godot'));
  report.godotVersion = godot.actualVersion; report.godotRuns = godot.runs;
  async function inspect(label, bytes) {
    const project = path.join(out, label); await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Model validation"\n');
    await fs.writeFile(path.join(project, 'model.glb'), bytes);
    await fs.copyFile(path.join(root, 'tests/fixtures/blender/inspect-model.gd'), path.join(project, 'inspect-model.gd'));
    const parse = stdout => {
      const line = stdout.split(/\r?\n/).find(value => value.startsWith('CRAFTMINE_BLENDER_INTEGRATION='));
      assert.ok(line, 'Godot must report measured model behavior');
      return JSON.parse(line.slice('CRAFTMINE_BLENDER_INTEGRATION='.length));
    };
    const runtime = parse(await godot.run(label, ['--path', project, '--script', 'inspect-model.gd']));
    await godot.run(label + '-import', ['--path', project, '--editor', '--import']);
    const imported = parse(await godot.run(label + '-packed', ['--path', project, '--script', 'inspect-model.gd', '--', '--editor-import']));
    assert.ok(imported.editorImport && imported.doorMoved && imported.collision);
    assert.equal(imported.meshes, runtime.meshes);
    return {...runtime, packedSceneImport: imported};
  }
  const firstInspection = await inspect('house-original', firstModel); report.firstInspection = firstInspection;
  check('Godot loads generated geometry, plays the door animation and detects collision', firstInspection.headless && firstInspection.doorMoved && firstInspection.collision);
  index = await call('godot_project_index');
  const edit = await call('blender_generate', {name: 'house', previousJobId: generated.jobId,
    script: await fs.readFile(path.join(root, 'tests/fixtures/blender/edit-house.py'), 'utf8'),
    revision: index.revision, manifestHash: index.manifestHash, expectedHash: generated.imported.modelSha256});
  const edited = await waitForJob(edit.jobId); report.jobs.push(edited);
  check('a second job edits the verified prior blend source and imports a new revision', edited.status === 'imported' && edited.imported.revision > generated.imported.revision);
  const secondModel = await readModel(edited);
  check('the model changes while the previous source revision remains readable', hash(secondModel) !== hash(firstModel) && hash(await readModel(generated)) === hash(firstModel));
  const secondInspection = await inspect('house-edited', secondModel); report.secondInspection = secondInspection;
  check('the source edit reaches Godot with changed paint and retained animated door/collision', secondInspection.hasBluePaint && secondInspection.doorMoved && secondInspection.collision);
  index = await call('godot_project_index');
  const failedStart = await call('blender_generate', {name: 'broken', script: 'raise RuntimeError("CRAFTMINE_MODEL_FIXTURE_FAILURE")',
    revision: index.revision, manifestHash: index.manifestHash, expectedHash: null});
  const failed = await waitForJob(failedStart.jobId); report.jobs.push(failed);
  check('a real Python failure reaches the AI as bounded untrusted diagnostics', failed.status === 'failed' &&
    failed.diagnostics?.source === 'untrusted-script-log' && failed.diagnostics.text.includes('CRAFTMINE_MODEL_FIXTURE_FAILURE'));
  const cancelStart = await call('blender_generate', {name: 'cancelled', script: 'import time\nprint("CRAFTMINE_CANCEL_READY", flush=True)\nwhile True:\n    time.sleep(0.1)\n',
    revision: index.revision, manifestHash: index.manifestHash, expectedHash: null});
  // Observe only this test-owned job log to cancel actual Python execution,
  // rather than merely cancelling the initial filesystem staging operation.
  const record = JSON.parse(await fs.readFile(path.join(out, 'data/blender-jobs', cancelStart.jobId, 'record.json'), 'utf8'));
  const logPath = path.join(out, 'data/bt', record.nativeTaskId, 'logs/task.log');
  for (;;) {
    let text = ''; try {text = await fs.readFile(logPath, 'utf8');} catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (text.includes('CRAFTMINE_CANCEL_READY')) break;
    const state = await call('blender_job_read', {jobId: cancelStart.jobId});
    assert.ok(!terminal.has(state.status), 'Cancellation fixture must reach actual Python execution');
  }
  const cancelled = await call('blender_cancel', {jobId: cancelStart.jobId}); report.jobs.push(cancelled);
  check('the actual running Python task is cancelled through the ordinary tool', cancelled.status === 'cancelled');
  const finalIndex = await call('godot_project_index');
  check('failed and cancelled modeling tasks leave the Godot source revision unchanged', finalIndex.revision === index.revision && finalIndex.manifestHash === index.manifestHash);
  check('source import leaves formal world and player progress unchanged before application', JSON.stringify(await core.call('world.read', {id: worldId})) === JSON.stringify(originalWorld));
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error); process.exitCode = 1; console.error(report.error);
} finally {
  await jobs.stop(); await core.stop();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({out, passed: report.passed, checks: report.checks.length, error: report.error}));
}
