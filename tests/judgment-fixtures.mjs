// 参考实现：给「冻结需求集」的每条需求一份正确候选，另附一份故意写错的候选。
// 它们只用于验证裁判本身（正确实现必须通过、坏实现必须被打红），不属于玩家世界。
const part = (offset, size, color, shape = 'box', solid = false, material = 'solid') => ({
  shape, offset: { x: offset[0], y: offset[1], z: offset[2] }, size: { x: size[0], y: size[1], z: size[2] }, color, solid, material,
});
const tree = (id, x, z) => ({
  id, name: '树', position: { x, y: 6, z }, source: null, components: { health: 0, contactDamage: 0 },
  parts: [part([0, 0, 0], [.6, 3, .6], '#8a6b45', 'box', true, 'wood'), part([-1.1, 3, -1.1], [2.8, 1.8, 2.8], '#6f9f52', 'box', false, 'leaves')],
});
const behavior = (id, name, targets, permissions, capabilities, code, extra = {}) => ({
  format: 'craftmine.behavior/3', id, name, description: name, stateVersion: 1,
  initialState: extra.initialState || {}, params: extra.params || {}, targets, permissions, capabilities,
  requires: [], binding: null, code, ...(extra.keys ? { keys: extra.keys } : {}),
});

export const CANDIDATES = {
  'r01-plant-three-trees': {
    scene: base => ({ ...base, objects: [...base.objects, tree('tree-a', -2, 14), tree('tree-b', 0, 15), tree('tree-c', 2, 14)] }),
  },
  'r03-door-costs-wood': {
    behaviors: [behavior('door-cost', '消耗木头的门', ['door-1', 'door-2'], ['objects.write', 'inventory.write', 'hud.message'], ['inventory.read@1'], `export function step({frame,state}) {
  if (frame.event.type !== 'interact' || !frame.event.targetId) return { state, commands: [] };
  if ((frame.inventory.wood || 0) < 1) return { state, commands: [{ type: 'hud.message', text: '木头不够，打不开' }] };
  return { state, commands: [
    { type: 'inventory.add', item: 'wood', count: -1 },
    { type: 'object.patch', id: frame.event.targetId, visible: false },
    { type: 'hud.message', text: '门开了' },
  ] };
}`)],
  },
  'r04-chop-tree-drop-wood': {
    behaviors: [behavior('chopper', '砍树', ['tree-1'], ['objects.write', 'inventory.write', 'hud.message'], ['inventory.read@1'], `export function step({frame,state}) {
  if (frame.event.type !== 'attack' || frame.event.targetId !== 'tree-1') return { state, commands: [] };
  if (state.chopped) return { state, commands: [{ type: 'hud.message', text: '树已经倒了' }] };
  return { state: { ...state, chopped: true }, commands: [
    { type: 'inventory.add', item: 'wood', count: 3 },
    { type: 'object.patch', id: 'tree-1', visible: false },
    { type: 'hud.message', text: '获得木材 ×3', tone: 'success' },
  ] };
}`, { initialState: { chopped: false } })],
  },
  'r05-craft-door-from-three-wood': {
    behaviors: [behavior('craft-door', '三木成门', ['door-3', 'door-4'], ['objects.write', 'inventory.write', 'hud.message'], ['inventory.read@1'], `export function step({frame,state}) {
  if (frame.event.type === 'start') return { state, commands: state.built ? [] : [
    { type: 'object.patch', id: 'door-3', visible: false, solid: false },
    { type: 'object.patch', id: 'door-4', visible: false, solid: false },
  ] };
  if (frame.event.type !== 'key' || frame.event.code !== 'KeyB') return { state, commands: [] };
  if (state.built) return { state, commands: [{ type: 'hud.message', text: '已经做过了' }] };
  if ((frame.inventory.wood || 0) < 3) return { state, commands: [{ type: 'hud.message', text: '木头不够' }] };
  return { state: { ...state, built: true }, commands: [
    { type: 'inventory.add', item: 'wood', count: -3 },
    { type: 'object.patch', id: 'door-3', visible: true, solid: true },
    { type: 'hud.message', text: '做好一扇门' },
  ] };
}`, { initialState: { built: false } })],
  },
  'r06-revive-monsters': {
    behaviors: [behavior('respawn', '刷新怪物', ['zombie-1', 'zombie-2'], ['targets.write', 'objects.write', 'hud.message'], [], `export function step({frame,params,state}) {
  if (frame.event.type !== 'key' || frame.event.code !== 'KeyG') return { state, commands: [] };
  return { state, commands: [
    { type: 'target.revive', id: 'zombie-1' },
    { type: 'object.patch', id: 'zombie-1', position: params.spawn['zombie-1'] },
    { type: 'target.revive', id: 'zombie-2' },
    { type: 'object.patch', id: 'zombie-2', position: params.spawn['zombie-2'] },
    { type: 'hud.message', text: '怪物已刷新', tone: 'success' },
  ] };
}`, { params: { spawn: { 'zombie-1': { x: 2, y: 6, z: 8 }, 'zombie-2': { x: -2, y: 6, z: 8 } } }, keys: ['KeyG'] })],
  },
  'r07-stamina-bar': {
    behaviors: [behavior('stamina', '体力条', [], ['resources.write'], [], `export function step({frame,state}) {
  if (frame.event.type !== 'tick') return { state, commands: [] };
  const now = { x: frame.player.position.x, z: frame.player.position.z };
  const moved = state.last ? Math.hypot(now.x - state.last.x, now.z - state.last.z) : 0;
  return { state: { last: now }, commands: [{ type: 'resource.add', id: 'system-stamina', amount: moved > 0.05 ? -8 : 2 }] };
}`, { initialState: { last: null } })],
  },
  'r09-hit-feedback': {
    behaviors: [behavior('hit-feedback', '命中反馈', ['zombie-1'], ['objects.write', 'audio.play', 'hud.message'], [], `export function step({frame,params,state}) {
  if (frame.event.type !== 'attack' || frame.event.targetId !== 'zombie-1') return { state, commands: [] };
  const hits = (state.hits || 0) + 1, base = params.base;
  if (hits >= 3) return { state: { hits }, commands: [
    { type: 'object.patch', id: 'zombie-1', visible: false },
    { type: 'audio.play', sound: 'explode' },
    { type: 'hud.message', text: '目标倒下', tone: 'warn' },
  ] };
  return { state: { hits }, commands: [
    { type: 'object.patch', id: 'zombie-1', color: '#ff4444', position: { x: base.x, y: base.y, z: base.z + hits }, duration: .15 },
    { type: 'audio.play', sound: 'hit' },
  ] };
}`, { initialState: { hits: 0 }, params: { base: { x: 0, y: 6, z: 10 } } })],
  },
  'r10-shop-panel': {
    behaviors: [behavior('shop', '木头商店', [], ['inventory.write', 'hud.message'], ['inventory.read@1', 'inventory.items@1', 'hud.panel@1'], `export function step({frame,params,state}) {
  const wood = frame.inventory.wood || 0, potion = frame.inventory.potion || 0;
  const panel = { type: 'hud.panel', key: 'shop', panel: { title: '商店', lines: [
    '木头 ' + wood, '血瓶 ' + potion, '按 C：' + params.cost + ' 木头换 1 血瓶',
  ] } };
  if (frame.event.type === 'start') return { state, commands: [
    { type: 'inventory.define', item: 'wood', name: '木头', description: '建材' },
    { type: 'inventory.define', item: 'potion', name: '血瓶', description: '恢复生命' },
    panel,
  ] };
  if (frame.event.type !== 'key' || frame.event.code !== 'KeyC') return { state, commands: [] };
  if (wood < params.cost) return { state, commands: [{ type: 'hud.message', text: '木头不够', tone: 'warn' }, panel] };
  return { state, commands: [
    { type: 'inventory.add', item: 'wood', count: -params.cost },
    { type: 'inventory.add', item: 'potion', count: 1 },
    { type: 'hud.message', text: '买到血瓶', tone: 'success' },
    { type: 'hud.panel', key: 'shop', panel: { title: '商店', lines: [
      '木头 ' + (wood - params.cost), '血瓶 ' + (potion + 1), '按 C：' + params.cost + ' 木头换 1 血瓶',
    ] } },
  ] };
}`, { params: { cost: 2 } })],
  },
};

// 故意写错的实现：命令有效、世界没变（历史上「刷新怪物」失败的真实形状）。
export const FAULTY = {
  'r06-revive-monsters': {
    behaviors: [behavior('respawn-broken', '刷新怪物（坏的）', ['zombie-1', 'zombie-2'], ['objects.write', 'hud.message'], [], `export function step({frame,params,state}) {
  if (frame.event.type !== 'key' || frame.event.code !== 'KeyG') return { state, commands: [] };
  return { state, commands: [
    { type: 'object.patch', id: 'zombie-1', visible: true, position: params.spawn['zombie-1'] },
    { type: 'object.patch', id: 'zombie-2', visible: true, position: params.spawn['zombie-2'] },
    { type: 'hud.message', text: '怪物已刷新' },
  ] };
}`, { params: { spawn: { 'zombie-1': { x: 2, y: 6, z: 8 }, 'zombie-2': { x: -2, y: 6, z: 8 } } }, keys: ['KeyG'] })],
  },
  'r10-shop-panel': {
    behaviors: [behavior('shop-broken', '木头商店（坏的）', [], ['inventory.write', 'hud.message'], ['inventory.read@1'], `export function step({frame,params,state}) {
  if (frame.event.type !== 'key' || frame.event.code !== 'KeyC') return { state, commands: [] };
  return { state, commands: [
    { type: 'inventory.add', item: 'wood', count: -2 },
    { type: 'inventory.add', item: 'potion', count: 1 },
  ] };
}`, { params: { cost: 2 } })],
  },
};
