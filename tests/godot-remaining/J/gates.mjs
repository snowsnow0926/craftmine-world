// Evidence script for the GD8 dependency gates.
//
// It prints one JSON line per gate so the integrating task can re-run it and see
// that L3 work and L4 comparisons are actually blocked until GD7 and the frozen
// evaluation set exist. Pure logic: no browser, no Godot process, no input.
//
//   node tests/godot-remaining/J/gates.mjs
import fs from 'node:fs';

import {
  checkPartCompatibility, evaluateCandidate, measureBudget,
} from '../../../desktop/godot/extensions/index.mjs';
import { compareRuns, runExperiment, selectTools } from '../../../desktop/godot/strategy/index.mjs';

const here = new URL('./', import.meta.url);
const candidates = JSON.parse(fs.readFileSync(new URL('fixtures/l3-candidates.json', here), 'utf8')).candidates;

const lines = [];
const record = (gate, payload) => {
  const line = { gate, ...payload };
  lines.push(line);
  console.log(JSON.stringify(line));
};

for (const dossier of candidates) {
  const report = evaluateCandidate(dossier, { resolveEvidence: () => ({ ok: false, detail: '本环境没有该证据文件' }) });
  record(`l3-candidate:${dossier.candidateId}`, { status: report.status, failed: report.checks.filter(check => !check.passed).map(check => check.name) });
}

record('l3-native-without-validation', {
  status: checkPartCompatibility(
    { format: 'craftmine.godot-part-manifest/1', partId: 'x', partKind: 'perfComponent', version: '0.1.0', apiVersion: 1, engine: { name: 'godot', version: '4.7.2-stable' }, compatibleBases: [{ baseId: 'top-down', baseVersion: '>=1.0.0 <2.0.0', stateFormat: 'craftmine.godot-topdown-state/1' }], entry: { script: 'res://x/part.gdextension', language: 'gdextension' }, native: true, files: [], budgets: {}, license: {}, selfTests: [] },
    { baseId: 'top-down', baseVersion: '1.0.0', stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable' },
  ).passed ? 'allowed' : 'refused',
});

record('l3-budget-unmeasured', { status: measureBudget({ declared: { frameMsP95: 1, memoryBytes: null, packageBytes: null, measured: false } }).status });

const unfrozen = { format: 'craftmine.godot-strategy-taskset/1', frozen: false, frozenAt: '2026-09-10T00:00:00.000Z', frozenBy: 'acceptance-owner', scoringContract: 'sha256:pending', tasks: [{ taskId: 't1', baseId: 'top-down', baseVersion: '1.0.0', stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable', prompt: 'x' }] };
record('l4-run-without-frozen-set', { status: (await runExperiment({ taskSet: unfrozen, runAttempt: async () => ({ success: true }) })).reason });
record('l4-run-without-adapter', { status: (await runExperiment({ taskSet: { ...unfrozen, frozen: true } })).reason });

const context = { baseId: 'top-down', baseVersion: '1.0.0', stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable', availableCapabilities: [] };
const catalog = [{ toolId: 'a', bases: ['top-down'], engineVersions: ['4.6.0-stable'] }];
record('l4-candidate-filters', {
  baseline: selectTools({ task: {}, catalog, context, arm: 'baseline' }).tools.length,
  candidate: selectTools({ task: {}, catalog, context, arm: 'candidate' }).tools.length,
});

record('l4-compare-different-task-sets', { status: compareRuns({ format: 'craftmine.godot-strategy-run/1', status: 'completed', taskSet: { digest: 'a' } }, { format: 'craftmine.godot-strategy-run/1', status: 'completed', taskSet: { digest: 'b' } }).reason });

const blocked = lines.filter(line => line.status === 'not-ready' || line.status === 'refused' || line.status === 'evaluation-set-not-frozen' || line.status === 'no-attempt-adapter');
console.log(JSON.stringify({ gates: lines.length, blocked: blocked.length, note: '阻断是预期结果：GD8 在 GD7 与冻结评测集就绪前不得开工' }));
