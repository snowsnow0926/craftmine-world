// 玩家生命值真实引擎验证：独立后台进程，不发送鼠标键盘事件。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGodotProbeEnvironment, godotLock } from '../../desktop/godot/toolchain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = fs.mkdtempSync(path.join(root, 'test-results/player-health-'));
const project = path.join(out, 'project');
const report = { format: 'craftmine.player-health-headless/2', engine: godotLock.version, headless: true, passed: false, runs: {} };
const result = (run, op) => run.results.find(entry => entry.op === op)?.result;
try {
  fs.cpSync(path.join(root, 'desktop/godot/bases/first-person'), project, { recursive: true, filter: source => path.basename(source) !== '.godot' });
  fs.copyFileSync(path.join(root, 'tests/godot-components/player-health-contract.gd'), path.join(project, 'health-contract.gd'));
  const env = await createGodotProbeEnvironment(out);
  await env.run('import', ['--path', project, '--editor', '--import']);
  async function run(name, commands) {
    fs.writeFileSync(path.join(project, name + '.json'), JSON.stringify(commands));
    const stdout = await env.run(name, ['--path', project, '--', '--base-script=res://' + name + '.json', '--base-world-id=health-world']);
    const line = stdout.split(/\r?\n/).find(line => line.startsWith('CRAFTMINE_FP_BASE='));
    assert.ok(line, 'missing headless result');
    const raw = JSON.parse(line.slice('CRAFTMINE_FP_BASE='.length));
    report.runs[name] = raw;
    return raw;
  }
  const damaged = await run('damaged', [
    { op: 'damage-player', args: { amount: 35 } }, { op: 'wait', args: { frames: 2 } },
    { op: 'hud' }, { op: 'save' },
  ]);
  assert.equal(result(damaged, 'damage-player').applied, 35);
  assert.match(result(damaged, 'hud').health, /生命 65 \/ 100/);
  assert.equal(result(damaged, 'save').written, true);
  const death = await run('damaged-reopened', [
    { op: 'restore' }, { op: 'damage-player', args: { amount: 100 } },
    { op: 'walk', args: { forward: 1, frames: 30 } }, { op: 'attack' }, { op: 'save' },
  ]);
  assert.equal(result(death, 'restore').player.health, 65);
  assert.equal(result(death, 'damage-player').dead, true);
  assert.equal(result(death, 'walk').after.position[0], result(death, 'walk').before.position[0]);
  assert.equal(result(death, 'walk').after.position[2], result(death, 'walk').before.position[2]);
  assert.equal(result(death, 'attack').reason, 'player-dead');
  assert.equal(result(death, 'save').written, true);
  const reopened = await run('dead-reopened', [
    { op: 'restore' }, { op: 'attack' }, { op: 'revive-player' },
    { op: 'damage-player' }, { op: 'snapshot' },
  ]);
  assert.equal(result(reopened, 'restore').player.health, 0);
  assert.equal(result(reopened, 'attack').reason, 'player-dead');
  assert.equal(result(reopened, 'revive-player').player.health, 100);
  assert.equal(reopened.results.find(entry => entry.op === 'damage-player').error, 'Invalid player damage');
  assert.equal(result(reopened, 'snapshot').player.health, 100);
  const stdout = await env.run('contract', ['--path', project, '--script', 'res://health-contract.gd']);
  const line = stdout.split(/\r?\n/).find(line => line.startsWith('CRAFTMINE_HEALTH_CONTRACT='));
  assert.ok(line, 'missing health contract result');
  report.contract = JSON.parse(line.slice('CRAFTMINE_HEALTH_CONTRACT='.length));
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PLAYER_HEALTH_HEADLESS=' + JSON.stringify({ out, engine: godotLock.version, passed: report.passed }));
}
