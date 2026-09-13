import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startPromoGodotCheckService} from '../scripts/lib/promo-godot-check-service.mjs';

test('private real Electron checker rejects invalid descriptors and closes without a fabricated capture', async () => {
  const root = path.resolve('test-results/codex-promo/check-service-tests');
  await fs.mkdir(root, {recursive: true});
  const service = await startPromoGodotCheckService({directory: root});
  try {
    await assert.rejects(service.verifier.godotCheck({jobId: '../../outside-profile'}), /INVALID_CHECK_JOB/);
    await assert.rejects(service.verifier.godotCheck({jobId: 'gjob-' + 'a'.repeat(64)}));
    assert.equal(service.capture('gjob-' + 'a'.repeat(64)), null);
    assert.deepEqual(await service.cancel(), {cancelling: true});
  } finally { await service.close(); }
  await assert.rejects(service.verifier.godotCheck({}), /CHECK_HOST_EXITED/);
});
