import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs', import.meta.url));
const { importRequestFor } = await import('../../vendor/pi-desktop/apps/desktop/src/components/craftmine/assets/asset-library-model.ts');
const source = { origin: 'player-import', author: '', license: '', licenseStatus: 'unknown' };
const item = { path: 'pixel.png', version: 1, mediaType: 'image/png' };
const request = extra => importRequestFor(item, { assetId: 'pixel', kind: 'object', mediaKind: 'image', displayName: 'Pixel', sourceRoot: 'D:/owned', source, ...extra });
test('blank UI provenance becomes explicit unknown without granting a licence', () => {
  assert.deepEqual(request().source, { origin: 'player-import', author: 'unknown', license: 'unknown', licenseStatus: 'unknown' });
});
test('whitespace and a stale verified selection cannot verify an absent licence', () => {
  assert.deepEqual(request({ source: { origin: ' ', author: '\t', license: '  ', licenseStatus: 'verified' } }).source,
    { origin: 'unknown', author: 'unknown', license: 'unknown', licenseStatus: 'unknown' });
});
test('provided attribution and licence status remain their actual submitted values', () => {
  const actual = { origin: 'artist-provided', author: 'Example Author', license: 'Example permission', licenseStatus: 'unverified' };
  assert.deepEqual(request({ source: actual }).source, actual);
  assert.equal(request({ source: { ...actual, author: '' } }).source.licenseStatus, 'unverified');
});
test('actual packaged Core accepts normalized unknown metadata and retains exact bytes after restart', { skip: !process.env.ASSET_PROVENANCE_CORE }, async () => {
  const binary = process.env.ASSET_PROVENANCE_CORE;
  const root = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
  const out = fs.mkdtempSync(path.join(root, 'test-results/asset-import-provenance-'));
  const input = path.join(out, 'input'); fs.mkdirSync(input);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(input, 'pixel.png'), bytes);
  const sha = b => createHash('sha256').update(b).digest('hex');
  const report = { format: 'craftmine.asset-import-provenance-core/1', passed: false, binary, binarySha256: sha(fs.readFileSync(binary)), out, limit: 'Actual Core import/read/restart only; not the packaged UI or PNG decoder.' };
  const { CoreClient } = createRequire(import.meta.url)('../../plugins/craftmine-world/core-client.cjs');
  let client;
  try {
    client = new CoreClient(binary, path.join(out, 'data')); await client.start();
    const normalized = request({ sourceRoot: input });
    await assert.rejects(client.call('asset.import', { ...normalized, source }), /INVALID_TEXT/);
    report.receipt = await client.call('asset.import', normalized);
    const before = await client.call('asset.read', { assetId: 'pixel', version: 1 });
    assert.deepEqual(before.version_.source, normalized.source);
    assert.equal(before.version_.files[0].sha256, sha(bytes));
    await client.stop(); client = new CoreClient(binary, path.join(out, 'data')); await client.start();
    report.restored = await client.call('asset.read', { assetId: 'pixel', version: 1 });
    assert.deepEqual(report.restored, before); report.passed = true;
  } catch (error) { report.error = String(error); throw error; }
  finally { await client?.stop(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, passed: report.passed })); }
});
