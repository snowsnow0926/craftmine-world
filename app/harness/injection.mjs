// 注入器：把一份「正确实现的轨迹」改坏，用来验证断言真的会变红。
// 一个断言如果对坏轨迹也说通过，那它就不是断言，是装饰。
const clone = value => structuredClone(value);

const snapshotFields = snapshot => {
  const map = new Map((snapshot?.objects || []).map(object => [object.id, object]));
  return map;
};

function mapSnapshots(trace, transform) {
  const next = clone(trace);
  next.start = next.start ? transform(next.start) : next.start;
  for (const step of next.steps) {
    step.before = step.before ? transform(step.before) : step.before;
    step.after = step.after ? transform(step.after) : step.after;
  }
  next.final = next.final ? transform(next.final) : next.final;
  return next;
}

const changedIds = trace => {
  const start = snapshotFields(trace.baseline || trace.start), final = snapshotFields(trace.final);
  const ids = new Set();
  for (const id of new Set([...start.keys(), ...final.keys()])) {
    const a = start.get(id), b = final.get(id);
    if (!a || !b) { ids.add(id); continue; }
    if (JSON.stringify(a) !== JSON.stringify(b)) ids.add(id);
  }
  return ids;
};

const MUTATIONS = {
  // 命令照发，世界不动 —— 「刷新怪物」那次失败的真实形状。
  noop(trace) {
    const next = clone(trace);
    for (const step of next.steps) { step.after = clone(step.before); step.change = { changed: false, fields: [] }; }
    next.final = clone(next.start);
    return next;
  },
  dropCommands(trace) {
    const next = MUTATIONS.noop(trace);
    for (const step of next.steps) step.commands = [];
    return next;
  },
  // 把变过的对象挪到场地另一头。
  scatter(trace) {
    const ids = changedIds(trace);
    return mapSnapshots(trace, snapshot => {
      for (const object of snapshot.objects || []) if (ids.has(object.id)) object.position = { x: 40, y: 6, z: 40 };
      return snapshot;
    });
  },
  // 把所有变过的对象贴到玩家身上。
  closeIn(trace) {
    const ids = changedIds(trace);
    const player = trace.player || { x: 0, y: 6, z: 0 };
    return mapSnapshots(trace, snapshot => {
      for (const object of snapshot.objects || []) if (ids.has(object.id)) object.position = { x: player.x + .8, y: 6, z: player.z + .8 };
      return snapshot;
    });
  },
  keepVisible(trace) {
    return mapSnapshots(trace, snapshot => {
      for (const object of snapshot.objects || []) {
        object.visible = true;
        if (object.health > 0) object.mesh = true;
      }
      return snapshot;
    });
  },
  freeInventory(trace) {
    return mapSnapshots(trace, snapshot => ({ ...snapshot, inventory: clone(trace.start?.inventory || {}) }));
  },
  freeResource(trace) {
    return mapSnapshots(trace, snapshot => ({ ...snapshot, resources: clone(trace.start?.resources || {}) }));
  },
  dropPanel(trace) {
    return mapSnapshots(trace, snapshot => ({ ...snapshot, panels: {} }));
  },
  reviveNoMesh(trace) {
    return mapSnapshots(trace, snapshot => {
      for (const object of snapshot.objects || []) if (object.health > 0) object.mesh = false;
      return snapshot;
    });
  },
  teleport(trace) {
    const next = clone(trace);
    for (const step of next.steps) for (const command of step.commands || []) if (command.type === 'object.patch') delete command.duration;
    return next;
  },
  // 第一次怎么扣，后面每次都照扣。
  repeatCost(trace) {
    const next = clone(trace);
    const deltaOf = step => {
      const delta = {};
      if (!step?.before || !step?.after) return delta;
      for (const item of new Set([...Object.keys(step.before.inventory || {}), ...Object.keys(step.after.inventory || {})]))
        delta[item] = (step.after.inventory[item] || 0) - (step.before.inventory[item] || 0);
      return delta;
    };
    const first = next.steps.find(step => Object.values(deltaOf(step)).some(value => value !== 0));
    if (!first) return next;
    const delta = deltaOf(first);
    for (const step of next.steps) {
      if (!step.before) continue;
      const inventory = clone(step.before.inventory || {});
      for (const [item, value] of Object.entries(delta)) {
        const total = (inventory[item] || 0) + value;
        if (total > 0) inventory[item] = total; else delete inventory[item];
      }
      step.after = { ...clone(step.before), inventory };
      step.change = { changed: true, fields: Object.keys(delta).map(item => `inventory.${item}`) };
    }
    if (next.final) next.final = clone(next.steps[next.steps.length - 1]?.after || next.final);
    return next;
  },
};

export const MUTATION_NAMES = Object.freeze(Object.keys(MUTATIONS));

export function mutateTrace(trace, name) {
  const mutation = MUTATIONS[name];
  if (!mutation) throw Error(`没有名为 ${name} 的注入方式；可用：${MUTATION_NAMES.join('、')}`);
  return mutation(trace);
}

export function mutationCatalog() {
  return MUTATION_NAMES.map(name => ({ name }));
}
