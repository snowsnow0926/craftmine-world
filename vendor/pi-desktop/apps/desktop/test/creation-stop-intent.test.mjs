import test from 'node:test';import assert from 'node:assert/strict';
import {createCreationStopIntents} from '../electron/main/creation-stop-intent.ts';
test('shutdown preserves only the exact stopped turn, never another turn in the same session',()=>{
  const intent=createCreationStopIntents();intent.shutdown([['session','repair-turn']]);
  assert.equal(intent.shouldPreserve('session','repair-turn'),true);assert.equal(intent.shouldPreserve('session','new-turn'),false);intent.release('session','repair-turn');assert.equal(intent.shouldPreserve('session','repair-turn'),false);
});
test('explicit cancellation wins on either side of shutdown registration',()=>{
  for(const before of [true,false]){const intent=createCreationStopIntents();if(before)intent.user('session','turn');intent.shutdown([['session','turn']]);if(!before)intent.user('session','turn');assert.equal(intent.shouldPreserve('session','turn'),false);}
});
test('ordinary abort without a shutdown marker remains cancellation',()=>{assert.equal(createCreationStopIntents().shouldPreserve('session','turn'),false);});
