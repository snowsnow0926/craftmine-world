import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCEPTANCE_FORMAT, evaluateCommandAcceptance, evaluateKeyAcceptance, observableChange, worldSnapshot } from '../app/harness/acceptance.mjs';
import { METRICS_FORMAT, percentile, summarizeTasks, taskRecord } from '../app/harness/metrics.mjs';

const world = (overrides = {}) => worldSnapshot({
  playerHealth: 100,
  objects: [
    { id: 'zombie-1', position: { x: 1, y: 6, z: 2 }, visible: true, mesh: true, health: 0 },
    { id: 'door-1', position: { x: 4, y: 6, z: 4 }, visible: true, mesh: true, health: 0 },
  ],
  inventory: { wood: 3 },
  panels: { quest: { title: '任务', lines: ['木材 3 / 3'] } },
  effects: [],
  ...overrides,
});
const attempt = (status, overrides = {}) => ({ number: 1, kind: 'generate', status, phase: 'commit', started: 0, finished: 0, ...overrides });
const withObject = (base, id, patch) => world({ objects: base.objects.map(object => object.id === id ? { ...object, ...patch } : object) });
const task = (overrides = {}) => ({ id: 't-1', status: 'applied', base: 'v-a', intent: 'execute', started: 1000, finished: 3000, usage: { input_tokens: 100, output_tokens: 50 }, attempts: [attempt('passed')], ...overrides });

test('世界快照把对象排序、补默认值，只保留可观察事实', () => {
  const snapshot = worldSnapshot({ objects: [{ id: 'b' }, { id: 'a', visible: false, health: 7 }], inventory: { wood: 1 } });
  assert.deepEqual(snapshot.objects.map(object => object.id), ['a', 'b']);
  assert.equal(snapshot.objects[1].mesh, true);
  assert.equal(snapshot.objects[0].visible, false);
  assert.equal(snapshot.objects[0].health, 7);
  assert.equal(snapshot.playerHealth, null);
});

test('可观测变化区分位置、模型、血量、可见、背包、面板和效果', () => {
  const base = world();
  assert.equal(observableChange(base, base).changed, false);
  const revive = withObject(base, 'zombie-1', { health: 60 });
  assert.deepEqual(observableChange(base, revive).fields, ['object:zombie-1.health']);
  const moved = withObject(base, 'zombie-1', { position: { x: 9, y: 6, z: 2 } });
  assert.deepEqual(observableChange(base, moved).fields, ['object:zombie-1.position']);
  assert.deepEqual(observableChange(base, world({ inventory: { wood: 2 } })).fields, ['inventory.wood']);
  assert.deepEqual(observableChange(base, world({ panels: {} })).fields, ['panel.quest']);
  assert.deepEqual(observableChange(base, world({ effects: [{ type: 'audio.play' }] })).fields, ['effects']);
  assert.deepEqual(observableChange(base, world({ playerHealth: 80 })).fields, ['player.health']);
});

test('没有声明按键的模块跳过按键验收', () => {
  const report = evaluateKeyAcceptance({ declaredKeys: [] });
  assert.equal(report.format, ACCEPTANCE_FORMAT);
  assert.equal(report.passed, true);
  assert.equal(report.skipped, true);
});

test('按键只产生命令但世界没变，验收必须失败并指出真正原因', () => {
  const before = world();
  const buggy = evaluateKeyAcceptance({
    declaredKeys: ['KeyG'], keyCommands: 8,
    observations: [{ code: 'KeyG', change: observableChange(before, before) }],
  });
  assert.equal(buggy.passed, false);
  assert.deepEqual(buggy.assertions.map(item => [item.id, item.passed]), [['key.commands', true], ['key.effect', false]]);
  assert.match(buggy.assertions[1].detail, /target\.revive/);
});

test('按键真的改变世界就通过，按键没有产生命令也要失败', () => {
  const before = world();
  const revived = withObject(before, 'zombie-1', { mesh: true, health: 60 });
  const passed = evaluateKeyAcceptance({ declaredKeys: ['KeyG'], keyCommands: 8, observations: [{ code: 'KeyG', change: observableChange(before, revived) }] });
  assert.equal(passed.passed, true);
  assert.match(passed.assertions[1].detail, /zombie-1\.health/);
  const silent = evaluateKeyAcceptance({ declaredKeys: ['KeyG'], keyCommands: 0, observations: [{ code: 'KeyG', change: observableChange(before, revived) }] });
  assert.equal(silent.passed, false);
  assert.match(silent.assertions[0].detail, /frame\.keys/);
});

test('刷新怪物回归：命令有效但已死目标没有重建模型，验收判失败', () => {
  const dead = withObject(world(), 'zombie-1', { mesh: false, health: 0 });
  // 坏版本：object.patch visible:true 之后世界没有任何可观察变化（模型仍然没有重建）。
  const patchReport = evaluateKeyAcceptance({ declaredKeys: ['KeyR'], keyCommands: 8, observations: [{ code: 'KeyR', change: observableChange(dead, dead) }] });
  assert.equal(patchReport.passed, false);
  // 修好之后：target.revive 同时恢复血量并重建模型。
  const revived = withObject(dead, 'zombie-1', { mesh: true, health: 60 });
  const revivedReport = evaluateKeyAcceptance({ declaredKeys: ['KeyR'], keyCommands: 8, observations: [{ code: 'KeyR', change: observableChange(dead, revived) }] });
  assert.equal(revivedReport.passed, true);
});

test('命令级验收：位置补丁必须真的把对象移动到目标', () => {
  const before = world();
  const commands = [{ type: 'object.patch', id: 'zombie-1', position: { x: 4, y: 6, z: 2 } }];
  const observation = after => [{ event: { type: 'tick' }, commands, before, after }];
  const ok = evaluateCommandAcceptance({ observations: observation(withObject(before, 'zombie-1', { position: { x: 4, y: 6, z: 2 } })) });
  assert.equal(ok.passed, true);
  assert.equal(ok.assertions.length, 1);
  const bad = evaluateCommandAcceptance({ observations: observation(before) });
  assert.equal(bad.passed, false);
  assert.match(bad.assertions[0].detail, /没有生效/);
});

test('命令级验收：本来就没有变化的补丁不产生断言', () => {
  const before = world();
  const position = before.objects.find(object => object.id === 'zombie-1').position;
  const report = evaluateCommandAcceptance({ observations: [{ event: { type: 'tick' }, commands: [{ type: 'object.patch', id: 'zombie-1', position, visible: true }], before, after: before }] });
  assert.deepEqual(report.assertions, []);
  assert.equal(report.skipped, true);
  assert.equal(report.passed, true);
});

test('命令级验收：对已死亡目标用可见补丁不会通过，必须真的重建模型', () => {
  const dead = withObject(world(), 'zombie-1', { mesh: false, health: 0 });
  const commands = [{ type: 'object.patch', id: 'zombie-1', visible: true }];
  const report = after => evaluateCommandAcceptance({ observations: [{ event: { type: 'key', code: 'KeyR' }, commands, before: dead, after }] });
  assert.equal(report(dead).passed, false);
  assert.match(report(dead).assertions[0].detail, /target\.revive/);
  assert.equal(report(withObject(dead, 'zombie-1', { mesh: true, health: 60 })).passed, true);
});

test('命令级验收：复活、物品和面板按期望值检查，已经满足的情况不误判', () => {
  const dead = withObject(world(), 'zombie-1', { mesh: false, health: 0 });
  const revive = after => evaluateCommandAcceptance({ observations: [{ event: { type: 'key' }, commands: [{ type: 'target.revive', id: 'zombie-1' }], before: dead, after }] });
  assert.equal(revive(withObject(dead, 'zombie-1', { mesh: true, health: 60 })).passed, true);
  assert.equal(revive(dead).passed, false);
  assert.equal(revive(withObject(dead, 'zombie-1', { health: 60 })).passed, false);
  assert.deepEqual(evaluateCommandAcceptance({ observations: [{ event: { type: 'key' }, commands: [{ type: 'target.revive', id: 'zombie-1' }], before: withObject(world(), 'zombie-1', { health: 60 }), after: withObject(world(), 'zombie-1', { health: 60 }) }] }).assertions, []);

  const inventory = after => evaluateCommandAcceptance({ observations: [{ event: { type: 'tick' }, commands: [{ type: 'inventory.add', item: 'wood', count: 2 }], before: world(), after }] });
  assert.equal(inventory(world({ inventory: { wood: 5 } })).passed, true);
  assert.equal(inventory(world({ inventory: { wood: 9 } })).passed, false);
  assert.equal(inventory(world()).passed, false);
  assert.deepEqual(evaluateCommandAcceptance({ observations: [{ event: { type: 'tick' }, commands: [{ type: 'inventory.add', item: 'wood', count: 0 }], before: world(), after: world() }] }).assertions, []);

  const panel = (commands, before, after) => evaluateCommandAcceptance({ observations: [{ event: { type: 'start' }, commands, before, after }] });
  const created = { type: 'hud.panel', key: 'quest', panel: { title: '任务', lines: [] } };
  assert.equal(panel([created], world({ panels: {} }), world({ panels: { 'mod:quest': { title: '任务', lines: [] } } })).passed, true);
  assert.equal(panel([created], world({ panels: {} }), world({ panels: {} })).passed, false);
  assert.equal(panel([{ type: 'hud.panel', key: 'quest', panel: null }], world({ panels: { 'mod:quest': { title: '任务', lines: [] } } }), world({ panels: {} })).passed, true);
  assert.equal(panel([{ type: 'hud.panel', key: 'quest', panel: null }], world({ panels: {} }), world({ panels: {} })).skipped, true);
});

test('命令级验收：一条失败就整体失败，并给出是哪条命令没生效', () => {
  const before = world();
  const report = evaluateCommandAcceptance({ observations: [
    { event: { type: 'tick' }, commands: [{ type: 'object.patch', id: 'door-1', position: { x: 9, y: 6, z: 4 } }], before, after: withObject(before, 'door-1', { position: { x: 9, y: 6, z: 4 } }) },
    { event: { type: 'tick' }, commands: [{ type: 'object.patch', id: 'zombie-1', position: { x: 7, y: 6, z: 2 } }], before, after: before },
  ] });
  assert.equal(report.passed, false);
  assert.equal(report.assertions.length, 2);
  assert.deepEqual(report.assertions.map(assertion => assertion.passed), [true, false]);
  assert.match(report.assertions[1].id, /tick#2:object\.patch/);
});

test('任务指标从日志派生：首次通过、修复通过、失败分类和耗时', () => {
  const repaired = taskRecord(task({ attempts: [attempt('failed', { diagnostic: { stage: 'behavior', message: '重叠' } }), attempt('passed')] }));
  assert.equal(repaired.attempts, 2);
  assert.equal(repaired.firstPass, false);
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.durationMs, 2000);
  assert.equal(repaired.failureClass, 'behavior');
  assert.equal(repaired.failureLabel, '源码运行');
  const firstPass = taskRecord(task());
  assert.equal(firstPass.firstPass, true);
  assert.equal(firstPass.repaired, false);
  assert.equal(firstPass.failureClass, null);
});

test('指标汇总给出成功率与耗时分布，空输入不编造数字', () => {
  const tasks = [
    task({ id: 'a', started: 0, finished: 100, usage: { output_tokens: 100 }, attempts: [attempt('passed')] }),
    task({ id: 'b', started: 0, finished: 200, usage: { output_tokens: 200 }, attempts: [attempt('passed')] }),
    task({ id: 'c', started: 0, finished: 300, usage: { output_tokens: 300 }, attempts: [attempt('failed'), attempt('passed')] }),
    task({ id: 'd', started: 0, finished: 400, usage: { output_tokens: 400 }, attempts: [attempt('failed'), attempt('failed')] }),
    task({ id: 'e', started: 0, finished: 500, usage: { output_tokens: 500 }, attempts: [attempt('passed')] }),
  ];
  const summary = summarizeTasks(tasks);
  assert.equal(summary.format, METRICS_FORMAT);
  assert.equal(summary.ran, 5);
  assert.equal(summary.firstPassRate, 0.6);
  assert.equal(summary.repairedRate, 0.2);
  assert.equal(summary.durationMs.median, 300);
  assert.equal(summary.durationMs.p90, 500);
  assert.equal(summary.outputTokens.median, 300);
  assert.equal(summary.counts.applied, 5);
  const empty = summarizeTasks([]);
  assert.equal(empty.tasks, 0);
  assert.equal(empty.firstPassRate, null);
  assert.equal(empty.durationMs.median, null);
  assert.equal(percentile([], 0.5), null);
});
