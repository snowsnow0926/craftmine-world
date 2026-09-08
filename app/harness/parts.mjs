// 内核可替换部件的浏览器侧注册表。游戏页和 world-runtime 都从这里取当前生效的部件。
// 这里只做注册与查找，不做审批：审批在 Node 侧的 harness/kernel.mjs（必须有人审一次）。
export const PART_KINDS = Object.freeze(['renderPass', 'hudWidget', 'postProcess']);
export const PART_DEFAULTS = Object.freeze({ renderPass: 'default', hudWidget: 'default', postProcess: 'default' });
const PART_ID = /^[a-z][a-z0-9-]{0,47}$/;

const registry = new Map(PART_KINDS.map(kind => [kind, new Map()]));
const active = new Map(PART_KINDS.map(kind => [kind, PART_DEFAULTS[kind]]));
const instances = new Map();

function need(condition, message) { if (!condition) throw Error(message); }
function kindOf(kind) {
  need(PART_KINDS.includes(kind), `未知的部件类型：${kind}；可用：${PART_KINDS.join('、')}`);
  return kind;
}

export function registerPart(kind, id, factory, approval) {
  kindOf(kind);
  need(PART_ID.test(id || ''), `部件 ID 无效：${id}（小写字母开头，可含数字和连字符）`);
  need(typeof factory === 'function', `部件 ${kind}/${id} 需要一个工厂函数`);
  // 内核部件的第一个改动必须有人审一次：没有审批记录就一步都走不了。
  need(approval && typeof approval === 'object' && typeof approval.by === 'string' && approval.by.trim().length > 0 && Number.isFinite(approval.at),
    `部件 ${kind}/${id} 必须带人工审批记录 {by, at} 才能注册`);
  const parts = registry.get(kind);
  need(!parts.has(id), `部件 ${kind}/${id} 已经注册，不能重复注册`);
  parts.set(id, { kind, id, factory, builtin: false, approval: { by: approval.by.trim(), at: approval.at } });
  // 新注册的部件立刻生效：调用方想换回来必须显式 usePart，语义和扩展升级一致。
  active.set(kind, id);
  instances.delete(kind);
  return { kind, id, builtin: false, active: true, approval: { by: approval.by.trim(), at: approval.at } };
}

// 切回某个已注册的部件；切到内置默认也走这里，因此不存在「悄悄消失」的路径。
export function usePart(kind, id) {
  kindOf(kind);
  need(registry.get(kind).has(id), `部件 ${kind}/${id} 没有注册`);
  active.set(kind, id);
  instances.delete(kind);
  return { kind, id, active: true };
}

// 卸载自定义部件：当前生效的那个被卸载时自动回退到内置默认。
export function unregisterPart(kind, id) {
  kindOf(kind);
  const parts = registry.get(kind);
  const entry = parts.get(id);
  need(entry, `部件 ${kind}/${id} 没有注册`);
  need(!entry.builtin, `内置部件 ${kind}/${id} 不允许卸载`);
  parts.delete(id);
  if (active.get(kind) === id) { active.set(kind, PART_DEFAULTS[kind]); instances.delete(kind); }
  return { kind, id, removed: true, active: active.get(kind) };
}

// 工厂只在部件切换时调用一次：渲染热路径里不能再有分配和副作用。
export function getPart(kind) {
  kindOf(kind);
  const id = active.get(kind);
  if (!id) return null;
  const entry = registry.get(kind).get(id);
  if (!entry) return null;
  const cached = instances.get(kind);
  if (cached && cached.id === id) return cached.instance;
  const instance = entry.factory();
  instances.set(kind, { id, instance });
  return instance;
}

export function activePartId(kind) {
  kindOf(kind);
  return active.get(kind) || null;
}

export function listParts(kind) {
  const kinds = kind === undefined ? PART_KINDS : [kindOf(kind)];
  return kinds.flatMap(name => [...registry.get(name).values()].map(entry => ({ kind: entry.kind, id: entry.id, builtin: entry.builtin, active: active.get(entry.kind) === entry.id, approvedBy: entry.approval?.by || null })));
}

function defineDefault(kind, factory) {
  registry.get(kind).set(PART_DEFAULTS[kind], { kind, id: PART_DEFAULTS[kind], factory, builtin: true });
}

// 内置默认必须「什么都不做」：没有装载任何部件时，游戏行为和以前一模一样。
defineDefault('renderPass', () => ({ id: 'default', kind: 'renderPass', run() { return null; } }));
defineDefault('hudWidget', () => ({ id: 'default', kind: 'hudWidget', render() { return null; } }));
defineDefault('postProcess', () => {
  const identity = value => value;
  identity.id = 'default';
  identity.kind = 'postProcess';
  return identity;
});
