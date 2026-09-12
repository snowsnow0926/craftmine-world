// Actual OS renderer memory + production sampler, independent offscreen process.
// This verifies the host metric, not a Godot world or player-scale benchmark.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const deps=process.env.CRAFTMINE_PERFORMANCE_DEPS||path.resolve('vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(deps,'package.json'));
fs.mkdirSync(path.resolve('test-results'),{recursive:true});
const out=fs.mkdtempSync(path.resolve('test-results/performance-electron-'));
await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../electron/main/craftmine-performance-sample.ts',import.meta.url))],outfile:path.join(out,'sample.cjs'),bundle:true,platform:'node',format:'cjs'});
fs.writeFileSync(path.join(out,'guard.cjs'),`require('electron').contextBridge.executeInMainWorld({func:()=>{Object.defineProperty(Element.prototype,'requestPointerLock',{value:()=>{throw Error('POINTER_LOCK_FORBIDDEN');},configurable:false,writable:false});}});`);
fs.writeFileSync(path.join(out,'main.cjs'),`
const {app,WebContentsView,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {createCraftminePerformanceSampler}=require('./sample.cjs');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
app.on('browser-window-created',()=>{throw Error('WINDOW_FORBIDDEN');});
app.whenReady().then(async()=>{
  const view=new WebContentsView({webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'guard.cjs')}});
  let inputEvents=0,focusEvents=0;
  view.webContents.on('before-input-event',()=>{inputEvents++;throw Error('INPUT_FORBIDDEN');});
  view.webContents.on('focus',()=>{focusEvents++;});
  view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  view.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  await view.webContents.loadURL('data:text/html,<html><body>isolated OS metric fixture</body></html>');
  const identity={worldId:'fixture-world',buildId:'fixture-build',instanceId:'fixture-instance'};
  let alive=true;
  const owner=()=>alive?{...identity,rendererProcessId:view.webContents.getOSProcessId(),webContentsId:view.webContents.id}:null;
  const sample=await createCraftminePerformanceSampler(owner,()=>app.getAppMetrics())(identity);
  assert.ok(Number.isFinite(sample.memoryWorkingSetMb)&&sample.memoryWorkingSetMb>0);
  assert.equal(sample.rendererProcessId,view.webContents.getOSProcessId());assert.equal(sample.measurementScope,'renderer-process');
  assert.equal(sample.frameTimeMs,undefined);assert.equal(sample.physicsStepMs,undefined);assert.equal(sample.objectCount,undefined);
  alive=false;assert.equal(await createCraftminePerformanceSampler(owner,()=>app.getAppMetrics())(),null);
  assert.equal(BrowserWindow.getAllWindows().length,0);assert.equal(inputEvents,0);assert.equal(focusEvents,0);
  const report={status:'passed',scope:'Production sampler and actual isolated Electron renderer OS metric; no Godot engine or player benchmark',sample,windows:0,inputEvents,focusEvents};
  fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(report,null,2));view.webContents.close();app.quit();
}).catch(error=>{fs.writeFileSync(path.join(__dirname,'error.txt'),String(error.stack||error));app.exit(1);});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(out,'main.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
const timeout=setTimeout(()=>child.kill(),30000);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timeout);
fs.writeFileSync(path.join(out,'process.log'),output);assert.equal(code,0,output);
const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));assert.equal(report.status,'passed');
console.log(JSON.stringify({out,report},null,2));
