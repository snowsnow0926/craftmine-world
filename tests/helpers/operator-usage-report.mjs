// Offline evidence extraction only. Codex current-turn counters are snapshots,
// never independent model calls or additive per-message billing records.
const terminal=new Set(['completed','complete','error','aborted']);
const fields=['inputTokens','cacheReadTokens','cacheWriteTokens','outputTokens','reasoningTokens','totalTokens'];
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const key=(sessionId,turnId)=>JSON.stringify([sessionId,turnId]);
function usage(value){
  if(!value||!['inputTokens','outputTokens','totalTokens'].every(name=>integer(value[name])))return null;
  if(fields.some(name=>value[name]!==undefined&&!integer(value[name])))return null;
  return Object.fromEntries(fields.map(name=>[name,value[name]??null]));
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/** Input objects carry file/line provenance. No filesystem, model or UI writes. */
export function extractOperatorUsage({reports=[],events=[],sessions=[],generatedAt=new Date().toISOString()}){
  const groups=new Map(),warnings=[],messageOwners=new Map(),knownSessions=new Set();
  function group(sessionId,turnId){const id=key(sessionId,turnId);if(!groups.has(id))groups.set(id,{sessionId,turnId,reports:[],metrics:[],snapshots:[],terminalMessages:[],terminalEvents:[],models:[],toolCalls:new Set(),warnings:[]});return groups.get(id);}
  for(const report of reports){
    const data=report.data;if(data?.format!=='craftmine.product-agent-operator/1'){warnings.push({code:'UNRECOGNIZED_REPORT',source:report.source});continue;}
    if(typeof data.sessionId==='string')knownSessions.add(data.sessionId);
    for(const [index,turn]of (data.turns??[]).entries()){
      if(typeof turn.turnId!=='string'||typeof data.sessionId!=='string'){warnings.push({code:'TURN_IDENTITY_MISSING',source:report.source,index});continue;}
      const g=group(data.sessionId,turn.turnId),source={file:report.source,field:report.turnField??`turns[${index}]`};g.reports.push({data:turn,source});
      if(turn.messageId){const messageKey=key(data.sessionId,turn.messageId),previous=messageOwners.get(messageKey);if(previous!==undefined&&previous!==g){messageOwners.set(messageKey,null);g.warnings.push('USER_MESSAGE_REUSED_ACROSS_TURNS');}else messageOwners.set(messageKey,g);}
      if(turn.metrics?.format==='craftmine.task-metrics/1'&&turn.metrics.sessionId===g.sessionId&&turn.metrics.turnId===g.turnId)g.metrics.push({data:turn.metrics,source:{...source,field:source.field+'.metrics'}});
    }
  }
  for(const entry of events){
    const envelope=entry.data,event=envelope?.event;if(!event||typeof envelope.sessionId!=='string'||typeof envelope.turnId!=='string')continue;
    if(!knownSessions.has(envelope.sessionId))continue;
    const g=group(envelope.sessionId,envelope.turnId),source={file:entry.source,line:entry.line};
    if(event.message?.id){const id=key(g.sessionId,event.message.id),previous=messageOwners.get(id);if(previous&&previous!==g){messageOwners.set(id,null);g.warnings.push('MESSAGE_OWNER_CONFLICT');}else if(previous!==null)messageOwners.set(id,g);}
    if(event.type==='status'){
      const status=event.status??{},transport=status.transportUsage;
      if(status.backend||status.modelId)g.models.push({backend:status.backend??null,model:status.modelId??null,effort:status.reasoningEffort??null,transportState:status.transportState??null,source});
      if(transport?.scope==='current-turn'){
        const normalized=usage(transport.usage);
        if(normalized)g.snapshots.push({usage:normalized,source,observedAtMs:integer(envelope.ts)?envelope.ts:null});else g.warnings.push('INVALID_TRANSPORT_USAGE');
      }
    }
    if(event.type==='message_end'&&event.message?.codexUsage?.scope==='current-turn'&&event.message?.usage){
      const normalized=usage(event.message.usage);
      if(normalized)g.terminalMessages.push({messageId:event.message.id,usage:normalized,lastRequest:usage(event.message.codexUsage.lastRequest),modelContextWindow:event.message.codexUsage.modelContextWindow??null,source,kind:'terminal-message-event'});else g.warnings.push('INVALID_TERMINAL_USAGE');
    }
    if(event.type==='agent_end')g.terminalEvents.push({source,atMs:integer(envelope.ts)?envelope.ts:null});
    if(event.type==='tool_start'&&typeof event.toolCallId==='string')g.toolCalls.add(event.toolCallId);
  }
  // Prefer exact event message ownership. When events are absent, use persisted
  // message order bounded by known user IDs, resetting at every unknown user.
  for(const entry of sessions){
    const session=entry.data?.session;if(!session||!knownSessions.has(session.id)||!Array.isArray(session.messages))continue;
    let current=null;
    for(const [index,message]of session.messages.entries()){
      if(message.role==='user')current=messageOwners.get(key(session.id,message.id))??null;
      const exactOwner=messageOwners.get(key(session.id,message.id)),g=exactOwner??current;
      if(message.role!=='assistant'||message.codexUsage?.scope!=='current-turn'||!message.usage)continue;
      if(!g||exactOwner===null){warnings.push({code:'UNMAPPED_CODEX_TURN_AGGREGATE',source:entry.source,messageId:message.id});continue;}
      const normalized=usage(message.usage);if(!normalized){g.warnings.push('INVALID_PERSISTED_USAGE');continue;}
      g.terminalMessages.push({messageId:message.id,usage:normalized,lastRequest:usage(message.codexUsage.lastRequest),modelContextWindow:message.codexUsage.modelContextWindow??null,
        source:{file:entry.source,field:`${entry.messageField??'session.messages'}[${index}].usage`,association:exactOwner?'event-message-id':'persisted-order-between-known-user-ids'},kind:'persisted-terminal-message'});
    }
  }
  const rows=[];
  for(const g of groups.values()){
    const known=g.reports.at(-1)?.data,metricCandidates=g.metrics.sort((a,b)=>(terminal.has(a.data.status)?1:0)-(terminal.has(b.data.status)?1:0)||(a.data.observedAtMs??0)-(b.data.observedAtMs??0));
    const metric=metricCandidates.at(-1),raw=metric?.data;
    const status=raw?.status??(terminal.has(known?.status)?known.status:g.terminalEvents.length?'terminal-event-only':'running-or-unrecorded');
    const isTerminal=terminal.has(status)||status==='terminal-event-only';
    const finalCandidates=g.terminalMessages.filter(row=>row.kind==='persisted-terminal-message');
    const candidates=finalCandidates.length?finalCandidates:g.terminalMessages;
    const unique=new Map(candidates.map(row=>[JSON.stringify(row.usage),row]));
    let chosen=unique.size===1?[...unique.values()][0]:null;
    if(unique.size>1)g.warnings.push('CONFLICTING_TURN_AGGREGATES_NOT_SUMMED');
    if(!chosen&&!unique.size&&raw?.coverage==='complete'&&usage(raw.usage))chosen={usage:usage(raw.usage),source:metric.source,kind:'complete-host-call-ledger',lastRequest:null,modelContextWindow:null};
    if(chosen&&g.terminalMessages.some(row=>!same(row.usage,chosen.usage)))g.warnings.push('TERMINAL_SOURCES_DISAGREE');
    const snapshot=g.snapshots.at(-1),model=g.models.findLast(row=>row.backend&&row.model)??(known?.effectiveModel?{...known.effectiveModel,transportState:null,source:{...g.reports.at(-1).source,field:g.reports.at(-1).source.field+'.effectiveModel'}}:null);
    let timing={milliseconds:null,source:null,coverage:'unknown',final:isTerminal};
    if(raw){
      // Host deliberately leaves wallTime null after interrupted recovery. Do
      // not reconstruct it from endpoints and erase that uncertainty.
      timing={milliseconds:isTerminal&&integer(raw.wallTimeMs)?raw.wallTimeMs:null,observedMilliseconds:integer(raw.wallTimeMs)?raw.wallTimeMs:null,
        startedAtMs:integer(raw.startedAtMs)?raw.startedAtMs:null,endedAtMs:integer(raw.endedAtMs)?raw.endedAtMs:null,source:{...metric.source,field:metric.source.field+'.wallTimeMs'},coverage:integer(raw.wallTimeMs)?isTerminal?'terminal-host-wall':'live-host-wall':'host-unavailable',final:isTerminal};
    }else if(known?.startedAt&&known?.finishedAt&&isTerminal){
      const milliseconds=Date.parse(known.finishedAt)-Date.parse(known.startedAt);
      if(integer(milliseconds))timing={milliseconds,source:g.reports.at(-1).source,coverage:'operator-observed-boundary-includes-poll-delay',final:true};
    }
    const fullCalls=raw?.coverage==='complete'&&integer(raw.calls?.observed)&&raw.calls.observed>0&&raw.calls.pending===0;
    rows.push({sessionId:g.sessionId,turnId:g.turnId,messageId:known?.messageId??null,promptExcerpt:typeof known?.text==='string'?known.text.slice(0,240):null,status,terminal:isTerminal,model,
      elapsed:timing,finalUsage:isTerminal&&chosen&&!g.warnings.includes('TERMINAL_SOURCES_DISAGREE')?{...chosen.usage,source:chosen.source,kind:chosen.kind,scope:'one-turn'}:null,
      usageAvailability:chosen?isTerminal?'terminal-reported':'terminal-message-awaiting-turn-close':snapshot?'last-observed-only':'unknown',
      lastObservedUsage:snapshot?{...snapshot.usage,source:snapshot.source,scope:'current-turn-cumulative-snapshot',provisional:true}:null,
      lastRequestUsage:chosen?.lastRequest??null,modelContextWindow:chosen?.modelContextWindow??null,
      modelCalls:{value:fullCalls?raw.calls.observed:null,coverage:raw?.coverage??'unknown',scope:raw?.scope??null,rawObserved:raw?.calls?.observed??null,rawReported:raw?.calls?.reported??null,rawPending:raw?.calls?.pending??null,source:metric?.source??null,reason:fullCalls?'complete-host-model-call-ledger':'no-complete-physical-model-call-ledger'},
      observedToolCalls:g.toolCalls.size,transportSnapshotCount:g.snapshots.length,distinctTransportSnapshotCount:new Set(g.snapshots.map(row=>JSON.stringify(row.usage))).size,
      aggregateCopies:g.terminalMessages.length,sourceRefs:[...g.reports.map(row=>row.source),...g.terminalMessages.map(row=>row.source)],warnings:[...new Set(g.warnings)]});
  }
  rows.sort((a,b)=>(a.elapsed.startedAtMs??Infinity)-(b.elapsed.startedAtMs??Infinity)||a.turnId.localeCompare(b.turnId));
  const final=rows.length>0&&rows.every(row=>row.terminal&&row.finalUsage)&&!warnings.some(row=>['UNMAPPED_CODEX_TURN_AGGREGATE','TURN_IDENTITY_MISSING'].includes(row.code)),aggregate=final?{
    scope:'distinct-session-turns-only',turns:rows.length,usage:Object.fromEntries(fields.map(name=>[name,rows.every(row=>integer(row.finalUsage[name]))?rows.reduce((sum,row)=>sum+row.finalUsage[name],0):null])),
    elapsedMilliseconds:rows.every(row=>integer(row.elapsed.milliseconds))?rows.reduce((sum,row)=>sum+row.elapsed.milliseconds,0):null,
    modelCalls:rows.every(row=>integer(row.modelCalls.value))?rows.reduce((sum,row)=>sum+row.modelCalls.value,0):null,
    elapsedScope:'sum-of-turn-wall-times-excludes-between-turn-player-review-and-installation',
  }:null;
  return {format:'craftmine.operator-usage-evidence/1',generatedAt,turns:rows,finalAggregate:aggregate,
    aggregateAvailability:final?'all-observed-turns-terminal-and-reported':rows.some(row=>!row.terminal)?'ongoing-turns-no-final-total':'missing-or-conflicting-final-usage',
    cost:{usd:null,reason:'Codex cost is not reported; no rate assumptions or account-billing inference'},warnings,
    countingRules:['Desktop Codex inputTokens is uncached input after subtracting reported cache read/write from the Codex input delta.','Reasoning/cache fields are details; retain reported totalTokens and never add them to total again.','Current-turn transportUsage is cumulative: select one final aggregate, never sum snapshots or duplicate terminal messages.','codexUsage.lastRequest is context/last-request usage, not an additional turn cost.','Missing optional counters and unknown call coverage stay null.','Host wallTimeMs intentionally null after interrupted recovery remains unknown.']};
}
export function operatorUsageMarkdown(report){
  const display=value=>integer(value)?String(value):'—';
  const lines=['# 实际创作耗时与 token 证据','',`汇总状态：${report.aggregateAvailability}。成本未报告，不估算美元费用。`,'','| 轮次 | 状态 | 耗时（秒） | 未缓存输入 | 缓存读取 | 输出 | 推理明细 | 总 token | 模型调用数 |','|---|---|---:|---:|---:|---:|---:|---:|---:|'];
  for(const [index,row]of report.turns.entries()){const u=row.finalUsage;lines.push(`| ${index+1} · ${row.turnId} | ${row.status} | ${integer(row.elapsed.milliseconds)?(row.elapsed.milliseconds/1000).toFixed(2):'—'} | ${display(u?.inputTokens)} | ${display(u?.cacheReadTokens)} | ${display(u?.outputTokens)} | ${display(u?.reasoningTokens)} | ${display(u?.totalTokens)} | ${display(row.modelCalls.value)} |`);}
  if(report.finalAggregate)lines.push('',`已结束轮次合计：${report.finalAggregate.usage.totalTokens} token。此数只按不同 session/turn 汇总一次，推理和缓存没有再次加到总数。`);
  lines.push('','— 表示缺失或尚未完成，不能当作 0。运行中快照只保留在 JSON 的 provisional 字段。每轮来源、覆盖范围与缺失原因见同名 JSON。','', '逐轮耗时不包含轮与轮之间的玩家检查、素材安装与手动采用时间，也不等同于纯模型生成时间。','');
  return lines.join('\n');
}
