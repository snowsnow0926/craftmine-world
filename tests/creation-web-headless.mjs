// Real exported Web PCK through the product loopback transport, with no UI input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
import {createWorldRuntime} from '../desktop/godot/web/runtime.mjs';
import {playwright,browserOptions} from '../app/browser-tools.mjs';

const root=path.resolve(import.meta.dirname,'..'),sourceRoot=path.resolve(process.env.CRAFTMINE_STORY_SOURCE_ROOT||root);
const {materializeBase}=await import(pathToFileURL(path.join(sourceRoot,'desktop/godot/shared/materialize.mjs')));
const {deriveAdditiveProgress}=await import(pathToFileURL(path.join(sourceRoot,'desktop/godot/shared/progress-migration.mjs')));
const require=createRequire(import.meta.url),{generateSequenceDoorRule}=require('../plugins/craftmine-world/creation-sequence-rule.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/creation-web-'));
const report={kind:'真实导出 Web 造物规则与进度迁移',out,sourceRoot,checks:[],runs:[],versions:[],errors:[],limits:['固定作者场景，不代表模型首次成功率或生产 LPAC 执行器','独立 headless 浏览器和页面脚本协议，无真实鼠标键盘输入']};
const check=(name,value)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
let browser,runtime,page;
try {
  const environment=await createGodotProbeEnvironment(out,{web:true,threads:true});report.runs=environment.runs;
  const hostSource=fs.readFileSync(path.join(sourceRoot,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8');
  const literal=hostSource.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/);
  assert.ok(literal,'Product export preset must be statically inspectable');
  const trustedPreset=JSON.parse(literal[1]);
  check('生产可信导出预设保留规则源码与 JSON',trustedPreset.includes('script_export_mode=0')&&/include_filter="[^"\n]*\*\.json/.test(trustedPreset));
  report.trustedPresetSha256=hash(trustedPreset);
  browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser-profile'),{...browserOptions(),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  const entity=(id,kind,position,parameters={})=>({id,kind,position,rotationY:0,scale:[1,1,1],color:'#84a866',parameters});
  const originalRule=generateSequenceDoorRule({id:'original-rule',doorId:'original-door',sequence:['marker-a','marker-b']});
  const customText=fs.readFileSync(path.join(sourceRoot,'plugins/craftmine-world/guidance/references/double-press-rule.gd'),'utf8');
  const customRule={id:'double-press',kind:'sequence-door',doorId:'second-door',sequence:['marker-a','marker-b'],script:'scripts/creation/rules/double-press.gd',sha256:hash(customText)};
  let previous;
  for(const version of ['original','candidate']){
    const project=path.join(out,version),exportRoot=path.join(out,version+'-export');fs.mkdirSync(exportRoot);
    materializeBase({baseId:'creation-sandbox',worldId:'creation-web',out:project});
    const scene={format:'craftmine.creation-scene/1',revision:version==='original'?1:2,defaults:{timeOfDay:version==='original'?12:18},entities:[entity('chest','chest',[2,0,4],{rewardId:'web-token',rewardCount:2}),entity('original-door','door',[-4,0,2]),entity('marker-a','marker',[-2,0,4]),entity('marker-b','marker',[-2,0,6])],rules:[originalRule.declaration]};
    fs.mkdirSync(path.join(project,'scripts/creation/rules'),{recursive:true});fs.writeFileSync(path.join(project,originalRule.declaration.script),originalRule.text);
    if(version==='candidate'){scene.entities.push(entity('second-door','door',[-8,0,2]));scene.rules.push(customRule);fs.writeFileSync(path.join(project,customRule.script),customText);}
    fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify(scene));
    fs.copyFileSync(path.join(sourceRoot,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));
    fs.writeFileSync(path.join(project,'export_presets.cfg'),trustedPreset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(environment.webTemplate.replaceAll('\\','/'))));
    await environment.run(version+'-import',['--path',project,'--editor','--import']);
    await environment.run(version+'-export',['--path',project,'--export-release','Web',path.join(exportRoot,'index.html')],{timeout:120000});
    fs.copyFileSync(path.join(sourceRoot,'desktop/godot/web/bridge.js'),path.join(exportRoot,'bridge.js'));
    runtime=await createWorldRuntime({worldId:'creation-web',buildId:'web-'+version,root:exportRoot,timeoutMs:60000});
    page=await browser.newPage();const pageErrors=[],consoleErrors=[];
    page.on('pageerror',error=>pageErrors.push(String(error)));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    await page.exposeFunction('__runtimePost',message=>runtime.receive(message));
    await page.addInitScript(scope=>{
      globalThis.__inputGuard={pointerLock:0,focus:0};
      Element.prototype.requestPointerLock=function(){globalThis.__inputGuard.pointerLock++;throw Error('Pointer lock disabled in headless acceptance');};
      window.focus=()=>{globalThis.__inputGuard.focus++;};
      const handlers=[];globalThis.__craftmineRuntimeHost={scope,post:message=>void globalThis.__runtimePost(message),on:handler=>handlers.push(handler),onDetach:()=>{}};
      globalThis.__runtimeDeliver=message=>{for(const handler of handlers)handler(message);};
    },{worldId:runtime.worldId,buildId:runtime.buildId,instanceId:runtime.instanceId});
    runtime.attach(message=>page.evaluate(value=>globalThis.__runtimeDeliver(value),message));
    await page.goto(runtime.url,{waitUntil:'domcontentloaded'});await runtime.waitReady();
    const command=async(op,args={})=>(await runtime.request(op,args)).result;
    await command('load');const defaults=(await command('snapshot')).state;
    const record={version,defaults,pageErrors,consoleErrors};report.versions.push(record);
    check(version+'：实际 Web PCK 加载动态脚本及哈希校验成功',defaults.baseId==='creation-sandbox');
    if(previous){const proof=deriveAdditiveProgress(previous,defaults);record.migration=proof;await command('restore-state',{snapshot:proof.snapshot});assert.deepEqual((await command('snapshot')).state,proof.snapshot);check('Web 候选完整恢复迁移字段',true);}
    await command('resume');await command('wait',{frames:20});
    const interact=async id=>{
      const observation=await command('observe'),target=scene.entities.find(entity=>entity.id===id).position;
      const position=observation.player.position,dx=target[0]-position[0],dz=target[2]-position[2],dy=0.65-(position[1]+0.65);
      await command('look',{yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(dy,Math.hypot(dx,dz))});await command('wait',{frames:1});
      const aimed=await command('observe');assert.equal(aimed.creation.target.entityId,id);
      return command('interact');
    };
    if(version==='original'){
      assert.equal((await interact('chest')).interacted,true);
      await interact('marker-a');await interact('marker-b');await command('set-time',{hours:21});
      await command('pause');previous=(await command('snapshot')).state;
      check('Web 普通机关开门并获得一次奖励',previous.body.doors['original-door']&&previous.body.inventory['web-token']===2);
    }else{
      const state=(await command('snapshot')).state;assert.equal(state.body.sourceTimeOfDay,18);assert.equal(state.body.timeOfDay,18);
      check('候选保留旧门与奖励，新规则保持初始状态',state.body.doors['original-door']&&state.body.inventory['web-token']===2&&!state.body.doors['second-door']&&state.body.rules['double-press'].presses===0);
      await interact('marker-a');await interact('marker-b');check('新源码玩法拒绝只按一次的旧顺序',!(await command('snapshot')).state.body.doors['second-door']);
      await interact('marker-a');await interact('marker-a');await interact('marker-b');
      check('非预置双按规则在 Web PCK 实际开门',(await command('snapshot')).state.body.doors['second-door']);
      assert.equal((await interact('chest')).reason,'already-opened');
      check('Web 迁移后宝箱不重复奖励',(await command('snapshot')).state.body.inventory['web-token']===2);
    }
    await command('pause');record.final=(await command('snapshot')).state;
    await page.screenshot({path:path.join(out,version+'.png')});record.inputGuard=await page.evaluate(()=>globalThis.__inputGuard);
    check(version+'：无 Pointer Lock 或窗口置前',record.inputGuard.pointerLock===0&&record.inputGuard.focus===0);
    check(version+'：无脚本错误',pageErrors.length===0&&!consoleErrors.some(error=>/SCRIPT ERROR|Parse Error|source hash mismatch/.test(error)));
    await runtime.dispose({graceful:true});runtime=null;await page.close();page=null;
  }
}catch(error){report.errors.push(String(error.stack));console.error(error.stack);process.exitCode=1;}
finally{await runtime?.dispose({graceful:false});await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Evidence: '+out);}
