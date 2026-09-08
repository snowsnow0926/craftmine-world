import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {playwright,browserOptions} from './browser-tools.mjs';
fs.mkdirSync('test-results',{recursive:true});
const dir=path.resolve(fs.mkdtempSync('test-results/baseline-')),checks=[];
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync('world-workshop-3d/index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`,profile=path.join(dir,'profile'),{chromium}=playwright();let browser;
const check=(name,passed)=>{checks.push({name,passed});assert.ok(passed,name);console.log('PASS '+name);};
try{
  browser=await chromium.launchPersistentContext(profile,browserOptions());let page=await browser.newPage();await page.goto(url);await page.waitForFunction(()=>!!window.workshop);
  const stats=await page.evaluate(()=>({software:workshop.runtime.software,trees:workshop.runtime.trees.size,chunks:workshop.runtime.meshes.size,error:workshop.runtime.gl.getError()}));
  check('旧原型真实浏览器 WebGL 启动',!stats.software&&stats.error===0&&stats.trees===84&&stats.chunks===36);
  await page.screenshot({path:path.join(dir,'legacy-webgl.png')});
  await page.evaluate(()=>workshop.startJob({harvest:true},'原型配置回归（本地预设）'));
  check('原型候选未提前应用',await page.evaluate(()=>workshop.getState().pending!==null&&!workshop.getState().config.harvest));
  await page.evaluate(()=>{workshop.runtime.wood=7;});await page.evaluate(()=>workshop.applyPending());
  check('应用旧原型配置保留最新运行进度',await page.evaluate(()=>workshop.getState().config.harvest&&workshop.runtime.wood===7));
  await page.evaluate(()=>workshop.save());const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('world-workshop-voxel-v02')));
  check('写入真实浏览器存储',saved.state.wood===7&&saved.config.harvest);
  await browser.close();browser=await chromium.launchPersistentContext(profile,browserOptions());page=await browser.newPage();await page.goto(url);await page.waitForFunction(()=>!!window.workshop);
  check('旧原型跨浏览器重启读取真实存储',await page.evaluate(()=>workshop.runtime.wood===7&&workshop.getState().config.harvest));
}catch(error){checks.push({name:'error',passed:false,error:error.stack});process.exitCode=1;console.error(error);}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({date:new Date().toISOString(),checks,scope:'Focused Windows browser baseline; does not rerun the historical 42 checks'},null,2));console.log('Report: '+path.join(dir,'report.json'));}
