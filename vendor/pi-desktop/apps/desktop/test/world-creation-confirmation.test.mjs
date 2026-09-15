import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const {readWorldCreationConfirmation} = await import('../src/lib/world-creation-confirmation.ts');
const timeout = () => Error('Craftmine Rust request timed out');
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

test('a timed-out confirmation read returns the later ready receipt without changing identity', async () => {
  let reads = 0, pending = 0, waits = 0;
  const receipt = {activeWorldId: 'registered-world', worlds: [{id: 'registered-world', state: 'ready'}]};
  const result = await readWorldCreationConfirmation({read: async () => {if (++reads === 1) throw timeout(); return receipt;},
    current: () => true, pending: () => pending++, wait: async () => {waits++;}});
  assert.equal(result, receipt); assert.deepEqual({reads, pending, waits}, {reads: 2, pending: 1, waits: 1});
});

for (const stop of ['cancel', 'unmount', 'new-operation']) {
  test(`${stop} during the retry wait prevents another read`, async () => {
    const gate = deferred(); let current = true, reads = 0;
    const result = readWorldCreationConfirmation({read: async () => {reads++; throw timeout();}, current: () => current,
      pending: () => {}, wait: () => gate.promise});
    await new Promise(resolve => setImmediate(resolve)); current = false; gate.resolve();
    assert.equal(await result, null); assert.equal(reads, 1);
  });
}

test('a late success or error from a superseded read cannot complete the original operation', async () => {
  for (const fail of [false, true]) {
    const gate = deferred(); let current = true;
    const result = readWorldCreationConfirmation({read: async () => {await gate.promise; if (fail) throw Error('OLD_FAILURE'); return {state: 'ready'};},
      current: () => current, pending: () => assert.fail('stale notice'), wait: async () => assert.fail('stale retry')});
    current = false; gate.resolve(); assert.equal(await result, null);
  }
});

test('terminal world data is returned once for the existing failure handler; it is not automatically retried', async () => {
  const failed = {worlds: [{id: 'registered-world', state: 'failed', creation: {error: {code: 'CHECK_FAILED'}}}]};
  let reads = 0;
  assert.equal(await readWorldCreationConfirmation({read: async () => {reads++; return failed;}, current: () => true,
    pending: () => assert.fail('terminal pending'), wait: async () => assert.fail('terminal retry')}), failed);
  assert.equal(reads, 1);
});

test('only the exact Error message is retried; mutation and other transport failures are propagated', async () => {
  for (const error of [Error('GODOT_CANDIDATE_ACTIVE'), Error('WORLD_INITIALIZATION_FAILED'), Error('ACK_LOST'),
    Error('Craftmine Rust request timed out unexpectedly'), Error('Rust request timed out'), 'Craftmine Rust request timed out']) {
    let reads = 0;
    await assert.rejects(readWorldCreationConfirmation({read: async () => {reads++; throw error;}, current: () => true,
      pending: () => assert.fail('unrelated pending'), wait: async () => assert.fail('unrelated retry')}), value => value === error);
    assert.equal(reads, 1);
  }
  let reads = 0;
  assert.equal(await readWorldCreationConfirmation({read: async () => {if (++reads === 1) throw Error('Error: Craftmine Rust request timed out'); return 'ready';},
    current: () => true, pending: () => {}, wait: async () => {}}), 'ready');
});
