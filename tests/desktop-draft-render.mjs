// Render recorded real-model geometry in the packaged plugin's actual sandbox.
// The outer bridge is a fixture; this does not apply a candidate to a real world.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {compileScene,INITIAL_SNAPSHOT} from '../app/scene.mjs';

const source=path.resolve(process.argv[2]||'');
const testRoot=fs.realpathSync('test-results');
if(!fs.realpathSync(source).toLowerCase().startsWith(testRoot.toLowerCase()+path.sep))throw Error('Choose recorded geometry inside this checkout test-results');
const trees=JSON.parse(fs.readFileSync(source,'utf8'));
const directory=fs.mkdtempSync(path.resolve('test-results/desktop-draft-render-'));
const browser=await playwright().chromium.launchPersistentContext(path.join(directory,'profile'),{...browserOptions(),viewport:{width:1200,height:850}});
const checks=[],errors=[];
let record;
try {
  await browser.exposeFunction('draftRenderBridge',async(channel,payload)=>{
    if(channel==='app.getAppearance')return {base:'dark'};
    if(channel==='world.list')return {activeWorldId:record.id,worlds:[{id:record.id,title:record.title}]};
    if(channel==='world.open'||channel==='world.saveProgress')return record;
    throw Error('Unsupported render fixture operation: '+channel);
  });
  await browser.addInitScript(()=>{
    globalThis.__draftInputCalls=0;
    Element.prototype.requestPointerLock=()=>{globalThis.__draftInputCalls++;throw Error('Pointer lock disabled');};
    window.focus=()=>{globalThis.__draftInputCalls++;};
    if(window.top===window)globalThis.pluginBridge={invoke:(channel,payload)=>globalThis.draftRenderBridge(channel,payload),on:()=>()=>{}};
  });
  for(const [stage,object] of Object.entries(trees)) {
    const title=stage==='first'?'真实 PI 创作 · 初稿':'真实 PI 创作 · 放大树冠';
    const compiled=compileScene({format:'craftmine.scene/3',title,night:false,objects:[object],systems:[],behaviors:[]});
    record={id:'render-'+stage,title,revision:0,world:{build:{...compiled,id:'v-'+compiled.hash.slice(0,20)},snapshot:{...structuredClone(INITIAL_SNAPSHOT),player:{...INITIAL_SNAPSHOT.player,x:3.3,z:12}},extensions:[]}};
    const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve('desktop/build/craftmine.world/views/world.html')).href);
    await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true',null,{timeout:10000});
    const state=await page.evaluate(()=>craftmineView.snapshot());
    assert.equal(state.snapshot.player.x,3.3);
    await page.locator('iframe').screenshot({path:path.join(directory,stage+'.png')});
    for(const frame of page.frames())assert.equal(await frame.evaluate(()=>globalThis.__draftInputCalls),0);
    checks.push({name:'Render recorded '+stage+' geometry with no input',passed:true});
    await page.close();
  }
  assert.deepEqual(errors,[]);
}catch(error){errors.push(String(error));process.exitCode=1;console.error(error);}
finally {
  await browser.close();
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({scope:'Actual bundled world renderer and real-model object geometry; fixture outer bridge, no candidate publishing',checks,errors},null,2));
  console.log('Draft rendering report: '+path.join(directory,'report.json'));
}
