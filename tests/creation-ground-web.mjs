// Export stock sources and inspect actual WebGL pixels in an isolated browser.
// Optional retained source is read/copied only; no player profile is mutated.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {createWorldRuntime} from '../desktop/godot/web/runtime.mjs';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
let PNG;try{({PNG}=require('pngjs'));}catch{({PNG}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs')));}
function groundPixels(buffer){
 const png=PNG.sync.read(buffer),sum=[0,0,0];let pixels=0,brightCyan=0;
 // Ground-only rectangle below the crosshair, away from side walls/HUD.
 for(let y=Math.floor(png.height*.70);y<Math.floor(png.height*.95);y++)for(let x=Math.floor(png.width*.2);x<Math.floor(png.width*.8);x++){
  const offset=(y*png.width+x)*4;pixels++;for(let c=0;c<3;c++)sum[c]+=png.data[offset+c];
  if(png.data[offset+1]>240&&png.data[offset+2]>220)brightCyan++;
 }
 return {meanRgb:sum.map(value=>value/pixels),brightCyanFraction:brightCyan/pixels,pixels};
}
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/creation-ground-'));
const retained=process.env.CRAFTMINE_GROUND_SOURCE;
const report={out,retainedSource:retained??null,versions:[],errors:[]};
let browser,runtime;
try{
 const environment=await createGodotProbeEnvironment(out,{web:true,threads:true});
 const host=fs.readFileSync(path.join(root,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8');
 const preset=JSON.parse(host.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/)[1]);
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser-profile'),{...browserOptions(),viewport:{width:1280,height:720},args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 for(const version of ['retained','current']){
  const project=path.join(out,version),exportRoot=path.join(out,version+'-export');fs.mkdirSync(exportRoot);
  materializeBase({baseId:'creation-sandbox',worldId:'ground-test',out:project});
  if(version==='retained'){
   if(retained) fs.copyFileSync(path.join(retained,'scripts/creation_world.gd'),path.join(project,'scripts/creation_world.gd'));
   else {const file=path.join(project,'scripts/creation_world.gd');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('Color("4f6b5a")','Color("6e9580")').replace('ambient_light_energy = 0.55','ambient_light_energy = 0.7'));}
  }
  fs.copyFileSync(path.join(root,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));
  fs.writeFileSync(path.join(project,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(environment.webTemplate.replaceAll('\\','/'))));
  await environment.run(version+'-import',['--path',project,'--editor','--import']);
  await environment.run(version+'-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});
  fs.copyFileSync(path.join(root,'desktop/godot/web/bridge.js'),path.join(exportRoot,'bridge.js'));
  runtime=await createWorldRuntime({worldId:'ground-test',buildId:version,root:exportRoot,timeoutMs:60000});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.exposeFunction('__runtimePost',message=>runtime.receive(message));
  await page.addInitScript(scope=>{
   globalThis.__inputGuard={pointerLock:0,focus:0};Element.prototype.requestPointerLock=function(){globalThis.__inputGuard.pointerLock++;throw Error('Disabled in background test');};window.focus=()=>globalThis.__inputGuard.focus++;
   const handlers=[];globalThis.__craftmineRuntimeHost={scope,post:message=>void globalThis.__runtimePost(message),on:handler=>handlers.push(handler),onDetach:()=>{}};globalThis.__runtimeDeliver=message=>handlers.forEach(handler=>handler(message));
  },{worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId});
  runtime.attach(message=>page.evaluate(value=>globalThis.__runtimeDeliver(value),message));
  await page.goto(runtime.url,{waitUntil:'domcontentloaded'});await runtime.waitReady();
  const command=async(op,args={})=>(await runtime.request(op,args)).result;
  await command('load');await command('resume');await command('wait',{frames:20});await command('pause');
  const pixels=groundPixels(await page.screenshot({path:path.join(out,version+'.png')}));
  const state=await command('snapshot'),guard=await page.evaluate(()=>globalThis.__inputGuard);
  assert.deepEqual(guard,{pointerLock:0,focus:0});assert.equal(errors.length,0);
  report.versions.push({version,state,guard,errors,pixels,screenshot:path.join(out,version+'.png')});
  await runtime.dispose({graceful:true});runtime=null;await page.close();
 }
 const [before,after]=report.versions;
 assert.deepEqual(after.state,before.state,'lighting upgrade preserves gameplay snapshot');
 assert.ok(before.pixels.meanRgb[1]-after.pixels.meanRgb[1]>30,'actual rendered green channel drops by more than 30/255');
 assert.ok(before.pixels.brightCyanFraction>.9&&after.pixels.brightCyanFraction<.01,'bright cyan ground is removed in actual WebGL pixels');
 report.runs=environment.runs;
}catch(error){report.errors.push(String(error.stack));process.exitCode=1;}
finally{await runtime?.dispose({graceful:false});await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
