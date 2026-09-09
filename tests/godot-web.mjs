// Real Web exports inside real React layout. Sessions/native transport are fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {prepareWebProbes} from '../desktop/godot/export-probes.mjs';
import {buildGodotReactShell} from './fixtures/godot-react-shell.mjs';

const root=process.cwd();fs.mkdirSync('test-results',{recursive:true});
const out=fs.mkdtempSync(path.resolve('test-results/godot-web-'));
const require=createRequire(import.meta.url);
let PNG;try{({PNG}=require('pngjs'));}catch{({PNG}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs')));}
const report={kind:'real-godot-web-in-react-fixture',checks:[],runs:[],loads:[],builds:[],console:[],errors:[],notVerified:['product PI/Rust project transactions','real model authorship','native Godot embedding','untrusted project import isolation','GPU/player feel','new Windows distribution']};
const threads=process.env.CRAFTMINE_GODOT_WEB_THREADS!=='0';
report.threads=threads;
const servers=[];let browser,environment,page;
report.inputRequests=[];
const check=(name,value,evidence)=>{report.checks.push({name,passed:!!value,...(evidence===undefined?{}:{evidence})});assert.ok(value,name);console.log('PASS '+name);};
async function server(directory,{game=false}={}){
  const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.woff2':'font/woff2'};
  const instance=http.createServer((request,response)=>{
    try{
      const relative=decodeURIComponent(new URL(request.url,'http://localhost').pathname).slice(1)||'index.html';
      if(relative.includes('\\')||relative.split('/').some(part=>part==='..'||part==='.'||part.includes(':')))throw Error('Invalid path');
      const file=path.resolve(directory,relative);
      if(!file.startsWith(directory+path.sep)||!fs.statSync(file).isFile())throw Error('Absent');
      response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');
      response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
      if(threads){response.setHeader('Cross-Origin-Opener-Policy','same-origin');response.setHeader('Cross-Origin-Embedder-Policy','require-corp');response.setHeader('Cross-Origin-Resource-Policy','cross-origin');}
      response.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'${game?" 'unsafe-inline' 'wasm-unsafe-eval'":""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src ${threads?"'self' blob:":"'none'"}; frame-src ${game?"'none'":"http://127.0.0.1:*"}; object-src 'none'; base-uri 'none'; form-action 'none'`);
      fs.createReadStream(file).pipe(response);
    }catch{response.statusCode=404;response.end('Not found');}
  });
  instance.listen(0,'127.0.0.1');await once(instance,'listening');servers.push(instance);
  return 'http://127.0.0.1:'+instance.address().port;
}
async function open(build,origin,worldId){
  const started=performance.now();
  await page.evaluate(config=>previewFixture.open(config),{url:origin+'/'+path.basename(build.output)+'/index.html',worldId,buildId:build.buildId,timeoutMs:30000});
  report.loads.push({base:build.base,revision:build.revision,worldId,buildId:build.buildId,elapsedMs:Math.round(performance.now()-started)});
  return page.frames().find(frame=>frame.url().startsWith(origin+'/'));
}
const request=(op,args={})=>page.evaluate(({op,args})=>previewFixture.handle().request(op,args),{op,args});
async function capture(frame,name){
  // Screenshot actual compositor pixels after two drawn frames; no input dispatch.
  await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const buffer=await frame.locator('canvas').screenshot({path:path.join(out,name+'.png')});
  return PNG.sync.read(buffer);
}
function centerWhite(png){
  let count=0;
  for(let y=Math.floor(png.height/2)-4;y<=Math.floor(png.height/2)+4;y++)for(let x=Math.floor(png.width/2)-4;x<=Math.floor(png.width/2)+4;x++){
    const offset=(y*png.width+x)*4;
    if(png.data[offset]>235&&png.data[offset+1]>235&&png.data[offset+2]>235)count++;
  }
  return count;
}
async function launchBrowser(hostOrigin){
  browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser-profile'),{...browserOptions(),viewport:{width:1440,height:960},reducedMotion:'reduce',args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  await browser.exposeFunction('__recordInputRequest',value=>report.inputRequests.push(value));
  await browser.addInitScript(()=>{
    globalThis.__inputRequests=0;
    const record=kind=>{globalThis.__inputRequests++;void __recordInputRequest({kind,url:location.href});};
    Element.prototype.requestPointerLock=()=>{record('pointer-lock');throw Error('Pointer lock disabled');};
    HTMLElement.prototype.focus=()=>record('element-focus');window.focus=()=>record('window-focus');
    if(window===top)window.piDesktop={platform:'win32',locale:'zh-CN',on:()=>()=>{},invoke:async()=>({ok:true,data:{ok:true,maximized:false,fullScreen:false}})};
  });
  page=await browser.newPage();page.on('pageerror',error=>report.errors.push(error.stack));
  page.on('requestfailed',request=>report.console.push({type:'requestfailed',text:request.url()+' '+request.failure()?.errorText}));
  page.on('console',message=>report.console.push({type:message.type(),text:message.text()}));
  await page.goto(hostOrigin);await page.waitForFunction(()=>document.querySelector('.composer-input')&&document.querySelector('.work-plugin-view-surface'));
}
try{
  environment=await prepareWebProbes(out,{threads});
  const first=await environment.build('first-person'),top=await environment.build('top-down');
  const changed=await environment.build('first-person',{revision:'changed',damage:7});
  report.builds=environment.builds;
  check('Pinned engine exports actual 3D and 2D Web builds',report.builds.every(build=>build.files.some(file=>file.path==='index.wasm'&&file.bytes>1000000)&&build.files.some(file=>file.path==='index.pck'&&file.bytes>1000)));
  const hostDirectory=path.join(out,'host');await buildGodotReactShell(root,hostDirectory);
  const hostOrigin=await server(hostDirectory),gameOrigin=await server(path.join(out,'exports'),{game:true});
  const secondOrigin=await server(path.join(out,'exports'),{game:true});
  await launchBrowser(hostOrigin);
  let frame=await open(first,gameOrigin,'weapon-world');
  check('Browser isolation matches the chosen Web template',await frame.evaluate(()=>crossOriginIsolated)===threads,{threads});
  let snapshot=await request('snapshot');
  check('Godot runs with a real nonzero Web viewport',snapshot.viewportSize[0]>500&&snapshot.viewportSize[1]>500,snapshot);
  check('Game origin cannot read desktop DOM or its native bridge',await frame.evaluate(()=>{try{return !parent.document&&!parent.piDesktop;}catch(error){return error.name==='SecurityError'&&typeof window.piDesktop==='undefined';}}));
  check('Real Godot canvas is centered beside the actual right composer',await page.evaluate(()=>{const game=document.querySelector('body>iframe').getBoundingClientRect(),surface=document.querySelector('.work-plugin-view-surface').getBoundingClientRect(),chat=document.querySelector('.main-pane').getBoundingClientRect();return Math.abs(game.left-surface.left)<1&&Math.abs(game.width-surface.width)<1&&game.right<=chat.left+1&&chat.right===innerWidth;}));
  const gunPixels=centerWhite(await capture(frame,'first-person-gun'));
  check('Actual rendered white crosshair covers the canvas center',gunPixels>=20&&JSON.stringify(snapshot.crosshairSize)===JSON.stringify(snapshot.viewportSize),{whitePixels:gunPixels});
  const local=JSON.stringify(snapshot.weaponLocal),global=JSON.stringify(snapshot.weaponGlobal);
  snapshot=await request('look',{yaw:0.7});
  check('Held weapon follows the real rotated camera',snapshot.cameraAttachment&&JSON.stringify(snapshot.weaponLocal)===local&&JSON.stringify(snapshot.weaponGlobal)!==global,snapshot.weaponGlobal);
  await request('look',{yaw:0});snapshot=await request('equip',{value:'sword'});
  const swordPixels=centerWhite(await capture(frame,'first-person-sword'));
  check('Equipping a sword hides the rendered crosshair and gun',!snapshot.crosshairVisible&&!snapshot.weaponVisible&&swordPixels===0,{whitePixels:swordPixels});
  let fire=await request('fire');check('Sword cannot consume gun ammo or deal ray damage',!fire.hit&&fire.snapshot.state.ammo===6&&fire.snapshot.state.targetHealth===50);
  await request('equip',{value:'gun'});fire=await request('fire');
  check('Real Web physics ray deals damage and consumes one round',fire.hit&&fire.snapshot.state.ammo===5&&fire.snapshot.state.targetHealth===38,fire.snapshot.state);
  await page.evaluate(()=>{window.savedFrame=document.querySelector('body>iframe');window.savedComposer=document.querySelector('.composer-input');window.savedLoads=previewFixture.loads();document.querySelectorAll('.work-panel .craftmine-layout-controls form')[1].requestSubmit();});
  await page.waitForFunction(()=>document.querySelector('.app-shell.craftmine-play')&&Math.abs(document.querySelector('body>iframe').getBoundingClientRect().width-innerWidth)<2);
  snapshot=await request('snapshot');
  check('Play expansion retains the actual Godot runtime and progress',snapshot.state.ammo===5&&await page.evaluate(()=>savedFrame===document.querySelector('body>iframe')&&savedLoads===previewFixture.loads()));
  check('Crosshair remains centered in expanded play view',centerWhite(await capture(frame,'first-person-expanded'))>=20);
  await page.evaluate(()=>document.querySelectorAll('.work-panel .craftmine-layout-controls form')[0].requestSubmit());
  await page.waitForFunction(()=>{if(document.querySelector('.app-shell.craftmine-play'))return false;const frame=document.querySelector('body>iframe').getBoundingClientRect(),surface=document.querySelector('.work-plugin-view-surface').getBoundingClientRect();return Math.abs(frame.x-surface.x)<1&&Math.abs(frame.width-surface.width)<1;});
  check('Returning to creation restores the visible world bounds beside navigation',await page.evaluate(()=>{const game=document.querySelector('body>iframe').getBoundingClientRect(),nav=document.querySelector('.sidebar').getBoundingClientRect(),chat=document.querySelector('.main-pane').getBoundingClientRect();return nav.right<=game.left+1&&game.right<=chat.left+1;}));
  check('Returning to creation retains the same composer and runtime',await page.evaluate(()=>savedComposer===document.querySelector('.composer-input')&&savedFrame===document.querySelector('body>iframe')&&savedLoads===previewFixture.loads()));
  await frame.waitForFunction(()=>{const canvas=document.querySelector('canvas');return canvas.width===innerWidth*devicePixelRatio&&canvas.height===innerHeight*devicePixelRatio;});
  await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  report.returnGeometry=await page.evaluate(()=>({frame:document.querySelector('body>iframe').getBoundingClientRect().toJSON(),surface:document.querySelector('.work-plugin-view-surface').getBoundingClientRect().toJSON(),sidebar:document.querySelector('.sidebar').getBoundingClientRect().toJSON(),scroll:[scrollX,scrollY],frameStyle:document.querySelector('body>iframe').getAttribute('style')}));
  report.returnViewport=await request('snapshot');
  report.returnCanvas=await frame.evaluate(()=>({canvas:document.querySelector('canvas').getBoundingClientRect().toJSON(),size:[innerWidth,innerHeight],scroll:[scrollX,scrollY]}));
  const desktopPixels=PNG.sync.read(await page.screenshot({path:path.join(out,'desktop-godot.png')}));
  // Sample the empty navigation body, away from its text/icons and controls.
  const navPixels=[];
  for(let y=300;y<=700;y+=100)for(let x=40;x<=240;x+=40){const offset=(y*desktopPixels.width+x)*4;navPixels.push(Array.from(desktopPixels.data.subarray(offset,offset+3)));}
  check('Composited game pixels do not cover the left navigation after mode change',navPixels.every(pixel=>pixel.every(value=>value<10)),{sampleCount:navPixels.length,maximumChannel:Math.max(...navPixels.flat())});
  const beforeInvalid=await request('snapshot');let invalid3D=false;
  try{await request('restore-state',{state:{ammo:1,targetHealth:4,equipped:'sword',yaw:{}}});}catch(error){invalid3D=/Progress is invalid/.test(error.message);}
  snapshot=await request('snapshot');check('Invalid 3D restore leaves all state unchanged',invalid3D&&JSON.stringify(snapshot.state)===JSON.stringify(beforeInvalid.state));
  const saved=(await request('save')).snapshot.state;
  check('Godot completes a graceful shutdown after writing progress',(await request('quit')).exitCode===0);
  await browser.close();await launchBrowser(hostOrigin);
  frame=await open(first,gameOrigin,'weapon-world');snapshot=await request('restore');
  check('Full independent browser restart restores actual IndexedDB progress',JSON.stringify(snapshot.state)===JSON.stringify(saved),snapshot.state);
  await request('quit');frame=await open(changed,gameOrigin,'weapon-world');snapshot=await request('restore');
  check('Rebuilt source changes damage while preserving prior progress',first.buildId!==changed.buildId&&snapshot.damage===7&&JSON.stringify(snapshot.state)===JSON.stringify(saved));
  fire=await request('fire');check('Changed build executes the new damage against restored state',fire.hit&&fire.snapshot.state.ammo===4&&fire.snapshot.state.targetHealth===31,fire.snapshot.state);
  await page.evaluate(()=>window.oldPreview=previewFixture.handle());await request('quit');
  frame=await open(first,gameOrigin,'independent-weapon-world');snapshot=await request('snapshot');
  check('A same-origin second world using the same base starts with independent state',snapshot.state.ammo===6&&snapshot.state.targetHealth===50);
  let missing=false;try{await request('restore');}catch(error){missing=/Progress is missing/.test(error.message);}check('Second world cannot read the first world save',missing);
  check('A disposed world handle rejects later operations',await page.evaluate(async()=>{try{await oldPreview.request('fire');return false;}catch(error){return /not ready/.test(error.message);}}));
  await request('save');await request('quit');
  frame=await open(first,gameOrigin,'weapon-world');snapshot=await request('restore');
  check('Saving the second world leaves the first world progress intact',JSON.stringify(snapshot.state)===JSON.stringify(saved));
  await request('quit');frame=await open(top,secondOrigin,'town-world');
  const outside=await request('buy');check('Top-down purchase is rejected outside physical shop range',!outside.purchased&&outside.snapshot.state.coins===20&&outside.snapshot.state.apples===0);
  snapshot=await request('approach');const purchase=await request('buy');
  check('Actual 2D movement reaches the shop and transfers coins/items',snapshot.physicalShopOverlap&&purchase.purchased&&purchase.snapshot.state.coins===15&&purchase.snapshot.state.apples===1,purchase.snapshot);
  await capture(frame,'top-down-shop');await page.screenshot({path:path.join(out,'desktop-top-down.png')});
  let invalid=false;try{await request('restore-state',{state:{coins:5,apples:3,position:[{},null]}});}catch(error){invalid=/Progress is invalid/.test(error.message);}
  snapshot=await request('snapshot');check('Invalid 2D restore leaves all state unchanged and the runtime usable',invalid&&JSON.stringify(snapshot.state)===JSON.stringify(purchase.snapshot.state));
  const concurrent=await page.evaluate(()=>Promise.all(['buy','save','quit'].map(op=>previewFixture.handle().request(op))));
  const town=concurrent[1].snapshot.state;check('Concurrent purchase, save and quit drain accepted operations in order',concurrent[0].purchased&&town.coins===10&&town.apples===2&&concurrent[2].exitCode===0);
  frame=await open(top,secondOrigin,'town-world');snapshot=await request('restore');
  check('Top-down runtime restart restores position and inventory',JSON.stringify(snapshot.state)===JSON.stringify(town)&&snapshot.physicalShopOverlap,snapshot);
  let rejected=false;try{await request('run-host-command');}catch(error){rejected=/Unsupported probe operation/.test(error.message);}check('Unknown capabilities return a concrete error',rejected);
  check('Host refuses a game sharing its privileged origin',await page.evaluate(()=>{const frame=document.createElement('iframe');frame.src=location.origin;try{previewFixture.connect(frame,{worldId:'test',buildId:'test'});return false;}catch(error){return /separate HTTP/.test(error.message);}}));
  await request('quit');
  check('All runtime instances requested no focus or pointer lock',report.inputRequests.length===0,report.inputRequests);
  const runtimeErrors=await page.evaluate(()=>previewFixture.handle().errors);
  check('Godot and React report no runtime errors',report.errors.length===0&&runtimeErrors.length===0&&!report.console.some(message=>message.type==='error'),runtimeErrors);
}catch(error){report.errors.push(error.stack);process.exitCode=1;console.error(error);}
finally{
  if(page)report.lastFrameUrls=page.frames().map(frame=>frame.url());
  if(page)await page.screenshot({path:path.join(out,'last-frame.png')}).catch(()=>{});
  if(browser)await browser.close();for(const instance of servers)await new Promise(resolve=>instance.close(resolve));
  if(environment){report.runs=environment.runs;report.builds=environment.builds;}
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('Evidence: '+out);
}
