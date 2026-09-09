import {BehaviorSession} from './behavior-session.mjs';
import {GameplaySession} from './gameplay.mjs';
import {createExtensionTable,disposeExtensionTable} from './extension-runtime.mjs';
import * as acceptance from './harness/acceptance.mjs';

// Trusted browser code shared by web verification and the isolated desktop renderer.
export async function verifyBehaviorsInBrowser(build,{events=['start','tick','interact','interact','contact','attack','land','restore'],extensions=[]}={}) {
  const report={format:'craftmine.behavior-check/1',build:build.hash,passed:false,modules:[],scope:'接口与事件序列检查；不等同于玩家需求验收'};
  for(const artifact of build.behaviors){
    const one={...build,behaviors:[artifact]},entry={id:artifact.definition.id,revision:artifact.id,passed:false,events:[],effects:[],motions:[],error:null};
    let player={position:{x:0,y:6,z:30},grounded:true,health:100},session,event='start',extensionTable;
    const play=new GameplaySession(build.scene.systems,build.scene.objects,null);
    const context=()=>({player:{...player,health:play.player?.health??null},objects:session.data.view.objects.map(o=>({id:o.id,position:o.position,visible:o.visible&&play.alive(o.id),solid:session.data.view.primitives.some(p=>p.id===o.id&&p.solid),health:play.state.targets[o.id]?.health??0}))});
    const apply=result=>{
      entry.effects.push(...result.effects.map(effect=>({...effect})));
      for(const effect of result.effects){
        if(effect.type==='health.add'&&play.player)play.player.health=Math.max(0,Math.min(play.player.maxHealth,play.player.health+effect.amount));
        if(effect.type==='target.damage'){const target=play.state.targets[effect.id];if(target&&target.health>0)target.health=Math.max(0,target.health-effect.amount);}
      }
    };
    // 世界快照只包含玩家能真正观察到的事实：血量、模型是否重建、位置、可见、背包和面板。
    const snapshot=()=>{const value=session.data.value,view=session.data.view,panels={};
      for(const [moduleId,module] of Object.entries(value.modules||{}))for(const [key,panel] of Object.entries(module?.panels||{}))panels[moduleId+':'+key]=panel;
      return acceptance.worldSnapshot({
        playerHealth:play.player?.health,
        objects:view.objects.map(o=>{const parts=view.primitives.filter(p=>p.id===o.id),alive=play.alive(o.id);return {id:o.id,position:o.position,visible:o.visible&&alive,solid:parts.some(p=>p.solid)&&alive,color:o.appearanceTint||(parts.every(p=>p.color===parts[0]?.color)?parts[0]?.color:null),mesh:parts.length>0&&alive,health:play.state.targets[o.id]?.health??0,bounds:parts.length?{min:{x:Math.min(...parts.map(p=>p.min.x)),y:Math.min(...parts.map(p=>p.min.y)),z:Math.min(...parts.map(p=>p.min.z))},max:{x:Math.max(...parts.map(p=>p.max.x)),y:Math.max(...parts.map(p=>p.max.y)),z:Math.max(...parts.map(p=>p.max.z))}}:null};}),
        inventory:value.inventory||{},items:value.items||{},resources:Object.fromEntries(play.resources().map(resource=>[resource.id,resource])),panels,effects:entry.effects});};
    try{
      extensionTable=await createExtensionTable(extensions);
      const observations=[];let stepCommands=[];
      const runEvent=async(e,dt=.1)=>{const before=snapshot();stepCommands=[];await session.execute(e,dt,true);observations.push({event:{type:e.type,...(e.code?{code:e.code}:{})},commands:stepCommands.slice(),before,after:snapshot()});};
      session=new BehaviorSession(one,null,{context,apply,gameplay:play.state,extensions:extensionTable,onStep:({frame,result})=>{stepCommands.push(...result.commands);if(frame?.event?.type==='key'&&result.commands.length)entry.keyCommands=(entry.keyCommands||0)+result.commands.length;entry.motions.push(...result.commands.filter(c=>c.type==='object.patch'&&c.position).map(c=>({id:c.id,position:c.position})));}});
      await session.start();entry.events.push('start');
      event='tick';await runEvent({type:'tick',targetId:null});entry.events.push('tick');
      for(const id of artifact.definition.targets){
        const object=build.scene.objects.find(o=>o.id===id),parts=build.primitives.filter(p=>p.id===id),maxZ=Math.max(...parts.map(p=>p.max.z));
        player={...player,position:{x:object.position.x,y:Math.max(6,object.position.y),z:Math.min(47,maxZ+2)}};
        for(const type of events.slice(2,-1)){
          event=type+':'+id;session.data.value.time+=.2;await runEvent({type,targetId:id});entry.events.push(event);
        }
      }
      const declaredKeys=artifact.definition.keys||[];entry.declaredKeys=declaredKeys;entry.keyEffects=[];
      for(const code of declaredKeys){
        const before=snapshot();
        event='key:'+code;session.data.value.time+=.2;await runEvent({type:'key',targetId:null,code});entry.events.push(event);
        entry.keyEffects.push({code,change:acceptance.observableChange(before,snapshot())});
      }
      const keyAcceptance=acceptance.evaluateKeyAcceptance({declaredKeys,keyCommands:entry.keyCommands||0,observations:entry.keyEffects});
      const commandAcceptance=acceptance.evaluateCommandAcceptance({observations});
      entry.acceptance={format:keyAcceptance.format,passed:keyAcceptance.passed&&commandAcceptance.passed,assertions:[...keyAcceptance.assertions,...commandAcceptance.assertions],summary:`${keyAcceptance.summary}；${commandAcceptance.summary}`};
      if(declaredKeys.length&&!entry.keyCommands)throw Error('声明了按键但按键事件没有产生任何命令：不要读取 frame.keys，按键事件带 code');
      if(!entry.acceptance.passed)throw Error('结果级验收未通过：'+entry.acceptance.assertions.filter(a=>!a.passed).map(a=>a.detail).join('；'));
      entry.state=session.snapshot();entry.world=snapshot();entry.gameplay=play.snapshot();session.dispose();
      event='restore';const restored=new BehaviorSession(one,entry.state,{context,apply,gameplay:play.state,extensions:extensionTable});session=restored;await restored.start();restored.dispose();entry.events.push('restore');entry.passed=true;
    }catch(error){entry.error=error.message;entry.failedEvent=event;}finally{session?.dispose();disposeExtensionTable(extensionTable);}
    report.modules.push(entry);
  }
  report.passed=report.modules.every(m=>m.passed);return report;

}
