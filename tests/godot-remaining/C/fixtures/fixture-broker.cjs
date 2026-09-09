'use strict';
// Scripted stand-in for the pinned broker, used only by the protocol tests.
//
// It speaks the real BROKER_PROTOCOL_V1 framing (one JSON line in, one JSON
// line out, stdin kept open, {"cancel":true} cancels) so the supervisor's
// validation, digest comparison, cancellation and tamper handling can be
// exercised deterministically. It is never part of the product path.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

const sha256 = value => createHash('sha256').update(value).digest('hex');
function readScenario() {
  const file = process.env.CRAFTMINE_FIXTURE_BROKER_FILE;
  if (file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
  try { return JSON.parse(process.env.CRAFTMINE_FIXTURE_BROKER ?? '{}'); } catch { return {}; }
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
  const log = scenario.log ?? (scenario.logLines ?? ['Godot Engine v4.7.2.stable.official.ed1daf0bf\n']).join('');
  fs.writeFileSync(path.join(logsRoot, 'task.log'), log);
  fs.writeFileSync(path.join(logsRoot, 'preflight.json'), JSON.stringify({winsockStartup:0, checks:[]}));

  let sourceFiles = request.operation === 'version' ? [] : listFiles(request.projectRoot);
  if (request.operation !== 'version') {
    if (scenario.dropSourceFile) sourceFiles = sourceFiles.filter(file => file.path !== scenario.dropSourceFile);
    if (scenario.addSourceFile) sourceFiles = [...sourceFiles, {path:scenario.addSourceFile, bytes:3, sha256:sha256('abc')}]
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    if (scenario.changeSourceFile) sourceFiles = sourceFiles.map(file => file.path === scenario.changeSourceFile ? {...file, sha256:sha256('tampered')} : file);
  }
  let digest = sha256(JSON.stringify(sourceFiles));
  if (request.operation !== 'version' && scenario.tamperSourceDigest) digest = sha256('tampered-digest');

  const artifacts = [];
  if (request.operation === 'exportWeb') {
    const files = scenario.artifacts ?? {'index.html':'<!doctype html><canvas id="canvas"></canvas>', 'index.js':'// game', 'bridge.js':'// authored bridge'};
    for (const [relative, body] of Object.entries(files)) {
      const target = path.join(artifactsRoot, relative);
      fs.mkdirSync(path.dirname(target), {recursive:true});
      fs.writeFileSync(target, body);
      artifacts.push({path:relative, bytes:Buffer.byteLength(body), sha256:sha256(body)});
    }
    if (scenario.extraArtifact) {
      fs.writeFileSync(path.join(artifactsRoot, scenario.extraArtifact), 'unlisted');
    }
    if (scenario.tamperArtifact) {
      const entry = artifacts.find(item => item.path === scenario.tamperArtifact);
      if (entry) entry.sha256 = sha256('tampered');
    }
  }

  const verification = scenario.processVerified === false ? {verified:false, policyVersion:'craftmine.windows.lpac-registry.v1'}
    : {verified:true, policyVersion:'craftmine.windows.lpac-registry.v1', pid:4242, isAppContainer:true, jobMembershipVerified:true, resumePreviousCount:1};
  const preflight = scenario.networkVerified === false ? {verified:false, policyVersion:'craftmine.windows.lpac-registry.v1'}
    : {verified:true, policyVersion:'craftmine.windows.lpac-registry.v1', observation:{winsockStartup:0, checks:[{name:'tcp4', ok:false, rawOsError:10013}]}};
  const response = {
    schemaVersion:1,
    requestId: scenario.omitRequestId ? undefined : request.requestId,
    taskId: request.taskId,
    operation: request.operation,
    sourceBinding: request.sourceBinding,
    inputHash: scenario.echoInputHash ?? request.inputHash,
    sourceSnapshotDigest: digest,
    sourceFiles,
    state: scenario.state ?? 'succeeded',
    exitCode: scenario.exitCode === undefined ? 0 : scenario.exitCode,
    policyVersion: scenario.policyVersion ?? 'craftmine.windows.lpac-registry.v1',
    processVerification: verification,
    networkPreflight: preflight,
    artifacts,
    artifactsRoot,
    logsRoot,
    logs:[{path:'task.log', bytes:Buffer.byteLength(log), sha256:sha256(log)}],
    cleanup: scenario.cleanupVerified === false ? {verified:false, profileHresult:1, workRemoved:false, error:'cleanup failed'}
      : {verified:true, profileHresult:0, workRemoved:true, error:null},
    error: scenario.error ?? null,
    brokerSha256: scenario.brokerSha256 ?? sha256(fs.readFileSync(process.env.CRAFTMINE_GODOT_BROKER_BIN)),
  };
  return response;
}

let buffer = '';
let answered = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (answered) {
    // Any input after the request cancels, exactly like the real broker.
    if (/"cancel"\s*:\s*true/.test(chunk)) { process.stdout.write(JSON.stringify({schemaVersion:1, state:'cancelled'}) + '\n'); process.exit(0); }
    return;
  }
  buffer += chunk;
  if (!buffer.includes('\n')) return;
  if (Buffer.byteLength(buffer) > 65536) { process.stdout.write(JSON.stringify({schemaVersion:1, state:'failed', error:'oversized'}) + '\n'); process.exit(1); }
  answered = true;
  let request;
  try { request = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); }
  catch { process.stdout.write(JSON.stringify({schemaVersion:1, state:'failed', error:'invalid'}) + '\n'); process.exit(1); }
  const scenario = readScenario();
  const emit = () => {
    if (scenario.exitWithoutResponse) process.exit(3);
    process.stdout.write(JSON.stringify(respond(request)) + '\n');
    if (scenario.exitAfterResponse === false) return;
    process.exit(0);
  };
  if (scenario.hangForever) return;
  if (scenario.delayMs) setTimeout(emit, scenario.delayMs); else emit();
});
process.stdin.on('end', () => process.exit(0));
