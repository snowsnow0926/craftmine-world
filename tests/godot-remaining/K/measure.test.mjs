import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const core = await import(new URL('../../../desktop/delivery/lib/measure-core.mjs', import.meta.url).href);
const measurePath = fileURLToPath(new URL('../../../desktop/delivery/measure.mjs', import.meta.url));
const corePath = fileURLToPath(new URL('../../../desktop/delivery/lib/measure-core.mjs', import.meta.url));

test('nearest-rank percentile is exact and deterministic', () => {
  assert.equal(core.nearestRank([1, 2, 3, 4, 5], 50), 3);
  assert.equal(core.nearestRank([1, 2, 3, 4, 5], 95), 5);
  assert.equal(core.nearestRank([10, 20], 50), 10);
  assert.equal(core.nearestRank([10, 20], 100), 20);
  assert.equal(core.nearestRank([7], 95), 7);
  assert.equal(core.nearestRank([], 50), null);
  assert.equal(core.percentile([5, 1, 3], 50), 3);
  assert.equal(core.percentile([], 50), null);
  assert.throws(() => core.nearestRank([1], 0));
  assert.throws(() => core.nearestRank([1], 101));
});

test('summary uses nearest-rank p50/p95 with deterministic rounding', () => {
  const summary = core.summarize([1, 2, 3, 4, 5]);
  assert.deepEqual(summary, {count: 5, p50: 3, p95: 5, min: 1, max: 5});
  assert.deepEqual(core.summarize([]), {count: 0, p50: null, p95: null, min: null, max: null});
  assert.equal(core.round(1.23456, 3), 1.235);
  assert.equal(core.round(-1.23456, 3), -1.235);
  assert.equal(core.round(0.0005, 3), 0.001);
  assert.equal(core.round(Number.NaN), null);
});

test('verdict is fail over threshold, unmeasured without samples or threshold', () => {
  assert.equal(core.verdictFor([1, 2, 3], {max: 2}), 'fail');
  assert.equal(core.verdictFor([1, 2, 3], {max: 10}), 'pass');
  assert.equal(core.verdictFor([], {max: 1}), 'unmeasured');
  assert.equal(core.verdictFor([1], null), 'unmeasured');
  assert.equal(core.verdictFor([1], {max: null, min: null, status: 'frozen'}), 'unmeasured');
  assert.equal(core.verdictFor([5], {max: 1, status: 'pending-real-sample'}), 'unmeasured');
  assert.equal(core.verdictFor([1, 2], {min: 5}), 'fail');
  assert.equal(core.verdictFor([5, 6], {min: 1}), 'pass');
});

test('cold/warm labelling rule is index 0 cold, later warm', () => {
  assert.match(core.COLD_WARM_RULE, /index 0 = cold/);
  assert.equal(core.coldWarmLabel(0), 'cold');
  assert.equal(core.coldWarmLabel(1), 'warm');
  assert.equal(core.coldWarmLabel(29), 'warm');
  assert.deepEqual(core.coldWarmLabels(3), ['cold', 'warm', 'warm']);
  assert.throws(() => core.coldWarmLabel(-1));
});

test('sample classification separates real-engine, synthetic-index and skipped', () => {
  assert.equal(core.classifySource('real-engine'), 'real-engine');
  assert.equal(core.classifySource('real-client'), 'real-client');
  assert.equal(core.classifySource('real-process'), 'real-process');
  assert.equal(core.classifySource('real-git'), 'real-git');
  assert.equal(core.classifySource('synthetic-index'), 'synthetic-index');
  assert.equal(core.classifySource('skipped'), 'skipped');
  assert.equal(core.classifySource('invented'), 'unknown');
  const synthetic = core.metric({
    name: 'assets.search.synthetic-1000.ms', unit: 'ms', samples: [1, 2, 3],
    source: 'synthetic-index', process: 'test', threshold: {max: null, min: null, status: 'pending-real-sample'},
  });
  assert.equal(synthetic.source, 'synthetic-index');
  assert.equal(synthetic.verdict, 'unmeasured');
});

test('metric record carries every required field', () => {
  const item = core.metric({
    name: 'git.log.ms', unit: 'ms', samples: [40, 50, 60], source: 'real-git',
    process: 'git.exe', threshold: {max: 500, min: null, status: 'frozen'},
  });
  for (const key of ['name', 'unit', 'samples', 'count', 'p50', 'p95', 'min', 'max', 'source', 'process', 'threshold', 'verdict']) {
    assert.ok(Object.hasOwn(item, key), `missing ${key}`);
  }
  assert.equal(item.count, 3);
  assert.equal(item.verdict, 'pass');
  const skipped = core.skippedMetric('waits.install.ms', 'not run', 'run it manually');
  assert.deepEqual(Object.keys(skipped).sort(), ['howToEnable', 'metric', 'reason', 'unit']);
});

test('record schema shape validates and rejects malformed records', () => {
  const record = core.buildRecord({
    generatedAt: '2026-09-09T17:00:00.000Z',
    commit: 'abc123',
    environment: {os: 'win32', node: 'v24', cpu: 'cpu', logicalCpus: 8, totalRamBytes: 1024},
    suites: [{
      id: 'git',
      metrics: [core.metric({name: 'git.log.ms', unit: 'ms', samples: [1, 2], source: 'real-git', process: 'git.exe', threshold: {max: 10}})],
      skipped: [core.skippedMetric('waits.install.ms', 'not run', 'run it')],
    }],
    limits: ['test limit'],
  });
  assert.equal(record.format, 'craftmine.measurement/1');
  assert.deepEqual(core.validateRecord(record), {ok: true, errors: []});
  const broken = structuredClone(record);
  broken.suites[0].metrics[0].verdict = 'maybe';
  const brokenResult = core.validateRecord(broken);
  assert.equal(brokenResult.ok, false);
  assert.ok(brokenResult.errors.some(error => error.includes('verdict')));
  const missing = structuredClone(record);
  delete missing.commit;
  assert.equal(core.validateRecord(missing).ok, false);
});

test('failing and unmeasured helpers scan every suite', () => {
  const record = core.buildRecord({
    environment: {os: 'x', node: 'x', cpu: 'x', logicalCpus: 1, totalRamBytes: 1},
    suites: [
      {id: 'a', metrics: [core.metric({name: 'a.ms', unit: 'ms', samples: [100], source: 'real-git', process: 'p', threshold: {max: 1}})], skipped: []},
      {id: 'b', metrics: [core.metric({name: 'b.ms', unit: 'ms', samples: [1], source: 'synthetic-index', process: 'p', threshold: {max: null, status: 'pending-real-sample'}})], skipped: []},
    ],
  });
  assert.equal(core.failingMetrics(record).length, 1);
  assert.equal(core.unmeasuredMetrics(record).length, 1);
});

test('measurement sources contain no input-simulation or window-activation calls', () => {
  const forbidden = ['play' + 'wright', 'mo' + 'use', 'key' + 'board', 'cli' + 'ck', 'fi' + 'll', 'setforeground' + 'window', 'show' + 'window'];
  for (const file of [measurePath, corePath]) {
    const source = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${file} must not contain ${token}`);
    }
  }
});
