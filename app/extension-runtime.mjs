import { ExtensionRunner } from './extension-runner.mjs';

// The game and its verifier must execute the same installed extension code.
export async function createExtensionTable(list = [], { runnerFactory = extension => new ExtensionRunner(extension) } = {}) {
  if (!Array.isArray(list)) throw Error('扩展装载表必须为数组');
  if (!list.length) return null;
  const table = new Map(), runners = new Set();
  try {
    for (const extension of list) {
      const runner = runnerFactory(extension);
      runners.add(runner);
      await runner.ready;
      for (const command of extension.provides.commands) {
        if (table.has(command.type)) throw Error('扩展命令重复：' + command.type);
        table.set(command.type, {
          extensionId: extension.id, version: extension.version,
          permission: command.permission, permissions: extension.permissions,
          targets: extension.targets || [], capabilities: extension.capabilities || [], runner,
        });
      }
    }
    return table;
  } catch (error) {
    for (const runner of runners) runner.dispose();
    throw error;
  }
}

export function disposeExtensionTable(table) {
  for (const runner of new Set([...(table?.values() || [])].map(entry => entry.runner))) runner.dispose();
}
