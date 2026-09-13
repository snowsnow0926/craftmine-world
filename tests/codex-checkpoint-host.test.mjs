import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'));
const out=await fs.mkdtemp(path.join(root,'test-results/codex-checkpoint-test-'));
await require('esbuild').build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/codex-checkpoint-host.ts')],outfile:path.join(out,'host.mjs'),bundle:true,platform:'node',format:'esm'});
const {CodexCheckpointHost,validateCodexCheckpoint}=await import(pathToFileURL(path.join(out,'host.mjs')));
test.after(()=>fs.rm(out,{recursive:true,force:true}));
const metadata=()=>({version:1,model:'gpt-6-astra',effort:'xhigh',threadId:'opaque-thread',toolDigest:'a'.repeat(64),submitted:true,synchronized:true});

test('only opaque model/thread/usage metadata is accepted',()=>{
  validateCodexCheckpoint(metadata());
  validateCodexCheckpoint({...metadata(),usageTotal:{inputTokens:7,outputTokens:3,totalTokens:10,cachedInputTokens:2,cacheWriteInputTokens:0,reasoningOutputTokens:1}});
  for(const extra of [{apiKey:'secret'},{messages:[]},{worldId:'foreign'},{model:'other'},{effort:'high'},{usageTotal:{inputTokens:-1}}])assert.throws(()=>validateCodexCheckpoint({...metadata(),...extra}),/CODEX_CHECKPOINT/);
});
test('Rust transcript and host binding own resume; stale/foreign identities never persist',async()=>{
  let binding={sessionId:'session',turnId:'turn-1',selectedWorld:'world',projectId:'project'},record;
  let messages=[{id:'user-1',role:'user',content:'tree'}];const saves=[],fences=[];
  const host=new CodexCheckpointHost({binding:(session,turn)=>binding&&binding.sessionId===session&&binding.turnId===turn?binding:undefined,
    drain:async()=>{},fence:async(...args)=>fences.push(args),call:async(method,params)=>{
      if(method==='session.get')return{session:{id:'session',projectPath:null,messages}};
      if(method==='session.codexCheckpointGet')return{checkpoint:record};
      if(method==='session.codexCheckpointSet'){saves.push(params);record=params.checkpoint;return{};}
      throw Error('unexpected '+method);
    }});
  const identity=()=>({sessionId:'session',turnId:binding.turnId});
  assert.equal((await host.invoke('codex.checkpoint.load',{...identity(),userMessageId:'user-1'})).checkpoint,undefined);
  messages.push({id:'assistant-1',role:'assistant',content:'actual result'});
  await host.invoke('codex.checkpoint.save',{...identity(),checkpoint:metadata()});
  assert.deepEqual(record.checkpoint,metadata());assert(!JSON.stringify(record).includes('actual result'));
  const savedBinding=binding;binding={...binding,turnId:'turn-2'};messages.push({id:'user-2',role:'user',content:'flowers'});
  const loaded=await host.invoke('codex.checkpoint.load',{...identity(),userMessageId:'user-2'});assert.equal(loaded.transcriptMatches,true);
  await assert.rejects(host.invoke('codex.checkpoint.save',{sessionId:'session',turnId:savedBinding.turnId,checkpoint:metadata()}),/ACTIVE_WORLD_TURN/);
  await assert.rejects(host.invoke('codex.checkpoint.load',{sessionId:'foreign',turnId:binding.turnId,userMessageId:'user-2'}),/ACTIVE_WORLD_TURN/);
  await assert.rejects(host.invoke('codex.checkpoint.load',{...identity(),userMessageId:'user-1'}),/USER_MESSAGE_NOT_CURRENT/);
  messages[1].content='canonical edited history';assert.equal((await host.invoke('codex.checkpoint.load',{...identity(),userMessageId:'user-2'})).transcriptMatches,false);
  binding={...binding,selectedWorld:'foreign'};await assert.rejects(host.invoke('codex.checkpoint.load',{...identity(),userMessageId:'user-2'}),/WORLD_SOURCE_BINDING_CHANGED/);
  assert.equal(saves.length,1);
  await host.invoke('codex.fence',{...identity(),status:'aborted'});assert.deepEqual(fences,[['session','turn-2','aborted']]);
});
test('asynchronous transcript drain cannot authorize a successor turn',async()=>{
  let binding={sessionId:'s',turnId:'t',projectId:'p',selectedWorld:'w'};let writes=0;
  const host=new CodexCheckpointHost({binding:()=>binding,drain:async()=>{binding={...binding,turnId:'new'};},
    fence:async()=>{},call:async(method)=>{if(method==='session.get')return{session:{messages:[]}};writes++;}});
  await assert.rejects(host.invoke('codex.checkpoint.save',{sessionId:'s',turnId:'t',checkpoint:metadata()}),/STALE_TURN/);assert.equal(writes,0);
});
