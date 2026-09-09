// Offline tests for the R8 product adapter's availability gate.
// A missing dependency must report blocked, never "available" or a pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {probePiPlugin, piPluginConfig, PiPluginUnavailable, createPiPluginSession} from '../../godot-remaining/I/lib/transport/pi-plugin.mjs';

const root = path.resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

test('without an authorized config the adapter reports blocked, not available', async () => {
  const probe = await probePiPlugin({env: {}, root});
  assert.equal(probe.available, false);
  assert.equal(probe.reason, 'pi-plugin-prerequisites-missing');
  assert.match(probe.detail, /CRAFTMINE_I_LIVE_CONFIG/);
});

test('a missing core binary or plugin build is reported precisely', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'r8-probe-'));
  const secrets = path.join(scratch, 'secrets.json');
  fs.writeFileSync(secrets, JSON.stringify({CRAFTMINE_DEEPSEEK_API_KEY: 'placeholder-not-used', CRAFTMINE_MODEL_PROVIDER: 'deepseek'}));
  const probe = await probePiPlugin({env: {CRAFTMINE_I_LIVE_CONFIG: secrets, CRAFTMINE_CORE_BIN: path.join(scratch, 'nope.exe')}, root});
  assert.equal(probe.available, false);
  assert.match(probe.detail, /craftmine-core binary not found/);
  fs.rmSync(scratch, {recursive: true, force: true});
});

test('opening a session without the authorized file throws the blocked error', async () => {
  const config = piPluginConfig({}, root);
  await assert.rejects(() => createPiPluginSession({config: {...config, secretsFile: null}}), PiPluginUnavailable);
});

test('the adapter never contains an input or browser path', () => {
  const source = fs.readFileSync(new URL('../../godot-remaining/I/lib/transport/pi-plugin.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['playwright', 'puppeteer', 'requestPointerLock', 'sendInputEvent', 'page.mouse', 'page.keyboard']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not appear in the adapter`);
  }
});
