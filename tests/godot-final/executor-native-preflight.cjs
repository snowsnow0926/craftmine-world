'use strict';
// Native engine preparation only: no project, model, job claim or registration.
const fs=require('node:fs'),path=require('node:path');
const {createGodotExecutor}=require('../../plugins/craftmine-world/godot-executor.cjs');
const runtime=process.env.CRAFTMINE_PREFLIGHT_RUNTIME;
if(!runtime||!path.isAbsolute(runtime))throw Error('Explicit host-owned runtime directory required');
const output=path.resolve(process.env.CRAFTMINE_PREFLIGHT_OUTPUT_ROOT||'test-results');
fs.mkdirSync(output,{recursive:true});
const directory=fs.mkdtempSync(path.join(output,'godot-native-preflight-'));
const dataPath=path.join(directory,'data');fs.mkdirSync(dataPath);
const messages=[];let registerReached=false;
const logger={log:(...args)=>record('log',args),warn:(...args)=>record('warn',args)};
function record(level,args){const value={at:new Date().toISOString(),level,args};messages.push(value);fs.appendFileSync(path.join(directory,'executor.log'),JSON.stringify(value)+'\n');console.log(JSON.stringify(value));}
const core={call:async method=>{if(method==='godotExecutor.register')registerReached=true;throw Error('Native preflight only; domain calls disabled: '+method);}};
const executor=createGodotExecutor(core,{dataPath,logger,toolchain:{broker:path.join(runtime,'broker/godot-host-broker.exe'),brokerIdentity:path.join(runtime,'broker/broker-identity.json'),engineRoot:path.join(runtime,'engine/4.7.2-stable'),toolchainLock:path.join(runtime,'toolchain.lock.json'),bridgePath:path.join(runtime,'web/bridge.js')}});
(async()=>{let status,error=null;try{status=await executor.start();}catch(e){error=String(e.stack||e);}finally{await executor.stop().catch(e=>record('stop-error',[String(e)]));}
 const report={format:'craftmine.native-preflight-diagnostic/1',directory,runtime,registerReached,status,error,messages};
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log('NATIVE_PREFLIGHT_REPORT '+path.join(directory,'report.json'));
 process.exitCode=registerReached&&status?.preflight?.processVerified===true&&status?.preflight?.networkVerified===true&&status?.preflight?.cleanupVerified===true?0:1;
})().catch(error=>{console.error(String(error.stack||error));process.exitCode=1;});
