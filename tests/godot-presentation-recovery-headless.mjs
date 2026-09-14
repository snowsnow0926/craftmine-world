// Actual retained world panel; fixed host gate fixture, no app/model/native GPU.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {showWorldTabScript} from './helpers/operator-show-world.mjs';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/presentation-recovery-'));
const report={checks:[],errors:[],scope:'Actual retained view and ordinary tab callback; finite host, no native gameplay claim'};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
await require('esbuild').build({entryPoints:[path.join(root,'plugins/craftmine-world/view.mjs')],outfile:path.join(out,'view.js'),bundle:true,platform:'browser',format:'iife',
  define:{CRAFTMINE_BOOT_WORLD:'{}',CRAFTMINE_GAME_DOCUMENT:'""',CRAFTMINE_INPUT_GUARD:'""'}});
fs.copyFileSync(path.join(root,'plugins/craftmine-world/world.html'),path.join(out,'index.html'));
const server=http.createServer((req,res)=>{const name=path.basename(req.url||'index.html'),file=path.join(out,name);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true,args:['--disable-gpu']});
  await browser.addInitScript(()=>{
    globalThis.__craftmineHeadless=true;globalThis.violations=[];
    window.focus=()=>violations.push('focus');Element.prototype.requestPointerLock=()=>{violations.push('pointer');throw Error('disabled');};
    const events={};
    globalThis.fixture={busy:false,manual:false,blocked:0,calls:[],surfaceVisible:true,saveError:null,surfaceError:null,
      record:{id:'world-one',title:'Tree world',revision:1,world:{build:{id:'old-build',engine:{kind:'godot-web'}},snapshot:{player:{z:6},trees:['tree_1']}}},
      runtime:{worldId:'world-one',buildId:'old-build',instanceId:'instance-old',state:'ready'},
      emit:(name,payload)=>events[name]?.(payload)};
    const register=EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener=function(type,listener,...options){
      if(this?.id==='save-world'&&type==='click')fixture.saveCallback=listener;
      return register.call(this,type,listener,...options);
    };
    globalThis.pluginBridge={on:(name,callback)=>events[name]=callback,invoke:async(channel,args={})=>{
      fixture.calls.push({channel,args});
      if(channel==='app.getAppearance')return {base:'dark'};
      if(channel==='world.list')return {worlds:[structuredClone(fixture.record)],activeWorldId:fixture.record.id};
      if(channel==='world.open'||channel==='world.read')return structuredClone(fixture.record);
      if(channel==='godot.runtimeState')return {...fixture.runtime};
      if(channel==='godot.candidateClose'){fixture.manual=false;fixture.busy=false;return {status:'closed'};}
      if(channel==='godot.candidatePreview'){if(fixture.busy)throw Error('GODOT_CANDIDATE_ACTIVE');fixture.manual=true;fixture.busy=true;return {status:'preview',worldId:args.worldId,candidateId:args.candidateId,buildId:'candidate-build'};}
      if(channel==='godot.candidateList')return {items:[],nextOffset:null};
      if(channel==='godot.runtimeSurface'||channel==='godot.runtimeResume'){
        if(fixture.busy){fixture.blocked++;throw Error("Error invoking remote method 'pi-plugin-panel-invoke': Error: GODOT_CANDIDATE_ACTIVE");}
        if(args.worldId!==fixture.record.id||fixture.runtime.worldId!==args.worldId||fixture.runtime.buildId!==fixture.record.world.build.id)throw Error('GODOT_WORLD_CHANGED');
        if(fixture.surfaceError)throw Error(fixture.surfaceError);
        if(channel==='godot.runtimeSurface')fixture.surfaceVisible=args.visible;
        fixture.emit('godot-world:state',{...fixture.runtime,state:fixture.surfaceVisible?'ready':'paused'});
        return {ok:true};
      }
      if(channel==='godot.runtimeSave'){if(fixture.saveError)throw Error(fixture.saveError);return {worldId:fixture.record.id,buildId:fixture.runtime.buildId,revision:fixture.record.revision,contentHash:'saved'};}
      if(channel==='godot.candidateApply')throw Error('UNEXPECTED_APPLICATION');
      return {};
    }};
  });
  const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true'&&fixture.calls.some(call=>call.channel==='godot.runtimeSurface'));
  const action=id=>page.evaluate(id=>{
    const button=document.getElementById(id);
    const callback=button.onclick||(id==='save-world'?fixture.saveCallback:null);
    if(typeof callback!=='function'||button.disabled)throw Error('ORDINARY_HANDLER_UNAVAILABLE');
    return callback();
  },id);
  const before=await page.evaluate(()=>({state:JSON.stringify(fixture.record.world.snapshot),closes:fixture.calls.filter(call=>call.channel==='godot.candidateClose').length}));
  await page.evaluate(()=>{fixture.busy=true;document.getElementById('checks-mode').onclick();document.getElementById('world-mode').onclick();});
  await page.waitForFunction(()=>fixture.blocked>0&&!document.getElementById('error').hidden);
  check('the real candidate gate refusal is visible while application is still blocked',await page.locator('#error').textContent().then(text=>text.endsWith('GODOT_CANDIDATE_ACTIVE')));
  const callsBeforeRelease=await page.evaluate(()=>fixture.calls.length);
  await page.evaluate(()=>{fixture.record.world.build.id='applied-build';fixture.runtime={...fixture.runtime,buildId:'applied-build',instanceId:'applied-instance'};fixture.busy=false;fixture.emit('godot-world:state',{...fixture.runtime});});
  await page.waitForFunction(()=>document.getElementById('error').hidden&&fixture.surfaceVisible);
  check('actual post-adoption presentation success clears its own obsolete error',await page.evaluate(count=>fixture.calls.length>count,callsBeforeRelease));
  const shown=await page.evaluate(showWorldTabScript('world-one'));assert.equal(shown.error,null);
  await page.evaluate(showWorldTabScript('world-one',true));
  await page.waitForFunction(()=>document.getElementById('world-mode').getAttribute('aria-selected')==='true'&&document.getElementById('checks-panel').hidden);
  check('ordinary show-world callback works without modifying build instance or progress',await page.evaluate(before=>fixture.runtime.buildId==='applied-build'&&fixture.runtime.instanceId==='applied-instance'&&JSON.stringify(fixture.record.world.snapshot)===before.state&&fixture.calls.filter(call=>call.channel==='godot.candidateClose').length===before.closes,before));
  await page.screenshot({path:path.join(out,'recovered-panel.png')});
  await page.evaluate(()=>{fixture.saveError='DISK_WRITE_FAILED';});await action('save-world');await page.waitForFunction(()=>document.getElementById('error').textContent==='DISK_WRITE_FAILED');
  const blocked=await page.evaluate(()=>fixture.blocked);
  await page.evaluate(()=>{fixture.busy=true;document.getElementById('world-mode').onclick();});
  await page.waitForFunction(count=>fixture.blocked>count,blocked);
  await page.evaluate(()=>{fixture.busy=false;fixture.emit('godot-world:state',{...fixture.runtime});});
  await page.waitForTimeout(100);
  check('busy presentation retries and their eventual success preserve a real save failure',await page.evaluate(()=>!document.getElementById('error').hidden&&document.getElementById('error').textContent==='DISK_WRITE_FAILED'));
  await page.evaluate(()=>{fixture.surfaceError='UNEXPECTED_SURFACE_FAILURE';document.getElementById('checks-mode').onclick();});
  await page.waitForFunction(()=>document.getElementById('error').textContent==='UNEXPECTED_SURFACE_FAILURE');
  const unknownCount=await page.evaluate(()=>fixture.calls.filter(call=>call.channel==='godot.runtimeSurface').length);await page.waitForTimeout(350);
  check('unknown presentation failures remain visible without a busy retry loop',await page.evaluate(count=>!document.getElementById('error').hidden&&fixture.calls.filter(call=>call.channel==='godot.runtimeSurface').length===count,unknownCount));
  await page.evaluate(()=>{fixture.surfaceError=null;fixture.saveError=null;});await action('save-world');
  await page.evaluate(()=>{fixture.busy=true;document.getElementById('world-mode').onclick();});await page.waitForFunction(()=>!document.getElementById('error').hidden);
  await page.evaluate(()=>{fixture.busy=false;});await page.evaluate(()=>craftmineView.preview('manual-candidate'));await page.waitForFunction(()=>fixture.manual&&document.body.dataset.previewLoaded==='true');
  const previewCalls=await page.evaluate(()=>fixture.calls.length);await page.waitForTimeout(350);
  check('a manually opened preview owns the controls and cancels background retries without being closed',await page.evaluate(count=>fixture.manual&&document.getElementById('world-mode').disabled&&fixture.calls.length===count,previewCalls));
  await action('close-preview');await page.waitForFunction(()=>!fixture.manual);
  check('only the ordinary user close action closes the manual preview',await page.evaluate(before=>fixture.calls.filter(call=>call.channel==='godot.candidateClose').length===before.closes+1,before));
  check('no model/application dispatch, OS focus, Pointer Lock or renderer exceptions',await page.evaluate(()=>!violations.length&&!fixture.calls.some(call=>call.channel==='godot.candidateApply'))&&!report.errors.length);
  report.passed=true;
}catch(error){report.error=String(error.stack??error);throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);}
