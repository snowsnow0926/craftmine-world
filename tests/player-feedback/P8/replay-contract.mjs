import assert from 'node:assert/strict';
export const P8_REPLAY_ROOT='D:/cm-fb2-20260910/test-results/desktop-native-p8-V35GyJ';
export function validateReplayCommand(type,method,payload,worldId){
  assert.ok(payload&&typeof payload==='object'&&!Array.isArray(payload),'REPLAY_PAYLOAD_REQUIRED');
  if(type==='craftmine-acceptance-p8'){
    assert.ok(['initialize','snapshot'].includes(method),'REPLAY_MUTATION_DENIED');
    assert.deepEqual(Object.keys(payload).sort(),method==='initialize'?['caseId','worldId']:['caseId']);
    assert.equal(payload.caseId,'hammer');if(method==='initialize')assert.equal(payload.worldId,worldId);
  }else{
    assert.equal(type,'craftmine-headless');assert.ok(['status','worldNavigationReady','godotObserve','godotSnapshot','quit'].includes(method),'REPLAY_METHOD_DENIED');assert.deepEqual(payload,{});
  }
}
export function assertReplayMetrics(value,expected){
  assert.equal(value.active,false);const {observedAtMs:now,...actual}=value.metrics;const {observedAtMs:then,...before}=expected.metrics;assert.deepEqual(actual,before);
  assert.equal(actual.status,'error');assert.equal(actual.coverage,'partial');assert.equal(actual.usage.totalTokens,285458);
  const cards=value.dom.metrics.filter(x=>x.turnId===actual.turnId);assert.equal(cards.length,1,'REPLAY_ONE_CARD_REQUIRED');const card=cards[0];assert.equal(card.coverage,'partial');assert.equal(card.values.tokens,'285,458');assert.ok(card.text.includes('失败')&&!card.text.includes('进行中'));assert.ok(card.values.model.includes('deepseek-v4.1-flash-expires-on-0910'));assert.ok(card.values.tps.startsWith('299.7'));assert.ok(card.values.tps.includes('部分统计'));assert.equal(value.dom.guard.pointerLock,0);assert.equal(value.dom.guard.focus,0);
}
