import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
const deps = createRequire(path.join(process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT, 'vendor/pi-desktop/apps/desktop/package.json'));
const { transformSync } = deps('esbuild');
const source = readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-assets-acceptance.ts', import.meta.url), 'utf8');
const module = { exports: {} };
new Function('module', 'exports', transformSync(source, { loader: 'ts', format: 'cjs' }).code)(module, module.exports);
const { assetsProbeScript, unwrapAssetsProbeResult } = module.exports;
const run = (action, document, extra = {}) => vm.runInNewContext(assetsProbeScript({ action, ownerWorldId: 'world-a', ...extra }), { __craftmineHeadless: { safe: true }, document });
const active = { dataset: { worldId: 'world-a' } };
const emptyDocument = { querySelector: selector => selector.includes('data-world-active') ? active : null };

test('unready open returns explicit false without a page exception', () => {
  const value = unwrapAssetsProbeResult(run('open', emptyDocument));
  assert.equal(value.ready, false); assert.equal(value.open, false);
});
test('old owner rejection crosses the page boundary as finite data then throws at caller', () => {
  const result = run('read', emptyDocument, { ownerWorldId: 'world-old' });
  assert.equal(result.ok, false); assert.equal(result.code, 'ASSET_PANEL_OWNER_CHANGED');
  assert.throws(() => unwrapAssetsProbeResult(result), /ASSET_PANEL_OWNER_CHANGED/);
});
test('unobserved controls remain rejected rather than becoming successful observations', () => {
  const result = run('select', emptyDocument, { assetId: 'asset-a', version: 1 });
  assert.equal(result.ok, false);
  assert.throws(() => unwrapAssetsProbeResult(result), /ASSET_PROBE_UNOBSERVED_ASSET/);
  assert.throws(() => unwrapAssetsProbeResult(run('close', emptyDocument)), /ASSET_PROBE_CONTROL_UNAVAILABLE/);
});
test('read keeps the real observation and guard without pretending the sheet is open', () => {
  const result = unwrapAssetsProbeResult(run('read', emptyDocument));
  assert.equal(result.ownerWorldId, 'world-a'); assert.equal(result.open, false);
  assert.equal(result.cards.length, 0); assert.equal(result.guard.safe, true);
});
test('unexpected renderer failures are not translated or hidden', () => {
  const broken = { querySelector() { throw new Error('UNEXPECTED_RENDERER_FAILURE'); } };
  assert.throws(() => run('open', broken), /UNEXPECTED_RENDERER_FAILURE/);
});
test('forged, unknown and malformed structured results are rejected', () => {
  for (const value of [null, {}, { format: 'craftmine.asset-probe-result/1', ok: 'true', value: {} },
    { format: 'craftmine.asset-probe-result/1', ok: false, code: 'UNKNOWN' },
    { format: 'craftmine.asset-probe-result/1', ok: false, code: ['ASSET_PANEL_OWNER_CHANGED'] },
    { format: 'craftmine.asset-probe-result/1', ok: true, value: [], extra: 'x' }]) {
    assert.throws(() => unwrapAssetsProbeResult(value), /INVALID_ASSET_PROBE_RESULT/);
  }
});
