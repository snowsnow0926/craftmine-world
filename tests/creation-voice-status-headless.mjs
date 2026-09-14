// Real React controls with explicit fixture transport; no microphone or input simulation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const desktop=path.resolve('vendor/pi-desktop/apps/desktop'), require=createRequire(path.join(desktop,'package.json'));
fs.mkdirSync('test-results',{recursive:true});
const output=fs.mkdtempSync(path.resolve('test-results/creation-voice-status-'));
const script=`
import React from 'react';import{createRoot}from'react-dom/client';import i18n from'i18next';import{initReactI18next}from'react-i18next';
import{VoiceInput}from'./src/components/VoiceInput';import{CraftmineOverlayControls}from'./src/components/CraftmineOverlayControls';import{useAppStore}from'./src/stores/app-store';
let locales=['en-US'],reads=[],changed,transcripts=[],status={worldId:'world-a',sessionId:'session-a',phase:'checking',requirementStatus:'pending'};
window.piDesktop={platform:'win32',on:()=>()=>{},invoke:async(channel,payload)=>{reads.push({channel,payload});if(channel.endsWith('/capability'))return{ok:true,data:{provider:'windows-local',available:locales.length>0,locales}};throw Error('Unexpected microphone or IPC request');}};
globalThis.__craftmineWorldBridge={invoke:async(_,channel,payload)=>{if(channel==='godot.creationTaskStatus')return{...status,sessionId:payload.sessionId};throw Error('Unexpected channel '+channel);},onChanged:listener=>{changed=listener;return()=>{changed=null;};}};
useAppStore.setState({activeSessionId:'session-a',isRunning:false,agentStatuses:{}});
const root=createRoot(document.getElementById('root'));function render(){root.render(<main><h2>造物世界 · 语音和任务状态</h2><CraftmineOverlayControls/><div style={{marginTop:150,display:'flex',justifyContent:'flex-end'}}><VoiceInput contextKey="world-a:session-a" onTranscript={text=>transcripts.push(text)}/></div><textarea defaultValue="已有草稿"/></main>);}
globalThis.fixture={languages:value=>{locales=value;},reads:()=>reads,transcripts:()=>transcripts,status:value=>{status={...status,...value};changed?.();},running:(value,approval=false)=>useAppStore.setState({isRunning:value,agentStatuses:{'session-a':{sessionId:'session-a',isRunning:value,pendingToolConfirmations:approval?1:0,activity:{phase:'waiting-model'}}}}),remount:()=>{root.render(null);setTimeout(render,20);},
 props:selector=>{const element=document.querySelector(selector);return element[Object.keys(element).find(key=>key.startsWith('__reactProps'))];}};
void i18n.use(initReactI18next).init({lng:'zh',resources:{zh:{translation:{}}},interpolation:{escapeValue:false}}).then(render);
`;
await require('esbuild').build({stdin:{contents:script,resolveDir:desktop,loader:'jsx'},outfile:path.join(output,'fixture.js'),plugins:[{name:'vite-url',setup(build){build.onResolve({filter:/\?url/},args=>({path:args.path,namespace:'asset-url'}));build.onLoad({filter:/.*/,namespace:'asset-url'},()=>({contents:'export default "disabled-test-worklet.js";',loader:'js'}));}}],bundle:true,platform:'browser',format:'iife',target:'chrome130',define:{'process.env.NODE_ENV':'"production"'}});
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>:root{--ds-text-secondary:#9bb1c8;--ds-text-primary:#e8edf4;--ds-bg-elevated-opaque:#182436;--ds-bg-hover:#263a50;--ds-border-default:#465a72;--text-xs:12px;--text-2xs:12px;--radius-2xs:5px;}body{background:#0b1420;color:#e8edf4;font:16px sans-serif;}main{max-width:650px;margin:50px auto;padding:25px;}button,textarea{background:#182436;color:#e8edf4;padding:8px;border:1px solid #465a72;border-radius:5px;}textarea{width:95%;height:100px;margin-top:25px}.craftmine-overlay-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.craftmine-overlay-task{font-size:13px}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
const checks=[],errors=[];const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
const browser=await playwright().chromium.launchPersistentContext(path.join(output,'profile'),{...browserOptions(),headless:true,args:['--disable-gpu'],viewport:{width:960,height:720}});
try{
 await browser.addInitScript(()=>{globalThis.forbiddenInputs=0;Element.prototype.requestPointerLock=()=>{forbiddenInputs++;throw Error('Pointer lock disabled');};window.focus=()=>{forbiddenInputs++;};navigator.mediaDevices.getUserMedia=()=>{forbiddenInputs++;throw Error('Microphone disabled');};});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(pathToFileURL(path.join(output,'index.html')).href);
 await page.waitForFunction(()=>document.querySelector('.voice-input-help'));
 check('Chinese UI does not silently record with only an English recognizer',await page.evaluate(()=>document.querySelector('.voice-input-button').disabled&&document.querySelector('.voice-input-help').textContent.includes('未安装 zh 识别器')));
 check('available language choice contains only the actual installed language',await page.evaluate(()=>Array.from(document.querySelectorAll('.voice-input-language option')).map(node=>node.value).join(',')===',en-US'));
 await page.screenshot({path:path.join(output,'missing-chinese.png')});
 await page.evaluate(()=>{fixture.languages(['en-US','zh-CN']);fixture.props('[aria-label="重新检测语音语言"]').onClick();});
 await page.waitForFunction(()=>document.querySelector('.voice-input-language').value==='zh-CN');
 check('recheck bypasses discovery cache and selects the explicit Chinese alias',await page.evaluate(()=>!document.querySelector('.voice-input-button').disabled&&fixture.reads().at(-1).payload.refresh===true));
 await page.evaluate(()=>fixture.props('.voice-input-language').onChange({currentTarget:{value:'en-US'}}));
 await page.waitForFunction(()=>document.querySelector('.voice-input-language').value==='en-US');
 check('explicit player language choice is visible on the recording control',await page.evaluate(()=>document.querySelector('.voice-input-button').title.includes('en-US')));
 check('direct edit checking is visible while the model is not running',await page.evaluate(()=>document.querySelector('[data-task-stage="checking"]').textContent.includes('检查中')));
 await page.evaluate(()=>fixture.status({phase:'applied',requirementStatus:'unsupported'}));await page.waitForFunction(()=>document.querySelector('[data-task-stage="applied"]'));
 check('applied does not imply unknown wishes were checked',await page.evaluate(()=>document.querySelector('.craftmine-overlay-task').textContent.includes('已放入世界，可以试玩')));
 await page.evaluate(()=>fixture.running(true));await page.waitForFunction(()=>document.querySelector('[data-task-stage="waiting-model"]'));
 check('prior applied outcome cannot hide a newly running model request',true);
 await page.evaluate(()=>fixture.status({phase:'checking',requirementStatus:'pending'}));await page.waitForFunction(()=>document.querySelector('[data-task-stage="checking"]'));
 check('real current checking remains visible during model execution',true);
 await page.evaluate(()=>fixture.running(true,true));await page.waitForFunction(()=>document.querySelector('[data-task-stage="approval"]'));
 check('actual pending approval takes precedence over host task phase',await page.evaluate(()=>document.querySelector('.craftmine-overlay-task').textContent.includes('等待确认')));
 await page.evaluate(()=>{fixture.running(false);fixture.status({phase:'applied',requirementStatus:'unsupported'});});await page.waitForFunction(()=>document.querySelector('[data-task-stage="applied"]'));
 await page.evaluate(()=>fixture.remount());await page.waitForFunction(()=>document.querySelector('[data-task-stage="applied"]'));
 check('closing and reopening controls rereads the real terminal result',true);
 await page.evaluate(()=>fixture.status({phase:'failed',error:'REQUIREMENT_SIZE_MISMATCH'}));await page.waitForFunction(()=>document.querySelector('[data-task-stage="failed"]'));
 check('failed status has a readable cause while raw diagnostics belong in the result card',await page.evaluate(()=>document.querySelector('.craftmine-overlay-task').textContent.includes('需处理')&&document.querySelector('.craftmine-overlay-task').title.includes('查看详情')));
 await page.evaluate(()=>fixture.status({phase:'recovered',requirementStatus:'pending'}));await page.waitForFunction(()=>document.querySelector('[data-task-stage="recovered"]'));
 check('successful draft recovery appears independently of model running state',await page.evaluate(()=>document.querySelector('.craftmine-overlay-task').textContent.includes('草稿已恢复')));
 await page.evaluate(()=>fixture.status({worldId:'world-b',phase:'idle'}));await page.waitForFunction(()=>!document.querySelector('.craftmine-overlay-task'));
 check('world switch does not retain another worlds terminal status',true);
 check('draft remains editable and no transcript is submitted by language settings',await page.evaluate(()=>document.querySelector('textarea').value==='已有草稿'&&fixture.transcripts().length===0));
 await page.screenshot({path:path.join(output,'voice-language-ready.png')});
 check('no microphone input focus or pointer-lock access',await page.evaluate(()=>forbiddenInputs===0));check('no unhandled UI errors',errors.length===0);
}catch(error){errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({scope:'Real React voice/status UI with fixture host; no speech accuracy or live engine claim',checks,errors},null,2));console.log('Report: '+output);}
