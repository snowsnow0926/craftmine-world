import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {createCraftmineQuitState}=await import('../electron/main/craftmine-quit-state.ts');

test('confirmation and checkpoint share one attempt; failure permits an independent retry',()=>{
  const events=[],state=createCraftmineQuitState(event=>events.push(event));
  const first=state.begin('confirming');assert.equal(state.begin('confirming'),first);assert.equal(events.length,1);
  assert.equal(state.saving(),first);state.saving();assert.equal(events.length,2);
  state.finish(first,'failed','Save failed');assert.equal(events.at(-1).phase,'failed');
  const second=state.begin('confirming');assert.ok(second>first);
  state.finish(first,'cancelled');assert.equal(events.at(-1).phase,'confirming');
  state.finish(second,'cancelled');assert.equal(events.at(-1).attemptId,second);
  assert.equal(events.at(-1).error,undefined);
});
test('an already confirmed or automated quit still publishes a saving attempt',()=>{
  const events=[],state=createCraftmineQuitState(event=>events.push(event));
  const first=state.saving();state.finish(first,'failed','Safe error');
  assert.ok(state.saving()>first);assert.equal(events.at(-1).phase,'saving');assert.equal(events.at(-1).error,undefined);
});
