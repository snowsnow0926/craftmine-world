import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {stripTypeScriptTypes} from 'node:module';
import {assertCleanHeadlessShutdown} from './shutdown-exit-audit.mjs';

const clean=()=>({exit:{code:0},audit:{violations:[],pageErrors:[],shutdownFailures:[]}});
test('native exit audit refuses service timeout even when the OS exit code is zero',()=>{
  const launch=clean();launch.audit.shutdownFailures.push({service:'plugins',error:'PLUGIN_craftmine.world_CLOSE_TIMEOUT'});
  assert.throws(()=>assertCleanHeadlessShutdown(launch),/Owned shutdown is incomplete/);
  assertCleanHeadlessShutdown(clean());
});
test('native exit audit refuses missing shutdown evidence and preserves nonzero failure',()=>{
  const old=clean();delete old.audit.shutdownFailures;assert.throws(()=>assertCleanHeadlessShutdown(old));
  const crash=clean();crash.exit.code=2147483651;assert.throws(()=>assertCleanHeadlessShutdown(crash),/exit zero/);
});
test('real headless module exposes the same recorded failure in status and will-quit IPC',async()=>{
  const source=stripTypeScriptTypes(await fs.readFile(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
  const app=Object.assign(new EventEmitter(),{whenReady:()=>Promise.resolve(),getName:()=> 'test',getPath:()=> 'owned-profile'});
  const messages=[],proc=Object.assign(new EventEmitter(),{env:{CRAFTMINE_HEADLESS_TEST:'1'},connected:true,send:message=>messages.push(message),stderr:{write(){}}});
  const session={defaultSession:{registerPreloadScript(){},setPermissionRequestHandler(){},setPermissionCheckHandler(){}}};
  const api=vm.runInNewContext(source+'\n({configureHeadlessAcceptance,installHeadlessControl,recordHeadlessShutdownFailure})',{app,process:proc,session,BrowserWindow:{getAllWindows:()=>[]},dialog:{},shell:{},globalShortcut:{},Notification:class{},join:(...parts)=>parts.join('/'),__dirname:'owned',readHeadlessProfile:()=>({root:'owned',legacySource:'owned'}),console});
  api.configureHeadlessAcceptance();api.installHeadlessControl({window:()=>null,world:()=>null,runtime:()=>null});
  api.recordHeadlessShutdownFailure('godot-world',Error('GODOT_RENDERER_CLOSE_TIMEOUT'));
  proc.emit('message',{type:'craftmine-headless',id:'status-1',method:'status'});
  for(let i=0;i<12;i++)await Promise.resolve();
  app.emit('will-quit');
  const status=messages.find(x=>x.id==='status-1'),exit=messages.find(x=>x.type==='craftmine-headless-exit');
  assert.equal(status.result.shutdownFailures.length,1);assert.equal(exit.shutdownFailures.length,1);
  assert.equal(exit.shutdownFailures[0].service,'godot-world');assert.match(exit.shutdownFailures[0].error,/GODOT_RENDERER_CLOSE_TIMEOUT/);
  assert.throws(()=>assertCleanHeadlessShutdown({exit:{code:0},audit:JSON.parse(JSON.stringify(exit))}));
});
