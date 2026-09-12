import test from 'node:test';
import assert from 'node:assert/strict';
import {creationAllowsFullAuto} from '../electron/main/creation-permission-mode.ts';

test('explicit session permission overrides every global default', () => {
  for (const global of ['auto', 'ask', 'accept-edits', undefined]) {
    for (const mode of ['ask', 'accept-edits', 'auto']) {
      assert.equal(creationAllowsFullAuto({permissionMode: mode}, global), mode === 'auto');
    }
  }
});
test('inherit uses the global mode and absent configuration stays Ask', () => {
  assert.equal(creationAllowsFullAuto({permissionMode: 'inherit'}, 'auto'), true);
  assert.equal(creationAllowsFullAuto({permissionMode: 'inherit'}, undefined), false);
  assert.equal(creationAllowsFullAuto({}, undefined), false);
  assert.equal(creationAllowsFullAuto(undefined, 'auto'), false);
  assert.equal(creationAllowsFullAuto({permissionMode: 'invalid'}, 'auto'), false);
});
