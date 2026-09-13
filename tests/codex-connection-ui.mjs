// Isolated headless component fixture. Page-script events only; no OS input.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve('.'), desktop = join(root, 'vendor/pi-desktop/apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
const { build } = require('esbuild');
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : require('playwright');
const output = join(root, 'test-results/codex-connection-ui');
await mkdir(output, { recursive: true });
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import i18next from 'i18next';
import {initReactI18next} from 'react-i18next';
import {WorldAgentBackendRow} from './src/components/settings/WorldAgentBackendRow';
import {codexConnectionEn,codexConnectionZhCN} from '../../packages/i18n/src/locales/codex-connection';
await i18next.use(initReactI18next).init({lng:new URLSearchParams(location.search).get('language')||'en',resources:{en:{translation:{codexConnection:codexConnectionEn}},'zh-CN':{translation:{codexConnection:codexConnectionZhCN}}}});
window.fixture={calls:[],saves:[],status:{code:'idle',model:'gpt-6-astra',effort:'xhigh',requiredVersion:'codex-cli 0.154.0-alpha.6.2'},nextCode:'CODEX_CHATGPT_LOGIN_REQUIRED'};
window.fixtureApi={codexConnection:async request=>{
 const f=window.fixture; f.calls.push(request); const base={...f.status,path:request.path||f.status.path};
 if(request.action==='detect'||request.action==='pick') f.status={...base,code:'detected',path:'C:/fixture/codex.exe'};
 if(request.action==='verify') f.status={...base,code:f.nextCode,loginPending:false,account:f.nextCode==='ready'?{type:'chatgpt',email:'player@example.test',plan:'pro'}:undefined};
 if(request.action==='login') f.status={...base,code:'login_pending',loginPending:true};
 if(request.action==='cancel') f.status={...base,code:'cancelled',loginPending:false};
 return {...f.status};
}};
createRoot(document.getElementById('root')).render(<WorldAgentBackendRow settings={{worldAgentBackend:'codex-cli',codexCliPath:'C:/fixture/codex.exe'}} saveSettings={async settings=>{window.fixture.saves.push(settings)}}/>);
`;
const bundled = await build({ stdin:{contents:entry,resolveDir:desktop,loader:'tsx'}, bundle:true,write:false,format:'esm',jsx:'automatic',
  define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture-api',setup(plugin){
    plugin.onResolve({filter:/lib\/api$/},()=>({path:'api',namespace:'fixture'}));
    plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const api = {codexConnection: (...args) => window.fixtureApi.codexConnection(...args)};',loader:'js'}));
  }}] });
const css = (await Promise.all(['tokens','base','ui-kit','settings'].map(name=>readFile(join(desktop,`src/styles/${name}.css`),'utf8')))).join('\n');
// Only the utility classes used by this component; production uses Tailwind.
const utilities = '.flex{display:flex}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.gap-2{gap:8px}.w-full{width:100%}.min-w-0{min-width:0}.break-words{overflow-wrap:anywhere}body{margin:0;padding:20px}';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}\n${utilities}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/fixture.js'?'text/javascript':'text/html');response.end(request.url==='/fixture.js'?bundled.outputFiles[0].text:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true, ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const context=await browser.newContext();
await context.addInitScript(()=>{Element.prototype.requestPointerLock=function(){throw Error('Pointer Lock disabled');};window.focus=()=>{throw Error('Focus disabled');};});
const page=await context.newPage(), errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
async function button(label){await page.evaluate(label=>{const element=[...document.querySelectorAll('button')].find(button=>button.textContent===label);if(!element||element.disabled)throw Error('Button unavailable: '+label);element.dispatchEvent(new MouseEvent('click',{bubbles:true}));},label);}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForSelector('[data-testid=world-agent-backend]');
  assert.equal(await page.locator('[data-codex-setup-stages] li').count(),3);checks.push('install reconnect verify save guidance');
  assert(await page.evaluate(()=>document.body.textContent.includes('official general installer may supply a different version')));checks.push('exact distribution limitation visible');
  assert(await page.getByRole('button',{name:'Save world backend',exact:true}).isDisabled());checks.push('save requires verification');
  await button('Verify connection');await page.waitForFunction(()=>document.body.textContent.includes('No ChatGPT login found'));
  checks.push('missing account feedback');
  await button('Start ChatGPT login');await page.waitForFunction(()=>document.body.textContent.includes('Login is waiting'));
  assert(!(await page.evaluate(()=>window.fixture.calls.some(call=>call.action==='openLogin'))));checks.push('login does not auto open browser');
  await button('Open login in browser');await page.waitForFunction(()=>window.fixture.calls.some(call=>call.action==='openLogin'));
  await button('Cancel connection');await page.waitForFunction(()=>document.body.textContent.includes('Connection cancelled'));
  await page.evaluate(()=>{window.fixture.nextCode='ready';});await button('Verify connection');
  await page.waitForFunction(()=>document.body.textContent.includes('player@example.test'));
  await button('Save world backend');await page.waitForFunction(()=>window.fixture.saves.length===1);
  assert.equal(await page.evaluate(()=>window.fixture.saves[0].worldAgentBackend),'codex-cli');checks.push('verified settings save through original row');
  await page.screenshot({path:join(output,'settings-en.png')});
  await page.setViewportSize({width:390,height:900});await page.goto(`http://127.0.0.1:${server.address().port}?language=zh-CN`);
  await page.waitForSelector('[data-testid=world-agent-backend]');await button('验证连接');
  await page.waitForFunction(()=>document.body.textContent.includes('尚未登录 ChatGPT'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('Chinese narrow layout without horizontal overflow');
  await page.screenshot({path:join(output,'settings-zh-narrow.png')});
  assert.deepEqual(errors,[]);checks.push('no page errors');
  await writeFile(join(output,'report.json'),JSON.stringify({passed:true,checks,errors,realInput:false,modelCalls:0},null,2));
  console.log(JSON.stringify({passed:true,checks,output},null,2));
} finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
