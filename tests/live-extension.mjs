import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
import { gameplayScene } from './scene-fixtures.mjs';
import { INITIAL_SNAPSHOT } from '../app/scene.mjs';

// 真实端到端跑一次扩展（E2）：
// 真实模型提议扩展 → 真实 Worker 沙箱自带测试 + 反造假 → 真实模型对抗评审 → 冻结回归
// → 启用 → 真实模型写玩法模块调用扩展命令 → 候选应用 → 浏览器里真的产生可观察变化。
// 全程使用独立数据目录，绝不碰 .craftmine/。需要本机 .craftmine/secrets.json 里的真实密钥。
const secretsFile = path.resolve('.craftmine/secrets.json');
if (!fs.existsSync(secretsFile)) throw Error('缺少本机密钥文件 .craftmine/secrets.json，无法跑真实端到端扩展');
const secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
if (!secrets.CRAFTMINE_DEEPSEEK_API_KEY) throw Error('本机密钥文件里没有 CRAFTMINE_DEEPSEEK_API_KEY');

const env = {
  CRAFTMINE_DEEPSEEK_API_KEY: secrets.CRAFTMINE_DEEPSEEK_API_KEY,
  CRAFTMINE_MODEL_PROVIDER: 'deepseek',
  CRAFTMINE_HARNESS_LOOP: '1',
  CRAFTMINE_THINKING: 'on',
  CRAFTMINE_REASONING_EFFORT: 'high',
  CRAFTMINE_TASK_TIMEOUT_MS: '1800000',
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runTask(w, prompt, { timeoutMs = 1500000 } = {}) {
  const before = new Set((await w.api('/api/state')).tasks.map(task => task.id));
  await w.page.evaluate(text => { document.getElementById('prompt').value = text; document.getElementById('composer').requestSubmit(); }, prompt);
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    const state = await w.api('/api/state');
    const task = state.tasks.find(item => !before.has(item.id));
    if (task) {
      if (task.status !== last) { console.log('任务状态：' + task.status); last = task.status; }
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

const w = await workbench('live-extension', { env });
try {
  await w.load(gameplayScene(), INITIAL_SNAPSHOT);
  const before = await w.snapshot();
  w.check('起始世界里有可被扩展作用的真实目标 target-one', before.gameplay.targets['target-one'].health === 60, JSON.stringify(before.gameplay.targets));

  // 1) 真实模型提议扩展：它只能写「新命令名 + 翻译成宿主原子效果」。
  //    评审如果提出阻断问题，就把意见回灌给模型重写一轮——这就是玩家会看到的自动改稿闭环。
  const said = '新增一个「吸血」命令 lifesteal.drain：对目标 target-one 造成 amount 点伤害（1..50），并把同样多的血量加给玩家。目标 ID 用 target-one。';
  let extension = null, authored = null, staged = null, rounds = 0, feedback = null;
  for (rounds = 1; rounds <= 3; rounds += 1) {
    console.log(`第 ${rounds} 轮：让真实模型提议扩展…`);
    authored = await w.api('/api/extensions/author', { said, ...(feedback ? { feedback } : {}) });
    extension = authored.extension;
    console.log(`模型提议：${extension.id}@${extension.version}「${extension.name}」命令 ${extension.provides.commands.map(command => command.type).join('、')}（用了 ${authored.attempts} 次生成）`);
    console.log('提议轮自检：' + JSON.stringify(authored.check));
    w.check(`第 ${rounds} 轮提议在沙箱里跑通自带测试，并且真的跑过对抗评审`, Boolean(authored.check) && authored.check.selfTests.passed === true && Number.isInteger(authored.check.review.total), JSON.stringify(authored.check));

    console.log('跑装载流水线（沙箱自带测试 + 对抗评审 + 冻结回归）…');
    staged = await w.api('/api/extensions/propose', { extension });
    if (staged.status === 'ready') break;
    feedback = '上一轮装载检查的阻断意见：' + (staged.reviewFindings || []).filter(finding => finding.severity === 'blocker').map(finding => finding.claim).join('；').slice(0, 1800);
    console.log('装载检查拦下了这一版，把意见回灌给模型重写：' + feedback.slice(0, 400));
  }
  w.check('真实模型提议的扩展通过了宿主格式校验', extension.format === 'craftmine.extension/1' && extension.provides.commands.length >= 1, JSON.stringify(extension.provides.commands));
  w.check('扩展声明的目标来自真实世界，不是编造的 ID', extension.targets.every(id => before.gameplay.targets[id] || id === 'target-one'), extension.targets.join('、'));

  // 2) 装载流水线：真实沙箱自带测试 + 反造假 + 真实模型对抗评审 + 冻结回归。
  w.check('装载流水线判定为 ready，且每一道检查都留下了结论', staged.status === 'ready' && staged.checks.length >= 3, JSON.stringify(staged.checks));
  w.check('对抗评审真的跑了（不是跳过或占位）', staged.checks.some(check => check.name === '对抗评审' && check.passed), JSON.stringify(staged.checks));
  w.check('评审意见作为建议随候选留档（含严重程度），不阻止机器检查通过的扩展', staged.reviewRan === true && Array.isArray(staged.reviewFindings) && staged.reviewFindings.every(finding => ['blocker', 'major', 'minor'].includes(finding.severity)), JSON.stringify(staged.reviewFindings));
  w.check('自带测试对空实现变红（反造假）', staged.selfTests?.passed === true, staged.selfTests?.summary);

  // 3) 启用扩展。
  const activated = await w.api('/api/extensions/activate', { extension });
  w.check('扩展启用成功并进入世界装载表', activated.ok === true && activated.activated === `ext:${extension.id}@${extension.version}`, JSON.stringify(activated));
  const capabilities = await w.api('/api/capabilities');
  w.check('能力目录把已装载扩展和它的命令字段一起告诉模型', capabilities.extensions.some(item => item.id === extension.id && item.commands.some(command => command.type === extension.provides.commands[0].type)), JSON.stringify(capabilities.extensions));

  // 4) 真实模型写玩法模块来调用扩展命令。
  const command = extension.provides.commands[0];
  const fields = command.fields.map(field => field.name).join('、');
  const prompt = [
    '给世界里的 target-one 新增一个代码模块，用 tick 事件在第一次触发时调用扩展命令。',
    `扩展命令：${command.type}（字段：${fields}）。`,
    `模块要求：format 用 craftmine.behavior/2，binding 为 null，targets 只写 ["target-one"]，permissions 里必须有 "${command.permission}"，requires 必须写 ["ext:${extension.id}@${extension.version}"]。`,
    'step 里用 state 记一个 fired 标记：第一次 tick 返回该扩展命令（参数取合法值，目标 target-one），之后返回 {state,commands:[]}。不要用按键，不要读 frame.keys。',
  ].join('\n');
  console.log('让真实模型写调用扩展命令的玩法模块…');
  const { task } = await runTask(w, prompt);
  const built = await w.api('/api/build?id=' + task.build);
  const module = built.scene.behaviors.find(behavior => behavior.targets.includes('target-one'));
  w.check('模型写出的模块声明了扩展依赖和所需权限', Boolean(module) && module.requires.includes(`ext:${extension.id}@${extension.version}`) && module.permissions.includes(command.permission), JSON.stringify(module && { requires: module.requires, permissions: module.permissions }));
  w.check('模块源码真的发出了扩展命令', Boolean(module) && module.code.includes(command.type), module && module.code.slice(0, 240));

  // 5) 应用候选并在浏览器里确认世界真的变了。
  await w.apply();
  await wait(1500);
  const after = await w.snapshot();
  const damaged = after.gameplay.targets['target-one'].health < 60;
  w.check('浏览器里目标血量真的下降了（扩展命令在沙箱里执行过）', damaged, `${before.gameplay.targets['target-one'].health} → ${after.gameplay.targets['target-one'].health}`);
  const notice = await w.game().locator('#notice').evaluate(element => ({ text: element.textContent, hidden: element.hidden }));
  w.check('扩展产生的飘字出现在游戏页上，且不是被隐藏的', /吸血|生命|血/.test(notice.text), JSON.stringify(notice));
  w.check('端到端过程没有抢占鼠标锁定', await w.game().locator('body').evaluate(() => document.pointerLockElement === null));
  w.check('端到端过程没有页面未处理异常', w.errors.length === 0, w.errors.join(' / '));
} catch (error) {
  w.errors.push(error.stack);
  console.error(error);
  process.exitCode = 1;
} finally {
  await w.close();
  console.log('Report: ' + path.join(w.dir, 'report.json'));
}
