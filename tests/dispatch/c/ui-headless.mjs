import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {playwright,browserOptions} from '../../../app/browser-tools.mjs';
import {compileScene,INITIAL_SNAPSHOT} from '../../../app/scene.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/dispatch-c-ui-'));
const base=compileScene({format:'craftmine.scene/3',title:'测试世界',night:false,objects:[{id:'flower',name:'已选小花',position:{x:1,y:6,z:8},source:null,components:{health:0,contactDamage:0},parts:[{shape:'box',offset:{x:0,y:0,z:0},size:{x:.05,y:.6,z:.05},color:'#55aa55',material:'solid',solid:false}]}],systems:[],behaviors:[]});
const record={id:'world-a',title:'测试世界',revision:1,world:{build:{...base,id:'v-'+base.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]}};
const report={kind:'built-plugin-ui-with-host-fixture',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:{},checks:[],errors:[],inputAudit:[]};
for(const file of ['plugins/craftmine-world/view.mjs','plugins/craftmine-world/world.html','plugins/craftmine-world/workbench-ui.mjs','desktop/build/craftmine.world/views/view.js'])report.files[file]=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const check=(name,value,detail=null)=>{report.checks.push({name,passed:!!value,detail});save();assert.ok(value,name);console.log('PASS '+name);};
const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://local').pathname;
  const allowed={'/':'world.html','/view.js':'view.js'};
  if(!allowed[route]){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',route==='/'?'text/html':'text/javascript');res.end(fs.readFileSync(path.join(root,'desktop/build/craftmine.world/views',allowed[route])));
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let context,page;
async function submitByText(label){await page.evaluate(label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label&&!b.disabled&&!b.closest('[hidden]'));if(!button)throw Error('Missing enabled form: '+label);button.closest('form').requestSubmit();},label);await page.waitForFunction(()=>!document.querySelector('.workbench-notice')?.textContent.includes('处理中'));}
async function open(tab){await page.evaluate(tab=>globalThis.craftmineView.showWorkbench(tab),tab);await page.waitForFunction(tab=>!document.querySelector(`[data-workbench-page="${tab}"]`).hidden,tab);}
try{
  context=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),viewport:{width:760,height:900}});
  await context.addInitScript(record=>{
    globalThis.__craftmineHeadless=true;globalThis.__uiAudit={lock:0,focus:0};Element.prototype.requestPointerLock=()=>{__uiAudit.lock++;throw Error('No input lock');};window.focus=()=>{__uiAudit.focus++;};HTMLElement.prototype.focus=function(){__uiAudit.focus++;};
    globalThis.__state={record,active:false,missing:false,empty:false,restoreFail:false,saveFail:false,memoryStatus:'validated',calls:[],worlds:[record,{...structuredClone(record),id:'world-b',title:'第二世界'}]};
    const hash='a'.repeat(64),ref=version=>({id:'old-tree',version,hash});
    const channels=['library.search','library.read','library.install','library.capture','memory.search','memory.propose','memory.retire','task.current','task.recoverable','task.resume','task.discard','task.stop','backup.export','backup.inspect','backup.restore','backup.status','diagnostics.status','diagnostics.export','selection.set','selection.clear'];
    globalThis.pluginBridge={on(){},async invoke(channel,args={}){
      const state=globalThis.__state;state.calls.push({channel,args:structuredClone(args)});
      if(channel==='app.getAppearance')return {base:'dark'};
      if(channel==='world.list')return {worlds:state.worlds.map(w=>({id:w.id,title:w.title})),activeWorldId:state.record.id};
      if(channel==='world.open'){state.record=structuredClone(state.worlds.find(w=>w.id===args.id));return structuredClone(state.record);}
      if(channel==='world.saveProgress'){if(state.saveFail)throw Error('SAVE_FAILED: 磁盘写入失败');state.record.world.snapshot=structuredClone(args.snapshot);state.record.revision++;return structuredClone(state.record);}
      if(channel==='verification.list')return [];
      if(channel==='workbench.capabilities')return {channels:state.missing?[]:channels};
      if(channel==='task.current')return {active:state.active,context:{binding:{taskId:'task-a'},generation:1,status:state.active?'running':'finished',draft:{revision:3},requirements:[{kind:'correction',text:'花草可以穿行'}],modifiedResources:['object:flower'],budget:{requestCount:4,compactionCount:3,actualTokens:1000,reservedTokens:200,unknownRequestCount:1,remainingTokens:8800,limits:{maxRequests:80,maxCompactions:8}}}};
      if(channel==='library.search')return {items:state.empty?[]:[1,2].map(version=>({ref:ref(version),name:'旧树 <script>不执行</script>',kind:'object',description:'可复用树的固定版本',dependencies:['geometry@2'],scope:{worldId:'world-a'},evidence:{applied:version===1,verified:true}})),next:null,total:2};
      if(channel==='library.read')return {ref:args.ref,name:'旧树',dependencies:['geometry@2','ext:tree-growth@1'],scope:{worldId:'source-world'},evidence:{applied:true},source:{text:'export function step() { return { state: {}, commands: [] }; }',next:null,start:0}};
      if(channel==='library.install'){if(state.active)throw Error('TASK_ACTIVE');if(state.loseInstallReply){state.loseInstallReply=false;throw Error('REPLY_LOST');}return {receipt:{id:'receipt-install'},applied:false};}
      if(channel==='library.capture')return {ref:ref(3)};
      if(channel==='memory.search')return {items:[{format:'craftmine.memory/1',id:'rule-a',kind:'project-rule',claim:'花草不阻挡移动',status:state.memoryStatus,scope:{projectId:'p',worldId:args.worldId},sourceRefs:['user:request-1']}],next:null};
      if(channel==='memory.retire'){state.memoryStatus='retired';return {retired:true};}
      if(channel==='memory.propose')return {record:{status:'proposed'}};
      if(channel==='task.recoverable')return {items:[{taskId:'interrupted-a',generation:2,reason:'关闭程序时创作尚未完成'}]};
      if(channel==='task.stop'){state.active=false;return {requested:true};}
      if(['task.resume','task.discard','selection.set','selection.clear'].includes(channel))return {ok:true};
      if(channel==='backup.inspect')return {status:'ready',grantId:'opaque-grant',expectedCurrentHash:'b'.repeat(64),counts:{worlds:2,library:3,memories:1},scope:'profile'};
      if(channel==='backup.restore'){if(state.restoreFail)throw Error('BACKUP_RESTORE_FAILED: 校验失败，原资料保留');return {status:'completed',scope:'profile',modelReplay:false};}
      if(channel==='backup.status')return {status:'failed'};
      if(channel==='diagnostics.status')return {credentials:{status:'protected'},scope:'sanitized',summary:'可导出已脱敏的系统诊断。'};
      if(['backup.export','diagnostics.export'].includes(channel))return {status:'completed',scope:'profile'};
      throw Error('Unknown test channel '+channel);
    }};
  },record);
  page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));await page.goto(pathToFileURL(path.join(root,'desktop/build/craftmine.world/views/world.html')).href);await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
  check('actual built world panel loads game and preserves save controls',await page.locator('#save-world').isEnabled());
  const game=page.frames().find(frame=>frame!==page.mainFrame());
  const selection={worldId:record.id,build:{id:record.world.build.id,hash:record.world.build.hash},objectId:'flower',selectionRevision:1};
  await game.evaluate(value=>parent.postMessage({channel:'craftmine-game/1',type:'selection',nonce:document.querySelector('meta[name="craftmine-nonce"]').content,...value},'*'),selection);
  await page.waitForFunction(()=>!document.querySelector('#selection-context').hidden);
  check('authentic frame selection renders removable context',await page.locator('#selection-context').textContent().then(t=>t.includes('已选小花')));
  const beforeRejected=await page.evaluate(()=>__state.calls.filter(c=>c.channel==='selection.set').length);
  for(const invalid of [{...selection,worldId:'wrong-world',selectionRevision:2},{...selection,build:{...selection.build,hash:'f'.repeat(64)},selectionRevision:3},{...selection,objectId:'forged-object',selectionRevision:4},{...selection,selectionRevision:1}])await game.evaluate(value=>parent.postMessage({channel:'craftmine-game/1',type:'selection',nonce:document.querySelector('meta[name="craftmine-nonce"]').content,...value},'*'),invalid);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  check('stale world build revision and unknown objects never reach host',await page.evaluate(()=>__state.calls.filter(c=>c.channel==='selection.set').length)===beforeRejected);
  await submitByText('移除');check('selection can be explicitly removed',await page.locator('#selection-context').isHidden());
  await open('library');check('fixed versions render with applied and verification provenance',await page.locator('[data-library-ref]').count()===2&&(await page.locator('[data-library-ref="old-tree@1"]').textContent()).includes('已应用来源'));
  check('untrusted library name is rendered as text',await page.locator('[data-library-ref] script').count()===0);
  await submitByText('查看固定版本');check('exact source version exposes bounded source and dependencies',(await page.locator('.workbench-detail').textContent()).includes('ext:tree-growth@1'));
  await submitByText('加入当前草稿');check('install says draft rather than applied',(await page.locator('.workbench-notice').textContent()).includes('仍需检查'));
  const installation=await page.evaluate(()=>__state.calls.find(c=>c.channel==='library.install'));check('installation sends exact version hash and no renderer owner identity',installation.args.ref.version===1&&installation.args.ref.hash==='a'.repeat(64)&&!('sessionId'in installation.args)&&installation.args.worldId==='world-a');
  await page.evaluate(()=>{__state.loseInstallReply=true;});await submitByText('加入当前草稿');await submitByText('加入当前草稿');
  check('lost install reply retries identical operation and revision',await page.evaluate(()=>{const calls=__state.calls.filter(call=>call.channel==='library.install').slice(-2);return JSON.stringify(calls[0].args)===JSON.stringify(calls[1].args);}));
  await page.screenshot({path:path.join(out,'library-dark-wide.png')});
  await page.evaluate(()=>{__state.active=true;});await open('library');await submitByText('查看固定版本');check('active model task disables manual install',await page.getByText('加入当前草稿',{exact:true}).isDisabled());
  await open('task');check('task shows actual reservations and unknown results',(await page.locator('[data-workbench-page="task"]').textContent()).includes('结果待确认 1 次'));
  await submitByText('停止当前任务');check('stop sends captured task and generation',await page.evaluate(()=>__state.calls.some(c=>c.channel==='task.stop'&&c.args.taskId==='task-a'&&c.args.generation===1)));
  await submitByText('继续创作');check('explicit resume preserves task generation',await page.evaluate(()=>__state.calls.some(c=>c.channel==='task.resume'&&c.args.generation===2)));
  await open('memory');check('memory shows world scope and source',await page.locator('[data-memory-id]').textContent().then(t=>t.includes('仅此世界')&&t.includes('user:request-1')));
  await submitByText('停用');check('retire displays inactive record',await page.locator('[data-memory-id]').textContent().then(t=>t.includes('已停用')));
  await page.evaluate(()=>{const area=document.querySelector('[data-workbench-page="memory"] textarea');area.value='以后树木保留通路';area.closest('details').open=true;area.closest('form').requestSubmit();});
  await page.waitForFunction(()=>__state.calls.some(c=>c.channel==='memory.propose'));check('player rule is proposed with bound world and no forged validation',await page.evaluate(()=>{const call=__state.calls.find(c=>c.channel==='memory.propose');return call.args.worldId==='world-a'&&!('status'in call.args)&&!('sourceRefs'in call.args);}));
  await open('backup');await submitByText('选择备份并查看内容');check('restore explicitly describes all profile worlds',await page.locator('[data-backup-inspection]').textContent().then(t=>t.includes('全部世界资料')&&t.includes('世界 2')));
  await page.evaluate(()=>{__state.restoreFail=true;const area=document.querySelector('[data-backup-inspection]');area.querySelector('input[type=checkbox]').checked=true;area.querySelector('form').requestSubmit();});
  await page.waitForFunction(()=>document.querySelector('.workbench-notice').textContent.includes('校验失败'));check('failed restore preserves world and opaque path authority',await page.evaluate(()=>__state.record.id==='world-a'&&!JSON.stringify(__state.calls.find(c=>c.channel==='backup.restore').args).includes('C:')));
  check('unknown restore can query existing operation receipt',await page.getByText('查询恢复结果',{exact:true}).count()===1);
  await page.setViewportSize({width:360,height:850});await page.screenshot({path:path.join(out,'backup-dark-narrow.png')});
  check('narrow workbench has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#workbench-panel').scrollWidth<=innerWidth));
  await page.evaluate(()=>{document.documentElement.style.colorScheme='light';document.documentElement.dataset.theme='light';});await open('memory');await page.screenshot({path:path.join(out,'memory-light-narrow.png')});
  await page.evaluate(()=>{__state.missing=true;document.querySelector('#refresh-workbench').requestSubmit();});await page.waitForFunction(()=>document.querySelector('[data-workbench-page="memory"]').textContent.includes('尚未连接'));
  check('unavailable services never display fake success',await page.locator('[data-workbench-page="memory"]').textContent().then(t=>t.includes('尚未连接')));
  await page.evaluate(()=>{__state.saveFail=true;const select=document.querySelector('#world-list');select.value='world-b';select.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('SAVE_FAILED'));
  check('failed save prevents world switch and preserves current record',await page.evaluate(()=>document.body.dataset.worldId==='world-a'&&document.querySelector('#world-list').value==='world-a'));
  await page.evaluate(()=>{__state.saveFail=false;__state.missing=false;const select=document.querySelector('#world-list');select.value='world-b';select.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>document.body.dataset.worldId==='world-b'&&document.body.dataset.worldLoaded==='true');await open('memory');
  check('world switch binds new memory reads and clears selection',await page.evaluate(()=>__state.calls.filter(c=>c.channel==='memory.search').at(-1).args.worldId==='world-b'&&document.querySelector('#selection-context').hidden));
  report.calls=await page.evaluate(()=>__state.calls);report.inputAudit=await Promise.all(page.frames().map(frame=>frame.evaluate(()=>globalThis.__uiAudit||{})));
  check('no input lock or focus request',report.inputAudit.every(a=>(a.lock||0)===0&&(a.focus||0)===0));
  check('no page errors',report.errors.length===0,report.errors);
}catch(error){report.errors.push(error.stack);process.exitCode=1;console.error(error.message);}
finally{await context?.close();await new Promise(resolve=>server.close(resolve));save();console.log('Evidence: '+out);}
