'use strict';
// Scripted stand-in for the pinned broker, used only by the S2 protocol tests.
//
// It speaks the real BROKER_PROTOCOL_V1 framing for `run` (one JSON line in,
// stdin kept open, one JSON line out) and emits a scenario-driven report for
// `recover <tasksRoot>`. It exists so the supervisor's recovery triggers and
// its "reclaimed is not success" rule can be exercised deterministically. It is
// never part of the product path.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

const sha256 = value => createHash('sha256').update(value).digest('hex');

function readScenario() {
  const file = process.env.CRAFTMINE_S2_FIXTURE_FILE;
  if (!file) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

if (process.argv[2] === 'recover') {
  const tasksRoot = process.argv[3];
  const scenario = readScenario();
  const report = scenario.recovery ?? {
    policyVersion:'craftmine.windows.recovery-journal.v1',
    tasksRoot,
    journalRoot:path.join(tasksRoot, '.recovery-journal'),
    entries:[], unreadable:[], reconciledCount:0, skippedCount:0,
  };
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exit(Number(scenario.recoveryExitCode ?? 0));
}

if (process.argv[2] !== 'run') { process.stderr.write('BROKER_ERROR: argv\n'); process.exit(1); }

function listFiles(root, prefix = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, prefix), {withFileTypes:true}); } catch { return out; }
  for (const entry of entries) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, relative));
    else if (entry.isFile()) out.push({path:relative, bytes:fs.statSync(path.join(root, relative)).size, sha256:sha256(fs.readFileSync(path.join(root, relative)))});
  }
  return out.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function respond(request) {
  const scenario = readScenario();
  const taskRoot = path.join(request.tasksRoot, request.taskId);
  const logsRoot = path.join(taskRoot, 'logs');
  const artifactsRoot = path.join(taskRoot, 'artifacts');
  fs.mkdirSync(logsRoot, {recursive:true});
  fs.mkdirSync(artifactsRoot, {recursive:true});
  const log = 'Godot Engine v4.7.2.stable.official.ed1daf0bf\n';
  fs.writeFileSync(path.join(logsRoot, 'task.log'), log);
  fs.writeFileSync(path.join(logsRoot, 'preflight.json'), JSON.stringify({winsockStartup:0, checks:[]}));

  const sourceFiles = request.operation === 'version' ? [] : listFiles(request.projectRoot);
  const artifacts = [];
  if (request.operation === 'exportWeb') {
    for (const [relative, body] of Object.entries(scenario.artifacts ?? {
      'index.html':'<!doctype html><canvas id="canvas"></canvas>',
      'index.js':'// game',
      'bridge.js':'// authored bridge',
    })) {
      const target = path.join(artifactsRoot, relative);
      fs.mkdirSync(path.dirname(target), {recursive:true});
      fs.writeFileSync(target, body);
      artifacts.push({path:relative, bytes:Buffer.byteLength(body), sha256:sha256(body)});
    }
  }

  return {
    schemaVersion:1,
    requestId:request.requestId,
    taskId:request.taskId,
    operation:request.operation,
    sourceBinding:request.sourceBinding,
    inputHash:request.inputHash,
    sourceSnapshotDigest:sha256(JSON.stringify(sourceFiles)),
    sourceFiles,
    state:scenario.state ?? 'succeeded',
    exitCode:0,
    policyVersion:'craftmine.windows.lpac-registry.v1',
    processVerification:{verified:true, policyVersion:'craftmine.windows.lpac-registry.v1', pid:4242,
      isAppContainer:true, jobMembershipVerified:true, resumePreviousCount:1},
    networkPreflight:{verified:true, policyVersion:'craftmine.windows.lpac-registry.v1',
      observation:{winsockStartup:0, checks:[{name:'tcp4', ok:false, rawOsError:10013}]}},
    artifacts,
    artifactsRoot,
    logsRoot,
    logs:[{path:'task.log', bytes:Buffer.byteLength(log), sha256:sha256(log)}],
    cleanup:{verified:true, profileHresult:0, workRemoved:true, error:null},
    // `cleared:false` leaves the journal entry behind, so the supervisor must
    // run its own recovery pass even though the run reported success.
    recoveryJournal:{path:path.join(request.tasksRoot, '.recovery-journal', request.taskId + '.json'),
      policyVersion:'craftmine.windows.recovery-journal.v1', cleared:scenario.journalCleared !== false, error:null},
    resourceEnforcement:scenario.resourceEnforcement ?? null,
    error:null,
    brokerSha256:scenario.brokerSha256 ?? sha256(fs.readFileSync(process.env.CRAFTMINE_GODOT_BROKER_BIN)),
  };
}

let buffer = '';
let answered = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (answered) {
    // Any input after the request cancels, exactly like the real broker.
    if (/"cancel"\s*:\s*true/.test(chunk)) {
      process.stdout.write(JSON.stringify({schemaVersion:1, state:'cancelled'}) + '\n');
      process.exit(0);
    }
    return;
  }
  buffer += chunk;
  if (!buffer.includes('\n')) return;
  answered = true;
  let request;
  try { request = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); }
  catch { process.stdout.write(JSON.stringify({schemaVersion:1, state:'failed', error:'invalid'}) + '\n'); process.exit(1); }
  const scenario = readScenario();
  if (scenario.exitWithoutResponse || scenario.exitWithoutResponseOperation === request.operation) {
    // A broker that dies after creating its task root leaves exactly the state
    // the host-owned recovery pass exists for.
    fs.mkdirSync(path.join(request.tasksRoot, request.taskId), {recursive:true});
    process.exit(3);
  }
  process.stdout.write(JSON.stringify(respond(request)) + '\n');
  process.exit(0);
});
process.stdin.on('end', () => process.exit(0));
