import { COMMANDS } from './capabilities.mjs';
import { BEHAVIOR_PERMISSIONS } from '../behavior-contracts.mjs';
import { validateAssertion } from './assertions.mjs';
import { contentHash } from './contracts.mjs';
import { EXTENSION_CAPABILITIES, EXTENSION_EFFECT_LIMIT, extensionDefinition, validateExtensionResult } from './extension-effects.mjs';

export { EXTENSION_CAPABILITIES, EXTENSION_EFFECT_LIMIT, extensionDefinition, validateExtensionResult };

// L2 扩展 ABI：模型可以自己造「新命令」，但不能造「新权力」。
// 扩展的 apply 只能返回内核已有的原子效果（HOST_EFFECTS），因此扩展永远越不过内核的红线。
export const EXTENSION_FORMAT = 'craftmine.extension/1';
export const EXTENSION_LIMITS = Object.freeze({ code: 12000, commands: 4, fields: 8, selfTests: 8, requires: 4, name: 60, description: 1000, effects: 32 });
export const EXTENSION_LIFECYCLE = Object.freeze({ register: 'onLoad', unload: 'rejectModules' });

// 宿主原子效果：扩展和玩法模块用的是同一套，没有第二种权限模型。
export const HOST_EFFECTS = Object.freeze(Object.fromEntries(COMMANDS.map(command => [command.type, command.permission])));
export const HOST_EFFECT_TYPES = Object.freeze(Object.keys(HOST_EFFECTS));

const COMMAND_TYPE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9.]*$/;
const EXTENSION_ID = /^[a-z][a-z0-9-]{0,47}$/;
const REQUIREMENT = /^ext:[a-z][a-z0-9-]{0,47}@\d{1,4}$/;
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,23}$/;

const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function need(condition, message) { if (!condition) throw Error(message); }

export function extensionRequirement(id, version) {
  return `ext:${id}@${version}`;
}

export function isExtensionRequirement(value) {
  return typeof value === 'string' && REQUIREMENT.test(value);
}

export function validateExtension(input) {
  need(isPlain(input), '扩展必须是对象');
  need(input.format === EXTENSION_FORMAT, `扩展格式不兼容：需要 ${EXTENSION_FORMAT}`);
  need(EXTENSION_ID.test(input.id || ''), '扩展 ID 无效（小写字母开头，可含数字和连字符）');
  need(text(input.name, EXTENSION_LIMITS.name), '扩展名称无效');
  need(Number.isInteger(input.version) && input.version >= 1 && input.version <= 10000, '扩展版本号无效');
  need(typeof input.description === 'string' && input.description.length <= EXTENSION_LIMITS.description, '扩展说明无效');
  need(text(input.code, EXTENSION_LIMITS.code), '扩展实现代码无效或过长');
  need(/export\s+(async\s+)?(function\s+apply|const\s+apply|let\s+apply|var\s+apply)\b/.test(input.code), '扩展实现必须导出 apply({command, world, state})');

  const extra = Object.keys(input).filter(key => !['format', 'id', 'name', 'version', 'description', 'requires', 'permissions', 'targets', 'capabilities', 'provides', 'lifecycle', 'code', 'selfTests', 'author', 'inputTokens', 'outputTokens', 'reviewFindings'].includes(key));
  need(!extra.length, `扩展包含不支持的字段：${extra.join('、')}`);

  need(input.targets === undefined || (Array.isArray(input.targets) && input.targets.length <= 16 && new Set(input.targets).size === input.targets.length && input.targets.every(id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id))), '扩展目标对象声明无效');
  need(input.capabilities === undefined || (Array.isArray(input.capabilities) && input.capabilities.length <= EXTENSION_CAPABILITIES.length && new Set(input.capabilities).size === input.capabilities.length && input.capabilities.every(name => EXTENSION_CAPABILITIES.includes(name))), '扩展能力声明无效');
  const capabilities = input.capabilities || [];
  if (capabilities.includes('inventory.items@1')) need(input.permissions.includes('inventory.write'), '扩展能力 inventory.items@1 需要 inventory.write 权限');
  if (capabilities.includes('hud.panel@1')) need(input.permissions.includes('hud.message'), '扩展能力 hud.panel@1 需要 hud.message 权限');

  need(Array.isArray(input.requires) && input.requires.length <= EXTENSION_LIMITS.requires && new Set(input.requires).size === input.requires.length, '扩展依赖声明无效');
  for (const requirement of input.requires) {
    need(isExtensionRequirement(requirement), `扩展依赖格式无效：${requirement}`);
    need(!requirement.startsWith(`ext:${input.id}@`), '扩展不能依赖自己');
  }

  need(Array.isArray(input.permissions) && input.permissions.length <= BEHAVIOR_PERMISSIONS.length && new Set(input.permissions).size === input.permissions.length, '扩展权限声明无效');
  for (const permission of input.permissions) need(BEHAVIOR_PERMISSIONS.includes(permission), `扩展声明了不存在的权限：${permission}`);

  need(isPlain(input.provides), '扩展必须声明 provides');
  const providedKeys = Object.keys(input.provides).filter(key => !['commands', 'events'].includes(key));
  need(!providedKeys.length, `扩展只能声明 commands 和 events，多出：${providedKeys.join('、')}`);
  const commands = input.provides.commands;
  need(Array.isArray(commands) && commands.length >= 1 && commands.length <= EXTENSION_LIMITS.commands, `扩展需要声明 1–${EXTENSION_LIMITS.commands} 个新命令`);
  const types = new Set();
  for (const command of commands) {
    need(isPlain(command), '扩展命令声明无效');
    need(COMMAND_TYPE.test(command.type || ''), `扩展命令名无效：${command.type}`);
    need(!Object.hasOwn(HOST_EFFECTS, command.type), `扩展不能覆盖宿主命令：${command.type}`);
    need(!types.has(command.type), `扩展命令名重复：${command.type}`);
    types.add(command.type);
    need(BEHAVIOR_PERMISSIONS.includes(command.permission), `扩展命令声明了不存在的权限：${command.permission}`);
    need(input.permissions.includes(command.permission), `扩展命令 ${command.type} 需要声明权限 ${command.permission}`);
    need(Array.isArray(command.fields) && command.fields.length >= 1 && command.fields.length <= EXTENSION_LIMITS.fields, `扩展命令 ${command.type} 的字段声明无效`);
    const names = new Set();
    for (const field of command.fields) {
      need(isPlain(field) && FIELD_NAME.test(field.name || '') && text(field.description, 200), `扩展命令 ${command.type} 的字段声明无效`);
      need(!names.has(field.name), `扩展命令 ${command.type} 字段重复：${field.name}`);
      names.add(field.name);
    }
    need(command.scope === undefined || text(command.scope, 200), `扩展命令 ${command.type} 的适用范围说明无效`);
    need(command.description === undefined || text(command.description, 400), `扩展命令 ${command.type} 的说明无效`);
  }
  const events = input.provides.events ?? [];
  need(Array.isArray(events) && events.length <= 2 && new Set(events).size === events.length, '扩展事件声明无效');
  for (const name of events) need(typeof name === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(name), `扩展事件名无效：${name}`);

  if (input.lifecycle !== undefined) {
    need(isPlain(input.lifecycle), '扩展生命周期声明无效');
    const keys = Object.keys(input.lifecycle);
    need(keys.every(key => key === 'register' || key === 'unload'), `扩展生命周期只支持 register/unload，多出：${keys.filter(key => !['register', 'unload'].includes(key)).join('、')}`);
    if (input.lifecycle.register !== undefined) need(input.lifecycle.register === EXTENSION_LIFECYCLE.register, `扩展生命周期 register 只能是 ${EXTENSION_LIFECYCLE.register}`);
    if (input.lifecycle.unload !== undefined) need(input.lifecycle.unload === EXTENSION_LIFECYCLE.unload, `扩展生命周期 unload 只能是 ${EXTENSION_LIFECYCLE.unload}`);
  }

  need(Array.isArray(input.selfTests) && input.selfTests.length >= 1 && input.selfTests.length <= EXTENSION_LIMITS.selfTests, `扩展需要 1–${EXTENSION_LIMITS.selfTests} 个自带测试`);
  for (const [index, test] of input.selfTests.entries()) {
    need(isPlain(test) && text(test.name, 80), `第 ${index + 1} 个自带测试缺少名称`);
    need(isPlain(test.world) && Array.isArray(test.world.objects), `自带测试「${test.name}」需要 world.objects`);
    need(test.state === undefined || isPlain(test.state), `自带测试「${test.name}」的 state 无效`);
    need(Array.isArray(test.commands) && test.commands.length >= 1, `自带测试「${test.name}」需要至少一条要执行的命令`);
    for (const command of test.commands) {
      need(isPlain(command) && types.has(command.type), `自带测试「${test.name}」里的命令必须来自本扩展：${command?.type}`);
    }
    need(Array.isArray(test.expect) && test.expect.length >= 1, `自带测试「${test.name}」需要 expect 断言`);
    for (const assertion of test.expect) validateAssertion(assertion);
  }
  return structuredClone(input);
}

export function extensionDigest(extension) {
  return contentHash(extension);
}

// 目录：把宿主能力和已装载扩展合成一份模型可读的事实。
export function extensionCatalog(extensions = []) {
  return extensions.map(extension => ({
    id: extension.id, name: extension.name, version: extension.version, hash: extensionDigest(extension),
    requires: extension.requires, permissions: extension.permissions,
    commands: extension.provides.commands.map(command => ({
      type: command.type, permission: command.permission, scope: command.scope || '',
      fields: command.fields.map(field => `${field.name}：${field.description}`),
    })),
    events: extension.provides.events || [],
  }));
}

export function extensionText(extensions = []) {
  if (!extensions.length) return '当前没有装载任何扩展。';
  return extensionCatalog(extensions).map(extension => [
    `扩展 ${extension.id}@${extension.version}「${extension.name}」`,
    ...extension.commands.map(command => `- ${command.type}｜权限 ${command.permission}｜${command.fields.join('；')}`),
  ].join('\n')).join('\n');
}
