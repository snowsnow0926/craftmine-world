import path from 'node:path';
import { workbench } from './workbench.mjs';
import { doorBehavior,bounceBehavior,behaviorFrame } from './behavior-fixtures.mjs';
const w=await workbench('behavior-browser');
try{
  const results=await w.game().locator('body').evaluate(async(_,{door,bounce,frame})=>{
    const {BehaviorRunner}=await import('/app/behavior-runner.mjs');
    const checks=[];
    const run=async(name,fn)=>{try{checks.push({name,passed:await fn()});}catch(error){checks.push({name,passed:false,error:error.message});}};
    await run('独立 Worker 运行真实滑门代码，状态连续切换',async()=>{
      const runner=new BehaviorRunner(door);try{const a=await runner.step(frame),b=await runner.step(frame);return a.state.open&&a.commands[0].position.x===1.2&&!b.state.open&&b.commands[0].solid;}finally{runner.dispose();}
    });
    await run('同一执行器运行另一种源码：弹跳高度和冷却逻辑',async()=>{
      const runner=new BehaviorRunner(bounce);try{const contact={...frame,event:{type:'contact',targetId:'pad-one'}};const a=await runner.step(contact),b=await runner.step(contact);return a.commands[0].velocity.y===12&&a.state.bounces===1&&b.commands.length===0;}finally{runner.dispose();}
    });
    await run('隔离代码不能读取 DOM 或使用网络、计时器、新 Worker',async()=>{
      const d={...door,permissions:[],code:'export function step({state}) { return {state:{document:typeof document,parent:typeof parent,fetch:typeof fetch,worker:typeof Worker,timer:typeof setTimeout},commands:[]}; }'};
      const runner=new BehaviorRunner(d);try{const r=await runner.step(frame);return Object.values(r.state).every(x=>x==='undefined');}finally{runner.dispose();}
    });
    await run('原型链不能取回被关闭的 API，CSP 拒绝动态执行',async()=>{
      const d={...door,permissions:[],code:`export function step() {
        let exposed=false,evalBlocked=false;
        for(let target=globalThis;target;target=Object.getPrototypeOf(target))
          for(const key of ['fetch','postMessage','setTimeout','Worker'])if(typeof target[key]==='function')exposed=true;
        try{Function('return 123')();}catch(e){evalBlocked=e.name==='EvalError';}
        return {state:{exposed,evalBlocked},commands:[]};
      }`};
      const runner=new BehaviorRunner(d);try{const r=await runner.step(frame);return !r.state.exposed&&r.state.evalBlocked;}finally{runner.dispose();}
    });
    await run('越权输出停止模块，最后确认状态保持不变',async()=>{
      const d={...door,permissions:[],code:'export function step() {return {state:{open:true},commands:[{type:"hud.message",text:"not authorized"}]};}'};
      const runner=new BehaviorRunner(d);try{await runner.step(frame);return false;}catch(e){return runner.closed&&runner.state.open===false&&e.message.includes('权限');}finally{runner.dispose();}
    });
    await run('执行异常会恢复到最后确认状态',async()=>{
      const d={...door,code:'export function step({state}) {state.open=true; throw Error("fixture crash");}'};
      const runner=new BehaviorRunner(d);try{await runner.step(frame);return false;}catch(e){return runner.closed&&!runner.state.open&&e.message.includes('fixture crash');}finally{runner.dispose();}
    });
    await run('无限循环被超时终止，游戏线程仍可响应',async()=>{
      const d={...door,code:'export function step() {while(true) {}}'};
      const runner=new BehaviorRunner(d,{stepTimeoutMs:100});let timerWorked=false;const timer=setTimeout(()=>timerWorked=true,25);
      try{await runner.step(frame);return false;}catch(e){return runner.closed&&timerWorked&&e.message.includes('超时');}finally{clearTimeout(timer);runner.dispose();}
    });
    await run('模块顶层卡死也能限时恢复',async()=>{
      const d={...door,code:'while(true) {} export function step() {}'};
      const runner=new BehaviorRunner(d,{loadTimeoutMs:200});try{await runner.ready;return false;}catch(e){return runner.closed&&e.message.includes('初始化超时');}finally{runner.dispose();}
    });
    await run('缺少 step 导出的源码不能启用',async()=>{
      const runner=new BehaviorRunner({...door,code:'export const value=1;'});try{await runner.ready;return false;}catch(e){return runner.closed&&e.message.includes('step');}finally{runner.dispose();}
    });
    return checks;
  },{door:doorBehavior(),bounce:bounceBehavior(),frame:behaviorFrame()});
  for(const result of results){try{w.check(result.name,result.passed,result.error);}catch(error){w.errors.push(result.error||error.message);process.exitCode=1;}}
  w.check('未获取鼠标锁定，也未改变空白世界',await w.game().locator('body').evaluate(()=>document.pointerLockElement===null)&&(await w.api('/api/state')).history.length===1);
  w.check('Worker 故障没有变成页面未处理异常',w.errors.length===0,w.errors);
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
