import { validateBehaviorResult, BEHAVIOR_CAPABILITIES } from '../behavior-contracts.mjs';

// 扩展效果校验：把扩展当成一个只有 targets 和 permissions 的玩法模块，
// 直接复用内核那套校验，因此扩展不可能绕过任何一条内核规则。
export const EXTENSION_EFFECT_LIMIT = 32;
export const EXTENSION_CAPABILITIES = BEHAVIOR_CAPABILITIES;

export function extensionDefinition(extension) {
  return {
    format: 'craftmine.behavior/1',
    id: extension.id,
    name: extension.name,
    description: extension.description || '扩展',
    code: 'export function step() { return { state: {}, commands: [] }; }',
    stateVersion: 1,
    initialState: {},
    params: {},
    targets: [...(extension.targets || [])],
    permissions: [...extension.permissions],
    capabilities: [...(extension.capabilities || [])],
    keys: [],
  };
}

// 返回 {state, commands}，其中 commands 就是扩展产出的宿主原子效果。
export function validateExtensionResult(value, extension, world) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('扩展必须返回 {effects, state}');
  const keys = Object.keys(value).filter(key => key !== 'effects' && key !== 'state');
  if (keys.length) throw Error(`扩展返回了不支持的字段：${keys.join('、')}`);
  const effects = value.effects ?? [];
  if (!Array.isArray(effects)) throw Error('扩展返回的 effects 必须是数组');
  if (effects.length > EXTENSION_EFFECT_LIMIT) throw Error(`扩展一步最多产出 ${EXTENSION_EFFECT_LIMIT} 条效果`);
  const frame = { objects: (world?.objects || []).map(object => ({ ...object })), player: { position: { x: 0, y: 6, z: 0 } } };
  const checked = validateBehaviorResult({ state: value.state ?? {}, commands: effects }, extensionDefinition(extension), frame);
  return { effects: checked.commands, state: checked.state };
}
