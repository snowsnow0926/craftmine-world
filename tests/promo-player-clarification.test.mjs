import test from 'node:test';import assert from 'node:assert/strict';
import {playerClarificationMode,choosePlayerClarification} from './helpers/promo-player-clarification.mjs';
const request={sessionId:'s',requestId:'r',toolCallId:'t',questions:[{question:'怪物行为？',options:['只装饰','会追逐（推荐）']},{question:'重开怎么办？',options:['重置','保留']}]};
test('simulation is opt-in and accepts only a named finite policy',()=>{
 assert.equal(playerClarificationMode(), 'off');assert.equal(playerClarificationMode('off'),'off');assert.throws(()=>playerClarificationMode('auto'));
 assert.throws(()=>choosePlayerClarification(request,'s','off'),/NOT_ENABLED/);
});
test('recommendation or first choice preserves complete questions and exact original answer text',()=>{
 const result=choosePlayerClarification(request,'s','recommended-or-first');
 assert.deepEqual(result.choices,[[1],[0]]);assert.deepEqual(result.answers,[['会追逐（推荐）'],['重置']]);assert.deepEqual(result.ask,request);
 assert.deepEqual(result.selectionReasons,['explicit-recommendation','first-listed-option']);
 assert.deepEqual(request.questions[0].options,['只装饰','会追逐（推荐）']);
});
test('free-form-only questions remain blocked and negative recommendation is not selected',()=>{
 assert.throws(()=>choosePlayerClarification({...request,questions:[{question:'描述一下',options:[]}]},'s','recommended-or-first'),/REQUIRES_PLAYER/);
 const result=choosePlayerClarification({...request,questions:[{question:'选哪个',options:['默认','不推荐','Choice (Recommended)']}]},'s','recommended-or-first');assert.deepEqual(result.choices,[[2]]);
});
