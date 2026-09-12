// Real status hook/observer/result component and the exact App ACK effect.
// The host deliberately rejects the initial read until its explicit ACK;
// recovery is driven by that ACK, not sleeps or model configuration.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import http from 'node:http';import {createRequire} from 'node:module';import {playwright,browserOptions} from '../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json')),out=fs.mkdtempSync(path.join(root,'test-results/creation-status-ack-'));
const app=fs.readFileSync(path.join(desktop,'src/App.tsx'),'utf8').replace(/\r\n/g,'\n');
const effect=app.match(/  useEffect\(\(\) => \{\n    let current = true;\n    const viewingSessionId = page === "chat"[\s\S]*?  \}, \[activeSessionId, page\]\);/)?.[0];
assert.ok(effect,'extract the actual App session-ack effect');
const entry=`import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import {api} from './src/lib/api';import {CraftmineCreationResult} from './src/components/CraftmineCreationResult';
globalThis.fixture={session:'empty-session',running:false,allowed:null,acks:[],reads:[],errors:[],phase:'idle',failure:null};
globalThis.__craftmineWorldBridge={invoke:async(_plugin,method,args)=>{
 if(method!=='godot.creationTaskStatus')throw Error('UNEXPECTED_METHOD');fixture.reads.push(args.sessionId);
 if(fixture.failure){fixture.errors.push(fixture.failure);throw Error(fixture.failure);}
 if(args.sessionId!==fixture.allowed){fixture.errors.push('CREATION_PLAYER_CONTEXT_CHANGED');throw Error('CREATION_PLAYER_CONTEXT_CHANGED');}
 return{sessionId:args.sessionId,worldId:'test-world',selectedWorldId:'test-world',phase:fixture.phase,requirementStatus:'not-requested',...(fixture.phase==='idle'?{}:{jobId:'job-one',candidateId:'candidate-one',buildId:'build-one'})};
},onChanged:()=>()=>{}};
function Parent(){const [version,setVersion]=useState(0);fixture.render=()=>setVersion(x=>x+1);const activeSessionId=fixture.session,page='chat';
${effect}
return <div data-version={version}><CraftmineCreationResult/></div>}
createRoot(document.getElementById('root')).render(<Parent/>);`;
await require('esbuild').build({stdin:{contents:entry,resolveDir:desktop,loader:'tsx'},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'controlled-host-ack',setup(build){
 build.onResolve({filter:/^(react|react-dom)(\/.*)?$/},args=>({path:require.resolve(args.path)}));
 build.onResolve({filter:/(^|\/)api$/},()=>({path:'api',namespace:'ack-host'}));
 build.onResolve({filter:/stores\/app-store$/},()=>({path:'store',namespace:'ack-host'}));
 build.onLoad({filter:/.*/,namespace:'ack-host'},({path:kind})=>({loader:'js',contents:kind==='api'?`export const api={setNotificationViewingSession:sessionId=>new Promise(resolve=>fixture.acks.push({sessionId,release:()=>{fixture.allowed=sessionId;resolve({ok:true});}})),pluginPanelInvoke:async()=>{throw Error('NO_MUTATIONS_IN_STATUS_TEST')}};`:`export const useAppStore=selector=>selector({activeSessionId:fixture.session,isRunning:fixture.running});useAppStore.getState=()=>({workPanelTabs:[]});`}));
}}]});
fs.writeFileSync(path.join(out,'index.html'),'<html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>');
const server=http.createServer((req,res)=>{const file=path.join(out,path.basename(req.url==='/'?'index.html':req.url));if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const report={out,checks:[],errors:[]};const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};let browser;
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true});
 await browser.addInitScript(()=>{globalThis.inputViolations=[];window.focus=()=>inputViolations.push('focus');Element.prototype.requestPointerLock=()=>{inputViolations.push('pointer');throw Error('disabled');};});
 const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 await page.waitForFunction(()=>fixture.errors.includes('CREATION_PLAYER_CONTEXT_CHANGED')&&fixture.acks.length===1);
 check('host really rejects the pre-ack read while the empty idle chat avoids a false result error',!await page.locator('.craftmine-creation-result').count());
 await page.evaluate(()=>fixture.acks[0].release());
 await page.waitForFunction(()=>fixture.reads.length===2);
 check('actual App ACK immediately re-reads the same session and yields idle without timers',await page.evaluate(()=>fixture.allowed==='empty-session'&&fixture.errors.length===1)&&!await page.locator('.craftmine-creation-result').count());
 await page.evaluate(()=>{fixture.phase='ready';window.dispatchEvent(new Event('craftmine-creation-edit-status'));});
 await page.waitForSelector('[data-phase="ready"]');
 await page.evaluate(()=>{fixture.failure='REAL_HOST_OFFLINE';window.dispatchEvent(new Event('craftmine-creation-edit-status'));});
 await page.waitForSelector('[data-phase="unavailable"]');
 check('an existing real job keeps its unavailable error instead of being silently hidden',await page.locator('.craftmine-creation-result').textContent().then(text=>text.includes('暂时无法读取')));
 await page.evaluate(()=>{fixture.failure=null;fixture.phase='idle';fixture.session='running-session';fixture.running=true;fixture.render();});
 await page.waitForFunction(()=>fixture.acks.length===2&&fixture.errors.filter(x=>x==='CREATION_PLAYER_CONTEXT_CHANGED').length>=2);
 check('running creation still reports real unavailability before acknowledgement',await page.locator('.craftmine-creation-result').textContent().then(text=>text.includes('正在重新连接')));
 const foreignNotification=await page.evaluate(()=>{const before=fixture.reads.length;window.dispatchEvent(new CustomEvent('craftmine-viewing-session-ready',{detail:{sessionId:'foreign-session'}}));return{before,after:fixture.reads.length};});
 assert.equal(foreignNotification.after,foreignNotification.before,'another session ACK must not refresh this observer');
 const reads=await page.evaluate(()=>fixture.reads.length);
 await page.evaluate(()=>fixture.acks[1].release());await page.waitForFunction(count=>fixture.reads.length===count+1,reads);
 check('foreign-session notification cannot authorize or replace the current session',await page.evaluate(()=>fixture.reads.at(-1)==='running-session'&&fixture.allowed==='running-session'));
 await page.evaluate(()=>{fixture.running=false;fixture.render();fixture.failure='PERSISTENT_HOST_ERROR';window.dispatchEvent(new Event('craftmine-creation-edit-status'));});
 await page.waitForSelector('[data-phase="unavailable"]');
 check('a real error after session acknowledgement remains visible even without a job',await page.locator('.craftmine-creation-result').isVisible());
 check('no input ownership changes or renderer exceptions',await page.evaluate(()=>inputViolations.length===0)&&report.errors.length===0);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
