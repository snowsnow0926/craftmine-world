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
const {spawn, execFile} = require('node:child_process');
const {createHash, randomUUID} = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {isDeepStrictEqual} = require('node:util');

const execFileAsync = (file, args, options = {}) => new Promise(resolve => {
  const settle = (error, stdout, stderr) => resolve({
    error:error ?? null,
    // `execFile` reports a non-zero exit as an error, so the real status is
    // exposed separately: the recovery CLI exits 1 for a partial pass that is
    // still a valid report.
    exitCode:typeof error?.code === 'number' ? error.code : 0,
    stdout:String(stdout ?? ''),
    stderr:String(stderr ?? ''),
  });
  try {
    execFile(file, args, {
      windowsHide:true,
      timeout:options.timeoutMs ?? 20000,
      maxBuffer:options.maxBufferBytes ?? 1024 * 1024,
    }, settle);
  } catch (error) {
    // A synchronous spawn failure (invalid or non-executable path) must not
    // reject: recovery is best-effort cleanup, and the caller reports it.
    settle(error, '', '');
  }
});

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
// Host-owned recovery pass (BROKER_PROTOCOL_V1.md "Recovery journal"). The
// broker only ever reclaims a task whose recorded identity it can still prove,
// so this replaces the older pid + image-name cleanup path entirely.
const RECOVERY_POLICY_VERSION = 'craftmine.windows.recovery-journal.v1';
const RECOVER_TIMEOUT_MS = 120000;
const RECOVER_REPORT_BYTES = 8 * 1024 * 1024;
const LEDGER_FORMAT = 'craftmine.godot-executor-ledger/1';
const BROKER_IDENTITY_FORMAT = 'craftmine.godot-broker-identity/1';
// A broker profile name is `craftmine.godot.task.<taskId>` and Windows refuses
// a profile name longer than 64 characters, so the generated id is bounded.
const BROKER_PROFILE_PREFIX = 'craftmine.godot.task.';
const BROKER_TASK_ID_MAX = 64 - BROKER_PROFILE_PREFIX.length;

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

/**
 * Reduce a broker recovery report to the facts a consumer may act on. A
 * reclaimed task means "no final receipt arrived and the recorded identity was
 * re-proved", never "the build succeeded".
 */
function summarizeRecovery(report, meta = {}) {
  const entries = Array.isArray(report?.entries) ? report.entries : [];
  const reconciled = entry => entry?.identityVerified === true && entry?.journalRemoved === true;
  const reclaimed = entries.filter(reconciled).map(entry => ({
    taskId:entry.taskId, operation:entry.operation, childProcessState:entry.childProcessState ?? null,
    childPid:entry.childPid ?? null, taskRootRemoved:entry.taskRootRemoved === true,
    profileDeleted:entry.profileDeleted === true, reclaimed:Array.isArray(entry.reclaimed) ? entry.reclaimed : [],
    finalReceiptObserved:entry.finalReceiptObserved === true,
  }));
  const skipped = entries.filter(entry => !reconciled(entry)).map(entry => ({
    taskId:entry.taskId, operation:entry.operation, brokerStillRunning:entry.brokerStillRunning ?? null,
    reasons:Array.isArray(entry.skipped) ? entry.skipped : [],
  }));
  const unreadable = (Array.isArray(report?.unreadable) ? report.unreadable : [])
    .map(entry => ({file:entry?.file ?? null, error:entry?.error ?? null}));
  return {
    format:'craftmine.godot-recovery-summary/1',
    trigger:meta.trigger ?? null,
    ok:!!report && report.policyVersion === RECOVERY_POLICY_VERSION && typeof report.tasksRoot === 'string',
    policyVersion:report?.policyVersion ?? null,
    // The broker canonicalizes on Windows, so its report can carry a Win32
    // verbatim prefix; normalize it like every other host-owned root.
    tasksRoot:typeof report?.tasksRoot === 'string' ? plainPath(report.tasksRoot) : null,
    journalRoot:typeof report?.journalRoot === 'string' ? plainPath(report.journalRoot) : null,
    exitCode:meta.exitCode ?? null,
    parseError:meta.parseError ?? null,
    timedOut:meta.timedOut === true,
    stderr:typeof meta.stderr === 'string' ? meta.stderr.slice(0, 400) : null,
    reconciledCount:reclaimed.length,
    skippedCount:skipped.length,
    // The broker's own counts are kept for comparison; a mismatch means a report
    // and its entries disagree, which is surfaced rather than hidden.
    reportedReconciledCount:typeof report?.reconciledCount === 'number' ? report.reconciledCount : null,
    reportedSkippedCount:typeof report?.skippedCount === 'number' ? report.skippedCount : null,
    reclaimed, skipped, unreadable,
    // A report that claims a final receipt would contradict the protocol;
    // surface it instead of silently trusting it.
    finalReceiptClaimed:entries.some(entry => entry?.finalReceiptObserved === true),
  };
}

/**
 * Run the broker's own `recover <tasksRoot>` CLI once and reduce its report.
 * A non-zero exit is a valid partial pass, so only the payload decides.
 */
async function runRecoveryPass({broker, tasksRoot, run, trigger = null, timeoutMs = RECOVER_TIMEOUT_MS}) {
  const runner = run ?? ((binary, args, settings) => execFileAsync(binary, args, settings));
  const result = await runner(broker, ['recover', tasksRoot], {timeoutMs, maxBufferBytes:RECOVER_REPORT_BYTES});
  let report = null, parseError = null;
  const text = String(result?.stdout ?? '').trim();
  if (text) {
    // The CLI prints the report on stdout; a preparation failure prints a short
    // `{schemaVersion,state,error}` object instead.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    try { report = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text); }
    catch (error) { parseError = error.message; }
  }
  return summarizeRecovery(report, {trigger, exitCode:result?.exitCode ?? null, parseError,
    stderr:result?.stderr, timedOut:result?.error?.killed === true});
}

function createGodotExecutor(core, options = {}) {
  const dataPath = options.dataPath;
  const verifier = options.verifier ?? null;
  const logger = options.logger ?? console;
  // Test seam only: the product always spawns the pinned broker binary. The
  // protocol tests inject a scripted broker so framing, digests, cancellation
  // and tampered receipts can be exercised deterministically.
  const spawnBroker = options.spawnBroker ?? ((binary, args, settings) => spawn(binary, args, settings));
  // Test seam only: the product always runs the pinned broker's own `recover`
  // CLI, which re-proves task identity before it reclaims anything.
  const runRecovery = options.runRecovery ?? ((binary, args, settings) => execFileAsync(binary, args, settings));
  const clock = options.now ?? (() => Date.now());
  const jobTimeoutMs = options.jobTimeoutMs ?? JOB_TIMEOUT_MS;
  const jobs = new Map();
  const discovery = {state:'idle', reason:null, broker:null, engineRoot:null, lock:null, evidenceHash:null, preflight:null};
  let tasksRoot = null;
  let stopped = false;
  let registered = false;
  let starting = null;
  let stopping = null;
  let lifecycleGeneration = 0;

  const log = (...args) => { try { logger.log('[godot-executor]', ...args); } catch {} };
  const warn = (...args) => { try { logger.warn('[godot-executor]', ...args); } catch {} };

  // ---------------------------------------------------------------- discovery

  // An explicit configuration is authoritative: a broken configured path is
  // reported as missing instead of silently falling back to a development copy.
  function configured(name) {
    const keys = {CRAFTMINE_GODOT_BROKER_BIN:'broker', CRAFTMINE_GODOT_BROKER_IDENTITY:'brokerIdentity',
      CRAFTMINE_GODOT_ENGINE_ROOT:'engineRoot', CRAFTMINE_GODOT_TOOLCHAIN_LOCK:'toolchainLock',
      CRAFTMINE_GODOT_BRIDGE_PATH:'bridgePath'};
    // Product configuration arrives only through the private host service. Once
    // supplied, absence must not fall back to the child process environment.
    const value = options.toolchain !== undefined ? options.toolchain?.[keys[name]] : process.env[name];
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
    const explicit = configured('CRAFTMINE_GODOT_TOOLCHAIN_LOCK');
    const candidates = explicit ? [explicit] : [
      path.resolve(__dirname, '..', '..', 'desktop', 'godot', 'toolchain.lock.json')];
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

  /**
   * Only the host-selected release manifest establishes a pin. An executable
   * found in writable data cannot nominate its own adjacent identity file.
   */
  function brokerIdentity(broker) {
    const configuredIdentity = configured('CRAFTMINE_GODOT_BROKER_IDENTITY');
    const candidates = configuredIdentity ? [configuredIdentity] : [];
    for (const candidate of candidates) {
      try {
        const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (value?.format === BROKER_IDENTITY_FORMAT && /^[a-f0-9]{64}$/i.test(value.sha256)
          && Number.isSafeInteger(value.bytes) && value.bytes > 0) return {...value, source:candidate};
      } catch { /* the next candidate is tried; absence is reported, never assumed */ }
    }
    return null;
  }

  function pinnedBroker(broker) {
    const explicit = options.toolchain === undefined ? process.env.CRAFTMINE_GODOT_BROKER_SHA256 : null;
    if (explicit) return {sha256:String(explicit).toLowerCase(), source:'CRAFTMINE_GODOT_BROKER_SHA256', identity:null};
    const identity = brokerIdentity(broker);
    if (identity) return {sha256:String(identity.sha256).toLowerCase(), source:identity.source, identity};
    return null;
  }

  async function verifyToolchain() {
    const broker = candidateBroker();
    if (!broker || !fs.existsSync(broker)) return {ok:false, reason:'GODOT_BROKER_MISSING'};
    const pin = pinnedBroker(broker);
    if (!pin || !/^[a-f0-9]{64}$/.test(pin.sha256)) return {ok:false, reason:'GODOT_BROKER_PIN_REQUIRED'};
    const brokerSha256 = await sha256File(broker);
    if (pin.sha256 !== brokerSha256 || (pin.identity && pin.identity.bytes !== fs.statSync(broker).size))
      return {ok:false, reason:'GODOT_BROKER_MISMATCH'};
    const engineRoot = candidateEngineRoot();
    if (!engineRoot || !ordinaryDirectory(engineRoot)) return {ok:false, reason:'GODOT_ENGINE_MISSING'};
    const lock = toolchainLock();
    if (!lock) return {ok:false, reason:'GODOT_TOOLCHAIN_LOCK_REQUIRED'};
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
    return {ok:true, broker, brokerSha256, engineRoot, lock, measured, bridge:{file:bridge, sha256:measured.bridgeSha256},
      brokerPin:pin ? {sha256:pin.sha256, source:pin.source, identity:pin.identity ? {
        sourceCommit:pin.identity.sourceCommit ?? null, profile:pin.identity.profile ?? null,
        protocolVersion:pin.identity.protocolVersion ?? null} : null} : null};
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
      measuredBrokerSha256:verified.brokerSha256,
      pinnedBrokerSha256:verified.brokerSha256,
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
   * Host-owned recovery pass. `godot-host-broker.exe recover <tasksRoot>` is the
   * only component allowed to reclaim a task whose broker died without a final
   * response: it re-proves the tasks root, identity nonce, AppContainer SID and
   * the child pid + creation FILETIME before deleting anything, and it refuses
   * a task whose owning broker is still alive. A task counts as reclaimed only
   * when `identityVerified` and `journalRemoved` are both true, and a recovery
   * pass never means the build succeeded: every entry carries
   * `finalReceiptObserved:false` by construction.
   *
   * The pass is single-flight, so concurrent triggers (startup, abnormal exit,
   * cancel, restart reconciliation) never race on the same journal directory.
   */
  let recoveryChain = Promise.resolve();

  function recoverTasks(trigger) {
    const run = () => recoverTasksOnce(trigger);
    recoveryChain = recoveryChain.then(run, run);
    return recoveryChain;
  }

  async function recoverTasksOnce(trigger) {
    if (!tasksRoot || !discovery.broker) {
      return {format:'craftmine.godot-recovery-summary/1', trigger, ok:false, reason:'GODOT_RECOVERY_UNAVAILABLE',
        policyVersion:RECOVERY_POLICY_VERSION, tasksRoot:tasksRoot ?? null, journalRoot:null,
        reconciledCount:0, skippedCount:0, reclaimed:[], skipped:[], unreadable:[], finalReceiptClaimed:false};
    }
    const summary = await runRecoveryPass({broker:discovery.broker, tasksRoot, run:runRecovery, trigger}).catch(error => ({
      format:'craftmine.godot-recovery-summary/1', trigger, ok:false, reason:'GODOT_RECOVERY_FAILED',
      error:String(error?.message ?? error), policyVersion:RECOVERY_POLICY_VERSION, tasksRoot, journalRoot:null,
      reconciledCount:0, skippedCount:0, reclaimed:[], skipped:[], unreadable:[], finalReceiptClaimed:false,
    }));
    discovery.recoveries = [...(discovery.recoveries ?? []), summary].slice(-8);
    if (summary.reclaimed.length) warn('recovered tasks without a final receipt:', trigger, summary.reclaimed.map(entry => entry.taskId).join(','));
    if (summary.skipped.length || summary.unreadable.length) {
      log('recovery pass kept', summary.skipped.length, 'task(s) and', summary.unreadable.length, 'unreadable entry(ies):', trigger);
    }
    return summary;
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
    child.on('error', error => {
      // A failed kill or transport error can leave a live broker holding a task
      // root, so this path recovers like any other non-clean ending.
      const failed = recovery => finish({ok:false, reason:'GODOT_BROKER_SPAWN_FAILED', error:error.message,
        requestId:request.requestId, stdout, stderr, journalRetired:false, recovery});
      recoverTasks('broker-error').then(failed, () => failed(null));
    });
    child.on('exit', (code, signal) => {
      let response = null, parseError = null;
      const line = stdout.trim();
      if (line) { try { response = JSON.parse(line); } catch (error) { parseError = error.message; } }
      // A run is clean when it reported success and proved its own cleanup. A
      // journal entry that was not retired is still recovered below, but it does
      // not turn a valid build into a failure.
      const cleanSuccess = response?.state === 'succeeded' && !cancelled && !timedOut
        && response?.cleanup?.verified === true;
      const journalRetired = response?.recoveryJournal?.cleared === true;
      const settle = recovery => finish({ok:true, requestId:request.requestId, exitCode:code, signal, response, parseError,
        stdout:bounded(stdout, 8192), stderr, cancelled, timedOut, oversized, journalRetired, recovery});
      // Any other ending may have left a task root, an AppContainer profile or a
      // surviving child. The host-owned recovery pass re-proves the recorded
      // identity before it reclaims anything; it is the only cleanup path.
      if (cleanSuccess && journalRetired) settle(null);
      else recoverTasks('broker-exit').then(settle, error => { warn('recovery pass failed:', String(error?.message ?? error)); settle(null); });
    });
    const timer = setTimeout(() => { timedOut = true; cancel('timeout'); }, Math.max(1000, request.timeoutMs ?? JOB_TIMEOUT_MS));

    function cancel(reason) {
      if (cancelled) return;
      cancelled = true;
      try { child.stdin.write('{"cancel":true}\n'); } catch {}
      const grace = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, CANCEL_GRACE_MS);
      grace.unref?.();
      // A broker that ignores the cancel frame and survives SIGKILL must not
      // leave the job hanging forever; the recovery pass decides cleanup.
      const hard = setTimeout(() => finish({ok:false, reason:'GODOT_BROKER_UNRESPONSIVE',
        requestId:request.requestId, stdout:bounded(stdout, 8192), stderr, cancelled, timedOut, oversized,
        journalRetired:false, recovery:null}), CANCEL_GRACE_MS + 5000);
      hard.unref?.();
      child.once('exit', () => { clearTimeout(grace); clearTimeout(hard); });
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
    const importCrash = expected.allowNativeImportCrash === true && expected.operation === 'import'
      && response.state === 'failed' && response.exitCode === 0xc0000005
      && response.error === 'exit exit=0xc0000005 job_active_processes=Some(0)';
    if (response.state !== 'succeeded' && !importCrash) return fail('GODOT_BROKER_TASK_FAILED');
    if (response.policyVersion !== ISOLATION) return fail('GODOT_BROKER_POLICY_MISMATCH');
    if (response.processVerification?.verified !== true) return fail('GODOT_BROKER_PROCESS_UNVERIFIED');
    if (response.networkPreflight?.verified !== true) return fail('GODOT_BROKER_NETWORK_UNVERIFIED');
    if (response.cleanup?.verified !== true) return fail('GODOT_BROKER_CLEANUP_UNVERIFIED');
    // A breached sampled budget is a real failure, never a warning.
    if (response.resourceEnforcement?.enforced === true) return fail('GODOT_RESOURCE_BUDGET_EXCEEDED');
    // The receipt's own hash is a self-measurement, not authorization: it is
    // compared with the pin the host verified against the launched file.
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
    return {ok:!importCrash, retryableNativeImportCrash:importCrash, receipt:response, files};
  }

  async function importCrashRetry(entry, run, expected) {
    const response=run.response, previous=ledgerEntry(entry.jobId);
    if (previous.importCrashRetries || entry.cancelled || stopped || run.ok!==true || run.exitCode!==0 || run.signal
      || run.parseError || run.cancelled || run.timedOut || run.oversized) return null;
    if (!validateBrokerReceipt(response,{...expected,allowNativeImportCrash:true}).retryableNativeImportCrash) return null;
    if (!expected.pinnedBrokerSha256 || expected.measuredBrokerSha256!==expected.pinnedBrokerSha256
      || response.cleanup?.profileHresult!==0 || response.cleanup?.workRemoved!==true || response.cleanup?.error!==null
      || response.recoveryJournal?.cleared!==true || response.recoveryJournal?.error!==null
      || response.resourceEnforcement?.enforced!==false || response.resourceEnforcement?.reason!==null
      || !(response.resourceEnforcement?.samples>0)
      || !run.recovery?.ok || run.recovery.parseError || run.recovery.finalReceiptClaimed
      || run.recovery.skipped?.length!==0 || run.recovery.unreadable?.length!==0) return null;
    const logs=path.resolve(tasksRoot,expected.requestId,'logs');
    if (path.resolve(plainPath(response.logsRoot??''))!==logs || !ordinaryDirectory(logs)) return null;
    const record=response.logs?.length===1?response.logs[0]:null;
    if (record?.path!=='task.log' || !Number.isSafeInteger(record.bytes) || record.bytes<1 || record.bytes>BROKER_TASK_LOG_BYTES) return null;
    try {
      const file=path.join(logs,'task.log'),info=await fsp.lstat(file);
      if(!info.isFile()||info.isSymbolicLink()||info.size!==record.bytes)return null;
      const bytes=await fsp.readFile(file);
      if(bytes.length!==record.bytes||sha256(bytes)!==record.sha256||classifyLog(bytes.toString('utf8')).errors.length)return null;
      previous.importCrashRetries=1;
      recordAttempt(entry.jobId,{requestId:expected.requestId,retryDecision:{reason:'VERIFIED_NATIVE_IMPORT_CRASH',
        logSha256:record.sha256,sourceDigest:response.sourceSnapshotDigest,brokerSha256:response.brokerSha256}});
      await ledgerWrite;
      if(ledgerError)return null;
      return record.sha256;
    } catch { return null; }
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
    const required = claim.checkRequirements !== undefined || claim.checkRequirementsHash !== undefined;
    try {
      const descriptor = await core.call('godotJob.checkDescriptor', {jobId:claim.jobId, token, artifacts}, 30000);
      if (descriptor && descriptor.format === CHECK_FORMAT) {
        if (required && (!claim.checkRequirements || !claim.checkRequirementsHash
            || !isDeepStrictEqual(descriptor.checkRequirements, claim.checkRequirements)
            || descriptor.checkRequirementsHash !== claim.checkRequirementsHash
            || descriptor.jobId !== claim.jobId || descriptor.worldId !== claim.worldId
            || descriptor.buildId !== claim.buildId || descriptor.inputHash !== claim.inputHash)) {
          throw Error('GODOT_CHECK_REQUIREMENTS_DESCRIPTOR_MISMATCH');
        }
        return {descriptor, source:'core'};
      }
      if (required) throw Error('GODOT_CHECK_REQUIREMENTS_DESCRIPTOR_REQUIRED');
    } catch (error) {
      if (required) throw error;
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

  function assertionsFrom(evidence, claim) {
    const base = [
      {id:'runtime.ready', passed:evidence?.ready?.ok === true, detail:`ops=${(evidence?.ready?.ops ?? []).join(',')}`},
      {id:'runtime.frame', passed:evidence?.render?.ok === true, detail:`frames=${evidence?.render?.frames ?? 0} distinct=${evidence?.render?.distinctFrames ?? 0}`},
      {id:'runtime.no-errors', passed:evidence?.errors?.ok === true, detail:(evidence?.errors?.runtime ?? []).slice(0, 2).join(' | ').slice(0, 200) || null},
      {id:'runtime.snapshot', passed:evidence?.snapshot?.ok === true, detail:evidence?.snapshot?.equal === true ? (evidence?.progressMigration?.added?.length ? 'existing progress preserved; new scene defaults verified' : 'formal progress unchanged') : 'snapshot not confirmed'},
      {id:'runtime.isolation', passed:evidence?.isolation?.ok === true, detail:`guard=${JSON.stringify(evidence?.isolation?.guard ?? null)}`},
      {id:'runtime.recovery', passed:evidence?.recovery?.ok === true, detail:`graceful=${evidence?.recovery?.gracefulExit === true}`},
    ];
    if (claim?.checkRequirements !== undefined || claim?.checkRequirementsHash !== undefined) {
      const actual = (Array.isArray(evidence?.assertions) ? evidence.assertions : []).filter(item => item?.id === 'runtime.target-feedback');
      base.push({id:'runtime.target-feedback', passed:actual.length === 1 && actual[0].passed === true
        && evidence?.requirementsEvidence?.requirementsHash === claim.checkRequirementsHash,
        detail:actual.length === 1 && typeof actual[0].detail === 'string' ? actual[0].detail.slice(0, 300) : 'runtime expectation evidence required'});
    }
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
      const durable = ledgerEntry(jobId);
      durable.worldId = claim.worldId ?? worldId;
      durable.mode = claim.kind ?? mode;
      durable.state = 'running';
      durable.startedAt = nowIso();
      durable.reason = null;
      persistLedger();
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

      let importRun = await trackedBrokerRun(entry, {...baseRequest, operation:'import', requestId:brokerTaskId('import'), timeoutMs:jobTimeoutMs,
        onCancel:reason => warn('import cancelled:', jobId, reason)});
      if (entry.cancelled) return await abandon(entry, 'GODOT_JOB_CANCELLED');
      if (mode==='check' && await importCrashRetry(entry,importRun,{operation:'import',sourceBinding,inputHash:claim.inputHash,
        expectedFiles:files,requestId:importRun.requestId,measuredBrokerSha256:discovery.measuredBrokerSha256,pinnedBrokerSha256:discovery.brokerPin?.sha256??null})) {
        warn('retrying one verified native import crash:',jobId,importRun.requestId);
        importRun=await trackedBrokerRun(entry,{...baseRequest,operation:'import',requestId:brokerTaskId('import'),timeoutMs:jobTimeoutMs,
          onCancel:reason=>warn('import retry cancelled:',jobId,reason)});
        if(entry.cancelled)return await abandon(entry,'GODOT_JOB_CANCELLED');
      }
      const importCheck = validateBrokerReceipt(importRun.response, {operation:'import', sourceBinding, inputHash:claim.inputHash,
        expectedFiles:files, requestId:importRun.requestId ?? entry.importRequestId,
        measuredBrokerSha256:discovery.measuredBrokerSha256, pinnedBrokerSha256:discovery.brokerPin?.sha256 ?? null});
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
        const exportRun = await trackedBrokerRun(entry, {...baseRequest, operation:'exportWeb', requestId:brokerTaskId('exportWeb'), timeoutMs:jobTimeoutMs,
          onCancel:reason => warn('export cancelled:', jobId, reason)});
        if (entry.cancelled) return await abandon(entry, 'GODOT_JOB_CANCELLED');
        const exportCheck = validateBrokerReceipt(exportRun.response, {operation:'exportWeb', sourceBinding, inputHash:claim.inputHash,
          expectedFiles:files, requestId:exportRun.requestId ?? entry.exportRequestId,
          measuredBrokerSha256:discovery.measuredBrokerSha256, pinnedBrokerSha256:discovery.brokerPin?.sha256 ?? null});
        exportLog = await readTaskLog(exportRun.response ?? {});
        if (!exportCheck.ok) {
          return await finishJob(entry, {
            import:{passed:true, log:bounded(importLog + '\n--- export ---\n' + exportLog, 8000)},
            compile:{passed:true, errors:[], warnings:importClassified.warnings.slice(0, 16)},
            check:{passed:false, assertions:[]}, artifacts:[], runtime:null, reason:exportCheck.reason ?? 'GODOT_EXPORT_FAILED',
          });
        }
        const exportClassified = classifyLog(exportLog);
        if (exportClassified.errors.length) {
          return await finishJob(entry, {
            import:{passed:true, log:bounded(importLog + '\n--- export ---\n' + exportLog, 8000)},
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
      const assertions = mode === 'check' ? assertionsFrom(runtime, claim) : [];
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
    const kind = entry.claim?.kind ?? entry.mode;
    // The core requires at least one assertion for a check job, including a
    // failed one: a job that never reached the runtime check must say so rather
    // than be refused and left to expire.
    const assertions = result.check.assertions.length ? result.check.assertions
      : (kind === 'check' ? [{id:'runtime.not-run', passed:false,
          detail:(result.reason ?? 'the job did not reach the runtime check').slice(0, 200)}] : []);
    const output = {
      format:RESULT_FORMAT,
      inputHash:entry.claim?.inputHash,
      passed:result.import.passed && result.compile.passed && result.check.passed && result.compile.errors.length === 0
        && assertions.every(assertion => assertion.passed === true),
      import:result.import,
      compile:result.compile,
      check:{passed:result.check.passed, assertions, ...(result.runtime?.requirementsEvidence ? {requirementsEvidence:result.runtime.requirementsEvidence} : {}), ...(result.check.passed && result.runtime?.passed && result.runtime?.defaultsSnapshot && result.runtime?.progressMigration ? {defaultsSnapshot:result.runtime.defaultsSnapshot, progressMigration:result.runtime.progressMigration} : {})},
      artifacts:result.artifacts,
      engine:{version:ENGINE_VERSION, isolation:ISOLATION, evidenceHash:discovery.evidenceHash},
    };
    try {
      const record = await core.call('godotJob.finish', {jobId, token, output}, 30000);
      log('job finished', jobId, record?.status, result.reason ? 'reason=' + result.reason : '');
      const status = record?.status ?? 'unknown';
      const durable = ledgerEntry(jobId);
      // Only a core-confirmed pass is terminal-success; anything else stays
      // retryable so a lost or refused finish cannot look like a completion.
      durable.state = status === 'passed' ? 'finished' : (status === 'failed' || status === 'cancelled') ? status : 'unconfirmed';
      durable.outcome = status;
      durable.finishedAt = nowIso();
      durable.reason = result.reason ?? null;
      persistLedger();
      return {status, candidateId:record?.candidateId ?? null, reason:result.reason ?? null};
    } catch (error) {
      warn('finish refused:', jobId, String(error?.message ?? error), result.reason ?? '');
      const durable = ledgerEntry(jobId);
      durable.state = 'failed';
      durable.outcome = 'refused';
      durable.finishedAt = nowIso();
      durable.reason = String(error?.message ?? error);
      persistLedger();
      return {status:'refused', candidateId:null, reason:String(error?.message ?? error)};
    }
  }

  async function abandon(entry, reason) {
    warn('job abandoned:', entry.jobId, reason);
    let cancelError = null;
    try { await core.call('godotBuild.cancel', {worldId:entry.worldId, jobId:entry.jobId}, 20000); }
    catch (error) { cancelError = String(error?.message ?? error); }
    const durable = ledgerEntry(entry.jobId);
    // An unconfirmed core cancel leaves the job retryable instead of claiming a
    // clean cancellation the core never accepted.
    durable.state = cancelError ? 'cancelling' : 'cancelled';
    durable.outcome = cancelError ? 'cancel-unconfirmed' : 'cancelled';
    durable.finishedAt = nowIso();
    durable.reason = cancelError ? reason + '; core cancel unconfirmed: ' + cancelError : reason;
    persistLedger();
    // A cancelled broker run has already been followed by a recovery pass in
    // runBroker; this covers a cancel that never reached the broker.
    await recoverTasks('cancel');
    return {status:'cancelled', candidateId:null, reason, coreCancelConfirmed:!cancelError};
  }

  function enqueue(job, context = {}) {
    if (stopped || !registered) return {enqueued:false, reason:discovery.reason ?? 'GODOT_EXECUTOR_UNAVAILABLE'};
    const jobId = typeof job === 'string' ? job : job?.jobId;
    if (typeof jobId !== 'string' || !/^gjob-[0-9a-f]{64}$/.test(jobId)) return {enqueued:false, reason:'INVALID_GODOT_JOB'};
    if (jobs.has(jobId)) return {enqueued:false, reason:'GODOT_JOB_ALREADY_ENQUEUED'};
    if (jobs.size >= MAX_JOBS) return {enqueued:false, reason:'GODOT_EXECUTOR_BUSY'};
    const entry = {jobId, worldId:job?.worldId ?? null, mode:job?.mode ?? job?.kind ?? 'build', token:randomUUID(), context, cancelled:false};
    jobs.set(jobId, entry);
    const durable = ledgerEntry(jobId);
    durable.worldId = entry.worldId;
    durable.mode = entry.mode;
    durable.state = 'enqueued';
    durable.reason = null;
    durable.finishedAt = null;
    persistLedger();
    entry.promise = new Promise(resolve => setImmediate(resolve))
      .then(() => waitForQueued(entry))
      .then(queued => {
        if (queued) return runJob(entry);
        jobs.delete(jobId);
        // A cancel that arrived while the job was still blocked must reach the
        // core, not be recorded as an unavailable execution.
        return entry.cancelled ? abandon(entry, 'GODOT_JOB_CANCELLED')
          : settleWithoutRun(entry, 'blocked', 'GODOT_EXECUTION_UNAVAILABLE');
      })
      .catch(error => { jobs.delete(jobId); settleWithoutRun(entry, 'failed', error.message);
        warn('job worker failed:', jobId, error.message); return {status:'failed', candidateId:null, reason:error.message}; });
    return {enqueued:true, jobId};
  }

  /** A job that never reached the broker still needs a terminal ledger state. */
  function settleWithoutRun(entry, state, reason) {
    const durable = ledgerEntry(entry.jobId);
    durable.state = state;
    durable.outcome = state;
    durable.finishedAt = nowIso();
    durable.reason = reason;
    persistLedger();
    return {status:state, candidateId:null, reason};
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
    // Reclaim tasks whose broker died without a final response before the
    // core's queued list is trusted again.
    const recovery = await recoverTasks('reconcile');
    const recoverySummary = {trigger:recovery.trigger, ok:recovery.ok,
      reclaimed:recovery.reclaimed.map(entry => entry.taskId), skipped:recovery.skipped.length, unreadable:recovery.unreadable.length};
    try {
      const pending = await core.call('godotJob.pending', {}, 20000);
      let enqueued = 0;
      for (const job of pending?.items ?? []) {
        if (job.status !== 'queued') continue;
        if (enqueue(job, {}).enqueued) enqueued++;
      }
      return {enqueued, recovery:recoverySummary};
    } catch (error) {
      // `godotJob.pending` is an optional core interface; its absence is not a failure.
      if (!/UNSUPPORTED|UNKNOWN|NOT_FOUND/i.test(String(error?.message ?? ''))) warn('reconcile failed:', error.message);
      return {enqueued:0, unsupported:true, recovery:recoverySummary};
    }
  }

  // ------------------------------------------------------- durable job ledger

  // The in-memory job map dies with the process. A small atomically-written
  // ledger lets a restarted executor tell "no final receipt, task reclaimed"
  // apart from "completed", and keeps one job from being started twice after an
  // observation wait timed out.
  let ledger = {format:LEDGER_FORMAT, executorId:EXECUTOR_ID, updatedAt:null, jobs:{}};
  let ledgerWrite = Promise.resolve();
  let ledgerError = null;

  const ledgerFile = () => dataPath ? path.join(dataPath, 'godot', 'executor-ledger.json') : null;

  async function loadLedger() {
    const file = ledgerFile();
    if (!file) return;
    // Never read while a write is still in flight, or the older on-disk content
    // would replace newer in-memory state and be written back over it.
    await ledgerWrite;
    try {
      const value = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (value?.format !== LEDGER_FORMAT || !value.jobs || typeof value.jobs !== 'object') return;
      // A ledger written by another version (or a partially damaged one) must not
      // break start(): normalize every entry to the shape this build uses.
      const jobs = {};
      for (const [jobId, entry] of Object.entries(value.jobs)) {
        if (!entry || typeof entry !== 'object') continue;
        jobs[jobId] = {jobId, worldId:entry.worldId ?? null, mode:entry.mode ?? null,
          importCrashRetries:entry.importCrashRetries ? 1 : 0,
          state:typeof entry.state === 'string' ? entry.state : 'enqueued',
          attempts:Array.isArray(entry.attempts) ? entry.attempts.filter(attempt => attempt && typeof attempt === 'object') : [],
          startedAt:entry.startedAt ?? null, finishedAt:entry.finishedAt ?? null,
          outcome:entry.outcome ?? null, reason:entry.reason ?? null};
      }
      ledger = {format:LEDGER_FORMAT, executorId:EXECUTOR_ID, updatedAt:value.updatedAt ?? null, jobs};
    } catch (error) {
      // A missing ledger is normal; an unreadable one is reported, never hidden.
      if (error?.code !== 'ENOENT') {
        ledgerError = 'GODOT_LEDGER_UNREADABLE:' + String(error?.message ?? error);
        warn('ledger unreadable:', ledgerError);
      }
    }
  }

  function persistLedger() {
    const file = ledgerFile();
    if (!file) return ledgerWrite;
    ledger.updatedAt = nowIso();
    const text = JSON.stringify(ledger, null, 2);
    ledgerWrite = ledgerWrite.then(async () => {
      // A unique temporary name keeps two writers (or a retried write) from
      // truncating each other's file before the rename.
      const temporary = file + '.' + randomUUID().replace(/-/g, '').slice(0, 12) + '.tmp';
      await fsp.mkdir(path.dirname(file), {recursive:true});
      await fsp.writeFile(temporary, text, 'utf8');
      await fsp.rename(temporary, file);
      ledgerError = null;
    }).catch(error => {
      ledgerError = 'GODOT_LEDGER_WRITE_FAILED:' + String(error?.message ?? error);
      warn('ledger write failed:', ledgerError);
    });
    return ledgerWrite;
  }

  function ledgerEntry(jobId) {
    if (!ledger.jobs[jobId]) {
      ledger.jobs[jobId] = {jobId, worldId:null, mode:null, state:'enqueued', attempts:[],
        startedAt:null, finishedAt:null, outcome:null, reason:null};
    }
    return ledger.jobs[jobId];
  }

  function recordAttempt(jobId, attempt) {
    const entry = ledgerEntry(jobId);
    const index = entry.attempts.findIndex(item => item.requestId === attempt.requestId);
    if (index >= 0) entry.attempts[index] = {...entry.attempts[index], ...attempt};
    else entry.attempts.push(attempt);
    persistLedger();
  }

  const attemptReclaimed = (summary, requestId) => !!summary?.reclaimed?.some(entry => entry.taskId === requestId);

  /** Run one broker invocation and keep its durable attempt record in step. */
  async function trackedBrokerRun(entry, request) {
    const attempt = {requestId:request.requestId, operation:request.operation, startedAt:nowIso(), outcome:null, transport:null, recovery:null};
    recordAttempt(entry.jobId, attempt);
    const run = await track(entry, runBroker(request));
    if (run.response?.resourceEnforcement) {
      const observed = run.response.resourceEnforcement;
      discovery.resources = {policyVersion:observed.policyVersion ?? null, scope:observed.scope ?? null,
        hardFilesystemQuota:observed.hardFilesystemQuota === true, enforced:observed.enforced === true,
        workBytesLimit:observed.workBytesLimit ?? null, logBytesLimit:observed.logBytesLimit ?? null,
        maxObservedWorkBytes:observed.maxObservedWorkBytes ?? null, maxObservedLogBytes:observed.maxObservedLogBytes ?? null,
        samples:observed.samples ?? null, reason:observed.reason ?? null, at:nowIso()};
    }
    const cleanSuccess = run.response?.state === 'succeeded' && run.response?.cleanup?.verified === true;
    recordAttempt(entry.jobId, {
      requestId:request.requestId, finishedAt:nowIso(),
      transport:run.response?.state ?? null,
      journalRetired:run.response?.recoveryJournal?.cleared === true,
      failure:cleanSuccess ? null : {exitCode:run.exitCode??null,engineExitCode:run.response?.exitCode??null,
        error:run.response?.error??run.reason??null,parseError:run.parseError??null,
        cleanup:run.response?.cleanup??null,resources:run.response?.resourceEnforcement??null,
        stderr:bounded(run.stderr??'',8192)},
      // "succeeded" is reserved for a run that reported success and proved its
      // own cleanup; journal retirement is recorded separately.
      outcome:cleanSuccess ? 'succeeded'
        : attemptReclaimed(run.recovery, request.requestId) ? 'reclaimed-without-final-receipt'
        : 'no-final-receipt:' + (run.parseError ?? run.response?.state ?? run.reason ?? 'transport'),
      recovery:run.recovery ? {trigger:run.recovery.trigger, ok:run.recovery.ok, parseError:run.recovery.parseError ?? null,
        reclaimed:run.recovery.reclaimed.map(item => item.taskId),
        skipped:run.recovery.skipped.length, unreadable:run.recovery.unreadable.length} : null,
    });
    return run;
  }

  /**
   * Restart reconciliation. Runs once after the startup recovery pass: a job
   * whose attempt left no final receipt is only re-enqueued when the recovery
   * pass re-proved the old task identity, so an unknown leftover is reported
   * instead of being started a second time over an unverified task root.
   */
  async function reconcileAfterRestart(summary) {
    const stale = Object.values(ledger.jobs).filter(entry => !['finished', 'failed', 'cancelled'].includes(entry.state));
    const result = {checked:stale.length, requeued:[], terminal:[], interrupted:[], unverifiable:[], recovery:summary?.trigger ?? null};
    for (const entry of stale) {
      let unverified = false;
      for (const attempt of entry.attempts) {
        if (attempt.outcome) continue;
        attempt.outcome = attemptReclaimed(summary, attempt.requestId) ? 'reclaimed-without-final-receipt' : 'unknown-at-restart';
        attempt.recoveredAt = nowIso();
        if (attempt.outcome !== 'reclaimed-without-final-receipt') unverified = true;
      }
      let job = null;
      try { job = await core.call('godotBuild.read', {worldId:entry.worldId, jobId:entry.jobId}, 20000); }
      catch { job = null; }
      const jobState = job?.status ?? null;
      if (jobState === 'succeeded' || jobState === 'failed' || jobState === 'cancelled') {
        entry.state = jobState === 'succeeded' ? 'finished' : jobState;
        entry.finishedAt = nowIso();
        entry.reason = 'GODOT_RESTART_TERMINAL:' + jobState;
        result.terminal.push({jobId:entry.jobId, status:jobState});
      } else if ((jobState === 'queued' && !unverified) || (jobState === 'blocked' && entry.attempts.length === 0)) {
        const started = enqueue({jobId:entry.jobId, worldId:entry.worldId, mode:entry.mode});
        if (started?.enqueued === true) {
          entry.state = 'enqueued';
          entry.reason = 'GODOT_RESTART_REQUEUED';
          result.requeued.push(entry.jobId);
        } else {
          // Busy or unavailable: leave the entry non-terminal so a later
          // reconcile can pick it up, and report why it did not start.
          entry.state = 'interrupted';
          entry.reason = 'GODOT_RESTART_NOT_ENQUEUED:' + (started?.reason ?? 'UNKNOWN');
          result.interrupted.push({jobId:entry.jobId, status:jobState, reason:started?.reason ?? null});
        }
      } else if (unverified) {
        // No final receipt and no re-proved identity: never restart it.
        entry.state = 'interrupted';
        entry.reason = 'GODOT_RESTART_IDENTITY_UNVERIFIED';
        result.unverifiable.push({jobId:entry.jobId, attempts:entry.attempts.map(attempt => attempt.requestId)});
      } else {
        entry.state = 'interrupted';
        entry.reason = 'GODOT_RESTART_ATTEMPT_INTERRUPTED:' + (jobState ?? 'unreadable');
        result.interrupted.push({jobId:entry.jobId, status:jobState});
      }
    }
    persistLedger();
    return result;
  }

  // ---------------------------------------------------------------- lifecycle

  async function start() {
    if (stopping) { await stopping; return start(); }
    if (starting) return starting;
    if (registered && !stopped) return status();
    const generation = ++lifecycleGeneration;
    const current = () => generation === lifecycleGeneration && !stopped;
    stopped = false;
    starting = (async () => {
      let verified;
      try { verified = await verifyToolchain(); }
      catch (error) {
        if (!current()) return status();
        Object.assign(discovery, {state:'unavailable', reason:'GODOT_EXECUTOR_DISCOVERY_FAILED', detail:String(error?.message ?? error)});
        warn('discovery failed:', String(error?.message ?? error));
        return status();
      }
      if (!current()) return status();
      if (!verified.ok) {
        Object.assign(discovery, {state:'unavailable', reason:verified.reason, broker:null, engineRoot:null, lock:null, evidenceHash:null, preflight:null});
        warn('executor unavailable:', verified.reason);
        return status();
      }
      Object.assign(discovery, {state:'discovered', reason:null, broker:verified.broker, engineRoot:verified.engineRoot,
        lock:verified.lock ? path.basename(verified.lock.path) : null, measured:verified.measured, bridge:verified.bridge,
        measuredBrokerSha256:verified.brokerSha256, brokerPin:verified.brokerPin});
      tasksRoot = path.join(dataPath ?? path.dirname(verified.broker), 'godot', 'tasks');
      await fsp.mkdir(tasksRoot, {recursive:true});
      if (!current()) return status();
      if (!ordinaryDirectory(tasksRoot)) {
        Object.assign(discovery, {state:'unavailable', reason:'GODOT_STORAGE_UNAVAILABLE'});
        return status();
      }
      // Restart reconciliation, phase 1: reclaim any task whose broker died
      // without a final response before a fresh preflight creates new tasks.
      await loadLedger();
      if (!current()) return status();
      discovery.startupRecovery = await recoverTasks('startup');
      if (!current()) return status();
      const preflightResult = await preflight(verified);
      if (!current()) return status();
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
        // A stop may have arrived while this RPC committed. Retain the flag
        // for stop's revoke, but never promote jobs from this obsolete start.
        if (!current()) return status();
        discovery.state = registered ? 'registered' : 'unavailable';
        discovery.reason = registered ? null : 'GODOT_REGISTRATION_REFUSED';
        discovery.attestationHash = registration?.attestationHash ?? null;
        discovery.promotedJobs = registration?.promotedJobs ?? 0;
        log('registered', EXECUTOR_ID, 'evidence', discovery.evidenceHash.slice(0, 16), 'promoted', discovery.promotedJobs);
      } catch (error) {
        registered = false;
        if (!current()) return status();
        discovery.state = 'unavailable';
        discovery.reason = 'GODOT_REGISTRATION_REFUSED';
        warn('registration refused:', String(error?.message ?? error));
        return status();
      }
      // Restart reconciliation, phase 2: a job may only be started again once
      // the executor is registered, so this runs after registration.
      discovery.restartReconciliation = await reconcileAfterRestart(discovery.startupRecovery);
      if (!current()) return status();
      await reconcile();
      return status();
    })().finally(() => { starting = null; });
    return starting;
  }

  async function stop() {
    if (stopping) return stopping;
    stopped = true;
    ++lifecycleGeneration;
    const pendingStart = starting;
    stopping = stopInner(pendingStart).finally(() => { stopping = null; });
    return stopping;
  }

  async function stopInner(pendingStart) {
    // Finish the bounded broker preflight/registration before recovery or a
    // core-directory switch. Its generation is already invalidated above.
    await pendingStart?.catch(error => warn('startup drained during stop:', String(error?.message ?? error)));
    await Promise.all([...jobs.keys()].map(jobId => cancel(jobId, 'executor stopping')));
    await Promise.all([...jobs.values()].map(entry => entry.promise));
    // Nothing is running any more, so any journal entry left behind belongs to
    // a task that never reported a final receipt. Reclaim it with re-proved
    // identity; never delete by name or bare pid.
    discovery.stopRecovery = await recoverTasks('stop');
    // Do not report a clean stop while a ledger write is still in flight.
    await ledgerWrite;
    let revoked = false;
    let revokeReason = null;
    if (registered) {
      try { const result = await core.call('godotExecutor.revoke', {executorId:EXECUTOR_ID}, 20000); revoked = result?.revoked === true; }
      catch (error) {
        // Without `godotExecutor.revoke` the core keeps a stale registration for
        // this process; jobs can no longer be claimed, but the capability flag
        // stays until the core restarts. Reported, never hidden.
        revokeReason = /UNSUPPORTED|UNKNOWN|NOT_FOUND/i.test(String(error?.message ?? ''))
          ? 'GODOT_EXECUTOR_REVOKE_UNSUPPORTED' : String(error?.message ?? error);
        if (revokeReason !== 'GODOT_EXECUTOR_REVOKE_UNSUPPORTED') warn('revoke failed:', revokeReason);
      }
    }
    registered = false;
    discovery.state = 'stopped';
    discovery.revokeReason = revokeReason;
    return {revoked, revokeReason};
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
      broker:discovery.broker ? {sha256:discovery.measuredBrokerSha256 ?? null,
        pinned:!!discovery.brokerPin, pinSource:discovery.brokerPin?.source ?? null,
        sourceCommit:discovery.brokerPin?.identity?.sourceCommit ?? null,
        protocolVersion:discovery.brokerPin?.identity?.protocolVersion ?? null} : null,
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
      // Recovery is the only cleanup path. A reclaimed task means the recorded
      // identity was re-proved after a missing final receipt; it never means
      // the build succeeded.
      recoveries:discovery.recoveries ?? [],
      startupRecovery:discovery.startupRecovery ?? null,
      restartReconciliation:discovery.restartReconciliation ?? null,
      stopRecovery:discovery.stopRecovery ?? null,
      // The broker enforces a sampled budget, not a filesystem quota. The two
      // are reported separately so a hard-quota claim is never inferred.
      resources:{sampled:true, hardFilesystemQuota:false,
        scope:'sampled-task-work-directory-and-log-size; parent terminates the job on breach',
        lastObserved:discovery.resources ?? null},
      jobs:[...jobs.keys()],
      ledger:{jobs:Object.keys(ledger.jobs).length,
        active:Object.values(ledger.jobs).filter(entry => !['finished', 'failed', 'cancelled'].includes(entry.state)).length,
        updatedAt:ledger.updatedAt, error:ledgerError},
      tasksRoot,
      registered,
      revokedOnStop:null,
    };
  }

  return {start, stop, status, enqueue, cancel, cancelTurn, cancelOtherTurns, reconcile,
    recover:recoverTasks, reconcileAfterRestart, get ledger() { return ledger; },
    get executorId() { return EXECUTOR_ID; }, get registered() { return registered; }};
}

module.exports = {createGodotExecutor, classifyLog, summarizeRecovery, runRecoveryPass, sourceSnapshotDigest, safeRelative, ordinaryDirectory,
  EXECUTOR_ID, ISOLATION, ENGINE_VERSION, RECOVERY_POLICY_VERSION, LEDGER_FORMAT, BROKER_IDENTITY_FORMAT,
  BROKER_PROFILE_PREFIX, BROKER_TASK_ID_MAX, NATIVE_ISOLATION_DIAGNOSTICS};
