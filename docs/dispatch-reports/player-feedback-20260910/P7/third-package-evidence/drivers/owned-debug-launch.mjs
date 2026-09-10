import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{spawn,execFileSync}from'node:child_process';import{setTimeout as delay}from'node:timers/promises';import{createHash}from'node:crypto';
export async function attachOwnedDebugger({child,executable,exeSha256,profile,output,env,record}){
 fs.mkdirSync(output);const helper='D:/cm-fb-p7-20260910/test-results/owned-debugger.ps1';record.helperSha256=createHash('sha256').update(fs.readFileSync(helper)).digest('hex');
 const creationTicks=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-Process -Id '+child.pid+').StartTime.ToUniversalTime().Ticks.ToString()'],{encoding:'utf8',windowsHide:true}).trim();
 const config=path.join(output,'debugger-config.json');fs.writeFileSync(config,JSON.stringify({pid:child.pid,parentPid:process.pid,creationTicks,executable,exeSha256,profile,output}));record.pid=child.pid;record.creationTicks=creationTicks;record.output=output;
 let attached=false;const debug=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Config',config],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});
 for(const stream of ['stdout','stderr'])debug[stream].on('data',b=>{fs.appendFileSync(path.join(output,stream+'.log'),b);if(b.toString().includes('ATTACHED pid='))attached=true;});
 const end=new Promise(resolve=>debug.once('close',(code,signal)=>{record.exit={code,signal};resolve();}));
 const deadline=Date.now()+20000;while(!attached){assert.ok(!record.exit,'DEBUGGER_CLOSED_BEFORE_ATTACH');assert.ok(Date.now()<deadline,'DEBUG_ATTACH_TIMEOUT');assert.equal(child.exitCode,null);await delay(50);}
 return {end};
}
