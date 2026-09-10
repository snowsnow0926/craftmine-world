// Real createWorkbench DOM + loopback HTTP + filesystem service; fixed host identity, NOT native evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const ref=arg('--ui-ref')||'HEAD';
const commit=execFileSync('git',['rev-parse',`${ref}^{commit}`],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const resultsRoot=path.join(root,'test-results');await fs.mkdir(resultsRoot,{recursive:true});
const out=await fs.mkdtemp(path.join(resultsRoot,'issue-workbench-')),sources=path.join(out,'ui-source');await fs.mkdir(sources);
const hashes={},queue=['workbench-ui.mjs'],seen=new Set();
while(queue.length){
 const name=queue.shift();if(seen.has(name))continue;seen.add(name);
 if(!/^[a-z0-9-]+\.mjs$/.test(name))throw Error('Unsupported source dependency');
 const source=execFileSync('git',['show',`${commit}:plugins/craftmine-world/${name}`],{cwd:root,windowsHide:true});
 hashes[name]=createHash('sha256').update(source).digest('hex');await fs.writeFile(path.join(sources,name),source);
 for(const match of source.toString('utf8').matchAll(/from\s+['"]\.\/([^'"]+)['"]/g))queue.push(match[1]);
}
const deps=process.env.CRAFTMINE_DEPS_ROOT||path.join(root,'vendor/pi-desktop/packages/agent-runtime');
const {build}=createRequire(path.join(deps,'package.json'))('esbuild');
await build({entryPoints:[path.join(sources,'workbench-ui.mjs')],outfile:path.join(out,'workbench.mjs'),bundle:true,platform:'browser',format:'esm'});
const serviceSource=path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-issue-service.ts');
await build({entryPoints:[serviceSource],outfile:path.join(out,'service.mjs'),bundle:true,platform:'node',format:'esm'});
const {createCraftmineIssueService}=await import(pathToFileURL(path.join(out,'service.mjs')));
const directory=path.join(out,'notebook'),client={version:'0.14.3',commit};let selectedWorld='alpha',loseCreate=false,hold=null;
const identity=()=>({phase:'formal',status:'ready',worldId:selectedWorld,buildId:`build-${selectedWorld}`,baseId:'first-person',baseVersion:'1',instanceId:`instance-${selectedWorld}`,runtimeTarget:'godot-web',artifactManifestHash:'a'.repeat(64)});
const makeService=()=>createCraftmineIssueService({directory,client,captureContext:async()=>identity()});let service=makeService();
const token=randomUUID(),calls=[],externalRequests=[],pageErrors=[],guardSnapshots=[];
const report={format:'craftmine.local-issues-workbench-test/1',type:'workbench-http-service-fixture',native:false,uiCommit:commit,uiSourceHashes:hashes,serviceSourceHash:createHash('sha256').update(await fs.readFile(serviceSource)).digest('hex'),startedAt:new Date().toISOString(),checks:[],completed:false,passed:false};
const pageHtml=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Workbench notebook fixture</title><style>body{font:15px sans-serif;background:#191919;color:#eee;margin:28px;max-width:900px}textarea{display:block;width:90%}button{margin:4px;padding:8px}form{display:inline-block}p{overflow-wrap:anywhere}.issue-description{white-space:pre-wrap}article{border:1px solid #555;padding:12px}</style><aside id="selection"></aside><main id="workbench"></main></html>`;
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(pageHtml);return;}
  if(req.method==='GET'&&req.url==='/workbench.mjs'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(out,'workbench.mjs')));return;}
  if(req.method!=='POST'||req.url!=='/rpc'||req.headers['x-fixture-token']!==token){res.writeHead(404).end();return;}
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>20000)throw Error('BOUNDED_REQUEST');}
  const {channel,input}=JSON.parse(body);calls.push({channel,input});
  if(input.worldId!==selectedWorld)throw Error('SELECTED_WORLD_CHANGED');
  let value;
  if(channel==='workbench.capabilities')value={channels:['issue.create','issue.list','issue.read','issue.delete','task.current','diagnostics.status']};
  else if(channel==='task.current')value={context:null,status:'idle'};
  else if(channel==='diagnostics.status')value={scope:'sanitized',summary:'Application-summary fixture; no credential access.'};
  else if(channel.startsWith('issue.'))value=await service.request(channel,input);
  else throw Error('UNEXPECTED_CHANNEL');
  if(hold?.channel===channel&&!hold.used){hold.used=true;hold.entered();await new Promise(resolve=>{hold.release=resolve;});}
  if(channel==='issue.create'&&loseCreate){loseCreate=false;throw Error('LOST_REPLY');}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value}));
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.code||error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let browser,page;
const record=name=>{report.checks.push({name,passed:true});console.log('PASS',name);};
const waitIdle=()=>page.waitForFunction(()=>!window.workbench.busy);
async function mount(){
 await page.evaluate(async({token,worldId})=>{
  const {createWorkbench}=await import('/workbench.mjs');window.world={id:worldId,world:{build:{id:`build-${worldId}`,scene:{objects:[],systems:[],behaviors:[]}}}};
  window.fixture={pauses:0,saveCalls:0};window.lastAction=Promise.resolve();
  window.request=async(channel,input)=>{const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Token':token},body:JSON.stringify({channel,input})});const body=await r.json();if(body.error)throw Object.assign(Error(body.error),{code:body.error});return body.value;};
  window.workbench=createWorkbench({element:document.querySelector('#workbench'),selectionElement:document.querySelector('#selection'),getWorld:()=>world,request,
   run:async fn=>{window.lastAction=Promise.resolve().then(fn);return await lastAction;},pause:()=>fixture.pauses++,saveBeforeBackup:async()=>{fixture.saveCalls++;throw Error('Unexpected save');}});
  await workbench.setWorld();await workbench.show('backup');
  window.submit=label=>{const button=[...document.querySelectorAll('[data-workbench-page="backup"] button')].find(b=>b.textContent===label&&!b.closest('[hidden]'));
   if(!button||button.disabled)throw Error(`Unavailable ${label}`);button.form.requestSubmit();};
 },{token,worldId:selectedWorld});await waitIdle();
}
async function submit(label){await page.evaluate(label=>submit(label),label);await waitIdle();}
async function setWorld(worldId){selectedWorld=worldId;await page.evaluate(async worldId=>{world={...world,id:worldId};await workbench.setWorld();},worldId);}
function holdNext(channel){let entered;const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Timed out waiting for ${channel}`)),5000);entered=()=>{clearTimeout(timer);resolve();};});hold={channel,entered,ready,used:false,release:null};return ready;}
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser-profile'),browserOptions());
 await browser.route('**/*',async route=>{if(new URL(route.request().url()).origin!==origin){externalRequests.push(route.request().url());return route.abort();}return route.continue();});
 await browser.addInitScript(()=>{window.guard={pointerLock:0,focus:0,trustedInput:0};Element.prototype.requestPointerLock=()=>{guard.pointerLock++;throw Error('PointerLock forbidden');};window.focus=()=>{guard.focus++;throw Error('Focus forbidden');};HTMLElement.prototype.focus=()=>{guard.focus++;throw Error('Focus forbidden');};for(const type of ['mousedown','keydown','touchstart'])addEventListener(type,event=>{if(event.isTrusted)guard.trustedInput++;});});
 page=await browser.newPage();page.on('pageerror',error=>pageErrors.push(error.message));await page.goto(origin);await mount();
 assert.equal(await page.locator('[data-workbench-page="backup"] [data-issue-notebook]').count(),1);assert.equal(await page.locator('[data-issue-description]').count(),1);
 assert.ok((await page.textContent('body')).includes('诊断与系统保护'));record('production createWorkbench mounts the notebook beside backup and diagnostics');
 const original='  工作台原话\r\n<script>window.injected=true</script> 世界 🌍  ';
 loseCreate=true;await page.evaluate(value=>{document.querySelector('[data-issue-description]').value=value;},original);await submit('记录问题');
 assert.equal(await page.locator('[data-issue-description]').evaluate(el=>el.readOnly),true);await submit('记录问题');
 const stored=(await service.request('issue.list',{worldId:'alpha'})).items;assert.equal(stored.length,1);const issue=(await service.request('issue.read',{worldId:'alpha',issueId:stored[0].id})).issue;
 // Textareas normalize CRLF to LF in the platform value; compare against the exact submitted value.
 assert.equal(issue.description,original.replaceAll('\r\n','\n'));const creates=calls.filter(call=>call.channel==='issue.create');assert.equal(creates.length,2);assert.equal(creates[0].input.operationId,creates[1].input.operationId);assert.equal(await page.evaluate(()=>window.injected),undefined);
 assert.equal(await page.locator('[data-issue-notebook] section[data-issue-id] .issue-description').textContent(),issue.description);record('HTTP lost response retries the same real persisted record; original submitted text remains inert');
 await submit('查看记录');assert.ok(calls.some(call=>call.channel==='issue.read'&&call.input.issueId===issue.id));
 await page.screenshot({path:path.join(out,'workbench-notebook.png'),fullPage:true});
 guardSnapshots.push(await page.evaluate(()=>guard));service=makeService();await page.reload();await mount();await submit('查看记录');assert.equal(await page.locator('[data-issue-notebook] section[data-issue-id] .issue-description').textContent(),issue.description);record('new service factory and reloaded workbench recover the unchanged disk record');
 await submit('删除这条记录');await submit('保留记录');assert.equal((await service.request('issue.list',{worldId:'alpha'})).total,1);
 await submit('删除这条记录');await submit('确认删除记录');assert.equal((await service.request('issue.list',{worldId:'alpha'})).total,0);assert.ok((await page.textContent('body')).includes('此世界 0 条记录'));record('workbench details and explicit delete confirmation operate on the real ledger');
 await page.evaluate(()=>{document.querySelector('[data-issue-description]').value='alpha surviving issue';});await submit('记录问题');
 await setWorld('beta');await waitIdle();assert.ok((await page.textContent('body')).includes('此世界 0 条记录'));assert.equal(await page.locator('[data-issue-description]').inputValue(),'');
 await page.evaluate(()=>{document.querySelector('[data-issue-description]').value='beta separate issue';});await submit('记录问题');
 assert.equal((await service.request('issue.list',{worldId:'alpha'})).total,1);assert.equal((await service.request('issue.list',{worldId:'beta'})).total,1);record('normal workbench world switching scopes storage and clears old text');
 const ready=holdNext('issue.read');await page.evaluate(()=>{submit('查看记录');window.heldAction=lastAction;});await ready;
 await setWorld('alpha');hold.release();await page.evaluate(()=>heldAction.catch(()=>{}));await waitIdle();
 assert.equal(await page.locator('[data-workbench-page="backup"] [data-issue-description]').count(),1,'new world notebook must mount even while the previous-world detail action is pending');
 assert.ok((await page.textContent('body')).includes('alpha surviving issue'));assert.equal((await page.locator('[data-issue-notebook]').textContent()).includes('beta separate issue'),false);record('late previous-world detail cannot overwrite or prevent the new world notebook');
 const createReady=holdNext('issue.create');await page.evaluate(()=>{document.querySelector('[data-issue-description]').value='late alpha creation';submit('记录问题');window.heldAction=lastAction;});await createReady;
 await setWorld('beta');hold.release();await page.evaluate(()=>heldAction.catch(()=>{}));await waitIdle();
 assert.ok((await page.locator('[data-issue-notebook]').textContent()).includes('beta separate issue'));assert.equal((await page.locator('[data-issue-notebook]').textContent()).includes('late alpha creation'),false);
 assert.equal((await service.request('issue.list',{worldId:'alpha'})).total,2);assert.equal((await service.request('issue.list',{worldId:'beta'})).total,1);
 await page.evaluate(()=>{document.querySelector('[data-issue-description]').value='beta after old creation';});await submit('记录问题');assert.equal((await service.request('issue.list',{worldId:'beta'})).total,2);record('late create reply stays in the original world and cannot strand new-world controls');
 const listReady=holdNext('issue.list');await page.evaluate(()=>{window.heldRefresh=workbench.refresh();});await listReady;
 await setWorld('alpha');hold.release();await page.evaluate(()=>heldRefresh);await waitIdle();
 assert.ok((await page.locator('[data-issue-notebook]').textContent()).includes('late alpha creation'));assert.equal((await page.locator('[data-issue-notebook]').textContent()).includes('beta after old creation'),false);record('old workbench list response cannot replace the new-world notebook');
 const closingReady=holdNext('issue.read');await page.evaluate(()=>{submit('查看记录');window.heldAction=lastAction;});await closingReady;
 await page.evaluate(()=>workbench.show(null));hold.release();await page.evaluate(()=>heldAction.catch(()=>{}));await waitIdle();
 assert.deepEqual(await page.evaluate(()=>({tab:workbench.tab,hidden:document.querySelector('#workbench').hidden})),{tab:null,hidden:true});record('closing the workbench cancels deferred redraw and does not reopen it');
 await page.evaluate(()=>workbench.show('backup'));await waitIdle();
 const oldMutationReady=holdNext('issue.create');await page.evaluate(()=>{document.querySelector('[data-issue-description]').value='alpha before new-world action';submit('记录问题');});await oldMutationReady;
 await setWorld('beta');const oldHold=hold,newWorldReady=holdNext('issue.list');oldHold.release();await newWorldReady;
 const beforeCreateCount=calls.filter(call=>call.channel==='issue.create').length;
 await page.evaluate(()=>{document.querySelector('[data-issue-description]').value='beta after new-world load';submit('记录问题');});
 assert.equal(await page.evaluate(()=>workbench.busy),true);assert.equal(calls.filter(call=>call.channel==='issue.create').length,beforeCreateCount,'old mutation completion must not unlock the current-world pending action');
 hold.release();await waitIdle();await submit('记录问题');assert.equal(calls.filter(call=>call.channel==='issue.create').length,beforeCreateCount+1);record('old mutation completion cannot unlock or bypass a pending new-world action');
 guardSnapshots.push(await page.evaluate(()=>guard));for(const guard of guardSnapshots)assert.deepEqual(guard,{pointerLock:0,focus:0,trustedInput:0});assert.equal(await page.evaluate(()=>fixture.saveCalls),0);assert.deepEqual(externalRequests,[]);assert.deepEqual(pageErrors,[]);
 assert.equal(calls.some(call=>/model|agent|turn\.begin|saveProgress|backup\./.test(call.channel)),false);record('no model, world save, external request, input, focus or PointerLock');
 report.passed=true;
}catch(error){report.failure=String(error.stack||error);process.exitCode=1;console.error(report.failure);}
finally{
 hold?.release?.();report.completed=true;report.finishedAt=new Date().toISOString();report.calls=calls;report.externalRequests=externalRequests;report.pageErrors=pageErrors;report.guardSnapshots=guardSnapshots;
 if(page&&!page.isClosed())report.guard=await page.evaluate(()=>guard).catch(()=>null);
 await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,passed:report.passed,checks:report.checks.length,uiCommit:commit}));
}
