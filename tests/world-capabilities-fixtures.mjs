// Authored interface fixtures; these are not evidence of model-generated gameplay.
import { behaviorScene } from './behavior-fixtures.mjs';
export const capable=(id,extra={})=>({format:'craftmine.behavior/3',id,name:id,description:'通用背包和任务接口测试',stateVersion:1,initialState:{},params:{},targets:[],permissions:['inventory.write','hud.message'],requires:[],binding:null,capabilities:['inventory.read@1','inventory.items@1','hud.panel@1'],code:'export function step({state}){return {state,commands:[]}}',...extra});
export function capabilityScene(){
  const scene=behaviorScene();scene.title='背包与任务接口验证';scene.objects[0].name='制作与开门';scene.objects[1].name='木材领取台';
  scene.behaviors=[
    capable('gatherer',{name:'领取木材',targets:['pad-one'],code:`export function step({frame,state}) {
      if(frame.event.type==='start')return {state,commands:[{type:'inventory.define',item:'wood',name:'木材',description:'制作门需要三份木材'}]};
      if(frame.event.type!=='interact')return {state,commands:[]};
      frame.inventory.unauthorized=999; // Mutating this private snapshot must have no host effect.
      return {state:{gathered:(state.gathered||0)+1},commands:[{type:'inventory.add',item:'wood',count:1}]};
    }`}),
    capable('crafter',{name:'制作木门',targets:['door-one'],permissions:['inventory.write','hud.message','objects.write'],code:`export function step({frame,state}) {
      if(frame.event.type==='start')return {state,commands:[{type:'inventory.define',item:'made-door',name:'已制木门',description:'这扇门可以开关'}]};
      if(frame.event.type!=='interact')return {state,commands:[]};
      if(!state.crafted&&(frame.inventory.wood||0)<3)return {state,commands:[{type:'hud.message',text:'需要 3 份木材，当前 '+(frame.inventory.wood||0)}]};
      const open=!state.open,commands=state.crafted?[]:[{type:'inventory.add',item:'wood',count:-3},{type:'inventory.add',item:'made-door',count:1}];
      commands.push({type:'object.patch',id:'door-one',position:null,solid:!open,visible:true,color:null});
      return {state:{crafted:true,open},commands};
    }`}),
    capable('quest',{name:'木工任务',targets:['pad-one','door-one'],code:`export function step({frame,state}) {
      if(!['start','interact'].includes(frame.event.type))return {state,commands:[]};
      const done=!!frame.inventory['made-door'],rewarded=state.rewarded||done,commands=[];
      if(frame.event.type==='start')commands.push({type:'inventory.define',item:'wood',name:'不覆盖已注册名称',description:''},{type:'inventory.define',item:'token',name:'纪念币',description:'制作任务的一次性奖励'});
      if(done&&!state.rewarded)commands.push({type:'inventory.add',item:'token',count:1});
      commands.push({type:'hud.panel',key:'main',panel:{title:'第一扇门',lines:[done?'任务完成 · 已发放纪念币':'收集木材 '+(frame.inventory.wood||0)+' / 3',done?'可以继续开关木门':'在木材台领取，回门前按 E 制作']}});
      return {state:{rewarded},commands};
    }`}),
  ];return scene;
}
