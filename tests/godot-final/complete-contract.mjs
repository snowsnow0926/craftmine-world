import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export function createCompleteOutput(root, override) {
  const parent = override ?? path.join(root, 'test-results');
  if (!path.isAbsolute(parent)) throw Error('ABSOLUTE_TEST_OUTPUT_ROOT_REQUIRED');
  const absolute = path.resolve(parent);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('TEST_OUTPUT_LINK_OR_FILE_DENIED');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(cursor);
    }
  }
  return fs.mkdtempSync(path.join(absolute, 'desktop-native-complete-'));
}

export function completeEnvironment(inherited, {out, profile, token, core, host, bases}) {
  const env = {...inherited};
  for (const key of Object.keys(env)) if (/^(CRAFTMINE_|PI_DESKTOP_|ELECTRON_|NODE_OPTIONS$)/i.test(key)) delete env[key];
  return {...env, CRAFTMINE_HEADLESS_TEST: '1', CRAFTMINE_HEADLESS_ROOT: out,
    CRAFTMINE_DATA_DIR: profile, CRAFTMINE_HEADLESS_TOKEN: token,
    CRAFTMINE_CORE_BIN: core, PI_DESKTOP_HOST_BIN: host, CRAFTMINE_GODOT_BASES: bases};
}

export async function requireRestoreConflict({restore, inspect, readSelection, readProgress, expectedSelection, expectedProgress, compare, grant, operationId}) {
  assert.equal(grant.status, 'ready');
  assert.equal(grant.bodiesVerified, true);
  assert.match(grant.expectedCurrentHash, /^[a-f0-9]{64}$/);
  assert.equal(typeof grant.grantId, 'string');
  const wrongHash = (grant.expectedCurrentHash === '0'.repeat(64) ? '1' : '0').repeat(64);
  await assert.rejects(restore({operationId, grantId: grant.grantId, expectedCurrentHash: wrongHash}), error => {
    // The actual renderer-to-main IPC serializes this finite product error.
    // Accept only its observed wrapper, never a substring in another failure.
    let message = error?.message;
    if (typeof message !== 'string' || message.length > 256) return false;
    if (message.startsWith('Error: ')) message = message.slice(7);
    const prefix = "Error invoking remote method 'pi-plugin-panel-invoke': ";
    if (message.startsWith(prefix)) {
      message = message.slice(prefix.length);
      if (message.startsWith('Error: ')) message = message.slice(7);
    }
    return message === 'BACKUP_CURRENT_HASH_CONFLICT';
  });
  assert.equal(await readSelection(), expectedSelection);
  const comparison = compare(expectedProgress, await readProgress());
  assert.equal(comparison.equal, true, JSON.stringify(comparison.differences));
  // A failed attempt can checkpoint before the CAS check. Reinspect instead of
  // assuming its previous current hash is reusable or changing an operation's args.
  const refreshed = await inspect();
  assert.equal(refreshed.status, 'ready');
  assert.equal(refreshed.bodiesVerified, true);
  assert.equal(refreshed.archiveHash, grant.archiveHash);
  assert.match(refreshed.expectedCurrentHash, /^[a-f0-9]{64}$/);
  return {grant: refreshed, fault: {code: 'BACKUP_CURRENT_HASH_CONFLICT', operationId, wrongHash, comparison}};
}
