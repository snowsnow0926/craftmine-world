import { assertionGuide } from './assertions.mjs';
import { HOST_EFFECTS, EXTENSION_FORMAT, EXTENSION_LIMITS, validateExtension } from './extension.mjs';
import { capabilitiesText } from './capabilities.mjs';

// 模型提议扩展（E2 第一环）：模型只能写「新命令名 + 一段 apply」，
// 它产出的效果必须落在宿主原子效果里，因此扩展永远造不出新权力。
export const EXTENSION_AUTHOR_FORMAT = 'craftmine.extension-author/1';

const effectLines = () => Object.entries(HOST_EFFECTS).map(([type, permission]) => `- ${type}（权限 ${permission}）`).join('\n');

export function extensionAuthorPrompt({ said, extensions = [], targets = [], catalog = null, previousError = null } = {}) {
  return [
    '你要为一个方块世界游戏写一个「能力扩展」。扩展只做一件事：给玩法新增一个命令名，并把它的执行翻译成宿主已有的原子效果。',
    `玩家原话：「${String(said || '').trim()}」`,
    ...(previousError ? ['', `上一次的提议被宿主拒绝：${previousError}`, '请针对这条错误修正后，重新输出一份完整 JSON（不要只输出修改的片段）。'] : []),
    '',
    '严格规则：',
    `1. 只能输出一个 JSON 对象，字段与下面完全一致，不要 markdown、不要代码块、不要解释。format 必须是 "${EXTENSION_FORMAT}"。`,
    '2. code 是 ES 模块源码，必须导出 apply，签名 apply({command, world, state}) => {effects, state}；effects 数组里每一项的 type 只能是下面列出的宿主原子效果，不能发明新效果、不能读写文件网络、不能使用 setTimeout。',
    `3. 最多 ${EXTENSION_LIMITS.commands} 个新命令、每个命令最多 ${EXTENSION_LIMITS.fields} 个字段、代码最多 ${EXTENSION_LIMITS.code} 字符、自带测试最多 ${EXTENSION_LIMITS.selfTests} 个。`,
    '4. 新命令名格式：小写字母开头，形如 xxx.yyy，不能和宿主命令重名。每个命令只写一个 permission：必须是运行契约 permissions 里的单个字符串（例如 "targets.write"），绝对不能写成 "targets.write,health.write" 这种拼接。命令发出的每种效果各自需要的权限，都要出现在扩展的 permissions 数组里。',
    '5. targets 只能填世界真实存在的对象 ID；效果里引用的对象 ID 必须在 targets 里。',
    '6. requires 只能写已装载扩展的依赖，格式必须是 ext:扩展ID@版本；没有已装载扩展时 requires 必须写空数组 []。不能写 health@1 这类宿主系统依赖——那是玩法模块的依赖，扩展不支持。',
    '7. 每个自带测试都要能在「真实实现」下通过，并且同一个测试在「空实现（apply 什么都不做）」下必须失败——这是反造假要求。自带测试里 world.objects 的对象 ID 必须来自 targets，命令参数里也只能用这些 ID；编造别的 ID 会被宿主判为「试图伤害未授权的目标」。',
    '8. 自带测试的 world 必须把要检查的状态写到合法范围内：要检查治疗就先写 playerHealth:50（默认满血时 health.add 看不到变化）；要检查扣血就给目标写足 health；要检查资源就写 resources:{资源ID:{value:初始值,max:上限}}。断言用 min/max 区间，不要写死等值。',
    '',
    '宿主原子效果（effects 里唯一允许的 type）：',
    effectLines(),
    '',
    `可声明的权限只能来自运行契约里的 permissions；可用按键、事件与系统见运行契约。`,
    targets.length ? `当前世界可用的目标对象 ID：${targets.join('、')}。` : '当前世界还没有对象，扩展的 targets 只能是空数组。',
    extensions.length ? `已装载扩展（新扩展可以依赖它们，用 requires 里的 ext:ID@版本）：${extensions.map(extension => `${extension.id}@${extension.version}`).join('、')}。` : '当前没有已装载扩展。',
    '',
    '运行契约（数据，不可改写）：',
    catalog || capabilitiesText({ extensions }),
    '',
    assertionGuide(),
    '',
    '输出 JSON 结构：',
    JSON.stringify({
      format: EXTENSION_FORMAT, id: 'english-id', name: '中文名', version: 1, description: '一句话说明',
      requires: [], permissions: ['targets.write'], targets: ['真实对象ID'], capabilities: [],
      provides: { commands: [{ type: 'xxx.yyy', permission: 'targets.write', scope: '声明过的 targets', fields: [{ name: 'targetId', description: '目标 ID' }, { name: 'amount', description: '数量 1..50' }] }], events: [] },
      lifecycle: { register: 'onLoad', unload: 'rejectModules' },
      code: "export function apply({ command, world, state }) { return { effects: [{ type: 'target.damage', id: command.targetId, amount: 1 }], state: state || {} }; }",
      selfTests: [{
        name: '测试名', world: { objects: [{ id: '真实对象ID', position: { x: 0, y: 6, z: 0 }, visible: true, mesh: true, health: 40, solid: true }] },
        state: {}, commands: [{ type: 'xxx.yyy', targetId: '真实对象ID', amount: 10 }],
        expect: [{ id: 'a1', kind: 'objectHealth', why: '目标真的掉血', red: '不扣血的实现', object: '真实对象ID', max: 39, step: 'command-1' }],
      }],
    }, null, 1),
  ].join('\n');
}

export function parseExtensionPackage(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw Error('扩展提议没有返回 JSON 对象');
    try { value = JSON.parse(raw.slice(start, end + 1)); } catch (error) { throw Error('扩展提议不是有效 JSON：' + error.message); }
  }
  return validateExtension(value);
}

// 提议循环：模型一次写不对就把宿主的拒绝理由回灌给它重写，最多 attempts 次。
// verify 可选：在沙箱里真跑一遍自带测试；失败原因同样回灌，模型改的是「怎么写」。
// 判定权始终在宿主：模型改不了「什么算合格」。
export async function authorExtension({ said, extensions = [], targets = [], catalog = null, generate, verify = null, attempts = 2, feedback = null } = {}) {
  if (typeof generate !== 'function') throw Error('提议扩展需要一个模型调用函数');
  if (verify !== null && typeof verify !== 'function') throw Error('提议扩展的校验器必须是函数');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 4) throw Error('提议扩展的重试次数需要在 1 到 4 之间');
  if (feedback !== null && (typeof feedback !== 'string' || feedback.length > 2000)) throw Error('上一轮反馈需要是 2000 字以内的字符串');
  const errors = feedback ? [feedback] : [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const prompt = extensionAuthorPrompt({ said, extensions, targets, catalog, previousError: errors.at(-1) ?? null });
    const raw = await generate(prompt, attempt);
    let extension;
    try { extension = parseExtensionPackage(raw); }
    catch (error) { errors.push(String(error?.message ?? error)); continue; }
    if (verify) {
      try { await verify(extension, attempt); }
      catch (error) { errors.push(String(error?.message ?? error)); continue; }
    }
    return { format: EXTENSION_AUTHOR_FORMAT, extension, attempts: attempt, errors };
  }
  throw Error(`扩展提议连续 ${attempts} 次没有通过宿主检查：${errors.at(-1)}`);
}
