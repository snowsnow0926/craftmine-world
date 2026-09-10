// Adversarial test fixture only: actual Web export + the production requirement helper.
// No model request, user profile, real input, foreground window or pointer lock.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
const reviewRoot=path.resolve(process.env.CRAFTMINE_REVIEW_ROOT??path.join(import.meta.dirname,'..'));
const fromRoot=relative=>import(pathToFileURL(path.join(reviewRoot,relative)).href);
const {materializeBase}=await fromRoot('desktop/godot/shared/materialize.mjs');
const {createGodotProbeEnvironment}=await fromRoot('desktop/godot/toolchain.mjs');
const {createWorldRuntime}=await fromRoot('desktop/godot/web/runtime.mjs');
const {freezeCreationRequirements}=await fromRoot('vendor/pi-desktop/apps/desktop/electron/main/creation-check-requirements.ts');
const {readGodotCreationObservation,godotCreationMatches}=await fromRoot('vendor/pi-desktop/apps/desktop/electron/main/godot-check-requirements.ts');
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/observation-forgery-')),project=path.join(out,'project'),exportRoot=path.join(out,'web');fs.mkdirSync(exportRoot);
const report={format:'craftmine.creation-observation-forgery/1',reviewRoot,out,sourceHashes:{},checks:[],console:[],passed:false};
for(const relative of ['desktop/godot/bases/creation-sandbox/scripts/creation_world.gd','desktop/godot/shared/adapters/creation-sandbox.gd','vendor/pi-desktop/apps/desktop/electron/main/creation-check-requirements.ts','vendor/pi-desktop/apps/desktop/electron/main/godot-check-requirements.ts'])report.sourceHashes[relative]=createHash('sha256').update(fs.readFileSync(path.join(reviewRoot,relative))).digest('hex');
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);};let runtime,browser;
try{
 materializeBase({baseId:'creation-sandbox',worldId:'forgery-world',out:project});
 const entity={id:'tree-a',kind:'tree',position:[4,0,0],scale:[1,1,1],rotationY:0,color:'#84a866',parameters:{}};
 fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities:[entity]}));
 const worldPath=path.join(project,'scripts/creation_world.gd');let script=fs.readFileSync(worldPath,'utf8');
 assert.ok(script.includes('\t\tdefinitions.append(definition)'));
 script=script.replace('\tready_for_play = true','\tentity_nodes["tree-a"].get_node("Body").get_child(0).disabled = true\n\tready_for_play = true');
 script=script.replace('\t\tdefinitions.append(definition)', '\t\tif id == "tree-a":\n\t\t\tprint("COUNTEREXAMPLE_ACTUAL=" + JSON.stringify({"scale":[actual_node.scale.x,actual_node.scale.y,actual_node.scale.z],"solid":not actual_node.get_node("Body").get_child(0).disabled}))\n\t\t\tdefinition["scale"] = [2,2,2]\n\t\t\tdefinition["solid"] = true\n\t\t\tdefinition["visible"] = true\n\t\tdefinitions.append(definition)');
 fs.writeFileSync(worldPath,script);report.forgedWorldSha256=createHash('sha256').update(script).digest('hex');
 const env=await createGodotProbeEnvironment(out,{web:true,threads:true});report.engineRuns=env.runs;
 const source=fs.readFileSync(path.join(reviewRoot,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8'),preset=JSON.parse(source.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/)[1]);
 fs.copyFileSync(path.join(reviewRoot,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));fs.writeFileSync(path.join(project,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(env.webTemplate.replaceAll('\\','/'))));
 await env.run('import',['--path',project,'--editor','--import']);await env.run('export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});fs.copyFileSync(path.join(reviewRoot,'desktop/godot/web/bridge.js'),path.join(exportRoot,'bridge.js'));
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'profile'),{...browserOptions(),headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 runtime=await createWorldRuntime({worldId:'forgery-world',buildId:'forged-observation',root:exportRoot,timeoutMs:60000});const page=await browser.newPage();page.on('console',message=>report.console.push(message.text()));
 await page.exposeFunction('__post',message=>runtime.receive(message));await page.addInitScript(scope=>{globalThis.inputRequests=0;Element.prototype.requestPointerLock=()=>{inputRequests++;throw Error('disabled');};window.focus=()=>{inputRequests++;throw Error('disabled');};const handlers=[];globalThis.__craftmineRuntimeHost={scope,post:message=>void globalThis.__post(message),on:handler=>handlers.push(handler),onDetach:()=>{}};globalThis.__deliver=message=>handlers.forEach(handler=>handler(message));},{worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId});runtime.attach(message=>page.evaluate(value=>globalThis.__deliver(value),message));
 await page.goto(runtime.url,{waitUntil:'domcontentloaded'});await runtime.waitReady();assert.ok(!(await runtime.load()).error);
 const required=freezeCreationRequirements({target:{entityId:'tree-a',position:[4,0,0]},entities:[entity]},'把这棵树放大到2倍');assert.equal(required.status,'verifiable');report.requirement=required;
 for(const phase of ['loaded','running']){
  if(phase==='running')await runtime.resume();
  const raw=(await runtime.request('observe-envelope')).result;const observation=readGodotCreationObservation(raw,runtime,phase);report[phase]={raw,observation,productionHelperPassed:godotCreationMatches(observation,{format:'craftmine.godot-check-requirements/1',creation:required.requirements})};
 }
 const truthLines=report.console.filter(line=>line.includes('COUNTEREXAMPLE_ACTUAL='));assert.ok(truthLines.length);const truth=JSON.parse(truthLines.at(-1).split('COUNTEREXAMPLE_ACTUAL=')[1]);report.actualNode=truth;
 check('真实Web节点保持错误1倍尺寸和关闭碰撞',JSON.stringify(truth.scale)==='[1,1,1]'&&truth.solid===false);
 if(process.env.CRAFTMINE_EXPECT_FORGERY_REJECTED!=='0')check('固定adapter独立采样覆盖谎报字段',JSON.stringify(report.running.observation.entities[0].scale)==='[1,1,1]'&&report.running.observation.entities[0].solid===false);
 else check('篡改后的观察声明2倍且有碰撞',JSON.stringify(report.running.observation.entities[0].scale)==='[2,2,2]'&&report.running.observation.entities[0].solid===true);
 if(process.env.CRAFTMINE_EXPECT_FORGERY_REJECTED!=='0')check('生产愿望helper拒绝虚假观察',!report.loaded.productionHelperPassed&&!report.running.productionHelperPassed);
 else check('生产愿望helper在loaded与running阶段均被虚假观察通过',report.loaded.productionHelperPassed&&report.running.productionHelperPassed);
 const honest={...report.running.observation,entities:report.running.observation.entities.map(item=>({...item,scale:truth.scale,solid:truth.solid}))};check('同一helper对真实节点数据拒绝',!godotCreationMatches(honest,{format:'craftmine.godot-check-requirements/1',creation:required.requirements}));
 check('没有输入和焦点请求',await page.evaluate(()=>inputRequests===0));report.passed=true;report.finding=report.loaded.productionHelperPassed&&report.running.productionHelperPassed?'confirmed: editable world.observe can forge requirement observations':'forged observation rejected';
 report.scope='真实Web导入/导出/运行与生产readGodotCreationObservation+godotCreationMatches双阶段；没有调用完整GodotBuildVerifier、候选采用或模型。';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{await runtime?.dispose({graceful:false}).catch(()=>{});await browser?.close().catch(()=>{});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,checks:report.checks,error:report.error}));}
