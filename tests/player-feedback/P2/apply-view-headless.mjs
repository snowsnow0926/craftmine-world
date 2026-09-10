// Actual plugin HTML/modules in isolated headless Chromium. The bridge and
// iframe protocol are finite fixtures: this is NOT Godot/Core/model acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {playwright,browserOptions} from '../../../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const out=path.join(root,'test-results','p2-apply-view-'+Date.now());await fs.mkdir(out,{recursive:true});
const report={format:'craftmine.p2-apply-view/1',native:false,limits:['Actual product DOM and view module; finite fixture bridge and game protocol','No actual Godot/Core/model or player input','Restart means page reload against retained fixture state, not OS restart'],checks:[],errors:[]};
const check=(name,actual)=>{report.checks.push({name,passed:!!actual});assert.ok(actual,name);console.log('PASS '+name);};
const game=`<script>const nonce='__CRAFTMINE_NONCE__';let snapshot={savedAt:'2026-01-01',coins:17},build;const emit=x=>parent.postMessage({channel:'craftmine-game/1',nonce,...x},'*');addEventListener('message',e=>{const m=e.data;if(m?.nonce!==nonce)return;if(m.type==='load'){build=m.build;snapshot=m.snapshot;emit({type:'loaded',version:build.id});}if(m.type==='snapshot')emit({type:'snapshot',requestId:m.requestId,snapshot});});emit({type:'ready'});<\/script>`;
const fixture=`
globalThis.__craftmineHeadless=true;globalThis.CRAFTMINE_INPUT_GUARD='';globalThis.CRAFTMINE_GAME_DOCUMENT=${JSON.stringify(game).replaceAll('<','\\u003c')};globalThis.CRAFTMINE_BOOT_WORLD={};
const mode=new URL(location.href).searchParams.get('kind')||'voxel';
const base={id:'alpha',title:'Fixture',revision:1,world:{build:{id:'formal-1',scene:{title:'Fixture'},...(mode==='godot'?{engine:{kind:'godot-web'}}:{})},snapshot:{savedAt:'2026-01-01',coins:17}}};
globalThis.fixture={calls:[],review:{id:'review-1',current:true,status:'completed',acceptance:{passed:true}},reviewFailure:null,hold:null,lostReply:false,recoveryFailure:false};
let record=JSON.parse(sessionStorage.getItem('formal-'+mode)||JSON.stringify(base));
const persist=()=>sessionStorage.setItem('formal-'+mode,JSON.stringify(record));
const applied=new Map();let godotApplied=null;
fixture.record=()=>structuredClone(record);
globalThis.pluginBridge={on(){},async invoke(channel,args={}){
fixture.calls.push({channel,args:structuredClone(args)});
if(channel==='app.getAppearance')return {base:'dark'};
if(channel==='world.list')return {worlds:[{id:record.id,title:record.title}],activeWorldId:record.id};
if(channel==='world.open')return structuredClone(record);
if(channel==='workbench.capabilities')return {channels:[]};
if(channel==='world.saveProgress'){record={...record,revision:record.revision+1,world:{...record.world,snapshot:structuredClone(args.snapshot)}};persist();return structuredClone(record);}
if(channel==='verification.preview')return {world:{...structuredClone(record.world),build:{id:args.id,scene:{title:'Draft'}}},job:{id:args.id,summary:'Draft',current:true}};
if(channel==='verification.list')return [];
if(channel==='review.list'){if(fixture.hold)return await new Promise((resolve,reject)=>{fixture.pending={resolve,reject};});if(fixture.reviewFailure)throw Error(fixture.reviewFailure);return fixture.review?[structuredClone(fixture.review)]:[];}
if(channel==='review.cancel'){fixture.review.status='cancelled';return {};}
if(channel==='review.start'){fixture.review.status='running';return {};}
if(channel==='candidate.apply'){
 if(args.reviewId!==fixture.review.id||fixture.review.current!==true)throw Error('STALE_REVIEW');
 record={...record,revision:record.revision+1,world:{...record.world,build:{id:args.verificationId,scene:{title:'Draft'}}}};persist();
 const result={status:'applied',record:structuredClone(record)};applied.set(args.operationId,result);if(fixture.lostReply)throw Error('fixture lost reply');return result;
}
if(channel==='candidate.applicationState'){if(fixture.recoveryFailure)throw Error('receipt temporarily unavailable');return applied.get(args.operationId)||{status:'aborted'};}
if(channel==='godot.candidateClose')return {status:'closed'};
if(channel==='godot.runtimeState')return {worldId:record.id,buildId:record.world.build.id,instanceId:'fixture-instance',state:'ready'};
if(channel==='godot.runtimeSurface'||channel==='godot.runtimeResume')return {};
if(channel==='godot.candidatePreview')return {status:'preview',buildId:args.candidateId};
if(channel==='godot.candidateApply'){if(fixture.rejectBeforeApply)throw Error('WORLD_BUSY');record={...record,revision:record.revision+1,world:{...record.world,build:{...record.world.build,id:args.candidateId}}};persist();godotApplied={status:'applied',record:structuredClone(record)};if(fixture.lostReply)throw Error('fixture lost reply');return godotApplied;}
if(channel==='godot.candidateState'){if(fixture.recoveryFailure)throw Error('receipt temporarily unavailable');if(fixture.rejectBeforeApply)return {status:'preview',worldId:fixture.wrongPreviewIdentity?'another-world':args.worldId,candidateId:args.candidateId};return godotApplied||{status:'closed'};}
throw Error('Unexpected fixture channel '+channel);
}};
`;
// This finite game/bootstrap fixture requires inline scripts. Do not edit the
// product CSP or treat this harness as a package CSP/security acceptance test.
const html=(await fs.readFile(path.join(root,'plugins/craftmine-world/world.html'),'utf8')).replace("script-src 'self'","script-src 'self' 'unsafe-inline'").replace('<script src="view.js" defer></script>','');
report.limits.push('Fixture HTML permits inline bootstrap/game scripts; product CSP is unchanged');
report.sourceHashes={};for(const file of ['world.html','view.mjs','apply-presentation.mjs'])report.sourceHashes[file]=createHash('sha256').update(await fs.readFile(path.join(root,'plugins/craftmine-world',file))).digest('hex');
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html.replace('</head>','<script>'+fixture+'</script><script type="module" src="/view.mjs"></script></head>'));}if(/^\/[a-z0-9-]+\.mjs$/.test(url.pathname)){res.setHeader('Content-Type','text/javascript');return res.end(await fs.readFile(path.join(root,'plugins/craftmine-world',url.pathname.slice(1))));}res.writeHead(404).end();}catch(e){res.writeHead(500).end(String(e));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser-profile'),browserOptions());
 await browser.addInitScript(()=>{globalThis.inputGuards={pointer:0,focus:0};Element.prototype.requestPointerLock=function(){inputGuards.pointer++;throw Error('Pointer lock prohibited');};window.focus=()=>{inputGuards.focus++;};});
 const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
 const goto=async kind=>{await page.goto('http://127.0.0.1:'+server.address().port+'/?kind='+kind);await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true'&&!document.getElementById('save-world').disabled);};
 const state=()=>page.evaluate(()=>({reason:document.getElementById('apply-explanation').dataset.reason,text:document.getElementById('apply-explanation').textContent,disabled:document.getElementById('apply-world').disabled,warningsHidden:document.getElementById('apply-world-warnings').hidden,warningsDisabled:document.getElementById('apply-world-warnings').disabled}));
 const refresh=async()=>{await page.evaluate(()=>document.getElementById('refresh-apply-state').onclick());await page.waitForFunction(()=>!document.getElementById('refresh-apply-state').disabled);};
 const submit=async warning=>{await page.evaluate(warning=>document.getElementById('apply-form').requestSubmit(document.getElementById(warning?'apply-world-warnings':'apply-world')),warning);};
 await goto('voxel');const before=await page.evaluate(()=>fixture.record().world.snapshot);
 await page.evaluate(()=>craftmineView.preview('draft-1'));
 check('Current passed review permits normal application',(await state()).disabled===false);
 for(const [value,code] of [[null,'review-missing'],[{current:false,status:'completed',acceptance:{passed:true}},'stale'],...['running','failed','cancelled','interrupted'].map(status=>[{current:true,status,acceptance:{passed:true}},'review-'+status]),[{current:true,status:'completed'},'review-incomplete']]){
  await page.evaluate(value=>{fixture.review=value},value);await refresh();const s=await state();check('Visible reason for '+code,s.reason===code&&s.disabled&&s.text.length>20);
 }
 await page.evaluate(()=>{fixture.reviewFailure='<img src=x onerror="window.injected=true">';});await refresh();
 check('Read failure is visible, disables application and renders text safely',(await state()).reason==='review-unavailable'&&await page.evaluate(()=>!globalThis.injected&&!document.querySelector('#apply-error-text img')));
 await page.evaluate(()=>{fixture.reviewFailure=null;fixture.review={id:'review-1',current:true,status:'completed',acceptance:{passed:false}};});await refresh();
 const advisory=await state();check('Advisory confirmation remains a distinct enabled choice',advisory.disabled&&!advisory.warningsHidden&&!advisory.warningsDisabled);
 await page.evaluate(()=>{fixture.lostReply=true;fixture.recoveryFailure=true;});await submit(true);
 await page.waitForFunction(()=>document.getElementById('apply-explanation').dataset.reason==='confirming');
 check('Lost reply explains original operation reconciliation',(await state()).disabled&&await page.evaluate(()=>fixture.calls.filter(c=>c.channel==='candidate.apply').length===1));
 await submit(true);await page.waitForTimeout(100);
 check('Repeated form submission never creates another voxel application',await page.evaluate(()=>fixture.calls.filter(c=>c.channel==='candidate.apply').length===1));
 await page.evaluate(()=>{fixture.recoveryFailure=false;});await page.waitForFunction(()=>document.getElementById('preview-panel').hidden,{},{timeout:8000});
 check('Confirmed application preserves complete fixture progress',JSON.stringify(await page.evaluate(()=>fixture.record().world.snapshot))===JSON.stringify(before));
 await page.reload();await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
 check('Page reload retains adopted build and complete fixture progress',await page.evaluate(before=>fixture.record().world.build.id==='draft-1'&&JSON.stringify(fixture.record().world.snapshot)===JSON.stringify(before),before));
 await page.evaluate(()=>craftmineView.preview('draft-2'));
 await page.evaluate(()=>{fixture.hold=true;document.getElementById('refresh-apply-state').onclick();});await page.waitForFunction(()=>!!fixture.pending);
 await page.evaluate(async()=>{await craftmineView.closePreview();fixture.hold=false;await craftmineView.preview('draft-3');fixture.pending.reject(Error('late old review failure'));});
 await page.waitForFunction(()=>!document.getElementById('refresh-apply-state').disabled);
 check('Late old-preview rejection is ignored before any corrective refresh',await page.evaluate(()=>!document.getElementById('review-state').textContent.includes('late old review failure')&&document.getElementById('apply-error-details').hidden));
 await refresh();check('New preview still reads its own current review',(await state()).reason==='ready');
 await page.screenshot({path:path.join(out,'voxel-explanation.png')});
 await goto('godot');await page.evaluate(()=>craftmineView.preview('godot-draft'));
 check('Godot preview explains pending formal adoption without polling mutating state', (await state()).reason==='godot-preview'&&await page.evaluate(()=>fixture.calls.every(c=>c.channel!=='godot.candidateState')));
 check('Godot explanation remains above the sibling candidate surface',await page.evaluate(()=>{const rect=document.getElementById('apply-explanation').getBoundingClientRect();return Math.round(rect.top)===122&&Math.round(rect.bottom)===222&&Math.round(rect.height)===100;}));
 await page.screenshot({path:path.join(out,'godot-explanation.png')});
 await page.evaluate(()=>{fixture.rejectBeforeApply=true;fixture.wrongPreviewIdentity=true;});await submit(false);
 await page.waitForFunction(()=>document.getElementById('apply-explanation').dataset.reason==='confirming');
 check('Wrong candidate-state identity cannot unlock an uncertain attempt',await page.evaluate(()=>document.getElementById('close-preview').disabled));
 await page.evaluate(()=>{fixture.wrongPreviewIdentity=false;});await submit(false);
 await page.waitForFunction(()=>document.getElementById('apply-explanation').dataset.reason==='apply-error');
 check('Exact unchanged-preview receipt permits exit or retry after pre-transaction rejection',await page.evaluate(()=>!document.getElementById('close-preview').disabled&&fixture.record().world.build.id==='formal-1'));
 await page.evaluate(()=>{fixture.rejectBeforeApply=false;fixture.calls=[];});
 await page.evaluate(()=>{fixture.lostReply=true;fixture.recoveryFailure=true;});await submit(false);await page.waitForFunction(()=>document.getElementById('apply-explanation').dataset.reason==='confirming');
 await page.evaluate(()=>{fixture.recoveryFailure=false;});await submit(false);await page.waitForFunction(()=>document.getElementById('preview-panel').hidden);
 check('Godot lost reply reconciles original candidate without applying twice',await page.evaluate(()=>fixture.calls.filter(c=>c.channel==='godot.candidateApply').length===1&&fixture.record().world.build.id==='godot-draft'));
 await page.reload();await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
 check('Godot fixture adopted build and full progress survive page reload',await page.evaluate(before=>fixture.record().world.build.id==='godot-draft'&&JSON.stringify(fixture.record().world.snapshot)===JSON.stringify(before),before));
 check('No pointer lock/focus requests or page errors',await page.evaluate(()=>inputGuards.pointer===0&&inputGuards.focus===0)&&report.errors.length===0);
 report.passed=true;
}catch(error){report.failure=String(error.stack||error);report.passed=false;throw error;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);}
