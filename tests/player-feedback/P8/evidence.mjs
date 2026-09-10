import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MODEL, ENDPOINT, REQUEST_LIMIT } from './relay.mjs';

export function ordinaryParents(file) {
  for (let current = path.dirname(file); ; current = path.dirname(current)) {
    const value = fs.lstatSync(current);
    assert.ok(value.isDirectory() && !value.isSymbolicLink(), 'P8_LINK_OR_NON_DIRECTORY');
    if (path.dirname(current) === current) break;
  }
}
// This small shared journal is retained across new profiles and relay restarts.
// A stale lock fails closed; this tool never deletes another run's lock.
export function openRequestJournal(file) {
  assert.ok(path.isAbsolute(file), 'P8_ABSOLUTE_JOURNAL_REQUIRED'); ordinaryParents(file);
  const lock = file + '.lock', owner = randomUUID();
  const lockFd = fs.openSync(lock, 'wx'); fs.writeFileSync(lockFd, JSON.stringify({ owner, pid: process.pid })); fs.fsyncSync(lockFd);
  let fd;
  try {
    if (fs.existsSync(file)) { const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 65536, 'P8_INVALID_JOURNAL_FILE'); }
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    assert.ok(!lines || lines.endsWith('\n'), 'P8_INCOMPLETE_JOURNAL');
    const entries = lines.trim() ? lines.trimEnd().split('\n').map(line => JSON.parse(line)) : [];
    assert.ok(entries.length <= REQUEST_LIMIT, 'P8_JOURNAL_OVER_BUDGET');
    for (const [index, row] of entries.entries()) assert.ok(row.format === 'craftmine.p8-admission/1' && row.attempt.id === index + 1 && row.attempt.requestedModel === MODEL && row.attempt.endpoint === ENDPOINT && ['hammer', 'dog'].includes(row.caseId), 'P8_JOURNAL_IDENTITY_MISMATCH');
    fd = fs.openSync(file, 'a'); let closed = false;
    return { entries, initialAttempts: entries.map(row => row.attempt),
      reserve(attempt, caseId, output) {
        assert.ok(!closed && entries.length < REQUEST_LIMIT && attempt.id === entries.length + 1 && ['hammer', 'dog'].includes(caseId), 'P8_ADMISSION_ORDER_OR_LIMIT');
        const entry = { format: 'craftmine.p8-admission/1', attempt, caseId, output };
        fs.writeSync(fd, JSON.stringify(entry) + '\n'); fs.fsyncSync(fd); entries.push(entry);
      },
      close() { if (closed) return; closed = true; fs.closeSync(fd); fs.closeSync(lockFd); assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).owner, owner); fs.unlinkSync(lock); },
    };
  } catch (error) { if (fd !== undefined) fs.closeSync(fd); fs.closeSync(lockFd); if (JSON.parse(fs.readFileSync(lock, 'utf8')).owner === owner) fs.unlinkSync(lock); throw error; }
}

export function normalizedProviderUsage(raw) {
  if (!raw) return null;
  const cacheRead = raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? raw.cached_tokens ?? 0;
  const cacheWrite = raw.prompt_tokens_details?.cache_write_tokens ?? 0;
  const input = Math.max(0, (raw.prompt_tokens ?? 0) - cacheRead - cacheWrite), output = raw.completion_tokens ?? 0;
  const reasoning = raw.completion_tokens_details?.reasoning_tokens ?? 0;
  for (const value of [input, output, cacheRead, cacheWrite, reasoning]) assert.ok(Number.isSafeInteger(value) && value >= 0, 'P8_INVALID_PROVIDER_USAGE');
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: reasoning, totalTokens: input + output + cacheRead + cacheWrite };
}
const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'];
export function reconcileMetrics(metrics, calls, upstream, binding) {
  assert.equal(metrics.format, 'craftmine.task-metrics/1'); assert.equal(metrics.sessionId, binding.sessionId);
  assert.ok(['completed', 'error', 'aborted'].includes(metrics.status)); assert.equal(metrics.calls.pending, 0);
  assert.ok(metrics.endedAtMs >= metrics.startedAtMs); assert.equal(metrics.wallTimeMs, metrics.endedAtMs - metrics.startedAtMs);
  assert.equal(metrics.calls.observed, calls.length);
  for (const call of calls) { assert.equal(call.providerId, binding.providerId); assert.equal(call.modelId, MODEL); }
  const reported = calls.filter(call => call.usage !== null); assert.equal(metrics.calls.reported, reported.length);
  if (reported.length) for (const key of keys) assert.equal((metrics.usage[key] ?? 0), reported.reduce((sum, call) => sum + (call.usage[key] ?? 0), 0), key);
  else assert.equal(metrics.usage, null);
  const raw = upstream.filter(item => item.passedTransport && item.sse?.usageReports?.length).map(item => normalizedProviderUsage(item.sse.usageReports.at(-1)));
  const normalizedCalls = reported.map(call => Object.fromEntries(keys.map(key => [key, call.usage[key] ?? 0])));
  assert.deepEqual(normalizedCalls.map(JSON.stringify).sort(), raw.map(JSON.stringify).sort(), 'P8_PROVIDER_USAGE_AND_DURABLE_CALLS_DIFFER');
  const windows = reported.filter(call => Number.isSafeInteger(call.generationStartedAtMs) && call.endedAtMs > call.generationStartedAtMs).sort((a, b) => a.generationStartedAtMs - b.generationStartedAtMs);
  const overlap = windows.some((call, i) => i > 0 && call.generationStartedAtMs < windows[i - 1].endedAtMs);
  if (!overlap && windows.length) {
    const ms = windows.reduce((sum, call) => sum + call.endedAtMs - call.generationStartedAtMs, 0), tokens = windows.reduce((sum, call) => sum + call.usage.outputTokens, 0);
    assert.equal(metrics.tps.generationMs, ms); assert.equal(metrics.tps.outputTokens, tokens); assert.ok(Math.abs(metrics.tps.value - tokens * 1000 / ms) < 1e-9);
  } else assert.equal(metrics.tps.value, null);
  assert.ok(metrics.models.every(model => model.providerId === binding.providerId && model.modelId === MODEL));
  return { rawRequests: upstream.length, providerUsageReports: raw.length, durableCalls: calls.length, coverage: metrics.coverage, tps: metrics.tps, timingNote: 'Relay and client measure different observation boundaries; TPS is recomputed from durable client timestamps, never relay timing.' };
}
