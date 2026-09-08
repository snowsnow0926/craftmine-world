import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
const w=await workbench('review-browser',{preload:'./tests/review-fixture-provider.mjs'});
const read=()=>w.api('/api/state'),frame=()=>w.page.frameLocator('#review-canvas iframe:not(.staging)');
const previewSnapshot=()=>w.page.evaluate(()=>new Promise((resolve,reject)=>{
  const f=document.querySelector('#review-canvas iframe:not(.staging)'),nonce=new URL(f.src).hash.slice(1),requestId=crypto.randomUUID(),timer=setTimeout(()=>reject(Error('preview snapshot timeout')),5000);
  const receive=e=>{if(e.source===f.contentWindow&&e.data.requestId===requestId){clearTimeout(timer);removeEventListener('message',receive);resolve(e.data.snapshot);}};addEventListener('message',receive);f.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type:'snapshot',requestId},'*');
}));
async function open(){await w.page.locator('#candidate').waitFor({state:'visible'});await w.domClick('#review-open');await w.page.waitForFunction(()=>document.querySelector('#review-canvas iframe:not(.staging)')&&!document.getElementById('review-after').disabled);}
async function side(name){await w.domClick('#review-'+name);await w.page.waitForFunction(name=>document.getElementById('review-'+name).getAttribute('aria-pressed')==='true'&&!document.getElementById('review-'+name).disabled,name);}
try{
  const original=JSON.parse(fs.readFileSync('examples/door-and-bounce.save.json','utf8')),objectId=original.scene.objects[0].id,behaviorId=original.scene.behaviors[0].id;
  await w.load(original.scene,{...original.snapshot,player:{x:1.25,y:6,z:9.6,yaw:0,pitch:0}});
  await w.request('把门改成苔绿色，打开时再多移一点，旁边加一朵粉色花。');const staged=await read();
  await w.game().locator('#interact').evaluate(el=>el.onclick());const latest=await w.snapshot();await w.api('/api/save',{version:staged.current,snapshot:latest});
  const stable=await read();await open();
  w.check('候选预览显示对象外观、新增对象、源码和参数的真实变化',await w.page.locator('#review-items .change-item').count()===3&&(await w.page.locator('#review-items').textContent()).includes('代码参数'));
  await w.page.locator(`[data-kind="behavior"][data-id="${behaviorId}"]`).evaluate(el=>el.onclick());
  w.check('参数差异显示原值和候选值',await w.page.locator('#review-fields').evaluate(el=>el.textContent.includes('1.8')&&el.textContent.includes('2.4')));
  await w.domClick('#review-focus');await w.page.waitForFunction(()=>document.getElementById('review-status').dataset.error!=='true');
  await previewSnapshot();await frame().locator('#interact').evaluate(el=>el.onclick());const trial=await previewSnapshot();
  w.check('候选副本里的真实源码能关门，当前世界的门保持打开',trial.behaviors.modules[behaviorId].state.open===false&&(await w.snapshot()).behaviors.modules[behaviorId].state.open===true,trial.behaviors);
  w.check('预览没有提交场景、历史、模块库或试玩状态',(await read()).current===stable.current&&JSON.stringify((await read()).history)===JSON.stringify(stable.history)&&JSON.stringify((await read()).library)===JSON.stringify(stable.library)&&JSON.stringify((await read()).snapshot)===JSON.stringify(stable.snapshot));
  await side('before');w.check('切换当前版本显示原状态的独立副本',(await previewSnapshot()).behaviors.modules[behaviorId].state.open===true&&(await read()).candidate.id===staged.candidate.id);
  await side('after');w.check('返回候选重新建立副本，不沿用前一次试玩结果',(await previewSnapshot()).behaviors.modules[behaviorId].state.open===true);
  await w.page.locator('#review-fields .field-change').evaluateAll(nodes=>nodes.forEach(el=>el.open=true));await w.saveScreenshot('candidate-comparison');await w.page.setViewportSize({width:700,height:950});
  w.check('窄窗口预览没有横向溢出',await w.page.evaluate(()=>document.getElementById('candidate-review').scrollWidth<=document.getElementById('candidate-review').clientWidth));
  await w.saveScreenshot('candidate-mobile');await w.page.setViewportSize({width:1440,height:1000});await w.domClick('#review-close');
  w.check('关闭释放副本，原世界和待处理候选保留',await w.page.locator('iframe').count()===1&&(await w.snapshot()).behaviors.modules[behaviorId].state.open===true&&(await read()).candidate.id===staged.candidate.id);
  w.check('载入期间重置按钮禁用，重复重置不创建额外副本',await w.page.evaluate(()=>{document.getElementById('review-open').onclick();const disabled=document.getElementById('review-reset').disabled;document.getElementById('review-reset').onclick();document.getElementById('review-close').onclick();document.getElementById('review-open').onclick();return disabled;}));
  await w.page.waitForFunction(()=>document.getElementById('candidate-review').open&&document.querySelector('#review-canvas iframe:not(.staging)')&&!document.getElementById('review-after').disabled);
  w.check('载入中关闭再立即打开，不遗留旧副本或关闭新的预览',await w.page.locator('iframe').count()===2);
  await w.domClick('#review-apply');await w.page.locator('#candidate').waitFor({state:'hidden'});const applied=await read(),saved=await w.snapshot();
  w.check('从预览应用实际候选，使用原世界最新状态而非试玩进度',applied.current===staged.candidate.id&&saved.behaviors.modules[behaviorId].state.open===true&&saved.behaviors.modules[behaviorId].overrides[objectId].offset.x===-1.8&&await w.page.locator('iframe').count()===1);
  let stale=false;try{await w.api('/api/candidate/review?id='+staged.candidate.id+'&base='+staged.current);}catch{stale=true;}w.check('已应用或过期的候选不能继续打开旧预览',stale);
  await w.request('移除花，保留门和弹跳板。');await open();await w.page.locator('[data-kind="object"][data-id="review-flower"]').evaluate(el=>el.onclick());await w.domClick('#review-focus');
  await w.page.waitForFunction(()=>document.getElementById('review-before').getAttribute('aria-pressed')==='true'&&!document.getElementById('review-before').disabled);
  w.check('移除对象可定位到当前版本查看，丢弃不会移除原物体',(await read()).current===applied.current&&await frame().locator('body').evaluate(()=>document.pointerLockElement===null));
  await w.domClick('#review-discard');await w.page.locator('#candidate').waitFor({state:'hidden'});
  const bad=await w.api('/api/build?id='+applied.current);bad.scene.behaviors[0].stateVersion=2;
  await w.api('/api/import',{format:'craftmine.save/1',scene:bad.scene,snapshot:await w.snapshot()});await w.page.locator('#candidate').waitFor({state:'visible'});await w.domClick('#review-open');
  await w.page.waitForFunction(()=>document.getElementById('review-status').textContent.includes('需要迁移状态'));
  w.check('不兼容候选预览失败时保留原世界并显示原因，阻止在该预览中应用',await w.page.locator('#review-apply').isDisabled()&&(await read()).current===applied.current&&(await w.snapshot()).behaviors.modules[behaviorId].state.open===true);
  await w.domClick('#review-close');await w.domClick('#discard');await w.page.locator('#candidate').waitFor({state:'hidden'});
  w.check('失败副本被清理，后台测试未获取鼠标或产生页面异常',await w.page.locator('iframe').count()===1&&await w.game().locator('body').evaluate(()=>document.pointerLockElement===null)&&!w.errors.length,w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);console.error(await w.page.evaluate(()=>({open:document.getElementById('candidate-review').open,status:document.getElementById('review-status').textContent,frames:[...document.querySelectorAll('iframe')].map(f=>({role:f.dataset.role,cls:f.className})),toast:document.getElementById('toast').textContent})));await w.saveScreenshot('failure');process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
