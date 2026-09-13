#!/usr/bin/env node
// Trusted host entry. Model-authored code executes only in native domain brokers.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {CodexAppServer,MODEL,EFFORT,CLI_VERSION,redact,processEnvironment} from './lib/codex-app-server.mjs';
import {CodexWorldHost} from './lib/codex-world-host.mjs';
import {CodexWorldSession,STATE_FORMAT,readState,writeState,acquireLock} from './lib/codex-world-session.mjs';

const HELP=`Craftmine opt-in Codex author (project CLI; not the desktop composer)

  init   --data DIR --runtime WIN_UNPACKED --plugin BUILT_PLUGIN --world ID
  turn   --data DIR --codex CODEX_EXE --prompt TEXT [--services HOST_MODULE]
  doctor --data DIR --codex CODEX_EXE [--services HOST_MODULE]
  cancel --data DIR
  status --data DIR

init creates the shipped blank Godot source in a new independent Rust store.
turn preserves the same world, session and Codex thread. Exact model:
gpt-6-astra / xhigh. Existing Codex ChatGPT login is used without copying tokens.
Events stream as JSONL and are recorded under DIR/events.jsonl.
cancel requests a durable native fence and drains workers in the running entry.
doctor starts a no-model protocol preflight and reports native capabilities.
An optional trusted services module exports createServices({core,state,data});
it supplies existing host verifier/toolServices, not author-accessible code.
Source/build/check/application remain distinct. Default CLI has no live view,
player target, check verifier or automatic adoption. No UI is opened.
`;

function options(argv) {
  const [mode,...rest]=argv,values={};
  if(!['init','turn','doctor','cancel','status'].includes(mode))throw Error(HELP);
  const allowed={init:['--data','--runtime','--plugin','--world'],turn:['--data','--codex','--prompt','--services'],
    doctor:['--data','--codex','--services'],cancel:['--data'],status:['--data']}[mode];
  for(let i=0;i<rest.length;i+=2) {
    const key=rest[i],value=rest[i+1];
    if(!allowed.includes(key)||value===undefined||values[key]!==undefined)throw Error(HELP);
    values[key]=value;
  }
  if(!values['--data'])throw Error(HELP);
  return {mode,values,data:path.resolve(values['--data'])};
}
async function verifyCli(binary,cwd) {
  if(!path.isAbsolute(binary))throw Error('ABSOLUTE_CODEX_PATH_REQUIRED');
  const child=spawn(binary,['--version'],{cwd,env:processEnvironment(),windowsHide:true,shell:false,stdio:['ignore','pipe','ignore']});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;});
  const code=await new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('CODEX_BINARY_UNAVAILABLE')));child.once('close',resolve);});
  if(code!==0||output.trim()!==CLI_VERSION)throw Error('CODEX_VERSION_UNSUPPORTED: expected '+CLI_VERSION);
}
const emit=event=>process.stdout.write(JSON.stringify(redact(event))+'\n');

export async function main(argv=process.argv.slice(2)) {
  if(argv.includes('--help')) {process.stdout.write(HELP);return;}
  const {mode,values,data}=options(argv);
  if(mode==='init') {
    if(!values['--runtime']||!path.isAbsolute(values['--runtime'])||!values['--plugin']||!path.isAbsolute(values['--plugin'])||!/^[a-z0-9][a-z0-9-]{1,47}$/.test(values['--world']??''))throw Error(HELP);
    // Exclusive creation prevents accidental replacement of an existing store.
    fs.mkdirSync(data);fs.mkdirSync(path.join(data,'empty'));
    const state={format:STATE_FORMAT,model:MODEL,effort:EFFORT,worldId:values['--world'],
      projectId:'codex-world-'+randomUUID(),sessionId:'codex-'+randomUUID(),runtime:path.resolve(values['--runtime']),
      coreData:path.join(data,'core'),pluginRoot:path.resolve(values['--plugin']),threadId:null,active:null};
    const host=new CodexWorldHost({state,data});
    try {
      await host.start({engines:false});state.sourceIdentity=await host.initializeBlank();writeState(data,state);
      emit({status:'source-initialized',data,worldId:state.worldId,sourceIdentity:state.sourceIdentity,applied:false,playableVerified:false});
    } finally {await host.stop();}
    return;
  }
  const state=readState(data);
  if(mode==='cancel') {
    if(!state.active) {emit({status:'idle'});return;}
    fs.writeFileSync(path.join(data,'cancel.json'),JSON.stringify({turnId:state.active.context.turnId}));
    emit({status:'cancellation-requested',turnId:state.active.context.turnId});return;
  }
  if(mode==='status') {emit(state);return;}
  if(!values['--codex'])throw Error(HELP);
  const unlock=acquireLock(data);let host,client,session,poll,services;
  const cancel=()=>{if(session?.active)void session.cancel().catch(()=>{});else void client?.close();};
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  try {
    await verifyCli(values['--codex'],path.join(data,'empty'));
    host=new CodexWorldHost({state,data});
    if(values['--services']) {
      const module=await import(pathToFileURL(path.resolve(values['--services'])).href);
      services=await module.createServices({core:host.core,state:structuredClone(state),data});
      host=new CodexWorldHost({state,data,core:host.core,services});
    }
    await host.start();
    client=new CodexAppServer({binary:values['--codex'],cwd:path.join(data,'empty')});
    session=new CodexWorldSession({data,state,host,client,onEvent:emit});
    await session.connect({preflight:mode==='doctor'});
    if(mode==='doctor') {
      emit({status:'protocol-ready',model:MODEL,effort:EFFORT,cliVersion:CLI_VERSION,modelTurnStarted:false,
        sourceIdentity:await host.sourceIdentity(),godot:host.executor.status(),blender:await host.blender.status()});
    } else {
      if(!values['--prompt'])throw Error(HELP);
      poll=setInterval(()=>{
        try {
          const request=JSON.parse(fs.readFileSync(path.join(data,'cancel.json'),'utf8'));
          if(request.turnId===session.active?.context.turnId&&!session.active.cancelled)void session.cancel().catch(()=>{});
        } catch(error) {if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))emit({status:'diagnostic',code:'CANCEL_FILE_UNREADABLE'});}
      },250);
      const result=await session.run(values['--prompt']);
      if(result.status!=='completed')process.exitCode=result.status==='aborted'?130:1;
    }
  } finally {
    clearInterval(poll);
    process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
    try {await client?.close();} finally {
      try {await host?.stop();} finally {try{await services?.stop?.();}finally{unlock();}}
    }
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{emit({status:'error',code:redact(error.message),diagnostic:error.diagnostic??null});process.exitCode=1;});
}
