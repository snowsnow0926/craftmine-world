'use strict';
// Private lifecycle helper, not an RPC, scanner, or recovery mechanism. A
// capability is captured only from a successful broker invocation in memory.
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const FORMAT = 'craftmine.godot-bin-retirement/1';
const NAMES = ['Godot_v4.7.2-stable_win64.exe', 'broker-preflight.exe'];
const MAX_RECEIPT = 8 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const fail = reason => { throw Error('GODOT_BIN_RETIREMENT_' + reason); };
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && b.nlink === 1;

async function directory(value) {
  for (let current = path.resolve(value); ; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('DIRECTORY_INVALID');
    // Includes junctions and redirected ancestors, without following them for
    // any write. Windows' canonical spelling is compared case-insensitively.
    const normalize = p => process.platform === 'win32' ? p.toLowerCase() : p;
    if (normalize(await fs.realpath(current)) !== normalize(current)) fail('DIRECTORY_REDIRECTED');
    if (path.dirname(current) === current) break;
  }
}

async function ordinaryFile(file, max) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > max) fail('FILE_INVALID');
  return stat;
}

async function readJson(file, max) {
  const before = await ordinaryFile(file, max);
  const handle = await fs.open(file, 'r');
  try {
    if (!sameFile(before, await handle.stat())) fail('FILE_CHANGED');
    const bytes = Buffer.alloc(before.size);
    let read = 0;
    while (read < bytes.length) {
      const result = await handle.read(bytes, read, bytes.length - read, read);
      if (!result.bytesRead) fail('FILE_CHANGED');
      read += result.bytesRead;
    }
    if (!sameFile(before, await handle.stat())) fail('FILE_CHANGED');
    return JSON.parse(bytes.toString('utf8'));
  } finally { await handle.close(); }
}

async function verifiedFile(file, expected) {
  const before = await ordinaryFile(file, 256 * 1024 * 1024);
  if (before.size !== expected.bytes) fail('SIZE_MISMATCH');
  const handle = await fs.open(file, 'r');
  try {
    if (!sameFile(before, await handle.stat())) fail('FILE_CHANGED');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let offset = 0;
    while (offset < before.size) {
      const {bytesRead} = await handle.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (!bytesRead) fail('FILE_CHANGED');
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    if (!sameFile(before, await handle.stat()) || hash.digest('hex') !== expected.sha256) fail('HASH_MISMATCH');
    return before;
  } finally { await handle.close(); }
}

async function writeNew(file, value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_RECEIPT) fail('RECEIPT_TOO_LARGE');
  await directory(path.dirname(file));
  const handle = await fs.open(file, 'wx');
  try {
    if ((await handle.stat()).nlink !== 1) fail('FILE_INVALID');
    await handle.writeFile(text, 'utf8'); await handle.sync();
  } finally { await handle.close(); }
  if (!isDeepStrictEqual(await readJson(file, MAX_RECEIPT), value)) fail('RECEIPT_NOT_DURABLE');
}

/** Caller must already have validated the broker's source/policy/artifact
 * receipt against this exact request and pinned toolchain. No stored ledger
 * is accepted here, and no capability is reconstructed on startup. */
function captureBinRetirement({tasksRoot, run, requestId, operation, expectedEngineSha256, expectedBrokerSha256}) {
  if (!run?.response?.binRetirement) return null; // Legacy tasks are never enrolled.
  const raw = JSON.stringify(run.response);
  if (Buffer.byteLength(raw) > MAX_RECEIPT) fail('RECEIPT_TOO_LARGE');
  const receipt = JSON.parse(raw);
  const proof = receipt.binRetirement;
  if (typeof tasksRoot !== 'string' || !path.isAbsolute(tasksRoot) || typeof requestId !== 'string'
      || !/^(pf|im|ex)-[a-f0-9]{24}$/.test(requestId)) fail('TASK_INVALID');
  if (!['version', 'import', 'exportWeb'].includes(operation)) fail('OPERATION_INVALID');
  if (!requestId.startsWith({version:'pf-', import:'im-', exportWeb:'ex-'}[operation])) fail('TASK_INVALID');
  if (run.ok !== true || run.exitCode !== 0 || run.signal != null || run.cancelled || run.timedOut || run.oversized
      || run.parseError || run.recovery || run.journalRetired !== true) fail('TRANSPORT_UNCONFIRMED');
  if (receipt.taskId !== requestId || receipt.requestId !== requestId || receipt.operation !== operation
      || receipt.state !== 'succeeded' || receipt.exitCode !== 0 || receipt.error !== null
      || receipt.cleanup?.verified !== true || receipt.cleanup.profileHresult !== 0
      || receipt.cleanup.workRemoved !== true || receipt.cleanup.error !== null
      || receipt.recoveryJournal?.cleared !== true || receipt.recoveryJournal.error !== null
      || receipt.processVerification?.verified !== true || receipt.networkPreflight?.verified !== true
      || receipt.networkPreflight.jobActiveProcesses !== 0) fail('BROKER_UNCONFIRMED');
  if (proof.format !== FORMAT || proof.taskId !== requestId || typeof proof.identityNonce !== 'string' || !SHA.test(proof.identityNonce)
      || proof.engineJobActiveProcesses !== 0 || proof.nativeJobActiveProcesses !== 0
      || !Array.isArray(proof.files) || proof.files.length !== 2
      || typeof expectedEngineSha256 !== 'string' || !SHA.test(expectedEngineSha256)
      || typeof expectedBrokerSha256 !== 'string' || !SHA.test(expectedBrokerSha256)
      || receipt.brokerSha256 !== expectedBrokerSha256) fail('PROOF_INVALID');
  const hashes = [expectedEngineSha256, expectedBrokerSha256];
  for (let i = 0; i < 2; i++) {
    const file = proof.files[i];
    if (file.path !== NAMES[i] || file.sha256 !== hashes[i] || !Number.isSafeInteger(file.bytes)
        || file.bytes <= 0 || file.bytes > 256 * 1024 * 1024) fail('PIN_INVALID');
  }
  const root = path.join(tasksRoot, requestId), bin = path.join(root, 'bin');
  let operationPromise;
  return (confirmation, stillEligible = () => true) => {
    if (operationPromise) return operationPromise; // Idempotent in this live invocation only.
    operationPromise = (async () => {
      const removed = [];
      let acknowledged = false;
      try {
        if (!stillEligible()) fail('ACK_UNCONFIRMED');
        if (operation === 'version') {
          if (confirmation?.kind !== 'preflight' || confirmation.record?.registered !== true
              || confirmation.record.executorId !== 'craftmine-windows-broker-v1') fail('ACK_UNCONFIRMED');
        } else if (confirmation?.kind !== 'job' || typeof confirmation.jobId !== 'string'
            || confirmation.record?.jobId !== confirmation.jobId || confirmation.record.status !== 'passed'
            || confirmation.ledgerFlushed !== true) fail('ACK_UNCONFIRMED');
        await directory(bin);
        const identity = await readJson(path.join(root, 'task-identity.json'), 4096);
        if (identity.schemaVersion !== 1 || identity.taskId !== requestId || identity.nonce !== proof.identityNonce) fail('IDENTITY_MISMATCH');
        if (!isDeepStrictEqual(await readJson(path.join(root, 'bin-retirement.json'), 8192), proof)) fail('REGISTRATION_MISMATCH');
        // Recovery/cleanup still pending means preservation, even if another
        // response field incorrectly claimed completion.
        try { await directory(path.join(tasksRoot, '.recovery-journal')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        for (const candidate of [path.join(root, 'work'), path.join(tasksRoot, '.recovery-journal', requestId + '.json')]) {
          try { await fs.lstat(candidate); fail('RECOVERY_PENDING'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        const names = await fs.readdir(bin);
        if (!isDeepStrictEqual(names.sort(), [...NAMES].sort())) fail('BIN_SET_CHANGED');
        const stats = [];
        for (let i = 0; i < 2; i++) stats.push(await verifiedFile(path.join(bin, NAMES[i]), proof.files[i]));
        await writeNew(path.join(root, 'bin-retirement-ack.json'), {
          format:'craftmine.godot-bin-retirement-ack/1', brokerReceipt:receipt, confirmation,
        });
        acknowledged = true;
        // No recursive removal, no unknown entries, no artifact/log/source
        // mutation. All files are verified before removing the first one.
        await directory(bin);
        for (let i = 0; i < 2; i++) {
          if (!sameFile(stats[i], await ordinaryFile(path.join(bin, NAMES[i]), 256 * 1024 * 1024))) fail('FILE_CHANGED');
        }
        if (!stillEligible()) fail('ACK_UNCONFIRMED');
        for (let i = 0; i < 2; i++) {
          await fs.unlink(path.join(bin, NAMES[i])); removed.push(proof.files[i]);
        }
        const result = {state:'retired', taskId:requestId, files:removed, logicalBytes:removed.reduce((n, file) => n + file.bytes, 0)};
        await writeNew(path.join(root, 'bin-retirement-result.json'), result);
        return result;
      } catch (error) {
        // Never reinterpret a confirmed build as failed because optional
        // retirement failed. Partial removals are explicit and not retried.
        const result = {state:removed.length ? 'partial' : 'preserved', taskId:requestId,
          files:removed, reason:String(error?.message ?? error).slice(0, 600)};
        if (acknowledged) {
          try { await writeNew(path.join(root, 'bin-retirement-result.json'), result); }
          catch { result.resultPersisted = false; }
        }
        return result;
      }
    })();
    return operationPromise;
  };
}

module.exports = {captureBinRetirement};
