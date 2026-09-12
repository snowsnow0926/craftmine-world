// Local CLI adapter for the already-packaged Craftmine modeling tools.
// Every call gets independent test data; it never opens the player's profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const packageRoot = 'D:/Craftmine Worktrees/blender-integration-20260913/desktop/build/releases/04b18aafc8fd-d56bef63-9bd7-4685-9e81-5f6ef5f611f4/output/win-unpacked';
const plugin = path.join(packageRoot, 'resources/plugins/craftmine.world');
const runtimeRoot = path.join(packageRoot, 'resources/blender');
const workRoot = path.join(root, 'test-results/codex-models');
const require = createRequire(import.meta.url);
const {CoreClient} = require(path.join(plugin, 'core-client.cjs'));
const {createBlenderJobs} = require(path.join(plugin, 'blender-jobs.cjs'));
const {createWorldTools} = require(path.join(plugin, 'world-tools.cjs'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const [mode, name, scriptArg, variantArg] = args;
if (!['generate', 'render'].includes(mode) || !/^[a-z][a-z0-9-]{0,63}$/.test(name ?? ''))
  throw Error('Usage: node scripts/blender-model-demo.mjs generate NAME SCRIPT.py | render NAME [VIEW]');
await fs.mkdir(workRoot, {recursive: true});
const artifactRoot = path.join(workRoot, 'artifacts', name);

if (mode === 'generate') {
  if (!scriptArg) throw Error('Modeling script path required');
  const scriptPath = path.resolve(root, scriptArg);
  if (path.relative(root, scriptPath).startsWith('..')) throw Error('Script must be in this request worktree');
  const script = await fs.readFile(scriptPath, 'utf8');
  const runRoot = await fs.mkdtemp(path.join(workRoot, 'run-'));
  process.env.CRAFTMINE_BUNDLED_GIT = path.join(packageRoot, 'resources/git/bin/git.exe');
  const core = new CoreClient(path.join(packageRoot, 'resources/bin/craftmine-core.exe'), path.join(runRoot, 'data'));
  const context = {projectId: 'codex-models', sessionId: name, turnId: randomUUID()};
  const worldId = name + '-world';
  const jobs = createBlenderJobs(core, {dataPath: path.join(runRoot, 'data'), toolchain: {
    broker: path.join(runtimeRoot, 'broker/blender-host-broker.exe'),
    brokerIdentity: path.join(runtimeRoot, 'broker/broker-identity.json'),
    runtimeRoot, toolchainLock: path.join(runtimeRoot, 'toolchain.lock.json'),
  }});
  const tools = createWorldTools(core, async () => ({activeWorldId: worldId}), () => false, undefined, undefined,
    {blenderTool: (tool, values, binding) => jobs.tool(tool, values, binding)});
  let sequence = 0;
  const call = (tool, values = {}) => tools.find(item => item.name === tool).execute(values,
    {...context, toolCallId: 'cli-' + (++sequence), executionId: 'codex-cli'});
  const stop = () => {void jobs.stop();};
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await core.start(); await jobs.start();
    const initial = JSON.parse(await fs.readFile(path.join(root, 'desktop/godot/shared/initial-states/creation-sandbox-blank.json'), 'utf8')).snapshot;
    initial.worldId = worldId; initial.body.worldId = worldId;
    await core.call('world.create', {id: worldId, title: name, world: {
      build: {id: 'base-' + name, scene: {format: 'craftmine.godot-scene/1', baseId: 'creation-sandbox'}, godot: {}},
      snapshot: initial, extensions: [],
    }});
    await call('godot_project_create', {baseId: 'creation-sandbox', files: [{path: 'project.godot', text: 'config_version=5\n[application]\nconfig/name="Model studio"\n'}]});
    await core.call('content.migrate.apply', {worldId});
    const source = await call('godot_project_index');
    const started = await call('blender_generate', {name, script, revision: source.revision, manifestHash: source.manifestHash, expectedHash: null});
    console.log(JSON.stringify({status: started.status, jobId: started.jobId, model: name}));
    let result;
    for (;;) {
      result = await call('blender_job_read', {jobId: started.jobId});
      if (['imported', 'generated', 'failed', 'cancelled', 'interrupted'].includes(result.status)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await fs.mkdir(artifactRoot, {recursive: true});
    await fs.writeFile(path.join(runRoot, 'result.json'), JSON.stringify(result, null, 2));
    if (!result.artifacts?.length) {console.log(JSON.stringify(result)); process.exitCode = 1;}
    else {
      const files = [];
      for (const item of result.artifacts) {
        const bytes = await fs.readFile(path.join(runRoot, 'data/blender-jobs', started.jobId, 'assets', item.path));
        if (hash(bytes) !== item.sha256) throw Error('Artifact hash mismatch');
        await fs.writeFile(path.join(artifactRoot, item.path), bytes); files.push({path: path.join(artifactRoot, item.path), ...item});
      }
      await fs.writeFile(path.join(artifactRoot, 'receipt.json'), JSON.stringify({...result, runRoot, scriptPath, packagedRuntime: runtimeRoot}, null, 2));
      console.log(JSON.stringify({status: result.status, reason: result.reason, stats: result.stats, artifactRoot, files, diagnostics: result.diagnostics}));
      if (result.status !== 'imported') process.exitCode = 1;
    }
  } finally {await jobs.stop(); await core.stop();}
} else {
  const view = scriptArg ?? 'hero';
  if (!['hero', 'front', 'side', 'back', 'top'].includes(view)) throw Error('Unknown preview view');
  const model = path.join(artifactRoot, 'model.glb');
  await fs.access(model);
  const preview = path.join(artifactRoot, view + '.png');
  const previewRoot = await fs.mkdtemp(path.join(workRoot, 'preview-'));
  // Blender's Python importer cannot reliably import long module filenames from
  // deeply nested release directories on Windows. This coordinator-prepared
  // copy retains every byte of that exact packaged runtime at a shorter path.
  const previewRuntime = path.join(root, 'desktop/build/preview-runtime');
  const {verifyBlenderRuntime} = await import('../desktop/blender/toolchain.mjs');
  await verifyBlenderRuntime(previewRuntime);
  const executable = path.join(previewRuntime, 'blender.exe');
  const env = {SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: path.join(process.env.SystemRoot, 'System32'),
    TEMP: previewRoot, TMP: previewRoot, USERPROFILE: previewRoot, HOME: previewRoot, APPDATA: previewRoot, LOCALAPPDATA: previewRoot,
    BLENDER_USER_CONFIG: previewRoot, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1'};
  // A fixed trusted renderer loads only the generated data-format GLB. It never
  // opens/executes model-authored Python or .blend embedded scripts.
  const child = spawn(executable, ['--background', '--factory-startup', '--disable-autoexec', '--python-use-system-env', '--python-exit-code', '1', '--python',
    path.join(root, 'scripts/blender-model-preview.py'), '--', model, preview, view], {cwd: previewRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let log = ''; child.stdout.on('data', chunk => {log += chunk;}); child.stderr.on('data', chunk => {log += chunk;});
  process.once('SIGINT', () => child.kill()); process.once('SIGTERM', () => child.kill());
  const code = await new Promise((resolve, reject) => {child.on('error', reject); child.on('close', resolve);});
  await fs.writeFile(path.join(previewRoot, 'render.log'), log);
  if (code !== 0) {console.error(log.slice(-12000)); process.exitCode = 1;}
  else console.log(JSON.stringify({preview, view, renderer: 'bundled Blender Cycles CPU', log: path.join(previewRoot, 'render.log')}));
}
