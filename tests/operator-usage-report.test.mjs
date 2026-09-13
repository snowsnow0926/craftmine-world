import test from 'node:test';
import assert from 'node:assert/strict';
import {extractOperatorUsage,operatorUsageMarkdown} from './helpers/operator-usage-report.mjs';
const sid='session-one';
const usage=(n=1)=>({inputTokens:20*n,cacheReadTokens:80*n,cacheWriteTokens:0,outputTokens:20*n,reasoningTokens:7*n,totalTokens:120*n});
const report=(turns)=>({source:'operator.json',data:{format:'craftmine.product-agent-operator/1',sessionId:sid,turns}});
const metric=(turnId,status='completed',extra={})=>({format:'craftmine.task-metrics/1',sessionId:sid,turnId,status,startedAtMs:1000,endedAtMs:status==='running'?null:3000,observedAtMs:3500,wallTimeMs:2000,coverage:'unknown',calls:{observed:0,reported:0,pending:0},usage:null,scope:'root-and-delegates',...extra});
const event=(turnId,type,values,line=1)=>({source:'events.ndjson',line,data:{sessionId:sid,turnId,ts:2000+line,event:{type,...values}}});
const snapshot=(turnId,value,line)=>event(turnId,'status',{status:{backend:'codex-cli',modelId:'gpt-6-astra',reasoningEffort:'xhigh',transportUsage:{scope:'current-turn',usage:value,cost:null}}},line);
const end=(turnId,value,id='assistant-'+turnId)=>event(turnId,'message_end',{message:{id,role:'assistant',status:'complete',providerId:'codex-cli',usage:value,codexUsage:{scope:'current-turn',lastRequest:usage(1),modelContextWindow:1000000,cost:null}}});
test('turn deltas are counted once across repeated snapshots/messages/reports, never as session totals',()=>{
  const turns=['turn-a','turn-b'].map((turnId,i)=>({turnId,messageId:'user-'+i,status:'completed',metrics:metric(turnId)}));
  const events=[snapshot('turn-a',usage(),1),snapshot('turn-a',usage(2),2),snapshot('turn-a',usage(2),3),end('turn-a',usage(2)),snapshot('turn-b',usage(),4),end('turn-b',usage())];
  const result=extractOperatorUsage({reports:[report(turns),report(turns)],events:[...events,events[3]]});
  assert.equal(result.turns.length,2);assert.equal(result.finalAggregate.usage.totalTokens,360);assert.equal(result.finalAggregate.usage.inputTokens,60);assert.equal(result.finalAggregate.usage.reasoningTokens,21);
  assert.equal(result.turns[0].transportSnapshotCount,3);assert.equal(result.turns[0].distinctTransportSnapshotCount,2);assert.equal(result.finalAggregate.modelCalls,null);assert.equal(result.cost.usd,null);
});
test('running snapshots remain provisional and prevent final total, even if a terminal assistant message arrived first',()=>{
  const result=extractOperatorUsage({reports:[report([{turnId:'t',messageId:'u',metrics:metric('t','running')}])],events:[snapshot('t',usage(4),1),end('t',usage(4))]});
  assert.equal(result.finalAggregate,null);assert.equal(result.turns[0].finalUsage,null);assert.equal(result.turns[0].lastObservedUsage.provisional,true);assert.equal(result.turns[0].elapsed.milliseconds,null);
  assert(!operatorUsageMarkdown(result).includes('| 480 |'));assert.equal(result.turns[0].modelCalls.value,null);
});
test('unknown optional counters stay null and lastRequest is not added to terminal turn usage',()=>{
  const minimal={inputTokens:100,outputTokens:20,totalTokens:120};
  const result=extractOperatorUsage({reports:[report([{turnId:'t',metrics:metric('t')}])],events:[end('t',minimal)]});
  assert.equal(result.finalAggregate.usage.totalTokens,120);assert.equal(result.finalAggregate.usage.cacheReadTokens,null);assert.equal(result.finalAggregate.usage.reasoningTokens,null);assert.equal(result.turns[0].lastRequestUsage.totalTokens,120);
});
test('persisted terminal carrier deduplicates whole-session snapshots using exact event message ownership',()=>{
  const carrier={id:'a',role:'assistant',status:'complete',usage:usage(),codexUsage:{scope:'current-turn',lastRequest:usage(5)}};
  const entry={source:'session.json',data:{session:{id:sid,messages:[{id:'u',role:'user'},carrier]}}};
  const result=extractOperatorUsage({reports:[report([{turnId:'t',messageId:'u',metrics:metric('t')}])],events:[end('t',usage(),'a')],sessions:[entry,entry]});
  assert.equal(result.turns[0].finalUsage.kind,'persisted-terminal-message');assert.equal(result.finalAggregate.usage.totalTokens,120);assert.equal(result.turns[0].aggregateCopies,3);
});
test('conflicting aggregate carriers and incomplete transport-only ending do not fabricate final usage',()=>{
  const base={reports:[report([{turnId:'t',metrics:metric('t')}])]};
  const conflicting=extractOperatorUsage({...base,events:[end('t',usage(),'one'),end('t',usage(2),'two')]});assert.equal(conflicting.finalAggregate,null);assert.equal(conflicting.turns[0].finalUsage,null);
  const snapshotOnly=extractOperatorUsage({...base,events:[snapshot('t',usage(2),1),event('t','agent_end',{messageIds:[]})]});assert.equal(snapshotOnly.finalAggregate,null);assert.equal(snapshotOnly.turns[0].usageAvailability,'last-observed-only');
});
test('host intentionally unknown interrupted wall time stays unknown; complete physical-call ledger may be reported',()=>{
  const result=extractOperatorUsage({reports:[report([{turnId:'t',metrics:metric('t','aborted',{wallTimeMs:null,coverage:'complete',calls:{observed:2,reported:2,pending:0},usage:usage()})}])]});
  assert.equal(result.turns[0].elapsed.milliseconds,null);assert.equal(result.finalAggregate.elapsedMilliseconds,null);assert.equal(result.turns[0].modelCalls.value,2);assert.equal(result.finalAggregate.usage.totalTokens,120);
});
test('without event mapping, unknown user messages stop association with the preceding known turn',()=>{
  const sessions=[{source:'session.json',data:{session:{id:sid,messages:[{role:'user',id:'known'},{role:'assistant',id:'known-a',usage:usage(),codexUsage:{scope:'current-turn'}},{role:'user',id:'unknown'},{role:'assistant',id:'unknown-a',usage:usage(9),codexUsage:{scope:'current-turn'}}]}}}];
  const result=extractOperatorUsage({reports:[report([{turnId:'t',messageId:'known',metrics:metric('t')}])],sessions});assert.equal(result.turns[0].finalUsage.totalTokens,120);assert.equal(result.finalAggregate,null);assert(result.warnings.some(row=>row.code==='UNMAPPED_CODEX_TURN_AGGREGATE'));
});
