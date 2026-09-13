// Real React forms in an isolated headless browser; fixture host is not native acceptance.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/world-brief-ui-'));
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {WorldBriefPanel} from './src/components/craftmine/WorldBriefPanel';
const f=window.fixture={calls:[],continued:[],world:'a',hold:false,revision:0,build:'v-one',entries:[],proposals:[],recentRequests:[]};
f.snapshot=()=>({worldId:f.world,formalBuildId:f.build,revision:f.revision,entries:f.entries,proposals:f.proposals,recentRequests:f.recentRequests,latestNativeCheck:{status:'passed',matchesFormalBuild:true}});
f.bridge={onChanged:callback=>{f.changed=callback;return()=>{};},call:async(channel,args)=>{if(channel!=='world.brief')throw Error('UNEXPECTED_CHANNEL');f.calls.push(args);if(args.action==='read'){const value=structuredClone(f.snapshot());if(f.hold)await new Promise(resolve=>f.release=resolve);return value;}if(args.worldId!==f.world||args.expectedRevision!==f.revision)throw Error('WORLD_BRIEF_REVISION_CONFLICT');if(args.action==='add')f.entries.push({id:'goal-'+f.revision,kind:args.kind,text:args.text,review:'not-reviewed'});if(args.action==='review')f.entries.find(e=>e.id===args.id).review=args.accepted?'player-accepted-current-build':'not-reviewed';if(args.action==='update'){const e=f.entries.find(e=>e.id===args.id);e.text=args.text;e.kind=args.kind;e.review='not-reviewed';}if(args.action==='remove')f.entries=f.entries.filter(e=>e.id!==args.id);f.revision++;return{worldId:f.world,status:'saved',revision:f.revision};}};
const app=createRoot(document.getElementById('root'));f.render=()=>app.render(<WorldBriefPanel key={f.world} worldId={f.world} bridge={f.bridge} zh onContinue={async text=>{f.continued.push(text);}}/>);f.render();`;
await require('esbuild').build({stdin:{contents:source,resolveDir:desktop,sourcefile:'world-brief-fixture.tsx',loader:'tsx'},bundle:true,jsx:'automatic',format:'esm',outfile:path.join(out,'fixture.js'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
fs.writeFileSync(path.join(out,'index.html'),'<link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
const report={checks:[],errors:[]};let browser;const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),args:['--allow-file-access-from-files']});
 await browser.addInitScript(()=>{globalThis.violations=[];window.focus=()=>violations.push('focus');Element.prototype.requestPointerLock=()=>{violations.push('pointer');throw Error('disabled');};});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.goto(pathToFileURL(path.join(out,'index.html')).href);await page.waitForFunction(()=>window.fixture&&document.querySelector('[data-world-brief]'));
 const wait=fn=>page.waitForFunction(fn,undefined,{timeout:5000});
 const action=label=>page.evaluate(label=>{const element=Array.from(document.querySelectorAll('button')).find(n=>n.textContent===label);if(!element||element.disabled)throw Error('ACTION_UNAVAILABLE');const props=element[Object.keys(element).find(k=>k.startsWith('__reactProps'))];props.onClick();},label);
 const field=text=>page.evaluate(text=>{const element=document.querySelector('textarea');element.value=text;element[Object.keys(element).find(k=>k.startsWith('__reactProps'))].onChange({target:element});},text);
 check('collapsed goals do not query the world',await page.evaluate(()=>fixture.calls.length===0));
 await page.evaluate(()=>{document.querySelector('[data-world-brief]').open=true;});await wait(()=>document.querySelector('[data-world-brief-add]'));
 check('native check is explicitly separate from player goal acceptance',await page.evaluate(()=>document.querySelector('[data-world-native-check]').textContent.includes('玩法目标另行试玩确认')));
 await field('让博美跟随并保留背包');await page.evaluate(()=>document.querySelector('[data-world-brief-add]').requestSubmit());await wait(()=>document.querySelector('[data-world-brief-goal]'));
 check('ordinary add preserves exact player text without fake acceptance',await page.evaluate(()=>fixture.entries[0].text==='让博美跟随并保留背包'&&document.body.innerText.includes('待试玩确认')));
 await action('继续这个目标');check('continue prepares original goal without sending a model turn',await page.evaluate(()=>fixture.continued.length===1&&fixture.continued[0].includes('让博美跟随并保留背包')&&fixture.calls.filter(c=>c.action==='add').length===1));
 await action('我已试玩并认可');await wait(()=>document.body.innerText.includes('你已认可本版'));
 check('explicit human review is bound to actual loaded formal build',await page.evaluate(()=>fixture.calls.find(c=>c.action==='review').buildId==='v-one'));
 await page.evaluate(()=>{fixture.build='v-two';fixture.entries[0].review='player-accepted-older-build';fixture.hold=true;fixture.changed();});await wait(()=>fixture.release&&!document.querySelector('[data-world-brief-goal]'));
 check('world change hides stale accepted-current status before async reload',await page.evaluate(()=>!document.body.innerText.includes('你已认可本版')));
 await page.evaluate(()=>{fixture.hold=false;fixture.release();});await wait(()=>document.body.innerText.includes('旧版已认可，本版待复查'));
 await action('编辑');await field('改成可等待的伙伴');await page.evaluate(()=>document.querySelector('[data-world-brief-add]').requestSubmit());await wait(()=>document.body.innerText.includes('改成可等待的伙伴')&&document.body.innerText.includes('待试玩确认'));
 check('changed requirement loses old acceptance',await page.evaluate(()=>fixture.entries[0].review==='not-reviewed'));
 await page.evaluate(()=>{fixture.world='b';fixture.entries=[];fixture.render();});await wait(()=>document.querySelector('[data-world-brief="b"]'));
 check('world switch remounts without old goals or unsent edit text',await page.evaluate(()=>!document.body.innerText.includes('改成可等待的伙伴')&&!document.querySelector('textarea')));
 check('no physical input, focus, pointer lock or page errors',await page.evaluate(()=>violations.length===0)&&report.errors.length===0);
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));}
