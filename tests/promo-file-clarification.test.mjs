import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createFileClarificationExchange,writeFileClarificationResponse} from './helpers/promo-file-clarification.mjs';
const ask=()=>({sessionId:'session-a',requestId:'question-a',toolCallId:'tool-a',questions:[{question:'怪物行为？',options:['静态','追逐并攻击']},{question:'城市范围？',options:['入口','可探索街区'],multiSelect:false}]});
const answer=()=>({sessionId:'session-a',requestId:'question-a',choices:[[1],[1]]});
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'file-clarification-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
 const directory=path.join(root,'exchange'),exchange=createFileClarificationExchange({directory,...options});return {root,directory,exchange};
}
test('publishes complete questions before waiting and returns exact choices for the regular API',async t=>{
 const f=fixture(t),raw=ask(),ticket=f.exchange.publish(raw,raw.sessionId);
 const published=JSON.parse(fs.readFileSync(ticket.requestFile));assert.deepEqual(published.questions,raw.questions);assert.equal(published.requestId,raw.requestId);assert.equal(Object.hasOwn(published,'deadlineAt'),false);assert.equal(fs.existsSync(ticket.responseFile),false);
 const pending=f.exchange.waitForResponse(ticket);writeFileClarificationResponse(f.directory,answer());const selected=await pending;
 assert.deepEqual(selected.ask,raw);assert.deepEqual(selected.choices,[[1],[1]]);assert.deepEqual(selected.answers,[['追逐并攻击'],['可探索街区']]);assert.deepEqual(selected.selectionReasons,['explicit-file-response','explicit-file-response']);
 assert.equal(selected.responseReceipt.status,'consumed-not-submitted');assert.equal(Object.hasOwn(selected.responseReceipt,'deadlineAt'),false);
 assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(ticket.responseFile))).sort(),['choices','requestId','sessionId']);
 assert.ok(!fs.readdirSync(f.directory).some(name=>name.endsWith('.tmp')));
});
test('same question is published idempotently but each answer is consumed at most once',async t=>{
 const f=fixture(t),ticket=f.exchange.publish(ask(),'session-a');assert.equal(f.exchange.publish(ask(),'session-a'),ticket);
 writeFileClarificationResponse(f.directory,answer());assert.throws(()=>writeFileClarificationResponse(f.directory,answer()),/EEXIST/);
 await f.exchange.waitForResponse(ticket);await assert.rejects(f.exchange.waitForResponse(ticket),/ALREADY_CONSUMED/);assert.throws(()=>f.exchange.publish(ask(),'session-a'),/ALREADY_CONSUMED/);
 assert.throws(()=>createFileClarificationExchange({directory:f.directory}),/EEXIST/);
});
test('rejects arbitrary text, extra fields, stale or cross-session IDs and invalid indices',async t=>{
 for(const change of [a=>a.text='write code',a=>a.requestId='old',a=>a.sessionId='other',a=>a.choices=[[2],[0]],a=>a.choices=[[-1],[0]],a=>a.choices=[[0,1],[0]],a=>a.choices=[['play'],[0]],a=>a.choices=[[0]]]){
  const f=fixture(t),ticket=f.exchange.publish(ask(),'session-a'),raw=answer();change(raw);fs.writeFileSync(ticket.responseFile,JSON.stringify(raw));
  await assert.rejects(f.exchange.waitForResponse(ticket));assert.equal(fs.existsSync(ticket.receiptFile),false);assert.ok(fs.existsSync(ticket.responseFile));
 }
});
test('changed questions and forged tickets cannot route a response',async t=>{
 const f=fixture(t),ticket=f.exchange.publish(ask(),'session-a');
 assert.throws(()=>f.exchange.publish({...ask(),toolCallId:'different'},'session-a'),/QUESTION_CHANGED/);
 await assert.rejects(f.exchange.waitForResponse({...ticket,responseFile:path.join(f.root,'other.json')}),/TICKET_INVALID/);
 fs.appendFileSync(ticket.requestFile,' ');writeFileClarificationResponse(f.directory,answer());
 await assert.rejects(f.exchange.waitForResponse(ticket),/QUESTION_CHANGED/);
});
test('waiting ends on explicit cancellation and never submits a late answer',async t=>{
 const controller=new AbortController(),f=fixture(t,{signal:controller.signal}),ticket=f.exchange.publish(ask(),'session-a');
 const waiting=f.exchange.waitForResponse(ticket);controller.abort();await assert.rejects(waiting,/CANCELLED/);
 assert.equal(JSON.parse(fs.readFileSync(ticket.receiptFile)).status,'cancelled-not-submitted');
 assert.throws(()=>writeFileClarificationResponse(f.directory,answer()),/ALREADY_CONSUMED/);assert.throws(()=>f.exchange.publish({...ask(),requestId:'new'},'session-a'),/CANCELLED/);
});
test('oversized or incomplete files fail with finite errors and remain as evidence',async t=>{
 for(const bytes of ['{"sessionId":','x'.repeat(8193)]){const f=fixture(t),ticket=f.exchange.publish(ask(),'session-a');fs.writeFileSync(ticket.responseFile,bytes);await assert.rejects(f.exchange.waitForResponse(ticket),/INVALID_JSON|FILE_INVALID/);assert.equal(fs.readFileSync(ticket.responseFile,'utf8'),bytes);}
});
test('does not add a conversation request quota and rejects parent directory links',t=>{
 const f=fixture(t);for(let i=0;i<12;i++)f.exchange.publish({...ask(),requestId:'q-'+i},'session-a');
 const real=path.join(f.root,'real'),alias=path.join(f.root,'alias');fs.mkdirSync(real);fs.symlinkSync(real,alias,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>createFileClarificationExchange({directory:path.join(alias,'exchange')}),/DIRECTORY_LINK_DENIED/);
});
