// Protocol fault injection only: real packaged Electron/agent/Core, local SSE.
// No commercial model requests, source patches, physical inputs or focus.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{spawn}from'node:child_process';import{randomUUID,createHash}from'node:crypto';import{DatabaseSync}from'node:sqlite';import{setTimeout as delay}from'node:timers/promises';
import{playwright}from'../app/browser-tools.mjs';import{loadPackageAsar}from'../desktop/package-asar.mjs';import{startInterruptibleProvider,PARTIAL_TEXT}from'./helpers/interruptible-provider.mjs';
const pack=path.resolve(process.argv[2]??'.'),live=process.argv.includes('--run');
if(!live){console.log(JSON.stringify({mode:'prepare-only',command:'node tests/quit-midresponse-native.mjs APP_DIR --run',scope:'local deterministic SSE; actual agentPrompt and nativeMenuAction quit; no real-model capability claim',nativeStarted:false}));process.exit(0);}
assert.ok(fs.existsSync(path.join(pack,'Craftmine World.exe')),'packaged APP_DIR required');
const asar=loadPackageAsar(path.resolve('vendor/pi-desktop/apps/desktop')),main=asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: isOffscreenAcceptance()','createTurnTerminalOutcomes','resumeInterrupted: true'])assert.ok(main.includes(guard),'PACKAGE_GUARD_MISSING:'+guard);
fs.mkdirSync('D:/CMR',{recursive:true});const runRoot=fs.mkdtempSync('D:/CMR/quit-protocol-'),directory=path.join(runRoot,'test-results/desktop-native-a'),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(profile);fs.mkdirSync(legacy);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const report={directory,profile,package:pack,mainSha256:createHash('sha256').update(main).digest('hex'),scope:'offscreen native protocol fault injection, fresh Web world, no real model or Godot gameplay claim',checks:[],launches:[],providerRequests:[]};
const write=()=>fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
const until=async(read,accept)=>{const end=Date.now()+120000;while(Date.now()<end){const result=await read();if(accept(result))return result;await delay(100);}throw Error('PROTOCOL_STATE_TIMEOUT');};
const check=name=>{report.checks.push(name);write();console.log('PASS '+name);};
const provider=await startInterruptibleProvider();let active;
async function launch(label){
 const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_HEADLESS_TOKEN:token,CRAFTMINE_DATA_DIR:profile};
 for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|CRAFTMINE_(CREATION|EVAL|TEST_|P8_)|PI_DESKTOP_(SEED_WORKSPACE|WORKSPACE|CAPTURE|BOOT_PROBE))/.test(key))delete env[key];
 const child=spawn(path.join(pack,'Craftmine World.exe'),['--inspect=0','--remote-debugging-port=0'],{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']}),record={label};report.launches.push(record);let chrome,node,ready=false,exited=false,socket,browser;
 const log=fs.createWriteStream(path.join(directory,label+'.log'));child.stdout.pipe(log,{end:false});child.stderr.on('data',bytes=>{log.write(bytes);chrome??=String(bytes).match(/DevTools listening on (ws:\/\/\S+)/)?.[1];node??=String(bytes).match(/Debugger listening on (ws:\/\/\S+)/)?.[1];});
 child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')record.audit=message;});
 const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;record.exit={code,signal};resolve();}));
 const stop=async()=>{socket?.close();if(!exited){if(child.connected)child.send({type:'craftmine-headless',id:randomUUID(),method:'quit'});await Promise.race([exit,delay(30000,undefined,{ref:false})]);if(!exited){record.forced=true;child.kill();await exit;}}await browser?.close().catch(()=>{});log.end();write();};
 try{
  await until(async()=>{if(exited)throw Error('APP_EARLY_EXIT');return ready&&chrome&&node;},Boolean);
  socket=new WebSocket(node);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});let id=0;const pending=new Map();socket.onmessage=event=>{const data=JSON.parse(event.data),job=pending.get(data.id);if(!job)return;pending.delete(data.id);data.error||data.result?.exceptionDetails?job.reject(Error(JSON.stringify(data))):job.resolve(data.result.result.value);};
  const inspect=expression=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
  browser=await playwright().chromium.connectOverCDP(chrome,{noDefaults:true});const page=await until(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html')),Boolean);
  await page.waitForFunction(()=>!!window.piDesktop&&!!document.querySelector('#root')?.children.length,undefined,{polling:50});
  record.native=await inspect(`(()=>{const e=process.mainModule.require('electron');if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)})throw Error('PROFILE_MISMATCH');const w=e.BaseWindow.getAllWindows();if(!w.length||w.some(x=>x.isVisible()||x.isFocusable()))throw Error('INPUT_OWNERSHIP');return w.map(x=>({visible:x.isVisible(),focusable:x.isFocusable()}));})()`);
  const api=(name,...args)=>page.evaluate(async({name,args})=>{const channel=piDesktop.channels?.invoke?.[name];if(!channel)throw Error('MISSING_CHANNEL:'+name);const result=await piDesktop.invoke(channel,...args);if(!result.ok)throw Error(result.error?.message??'IPC_FAILED');return result.data;},{name,args});
  const panel=(channel,payload={})=>page.evaluate(({channel,payload})=>piDesktop.pluginPanelInvoke('craftmine.world',channel,payload),{channel,payload});
  return {api,panel,stop,record,quit:async()=>{socket.close();await api('nativeMenuAction',{action:'quit'}).catch(error=>{if(!exited&&!/closed|destroyed/.test(String(error)))throw error;});await until(async()=>exited,Boolean);await stop();assert.equal(record.exit.code,0);assert.equal(record.forced,undefined);for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(record.audit?.[key],[]);}};
 }catch(error){await stop();throw error;}
}
function durable(sessionId){
 const host=new DatabaseSync(path.join(profile,'pi.sqlite'),{readOnly:true}),domain=new DatabaseSync(path.join(profile,'plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});
 try{return {turns:host.prepare('SELECT id,status,error_code FROM turns WHERE session_id=? ORDER BY started_at,rowid').all(sessionId),ended:domain.prepare('SELECT turn_id,status FROM craftmine_ended_turns WHERE session_id=?').all(sessionId),task:domain.prepare('SELECT t.id,t.binding,t.status,t.draft,t.draft_hash,s.world_id,r.generation,r.budget_owner,r.recovery FROM craftmine_session_worlds s JOIN craftmine_tasks t ON t.id=s.head_task LEFT JOIN craftmine_task_runtime r ON r.task_id=t.id WHERE s.session_id=?').get(sessionId)};}finally{host.close();domain.close();}
}
try{
 active=await launch('stream-and-quit');
 const p=await active.api('providersCreate',{name:'Local protocol interruption fixture',vendorKey:'custom',protocol:'openai_compatible',type:'openai_compatible',baseUrl:provider.url,authKind:'api_key_and_base_url',secretValue:'local-fixture-not-a-secret',apiStyle:'chat_completions',defaultModelId:'protocol-interruption-fixture',models:[{id:'protocol-interruption-fixture',contextWindow:128000,maxTokens:16384,supportsReasoning:false,thinkingLevels:['off'],defaultThinkingLevel:'off',supportsImages:false,supportsDocuments:false}]});
 const settings=await active.api('settingsGet');await active.api('settingsSet',{...settings,defaultProviderId:p.provider.id,defaultModelId:'protocol-interruption-fixture',defaultMode:'agent',defaultPermissionMode:'auto'});
 const world=await active.panel('world.create',{title:'Protocol save/exit fixture',baseId:'craftmine-web/5',starterId:'blank',operationId:randomUUID()});report.worldId=world.id??world.record?.id;assert.ok(report.worldId);
 const created=await active.api('sessionCreate',{title:'Protocol interruption only',mode:'agent',permissionMode:'auto',providerId:p.provider.id,modelId:'protocol-interruption-fixture',thinkingLevel:'off'}),sessionId=created.session.id;report.sessionId=sessionId;
 await active.api('agentPrompt',{sessionId,content:'Protocol fixture. Return the fixture response without tools.',viewingSessionId:sessionId});
 await until(async()=>provider.requests.length,Boolean);
 // session.get intentionally omits live checkpoints. Read the actual persisted
 // streaming record without promoting it or manufacturing a message_end.
 report.streamingCheckpoint=await until(async()=>{const file=path.join(profile,'sessions',sessionId+'.inflight.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;},value=>value?.sessionId===sessionId&&value.message.role==='assistant'&&JSON.stringify(value.message.blocks).includes(PARTIAL_TEXT));
 report.beforeQuit=durable(sessionId);assert.equal(report.beforeQuit.turns.at(-1).status,'running');assert.equal(provider.requests[0].finished,false);
 assert.equal(report.streamingCheckpoint.turnId,report.beforeQuit.turns.at(-1).id);
 await active.quit();active=null;report.afterQuit=durable(sessionId);const turn=report.afterQuit.turns.at(-1);
 assert.equal(turn.status,'aborted');assert.equal(turn.error_code,'APP_SHUTDOWN_INTERRUPTED');assert.equal(report.afterQuit.ended.find(x=>x.turn_id===turn.id).status,'aborted');assert.equal(report.afterQuit.task.status,'cancelled');assert.equal(report.afterQuit.task.recovery,'interrupted');check('mid-response native menu Save Exit persists an aborted turn and interrupted draft, never completed');
 provider.finishFuture();active=await launch('resume-and-finish');const retained=await active.api('sessionGet',sessionId);assert.ok(retained.session.messages.some(m=>m.role==='assistant'&&m.content.includes(PARTIAL_TEXT)));check('partial assistant text survives actual app shutdown and restart');
 report.interruptedMetrics=await active.api('sessionTurnMetrics',{sessionId,turnId:turn.id});
 assert.equal(report.interruptedMetrics.sessionId,sessionId);assert.equal(report.interruptedMetrics.turnId,turn.id);assert.equal(report.interruptedMetrics.status,'aborted');
 await active.api('agentPrompt',{sessionId,content:'Continue the same preserved draft with the fixture response.',viewingSessionId:sessionId});
 const settled=await until(async()=>durable(sessionId).turns,value=>value.length>report.afterQuit.turns.length&&value.at(-1).status!=='running');
 report.resumed=durable(sessionId);report.resumedMetrics=await active.api('sessionTurnMetrics',{sessionId,turnId:settled.at(-1).id});write();assert.equal(settled.at(-1).status,'completed','ordinary continuation must complete, not fail before reaching the provider');
 report.resumed=durable(sessionId);assert.notEqual(report.resumed.task.id,report.afterQuit.task.id);assert.equal(report.resumed.task.budget_owner,report.afterQuit.task.budget_owner);assert.ok(report.resumed.task.generation>report.afterQuit.task.generation);assert.equal(report.resumed.task.draft_hash,report.afterQuit.task.draft_hash);assert.deepEqual(JSON.parse(report.resumed.task.draft),JSON.parse(report.afterQuit.task.draft));assert.equal(report.resumed.task.world_id,report.worldId);assert.equal(report.resumed.turns.find(x=>x.id===turn.id).status,'aborted');assert.ok(provider.requests.some(x=>x.number>1&&x.finished));check('ordinary new-message prompt resumes the preserved task budget and draft, then finishes normally');
 await active.quit();active=null;report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{if(active)await active.stop();report.providerRequests=provider.requests;await provider.close();write();console.log(JSON.stringify({directory,passed:report.passed,error:report.error}));}
