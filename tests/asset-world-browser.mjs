import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
import { behaviorScene } from './behavior-fixtures.mjs';
import { png,triangleFixture } from './asset-fixtures.mjs';
import { withAppearanceFormat,INITIAL_SNAPSHOT } from '../app/scene.mjs';
import { defaultAppearance } from '../app/asset-binding.mjs';
import { part } from './scene-fixtures.mjs';
const w=await workbench('asset-world'),spawn={format:'craftmine.progress/1',player:{x:0,y:6,z:10,yaw:0,pitch:0}};
async function importAsset(bytes,mime,name,old=null){const result=await w.api('/api/assets/import',{id:old?.id||null,baseVersion:old?.version||null,name,filename:name+(mime==='image/png'?'.png':'.glb'),mime,data:bytes.toString('base64')});return w.api('/api/assets/read?id='+result.id+'&version='+result.version);}
async function bindViaUI(asset,objectId='door-one'){
  await w.domClick('[data-view="assets"]');await w.page.waitForFunction(({id,version})=>!!document.querySelector(`[data-asset-id="${id}"] option[value="${version}"]`),{id:asset.id,version:asset.version});
  await w.page.evaluate(({id,version,objectId})=>{const target=document.getElementById('asset-target');target.value=objectId;target.onchange();const card=document.querySelector(`[data-asset-id="${id}"]`),select=card.querySelector('select');select.value=String(version);select.onchange();[...card.querySelectorAll('button')].find(b=>b.textContent==='用于所选对象').onclick();},{...asset,objectId});
  await w.page.locator('#candidate').waitFor({state:'visible',timeout:20000});
}
try{
  await w.load(behaviorScene(),spawn);const original=(await w.api('/api/state')).current;
  const image=await importAsset(png(40,100,[240,30,60,255]),'image/png','红色门');await bindViaUI(image);let state=await w.api('/api/state');
  w.check('素材界面为所选对象生成独立外观候选',state.current===original&&!!state.candidate&&state.candidate.diff.details.items.length===1&&state.candidate.diff.details.items[0].fields.join()==='appearance');
  await w.game().locator('#interact').evaluate(el=>el.onclick());const latest=await w.snapshot();await w.apply();state=await w.api('/api/state');const first=state.current,build=await w.api('/api/build?id='+first),saved=await w.snapshot();
  w.check('应用外观保留候选生成之后的最新开门状态与位置',saved.behaviors.modules['sliding-door'].state.open&&saved.behaviors.modules['sliding-door'].overrides['door-one'].offset.x===1.2&&JSON.stringify(saved.player)===JSON.stringify(latest.player));
  w.check('外观绑定保留原碰撞和实际源码，运行构建携带准确素材',JSON.stringify(build.scene.objects[0].parts)===JSON.stringify(behaviorScene().objects[0].parts)&&build.scene.behaviors[0].code===behaviorScene().behaviors[0].code&&build.assets[0].hash===image.hash);
  await w.saveScreenshot('image-door-open');
  const second=await importAsset(png(40,100,[30,200,80,255]),'image/png','红色门',image);w.check('素材新版导入不会自动改变已安装对象',(await w.api('/api/build?id='+first)).scene.objects[0].appearance.asset.version===1);
  await bindViaUI(second);await w.domClick('#review-open');await w.page.waitForFunction(()=>document.querySelector('#review-canvas iframe:not(.staging)')&&!document.getElementById('review-after').disabled);
  w.check('外观版本在独立候选副本中载入，差异可审查且原世界未提交',(await w.page.locator('#review-items').textContent()).includes('素材外观')&&(await w.api('/api/state')).current===first);
  await w.domClick('#review-before');await w.page.waitForFunction(()=>document.getElementById('review-before').getAttribute('aria-pressed')==='true'&&!document.getElementById('review-before').disabled);await w.domClick('#review-close');await w.apply();const secondWorld=(await w.api('/api/state')).current;await bindViaUI(image);await w.apply();
  w.check('可在素材卡片选择旧版回退外观并保留门进度',(await w.api('/api/state')).current===first&&(await w.snapshot()).behaviors.modules['sliding-door'].state.open);
  await w.api('/api/save',{version:first,snapshot:await w.snapshot()});await w.close();await w.start();
  w.check('重启后素材原始文件、固定引用和运行状态都恢复',(await w.snapshot()).behaviors.modules['sliding-door'].state.open&&(await w.api('/api/build?id='+first)).assets[0].version===1);
  const probe=await w.page.context().newPage();await probe.goto(new URL('/verify',w.page.url()).href);
  const unavailable=await probe.frameLocator('iframe').locator('body').evaluate(async(_,{build,spawn})=>{
    const {makeWorldRuntime}=await import('/app/world-runtime.mjs'),canvas=document.createElement('canvas');document.body.append(canvas);const get=canvas.getContext.bind(canvas);canvas.getContext=(type,...args)=>type==='webgl'?null:get(type,...args);const Runtime=makeWorldRuntime({send:()=>{},inform:()=>{},enter:document.getElementById('enter')}),engine=new Runtime(canvas,{});engine.setActive(false);try{await engine.generateBuild(build,spawn);return '';}catch(error){return error.message;}finally{engine.dispose();canvas.remove();}
  },{build,spawn});w.check('缺少 WebGL 明确拒绝素材世界，已有世界未受影响',unavailable.includes('需要 WebGL')&&(await w.api('/api/state')).current===first);
  const physics=await probe.frameLocator('iframe').locator('body').evaluate(async(_,{build,spawn})=>{
    const {primitiveVertices}=await import('/app/geometry.mjs');const {makeWorldRuntime}=await import('/app/world-runtime.mjs'),Runtime=makeWorldRuntime({send:()=>{},inform:()=>{},enter:document.getElementById('enter')}),engine=new Runtime(document.getElementById('world'),{});
    const pixels=()=>{engine.render(2);const gl=engine.gl,raw=new Uint8Array(engine.canvas.width*engine.canvas.height*4);gl.readPixels(0,0,engine.canvas.width,engine.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,raw);let count=0,x=0;for(let i=0;i<raw.length;i+=4)if(raw[i]>180&&raw[i+1]<80&&raw[i+2]<110){count++;x+=(i/4)%engine.canvas.width;}const at=(Math.floor(engine.canvas.height/2)*engine.canvas.width+Math.floor(engine.canvas.width/2))*4;return {count,x:x/Math.max(1,count),center:[...raw.slice(at,at+4)],error:gl.getError()};};
    try{engine.setActive(false);await engine.generateBuild(build,spawn);engine.gl.deleteBuffer(engine.clouds.buffer);engine.clouds=engine.upload(primitiveVertices([{shape:'box',material:'solid',color:'#00ffff',solid:false,min:{x:-1,y:7,z:4},max:{x:1,y:8,z:4.2},size:{x:2,y:1,z:.2}}]));const closed=engine.collision(0,6,7),before=pixels(),m1=engine.meshes.get('object:door-one').matrix;await engine.interact();const open=!engine.collision(0,6,7),after=pixels(),m2=engine.meshes.get('object:door-one').matrix;
      const artifact=engine.behaviors.data.definitions[0],frame={dt:.1,time:1,event:{type:'interact',targetId:'door-one'},...engine.behaviorContext()},result=engine.behaviors.data.apply(artifact,{state:{open:true},commands:[{type:'object.patch',id:'door-one',position:null,visible:false,solid:false,color:null}]},frame);engine.applyBehavior(result,engine.behaviors.data.view);const hidden=pixels();
      return {closed,open,before,after,hidden,shift:m2[12]-m1[12],hiddenMesh:!engine.meshes.has('object:door-one'),errors:engine.behaviors.failures,mouse:document.pointerLockElement};
    }finally{engine.dispose();}
  },{build,spawn});await probe.close();
  w.check('图片真正绘制在世界中，门源码移动外观并同步碰撞',physics.closed&&physics.open&&physics.before.center[0]>230&&physics.before.center[1]<40&&physics.before.count>3000&&physics.after.count>3000&&physics.after.x>physics.before.x+20&&Math.abs(physics.shift-1.2)<1e-8,physics);
  w.check('源码隐藏对象也隐藏素材，连续绘制保留地形渲染状态',physics.hidden.count===0&&physics.hiddenMesh&&physics.before.error===0&&physics.after.error===0&&physics.hidden.error===0&&physics.errors.length===0&&physics.mouse===null,physics);
  const ref=process.argv[2],model=await importAsset(ref?fs.readFileSync(ref):triangleFixture({texture:true}).bytes(),'model/gltf-binary','标准模型'),scene=withAppearanceFormat({...behaviorScene(),format:'craftmine.scene/4'});
  scene.objects.push({id:'model-display',name:'模型展示',position:{x:-4,y:6,z:6},parts:[part([-1,0,-1],[2,2,2],'#ffffff','box',false)],source:null,components:{health:0,contactDamage:0},appearance:null});scene.objects[0].appearance=defaultAppearance(scene.objects[0],image);scene.objects.at(-1).appearance=defaultAppearance(scene.objects.at(-1),model);
  await w.load(scene,{...spawn,player:{x:-3,y:6,z:11,yaw:0,pitch:0}});const modelWorld=(await w.api('/api/state')).current;await w.saveScreenshot('model-and-image-world');
  const materialized=await w.api('/api/build?id='+modelWorld);w.check('图片和标准 GLB 同时进入可游玩世界，原始纹理数据仍在',materialized.assets.length===2&&materialized.assets.some(a=>a.id===model.id)&&materialized.scene.objects.at(-1).appearance.asset.hash===model.hash);
  const creation=(await w.api('/api/state')).moduleBindings.creation['sliding-door'],memory=await w.api('/api/modules/export?id='+creation.id+'&version='+creation.version);
  w.check('完整创作记忆保存外观引用和门的原始源码',memory.format==='craftmine.module/3'&&memory.payload.objects[0].appearance.asset.hash===image.hash&&memory.payload.scripts[0].definition.code===scene.behaviors[0].code);
  await w.api('/api/modules/reuse',{version:modelWorld,id:creation.id,moduleVersion:creation.version,player:(await w.snapshot()).player});await w.apply();const reused=await w.api('/api/build?id='+(await w.api('/api/state')).current);
  w.check('从记忆复用的新门拥有独立身份和同一固定素材版本',reused.scene.objects.filter(o=>o.appearance?.asset.id===image.id).length===2&&reused.scene.behaviors.length===3);
  await w.api('/api/rollback',{id:secondWorld});await w.apply();w.check('场景历史恢复能找回另一个外观版本',(await w.api('/api/build?id='+(await w.api('/api/state')).current)).scene.objects[0].appearance.asset.version===2);
  await w.api('/api/assets/bind',{version:secondWorld,objectId:'door-one',assetId:image.id,assetVersion:1});const pending=(await w.api('/api/state')).candidate,missing=path.join(w.dir,'project','assets',image.id,'1.json'),bytes=fs.readFileSync(missing);fs.unlinkSync(missing);
  await w.page.locator('#candidate').waitFor({state:'visible'});await w.domClick('#apply');await w.page.waitForFunction(()=>document.getElementById('toast').textContent.includes('缺失'));
  const rejected=await w.api('/api/state');w.check('应用时发现素材缺失，原世界、最新进度和待处理候选仍保留',rejected.current===secondWorld&&!rejected.applying&&rejected.candidate.id===pending.id);
  await w.api('/api/assets/import',JSON.parse(bytes));await w.apply();w.check('重新导入原素材包可恢复缺失文件并继续应用',(await w.api('/api/state')).current===first);
  await w.api('/api/assets/bind',{version:first,objectId:'door-one',assetId:null,assetVersion:null});await w.apply();w.check('可恢复原生成几何并保留源码玩法',!(await w.api('/api/build?id='+(await w.api('/api/state')).current)).scene.objects[0].appearance&&(await w.snapshot()).format==='craftmine.progress/3');
  w.check('世界素材验收没有页面异常或鼠标锁定',w.errors.length===0&&await w.page.evaluate(()=>document.pointerLockElement===null),w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
