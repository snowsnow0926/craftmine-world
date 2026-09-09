// Fixed, headless acceptance harness for the private Godot host broker.
//
// It drives the pinned `godot-host-broker.exe run` binary through the real
// Windows execution boundary and records raw evidence. It never sends mouse or
// keyboard input, never requests pointer lock, never activates a window and
// never touches a user world: every project it builds is a freshly created
// synthetic fixture under the run directory.
//
// Usage:
//   node tests/godot-remaining/B/run_broker_cases.mjs [--cases a,b,c]
//        [--evidence <dir>] [--keep]
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const sandbox = path.join(repo, 'desktop', 'godot', 'sandbox');
const broker = path.join(sandbox, 'target', 'debug', 'godot-host-broker.exe');
const fixtures = path.join(sandbox, 'fixtures', 'web-sample');
const engineRoot = process.env.CM_GODOT_ENGINE_ROOT
  ?? 'D:/Craftmine World/desktop/build/godot/4.7.2-stable';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const caseList = flag('--cases', 'version,import,exportWeb,eof,cancel,terminate,live-recover,adversarial,inflation')
  .split(',').map((value) => value.trim()).filter(Boolean);
const evidenceDir = path.resolve(repo, flag('--evidence', 'docs/dispatch-reports/godot-remaining/B/evidence'));
const keep = argv.includes('--keep');
const runId = `b-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${process.pid}`;
const runDir = path.join(repo, 'test-results', 'broker-cases', runId);
const tasksRoot = path.join(runDir, 'tasks');
const projectsRoot = path.join(runDir, 'projects');
const MAX_EVIDENCE_LOG_BYTES = 256 * 1024;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digestFile = (file) => sha256(fs.readFileSync(file));
const nowMs = () => Date.now();

fs.mkdirSync(tasksRoot, { recursive: true });
fs.mkdirSync(projectsRoot, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

const pinnedInputs = [
  ['editor/Godot_v4.7.2-stable_win64.exe', 'ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424'],
  ['templates/version.txt', '38885c88f75abbc797a1db7559719800279a00cfb9fa8b2e2868a7f6f84bad2e'],
  ['templates/web_nothreads_debug.zip', '08962aefef811b603541d7951ac67ef00413aad2d978855183c28adee98f626a'],
  ['templates/web_nothreads_release.zip', 'd3ee2f08cef0cf3cf6678a6355a92a8db48ccdd35cbd2e8bfd5f0e8a0b4032a0'],
  ['templates/web_release.zip', '02f0dca13ed3d8343fa68f8f88ac80295562408d71aa67157e8b96ddebaa67a3'],
];

function assertPinnedInputs() {
  const observed = [];
  for (const [relative, expected] of pinnedInputs) {
    const file = path.join(engineRoot, relative);
    if (!fs.existsSync(file)) throw new Error(`pinned engine input missing: ${file}`);
    const actual = digestFile(file);
    if (actual !== expected) throw new Error(`pinned engine input changed: ${relative} ${actual}`);
    observed.push({ relative, sha256: actual });
  }
  return observed;
}

function stageProject(taskId, mutate) {
  const target = path.join(projectsRoot, taskId);
  fs.cpSync(fixtures, target, { recursive: true });
  if (mutate) mutate(target);
  return target;
}

function writeEvidence(name, text) {
  const file = path.join(evidenceDir, name);
  fs.writeFileSync(file, text);
  return file;
}

function boundedLog(source) {
  if (!fs.existsSync(source)) return '<absent>';
  const buffer = fs.readFileSync(source);
  if (buffer.length <= MAX_EVIDENCE_LOG_BYTES) return buffer.toString('utf8');
  return `${buffer.subarray(0, MAX_EVIDENCE_LOG_BYTES).toString('utf8')}\n<truncated at ${MAX_EVIDENCE_LOG_BYTES} bytes of ${buffer.length}>\n`;
}

function requestFor({ taskId, operation, projectRoot = null }) {
  return {
    schemaVersion: 1,
    requestId: taskId,
    taskId,
    operation,
    projectRoot,
    tasksRoot,
    engineRoot,
    sourceBinding: {
      worldId: 'fixed-b-synthetic-fixture',
      buildId: taskId,
      sourceRevision: 1,
      sourceDigest: '0'.repeat(64),
    },
    inputHash: sha256(taskId),
  };
}

function startBroker() {
  const child = spawn(broker, ['run'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const exited = new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? -1));
  });
  return {
    child,
    exited,
    stdout: () => Buffer.concat(stdout).toString('utf8'),
    stderr: () => Buffer.concat(stderr).toString('utf8'),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForLogMarker(logFile, marker, timeoutMs) {
  const deadline = nowMs() + timeoutMs;
  while (nowMs() < deadline) {
    if (fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes(marker)) return true;
    await sleep(50);
  }
  return false;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function parseFinal(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function recoverSync(expectStatus = 0) {
  const outFile = path.join(runDir, 'recovery-report.json');
  const result = spawnSync(broker, ['recover', tasksRoot, '--json-out', outFile]);
  if (result.status !== expectStatus) {
    throw new Error(`recover exited ${result.status} (expected ${expectStatus}): ${result.stderr}`);
  }
  const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  return { report, status: result.status, text: fs.readFileSync(outFile, 'utf8') };
}

function check(condition, message, failures) {
  if (!condition) failures.push(message);
}

async function runCase(name) {
  const taskId = `b-${name.toLowerCase()}-${nowMs()}`;
  const operation = name === 'exportWeb' ? 'exportWeb' : name === 'version' || name === 'eof' ? 'version' : 'import';
  const failures = [];
  const summary = { case: name, taskId, operation, startedAt: new Date().toISOString() };
  let projectRoot = null;
  let sentinel = null;
  let loopbackControl = null;

  if (name === 'cancel' || name === 'terminate' || name === 'live-recover') {
    projectRoot = stageProject(taskId, (target) => {
      fs.writeFileSync(
        path.join(target, 'probe_resource.gd'),
        '@tool\nextends Resource\n\nfunc _init() -> void:\n\tprint("B_FIXED_SLEEP_READY")\n\tOS.delay_msec(30000)\n',
      );
    });
  } else if (name === 'adversarial') {
    // A real host loopback listener is the positive control: it exists and
    // accepts, but the restricted task must not be able to reach it.
    loopbackControl = await new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        loopbackControl.connections += 1;
        socket.destroy();
      });
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        resolve({ server, port: server.address().port, connections: 0 });
      });
    });
    const deniedWorld = path.join(runDir, 'synthetic-world', taskId);
    fs.mkdirSync(deniedWorld, { recursive: true });
    sentinel = path.join(deniedWorld, 'synthetic-sentinel.txt');
    fs.writeFileSync(sentinel, 'b-private-synthetic-sentinel');
    projectRoot = stageProject(taskId, (target) => {
      fs.writeFileSync(
        path.join(target, 'probe_targets.cfg'),
        `[probe]\nsentinel="${sentinel.replaceAll('\\', '/')}"\nexternal_host="192.0.2.1"\nexternal_port=80\nloopback_host="127.0.0.1"\nloopback_port=${loopbackControl.port}\n`,
      );
      const probe = path.join(target, 'sandbox_probe', 'probe.gd');
      const text = fs.readFileSync(probe, 'utf8');
      const marker = '\tlines.append("%s_spawn=%s" % [label, _spawn()])';
      if (!text.includes(marker)) throw new Error('fixed probe marker not found');
      fs.writeFileSync(
        probe,
        text.replace(marker, `${marker}\n\tprint("B_BOUNDARY_RESULT|" + "|".join(lines))`),
      );
    });
  } else if (name === 'inflation') {
    projectRoot = stageProject(taskId, (target) => {
      fs.writeFileSync(
        path.join(target, 'probe_resource.gd'),
        '@tool\nextends Resource\n\nfunc _init() -> void:\n'
        + '\tprint("B_INFLATION_READY")\n'
        + '\tvar handle := FileAccess.open("user://inflation.bin", FileAccess.WRITE)\n'
        + '\tif handle == null:\n\t\tprint("B_INFLATION_OPEN_FAILED")\n\t\treturn\n'
        + '\tvar chunk := PackedByteArray()\n\tchunk.resize(4 * 1024 * 1024)\n'
        + '\tfor index in range(4096):\n\t\thandle.store_buffer(chunk)\n\t\thandle.flush()\n\t\tOS.delay_msec(10)\n'
        + '\thandle.close()\n\tprint("B_INFLATION_DONE")\n',
      );
    });
  } else if (operation !== 'version') {
    projectRoot = stageProject(taskId);
  }

  const request = requestFor({ taskId, operation, projectRoot });
  const taskLog = path.join(tasksRoot, taskId, 'logs', 'task.log');
  const run = startBroker();
  run.child.stdin.write(`${JSON.stringify(request)}\n`);

  if (name === 'eof') {
    run.child.stdin.end();
  } else if (name === 'cancel' || name === 'terminate' || name === 'live-recover') {
    const ready = await waitForLogMarker(taskLog, 'B_FIXED_SLEEP_READY', 60_000);
    check(ready, 'fixed sleep marker was not reached', failures);
    summary.sleepMarkerReached = ready;
    if (ready) {
      if (name === 'cancel') {
        run.child.stdin.write('{"cancel":true}\n');
      } else if (name === 'live-recover') {
        const sidecar = path.join(tasksRoot, taskId, 'logs', 'process-verification.json');
        summary.liveSidecar = fs.existsSync(sidecar) ? JSON.parse(fs.readFileSync(sidecar, 'utf8')) : null;
        check(summary.liveSidecar !== null, 'live recovery case has no host-written sidecar', failures);
        // Recovery must never touch a task whose broker is still running.
        const { report, text } = recoverSync(1);
        summary.liveRecovery = report;
        const entry = report.entries.find((item) => item.taskId === taskId);
        check(entry !== undefined, 'live recovery produced no entry for the running task', failures);
        if (entry) {
          check(entry.skipped.includes('broker-still-running'), `live recovery did not skip: ${JSON.stringify(entry.skipped)}`, failures);
          check(entry.taskRootRemoved === false, 'live recovery removed a running task root', failures);
          check(entry.identityVerified === false, 'live recovery claimed verified identity on a live task', failures);
        }
        check(!text.includes('"cleanup"'), 'recovery report must not carry a cleanup verdict', failures);
        check(fs.existsSync(path.join(tasksRoot, taskId, 'work')), 'live task work directory was removed', failures);
        if (summary.liveSidecar) {
          check(pidAlive(summary.liveSidecar.pid) === true, 'live recovery killed the running child', failures);
        }
        // Then let the task finish through the documented cancellation frame.
        run.child.stdin.write('{"cancel":true}\n');
        summary.liveTaskCancelledAfterRecovery = true;
      } else {
        const sidecar = path.join(tasksRoot, taskId, 'logs', 'process-verification.json');
        summary.preKillSidecar = fs.existsSync(sidecar) ? JSON.parse(fs.readFileSync(sidecar, 'utf8')) : null;
        check(summary.preKillSidecar !== null, 'terminate case has no host-written sidecar', failures);
        summary.preKillJournal = fs.readFileSync(
          path.join(tasksRoot, '.recovery-journal', `${taskId}.json`),
          'utf8',
        );
        run.child.kill('SIGKILL');
      }
    }
  }

  const exitCode = await run.exited;
  const stdout = run.stdout();
  const stderr = run.stderr();
  summary.transportExit = exitCode;

  writeEvidence(`${taskId}.request.json`, JSON.stringify(request, null, 2));
  writeEvidence(`${taskId}.stdout.json`, stdout);
  writeEvidence(`${taskId}.stderr.log`, stderr);

  if (name === 'terminate') {
    // No final response exists by construction: recovery is the only owner.
    check(stdout.trim().length === 0, 'a killed broker must not produce a final response', failures);
    summary.finalReceiptObserved = stdout.trim().length > 0;
    const { report, text } = recoverSync(0);
    summary.recovery = report;
    writeEvidence(`${taskId}.recovery.json`, JSON.stringify(report, null, 2));
    const entry = report.entries.find((item) => item.taskId === taskId);
    check(entry !== undefined, 'recovery produced no entry for the killed task', failures);
    check(!text.includes('"cleanup"'), 'recovery report must not carry a cleanup verdict', failures);
    if (entry) {
      check(entry.identityVerified === true, 'recovery did not verify task identity', failures);
      check(entry.finalReceiptObserved === false, 'recovery must not claim a final receipt', failures);
      check(entry.journalRemoved === true, 'recovery did not retire the journal entry', failures);
      check(entry.taskRootRemoved === true, 'recovery did not reclaim the task root', failures);
      check(entry.profileDeleted === true, `profile not reclaimed: ${JSON.stringify(entry.profileHresult)}`, failures);
      check(!('cleanup' in entry), 'a recovery entry must not expose a cleanup verdict', failures);
      check(
        ['gone', 'terminated'].includes(entry.childProcessState),
        `unexpected child process state ${entry.childProcessState}`,
        failures,
      );
      const preKill = summary.preKillSidecar;
      if (preKill) {
        check(entry.childPid === preKill.pid, 'recovery used a different PID than the host sidecar', failures);
        check(
          entry.childCreationTimeFiletime === preKill.creationTimeFiletime,
          'recovery used a different creation time than the host sidecar',
          failures,
        );
      }
    }
    check(!fs.existsSync(path.join(tasksRoot, taskId)), 'task root still exists after recovery', failures);
    check(
      !fs.existsSync(path.join(tasksRoot, '.recovery-journal', `${taskId}.json`)),
      'journal entry still exists after recovery',
      failures,
    );
    summary.passed = failures.length === 0;
    summary.failures = failures;
    writeEvidence(`${taskId}.summary.json`, JSON.stringify(summary, null, 2));
    return summary;
  }

  const result = parseFinal(stdout);
  summary.finalResponse = result;
  if (name === 'eof' || name === 'cancel' || name === 'live-recover') {
    check(result?.state === 'cancelled', `expected cancelled, got ${result?.state}`, failures);
    if (name === 'eof') {
      check(result?.processVerification == null, 'EOF cancellation must not produce a process receipt', failures);
    } else {
      check(result?.processVerification?.verified === true, 'cancel must keep the verified process receipt', failures);
      const pid = result?.processVerification?.pid;
      if (typeof pid === 'number') {
        await sleep(500);
        summary.childAliveAfterCancel = pidAlive(pid);
        check(summary.childAliveAfterCancel === false, 'cancelled child is still alive', failures);
      }
    }
    check(result?.cleanup?.verified === true, 'cancellation cleanup was not verified', failures);
    check(result?.recoveryJournal?.cleared === true, 'journal entry was not retired after cancellation', failures);
    check(
      !fs.existsSync(path.join(tasksRoot, '.recovery-journal', `${taskId}.json`)),
      'journal entry file still exists after a normal response',
      failures,
    );
    check(!fs.existsSync(path.join(tasksRoot, taskId, 'work')), 'task work directory still exists after cleanup', failures);
  } else if (name === 'inflation') {
    check(result?.state === 'failed', `expected failed, got ${result?.state}`, failures);
    const enforcement = result?.resourceEnforcement;
    check(enforcement?.enforced === true, 'resource watchdog did not enforce the budget', failures);
    check(enforcement?.hardFilesystemQuota === false, 'scope must stay honest (no hard quota)', failures);
    if (enforcement) {
      check(enforcement.maxObservedWorkBytes > enforcement.workBytesLimit, 'budget was not actually exceeded', failures);
      // The overshoot is bounded by one sampling interval of writes, not by a
      // fixed byte count: it depends on how fast the volume accepts writes. The
      // ceiling below only catches a watchdog that stopped sampling entirely.
      check(
        enforcement.maxObservedWorkBytes <= enforcement.workBytesLimit + 512 * 1024 * 1024,
        `overshoot too large: ${enforcement.maxObservedWorkBytes}`,
        failures,
      );
      summary.overshootBytes = enforcement.maxObservedWorkBytes - enforcement.workBytesLimit;
    }
    check(result?.cleanup?.verified === true, 'inflation cleanup was not verified', failures);
  } else {
    check(result?.state === 'succeeded', `expected succeeded, got ${result?.state}: ${result?.error}`, failures);
    check(result?.processVerification?.verified === true, 'process verification missing', failures);
    check(result?.processVerification?.verifiedBeforeResume === true, 'verification happened after resume', failures);
    check(result?.processVerification?.resumePreviousCount === 1, 'resume count is not 1', failures);
    check(result?.networkPreflight?.verified === true, 'native network preflight not verified', failures);
    check(result?.cleanup?.verified === true, 'cleanup not verified', failures);
    check(result?.recoveryJournal?.cleared === true, 'journal entry was not retired', failures);
    check(
      !fs.existsSync(path.join(tasksRoot, '.recovery-journal', `${taskId}.json`)),
      'journal entry file still exists after a successful response',
      failures,
    );
    check(!fs.existsSync(path.join(tasksRoot, taskId, 'work')), 'task work directory still exists after cleanup', failures);
    if (name === 'exportWeb') {
      check((result?.artifacts?.length ?? 0) >= 4, 'too few exported artifacts', failures);
    }
  }

  if (name === 'adversarial') {
    check(fs.readFileSync(sentinel, 'utf8') === 'b-private-synthetic-sentinel', 'synthetic sentinel changed', failures);
    const escape = path.join(path.dirname(sentinel), 'editor-escape.txt');
    check(!fs.existsSync(escape), 'sibling escape file was created', failures);
    const log = boundedLog(path.join(tasksRoot, taskId, 'logs', 'task.log'));
    writeEvidence(`${taskId}.task.log`, log);
    const lines = log.split(/\r?\n/).filter((line) => line.includes('B_BOUNDARY_RESULT|'));
    summary.boundaryLines = lines;
    check(lines.length >= 2, 'editor-time probe did not run for plugin and @tool', failures);
    for (const line of lines) {
      for (const required of ['_file_read=denied', '_file_write=denied', '_sibling_write=denied', '_spawn=denied(error=-1)']) {
        check(line.includes(required), `missing boundary evidence ${required} in ${line}`, failures);
      }
      // Godot's socket API collapses WSA 10013 into a generic error; the honest
      // outcome is `unknown`, never a claimed denial or a claimed allow.
      for (const field of ['_external_connect=', '_loopback_connect=']) {
        const value = line.split('|').find((part) => part.includes(field));
        check(value !== undefined, `missing ${field}`, failures);
        if (value !== undefined) {
          check(value.endsWith('=unknown(error=1)') || value.endsWith('=unknown(timeout)'), `unexpected ${value}`, failures);
        }
      }
    }
    if (loopbackControl) {
      summary.hostLoopbackControlPort = loopbackControl.port;
      summary.hostLoopbackConnections = loopbackControl.connections;
      check(loopbackControl.connections === 0, 'restricted task reached the host loopback listener', failures);
      await new Promise((resolve) => loopbackControl.server.close(resolve));
      loopbackControl = null;
    }
  }

  if (['import', 'exportWeb', 'cancel', 'live-recover', 'adversarial', 'inflation'].includes(name)) {
    writeEvidence(`${taskId}.task.log`, boundedLog(path.join(tasksRoot, taskId, 'logs', 'task.log')));
  }

  summary.passed = failures.length === 0;
  summary.failures = failures;
  summary.finishedAt = new Date().toISOString();
  writeEvidence(`${taskId}.summary.json`, JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  if (!fs.existsSync(broker)) throw new Error(`broker binary missing: ${broker}`);
  const pins = assertPinnedInputs();
  const index = {
    runId,
    broker,
    brokerSha256: digestFile(broker),
    engineRoot,
    pinnedInputs: pins,
    cases: caseList,
    startedAt: new Date().toISOString(),
    results: [],
  };
  for (const name of caseList) {
    process.stdout.write(`\n=== case ${name} ===\n`);
    const result = await runCase(name);
    process.stdout.write(`${JSON.stringify({ case: result.case, passed: result.passed, failures: result.failures })}\n`);
    index.results.push({
      case: result.case,
      taskId: result.taskId,
      passed: result.passed,
      failures: result.failures,
    });
  }
  index.finishedAt = new Date().toISOString();
  index.passed = index.results.length > 0 && index.results.every((result) => result.passed);
  writeEvidence(`index-${runId}.json`, JSON.stringify(index, null, 2));
  process.stdout.write(`\n${JSON.stringify({ runId, passed: index.passed, results: index.results }, null, 2)}\n`);
  if (!keep) fs.rmSync(path.join(runDir, 'projects'), { recursive: true, force: true });
  if (!index.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`HARNESS_ERROR: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
