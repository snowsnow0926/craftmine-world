// Evidence bundle writer for task I.
// Every round produces a self-describing directory: raw request, raw model
// output, before/after state, screenshots, usage accounting (unknown preserved),
// failures, human interventions and a sha256 of every file it contains.
import fs from 'node:fs';
import path from 'node:path';
import { sha256File, sha256Text, sha256Buffer } from './frozen.mjs';
import { secretLeaks } from './identity.mjs';
import { classifyFailure, summarizeFailures } from './classify.mjs';

export const EVIDENCE_FORMAT = 'craftmine.i.evidence/1';

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function hashTree(dir) {
  const entries = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      entries.push({ path: path.relative(dir, full).split(path.sep).join('/'), sha256: sha256File(full), bytes: fs.statSync(full).size });
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return entries;
}

// Usage accounting: an unreported field is `unknown`, never 0.
export function usageAccounting(records = []) {
  const stage = records[0]?.stage ?? 'creation';
  const totals = { calls: 0, promptTokens: 0, cachedReadTokens: 0, nonCachedInputTokens: 0, outputTokens: 0, totalTokens: 0, unknownCalls: 0 };
  for (const record of records) {
    totals.calls += 1;
    let any = false;
    for (const [from, to] of [['promptTokens', 'promptTokens'], ['cachedReadTokens', 'cachedReadTokens'], ['nonCachedInputTokens', 'nonCachedInputTokens'], ['outputTokens', 'outputTokens'], ['totalTokens', 'totalTokens']]) {
      if (typeof record[from] === 'number' && Number.isFinite(record[from])) { totals[to] += record[from]; any = true; }
    }
    // An explicit unknown count from the source is authoritative; otherwise an
    // unreported call counts as one unknown call.
    if (typeof record.unknownCalls === 'number' && Number.isFinite(record.unknownCalls)) totals.unknownCalls += record.unknownCalls;
    else if (!any) totals.unknownCalls += 1;
  }
  return { format: 'craftmine.i.usage/1', stage, ...totals, reportedBy: records.map(record => record.source ?? 'model-usage').filter(Boolean) };
}

export function createEvidenceBundle({ root, roundId, mode, identity }) {
  const dir = ensure(path.join(root, roundId));
  const files = [];
  const usageRecords = [];
  const failures = [];
  const interventions = [];
  const artifacts = [];
  let sealed = null;

  const record = (name, value) => {
    const file = path.join(dir, name);
    const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
    ensure(path.dirname(file));
    fs.writeFileSync(file, text);
    files.push(path.relative(dir, file).split(path.sep).join('/'));
    return file;
  };
  const recordArtifact = (name, buffer) => {
    const file = path.join(dir, name);
    ensure(path.dirname(file));
    fs.writeFileSync(file, buffer);
    artifacts.push({ path: path.relative(dir, file).split(path.sep).join('/'), bytes: buffer.length, sha256: sha256Buffer(buffer) });
    files.push(path.relative(dir, file).split(path.sep).join('/'));
    return file;
  };

  return {
    format: EVIDENCE_FORMAT,
    roundId,
    mode,
    dir,
    get files() { return [...files]; },
    rawRequest(text) { return record('request.raw.txt', text); },
    rawResponse(text) { return record('response.raw.txt', text); },
    writeJson(name, value) { return record(name, value); },
    screenshot(name, buffer) { return recordArtifact(name, buffer); },
    before(state) { return record('state.before.json', state); },
    after(state) { return record('state.after.json', state); },
    usage(record_) { usageRecords.push(record_); return record_; },
    failure(entry) {
      const classified = entry.class ? entry : { ...entry, ...classifyFailure(entry) };
      failures.push(classified);
      return classified;
    },
    intervention(entry) { interventions.push({ at: new Date().toISOString(), ...entry }); return entry; },
    get failures() { return failures; },
    get usageRecords() { return usageRecords; },
    usageAccounting() { return usageAccounting(usageRecords); },
    failureSummary() { return summarizeFailures(failures); },
    // Sealing refuses to emit a passing bundle that contains a credential leak.
    finalize({ verdict, reasons = [], notes = null } = {}) {
      if (sealed) return sealed;
      const leaks = files.flatMap(relative => secretLeaks(fs.readFileSync(path.join(dir, relative), 'utf8')).map(leak => ({ file: relative, ...leak })));
      if (leaks.length) throw new Error(`evidence contains credential-shaped values: ${JSON.stringify(leaks)}`);
      const manifest = {
        format: EVIDENCE_FORMAT,
        roundId,
        mode,
        verdict,
        reasons,
        notes,
        identity,
        usage: usageAccounting(usageRecords),
        failures,
        interventions,
        artifacts,
        files: hashTree(dir),
        sealedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(dir, 'evidence.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      sealed = { ...manifest, dir };
      return sealed;
    },
    get sealed() { return sealed; },
  };
}

export function readEvidence(dir) {
  const file = path.join(dir, 'evidence.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
