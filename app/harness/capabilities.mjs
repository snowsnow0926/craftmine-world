import { AUDIO_SOUNDS, BEHAVIOR_CAPABILITIES, BEHAVIOR_KEYS, BEHAVIOR_LIMITS, BEHAVIOR_PERMISSIONS, BEHAVIOR_REQUIREMENTS, MESSAGE_TONES } from '../behavior-contracts.mjs';
import { SYSTEMS } from '../gameplay.mjs';
import { MATERIALS, OBJECT_ID_PATTERN } from '../scene.mjs';

// 能力目录是宿主事实的唯一来源：模型可以查询它，但不能改写它。
// 每一行都必须从运行契约派生，不能在这里手写与实现不一致的描述。
export const RUNTIME_VERSION = 'craftmine-web/5';

export const SCENE_LIMITS = Object.freeze({
  objects: 128,
  legacyObjects: 64,
  partsPerObject: 128,
  faces: 100000,
  fieldArea: 92,
  groundY: 6,
  topY: 38,
  playerFieldArea: 47.4,
});

export const EVENT_TYPES = Object.freeze([
  { type: 'start', payload: {}, note: '模块装载时一次，用来注册物品和面板' },
  { type: 'tick', payload: { dt: '秒' }, note: '每帧一次，返回的 commands 最多 32 条' },
  { type: 'interact', payload: { targetId: '对象 ID' }, note: '玩家按 E 指向声明过的目标' },
  { type: 'contact', payload: { targetId: '对象 ID' }, note: '玩家接触声明过的目标' },
  { type: 'attack', payload: { targetId: '对象 ID' }, note: '玩家攻击命中声明过的目标' },
  { type: 'land', payload: { targetId: '对象 ID' }, note: '玩家落在声明过的目标上' },
  { type: 'key', payload: { code: 'keys 中声明过的按键代码' }, note: '只有模块在 keys 里声明过的按键才会触发；不要读 frame.keys' },
]);

export const COMMANDS = Object.freeze([
  {
    type: 'object.patch', permission: 'objects.write', scope: '声明过的 targets 里的对象',
    fields: { id: '对象 ID', position: '{x,y,z} 或 null；整项省略等同 null（保留原值）', visible: 'boolean 或 null', solid: 'boolean 或 null', color: "'#RRGGBB' 或 null", yaw: 'null 或 0/90/180/270', duration: '可选 0..5 秒，平滑移动' },
    quota: `每步最多 ${BEHAVIOR_LIMITS.commands} 条命令`, example: "{type:'object.patch',id:'door-1',visible:false}",
    note: 'visible:true 不会让已死亡的目标重新生效，复活必须用 target.revive',
  },
  {
    type: 'player.impulse', permission: 'player.motion', scope: '当前玩家',
    fields: { velocity: '{x,y,z}，每轴 -18..18' }, quota: '每步最多 1 条', example: "{type:'player.impulse',velocity:{x:0,y:8,z:0}}",
  },
  {
    type: 'hud.message', permission: 'hud.message', scope: '当前玩家',
    fields: { text: '最多 160 字纯文本', tone: '可选 ' + MESSAGE_TONES.map(tone => `'${tone}'`).join(' | '), duration: '可选 1000..10000 毫秒' }, quota: '每步最多 1 条', example: "{type:'hud.message',text:'门开了',tone:'success'}",
  },
  {
    type: 'audio.play', permission: 'audio.play', scope: '当前玩家',
    fields: { sound: AUDIO_SOUNDS.map(sound => `'${sound}'`).join(' | '), volume: '可选 0..1' }, quota: '每步最多 1 条', example: "{type:'audio.play',sound:'explode',volume:0.8}",
    note: '使用宿主内置音效，不需要素材',
  },
  {
    type: 'target.revive', permission: 'targets.write', scope: '声明过的 targets 里的目标',
    fields: { id: '目标 ID' }, quota: '每步最多 16 个目标', example: "{type:'target.revive',id:'zombie-1'}",
    note: '把血量恢复到上限并重建模型；这是唯一能让已死亡目标复活的方式',
  },
  {
    type: 'resource.add', permission: 'resources.write', scope: '场景里 type 为 resource 的玩家资源',
    fields: { id: '资源系统 ID', amount: '整数 -10000..10000' }, quota: '每步最多 1 条', example: "{type:'resource.add',id:'system-stamina',amount:-15}",
    note: '结果自动夹在 0 到该系统 max 之间；体力、魔法、饥饿、护甲都用它',
  },
  {
    type: 'resource.set', permission: 'resources.write', scope: '场景里 type 为 resource 的玩家资源',
    fields: { id: '资源系统 ID', value: '0..10000' }, quota: '每步最多 1 条', example: "{type:'resource.set',id:'system-mana',value:0}",
  },
  {
    type: 'inventory.add', permission: 'inventory.write', scope: '当前玩家背包',
    fields: { item: '稳定英文 ID（小写字母开头）', count: '整数 -100..100' }, quota: '每步最多 1 条', example: "{type:'inventory.add',item:'wood',count:3}",
  },
  {
    type: 'inventory.define', permission: 'inventory.write', capability: 'inventory.items@1', scope: '当前玩家背包',
    fields: { item: '稳定英文 ID', name: '最多 40 字', description: '最多 200 字' }, quota: '每步最多 1 条', example: "{type:'inventory.define',item:'wood',name:'木材',description:'用于制作'}",
    note: '按稳定 ID 注册显示名称；第一次已提交的定义保留，后续同 ID 定义不覆盖；不能在 start 重复发放物品',
  },
  {
    type: 'hud.panel', permission: 'hud.message', capability: 'hud.panel@1', scope: '当前模块自己的面板',
    fields: { key: '面板 ID', panel: "{title:'最多 48 字',lines:['最多 6 行，每行 120 字']} 或 null（删除）" }, quota: '每个模块最多 3 个面板', example: "{type:'hud.panel',key:'quest',panel:{title:'任务',lines:['采集木材 1 / 3']}}",
    note: '纯文本，按 key 替换本模块面板，不能操作别的模块面板；只在状态改变时更新',
  },
]);

export const STORAGE_LIMITS = Object.freeze({
  codeChars: BEHAVIOR_LIMITS.code,
  stateChars: BEHAVIOR_LIMITS.state,
  paramsChars: BEHAVIOR_LIMITS.params,
  targets: BEHAVIOR_LIMITS.targets,
  keysPerModule: 4,
  inventorySlots: 128,
});

const fieldList = fields => Object.entries(fields).map(([name, description]) => ({ name, description }));
const systemList = () => Object.entries(SYSTEMS).map(([type, definition]) => ({
  type, name: definition.name, dependencies: [...definition.dependencies],
  fields: Object.entries(definition.fields).map(([name, [min, max]]) => ({ name, min, max })),
}));

export function capabilitiesCatalog() {
  return {
    format: 'craftmine.capabilities/1',
    runtime: RUNTIME_VERSION,
    entry: { export: 'step', signature: 'async step({frame, params, state}) => {state, commands}', module: 'ES 模块，必须导出 step' },
    events: EVENT_TYPES.map(event => ({ ...event })),
    keys: [...BEHAVIOR_KEYS],
    permissions: [...BEHAVIOR_PERMISSIONS],
    capabilities: [...BEHAVIOR_CAPABILITIES],
    requires: [...BEHAVIOR_REQUIREMENTS],
    commands: COMMANDS.map(command => ({ ...command, fields: fieldList(command.fields) })),
    systems: systemList(),
    materials: [...Object.keys(MATERIALS), 'solid'],
    shapes: ['box', 'blade'],
    objectIdPattern: OBJECT_ID_PATTERN.source,
    sceneLimits: { ...SCENE_LIMITS },
    storageLimits: { ...STORAGE_LIMITS },
  };
}

// 给模型看的紧凑文本：只列事实，不解释立场。
export function capabilitiesText() {
  const catalog = capabilitiesCatalog();
  const lines = [
    `运行版本 ${catalog.runtime}；入口必须导出 ${catalog.entry.signature}。`,
    `对象 ID 规则：${catalog.objectIdPattern}。`,
    `事件：${catalog.events.map(event => `${event.type}(${Object.keys(event.payload).join(',') || '无载荷'})`).join('、')}。`,
    `按键事件只对 keys 里声明过的代码触发，可用：${catalog.keys.join('、')}；不要读 frame.keys。`,
    `权限：${catalog.permissions.join('、')}；能力：${catalog.capabilities.join('、')}；依赖：${catalog.requires.join('、')}。`,
    `玩法系统：${catalog.systems.map(system => `${system.type}(${system.fields.map(field => `${field.name} ${field.min}..${field.max}`).join(', ')})`).join('、')}。`,
    `命令（每步最多 ${BEHAVIOR_LIMITS.commands} 条）：`,
    ...catalog.commands.map(command => `- ${command.type}｜权限 ${command.permission}${command.capability ? `｜能力 ${command.capability}` : ''}｜${command.fields.map(field => `${field.name}: ${field.description}`).join('；')}｜${command.example}${command.note ? '｜' + command.note : ''}`),
    `配额：代码 ${STORAGE_LIMITS.codeChars} 字符、状态 ${STORAGE_LIMITS.stateChars} 字符、参数 ${STORAGE_LIMITS.paramsChars} 字符、目标 ${STORAGE_LIMITS.targets} 个、每模块按键 ${STORAGE_LIMITS.keysPerModule} 个。`,
    `场景上限：对象 ${SCENE_LIMITS.objects} 个、每对象部件 ${SCENE_LIMITS.partsPerObject} 个、总面数 ${SCENE_LIMITS.faces}、场地 ${SCENE_LIMITS.fieldArea}×${SCENE_LIMITS.fieldArea}、高度 ${SCENE_LIMITS.groundY}..${SCENE_LIMITS.topY}。`,
  ];
  return lines.join('\n');
}
