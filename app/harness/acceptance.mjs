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
    solid: object.solid !== false,
    color: typeof object.color === 'string' ? object.color : null,
    bounds: object.bounds ? { min: { ...object.bounds.min }, max: { ...object.bounds.max } } : null,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const inventory = Object.fromEntries(Object.entries(input.inventory || {}).sort(([a], [b]) => a.localeCompare(b)));
  const items = Object.fromEntries(Object.entries(input.items || {}).map(([id, item]) => [id, item?.name || id]).sort(([a], [b]) => a.localeCompare(b)));
  const resources = Object.fromEntries(Object.entries(input.resources || {}).map(([id, value]) => [id, { value: Number(value?.value) || 0, max: Number(value?.max) || 0 }]).sort(([a], [b]) => a.localeCompare(b)));
  const panels = Object.fromEntries(Object.entries(input.panels || {}).map(([key, value]) => [key, stable(value)]).sort(([a], [b]) => a.localeCompare(b)));
  return {
    playerHealth: Number.isFinite(input.playerHealth) ? input.playerHealth : null,
    objects, inventory, items, resources, panels,
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
    for (const key of ['visible', 'mesh', 'health', 'solid', 'color']) if (old[key] !== next[key]) fields.push(`object:${id}.${key}`);
    if (stable(old.position) !== stable(next.position)) fields.push(`object:${id}.position`);
    if (stable(old.bounds) !== stable(next.bounds)) fields.push(`object:${id}.bounds`);
  }
  for (const key of [...new Set([...Object.keys(before.inventory), ...Object.keys(after.inventory)])].sort())
    if ((before.inventory[key] ?? 0) !== (after.inventory[key] ?? 0)) fields.push(`inventory.${key}`);
  for (const key of [...new Set([...Object.keys(before.items || {}), ...Object.keys(after.items || {})])].sort())
    if (before.items?.[key] !== after.items?.[key]) fields.push(`item.${key}`);
  for (const key of [...new Set([...Object.keys(before.resources || {}), ...Object.keys(after.resources || {})])].sort())
    if (stable(before.resources?.[key]) !== stable(after.resources?.[key])) fields.push(`resource.${key}`);
  for (const key of [...new Set([...Object.keys(before.panels), ...Object.keys(after.panels)])].sort())
    if (before.panels[key] !== after.panels[key]) fields.push(`panel.${key}`);
  if (stable(before.effects) !== stable(after.effects)) fields.push('effects');
  return { changed: fields.length > 0, fields };
}

// 命令级验收：每条命令都必须在事件前后真的改变世界；只是「发出去」不算通过。
const objectOf = (snapshot, id) => snapshot?.objects.find(object => object.id === id) || null;
const clampInventory = value => Math.max(0, Math.min(9999, value));

function checkCommand(command, before, after) {
  if (!before || !after || !command) return null;
  const id = command.id;
  const old = id ? objectOf(before, id) : null;
  const next = id ? objectOf(after, id) : null;
  if (command.type === 'object.patch') {
    if (!old || !next) return { passed: false, detail: `object.patch 的目标 ${id} 在事件前后不存在` };
    const wanted = [];
    if (command.position && stable(old.position) !== stable(command.position)) wanted.push(['位置', stable(next.position) === stable(command.position), `位置应为 ${JSON.stringify(command.position)}，实际 ${JSON.stringify(next.position)}`]);
    if (command.visible !== null && command.visible !== undefined && old.visible !== command.visible) wanted.push(['可见', next.visible === command.visible, `可见应为 ${command.visible}`]);
    if (command.solid !== null && command.solid !== undefined && old.solid !== command.solid) wanted.push(['碰撞', next.solid === command.solid, `碰撞应为 ${command.solid}`]);
    if (command.visible === true && old.mesh === false) wanted.push(['模型', next.mesh === true, '要求显示的对象没有重建模型（已死亡的目标必须用 target.revive）']);
    if (!wanted.length) return null;
    const failed = wanted.filter(([, ok]) => !ok);
    return failed.length
      ? { passed: false, detail: `object.patch ${id} 没有生效：${failed.map(([, , text]) => text).join('；')}` }
      : { passed: true, detail: `object.patch ${id} 生效：${wanted.map(([name]) => name).join('、')}` };
  }
  if (command.type === 'target.revive') {
    if (!old || !next) return { passed: false, detail: `target.revive 的目标 ${id} 在事件前后不存在` };
    if (old.health > 0) return null;
    const ok = next.health > 0 && next.mesh;
    return { passed: ok, detail: ok ? `target.revive ${id} 已复活（血量 ${next.health}）` : `target.revive ${id} 没有让目标复活（血量 ${next.health}，模型${next.mesh ? '已重建' : '仍缺失'}）` };
  }
  if (command.type === 'inventory.add') {
    const oldCount = before.inventory[command.item] ?? 0;
    const expected = clampInventory(oldCount + command.count);
    if (expected === oldCount) return null;
    const actual = after.inventory[command.item] ?? 0;
    return { passed: actual === expected, detail: actual === expected ? `inventory.add ${command.item} 生效（${oldCount} → ${actual}）` : `inventory.add ${command.item} 期望 ${expected}，实际 ${actual}` };
  }
  if (command.type === 'hud.panel') {
    const had = Object.keys(before.panels).some(name => name.endsWith(':' + command.key));
    const has = Object.keys(after.panels).some(name => name.endsWith(':' + command.key));
    if (command.panel === null) return had ? { passed: !has, detail: has ? `hud.panel ${command.key} 没有被删除` : `hud.panel ${command.key} 已删除` } : null;
    return { passed: has, detail: has ? `hud.panel ${command.key} 已创建` : `hud.panel ${command.key} 没有出现` };
  }
  return null;
}

export function evaluateCommandAcceptance({ observations = [] } = {}) {
  const assertions = [];
  let index = 0;
  for (const observation of observations) {
    for (const command of observation?.commands || []) {
      index += 1;
      const check = checkCommand(command, observation.before, observation.after);
      if (check) assertions.push({ id: `${observation?.event?.type || 'event'}#${index}:${command.type}`, kind: 'commandEffect', ...check });
    }
  }
  const passed = assertions.every(assertion => assertion.passed);
  return {
    format: ACCEPTANCE_FORMAT, passed, skipped: assertions.length === 0, assertions,
    summary: !assertions.length ? '没有可检查的命令' : passed ? '命令级验收通过' : '命令级验收未通过',
  };
}
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
