import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

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
  // A frozen threshold with no bound is a configuration error, so it fails closed.
  assert.equal(core.verdictFor([1], {max: null, min: null, status: 'frozen'}), 'fail');
  assert.equal(core.verdictFor([5], {max: 1, status: 'pending-real-sample'}), 'unmeasured');
  assert.equal(core.verdictFor([1, 2], {min: 5}), 'fail');
  assert.equal(core.verdictFor([5, 6], {min: 1}), 'pass');
});

test('one sample above the frozen maximum fails the metric even when p95 passes', () => {
  const samples = [...Array(855).fill(1), ...Array(20).fill(100)];
  assert.equal(core.summarize(samples).p95 <= 16.67, true, 'p95 alone would have passed');
  assert.equal(core.verdictFor(samples, {max: 16.67, status: 'frozen'}), 'fail');
});

test('frozen metrics that were not measured are reported as pending, never pass', () => {
  const thresholds = {metrics: {
    'a.frozen.ms': {max: 10, status: 'frozen'},
    'b.skipped.ms': {max: 10, status: 'frozen'},
    'c.pending.ms': {max: null, status: 'pending-real-sample'},
    'd.missing.ms': {max: 10, status: 'frozen'},
  }};
  const record = {suites: [
    {id: 'a', metrics: [{name: 'a.frozen.ms', verdict: 'pass', count: 3}], skipped: [{metric: 'b.skipped.ms'}]},
    {id: 'c', metrics: [{name: 'c.pending.ms', verdict: 'unmeasured', count: 0}], skipped: []},
  ]};
  assert.deepEqual(
    core.pendingFrozenMetrics(record, thresholds, {requireCoverage: true}).map(item => item.metric + ':' + item.state).sort(),
    ['b.skipped.ms:skipped', 'd.missing.ms:not-reported'],
  );
  assert.deepEqual(core.pendingFrozenMetrics(record, thresholds).map(item => item.metric), ['b.skipped.ms']);
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

test('a run that measures nothing exits 3, never 0', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'k-measure-cli-'));
  try {
    const result = spawnSync(process.execPath, [
      measurePath, 'all', '--runs', '2',
      '--cache', path.join(directory, 'no-such-cache'),
      '--out', path.join(directory, 'evidence.json'),
    ], {
      encoding: 'utf8',
      windowsHide: true,
      env: {...process.env, CRAFTMINE_GODOT_CACHE_DIR: '', PI_SCRATCH_DIR: directory},
    });
    assert.equal(result.status, 3, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.match(result.stderr, /pending, not a pass/);
    const record = JSON.parse(fs.readFileSync(path.join(directory, 'evidence.json'), 'utf8'));
    assert.equal(core.failingMetrics(record).length, 0);
    assert.ok(core.pendingFrozenMetrics(record, JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'desktop/delivery/MEASUREMENT_THRESHOLDS.json'), 'utf8')), {requireCoverage: true}).length > 0);
  } finally {
    try {
      fs.rmSync(directory, {recursive: true, force: true});
    } catch {
      // Windows can hold a transient handle from the spawned tool; the temp directory
      // is outside the repository and the OS cleans it up.
    }
  }
});
