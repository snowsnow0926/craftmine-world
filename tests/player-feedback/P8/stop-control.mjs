import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ordinaryParents } from './evidence.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const terminal = new Set(['completed', 'aborted', 'error']);
const busy = error => /^(?:Error: )?P8_BUSY$/.test(error.message);
async function bounded(fn, ms, code) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]); }
  finally { clearTimeout(timer); }
}

// Only the driver owns these callbacks. A request file cannot choose an IPC
// method, session, path, script, provider or network destination, and it cannot
// rebind the run: it only asks the driver to abort the turn the driver already
// owns, or the live turn of the run it already owns.

const turnRequest = {
  keys: 'action,caseId,format,turnId',
  format: 'craftmine.p8-stop/1',
  fields: ['action', 'caseId', 'format', 'turnId'],
};
const runRequest = {
  keys: 'action,caseId,format,runId',
  format: 'craftmine.p8-run-stop/1',
  fields: ['action', 'caseId', 'format', 'runId'],
};

function readBounded(file, code) {
  let fd;
  try {
    ordinaryParents(file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024) return { status: 'rejected', reason: code + '_FILE_REJECTED', digest: 'file' };
    fd = fs.openSync(file, 'r'); const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > 1024) return { status: 'rejected', reason: code + '_FILE_CHANGED', digest: 'changed' };
    const bytes = Buffer.alloc(1025), count = fs.readSync(fd, bytes, 0, bytes.length, 0), raw = bytes.subarray(0, count);
    const digest = createHash('sha256').update(raw).digest('hex');
    if (count !== opened.size || count > 1024 || !Buffer.from(raw.toString('utf8')).equals(raw)) return { status: 'rejected', reason: code + '_FILE_CHANGED', digest };
    let value; try { value = JSON.parse(raw.toString('utf8')); } catch { return { status: 'rejected', reason: code + '_INVALID_JSON', digest }; }
    return { status: 'value', value, digest };
  } catch (error) { if (error.code === 'ENOENT') return { status: 'missing' }; return { status: 'rejected', reason: code + '_READ_FAILED', digest: String(error.code ?? 'read') }; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function createStopControl({ out, abort, snapshot, record = () => {}, runId, abortMs = 30000, terminalMs = 90000, pollMs = 250 }) {
  if (!path.isAbsolute(out) || typeof abort !== 'function' || typeof snapshot !== 'function') throw Error('P8_STOP_CONFIGURATION');
  const file = path.join(out, 'stop-request.json'), runFile = path.join(out, 'run-stop.json');
  ordinaryParents(file);
  let operation, binding, rejectedHash;
  function reject(reason, digest) {
    if (digest !== rejectedHash) { rejectedHash = digest; record({ status: 'rejected', reason }); }
    return null;
  }
  function missingKey(request, value) { return request.fields.some(field => !(field in value)) || Object.keys(value).sort().join(',') !== request.keys; }
  /** Turn-scoped request: exact case, exact live turn. */
  function read(current) {
    const incoming = readBounded(file, 'P8_STOP');
    if (incoming.status === 'missing') return null;
    if (incoming.status === 'rejected') return reject(incoming.reason, incoming.digest);
    const value = incoming.value;
    if (!value || Array.isArray(value) || missingKey(turnRequest, value) || value.format !== turnRequest.format || value.action !== 'abort' || !['hammer', 'dog'].includes(value.caseId) || !uuid.test(value.turnId)) return reject('P8_STOP_INVALID_REQUEST', incoming.digest);
    if (value.caseId !== current.caseId || value.turnId !== current.turnId) return reject('P8_STOP_STALE_IDENTITY', incoming.digest);
    return value;
  }
  function readRun(current) {
    if (typeof runId !== 'string' || !runId.length) return null;
    const incoming = readBounded(runFile, 'P8_RUN_STOP');
    if (incoming.status === 'missing') return null;
    if (incoming.status === 'rejected') return reject(incoming.reason, incoming.digest);
    const value = incoming.value;
    if (!value || Array.isArray(value) || missingKey(runRequest, value) || value.format !== runRequest.format || value.action !== 'abort' || !['hammer', 'dog'].includes(value.caseId)) return reject('P8_RUN_STOP_INVALID_REQUEST', incoming.digest);
    if (value.caseId !== current.caseId || value.runId !== runId) return reject('P8_RUN_STOP_STALE_IDENTITY', incoming.digest);
    record({ status: 'run-stop-accepted', ...current, runId });
    return value;
  }
  async function sample(current, deadline) {
    while (Date.now() < deadline) {
      try {
        const value = await bounded(() => snapshot(current.caseId), Math.max(1, deadline - Date.now()), 'P8_STOP_TERMINAL_TIMEOUT');
        if (value.sessionId !== current.sessionId || value.caseId !== current.caseId || typeof value.active !== 'boolean') throw Error('P8_STOP_SNAPSHOT_IDENTITY');
        if (!value.metrics) { await delay(pollMs); continue; }
        if (value.metrics.turnId !== current.turnId) throw Error('P8_STOP_TURN_CHANGED');
        if (value.metrics.sessionId !== current.sessionId) throw Error('P8_STOP_METRICS_IDENTITY');
        return value;
      } catch (error) { if (!busy(error)) throw error; await delay(pollMs); }
    }
    throw Error('P8_STOP_TERMINAL_TIMEOUT');
  }
  const isTerminal = value => !value.active && terminal.has(value.metrics.status) && value.metrics.calls?.pending === 0;
  async function execute(current) {
    const requestedAt = new Date().toISOString(); record({ status: 'requested', ...current, requestedAt });
    // Check the bound live turn before invoking the session-scoped product abort.
    let last = await sample(current, Date.now() + abortMs), acknowledged = false, abortError;
    if (!isTerminal(last)) {
      const deadline = Date.now() + abortMs;
      while (Date.now() < deadline) {
        try {
          const reply = await bounded(() => abort(current.caseId), Math.max(1, deadline - Date.now()), 'P8_STOP_ABORT_TIMEOUT');
          if (!reply || Object.keys(reply).join(',') !== 'ok' || reply.ok !== true) throw Error('P8_STOP_ABORT_REPLY');
          acknowledged = true; break;
        } catch (error) {
          // P8_BUSY is a proven pre-dispatch refusal. Unknown/lost responses are
          // never retried; the terminal read below still records the outcome.
          if (!busy(error)) { abortError = String(error); break; }
          await delay(pollMs);
        }
      }
      if (!acknowledged && !abortError) abortError = 'P8_STOP_ABORT_TIMEOUT';
      const terminalDeadline = Date.now() + terminalMs;
      do {
        last = await sample(current, terminalDeadline);
        if (isTerminal(last)) break;
        await delay(pollMs);
      } while (Date.now() < terminalDeadline);
      if (!isTerminal(last)) throw Error('P8_STOP_TERMINAL_TIMEOUT');
    }
    const result = { status: 'stopped', ...current, requestedAt, finishedAt: new Date().toISOString(), acknowledged, terminalStatus: last.metrics.status, cleanAbort: !abortError, ...(abortError ? { abortError } : {}), snapshot: last };
    record(result); return result;
  }
  return { file, runFile,
    get requested() { return operation !== undefined; },
    check(current) {
      if (!current || !['hammer', 'dog'].includes(current.caseId) || !uuid.test(current.turnId) || !uuid.test(current.sessionId)) throw Error('P8_STOP_BINDING_REQUIRED');
      if (operation) {
        if (binding.caseId !== current.caseId || binding.turnId !== current.turnId || binding.sessionId !== current.sessionId) throw Error('P8_STOP_ALREADY_BOUND');
        return operation;
      }
      if (!readRun(current) && !read(current)) return Promise.resolve(null);
      binding = { ...current };
      operation = execute(binding).catch(error => { record({ status: 'failed', ...binding, error: String(error) }); throw error; });
      return operation;
    },
  };
}
