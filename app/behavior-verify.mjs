import { playwright,browserOptions } from './browser-tools.mjs';

export async function verifyBehaviors(build,{origin,signal}={}){
  if(!build.behaviors?.length)return {format:'craftmine.behavior-check/1',build:build.hash,passed:true,modules:[]};
  if(!origin||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('缺少本机隔离检查地址');
  if(signal?.aborted)throw Error('代码检查已取消');
  const {viewport,...options}=browserOptions();let browser,timedOut=false,timer;
  const close=()=>browser?.close().catch(()=>{});
  try{
    browser=await playwright().chromium.launch(options);
    signal?.addEventListener('abort',close,{once:true});if(signal?.aborted)throw Error('代码检查已取消');
    timer=setTimeout(()=>{timedOut=true;close();},30000);
    const context=await browser.newContext({viewport});
    await context.addInitScript(()=>{Element.prototype.requestPointerLock=()=>{throw Error('后台验证禁止鼠标锁定');};window.focus=()=>{};});
    const page=await context.newPage();await page.goto(origin+'/verify');
    const result=await page.frameLocator('iframe').locator('body').evaluate(async(_,build)=>{
      const {BehaviorSession}=await import('/app/behavior-session.mjs');
      const report={format:'craftmine.behavior-check/1',build:build.hash,passed:false,modules:[],scope:'接口与事件序列检查；不等同于玩家需求验收'};
      for(const artifact of build.behaviors){
        const one={...build,behaviors:[artifact]},entry={id:artifact.definition.id,revision:artifact.id,passed:false,events:[],effects:[],error:null};
        let player={position:{x:0,y:6,z:30},grounded:true,health:100},session;
        const context=()=>({player,objects:session.data.view.objects.map(o=>({id:o.id,position:o.position,visible:o.visible,solid:session.data.view.primitives.some(p=>p.id===o.id&&p.solid),health:o.components.health}))});
        try{
          session=new BehaviorSession(one,null,{context,apply:result=>entry.effects.push(...result.effects.map(e=>({type:e.type,...(e.type==='player.impulse'?{velocity:e.velocity}:{})})))});
          await session.start();entry.events.push('start');
          await session.execute({type:'tick',targetId:null},.1,true);entry.events.push('tick');
          for(const id of artifact.definition.targets){
            const object=build.scene.objects.find(o=>o.id===id),parts=build.primitives.filter(p=>p.id===id),maxZ=Math.max(...parts.map(p=>p.max.z));
            player={...player,position:{x:object.position.x,y:Math.max(6,object.position.y),z:Math.min(47,maxZ+2)}};
            for(const type of ['interact','interact','contact','attack','land']){
              session.data.value.time+=.2;await session.execute({type,targetId:id},.1,true);entry.events.push(type+':'+id);
            }
          }
          entry.state=session.snapshot();session.dispose();
          const restored=new BehaviorSession(one,entry.state,{context,apply:()=>{}});session=restored;await restored.start();restored.dispose();entry.events.push('restore');entry.passed=true;
        }catch(error){entry.error=error.message;}finally{session?.dispose();}
        report.modules.push(entry);
      }
      report.passed=report.modules.every(m=>m.passed);return report;
    },build);
    if(signal?.aborted)throw Error('代码检查已取消');
    return result;
  }catch(error){throw Error(signal?.aborted?'代码检查已取消':timedOut?'后台代码检查超过 30 秒，原世界保留':'后台代码检查失败：'+error.message);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',close);await close();}
}
