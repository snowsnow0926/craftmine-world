import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fork} from 'node:child_process';
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';
import {ProjectStore} from '../app/store.mjs';
import {withAppearanceFormat,canonicalJSON} from '../app/scene.mjs';
import {defaultAppearance} from '../app/asset-binding.mjs';
import {gameplayScene} from './scene-fixtures.mjs';
import {png} from './asset-fixtures.mjs';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {desktopRuntimePaths} from './helpers/desktop-runtime-paths.mjs';

fs.mkdirSync('test-results',{recursive:true});
const dir=fs.mkdtempSync(path.resolve('test-results/desktop-legacy-'));
const source=path.join(dir,'old-project/.craftmine');
const store=new ProjectStore(source);
let seed=8157;
const texture=png(800,800,()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return [seed&255,(seed>>>8)&255,(seed>>>16)&255,255];});
const asset=store.assets.prepare(store.data,{id:null,baseVersion:null,name:'旧世界贴图',filename:'garden.png',mime:'image/png',data:texture.toString('base64')});
store.change(data=>store.assets.register(data,asset));
const extension={
  format:'craftmine.extension/1',id:'legacy-drain',name:'旧世界伤害扩展',version:1,description:'导入后仍由真实 Worker 调用',
  requires:[],permissions:['targets.write'],targets:['target-one'],
  provides:{commands:[{type:'legacy.damage',permission:'targets.write',fields:[{name:'targetId',description:'目标'},{name:'amount',description:'伤害'}]}],events:[]},
  code:'export function apply({command,state}){return {state:{calls:(state?.calls||0)+1},effects:[{type:"target.damage",id:command.targetId,amount:command.amount}]};}',
  selfTests:[{name:'目标受伤',world:{objects:[{id:'target-one',health:60}]},commands:[{type:'legacy.damage',targetId:'target-one',amount:10}],expect:[{id:'damage',kind:'objectHealth',object:'target-one',max:50,why:'真实受伤',red:'没有扣血',step:'command-1'}]}],
};
store.change(data=>{data.extensions=[extension];});
const scene=withAppearanceFormat({...gameplayScene(),format:'craftmine.scene/4',behaviors:[{
  format:'craftmine.behavior/2',id:'legacy-once',name:'只触发一次',description:'迁移扩展并保留状态',stateVersion:1,initialState:{},params:{},
  targets:['target-one'],permissions:['targets.write'],requires:['ext:legacy-drain@1'],binding:null,keys:[],
  code:'export function step({frame,state}){if(state.fired||frame.event.type!=="start")return {state,commands:[]};return {state:{fired:true},commands:[{type:"legacy.damage",targetId:"target-one",amount:10}]};}',
}]});
scene.objects[0].appearance=defaultAppearance(scene.objects[0],asset);
const built=store.build(scene);
const candidate=store.build({...scene,title:'未应用的下一版'});
store.change(data=>{
  data.current=built.id;data.snapshot.player.x=8;data.snapshot.player.yaw=0.97;data.snapshot.player.pitch=0.04;
  store.modules.capture(data,scene,'此前已经做过的创作',built.id);
  data.candidate={id:candidate.id,base:built.id,summary:'未应用候选'};
  data.tasks=[{id:'old-running-task',status:'running',prompt:'尚未完成的想法'}];
});
fs.mkdirSync(path.join(source,'tasks/old-running-task'),{recursive:true});
fs.writeFileSync(path.join(source,'tasks/old-running-task/draft.json'),JSON.stringify({code:'unfinished source',changed:['behavior:new-action']}));
function digests(root) {
  const result={};
  for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const name=path.join(root,entry.name);
    if(entry.isDirectory())for(const [key,value] of Object.entries(digests(name)))result[entry.name+'/'+key]=value;
    else result[entry.name]=createHash('sha256').update(fs.readFileSync(name)).digest('hex');
  }
  return result;
}
const original=digests(source);
const {desktop,plugin,binary,hostEntry}=desktopRuntimePaths(dir);
const previous=process.env.PI_DESKTOP_DATA_DIR;
process.env.PI_DESKTOP_DATA_DIR=path.join(dir,'pi-host');
register(pathToFileURL(path.join(desktop,'test/helpers/ts-import-hooks.mjs')));
const {PluginRuntime}=await import(pathToFileURL(path.join(desktop,'electron/main/plugin-runtime.ts')).href);
const checks=[],errors=[];
const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
let selectedSource=path.dirname(source),browser,page;
const runtime=new PluginRuntime({hostEntry,pickDirectory:async()=>selectedSource,spawnProcess:({entry})=>{
  const child=fork(entry,[],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_CORE_BIN:binary}});
  return {postMessage:message=>{if(child.connected)child.send(message);},onMessage:handler=>child.on('message',handler),onExit:handler=>child.on('exit',code=>handler(code??0)),kill:()=>child.kill()};
}});
const permissions=['ui.view','agent.tool.register','background.service','fs.read'];
const bridge=(channel,payload={})=>runtime.invokePanelBridge('craftmine.world',channel,payload);
try {
  await runtime.loadFromPath(plugin,permissions);
  const empty=await bridge('world.create',{title:'已有桌面世界'});
  await assert.rejects(bridge('world.importLegacy',{source}),/Choose the legacy/);
  check('未通过文件夹选择不能从页面伪造导入路径',true);
  browser=await playwright().chromium.launchPersistentContext(path.join(dir,'profile'),browserOptions());
  await browser.addInitScript(()=>{
    globalThis.__inputRequests=0;Element.prototype.requestPointerLock=()=>{globalThis.__inputRequests++;throw Error('Pointer lock disabled');};window.focus=()=>{globalThis.__inputRequests++;};
    if(window===top)globalThis.pluginBridge={invoke:(channel,payload)=>globalThis.__craftmineBridge(channel,payload)};
  });
  page=await browser.newPage();
  await page.exposeBinding('__craftmineBridge',(caller,channel,payload)=>{
    if(caller.frame!==page.mainFrame())throw Error('Only the trusted panel may invoke the bridge');
    return bridge(channel,payload);
  });
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(plugin,'views/world.html')).href);
  await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true'&&!document.getElementById('import-world').disabled);
  // Submit the real panel form. The directory service returns a fixture path;
  // no native dialog, focus request or input simulation is used.
  await page.evaluate(()=>document.getElementById('import-form').requestSubmit());
  await page.waitForFunction(id=>(document.body.dataset.worldLoaded==='true'&&document.body.dataset.worldId!==id)||!document.getElementById('error').hidden,empty.id,{timeout:30000});
  assert.equal(await page.evaluate(()=>document.getElementById('error').hidden),true,await page.evaluate(()=>document.getElementById('error').textContent));
  const importedId=await page.evaluate(()=>document.body.dataset.worldId);
  const imported=await bridge('world.open',{id:importedId});
  check('真实界面导入旧世界且保留已有桌面世界',(await bridge('world.list')).worlds.length===2&&imported.world.build.id===built.id);
  check('大于旧 2 MB 上限的实际图片素材完整进入 Rust',JSON.stringify(imported.world).length>2_000_000&&imported.world.build.assets[0].hash===asset.hash&&imported.world.build.assets[0].data===asset.data);
  check('树、花草、源码与扩展依赖保持原有版本',canonicalJSON(imported.world.build.scene)===canonicalJSON(built.scene)&&canonicalJSON(imported.world.extensions)===canonicalJSON([extension]));
  const progress=(await page.evaluate(()=>craftmineView.snapshot())).snapshot;
  check('导入后真实 Worker 调用扩展并改变目标生命值',progress.player.x===8&&progress.gameplay.targets['target-one'].health===50);
  await page.evaluate(()=>craftmineView.prepareClose());
  check('导入和运行未更改任何原项目文件',canonicalJSON(digests(source))===canonicalJSON(original));
  const archiveRoot=path.join(process.env.PI_DESKTOP_DATA_DIR,'plugins','data','craftmine.world','legacy-imports',importedId);
  const archiveSource=path.join(archiveRoot,'source');
  check('原始候选、草稿、历史模块和所有文件逐个哈希一致',canonicalJSON(digests(archiveSource))===canonicalJSON(original));
  const archivedProject=JSON.parse(fs.readFileSync(path.join(archiveSource,'project.json')));
  check('旧的未完成任务只保存在备份中，没有重新执行',archivedProject.tasks[0].status==='running'&&archivedProject.candidate.id===candidate.id&&archivedProject.library.length>0);
  check('整个导入没有请求鼠标锁定或窗口焦点',(await Promise.all(page.frames().map(frame=>frame.evaluate(()=>globalThis.__inputRequests||0)))).every(value=>value===0));
  await page.screenshot({path:path.join(dir,'imported-world.png')});
  await page.close();await runtime.unload('craftmine.world');
  await runtime.loadFromPath(plugin,permissions);
  const reopened=await browser.newPage();
  await reopened.exposeBinding('__craftmineBridge',(caller,channel,payload)=>{if(caller.frame!==reopened.mainFrame())throw Error('Untrusted frame');return bridge(channel,payload);});
  reopened.on('pageerror',error=>errors.push(error.message));
  await reopened.goto(pathToFileURL(path.join(plugin,'views/world.html')).href);
  await reopened.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
  const restored=(await reopened.evaluate(()=>craftmineView.snapshot())).snapshot;
  check('完整重启保留位置和扩展状态且不会重复扣血',restored.player.x===8&&restored.gameplay.targets['target-one'].health===50);
  await reopened.evaluate(()=>craftmineView.prepareClose());await reopened.close();
  const broken=path.join(dir,'broken-legacy');fs.cpSync(source,broken,{recursive:true});
  const brokenData=JSON.parse(fs.readFileSync(path.join(broken,'project.json')));brokenData.extensions=[];
  fs.writeFileSync(path.join(broken,'project.json'),JSON.stringify(brokenData));
  selectedSource=broken;await bridge('fs.requestDirectory');
  await assert.rejects(bridge('world.importLegacy',{source}),/扩展|依赖|requires/);
  check('缺少扩展的旧世界拒绝导入且不覆盖当前世界',(await bridge('world.list')).worlds.length===2&&(await bridge('world.list')).activeWorldId===importedId);
  if(process.platform==='win32') {
    fs.symlinkSync(source,path.join(broken,'linked-world'),'junction');
    await assert.rejects(bridge('world.importLegacy'),/链接/);
    check('Windows 链接目录不会绕过备份边界或递归复制',(await bridge('world.list')).worlds.length===2);
  }
  selectedSource=source;await bridge('fs.requestDirectory');
  const forged=await bridge('world.importLegacy',{source:broken});
  check('页面传入的路径不能替换宿主刚选中的文件夹',forged.record.world.build.id===built.id);
  check('后台页面没有未处理异常',errors.length===0);
} catch(error){
  errors.push(error.stack);process.exitCode=1;console.error(error);
  if(page&&!page.isClosed())console.error(await page.evaluate(()=>({world:document.body.dataset,status:document.getElementById('world-status').textContent,error:document.getElementById('error').textContent})));
}
finally {
  await browser?.close();for(const item of runtime.listLoaded())await runtime.unload(item.manifest.id);
  if(previous===undefined)delete process.env.PI_DESKTOP_DATA_DIR;else process.env.PI_DESKTOP_DATA_DIR=previous;
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({checks,errors},null,2));console.log('Report: '+path.join(dir,'report.json'));
}
