'use strict';
// Managed Godot executor.
//
// This is the only product component that runs the pinned engine. It owns the
// private broker protocol (BROKER_PROTOCOL_V1.md) and never accepts a shell
// command, executable path, task root, launch token or receipt from a page or
// from the model: those come from host configuration and from the Rust core.
//
// Lifecycle: discover + verify the fixed engine/broker/templates, run a real
// preflight, register the executor with the core, then claim one job at a time.
// Each job runs the fixed import/exportWeb operations inside the broker's
// AppContainer policy, verifies the measured inputs and artifacts, optionally
// runs the isolated Electron runtime check, and records the real result.
const {spawn} = require('node:child_process');
const {createHash, randomUUID} = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const EXECUTOR_ID = 'craftmine-windows-broker-v1';
const ISOLATION = 'craftmine.windows.lpac-registry.v1';
const ENGINE_VERSION = '4.7.2-stable';
const ATTESTATION_FORMAT = 'craftmine.godot-executor/1';
const RESULT_FORMAT = 'craftmine.godot-job-result/1';
const CHECK_FORMAT = 'craftmine.godot-check-descriptor/1';
const BROKER_SCHEMA_VERSION = 1;
const BROKER_FRAME_BYTES = 65536;
const BROKER_RESPONSE_BYTES = 8 * 1024 * 1024;
const BROKER_TASK_LOG_BYTES = 65536;
const HEARTBEAT_MS = 30000;
const JOB_TIMEOUT_MS = 600000;
const PREFLIGHT_TIMEOUT_MS = 120000;
const CANCEL_GRACE_MS = 15000;
const BLOCKED_RETRY_MS = 600000;
const MAX_JOBS = 2;

// Fixed-engine native diagnostics that the restricted AppContainer environment
// produces before any project code runs. Each entry is an exact (message,
// location) pair measured from the pinned 4.7.2 engine. Anything else - a
// GDScript backtrace, an unknown ERROR, or a model compile failure - is fatal.
// The rule stays narrow on purpose: it can never blanket-ignore output.
const NATIVE_ISOLATION_DIAGNOSTICS = Object.freeze([
  {message:'Condition "res != ((HRESULT)0x00000000)" is true. Returning: String()',
    at:'get_system_dir (platform/windows/os_windows.cpp:2502)'},
  {message:'Call to GetAdaptersAddresses failed with error 5.',
    at:'get_local_interfaces (drivers/windows/ip_windows.cpp:117)'},
  {message:'Method/function failed. Returning: ""',
    at:'get_filesystem_type (drivers/windows/dir_access_windows.cpp:412)'},
  {message:'Condition "_sock == (SOCKET)(~0)" is true. Returning: FAILED',
    at:'open (drivers/windows/net_socket_winsock.cpp:238)'},
  {message:'Condition "err != OK" is true. Returning: ERR_CANT_CREATE',
    at:'listen (core/io/tcp_server.cpp:56)'},
]);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const sha256File = async file => sha256(await fsp.readFile(file));
const nowIso = () => new Date().toISOString();

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}

/** The exact digest the broker computes over the files it copied. */
function sourceSnapshotDigest(files) {
  const sorted = [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return sha256(JSON.stringify(sorted.map(file => ({path:file.path, bytes:file.bytes, sha256:file.sha256}))));
}

function ordinaryDirectory(target) {
  try {
    const info = fs.lstatSync(target);
    // Node reports both symlinks and junctions as symbolic links here, so this
    // also refuses a reparse-point engine or task root.
    return !info.isSymbolicLink() && info.isDirectory();
  } catch { return false; }
}

/** Reject traversal, absolute paths, alternate streams and Win32 path aliases. */
function safeRelative(value) {
  if (typeof value !== 'string' || !value.length || value.length > 240) throw Error('GODOT_ARTIFACT_INVALID');
  if (value.includes('\\') || value.includes('\0') || value.includes(':') || value.startsWith('/')) throw Error('GODOT_ARTIFACT_INVALID');
  for (const part of value.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part)) throw Error('GODOT_ARTIFACT_INVALID');
  }
  return value;
}

function assertInside(root, relative) {
  const resolved = path.resolve(root, ...safeRelative(relative).split('/'));
  const relativeToRoot = path.relative(path.resolve(root), resolved);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) throw Error('GODOT_ARTIFACT_ESCAPE');
  return resolved;
}

function bounded(value, limit) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= limit ? text : text.slice(text.length - limit);
}

/**
 * The Rust core canonicalizes its data directory, so claimed roots can arrive
 * with a Win32 verbatim (`\\?\`) prefix. Node's `realpathSync` refuses those,
 * and the shared Web runtime resolves every served file with it, so the host
 * normalizes every core-supplied root before use.
 */
function plainPath(value) {
  if (typeof value !== 'string' || process.platform !== 'win32') return value;
  if (value.startsWith('\\\\?\\UNC\\')) return '\\\\' + value.slice(8);
  if (value.startsWith('\\\\?\\')) return value.slice(4);
  return value;
}

/**
 * Classify Godot's own log. The known native isolation diagnostics are recorded
 * separately and never counted as compile failures; every other ERROR line,
 * SCRIPT ERROR, parse error or GDScript backtrace fails the job.
 */
function classifyLog(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const native = [], errors = [], warnings = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const location = (lines[index + 1] ?? '').trim();
    if (/^(?:SCRIPT ERROR|Parse Error|USER ERROR)/.test(line.trim())) {
      errors.push(line.trim().slice(0, 500));
      continue;
    }
    if (/^WARNING:/.test(line.trim())) { warnings.push(line.trim().slice(0, 500)); continue; }
    if (!/^ERROR:/.test(line.trim())) continue;
    const message = line.trim().slice('ERROR:'.length).trim();
    const known = NATIVE_ISOLATION_DIAGNOSTICS.some(entry => entry.message === message && location === 'at: ' + entry.at);
    if (known) native.push({message, at:location.slice('at: '.length)});
    else errors.push(line.trim().slice(0, 500));
  }
  return {native, errors, warnings};
}

function createGodotExecutor(core, options = {}) {
  const dataPath = options.dataPath;
  const verifier = options.verifier ?? null;
  const logger = options.logger ?? console;
  // Test seam only: the product always spawns the pinned broker binary. The
  // protocol tests inject a scripted broker so framing, digests, cancellation
  // and tampered receipts can be exercised deterministically.
  const spawnBroker = options.spawnBroker ?? ((binary, args, settings) => spawn(binary, args, settings));
  const clock = options.now ?? (() => Date.now());
  const jobTimeoutMs = options.jobTimeoutMs ?? JOB_TIMEOUT_MS;
  const jobs = new Map();
  const discovery = {state:'idle', reason:null, broker:null, engineRoot:null, lock:null, evidenceHash:null, preflight:null};
  let tasksRoot = null;
  let stopped = false;
  let registered = false;
  let starting = null;

  const log = (...args) => { try { logger.log('[godot-executor]', ...args); } catch {} };
  const warn = (...args) => { try { logger.warn('[godot-executor]', ...args); } catch {} };

  // ---------------------------------------------------------------- discovery

  // An explicit configuration is authoritative: a broken configured path is
  // reported as missing instead of silently falling back to a development copy.
  function configured(name) {
    const value = process.env[name];
    return value ? path.resolve(value) : null;
  }

  function candidateBroker() {
    const configuredBroker = configured('CRAFTMINE_GODOT_BROKER_BIN');
    if (configuredBroker) return configuredBroker;
    if (dataPath) {
      for (const relative of [['bin','godot-host-broker.exe'], ['godot','bin','godot-host-broker.exe']]) {
        const candidate = path.join(dataPath, ...relative);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    const development = path.resolve(__dirname, '..', '..', 'desktop', 'godot', 'sandbox', 'target', 'debug', 'godot-host-broker.exe');
    return fs.existsSync(development) ? development : null;
  }

  function candidateEngineRoot() {
    const configuredRoot = configured('CRAFTMINE_GODOT_ENGINE_ROOT') ?? configured('CRAFTMINE_GODOT_CACHE_DIR');
    if (configuredRoot) return configuredRoot;
    if (dataPath) {
      const candidate = path.join(dataPath, 'godot', 'engine', ENGINE_VERSION);
      if (fs.existsSync(candidate)) return candidate;
    }
    const development = path.resolve(__dirname, '..', '..', 'desktop', 'build', 'godot', ENGINE_VERSION);
    return fs.existsSync(development) ? development : null;
  }

  function toolchainLock() {
    const configured = process.env.CRAFTMINE_GODOT_TOOLCHAIN_LOCK;
    const candidates = [configured, dataPath && path.join(dataPath, 'godot', 'toolchain.lock.json'),
      path.resolve(__dirname, '..', '..', 'desktop', 'godot', 'toolchain.lock.json')].filter(Boolean);
    for (const candidate of candidates) {
      try { return {path:candidate, value:JSON.parse(fs.readFileSync(candidate, 'utf8'))}; }
      catch { /* the next candidate is tried; absence is reported, never assumed */ }
    }
    return null;
  }

  function bridgeSource() {
    const configuredBridge = configured('CRAFTMINE_GODOT_BRIDGE_PATH');
    if (configuredBridge) return configuredBridge;
    const candidates = [dataPath && path.join(dataPath, 'godot', 'web', 'bridge.js'),
      path.resolve(__dirname, '..', '..', 'desktop', 'godot', 'web', 'bridge.js')].filter(Boolean);
    for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
    return null;
  }

  async function verifyToolchain() {
    const broker = candidateBroker();
    if (!broker || !fs.existsSync(broker)) return {ok:false, reason:'GODOT_BROKER_MISSING'};
    const engineRoot = candidateEngineRoot();
    if (!engineRoot || !ordinaryDirectory(engineRoot)) return {ok:false, reason:'GODOT_ENGINE_MISSING'};
    const lock = toolchainLock();
    const brokerSha256 = await sha256File(broker);
    const pinnedBroker = process.env.CRAFTMINE_GODOT_BROKER_SHA256;
    if (pinnedBroker && pinnedBroker.toLowerCase() !== brokerSha256) return {ok:false, reason:'GODOT_BROKER_MISMATCH'};
    const measured = {};
    if (lock) {
      const editor = path.join(engineRoot, 'editor', lock.value.editor?.executable ?? '');
      const templates = path.join(engineRoot, 'templates');
      if (!fs.existsSync(editor)) return {ok:false, reason:'GODOT_ENGINE_MISSING'};
      if (!ordinaryDirectory(templates)) return {ok:false, reason:'GODOT_TEMPLATES_MISSING'};
      measured.editorSha256 = await sha256File(editor);
      if (measured.editorSha256 !== lock.value.editor.executableSha256) return {ok:false, reason:'GODOT_ENGINE_MISMATCH'};
      for (const key of ['webThreadedRelease', 'webRelease']) {
        const entry = lock.value.exportTemplates?.[key];
        if (!entry) continue;
        const template = path.join(templates, entry.file);
        if (!fs.existsSync(template)) return {ok:false, reason:'GODOT_TEMPLATES_MISSING'};
        measured[key] = {file:entry.file, bytes:fs.statSync(template).size, sha256:await sha256File(template)};
        if (measured[key].sha256 !== entry.sha256) return {ok:false, reason:'GODOT_TEMPLATE_MISMATCH'};
      }
    }
    const bridge = bridgeSource();
    if (!bridge || !fs.existsSync(bridge)) return {ok:false, reason:'GODOT_BRIDGE_MISSING'};
    measured.bridgeSha256 = await sha256File(bridge);
    return {ok:true, broker, brokerSha256, engineRoot, lock, measured, bridge:{file:bridge, sha256:measured.bridgeSha256}};
  }

  async function preflight(verified) {
    const taskId = brokerTaskId('version');
    const run = await runBroker({
      binary:verified.broker,
      operation:'version',
      tasksRoot,
      engineRoot:verified.engineRoot,
      sourceBinding:{worldId:'executor-preflight', buildId:'executor-preflight', sourceRevision:0, sourceDigest:sha256('')},
      inputHash:sha256('craftmine.godot-executor/preflight'),
      requestId:taskId,
      timeoutMs:PREFLIGHT_TIMEOUT_MS,
    });
    const result = validateBrokerReceipt(run.response, {
      operation:'version', sourceBinding:{worldId:'executor-preflight', buildId:'executor-preflight', sourceRevision:0, sourceDigest:sha256('')},
      inputHash:sha256('craftmine.godot-executor/preflight'), expectedFiles:[], requestId:taskId,
    });
    if (!result.ok) {
      // Keep the broker's own diagnostics: a preparation failure must be
      // diagnosable without re-running the engine.
      result.detail = {exitCode:run.exitCode ?? null, signal:run.signal ?? null, cancelled:run.cancelled === true,
        timedOut:run.timedOut === true, oversized:run.oversized === true, parseError:run.parseError ?? null,
        brokerError:typeof run.response?.error === 'string' ? run.response.error.slice(0, 600) : null,
        stderr:(run.stderr ?? '').slice(0, 600)};
      warn('preflight broker detail:', JSON.stringify(result.detail));
    }
    return result;
  }

  function evidenceOf(verified, preflightResult) {
    return sha256(canonical({
      format:'craftmine.godot-executor-evidence/1',
      engineVersion:ENGINE_VERSION,
      isolation:ISOLATION,
      broker:{sha256:verified.brokerSha256},
      engine:verified.measured,
      lock:verified.lock ? {path:path.basename(verified.lock.path), version:verified.lock.value.version} : null,
      preflight:{
        policyVersion:preflightResult.receipt.policyVersion,
        processVerified:preflightResult.receipt.processVerification?.verified === true,
        networkVerified:preflightResult.receipt.networkPreflight?.verified === true,
        cleanupVerified:preflightResult.receipt.cleanup?.verified === true,
        brokerSha256:preflightResult.receipt.brokerSha256 ?? null,
      },
    }));
  }

  // ------------------------------------------------------------- broker calls

  /**
   * The pinned broker derives its AppContainer profile name as
   * `craftmine.godot.task.<taskId>`, and Windows refuses a profile name longer
   * than 64 characters. The generated id stays short, fresh and path-safe.
   */
  function brokerTaskId(operation) {
    const tag = {version:'pf', import:'im', exportWeb:'ex'}[operation] ?? 'op';
    return `${tag}-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }

  /**
   * One broker `run` invocation: exactly one compact request line, stdin kept
   * open, one JSON response line, cancellation through the documented frame.
   */
  function runBroker(request) {
    // The broker's own profile name is `craftmine.godot.task.<taskId>`; Windows
    // rejects a profile name longer than 64 characters with E_INVALIDARG.
    if (typeof request.requestId !== 'string' || request.requestId.length < 1 ||
        Buffer.byteLength('craftmine.godot.task.' + request.requestId) > 64) {
      return Promise.resolve({ok:false, reason:'GODOT_BROKER_TASK_ID_TOO_LONG', requestId:request.requestId, stdout:'', stderr:''});
    }
    const child = spawnBroker(request.binary, ['run'], {
      windowsHide:true,
      stdio:['pipe', 'pipe', 'pipe'],
      env:{...process.env, SystemRoot:process.env.SystemRoot},
    });
    let stdout = '', stderr = '', settled = false, cancelled = false, oversized = false, timedOut = false;
    let resolveRun;
    const done = new Promise(resolve => { resolveRun = resolve; });
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolveRun(value); } };
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > BROKER_RESPONSE_BYTES) { oversized = true; cancel('response too large'); }
    });
    child.stderr.on('data', chunk => { stderr = bounded(stderr + chunk, 8192); });
    child.on('error', error => finish({ok:false, reason:'GODOT_BROKER_SPAWN_FAILED', error:error.message, requestId:request.requestId, stdout, stderr}));
    child.on('exit', (code, signal) => {
      let response = null, parseError = null;
      const line = stdout.trim();
      if (line) { try { response = JSON.parse(line); } catch (error) { parseError = error.message; } }
      finish({ok:true, requestId:request.requestId, exitCode:code, signal, response, parseError, stdout:bounded(stdout, 8192), stderr, cancelled, timedOut, oversized});
    });
    const timer = setTimeout(() => { timedOut = true; cancel('timeout'); }, Math.max(1000, request.timeoutMs ?? JOB_TIMEOUT_MS));

    function cancel(reason) {
      if (cancelled) return;
      cancelled = true;
      try { child.stdin.write('{"cancel":true}\n'); } catch {}
      const grace = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, CANCEL_GRACE_MS);
      grace.unref?.();
      child.once('exit', () => clearTimeout(grace));
      request.onCancel?.(reason);
    }

    const payload = {
      schemaVersion:BROKER_SCHEMA_VERSION,
      requestId:request.requestId,
      taskId:request.requestId,
      operation:request.operation,
      tasksRoot:request.tasksRoot,
      engineRoot:request.engineRoot,
      sourceBinding:request.sourceBinding,
      inputHash:request.inputHash,
    };
    if (request.operation !== 'version') payload.projectRoot = request.projectRoot;
    const frame = JSON.stringify(payload) + '\n';
    if (Buffer.byteLength(frame) > BROKER_FRAME_BYTES) {
      child.kill('SIGKILL');
      return Promise.resolve({ok:false, reason:'GODOT_BROKER_REQUEST_TOO_LARGE', requestId:request.requestId, stdout, stderr});
    }
    try { child.stdin.write(frame); } catch (error) { finish({ok:false, reason:'GODOT_BROKER_WRITE_FAILED', error:error.message, requestId:request.requestId, stdout, stderr}); }
    return Object.assign(done, {cancel});
  }

  function validateBrokerReceipt(response, expected) {
    const fail = reason => ({ok:false, reason, receipt:response ?? null});
    if (!response || typeof response !== 'object') return fail('GODOT_BROKER_RESPONSE_INVALID');
    if (!response.requestId) return fail('GODOT_BROKER_PREPARATION_FAILED');
    if (response.schemaVersion !== BROKER_SCHEMA_VERSION) return fail('GODOT_BROKER_RESPONSE_INVALID');
    if (response.requestId !== expected.requestId || response.taskId !== expected.requestId) return fail('GODOT_BROKER_RESPONSE_MISMATCH');
    if (response.operation !== expected.operation) return fail('GODOT_BROKER_RESPONSE_MISMATCH');
    if (response.inputHash !== expected.inputHash) return fail('GODOT_BROKER_INPUT_MISMATCH');
    if (canonical(response.sourceBinding) !== canonical(expected.sourceBinding)) return fail('GODOT_BROKER_BINDING_MISMATCH');
    if (response.state === 'cancelled') return {ok:false, cancelled:true, reason:'GODOT_JOB_CANCELLED', receipt:response};
    if (response.state !== 'succeeded') return fail('GODOT_BROKER_TASK_FAILED');
    if (response.policyVersion !== ISOLATION) return fail('GODOT_BROKER_POLICY_MISMATCH');
    if (response.processVerification?.verified !== true) return fail('GODOT_BROKER_PROCESS_UNVERIFIED');
    if (response.networkPreflight?.verified !== true) return fail('GODOT_BROKER_NETWORK_UNVERIFIED');
    if (response.cleanup?.verified !== true) return fail('GODOT_BROKER_CLEANUP_UNVERIFIED');
    if (expected.pinnedBrokerSha256 && response.brokerSha256 !== expected.pinnedBrokerSha256) return fail('GODOT_BROKER_MISMATCH');
    const files = Array.isArray(response.sourceFiles) ? response.sourceFiles : null;
    if (!files) return fail('GODOT_BROKER_RESPONSE_INVALID');
    if (sourceSnapshotDigest(files) !== response.sourceSnapshotDigest) return fail('GODOT_BROKER_SOURCE_DIGEST_INVALID');
    if (expected.expectedFiles) {
      const expectedMap = new Map(expected.expectedFiles.map(file => [file.path, file]));
      for (const file of files) {
        const declared = expectedMap.get(file.path);
        if (!declared) return fail('GODOT_BROKER_SOURCE_EXTRA:' + file.path);
        if (declared.bytes !== file.bytes || declared.sha256 !== file.sha256) return fail('GODOT_BROKER_SOURCE_CHANGED:' + file.path);
        expectedMap.delete(file.path);
      }
      if (expectedMap.size) return fail('GODOT_BROKER_SOURCE_MISSING:' + [...expectedMap.keys()][0]);
    }
    return {ok:true, receipt:response, files};
  }

  // ---------------------------------------------------------------- job worker

  function claimedFiles(claim) {
    const groups = claim.files ?? {};
    const files = [];
    for (const kind of ['source', 'asset', 'host']) {
      for (const file of groups[kind] ?? []) {
        safeRelative(file.path);
        files.push({path:file.path, bytes:file.bytes, sha256:String(file.sha256).toLowerCase(), kind});
      }
    }
    return files;
  }

  async function stageArtifacts(receipt, artifactsRoot, pinnedBridge) {
    const sourceRoot = path.resolve(plainPath(receipt.artifactsRoot ?? ''));
    if (!ordinaryDirectory(sourceRoot)) throw Error('GODOT_ARTIFACT_ROOT_INVALID');
    const targetRoot = path.resolve(plainPath(artifactsRoot));
    if (!ordinaryDirectory(targetRoot)) throw Error('GODOT_ARTIFACT_ROOT_INVALID');
    const listed = Array.isArray(receipt.artifacts) ? receipt.artifacts : [];
    if (!listed.length) throw Error('GODOT_ARTIFACT_MISSING');
    const seen = new Set(), staged = [];
    for (const artifact of listed) {
      const relative = safeRelative(artifact.path);
      const key = relative.toLowerCase();
      if (seen.has(key)) throw Error('GODOT_ARTIFACT_CONFLICT');
      seen.add(key);
      const from = assertInside(sourceRoot, relative);
      const info = fs.lstatSync(from);
      if (!info.isFile() || info.isSymbolicLink()) throw Error('GODOT_ARTIFACT_INVALID');
      if (info.size !== artifact.bytes) throw Error('GODOT_ARTIFACT_MISMATCH');
      if (await sha256File(from) !== artifact.sha256) throw Error('GODOT_ARTIFACT_MISMATCH');
      const to = assertInside(targetRoot, 'web/' + relative);
      await fsp.mkdir(path.dirname(to), {recursive:true});
      await fsp.copyFile(from, to);
      if (await sha256File(to) !== artifact.sha256) throw Error('GODOT_ARTIFACT_MISMATCH');
      staged.push({path:'web/' + relative, bytes:artifact.bytes, sha256:artifact.sha256});
    }
    // A file the broker did not list must never be served from the staged root.
    const walked = await walkFiles(sourceRoot);
    for (const file of walked) if (!seen.has(file.toLowerCase())) throw Error('GODOT_ARTIFACT_UNLISTED:' + file);
    if (!seen.has('index.html')) throw Error('GODOT_WEB_ENTRY_MISSING');
    // The host owns the browser bridge; an authored or replaced copy is refused.
    const bridgeTarget = assertInside(targetRoot, 'web/bridge.js');
    const pinned = pinnedBridge;
    if (!pinned) throw Error('GODOT_BRIDGE_MISSING');
    let replaced = false;
    if (fs.existsSync(bridgeTarget)) {
      const current = await sha256File(bridgeTarget);
      if (current !== pinned.sha256) { replaced = true; await fsp.copyFile(pinned.file, bridgeTarget); }
    } else { replaced = true; await fsp.copyFile(pinned.file, bridgeTarget); }
    if (await sha256File(bridgeTarget) !== pinned.sha256) throw Error('GODOT_BRIDGE_MISMATCH');
    const existing = staged.find(artifact => artifact.path === 'web/bridge.js');
    const bridgeRecord = {path:'web/bridge.js', bytes:fs.statSync(bridgeTarget).size, sha256:pinned.sha256};
    if (existing) Object.assign(existing, bridgeRecord); else staged.push(bridgeRecord);
    staged.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    return {artifacts:staged, bridgeReplaced:replaced};
  }

  async function walkFiles(root, prefix = '') {
    const result = [];
    for (const entry of await fsp.readdir(path.join(root, prefix), {withFileTypes:true})) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) result.push(...await walkFiles(root, relative));
      else if (entry.isFile()) result.push(relative);
    }
    return result;
  }

  async function readTaskLog(receipt) {
    const logsRoot = receipt.logsRoot;
    if (typeof logsRoot !== 'string' || !logsRoot) return '';
    const file = path.join(logsRoot, 'task.log');
    try { return bounded(await fsp.readFile(file, 'utf8'), BROKER_TASK_LOG_BYTES); } catch { return ''; }
  }

  async function checkDescriptorFor(claim, artifacts, token) {
    try {
      const descriptor = await core.call('godotJob.checkDescriptor', {jobId:claim.jobId, token, artifacts}, 30000);
      if (descriptor && descriptor.format === CHECK_FORMAT) return {descriptor, source:'core'};
    } catch (error) {
      // The core interface is owned by task A. Until it lands, resolve the same
      // descriptor locally from the claim and the formal world; the verifier
      // still validates every staged byte against the recorded artifact list.
      if (!/UNSUPPORTED|UNKNOWN|NOT_FOUND/i.test(String(error?.message ?? error))) warn('checkDescriptor refused:', String(error?.message ?? error));
    }
    let snapshot = null;
    try {
      // `world.read` returns the summary fields at the top level and the world
      // document (build/snapshot/extensions) under `world`.
      const record = await core.call('world.read', {id:claim.worldId}, 30000);
      if (record?.world?.snapshot?.format === 'craftmine.godot-progress/1') snapshot = record.world.snapshot;
    } catch {}
    return {source:'executor', descriptor:{
      format:CHECK_FORMAT, phase:'check', jobId:claim.jobId, inputHash:claim.inputHash,
      worldId:claim.worldId, buildId:claim.buildId, baseId:claim.baseId,
      root:path.resolve(plainPath(claim.artifactsRoot)), entry:'web/index.html', threads:true,
      artifacts, snapshot,
    }};
  }

  function assertionsFrom(evidence) {
    const base = [
      {id:'runtime.ready', passed:evidence?.ready?.ok === true, detail:`ops=${(evidence?.ready?.ops ?? []).join(',')}`},
      {id:'runtime.frame', passed:evidence?.render?.ok === true, detail:`frames=${evidence?.render?.frames ?? 0} distinct=${evidence?.render?.distinctFrames ?? 0}`},
      {id:'runtime.no-errors', passed:evidence?.errors?.ok === true, detail:(evidence?.errors?.runtime ?? []).slice(0, 2).join(' | ').slice(0, 200) || null},
      {id:'runtime.snapshot', passed:evidence?.snapshot?.ok === true, detail:evidence?.snapshot?.equal === true ? 'formal progress unchanged' : 'snapshot not confirmed'},
      {id:'runtime.isolation', passed:evidence?.isolation?.ok === true, detail:`guard=${JSON.stringify(evidence?.isolation?.guard ?? null)}`},
      {id:'runtime.recovery', passed:evidence?.recovery?.ok === true, detail:`graceful=${evidence?.recovery?.gracefulExit === true}`},
    ];
    return base.map(assertion => assertion.detail ? assertion : {id:assertion.id, passed:assertion.passed});
  }

  /** Keep the live broker handle on the job so cancellation can reach it. */
  async function track(entry, handle) {
    entry.broker = handle;
    try { return await handle; } finally { if (entry.broker === handle) entry.broker = null; }
  }

  async function runJob(entry) {
    const {jobId, worldId, mode, token} = entry;
    let claim = null, heartbeat = null;
    try {
      claim = await core.call('godotJob.claim', {jobId, token, executorId:EXECUTOR_ID}, 30000);
      entry.claim = claim;
      entry.startedAt = clock();
      heartbeat = setInterval(() => {
        core.call('godotJob.heartbeat', {jobId, token}, 15000).catch(error => warn('heartbeat failed:', jobId, error.message));
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      await core.call('godotJob.progress', {jobId, token, stage:'import', percent:10}, 20000).catch(() => {});

      const files = claimedFiles(claim);
      if (!files.length) throw Error('GODOT_SOURCE_MISSING');
      const sourceBinding = {worldId:claim.worldId, buildId:claim.buildId, sourceRevision:claim.sourceRevision, sourceDigest:sourceSnapshotDigest(files)};
      const baseRequest = {
        binary:discovery.broker, tasksRoot, engineRoot:discovery.engineRoot,
        projectRoot:plainPath(claim.projectRoot), sourceBinding, inputHash:claim.inputHash,
      };

      const importRun = await track(entry, runBroker({...baseRequest, operation:'import', requestId:brokerTaskId('import'), timeoutMs:jobTimeoutMs,
        onCancel:reason => warn('import cancelled:', jobId, reason)}));
      if (entry.cancelled) return await abandon(entry, 'GODOT_JOB_CANCELLED');
      const importCheck = validateBrokerReceipt(importRun.response, {operation:'import', sourceBinding, inputHash:claim.inputHash,
        expectedFiles:files, requestId:importRun.requestId ?? entry.importRequestId, pinnedBrokerSha256:discovery.preflight?.brokerSha256});
      const importLog = await readTaskLog(importRun.response ?? {});
      const importClassified = classifyLog(importLog);
      const importPassed = importCheck.ok === true && importClassified.errors.length === 0;
      if (!importPassed) {
        return await finishJob(entry, {
          import:{passed:false, log:bounded(importLog, 8000)},
          compile:{passed:false, errors:(importClassified.errors.length ? importClassified.errors : [importCheck.reason ?? 'GODOT_IMPORT_FAILED']).slice(0, 16), warnings:importClassified.warnings.slice(0, 16)},
          check:{passed:false, assertions:[]}, artifacts:[], runtime:null,
          reason:importCheck.reason ?? 'GODOT_COMPILE_FAILED',
        });
      }
      await core.call('godotJob.progress', {jobId, token, stage:'export', percent:45}, 20000).catch(() => {});

      let artifacts = [], bridgeReplaced = false, runtime = null, descriptorSource = null, exportLog = '';
      if (mode === 'check') {
        const exportRun = await track(entry, runBroker({...baseRequest, operation:'exportWeb', requestId:brokerTaskId('exportWeb'), timeoutMs:jobTimeoutMs,
          onCancel:reason => warn('export cancelled:', jobId, reason)}));
        if (entry.cancelled) return await abandon(entry, 'GODOT_JOB_CANCELLED');
        const exportCheck = validateBrokerReceipt(exportRun.response, {operation:'exportWeb', sourceBinding, inputHash:claim.inputHash,
          expectedFiles:files, requestId:exportRun.requestId ?? entry.exportRequestId, pinnedBrokerSha256:discovery.preflight?.brokerSha256});
        exportLog = await readTaskLog(exportRun.response ?? {});
        if (!exportCheck.ok) {
          return await finishJob(entry, {
            import:{passed:true, log:bounded(importLog, 8000)},
            compile:{passed:true, errors:[], warnings:importClassified.warnings.slice(0, 16)},
            check:{passed:false, assertions:[]}, artifacts:[], runtime:null, reason:exportCheck.reason ?? 'GODOT_EXPORT_FAILED',
          });
        }
        const exportClassified = classifyLog(exportLog);
        if (exportClassified.errors.length) {
          return await finishJob(entry, {
            import:{passed:true, log:bounded(importLog, 8000)},
            compile:{passed:false, errors:exportClassified.errors.slice(0, 16), warnings:exportClassified.warnings.slice(0, 16)},
            check:{passed:false, assertions:[]}, artifacts:[], runtime:null, reason:'GODOT_COMPILE_FAILED',
          });
        }
        await core.call('godotJob.progress', {jobId, token, stage:'stage-artifacts', percent:70}, 20000).catch(() => {});
        const staged = await stageArtifacts(exportRun.response, claim.artifactsRoot, discovery.bridge);
        artifacts = staged.artifacts;
        bridgeReplaced = staged.bridgeReplaced;
        log('staged', artifacts.length, 'artifacts into', path.resolve(claim.artifactsRoot));
        await core.call('godotJob.progress', {jobId, token, stage:'check', percent:85}, 20000).catch(() => {});
        const resolved = await checkDescriptorFor(claim, artifacts, token);
        descriptorSource = resolved.source;
        if (entry.cancelled) return await abandon(entry, 'GODOT_JOB_CANCELLED');
        if (!verifier?.godotCheck) {
          // No isolated verifier means the runtime behaviour was not observed.
          // The import/export evidence is kept, but the check cannot pass.
          runtime = {format:'craftmine.godot-runtime-check/1', scope:'base-startup', passed:false,
            error:'GODOT_VERIFIER_UNAVAILABLE', ready:{ok:false}, render:{ok:false}, errors:{ok:false},
            snapshot:{ok:false}, isolation:{ok:false}, recovery:{ok:false}};
        } else {
          runtime = await verifier.godotCheck(resolved.descriptor);
        }
      } else {
        artifacts = [];
      }
      const checkPassed = mode === 'check' ? runtime?.passed === true : true;
      const assertions = mode === 'check' ? assertionsFrom(runtime) : [];
      return await finishJob(entry, {
        import:{passed:true, log:bounded(importLog, 8000)},
        compile:{passed:true, errors:[], warnings:importClassified.warnings.slice(0, 16)},
        check:{passed:checkPassed, assertions}, artifacts, runtime,
        reason:checkPassed ? null : (runtime?.error ?? 'GODOT_RUNTIME_CHECK_FAILED'),
        descriptorSource, bridgeReplaced, exportLog:bounded(exportLog, 4000),
      });
    } catch (error) {
      const reason = String(error?.message ?? error);
      if (entry.cancelled) return await abandon(entry, 'GODOT_JOB_CANCELLED');
      return await finishJob(entry, {
        import:{passed:false, log:''}, compile:{passed:false, errors:[reason.slice(0, 300)], warnings:[]},
        check:{passed:false, assertions:[]}, artifacts:[], runtime:null, reason,
      });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      jobs.delete(jobId);
    }
  }

  async function finishJob(entry, result) {
    const {jobId, token} = entry;
    const output = {
      format:RESULT_FORMAT,
      inputHash:entry.claim?.inputHash,
      passed:result.import.passed && result.compile.passed && result.check.passed && result.compile.errors.length === 0
        && result.check.assertions.every(assertion => assertion.passed === true),
      import:result.import,
      compile:result.compile,
      check:result.check,
      artifacts:result.artifacts,
      engine:{version:ENGINE_VERSION, isolation:ISOLATION, evidenceHash:discovery.evidenceHash},
    };
    try {
      const record = await core.call('godotJob.finish', {jobId, token, output}, 30000);
      log('job finished', jobId, record?.status, result.reason ? 'reason=' + result.reason : '');
      return {status:record?.status ?? 'unknown', candidateId:record?.candidateId ?? null, reason:result.reason ?? null};
    } catch (error) {
      warn('finish refused:', jobId, String(error?.message ?? error), result.reason ?? '');
      return {status:'refused', candidateId:null, reason:String(error?.message ?? error)};
    }
  }

  async function abandon(entry, reason) {
    warn('job abandoned:', entry.jobId, reason);
    try { await core.call('godotBuild.cancel', {worldId:entry.worldId, jobId:entry.jobId}, 20000); } catch {}
    return {status:'cancelled', candidateId:null, reason};
  }

  function enqueue(job, context = {}) {
    if (stopped || !registered) return {enqueued:false, reason:discovery.reason ?? 'GODOT_EXECUTOR_UNAVAILABLE'};
    const jobId = typeof job === 'string' ? job : job?.jobId;
    if (typeof jobId !== 'string' || !/^gjob-[0-9a-f]{64}$/.test(jobId)) return {enqueued:false, reason:'INVALID_GODOT_JOB'};
    if (jobs.has(jobId)) return {enqueued:false, reason:'GODOT_JOB_ALREADY_ENQUEUED'};
    if (jobs.size >= MAX_JOBS) return {enqueued:false, reason:'GODOT_EXECUTOR_BUSY'};
    const entry = {jobId, worldId:job?.worldId ?? null, mode:job?.mode ?? job?.kind ?? 'build', token:randomUUID(), context, cancelled:false};
    jobs.set(jobId, entry);
    entry.promise = new Promise(resolve => setImmediate(resolve))
      .then(() => waitForQueued(entry))
      .then(queued => queued ? runJob(entry) : (jobs.delete(jobId), {status:'blocked', candidateId:null, reason:'GODOT_EXECUTION_UNAVAILABLE'}))
      .catch(error => { jobs.delete(jobId); warn('job worker failed:', jobId, error.message); return {status:'failed', candidateId:null, reason:error.message}; });
    return {enqueued:true, jobId};
  }

  async function waitForQueued(entry) {
    const deadline = clock() + BLOCKED_RETRY_MS;
    for (;;) {
      if (entry.cancelled || stopped) return false;
      try {
        const job = await core.call('godotBuild.read', {worldId:entry.worldId, jobId:entry.jobId}, 20000);
        if (job?.status === 'queued') return true;
        if (job && job.status !== 'blocked') return false;
        if (job?.worldId) entry.worldId = job.worldId;
      } catch (error) {
        if (!/GODOT|WORLD/.test(String(error?.message ?? ''))) warn('queue wait failed:', entry.jobId, error.message);
        return false;
      }
      if (clock() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async function cancel(jobId, reason = 'cancelled') {
    const entry = jobs.get(jobId);
    if (!entry) return {cancelled:false};
    entry.cancelled = true;
    entry.broker?.cancel?.(reason);
    return {cancelled:true};
  }

  async function cancelTurn(context) {
    const selected = [...jobs.values()].filter(entry => entry.context?.sessionId === context?.sessionId && entry.context?.turnId === context?.turnId);
    await Promise.all(selected.map(entry => cancel(entry.jobId, 'turn ended')));
    return {cancelled:selected.length};
  }

  async function cancelOtherTurns(context) {
    const selected = [...jobs.values()].filter(entry => entry.context?.sessionId === context?.sessionId && entry.context?.turnId !== context?.turnId);
    await Promise.all(selected.map(entry => cancel(entry.jobId, 'superseded turn')));
    return {cancelled:selected.length};
  }

  async function reconcile() {
    if (!registered || stopped) return {enqueued:0};
    try {
      const pending = await core.call('godotJob.pending', {}, 20000);
      let enqueued = 0;
      for (const job of pending?.items ?? []) {
        if (job.status !== 'queued') continue;
        if (enqueue(job, {}).enqueued) enqueued++;
      }
      return {enqueued};
    } catch (error) {
      // `godotJob.pending` is an optional core interface; its absence is not a failure.
      if (!/UNSUPPORTED|UNKNOWN|NOT_FOUND/i.test(String(error?.message ?? ''))) warn('reconcile failed:', error.message);
      return {enqueued:0, unsupported:true};
    }
  }

  // ---------------------------------------------------------------- lifecycle

  async function start() {
    if (starting) return starting;
    starting = (async () => {
      stopped = false;
      let verified;
      try { verified = await verifyToolchain(); }
      catch (error) {
        Object.assign(discovery, {state:'unavailable', reason:'GODOT_EXECUTOR_DISCOVERY_FAILED', detail:String(error?.message ?? error)});
        warn('discovery failed:', String(error?.message ?? error));
        return status();
      }
      if (!verified.ok) {
        Object.assign(discovery, {state:'unavailable', reason:verified.reason, broker:null, engineRoot:null, lock:null, evidenceHash:null, preflight:null});
        warn('executor unavailable:', verified.reason);
        return status();
      }
      Object.assign(discovery, {state:'discovered', reason:null, broker:verified.broker, engineRoot:verified.engineRoot,
        lock:verified.lock ? path.basename(verified.lock.path) : null, measured:verified.measured, bridge:verified.bridge});
      tasksRoot = path.join(dataPath ?? path.dirname(verified.broker), 'godot', 'tasks');
      await fsp.mkdir(tasksRoot, {recursive:true});
      if (!ordinaryDirectory(tasksRoot)) {
        Object.assign(discovery, {state:'unavailable', reason:'GODOT_STORAGE_UNAVAILABLE'});
        return status();
      }
      const preflightResult = await preflight(verified);
      if (!preflightResult.ok) {
        Object.assign(discovery, {state:'unavailable', reason:preflightResult.reason, detail:preflightResult.detail ?? null, preflight:preflightResult.receipt ?? null});
        warn('preflight failed:', preflightResult.reason);
        return status();
      }
      discovery.preflight = preflightResult.receipt;
      discovery.evidenceHash = evidenceOf(verified, preflightResult);
      try {
        const registration = await core.call('godotExecutor.register', {executorId:EXECUTOR_ID, attestation:{
          format:ATTESTATION_FORMAT, isolation:ISOLATION, evidenceHash:discovery.evidenceHash,
          engineVersion:ENGINE_VERSION, capabilities:{import:true, build:true, check:true},
        }}, 30000);
        registered = registration?.registered === true;
        discovery.state = registered ? 'registered' : 'unavailable';
        discovery.reason = registered ? null : 'GODOT_REGISTRATION_REFUSED';
        discovery.attestationHash = registration?.attestationHash ?? null;
        discovery.promotedJobs = registration?.promotedJobs ?? 0;
        log('registered', EXECUTOR_ID, 'evidence', discovery.evidenceHash.slice(0, 16), 'promoted', discovery.promotedJobs);
      } catch (error) {
        registered = false;
        discovery.state = 'unavailable';
        discovery.reason = 'GODOT_REGISTRATION_REFUSED';
        warn('registration refused:', String(error?.message ?? error));
        return status();
      }
      await reconcile();
      return status();
    })().finally(() => { starting = null; });
    return starting;
  }

  async function stop() {
    stopped = true;
    await Promise.all([...jobs.keys()].map(jobId => cancel(jobId, 'executor stopping')));
    await Promise.all([...jobs.values()].map(entry => entry.promise));
    let revoked = false;
    if (registered) {
      try { const result = await core.call('godotExecutor.revoke', {executorId:EXECUTOR_ID}, 20000); revoked = result?.revoked === true; }
      catch (error) {
        // Without `godotExecutor.revoke` the core keeps a stale registration for
        // this process; jobs can no longer be claimed, but the capability flag
        // stays until the core restarts. Reported, never hidden.
        if (!/UNSUPPORTED|UNKNOWN|NOT_FOUND/i.test(String(error?.message ?? ''))) warn('revoke failed:', error.message);
      }
    }
    registered = false;
    discovery.state = 'stopped';
    return {revoked};
  }

  function status() {
    return {
      format:'craftmine.godot-executor-status/1',
      executorId:EXECUTOR_ID,
      engineVersion:ENGINE_VERSION,
      isolation:ISOLATION,
      state:discovery.state,
      available:registered,
      buildAvailable:registered,
      checkAvailable:registered && !!verifier?.godotCheck,
      reason:discovery.reason,
      broker:discovery.broker ? {sha256:discovery.preflight?.brokerSha256 ?? null} : null,
      engineRoot:discovery.engineRoot,
      lock:discovery.lock,
      evidenceHash:discovery.evidenceHash,
      bridge:{sha256:discovery.measured?.bridgeSha256 ?? null},
      preflight:discovery.preflight ? {
        policyVersion:discovery.preflight.policyVersion,
        processVerified:discovery.preflight.processVerification?.verified === true,
        networkVerified:discovery.preflight.networkPreflight?.verified === true,
        cleanupVerified:discovery.preflight.cleanup?.verified === true,
        networkChecks:(discovery.preflight.networkPreflight?.observation?.checks ?? []).map(check => ({name:check.name, ok:check.ok === true, rawOsError:check.rawOsError ?? null})),
      } : null,
      jobs:[...jobs.keys()],
      registered,
      revokedOnStop:null,
    };
  }

  return {start, stop, status, enqueue, cancel, cancelTurn, cancelOtherTurns, reconcile,
    get executorId() { return EXECUTOR_ID; }, get registered() { return registered; }};
}

module.exports = {createGodotExecutor, classifyLog, sourceSnapshotDigest, safeRelative, EXECUTOR_ID, ISOLATION, ENGINE_VERSION, NATIVE_ISOLATION_DIAGNOSTICS};
