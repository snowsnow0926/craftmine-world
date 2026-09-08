import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
import { gameplayScene } from './scene-fixtures.mjs';
import { INITIAL_SNAPSHOT } from '../app/scene.mjs';

// 真实模型长任务的强制压缩回归（P4）：
// 用一个很小的上下文上限逼出真实压缩 → 宿主保留机器检查点、丢掉原始轨迹 → 恢复后继续做完。
// 全程独立数据目录，绝不碰 .craftmine/。需要本机 .craftmine/secrets.json 里的真实密钥。
const secretsFile = path.resolve('.craftmine/secrets.json');
if (!fs.existsSync(secretsFile)) throw Error('缺少本机密钥文件 .craftmine/secrets.json，无法跑真实压缩回归');
const secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
if (!secrets.CRAFTMINE_DEEPSEEK_API_KEY) throw Error('本机密钥文件里没有 CRAFTMINE_DEEPSEEK_API_KEY');

const env = {
  CRAFTMINE_DEEPSEEK_API_KEY: secrets.CRAFTMINE_DEEPSEEK_API_KEY,
  CRAFTMINE_MODEL_PROVIDER: 'deepseek',
  CRAFTMINE_HARNESS_LOOP: '1',
  CRAFTMINE_THINKING: 'on',
  CRAFTMINE_REASONING_EFFORT: 'high',
  CRAFTMINE_TASK_TIMEOUT_MS: '1800000',
  // 只用于回归：把可用输入压到 12000 token（压缩阈值 10800），真实多步任务会撞上。
  // 这个值刻意大于单条资源载荷，避免「每读一次就压缩」这种不真实的情形。
  CRAFTMINE_CONTEXT_CAP: '12000',
  // 压缩会丢掉原始读取结果，恢复后必然要重读一部分：给足跨压缩累计的步数预算。
  CRAFTMINE_HARNESS_STEPS: '48',
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const seenLogs = new Set();

async function runTask(w, prompt, { timeoutMs = 1800000 } = {}) {
  const before = new Set((await w.api('/api/state')).tasks.map(task => task.id));
  await w.page.evaluate(text => { document.getElementById('prompt').value = text; document.getElementById('composer').requestSubmit(); }, prompt);
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    const state = await w.api('/api/state');
    const task = state.tasks.find(item => !before.has(item.id));
    if (task) {
      if (task.status !== last) { console.log('任务状态：' + task.status); last = task.status; }
      for (const line of (task.logs || []).filter(entry => /压缩/.test(entry.text))) if (!seenLogs.has(line.text)) { seenLogs.add(line.text); console.log('  ' + line.text); }
      if (task.status === 'ready') return { state, task };
      if (['failed', 'cancelled', 'interrupted', 'unchanged', 'discussed'].includes(task.status)) {
        const logs = (task.logs || []).map(entry => entry.text).join('\n');
        throw Error(`任务未成功：${task.status} ${task.error || ''}\n${logs}`);
      }
    }
    await wait(1000);
  }
  throw Error('任务等待超时');
}

const w = await workbench('live-compaction', { env });
try {
  await w.load(gameplayScene(), INITIAL_SNAPSHOT);
  const original = new Map((await w.api('/api/build?id=' + (await w.api('/api/state')).current)).scene.objects.map(object => [object.id, { x: object.position.x }]));
  console.log('提交一个需要多步才能做完的真实任务（六个对象挪位 + 三朵花改色）…');
  const { task } = await runTask(w, [
    '把世界里的每一朵花和每一丛草都向左（x 减小）移 1 米，y 和 z 不变：flower-one、flower-two、flower-three、grass-one、grass-two。',
    '同时把这三朵花的主花瓣颜色改成 #ff5577。',
    '再把 tree-one 向左移 1 米。其他对象不要动。',
  ].join(''));

  const attempt = (task.attempts || []).at(-1);
  const loop = attempt?.loop || {};
  console.log('闭环结果：' + JSON.stringify(loop));
  w.check('任务真的完成了（压缩后继续做完，而不是停在半路）', task.status === 'ready' && Boolean(task.build), task.error || '');
  w.check('真实长任务触发了至少一次强制压缩', loop.compactions >= 1, JSON.stringify(loop));
  w.check('压缩后的恢复确实是「接上检查点继续」', (task.logs || []).some(entry => /压缩/.test(entry.text)), (task.logs || []).map(entry => entry.text).join(' / ').slice(0, 400));

  const workspaceDir = path.join(w.dir, 'project', 'tasks', task.id, 'workspace');
  const files = fs.existsSync(workspaceDir) ? fs.readdirSync(workspaceDir).filter(name => /^compaction-\d+\.json$/.test(name)) : [];
  w.check('压缩留下了可复核的机器记录', files.length >= 1, files.join('、'));
  const record = JSON.parse(fs.readFileSync(path.join(workspaceDir, files[0]), 'utf8'));
  w.check('压缩记录里是「到阈值了」而不是别的失败', record.context.action === 'compact' && record.context.known === true, JSON.stringify(record.context.detail));
  w.check('机器检查点保留了基准、草稿和已完成步骤', record.checkpoint.format === 'craftmine.checkpoint/1' && record.checkpoint.completedSteps.length >= 1 && record.checkpoint.baseBuild === task.base, JSON.stringify({ steps: record.checkpoint.completedSteps.length, base: record.checkpoint.baseBuild === task.base }));
  w.check('被丢掉的原始轨迹只剩短账目，没有原始结果', record.ledger.every(entry => entry.result === undefined), JSON.stringify(record.ledger.slice(0, 2)));

  const build = await w.api('/api/build?id=' + task.build);
  const moved = ['flower-one', 'flower-two', 'flower-three', 'grass-one', 'grass-two', 'tree-one'].map(id => ({ id, before: original.get(id), after: build.scene.objects.find(object => object.id === id) }));
  w.check('压缩没有弄丢世界改动：六个对象都向左移了 1 米', moved.every(item => Math.abs(item.after.position.x - (item.before.x - 1)) < 1e-6), JSON.stringify(moved.map(item => `${item.id}: ${item.before.x} → ${item.after.position.x}`)));
  const flowers = moved.slice(0, 3).map(item => item.after);
  w.check('压缩没有弄丢世界改动：三朵花的主花瓣颜色都改了', flowers.every(object => object.parts.some(part => part.color === '#ff5577')), JSON.stringify(flowers.map(object => object.parts.map(part => part.color).filter(color => color === '#ff5577'))));
  w.check('压缩回归过程没有页面未处理异常', w.errors.length === 0, w.errors.join(' / '));
} catch (error) {
  w.errors.push(error.stack);
  console.error(error);
  process.exitCode = 1;
} finally {
  await w.close();
  console.log('Report: ' + path.join(w.dir, 'report.json'));
}
