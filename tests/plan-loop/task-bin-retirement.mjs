// Small, authored lifecycle fixtures. No broker/engine/AppContainer is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {captureBinRetirement} = createRequire(import.meta.url)('../../plugins/craftmine-world/godot-task-bin-retirement.cjs');
const hash = text => createHash('sha256').update(text).digest('hex');
const names = ['Godot_v4.7.2-stable_win64.exe', 'broker-preflight.exe'];
const contents = ['tiny authored engine placeholder', 'tiny authored broker placeholder'];
const jobAck = {kind:'job', jobId:'fixture-job', record:{jobId:'fixture-job', status:'passed'}, ledgerFlushed:true};
const pfAck = {kind:'preflight', record:{executorId:'craftmine-windows-broker-v1', registered:true}};
const created = [];

async function fixture(operation = 'import') {
  const tasksRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-bin-retirement-'));
  created.push(tasksRoot); // Intentionally retained small evidence, never historical data.
  const requestId = {version:'pf-', import:'im-', exportWeb:'ex-'}[operation] + 'a'.repeat(24);
  const root = path.join(tasksRoot, requestId);
  for (const part of ['bin', 'logs', 'artifacts']) await fs.mkdir(path.join(root, part), {recursive:true});
  await fs.writeFile(path.join(root, 'logs', 'task.log'), 'diagnostic stays');
  await fs.writeFile(path.join(root, 'artifacts', 'index.pck'), 'artifact stays');
  const proof = {format:'craftmine.godot-bin-retirement/1', taskId:requestId, identityNonce:'b'.repeat(64),
    engineJobActiveProcesses:0, nativeJobActiveProcesses:0,
    files:names.map((name, i) => ({path:name, bytes:Buffer.byteLength(contents[i]), sha256:hash(contents[i])}))};
  for (let i = 0; i < 2; i++) await fs.writeFile(path.join(root, 'bin', names[i]), contents[i]);
  const identity = {schemaVersion:1, taskId:requestId, nonce:proof.identityNonce, createdAtUnixMs:1};
  await fs.writeFile(path.join(root, 'task-identity.json'), JSON.stringify(identity));
  await fs.writeFile(path.join(root, 'bin-retirement.json'), JSON.stringify(proof));
  const response = {schemaVersion:1, taskId:requestId, requestId, operation, state:'succeeded', exitCode:0, error:null,
    sourceBinding:{worldId:'fixture-world', buildId:'fixture-build', sourceRevision:1, sourceDigest:hash('source')},
    inputHash:hash('input'), sourceFiles:[{path:'main.gd', bytes:6, sha256:hash('source')}],
    processVerification:{verified:true}, networkPreflight:{verified:true, jobActiveProcesses:0},
    cleanup:{verified:true, profileHresult:0, workRemoved:true, error:null}, recoveryJournal:{cleared:true, error:null},
    brokerSha256:hash(contents[1]), binRetirement:proof};
  const run = {ok:true, exitCode:0, signal:null, cancelled:false, timedOut:false, oversized:false,
    parseError:null, recovery:null, journalRetired:true, response};
  run.closedTransport = {stdioClosed:true, exitSeen:true, exitMatches:true, exitCode:0, signal:null,
    response:structuredClone(response), parseError:null, streamError:null, stderr:'', stderrBytes:0,
    lateStderr:false, cancelled:false, timedOut:false, oversized:false};
  return {root, tasksRoot, response, proof, run, operation, identity, options:{tasksRoot, run, requestId, operation,
    expectedEngineSha256:hash(contents[0]), expectedBrokerSha256:hash(contents[1])}};
}

async function unchanged(f) {
  for (let i = 0; i < 2; i++) assert.equal(await fs.readFile(path.join(f.root, 'bin', names[i]), 'utf8'), contents[i]);
}

for (const operation of ['import', 'exportWeb', 'version']) {
  test(`${operation}: confirmed receipt retires only fixed copies, keeps complete evidence, idempotent`, async () => {
    const f = await fixture(operation), retire = captureBinRetirement(f.options);
    const ack = operation === 'version' ? pfAck : jobAck;
    const result = await retire(ack);
    assert.equal(result.state, 'retired', JSON.stringify(result));
    assert.equal(result.logicalBytes, contents.reduce((n, text) => n + Buffer.byteLength(text), 0));
    assert.deepEqual(await fs.readdir(path.join(f.root, 'bin')), []);
    assert.equal(await fs.readFile(path.join(f.root, 'logs', 'task.log'), 'utf8'), 'diagnostic stays');
    assert.equal(await fs.readFile(path.join(f.root, 'artifacts', 'index.pck'), 'utf8'), 'artifact stays');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root, 'task-identity.json'))), f.identity);
    const record = JSON.parse(await fs.readFile(path.join(f.root, 'bin-retirement-ack.json')));
    assert.deepEqual(record.brokerReceipt, f.response);
    assert.deepEqual(record.confirmation, ack);
    assert.deepEqual(await retire(ack), result);
  });
}

test('legacy broker is not enrolled; no disk writes or history scan', async () => {
  const f = await fixture(); delete f.response.binRetirement;
  const before = await fs.readdir(f.root);
  assert.equal(captureBinRetirement(f.options), null);
  await unchanged(f); assert.deepEqual(await fs.readdir(f.root), before);
});

test('transport, process, cleanup, recovery, pin and schema ambiguity are refused before mutation', async () => {
  const f = await fixture(), baseline = structuredClone(f.run);
  const cases = [
    run => { run.cancelled = true; }, run => { run.timedOut = true; }, run => { run.exitCode = null; },
    run => { run.signal = 'SIGKILL'; }, run => { run.parseError = 'lost reply'; },
    run => { run.recovery = {reclaimed:[]}; }, run => { run.journalRetired = false; },
    run => { run.response.state = 'failed'; }, run => { run.response.state = 'cancelled'; },
    run => { run.response.binRetirement.engineJobActiveProcesses = null; },
    run => { run.response.binRetirement.engineJobActiveProcesses = 1; },
    run => { run.response.binRetirement.nativeJobActiveProcesses = null; },
    run => { run.response.networkPreflight.jobActiveProcesses = 1; },
    run => { run.response.cleanup.workRemoved = false; },
    run => { run.response.recoveryJournal.error = 'not retired'; },
    run => { run.response.binRetirement.files[0].path = '../logs/task.log'; },
    run => { run.response.binRetirement.files[0].sha256 = hash('wrong'); },
    run => { run.response.binRetirement.identityNonce = ['b'.repeat(64)]; },
  ];
  for (const mutate of cases) {
    const run = structuredClone(baseline); mutate(run);
    assert.throws(() => captureBinRetirement({...f.options, run}), /GODOT_BIN_RETIREMENT_/);
  }
  await unchanged(f);
  assert.equal((await fs.readdir(f.root)).some(name => name.includes('-ack')), false);
});

test('core failed/refused/lost confirmation, unflushed ledger, or stop preserves all files', async () => {
  const f = await fixture();
  for (const ack of [null, {...jobAck, ledgerFlushed:false}, {...jobAck, record:{jobId:'fixture-job', status:'failed'}},
    {...jobAck, record:{jobId:'other-job', status:'passed'}}, {...jobAck, record:{status:'refused'}}]) {
    assert.equal((await captureBinRetirement(f.options)(ack)).state, 'preserved');
  }
  assert.equal((await captureBinRetirement(f.options)(jobAck, () => false)).state, 'preserved');
  await unchanged(f);
});

test('a stop after durable acknowledgment but before deletion preserves both copies', async () => {
  const f = await fixture(); let calls = 0;
  const result = await captureBinRetirement(f.options)(jobAck, () => ++calls === 1);
  assert.equal(result.state, 'preserved');
  await unchanged(f);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'bin-retirement-ack.json'))).confirmation.record.status, 'passed');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'bin-retirement-result.json'))).state, 'preserved');
});

for (const fault of ['nonce', 'registration', 'corrupt-marker', 'extra-file', 'wrong-hash', 'work', 'journal', 'ack-exists']) {
  test(`${fault}: refuse with bin and diagnostics intact`, async () => {
    const f = await fixture();
    if (fault === 'nonce') await fs.writeFile(path.join(f.root, 'task-identity.json'), JSON.stringify({...f.identity, nonce:'c'.repeat(64)}));
    if (fault === 'registration') await fs.writeFile(path.join(f.root, 'bin-retirement.json'), '{}');
    if (fault === 'corrupt-marker') await fs.writeFile(path.join(f.root, 'bin-retirement.json'), '{');
    if (fault === 'extra-file') await fs.writeFile(path.join(f.root, 'bin', 'unknown'), 'retained');
    if (fault === 'wrong-hash') await fs.writeFile(path.join(f.root, 'bin', names[1]), 'x'.repeat(contents[1].length));
    if (fault === 'work') await fs.mkdir(path.join(f.root, 'work'));
    if (fault === 'journal') {
      await fs.mkdir(path.join(f.tasksRoot, '.recovery-journal'));
      await fs.writeFile(path.join(f.tasksRoot, '.recovery-journal', f.options.requestId + '.json'), '{}');
    }
    if (fault === 'ack-exists') await fs.writeFile(path.join(f.root, 'bin-retirement-ack.json'), 'damaged prior ack retained');
    const before = await Promise.all(names.map(name => fs.readFile(path.join(f.root, 'bin', name))));
    const result = await captureBinRetirement(f.options)(jobAck);
    assert.equal(result.state, 'preserved', JSON.stringify(result));
    assert.deepEqual(await Promise.all(names.map(name => fs.readFile(path.join(f.root, 'bin', name)))), before);
    assert.equal(await fs.readFile(path.join(f.root, 'logs', 'task.log'), 'utf8'), 'diagnostic stays');
    if (fault === 'ack-exists') assert.equal(await fs.readFile(path.join(f.root, 'bin-retirement-ack.json'), 'utf8'), 'damaged prior ack retained');
  });
}

test.after(() => console.log(JSON.stringify({format:'authored-bin-retirement-fixtures/1', directories:created,
  actualEngine:false, actualSandbox:false, historicalProfilesTouched:false})));
