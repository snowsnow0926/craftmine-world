// 断言 DSL：玩家的一句话被翻译成机器能跑的检查。
// 断言是**数据**，不是代码——这样它才能被哈希、被冻结、被第三方复核。
// 所有断言只读一份「轨迹」（trace），因此判定是纯函数、可复现、不依赖模型。
export const ASSERTION_FORMAT = 'craftmine.assertions/1';

export const ASSERTION_KINDS = Object.freeze([
  'noErrors',
  'newObjects',
  'removedObjects',
  'objectField',
  'objectHealth',
  'objectDistance',
  'objectsUnchanged',
  'inventory',
  'inventoryDelta',
  'resource',
  'resourceDelta',
  'playerHealth',
  'panel',
  'panelContains',
  'step',
  'stepCommandField',
]);

export const OBJECT_FIELDS = Object.freeze(['position', 'visible', 'solid', 'mesh', 'health', 'color']);

const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.length > 0;

function need(condition, message) {
  if (!condition) throw Error(message);
}
function needRange(assertion, name) {
  const min = assertion[name + 'Min'], max = assertion[name + 'Max'];
  need(min === undefined || finite(min), `${assertion.id}：${name}Min 必须是数字`);
  need(max === undefined || finite(max), `${assertion.id}：${name}Max 必须是数字`);
  need(min === undefined || max === undefined || min <= max, `${assertion.id}：${name} 的下限不能大于上限`);
}

export function validateAssertion(assertion) {
  need(isPlain(assertion), '断言必须是对象');
  const { id, kind } = assertion;
  need(text(id) && id.length <= 80, '断言必须有 id');
  need(ASSERTION_KINDS.includes(kind), `${id}：不支持的断言类型 ${kind}；可用：${ASSERTION_KINDS.join('、')}`);
  const allowed = ['id', 'kind', 'why', 'red', 'step', 'min', 'max', 'exact', 'delta', 'changed', 'exists', 'text', 'value', 'field', 'type', 'region', 'solid', 'except', 'item', 'minFields', 'minCommands', 'commands', 'change', 'label', 'key', 'object', 'resourceId', 'resource'];
  const extra = Object.keys(assertion).filter(key => !allowed.includes(key));
  need(!extra.length, `${id}：断言包含不支持的字段 ${extra.join('、')}`);
  need(text(assertion.why), `${id}：断言必须写清楚 why（这条断言在检查什么玩家能看见的事实）`);
  need(text(assertion.red), `${id}：断言必须写清楚 red（哪种错误实现会让它变红）`);
  if (assertion.step !== undefined) need(text(assertion.step), `${id}：step 必须是事件标签`);
  if (assertion.region !== undefined) {
    need(isPlain(assertion.region), `${id}：region 必须是对象`);
    for (const axis of ['x', 'y', 'z']) {
      if (assertion.region[axis] === undefined) continue;
      const range = assertion.region[axis];
      need(Array.isArray(range) && range.length === 2 && finite(range[0]) && finite(range[1]) && range[0] <= range[1], `${id}：region.${axis} 需要 [下限, 上限]`);
    }
    need(Object.keys(assertion.region).every(axis => ['x', 'y', 'z'].includes(axis)), `${id}：region 只支持 x/y/z`);
  }
  needRange(assertion, 'min');
  needRange(assertion, 'max');
  switch (kind) {
    case 'newObjects':
    case 'removedObjects':
      need(Number.isInteger(assertion.min) && assertion.min >= 1, `${id}：${kind} 需要 min（至少几个）`);
      break;
    case 'objectField':
      need(text(assertion.object), `${id}：objectField 需要 object（对象 ID）`);
      need(OBJECT_FIELDS.includes(assertion.field), `${id}：objectField 的 field 只能是 ${OBJECT_FIELDS.join('、')}`);
      need(Object.hasOwn(assertion, 'value'), `${id}：objectField 需要 value`);
      break;
    case 'objectHealth':
      need(text(assertion.object), `${id}：objectHealth 需要 object`);
      need(assertion.min !== undefined || assertion.max !== undefined || assertion.exact !== undefined, `${id}：objectHealth 需要 min/max/exact 之一`);
      break;
    case 'objectDistance':
      need(text(assertion.object), `${id}：objectDistance 需要 object`);
      need(assertion.min !== undefined || assertion.max !== undefined, `${id}：objectDistance 需要 min/max 之一`);
      break;
    case 'inventory':
    case 'inventoryDelta':
      need(text(assertion.item), `${id}：${kind} 需要 item`);
      need(assertion.min !== undefined || assertion.max !== undefined || assertion.exact !== undefined || assertion.delta !== undefined, `${id}：${kind} 需要 min/max/exact/delta`);
      break;
    case 'resource':
    case 'resourceDelta':
      need(text(assertion.resourceId ?? assertion.resource) || text(assertion.object), `${id}：${kind} 需要资源 ID`);
      need(assertion.min !== undefined || assertion.max !== undefined || assertion.changed === true || assertion.delta !== undefined, `${id}：${kind} 需要 min/max/changed/delta`);
      break;
    case 'panel':
      need(text(assertion.key), `${id}：panel 需要 key`);
      need(typeof assertion.exists === 'boolean', `${id}：panel 需要 exists`);
      break;
    case 'panelContains':
      need(text(assertion.key) && text(assertion.text), `${id}：panelContains 需要 key 和 text`);
      break;
    case 'step':
      need(text(assertion.label), `${id}：step 断言需要 label`);
      need(assertion.minCommands === undefined || (Number.isInteger(assertion.minCommands) && assertion.minCommands >= 0), `${id}：minCommands 需要是自然数`);
      break;
    case 'stepCommandField':
      need(text(assertion.label) && text(assertion.type) && text(assertion.field), `${id}：stepCommandField 需要 label、type、field`);
      need(assertion.min !== undefined || assertion.max !== undefined || Object.hasOwn(assertion, 'value'), `${id}：stepCommandField 需要 min/max/value 之一`);
      break;
    case 'playerHealth':
      need(assertion.min !== undefined || assertion.max !== undefined || assertion.exact !== undefined, `${id}：playerHealth 需要 min/max/exact`);
      break;
    case 'objectsUnchanged':
      need(assertion.except === undefined || Array.isArray(assertion.except), `${id}：objectsUnchanged 的 except 需要数组`);
      break;
    default:
      break;
  }
  return assertion;
}

// —— 轨迹读取 ——
const objectsOf = snapshot => new Map((snapshot?.objects || []).map(object => [object.id, object]));
const objectIn = (snapshot, id) => objectsOf(snapshot).get(id) || null;
const stepOf = (trace, label) => (trace?.steps || []).find(step => step.label === label) || null;
const playerOf = (trace, step) => (step?.player ? step.player : trace?.player || { x: 0, y: 6, z: 0 });
const stable = value => JSON.stringify(value);
const count = (snapshot, item) => Number(snapshot?.inventory?.[item] ?? 0);
const resourceOf = (snapshot, id) => snapshot?.resources?.[id] || null;

function inRegion(object, region) {
  if (!region) return true;
  for (const axis of ['x', 'y', 'z']) {
    const range = region[axis];
    if (!range) continue;
    const value = object.position?.[axis];
    if (!finite(value) || value < range[0] || value > range[1]) return false;
  }
  return true;
}

function checkRange(actual, assertion) {
  const problems = [];
  if (assertion.min !== undefined && !(actual >= assertion.min)) problems.push(`至少 ${assertion.min}`);
  if (assertion.max !== undefined && !(actual <= assertion.max)) problems.push(`最多 ${assertion.max}`);
  if (assertion.exact !== undefined && actual !== assertion.exact) problems.push(`正好 ${assertion.exact}`);
  if (assertion.delta !== undefined && actual !== assertion.delta) problems.push(`变化量应为 ${assertion.delta}`);
  return problems;
}

const distance2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function run(assertion, trace) {
  const { kind, id } = assertion;
  const start = trace?.start || null, final = trace?.final || null;
  // 「候选之前的世界」：场景类候选在构建期就改了世界，必须和基准面比才看得到新增/删除。
  const first = trace?.baseline || start;
  const label = assertion.label || assertion.step || null;
  const step = label ? stepOf(trace, label) : null;
  const before = step ? step.before : first, after = step ? step.after : final;
  const where = label ? `步骤「${label}」` : '最终世界';
  if (!final) return { passed: false, detail: '轨迹没有最终快照，无法判定' };
  if (label && !step) return { passed: false, detail: `轨迹里没有名为「${label}」的步骤` };

  switch (kind) {
    case 'noErrors': {
      const errors = (trace?.errors || []).concat((trace?.steps || []).filter(item => item.error).map(item => `${item.label || item.event?.type}：${item.error}`));
      return errors.length
        ? { passed: false, detail: `玩法运行时报错：${errors.join('；')}` }
        : { passed: true, detail: '玩法在整个事件序列里没有报错' };
    }
    case 'newObjects': {
      const old = objectsOf(first), added = (final.objects || []).filter(object => !old.has(object.id) && inRegion(object, assertion.region) && (assertion.solid ? object.solid === true : true));
      return added.length >= assertion.min
        ? { passed: true, detail: `${where}新增了 ${added.length} 个符合条件的对象：${added.map(object => object.id).join('、')}` }
        : { passed: false, detail: `${where}只新增了 ${added.length} 个符合条件的对象，要求至少 ${assertion.min} 个（区域 ${stable(assertion.region || '全图')}${assertion.solid ? '、需要碰撞' : ''}）` };
    }
    case 'removedObjects': {
      const now = objectsOf(final);
      const gone = (first?.objects || []).filter(object => !now.has(object.id) && (assertion.object ? object.id === assertion.object : true));
      return gone.length >= assertion.min
        ? { passed: true, detail: `${where}移除了 ${gone.length} 个对象：${gone.map(object => object.id).join('、')}` }
        : { passed: false, detail: `${where}只移除了 ${gone.length} 个对象，要求至少 ${assertion.min} 个` };
    }
    case 'objectField': {
      const object = objectIn(after, assertion.object);
      if (!object) return { passed: false, detail: `${where}找不到对象 ${assertion.object}` };
      const actual = object[assertion.field];
      return stable(actual) === stable(assertion.value)
        ? { passed: true, detail: `${where} ${assertion.object}.${assertion.field} = ${stable(actual)}` }
        : { passed: false, detail: `${where} ${assertion.object}.${assertion.field} 应为 ${stable(assertion.value)}，实际 ${stable(actual)}` };
    }
    case 'objectHealth': {
      const object = objectIn(after, assertion.object);
      if (!object) return { passed: false, detail: `${where}找不到对象 ${assertion.object}` };
      const problems = checkRange(object.health, assertion);
      return problems.length
        ? { passed: false, detail: `${where} ${assertion.object} 的血量是 ${object.health}，不满足：${problems.join('、')}` }
        : { passed: true, detail: `${where} ${assertion.object} 血量 ${object.health}` };
    }
    case 'objectDistance': {
      const object = objectIn(after, assertion.object);
      if (!object) return { passed: false, detail: `${where}找不到对象 ${assertion.object}` };
      const player = playerOf(trace, step), distance = distance2d(object.position, player);
      const problems = [];
      if (assertion.min !== undefined && !(distance >= assertion.min)) problems.push(`至少 ${assertion.min}`);
      if (assertion.max !== undefined && !(distance <= assertion.max)) problems.push(`最多 ${assertion.max}`);
      return problems.length
        ? { passed: false, detail: `${where} ${assertion.object} 与玩家的水平距离是 ${distance.toFixed(2)}，不满足：${problems.join('、')}` }
        : { passed: true, detail: `${where} ${assertion.object} 与玩家距离 ${distance.toFixed(2)}` };
    }
    case 'objectsUnchanged': {
      const except = new Set(assertion.except || []);
      const old = objectsOf(first), now = objectsOf(final), changed = [];
      for (const [objectId, object] of old) {
        if (except.has(objectId) || !now.has(objectId)) continue;
        const other = now.get(objectId);
        for (const field of OBJECT_FIELDS) if (stable(object[field]) !== stable(other[field])) changed.push(`${objectId}.${field}`);
      }
      return changed.length
        ? { passed: false, detail: `有 ${changed.length} 处不该变化的地方变了：${changed.slice(0, 8).join('、')}${changed.length > 8 ? ' 等' : ''}` }
        : { passed: true, detail: `除 ${[...except].join('、') || '无'} 之外，其他对象都没有变化` };
    }
    case 'inventory': {
      const value = count(after, assertion.item);
      const problems = checkRange(value, assertion);
      return problems.length
        ? { passed: false, detail: `${where}背包「${assertion.item}」是 ${value}，不满足：${problems.join('、')}` }
        : { passed: true, detail: `${where}背包「${assertion.item}」= ${value}` };
    }
    case 'inventoryDelta': {
      const delta = count(after, assertion.item) - count(before, assertion.item);
      const problems = checkRange(delta, assertion);
      return problems.length
        ? { passed: false, detail: `${where}背包「${assertion.item}」变化了 ${delta}，不满足：${problems.join('、')}` }
        : { passed: true, detail: `${where}背包「${assertion.item}」变化 ${delta}` };
    }
    case 'resource':
    case 'resourceDelta': {
      const target = assertion.resourceId || assertion.resource || assertion.object;
      const now = resourceOf(after, target), old = resourceOf(before, target);
      if (!now) return { passed: false, detail: `${where}找不到资源 ${target}` };
      if (kind === 'resourceDelta') {
        if (!old) return { passed: false, detail: `${where}之前没有资源 ${target}，无法计算变化量` };
        const delta = now.value - old.value, problems = checkRange(delta, assertion);
        return problems.length
          ? { passed: false, detail: `${where}资源「${target}」变化了 ${delta}，不满足：${problems.join('、')}` }
          : { passed: true, detail: `${where}资源「${target}」变化 ${delta}` };
      }
      if (assertion.changed === true && (!old || old.value === now.value)) return { passed: false, detail: `${where}资源「${target}」没有变化（仍是 ${now.value}）` };
      const problems = checkRange(now.value, assertion);
      return problems.length
        ? { passed: false, detail: `${where}资源「${target}」是 ${now.value}，不满足：${problems.join('、')}` }
        : { passed: true, detail: `${where}资源「${target}」= ${now.value} / ${now.max}` };
    }
    case 'playerHealth': {
      const health = after.playerHealth;
      if (!finite(health)) return { passed: false, detail: `${where}没有玩家血量数据` };
      const problems = checkRange(health, assertion);
      return problems.length
        ? { passed: false, detail: `${where}玩家血量是 ${health}，不满足：${problems.join('、')}` }
        : { passed: true, detail: `${where}玩家血量 ${health}` };
    }
    case 'panel': {
      const keys = Object.keys(after.panels || {}).filter(key => key.endsWith(':' + assertion.key));
      const exists = keys.length > 0;
      return exists === assertion.exists
        ? { passed: true, detail: `${where}面板「${assertion.key}」${exists ? '存在' : '不存在'}` }
        : { passed: false, detail: `${where}面板「${assertion.key}」应该${assertion.exists ? '存在' : '不存在'}，实际${exists ? '存在' : '不存在'}` };
    }
    case 'panelContains': {
      const entries = Object.entries(after.panels || {}).filter(([key]) => key.endsWith(':' + assertion.key));
      if (!entries.length) return { passed: false, detail: `${where}找不到面板「${assertion.key}」` };
      const haystack = entries.map(([, value]) => value).join('\n');
      return haystack.includes(assertion.text)
        ? { passed: true, detail: `面板「${assertion.key}」包含「${assertion.text}」` }
        : { passed: false, detail: `面板「${assertion.key}」里没有「${assertion.text}」，实际内容：${haystack.slice(0, 200)}` };
    }
    case 'step': {
      const commands = step.commands || [];
      const problems = [];
      if (assertion.minCommands !== undefined && commands.length < assertion.minCommands) problems.push(`至少发出 ${assertion.minCommands} 条命令，实际 ${commands.length} 条`);
      if (assertion.commands) {
        const rule = assertion.commands, matched = commands.filter(command => command.type === rule.type);
        const min = rule.min ?? 1, max = rule.max ?? Infinity;
        if (matched.length < min || matched.length > max) problems.push(`${rule.type} 应有 ${min}${max === Infinity ? ' 条以上' : `~${max} 条`}，实际 ${matched.length} 条`);
      }
      if (assertion.change) {
        const change = trace?.steps?.find(item => item.label === assertion.label)?.change || { fields: [] };
        const fields = change.fields || [];
        if (assertion.change.minFields !== undefined && fields.length < assertion.change.minFields) problems.push(`至少要有 ${assertion.change.minFields} 处可观测变化，实际 ${fields.length} 处`);
        for (const prefix of assertion.change.fields || []) if (!fields.some(field => field === prefix || field.startsWith(prefix))) problems.push(`缺少可观测变化「${prefix}」`);
      }
      return problems.length
        ? { passed: false, detail: `步骤「${assertion.label}」不满足：${problems.join('；')}（实际变化：${(trace?.steps?.find(item => item.label === assertion.label)?.change?.fields || []).join('、') || '无'}）` }
        : { passed: true, detail: `步骤「${assertion.label}」符合要求` };
    }
    case 'stepCommandField': {
      const commands = (step.commands || []).filter(command => command.type === assertion.type);
      if (!commands.length) return { passed: false, detail: `步骤「${assertion.label}」没有发出 ${assertion.type} 命令` };
      const values = commands.map(command => command[assertion.field]).filter(value => value !== undefined && value !== null);
      if (!values.length) return { passed: false, detail: `步骤「${assertion.label}」的 ${assertion.type} 命令没有设置 ${assertion.field}` };
      if (Object.hasOwn(assertion, 'value')) {
        const ok = values.some(value => stable(value) === stable(assertion.value));
        return ok
          ? { passed: true, detail: `${assertion.type}.${assertion.field} = ${stable(assertion.value)}` }
          : { passed: false, detail: `${assertion.type}.${assertion.field} 应为 ${stable(assertion.value)}，实际 ${values.map(stable).join('、')}` };
      }
      const best = values.reduce((a, b) => (assertion.min !== undefined ? Math.max(a, b) : Math.min(a, b)));
      const problems = checkRange(best, assertion);
      return problems.length
        ? { passed: false, detail: `${assertion.type}.${assertion.field} 的实际值 ${values.map(stable).join('、')} 不满足：${problems.join('、')}` }
        : { passed: true, detail: `${assertion.type}.${assertion.field} 满足要求（${values.map(stable).join('、')}）` };
    }
    default:
      return { passed: false, detail: `不认识的断言类型 ${kind}` };
  }
}

export function evaluateAssertions(assertions = [], trace = {}) {
  const results = [];
  for (const assertion of assertions) {
    let outcome;
    try {
      validateAssertion(assertion);
      outcome = run(assertion, trace);
    } catch (error) {
      outcome = { passed: false, detail: '断言本身无效：' + error.message };
    }
    results.push({ id: assertion?.id || '(缺少 id)', kind: assertion?.kind || null, why: assertion?.why || '', red: assertion?.red || '', ...outcome });
  }
  const passed = results.every(result => result.passed);
  const failed = results.filter(result => !result.passed);
  return {
    format: ASSERTION_FORMAT,
    passed,
    skipped: results.length === 0,
    results,
    summary: !results.length ? '没有断言' : passed ? `${results.length} 条断言全部通过` : `${failed.length} / ${results.length} 条断言未通过：${failed.map(result => result.detail).join('；')}`,
  };
}

// 给模型看的断言清单：模型只能在这 16 种里选，不能自创检查方式。
export function assertionGuide() {
  return [
    '断言是 JSON 数据，只能用下面这些 kind，每条必须写 why（在检查什么）和 red（哪种错误实现会打红它）：',
    "- noErrors：玩法整个过程没有报错。",
    "- newObjects {min, region?:{x:[a,b],z:[a,b],y:[a,b]}, solid?:true}：世界新增了至少 min 个符合区域/碰撞要求的对象。",
    "- removedObjects {min, object?}：至少 min 个对象消失（或指定对象消失）。",
    "- objectField {object, field:position|visible|solid|mesh|health|color, value, step?}：某个对象在最终（或某步之后）的字段等于 value。",
    "- objectHealth {object, min?|max?|exact?, step?}：目标血量满足区间。",
    "- objectDistance {object, min?|max?, step?}：目标与玩家的水平距离满足区间。",
    "- objectsUnchanged {except?:[id]}：除了 except 里的对象，其他对象一个字段都不能变。",
    "- inventory {item, min?|max?|exact?, step?}：背包某物品数量满足区间。",
    "- inventoryDelta {item, delta, step?}：背包某物品在这一步（或全程）变化量正好是 delta。",
    "- resource {id, min?|max?|changed?:true, step?}：玩家资源（体力/魔法等）的值。",
    "- resourceDelta {id, min?|max?, step?}：资源在这一步的变化量。",
    "- playerHealth {min?|max?|exact?, step?}：玩家血量。",
    "- panel {key, exists}：某个面板存在或不存在。",
    "- panelContains {key, text}：面板文本里包含某段文字。",
    "- step {label, minCommands?, commands?:{type,min?,max?}, change?:{minFields?, fields?:[前缀]}}：某一步必须产生命令和可观测变化。",
    "- stepCommandField {label, type, field, min?|max?|value?}：某一步发出的命令字段满足条件（例如 duration>0.05 表示平滑移动而不是瞬移）。",
  ].join('\n');
}
