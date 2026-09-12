// Demonstrates debugger-induced focus contamination using hidden disposable
// Electron windows. No OS focus, input, pointer lock, or player profile access.
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {playwright} from '../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=fs.mkdtempSync(path.join(root,'test-results/cdp-focus-'));
const electron=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'))('electron');
const script=path.join(out,'main.cjs');
fs.writeFileSync(script,`const {app,BrowserWindow}=require('electron');app.setPath('userData',process.argv[2]);let win;
app.whenReady().then(async()=>{win=new BrowserWindow({show:false,focusable:false,width:400,height:300,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,backgroundThrottling:false}});await win.loadURL('data:text/html,<p>isolated focus check</p>');process.send({ready:true});});
process.on('message',async m=>{if(m==='quit'){win.destroy();app.quit();return;}if(m==='probe')process.send({probe:{document:await win.webContents.executeJavaScript('document.hasFocus()',false),native:win.isFocused(),visible:win.isVisible(),focusable:win.isFocusable()}});});`);
const report={out,cases:[]};
for(const noDefaults of [false,true]){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electron,[script,path.join(out,'profile-'+noDefaults),'--remote-debugging-port=0'],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
 let endpoint,ready=false,resolveProbe;
 child.stderr.on('data',bytes=>{endpoint??=bytes.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
 child.on('message',m=>{if(m.ready)ready=true;if(m.probe)resolveProbe?.(m.probe);});
 const exit=new Promise(resolve=>child.on('exit',resolve));
 const probe=()=>new Promise(resolve=>{resolveProbe=resolve;child.send('probe');});
 let browser;
 try{
  const deadline=Date.now()+20000;while(!endpoint||!ready){if(Date.now()>deadline)throw Error('STARTUP_TIMEOUT');await new Promise(r=>setTimeout(r,50));}
  const before=await probe();browser=await playwright().chromium.connectOverCDP(endpoint,{noDefaults});
  await browser.contexts()[0].pages()[0].evaluate(()=>document.readyState);
  const after=await probe();report.cases.push({noDefaults,before,after});
  assert.equal(before.document,false);assert.equal(after.document,!noDefaults);
  for(const value of [before,after]){assert.equal(value.native,false);assert.equal(value.visible,false);assert.equal(value.focusable,false);}
 }finally{child.send('quit');await exit;await browser?.close().catch(()=>{});}
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
