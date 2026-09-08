export const ACCEPTANCE_FORMAT = 'craftmine.acceptance/1';

// 结果级验收：不看代码写了什么，只看运行之后世界有没有真的变。
// 只产生命令不算通过——「刷新怪物」那次失败正是命令有效、世界没变。
const stable = value => JSON.stringify(value);

export function worldSnapshot(input = {}) {
  const objects = [...(input.objects || [])].map(object => ({
    id: object.id,
    position: object.position ? { x: object.position.x, y: object.position.y, z: object.position.z } : null,
    visible: object.visible !== false,
    mesh: object.mesh !== false,
    health: Number.isFinite(object.health) ? object.health : null,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const inventory = Object.fromEntries(Object.entries(input.inventory || {}).sort(([a], [b]) => a.localeCompare(b)));
  const panels = Object.fromEntries(Object.entries(input.panels || {}).map(([key, value]) => [key, stable(value)]).sort(([a], [b]) => a.localeCompare(b)));
  return {
    playerHealth: Number.isFinite(input.playerHealth) ? input.playerHealth : null,
    objects, inventory, panels,
    effects: (input.effects || []).map(effect => effect.type),
  };
}

export function observableChange(before, after) {
  const fields = [];
  if (!before || !after) return { changed: false, fields };
  if (before.playerHealth !== after.playerHealth) fields.push('player.health');
  const oldObjects = new Map(before.objects.map(object => [object.id, object]));
  const newObjects = new Map(after.objects.map(object => [object.id, object]));
  for (const id of [...new Set([...oldObjects.keys(), ...newObjects.keys()])].sort()) {
    const old = oldObjects.get(id), next = newObjects.get(id);
    if (!old || !next) { fields.push(`object:${id}`); continue; }
    for (const key of ['visible', 'mesh', 'health']) if (old[key] !== next[key]) fields.push(`object:${id}.${key}`);
    if (stable(old.position) !== stable(next.position)) fields.push(`object:${id}.position`);
  }
  for (const key of [...new Set([...Object.keys(before.inventory), ...Object.keys(after.inventory)])].sort())
    if ((before.inventory[key] ?? 0) !== (after.inventory[key] ?? 0)) fields.push(`inventory.${key}`);
  for (const key of [...new Set([...Object.keys(before.panels), ...Object.keys(after.panels)])].sort())
    if (before.panels[key] !== after.panels[key]) fields.push(`panel.${key}`);
  if (stable(before.effects) !== stable(after.effects)) fields.push('effects');
  return { changed: fields.length > 0, fields };
}

// 自动从模块声明派生验收条件：声明了按键，按键就必须真的做点什么。
export function evaluateKeyAcceptance({ declaredKeys = [], keyCommands = 0, observations = [] } = {}) {
  const assertions = [];
  if (!declaredKeys.length) return { format: ACCEPTANCE_FORMAT, passed: true, skipped: true, assertions, summary: '模块没有声明按键，跳过按键验收' };
  assertions.push({
    id: 'key.commands', kind: 'keyCommands', passed: keyCommands > 0,
    detail: keyCommands > 0 ? `按键产生了 ${keyCommands} 条命令` : '按键没有产生任何命令：不要读取 frame.keys，按键事件带 code',
  });
  const changed = observations.filter(observation => observation?.change?.changed);
  assertions.push({
    id: 'key.effect', kind: 'observableEffect', passed: changed.length > 0,
    detail: changed.length
      ? `按键造成可观测变化：${changed.map(observation => `${observation.code} → ${observation.change.fields.join('、')}`).join('；')}`
      : '按键只产生了命令，但世界没有任何可观测变化（位置、可见、模型、血量、背包、面板和效果都没变）。对已死亡目标使用 object.patch 的 visible:true 不会让它复活，请用 target.revive。',
  });
  const passed = assertions.every(assertion => assertion.passed);
  return { format: ACCEPTANCE_FORMAT, passed, skipped: false, assertions, summary: passed ? '按键验收通过' : '按键验收未通过' };
}
