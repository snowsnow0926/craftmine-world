import { createHash } from 'node:crypto';
import { canonicalJSON } from '../canonical.mjs';

// 冻结需求集：10 条玩家真会说的话，每条都带机器可跑的断言。
// 这个文件是「什么算对」的唯一定义，属于判定面——只允许人来改，模型不能碰。
export const REQUIREMENTS_FORMAT = 'craftmine.requirements/1';
export const REQUIREMENTS_VERSION = 1;

const A = (id, kind, why, red, extra = {}) => ({ id, kind, why, red, ...extra });

export const REQUIREMENTS = Object.freeze([
  {
    id: 'r01-plant-three-trees', index: 1, scenario: 'field',
    said: '在我前面种三棵树', shape: '纯造世界',
    acceptance: '物体数 +3，位置在前方，有碰撞',
    assertions: [
      A('r01.no-errors', 'noErrors', '种完树世界不能因为代码报错而卡住', '实现让模块抛错'),
      A('r01.three-solid-trees', 'newObjects', '玩家前方多出三棵有碰撞的树，而不是只写了日志', '实现什么都没造，或把树种到别处/没有碰撞', { min: 3, region: { x: [-8, 8], z: [10, 18], y: [6, 20] }, solid: true }),
      A('r01.others-untouched', 'objectsUnchanged', '原来就有的岩石不能被顺手挪走或删掉', '实现为了腾地方把已有对象搬走', { except: [] }),
    ],
    reds: [{ mutation: 'noop', note: '什么都不做的实现必须被打红' }, { mutation: 'scatter', note: '把树造到玩家背后的实现必须被打红' }],
  },
  {
    id: 'r02-taller-tree', index: 2, scenario: 'treePair',
    said: '把那棵树变高一点', shape: '改参数',
    acceptance: '只有目标对象变化，其他对象哈希不变',
    assertions: [
      A('r02.no-errors', 'noErrors', '改高度不能把玩法模块搞崩', '实现让模块抛错'),
      A('r02.crown-raised', 'objectField', '树冠真的升高了 2 米', '实现只回了一句「已加高」但世界没变', { object: 'tree-1-crown', field: 'position', value: { x: -6, y: 11, z: 6 } }),
      A('r02.only-crown', 'objectsUnchanged', '除了树冠，树干和旁边的树一个字段都不能变', '实现把整片区域都重算了一遍，顺手动了别的对象', { except: ['tree-1-crown'] }),
    ],
    reds: [{ mutation: 'noop', note: '没改高度的实现' }, { mutation: 'scatter', note: '顺手挪动其他对象的实现' }],
  },
  {
    id: 'r03-door-costs-wood', index: 3, scenario: 'doors',
    said: '开门要消耗一块木头', shape: '条件 + 扣料',
    acceptance: '木头不足时门不开；开一次扣一块；重复开不重复扣',
    assertions: [
      A('r03.no-errors', 'noErrors', '缺料的情况也要正常返回提示，不能报错停摆', '实现用抛异常处理料不够'),
      A('r03.first-open-observable', 'step', '第一次开门的这一步必须真的让世界变了', '实现只发命令不改世界', { label: 'open-1', change: { minFields: 1 } }),
      A('r03.charges-one-wood', 'inventoryDelta', '开一次门正好扣一块木头', '实现开门不扣料，或扣了别的数量', { item: 'wood', delta: -1, step: 'open-1' }),
      A('r03.door-opens', 'objectField', '第一扇门在开完之后确实打开了', '实现扣了料却没开门', { object: 'door-1', field: 'visible', value: false, step: 'open-1' }),
      A('r03.no-wood-no-open', 'objectField', '木头已经用光时第二扇门必须保持关着', '实现忽略库存直接开门', { object: 'door-2', field: 'visible', value: true, step: 'open-2' }),
      A('r03.no-double-charge', 'inventoryDelta', '料不够时不能再扣一次', '实现对失败的操作也扣料', { item: 'wood', delta: 0, step: 'open-2' }),
      A('r03.wood-spent', 'inventory', '最后背包里的木头正好用完', '实现扣料数量算错', { item: 'wood', exact: 0 }),
    ],
    reds: [{ mutation: 'freeInventory', note: '开门不扣料的实现' }, { mutation: 'keepVisible', note: '料不够也开门的实现' }, { mutation: 'repeatCost', note: '每次开门都重复扣料的实现' }],
  },
  {
    id: 'r04-chop-tree-drop-wood', index: 4, scenario: 'choppable',
    said: '让我能砍树，砍完掉木材', shape: '交互 + 掉落',
    acceptance: '攻击命中后目标消失、背包 +N',
    assertions: [
      A('r04.no-errors', 'noErrors', '砍树过程不能把模块搞崩', '实现让模块抛错'),
      A('r04.drops-on-hit', 'step', '砍中的那一步必须发出加木材的命令', '实现只在文字里说「掉了木材」', { label: 'hit-1', commands: { type: 'inventory.add', min: 1 } }),
      A('r04.tree-disappears', 'objectField', '砍完之后树从世界里消失', '实现只加木材不处理树', { object: 'tree-1', field: 'visible', value: false }),
      A('r04.drops-exactly-once', 'inventoryDelta', '第一次砍掉落 3 块木材', '实现掉落数量不对', { item: 'wood', delta: 3, step: 'hit-1' }),
      A('r04.no-second-drop', 'inventoryDelta', '对同一棵倒下的树再砍一次不能凭空再掉木材', '实现每次攻击都掉木材', { item: 'wood', delta: 0, step: 'hit-2' }),
      A('r04.wood-in-backpack', 'inventory', '背包里最终确实有木材', '实现把木材加到了别处', { item: 'wood', min: 1, max: 9 }),
    ],
    reds: [{ mutation: 'noop', note: '砍了不掉的实现' }, { mutation: 'repeatCost', note: '每次砍都重复掉落的实现' }],
  },
  {
    id: 'r05-craft-door-from-three-wood', index: 5, scenario: 'craft',
    said: '用三块木头做一扇门', shape: '制作 + 防重复',
    acceptance: '不足不生成；实扣 3 块；重复不重扣；重启后一致',
    assertions: [
      A('r05.no-errors', 'noErrors', '材料不够时也要正常返回，不能报错', '实现用抛异常处理材料不足'),
      A('r05.costs-three', 'inventoryDelta', '制作一次正好扣 3 块木头', '实现不扣料或扣错数量', { item: 'wood', delta: -3, step: 'craft-1' }),
      A('r05.door-appears', 'objectField', '第一扇门在制作完成后出现', '实现扣了料却没生成门', { object: 'door-3', field: 'visible', value: true, step: 'craft-1' }),
      A('r05.no-double-charge', 'inventoryDelta', '材料已经用完后再按一次不能再扣', '实现对空背包也重复扣料', { item: 'wood', delta: 0, step: 'craft-2' }),
      A('r05.insufficient-rejected', 'objectField', '材料不足时第二扇门不能凭空出现', '实现忽略材料直接生成', { object: 'door-4', field: 'visible', value: false, step: 'craft-3' }),
      A('r05.persists-after-reload', 'objectField', '重新载入存档后做好的门还在', '实现把结果只放在内存里，重载就丢', { object: 'door-3', field: 'visible', value: true }),
      A('r05.wood-empty', 'inventory', '最后木头正好用完', '实现扣料数量算错', { item: 'wood', exact: 0 }),
    ],
    reds: [{ mutation: 'freeInventory', note: '制作不扣料的实现' }, { mutation: 'keepVisible', note: '材料不足也生成的实现' }, { mutation: 'repeatCost', note: '重复扣料的实现' }],
  },
  {
    id: 'r06-revive-monsters', index: 6, scenario: 'zombies',
    said: '怪物被杀了，按 G 复活到出生点', shape: '按键 + 复活',
    acceptance: '按 G 后所有目标血量满、位置回到出生点',
    assertions: [
      A('r06.no-errors', 'noErrors', '复活过程不能把模块搞崩', '实现让模块抛错'),
      A('r06.revives-every-target', 'step', '按一次 G 要让所有死掉的怪物都复活', '实现只复活第一只', { label: 'revive', commands: { type: 'target.revive', min: 2 } }),
      A('r06.health-restored', 'objectHealth', '第一只怪物的血量恢复到大于 0', '实现只发命令不改血量', { object: 'zombie-1', min: 1 }),
      A('r06.second-health-restored', 'objectHealth', '第二只怪物的血量也恢复了', '实现只复活第一只', { object: 'zombie-2', min: 1 }),
      A('r06.mesh-restored', 'objectField', '怪物模型真的重建了，而不是只有一个看不见的血条', '实现用 object.patch 的 visible:true 假装复活', { object: 'zombie-1', field: 'mesh', value: true, step: 'revive' }),
      A('r06.back-to-spawn', 'objectField', '怪物回到出生点而不是死在原地', '实现只在原地复活', { object: 'zombie-1', field: 'position', value: { x: 2, y: 6, z: 8 }, step: 'revive' }),
    ],
    reds: [{ mutation: 'noop', note: '命令发出去了但世界没变的实现（就是刷新怪物那次的老 bug）' }, { mutation: 'reviveNoMesh', note: '只恢复血量不重建模型的实现' }],
  },
  {
    id: 'r07-stamina-bar', index: 7, scenario: 'stamina',
    said: '加个体力条，跑动消耗、站着恢复', shape: '通用资源',
    acceptance: '资源值随行为增减，夹在 0..max',
    assertions: [
      A('r07.no-errors', 'noErrors', '体力逻辑不能把模块搞崩', '实现让模块抛错'),
      A('r07.running-costs', 'resourceDelta', '跑动那一步体力要下降', '实现只显示体力条但不消耗', { resourceId: 'system-stamina', max: -0.5, step: 'run-1' }),
      A('r07.resting-recovers', 'resourceDelta', '站着不动那一步体力要回升', '实现只消耗不恢复', { resourceId: 'system-stamina', min: 0.5, step: 'rest-1' }),
      A('r07.clamped', 'resource', '体力始终夹在 0 到上限之间', '实现让体力变成负数或超过上限', { resourceId: 'system-stamina', min: 0, max: 100 }),
    ],
    reds: [{ mutation: 'freeResource', note: '体力永远不变的实现' }],
  },
  {
    id: 'r08-monster-ai', index: 8, scenario: 'hunters',
    said: '怪物追我并攻击，远程的保持距离射击', shape: '多模块 AI',
    acceptance: '近战怪靠近、远程怪停在射程外；接触扣血',
    assertions: [
      A('r08.no-errors', 'noErrors', '两只怪的行为代码都不能崩', '实现让模块抛错'),
      A('r08.melee-closes-in', 'objectDistance', '近战怪确实在靠近玩家', '实现只是站着不动', { object: 'melee-1', step: 'tick-4', max: 4 }),
      A('r08.ranged-keeps-distance', 'objectDistance', '远程怪保持距离，没有贴到脸上', '实现让远程怪也一路冲过来', { object: 'ranged-1', step: 'tick-4', min: 8 }),
      A('r08.player-hurt', 'playerHealth', '怪物的攻击真的扣了玩家的血', '实现只做动画不结算伤害', { max: 99 }),
    ],
    reds: [{ mutation: 'noop', note: '怪物不动也不攻击的实现' }, { mutation: 'closeIn', note: '远程怪一路贴到玩家脸上的实现' }],
  },
  {
    id: 'r09-hit-feedback', index: 9, scenario: 'dummy',
    said: '命中时闪红、击退，死亡倒地', shape: '反馈 + 平滑移动',
    acceptance: '命中瞬间颜色变化；位移用 duration 而非瞬移；血量归零后模型消失',
    assertions: [
      A('r09.no-errors', 'noErrors', '命中反馈不能把模块搞崩', '实现让模块抛错'),
      A('r09.flash-and-knockback', 'step', '命中那一步颜色和位置都要变', '实现只播了音效没有视觉变化', { label: 'hit-1', change: { fields: ['object:zombie-1.color', 'object:zombie-1.position'] } }),
      A('r09.smooth-move', 'stepCommandField', '击退要平滑移动，而不是瞬间闪现', '实现直接改位置、不带 duration', { label: 'hit-1', type: 'object.patch', field: 'duration', min: 0.05 }),
      A('r09.dies-hidden', 'objectField', '打够次数之后目标从世界里消失', '实现打死之后还立在那里', { object: 'zombie-1', field: 'visible', value: false }),
      A('r09.dies-no-mesh', 'objectField', '消失的目标不能再有模型', '实现只是隐藏了模型还在', { object: 'zombie-1', field: 'mesh', value: false }),
    ],
    reds: [{ mutation: 'noop', note: '打了没反应的实现' }, { mutation: 'teleport', note: '瞬移而不是平滑移动的实现' }, { mutation: 'keepVisible', note: '打不死目标的实现' }],
  },
  {
    id: 'r10-shop-panel', index: 10, scenario: 'shop',
    said: '做个商店，用木头换血瓶', shape: '面板 + 交易',
    acceptance: '木头不足时拒绝；成功时扣木头加血瓶；面板显示当前数量',
    assertions: [
      A('r10.no-errors', 'noErrors', '买卖过程不能把模块搞崩', '实现让模块抛错'),
      A('r10.shop-panel', 'panel', '商店面板要真的出现在屏幕上', '实现只在聊天里回复，没有面板', { key: 'shop', exists: true }),
      A('r10.costs-wood', 'inventoryDelta', '买一次正好扣 2 块木头', '实现不扣木头或扣错数量', { item: 'wood', delta: -2, step: 'buy-1' }),
      A('r10.gives-potion', 'inventoryDelta', '买一次正好得到 1 个血瓶', '实现扣了木头不给东西', { item: 'potion', delta: 1, step: 'buy-1' }),
      A('r10.rejects-when-broke', 'inventoryDelta', '木头不够时不能再扣', '实现对失败的购买也扣木头', { item: 'wood', delta: 0, step: 'buy-3' }),
      A('r10.no-potion-when-broke', 'inventoryDelta', '木头不够时不能凭空给血瓶', '实现忽略库存直接给东西', { item: 'potion', delta: 0, step: 'buy-3' }),
      A('r10.panel-shows-item', 'panelContains', '面板要写清楚卖的是什么', '实现面板是空的', { key: 'shop', text: '血瓶' }),
    ],
    reds: [{ mutation: 'dropPanel', note: '没有面板的实现' }, { mutation: 'freeInventory', note: '不扣木头的实现' }, { mutation: 'repeatCost', note: '买不起也扣钱的实现' }],
  },
]);

export function requirementsHash(list = REQUIREMENTS) {
  return createHash('sha256').update(canonicalJSON(list)).digest('hex');
}

export function freezeRequirements(list = REQUIREMENTS) {
  return { format: REQUIREMENTS_FORMAT, version: REQUIREMENTS_VERSION, hash: requirementsHash(list), count: list.length, requirements: list };
}

export function requirementById(id, list = REQUIREMENTS) {
  const found = list.find(requirement => requirement.id === id);
  if (!found) throw Error(`没有这条需求：${id}`);
  return found;
}

// 冻结文件本身也要被哈希：这里必须是**写死的常量**，否则改了需求集哈希会自动跟着变，等于没冻结。
export const FROZEN_REQUIREMENTS_HASH = '9df3f1d4ce9ae648ae13ef63472c62cb2176f55679d677640e1dce32361bc76c';

export function assertFrozenIntegrity(hash = FROZEN_REQUIREMENTS_HASH) {
  const actual = requirementsHash(REQUIREMENTS);
  if (actual !== hash) throw Error(`冻结需求集被改动过：期望 ${hash}，实际 ${actual}。只有人能更新这个常量。`);
  return actual;
}
