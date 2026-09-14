import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script=path.resolve(import.meta.dirname,'operator-usage-export.mjs');
function fixture(t,status='completed'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'operator-usage-export-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  const turn={turnId:'t',messageId:'u',metrics:{format:'craftmine.task-metrics/1',sessionId:'s',turnId:'t',status,startedAtMs:1000,endedAtMs:status==='completed'?2000:null,observedAtMs:2000,wallTimeMs:1000,coverage:'unknown',calls:{observed:0,reported:0,pending:0},usage:null}};
  write('previous.json',{format:'craftmine.product-agent-operator/1',out:root,sessionId:'s',turns:[turn]});
  write('active.json',{format:'craftmine.product-agent-operator/1',out:root,sessionId:'s',turns:[turn],previousReport:path.join(root,'previous.json')});
  const message={id:'a',role:'assistant',status:'complete',usage:{inputTokens:10,cacheReadTokens:70,outputTokens:20,totalTokens:100},codexUsage:{scope:'current-turn',cost:null}};
  write('session.json',{session:{id:'s',messages:[{id:'u',role:'user'},message]}});
  fs.writeFileSync(path.join(root,'agent-events.ndjson'),JSON.stringify({sessionId:'s',turnId:'t',ts:2000,event:{type:'message_end',message}})+'\n');
  return {root,run:()=>spawnSync(process.execPath,[script,'--report',path.join(root,'active.json'),'--output',path.join(root,'export.json'),'--require-final'],{encoding:'utf8',windowsHide:true})};
}
test('CLI follows report history without double counting or writing its input files',t=>{
  const f=fixture(t),original=fs.readFileSync(path.join(f.root,'active.json'));const result=f.run();assert.equal(result.status,0,result.stderr);
  const exported=JSON.parse(fs.readFileSync(path.join(f.root,'export.json')));assert.equal(exported.turns.length,1);assert.equal(exported.finalAggregate.usage.totalTokens,100);assert.equal(exported.finalAggregate.modelCalls,null);assert.equal(exported.inputs.length,4);assert.deepEqual(fs.readFileSync(path.join(f.root,'active.json')),original);
  const second=f.run();assert.notEqual(second.status,0);assert.match(second.stderr,/NEW_EVIDENCE_OUTPUT_FILES_REQUIRED/);
});
test('CLI with active turn and incomplete final event exports provisional evidence but refuses final totals',t=>{
  const f=fixture(t,'running');fs.appendFileSync(path.join(f.root,'agent-events.ndjson'),'{"sessionId":');const result=f.run();assert.equal(result.status,2,result.stderr);
  const exported=JSON.parse(fs.readFileSync(path.join(f.root,'export.json')));assert.equal(exported.finalAggregate,null);assert.equal(exported.turns[0].finalUsage,null);assert(exported.inputWarnings.some(row=>row.code==='INCOMPLETE_FINAL_EVENT_LINE'));
});
