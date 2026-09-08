import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { playwright,browserOptions } from './browser-tools.mjs';
import { EMPTY_SCENE,INITIAL_SNAPSHOT,clone } from '../app/scene.mjs';

if(!process.argv.includes('--explicit-user-input-test'))throw Error('此历史测试包含真实输入。日常验证请运行 tests/background-browser.mjs。');
fs.mkdirSync('test-results',{recursive:true});
const live=process.argv.includes('--live'),dir=path.resolve(fs.mkdtempSync('test-results/browser-'));
const {chromium}=playwright(),checks=[],errors=[];
const report=()=>fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({date:new Date().toISOString(),liveLLM:live,checks,errors,notVerified:['Physical mobile devices','Arbitrary gameplay JavaScript generation','Cloud hosting or multiuser collaboration']},null,2));
const check=(name,value,detail)=>{checks.push({name,passed:!!value,detail});report();assert.ok(value,name);console.log('PASS '+name);};
const port=await new Promise(resolve=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
let server,browser,page;
async function startServer(){server=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,CRAFTMINE_PORT:String(port),CRAFTMINE_DATA_DIR:path.join(dir,'project')},windowsHide:true,stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server startup timeout')),15000);server.stdout.on('data',chunk=>{if(chunk.toString().includes('http://')){clearTimeout(timeout);resolve();}});server.stderr.on('data',chunk=>console.error(chunk.toString()));server.once('exit',code=>{if(code)reject(Error('server exited '+code));});});}
async function stopServer(){if(!server||server.exitCode!==null)return;await new Promise(resolve=>{server.once('exit',resolve);server.kill();});}
async function openBrowser(){browser=await chromium.launchPersistentContext(path.join(dir,'browser-profile'),browserOptions());page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${port}`);await page.locator('#loading').waitFor({state:'hidden'});}
async function api(route,body){return page.evaluate(async({route,body})=>{const r=await fetch(route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Craftmine-Token':document.querySelector('meta[name="craftmine-token"]').content,'X-Craftmine-Client':sessionStorage.getItem('craftmine-client')},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};},{route,body});}
async function snapshot(){return page.evaluate(()=>new Promise((resolve,reject)=>{
  const f=document.querySelector('iframe:not(.staging)'),nonce=new URL(f.src).hash.slice(1),requestId=crypto.randomUUID();
  const timer=setTimeout(()=>reject(Error('snapshot timeout')),5000);
  const receive=e=>{if(e.source===f.contentWindow&&e.data.requestId===requestId){clearTimeout(timer);removeEventListener('message',receive);resolve(e.data.snapshot);}};
  addEventListener('message',receive);f.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type:'snapshot',requestId},'*');
}));}
const game=()=>page.frameLocator('iframe:not(.staging)');
async function enter(){await game().locator('#enter').click();}
async function walk(key,ms){await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);}
async function waitTask(statuses,timeout=250000){const deadline=Date.now()+timeout;let state;while(Date.now()<deadline){state=(await api('/api/state')).body;const t=state.tasks.at(-1);if(t&&statuses.includes(t.status))return state;if(t&&['failed','cancelled','interrupted'].includes(t.status))throw Error(t.error||t.status);await page.waitForTimeout(1000);}throw Error('task timed out');}
async function request(prompt){await page.locator('#prompt').fill(prompt);await page.locator('#send').click();}
async function apply(){await page.locator('#candidate').waitFor({state:'visible'});await page.locator('#apply').click();await page.locator('#candidate').waitFor({state:'hidden',timeout:30000});await page.locator('#loading').waitFor({state:'hidden'});}
const manualScene=()=>({...clone(EMPTY_SCENE),objects:[{id:'fixture-tree',name:'测试树（人工验收夹具）',position:{x:0,y:6,z:7},parts:[{offset:{x:0,y:0,z:0},size:{x:1,y:4,z:1},material:'wood'},{offset:{x:-1,y:3,z:-1},size:{x:3,y:2,z:3},material:'leaves'}]}]});

try{
  await startServer();await openBrowser();
  let state=(await api('/api/state')).body,initial=state.current;
  const firstBuild=(await api('/api/build?id='+initial)).body;
  check('空白世界没有树、房屋或预置对象',firstBuild.scene.objects.length===0);
  await page.waitForTimeout(1100);
  check('真实浏览器 WebGL 绘制与桌面布局', (await page.locator('#renderer').innerText()).includes('WebGL')&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(dir,'01-blank.png')});
  const original=await snapshot();await enter();
  const locked=await game().locator('canvas').evaluate(c=>document.pointerLockElement===c);check('浏览器原生鼠标锁定',locked);
  await walk('w',400);const moved=await snapshot();check('真实键盘 W 向前移动',moved.player.z<original.player.z-1);
  await walk(' ',150);const jumped=await snapshot();await page.waitForTimeout(900);const landed=await snapshot();check('跳跃与地面碰撞',jumped.player.y>6&&Math.abs(landed.player.y-6)<.05);
  await page.keyboard.press('t');await page.locator('#prompt').fill('wasd');const beforeTyping=await snapshot();await page.locator('#prompt').pressSequentially('wasd');const afterTyping=await snapshot();check('聊天输入不会移动角色',JSON.stringify(beforeTyping)===JSON.stringify(afterTyping));
  await page.locator('#prompt').fill('');await page.locator('#respawn').click();
  if(live){
    await request('我想要有树');
    await enter();await walk('d',450);await page.keyboard.press('Escape');
    const waited=await snapshot();state=await waitTask(['ready']);
    check('真实 LLM 从工作台生成候选，当前场景保持空白',state.current===initial&&!!state.candidate&&state.tasks.at(-1).usage?.output_tokens>0);
    check('LLM 等待期间仍能继续走动',waited.player.x>1.5);
    const treeBuild=(await api('/api/build?id='+state.candidate.id)).body;
    check('LLM 生成实际几何与稳定对象 ID',treeBuild.scene.objects.length>0&&(treeBuild.voxels.length>0||treeBuild.primitives.length>0));
    await apply();const applied=await snapshot();check('应用候选保留等待期间的最新位置',Math.abs(applied.player.x-waited.player.x)<.01);
    state=(await api('/api/state')).body;
    const tree=treeBuild.scene.objects[0],oldHeight=Math.max(...tree.parts.map(p=>p.offset.y+p.size.y));
    await page.locator('#respawn').click();await page.waitForTimeout(400);await enter();await walk('w',2000);const near=await snapshot();
    const colliding=treeBuild.voxels.some(([x,y,z])=>near.player.x+.289>x&&near.player.x-.289<x+1&&near.player.z+.289>z&&near.player.z-.289<z+1&&near.player.y+.001<y+1&&near.player.y+1.719>y);
    check('树具有真实碰撞，角色没有穿入树干',!colliding);
    await page.keyboard.press('t');await page.waitForTimeout(200);
    check('准星对象可以带入对话',(await page.locator('#context-label').innerText()).includes(tree.id));
    await page.screenshot({path:path.join(dir,'02-tree.png')});
    await request('把这棵树变高两格，保持它的位置和 ID，继续保持树的形状。');
    state=await waitTask(['ready']);const modified=(await api('/api/build?id='+state.candidate.id)).body;
    const updated=modified.scene.objects.find(o=>o.id===tree.id);
    check('真实 LLM 修改同一对象并保留身份',!!updated&&JSON.stringify(updated.position)===JSON.stringify(tree.position)&&Math.max(...updated.parts.map(p=>p.offset.y+p.size.y))>oldHeight);
    await apply();await page.screenshot({path:path.join(dir,'03-taller-tree.png')});
    await page.locator('#clear-context').click();await request('请在旁边增加一张简单石凳。');
    await page.locator('#cancel').waitFor({state:'visible'});await page.locator('#cancel').click();
    await page.waitForFunction(()=>document.getElementById('task-stage').textContent==='任务已取消',{},{timeout:20000});
    const cancelled=(await api('/api/state')).body;check('取消真实执行进程，没有迟到候选或世界改动',cancelled.current===modified.id&&!cancelled.candidate&&cancelled.tasks.at(-1).status==='cancelled');
  }else{
    await api('/api/import',{format:'craftmine.save/1',scene:manualScene(),snapshot:await snapshot()});await page.waitForTimeout(2000);await apply();check('人工夹具验证候选应用通路（不计为真实 LLM）',(await api('/api/state')).body.current!==initial);
  }
  // Native download, immutable state persistence, and controlled failure injection.
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);const savePath=path.join(dir,'native-download.json');await download.saveAs(savePath);const saved=JSON.parse(fs.readFileSync(savePath,'utf8'));check('原生文件下载包含真实场景与最新位置',saved.format==='craftmine.save/1'&&saved.scene.objects.length>0);
  const current=(await api('/api/state')).body;
  const bad=clone(saved);bad.scene.title='故障注入候选';await api('/api/import',bad);await page.waitForTimeout(2000);
  const candidate=(await api('/api/state')).body.candidate;
  await page.route('**/api/build?id='+candidate.id,route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:candidate.id,scene:null})}));
  await page.locator('#apply').click();await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('已回到原世界'),{},{timeout:15000});
  const failed=(await api('/api/state')).body;check('浏览器候选载入失败会恢复旧世界与应用前存档',failed.current===current.current&&!failed.applying&&JSON.stringify(failed.snapshot)===JSON.stringify(current.snapshot));
  await page.unroute('**/api/build?id='+candidate.id);await api('/api/discard',{});
  // The server commits, but its HTTP response is lost: the client must reconcile.
  const loss=clone(saved);loss.scene.title='提交响应丢失的恢复检查';await api('/api/import',loss);await page.waitForTimeout(2000);
  const lossCandidate=(await api('/api/state')).body.candidate;
  await page.route('**/api/apply/commit',async route=>{await route.fetch();await route.abort();});
  await apply();await page.unroute('**/api/apply/commit');
  check('提交响应丢失后核对事务，保持已成功应用的世界',(await api('/api/state')).body.current===lossCandidate.id);
  // Reloading during a prepared transaction must recover the confirmed version.
  const recovery=clone(saved);recovery.scene.title='刷新恢复检查';await api('/api/import',recovery);
  const prepared=(await api('/api/state')).body;await api('/api/apply/prepare',{candidateId:prepared.candidate.id,version:prepared.current,snapshot:await snapshot()});
  await page.reload();await page.locator('#loading').waitFor({state:'hidden'});
  const recovered=(await api('/api/state')).body;check('应用准备期间刷新，恢复已确认版本并保留候选',!recovered.applying&&recovered.current===prepared.current&&!!recovered.candidate);await api('/api/discard',{});
  const foreign=await page.evaluate(async()=>{const r=await fetch('/api/state',{headers:{'X-Craftmine-Token':'wrong','X-Craftmine-Client':'forged-client-id'}});return r.status;});check('开发接口拒绝无效工作台凭证',foreign===403);
  const sandbox=await game().locator('body').evaluate(()=>{try{parent.document.body;return false;}catch{return true;}});check('游戏窗口无法读取工作台 DOM 或凭证',sandbox);
  const originBlocked=await fetch(`http://127.0.0.1:${port}/api/save`,{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});check('开发接口拒绝跨站写入',originBlocked.status===403);
  await page.waitForTimeout(3200);const latest=(await api('/api/state')).body;
  await browser.close();browser=null;await stopServer();await startServer();await openBrowser();
  const restored=(await api('/api/state')).body;check('浏览器与本地服务均重启后恢复真实持久化数据',restored.current===latest.current&&JSON.stringify(restored.snapshot)===JSON.stringify(latest.snapshot));
  await page.locator('[data-view="assets"]').click();check('素材工作区显示实际对象',await page.locator('.object-card').count()>0);await page.screenshot({path:path.join(dir,'04-objects.png')});
  await page.locator('[data-view="develop"]').click();check('开发工作区显示真实版本记录',await page.locator('#history-list .record').count()>=2);await page.screenshot({path:path.join(dir,'05-development.png')});
  check('浏览器没有未捕获 JavaScript 错误',errors.length===0,errors);
}catch(error){errors.push(error.stack);report();console.error(error);process.exitCode=1;}
finally{if(browser)await browser.close();await stopServer();report();console.log('Report: '+path.join(dir,'report.json'));}
