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

test('automatic turn absent from operator report remains provisional, then contributes its one exact terminal aggregate',()=>{
  const reports=[report([{turnId:'manual',messageId:'u1',metrics:metric('manual')}])];
  const autoMessage={id:'auto-a',role:'assistant',status:'complete',usage:usage(3),codexUsage:{scope:'current-turn'}};
  const sessions=[{source:'session.json',data:{session:{id:sid,messages:[{role:'user',id:'u1'},{role:'assistant',id:'assistant-manual',usage:usage(),codexUsage:{scope:'current-turn'}},{role:'user',id:'auto-user',content:'【自动检查修复】保留原任务'},autoMessage]}}}];
  const events=[end('manual',usage()),event('auto','agent_start',{},2),snapshot('auto',usage(2),3),end('auto',usage(3),'auto-a')];
  const live=extractOperatorUsage({reports,events,sessions});assert.equal(live.turns.length,2);assert.equal(live.finalAggregate,null);
  const row=live.turns.find(t=>t.turnId==='auto');assert.equal(row.discovery,'session-event-turn');assert.equal(row.messageId,'auto-user');assert.equal(row.finalUsage,null);assert.equal(row.modelCalls.value,null);
  const finished=extractOperatorUsage({reports,events:[...events,event('auto','agent_end',{},9)],sessions});
  assert.equal(finished.finalAggregate.usage.totalTokens,480);const auto=finished.turns.find(t=>t.turnId==='auto');
  assert.equal(auto.finalUsage.totalTokens,360);assert.equal(auto.elapsed.milliseconds,7);assert.equal(auto.elapsed.coverage,'event-observed-turn-boundaries');assert.equal(auto.modelCalls.value,null);
});

test('an unmapped pending automatic user prevents manual-only final totals before any usage carrier arrives',()=>{
  const result=extractOperatorUsage({reports:[report([{turnId:'manual',messageId:'u',metrics:metric('manual')}])],events:[end('manual',usage())],sessions:[{source:'session.json',data:{session:{id:sid,messages:[{role:'user',id:'u'},{role:'assistant',id:'assistant-manual',usage:usage(),codexUsage:{scope:'current-turn'}},{role:'user',id:'new-auto',content:'automatic action pending'}]}}}]});
  assert.equal(result.finalAggregate,null);assert(result.warnings.some(w=>w.code==='UNMAPPED_SESSION_USER_TURN'&&w.messageId==='new-auto'));
});

test('multiple event turn owners never guess an unknown user association; recovered event starts do not invent duration',()=>{
  const events=[event('auto','agent_start',{},2),event('auto','agent_start',{},3),end('auto',usage(),'a'),event('auto','agent_end',{},9),end('other',usage(),'b'),event('other','agent_end',{},10)];
  const result=extractOperatorUsage({reports:[report([])],events,sessions:[{source:'session.json',data:{session:{id:sid,messages:[{role:'user',id:'ambiguous'},{role:'assistant',id:'a'},{role:'assistant',id:'b'}]}}}]});
  assert.equal(result.finalAggregate,null);assert.equal(result.turns.find(t=>t.turnId==='auto').elapsed.milliseconds,null);assert(result.warnings.some(w=>w.code==='UNMAPPED_SESSION_USER_TURN'));
});

const fullWindowSentinel={inputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0,reasoningTokens:0,totalTokens:522500};
test('actual full-context sentinel remains raw evidence, never final tokens in either event or persisted source',()=>{
  const turnId='aad92522-824b-44b0-9064-aac66173e4d7',carrier=end(turnId,fullWindowSentinel,'sentinel');carrier.data.event.message.codexUsage.modelContextWindow=522500;
  const sessions=[{source:'session.json',data:{session:{id:sid,messages:[{id:'u',role:'user'},carrier.data.event.message]}}}];
  const before=JSON.stringify({carrier,sessions});
  const result=extractOperatorUsage({reports:[report([{turnId,messageId:'u',metrics:metric(turnId,'error')}])],events:[snapshot(turnId,fullWindowSentinel,10),carrier],sessions});
  const row=result.turns[0];assert.equal(row.finalUsage,null);assert.equal(row.lastObservedUsage,null);assert.equal(result.finalAggregate,null);assert.equal(row.usageAvailability,'rejected-terminal-usage');
  assert(row.warnings.includes('CODEX_USAGE_TOTAL_INCONSISTENT'));assert.equal(row.rejectedUsageReports.length,3);
  const persisted=row.rejectedUsageReports.find(r=>r.kind==='persisted-terminal-message');assert.deepEqual(persisted.rawReported,fullWindowSentinel);assert.equal(persisted.counterSum,0);assert.equal(persisted.modelContextWindow,522500);assert.equal(persisted.source.file,'session.json');
  assert.equal(JSON.stringify({carrier,sessions}),before);assert(!operatorUsageMarkdown(result).includes('| 522500 |'));
});
test('normal uncached plus read/write cache plus output is counted once and reasoning is not added',()=>{
  const value={inputTokens:11,cacheReadTokens:100,cacheWriteTokens:4,outputTokens:9,reasoningTokens:7,totalTokens:124};
  const result=extractOperatorUsage({reports:[report([{turnId:'t',metrics:metric('t')}])],events:[end('t',value)]});
  assert.equal(result.finalAggregate.usage.totalTokens,124);assert.equal(result.turns[0].rejectedUsageReports.length,0);
});
test('missing or null optional cache does not become zero or a guessed accounting contradiction',()=>{
  for(const value of [{inputTokens:0,outputTokens:0,totalTokens:522500},{inputTokens:0,cacheReadTokens:0,cacheWriteTokens:null,outputTokens:0,totalTokens:522500}]){
    const result=extractOperatorUsage({reports:[report([{turnId:'t',metrics:metric('t')}])],events:[end('t',value)]});
    assert.equal(result.turns[0].finalUsage.totalTokens,522500);assert.equal(result.turns[0].finalUsage.cacheWriteTokens,null);assert.equal(result.turns[0].rejectedUsageReports.length,0);
  }
});
test('invalid partial snapshots stay rejected; a separate valid terminal carrier may close the turn',()=>{
  const base={reports:[report([{turnId:'t',metrics:metric('t','running')}])],events:[snapshot('t',fullWindowSentinel,1)]};
  const running=extractOperatorUsage(base);assert.equal(running.finalAggregate,null);assert.equal(running.turns[0].lastObservedUsage,null);assert.equal(running.turns[0].usageAvailability,'invalid-reported-usage');
  const ended=extractOperatorUsage({reports:[report([{turnId:'t',metrics:metric('t')}])],events:[...base.events,end('t',usage())]});
  assert.equal(ended.finalAggregate.usage.totalTokens,120);assert.equal(ended.turns[0].rejectedUsageReports[0].rawReported.totalTokens,522500);
});
test('rejected terminal carrier cannot be replaced by an earlier valid message or inconsistent complete metrics',()=>{
  const reports=[report([{turnId:'t',metrics:metric('t','error',{coverage:'complete',usage:fullWindowSentinel})}])];
  const result=extractOperatorUsage({reports,events:[end('t',usage(),'earlier'),end('t',fullWindowSentinel,'bad')]});
  assert.equal(result.turns[0].finalUsage,null);assert.equal(result.finalAggregate,null);assert(result.turns[0].rejectedUsageReports.some(r=>r.kind==='host-metrics'));
});

const maintenance=(extra={})=>({status:'incomplete',reason:'native-maintenance-usage-unreported',maintenanceTurns:12,maintenanceElapsedMs:4567,reportedCreationUsage:usage(2),...extra});
const coverageEnd=(turnId,coverage)=>event(turnId,'message_end',{message:{id:'coverage-'+turnId,role:'assistant',status:'complete',codexUsage:{scope:'current-turn',coverage}}});
test('unreported native maintenance blocks full totals and exposes only the separately scoped creation portion',()=>{
  const value=maintenance(),carrier=coverageEnd('t',value),session={source:'session.json',data:{session:{id:sid,messages:[{id:'u',role:'user'},carrier.data.event.message]}}};
  const reports=[report([{turnId:'t',messageId:'u',metrics:metric('t','completed',{coverage:'complete',calls:{observed:2,reported:2,pending:0},usage:usage(2)})}])];
  const result=extractOperatorUsage({reports,events:[event('t','status',{status:{codexUsageCoverage:maintenance({maintenanceTurns:3,reportedCreationUsage:usage()})}},1),carrier],sessions:[session,session]});
  const row=result.turns[0];assert.equal(result.finalAggregate,null);assert.equal(row.finalUsage,null);assert.equal(row.modelCalls.value,null);
  assert.equal(row.reportedCreationUsage.totalTokens,240);assert.equal(row.reportedCreationUsage.scope,'reported-creation-only-excludes-native-maintenance');assert.equal(row.reportedCreationUsage.provisional,false);
  assert.equal(row.usageCoverage.maintenanceTurns,12);assert.equal(row.usageCoverage.maintenanceElapsedMs,4567);assert.equal(row.usageCoverage.source.file,'session.json');assert.equal(row.coverageReports.length,4);
  const markdown=operatorUsageMarkdown(result);assert.match(markdown,/不是该轮完整用量/);assert.match(markdown,/\| t \| 240 \| 12 \| 4\.57 \|/);assert(!markdown.includes('已结束轮次合计'));
});
test('status-only maintenance is provisional and unknown elapsed remains null',()=>{
  const result=extractOperatorUsage({reports:[report([{turnId:'t',metrics:metric('t','running')}])],events:[event('t','status',{status:{codexUsageCoverage:maintenance({maintenanceElapsedMs:null})}})]});
  const row=result.turns[0];assert.equal(row.usageCoverage.maintenanceElapsedMs,null);assert.equal(row.reportedCreationUsage.provisional,true);assert.equal(row.finalUsage,null);assert.equal(result.finalAggregate,null);assert.match(operatorUsageMarkdown(result),/运行中/);
});
test('ordinary complete usage without maintenance metadata keeps previous full-usage semantics',()=>{
  const result=extractOperatorUsage({reports:[report([{turnId:'t',metrics:metric('t')}])],events:[end('t',usage())]});
  assert.equal(result.finalAggregate.usage.totalTokens,120);assert.equal(result.turns[0].usageCoverage,null);assert.equal(result.turns[0].reportedCreationUsage,null);
});
test('coverage without creation counters or with contradictory sentinel keeps partial unknown, not zero',()=>{
  for(const reportedCreationUsage of [undefined,fullWindowSentinel]){
    const result=extractOperatorUsage({reports:[report([{turnId:'t',metrics:metric('t','error')}])],events:[coverageEnd('t',maintenance({reportedCreationUsage,maintenanceElapsedMs:null}))]});
    const row=result.turns[0];assert.equal(row.finalUsage,null);assert.equal(row.reportedCreationUsage,null);assert.equal(row.usageCoverage.maintenanceElapsedMs,null);assert.equal(result.finalAggregate,null);
    if(reportedCreationUsage)assert.deepEqual(row.rejectedUsageReports[0].rawReported,fullWindowSentinel);
  }
});
test('conflicting or unsupported coverage cannot silently regain full totals',()=>{
  for(const events of [[coverageEnd('t',maintenance()),coverageEnd('t',maintenance({maintenanceTurns:13}))],[coverageEnd('t',{status:'complete',maintenanceTurns:0})]]){
    const result=extractOperatorUsage({reports:[report([{turnId:'t',metrics:metric('t')}])],events:[end('t',usage()),...events]});
    assert.equal(result.turns[0].finalUsage,null);assert.equal(result.finalAggregate,null);assert.equal(result.turns[0].usageCoverage.maintenanceTurns,null);assert(result.turns[0].warnings.length>0);
  }
});
