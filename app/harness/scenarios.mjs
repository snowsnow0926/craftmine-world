// 冻结需求集里每条需求所在的「世界」与「事件序列」。
// 这些夹具是判定的一部分：需求换一个世界就可能换一个答案，所以必须固定下来。
const part = (offset, size, color, shape = 'box', solid = false, material = 'solid') => ({
  shape, offset: { x: offset[0], y: offset[1], z: offset[2] }, size: { x: size[0], y: size[1], z: size[2] }, color, solid, material,
});
const obj = (id, name, x, z, parts, health = 0) => ({
  id, name, position: { x, y: 6, z }, source: null, components: { health, contactDamage: 0 }, parts,
});
const tree = (id, x, z, crownY = 3) => obj(id, '树', x, z, [
  part([0, 0, 0], [.6, 3, .6], '#8a6b45', 'box', true, 'wood'),
  part([-1.1, crownY, -1.1], [2.8, 1.8, 2.8], '#6f9f52', 'box', false, 'leaves'),
]);
const door = (id, x, z) => obj(id, '木门', x, z, [
  part([0, 0, 0], [1, 2.4, .18], '#c8a06a', 'box', true, 'wood'),
  part([.34, 1.1, .1], [.12, .12, .1], '#f0d9a8'),
]);
const zombie = (id, x, z) => obj(id, '怪物', x, z, [
  part([0, 0, 0], [.6, 1.5, .6], '#7d9b63', 'box', true),
  part([-.28, 1.5, -.28], [1.16, .5, 1.16], '#9ab97a'),
], 40);
const scene = (title, objects, systems = []) => ({ format: 'craftmine.scene/3', title, night: false, objects, systems, behaviors: [] });
const stamina = { id: 'system-stamina', type: 'resource', name: '体力', config: { max: 100, regenPerSecond: 0, start: 100 }, source: null };
const health = { id: 'system-health', type: 'health', name: '生命值', config: { maxHealth: 100, fallDamage: 5, regenPerSecond: 0 }, source: null };

const event = (label, type, extra = {}) => ({ label, type, ...extra });

// 每条需求的场景、玩家出生点、初始存档与事件序列。candidate 由被测实现提供。
export const SCENARIOS = Object.freeze({
  // 1. 在我前面种三棵树：玩家在 z=20 面向 -z，前方是 z<20。
  field: {
    player: { x: 0, y: 6, z: 20, yaw: 0, pitch: 0 },
    scene: () => scene('开阔地', [obj('rock-1', '岩石', 12, 12, [part([0, 0, 0], [1.4, 1.1, 1.4], '#8d8d8d', 'box', true, 'stone')])]),
    events: [event('start', 'start'), event('idle', 'tick', { dt: .1 })],
  },
  // 2. 把那棵树变高一点：树冠是独立对象，只有它该动。
  treePair: {
    player: { x: 0, y: 6, z: 20, yaw: 0, pitch: 0 },
    scene: () => scene('两棵树', [
      obj('tree-1', '主树', -6, 6, [part([0, 0, 0], [.6, 3, .6], '#8a6b45', 'box', true, 'wood')]),
      obj('tree-1-crown', '主树树冠', -6, 6, [part([0, 3, 0], [2.8, 1.8, 2.8], '#6f9f52', 'box', false, 'leaves')]),
      obj('tree-2', '旁边的树', 6, 6, [part([0, 0, 0], [.6, 3, .6], '#8a6b45', 'box', true, 'wood'), part([-1.1, 3, -1.1], [2.8, 1.8, 2.8], '#6f9f52', 'box', false, 'leaves')]),
    ]),
    events: [event('start', 'start'), event('idle', 'tick', { dt: .1 })],
  },
  // 3. 开门消耗木头：背包只有一块，两扇门。
  doors: {
    player: { x: 0, y: 6, z: 14, yaw: 0, pitch: 0 },
    inventory: { wood: 1 },
    scene: () => scene('两扇木门', [door('door-1', 2, 8), door('door-2', -2, 8)]),
    events: [event('start', 'start'), event('idle', 'tick', { dt: .1 }), event('open-1', 'interact', { targetId: 'door-1' }), event('open-2', 'interact', { targetId: 'door-2' })],
  },
  // 4. 砍树掉木材：一棵有血量的树，砍两次。
  choppable: {
    player: { x: 0, y: 6, z: 14, yaw: 0, pitch: 0 },
    scene: () => scene('可砍的树', [tree('tree-1', 0, 8)]),
    events: [event('start', 'start'), event('idle', 'tick', { dt: .1 }), event('hit-1', 'attack', { targetId: 'tree-1' }), event('hit-2', 'attack', { targetId: 'tree-1' })],
  },
  // 5. 三块木头做门：两个门蓝图，先够后不够，最后恢复存档。
  craft: {
    player: { x: 0, y: 6, z: 14, yaw: 0, pitch: 0 },
    inventory: { wood: 3 },
    scene: () => scene('待制作的门', [door('door-3', 2, 8), door('door-4', -2, 8)]),
    events: [event('start', 'start'), event('idle', 'tick', { dt: .1 }), event('craft-1', 'key', { code: 'KeyB' }), event('craft-2', 'key', { code: 'KeyB' }), event('craft-3', 'key', { code: 'KeyB' }), event('restore', 'restore')],
  },
  // 6. 按 G 复活：两只怪物死在别处，出生点在 (2,8) 与 (-2,8)。
  zombies: {
    player: { x: 0, y: 6, z: 14, yaw: 0, pitch: 0 },
    scene: () => scene('两只怪物', [zombie('zombie-1', 5, 12), zombie('zombie-2', -5, 12)], [health]),
    gameplay: { systems: {}, equipped: null, targets: { 'zombie-1': { health: 0, maxHealth: 40 }, 'zombie-2': { health: 0, maxHealth: 40 } } },
    events: [event('start', 'start'), event('idle', 'tick', { dt: .1 }), event('revive', 'key', { code: 'KeyG' })],
  },
  // 7. 体力条：先跑一段再站着不动。
  stamina: {
    player: { x: 0, y: 6, z: 20, yaw: 0, pitch: 0 },
    scene: () => scene('体力试验场', [], [health, stamina]),
    events: [event('start', 'start'), event('idle-1', 'tick', { dt: .5 }), event('run-1', 'tick', { dt: .5, move: { x: 0, z: -1.4 } }), event('rest-1', 'tick', { dt: .5 })],
  },
  // 8. 近战追人、远程保持距离：两只怪，玩家站在中间。
  hunters: {
    player: { x: 0, y: 6, z: 26, yaw: 0, pitch: 0 },
    scene: () => scene('两只怪物', [zombie('melee-1', 0, 20), zombie('ranged-1', 0, 40)], [health]),
    events: [event('start', 'start'), event('idle', 'tick', { dt: .1 }), event('tick-1', 'tick', { dt: .3 }), event('tick-2', 'tick', { dt: .3 }), event('tick-3', 'tick', { dt: .3 }), event('tick-4', 'tick', { dt: .3 })],
  },
  // 9. 命中反馈：一个靶子，打三下。
  dummy: {
    player: { x: 0, y: 6, z: 14, yaw: 0, pitch: 0 },
    scene: () => scene('训练靶', [zombie('zombie-1', 0, 10)]),
    events: [event('start', 'start'), event('idle', 'tick', { dt: .1 }), event('hit-1', 'attack', { targetId: 'zombie-1' }), event('hit-2', 'attack', { targetId: 'zombie-1' }), event('hit-3', 'attack', { targetId: 'zombie-1' })],
  },
  // 10. 木头换血瓶：五块木头，够买两次。
  shop: {
    player: { x: 0, y: 6, z: 14, yaw: 0, pitch: 0 },
    inventory: { wood: 5 },
    scene: () => scene('商店', [obj('sign-1', '招牌', 0, 8, [part([0, 0, 0], [.2, 2, .2], '#7a5a3a', 'box', true, 'wood'), part([-.7, 2, -.1], [1.6, .5, .2], '#d8b473', 'box', true, 'planks')])], [health]),
    events: [event('start', 'start'), event('idle', 'tick', { dt: .1 }), event('buy-1', 'key', { code: 'KeyC' }), event('buy-2', 'key', { code: 'KeyC' }), event('buy-3', 'key', { code: 'KeyC' })],
  },
});

export const SCENARIO_NAMES = Object.freeze(Object.keys(SCENARIOS));

export function scenario(name) {
  const found = SCENARIOS[name];
  if (!found) throw Error(`没有名为 ${name} 的需求场景；可用：${SCENARIO_NAMES.join('、')}`);
  return found;
}
