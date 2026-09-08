export const behaviorFrame=(type='interact',targetId='door-one')=>({dt:.1,time:10,event:{type,targetId},player:{position:{x:0,y:6,z:10},grounded:true,health:100},objects:[{id:'door-one',position:{x:0,y:6,z:7},visible:true,solid:true,health:0},{id:'pad-one',position:{x:3,y:6,z:7},visible:true,solid:true,health:0}]});
export const doorBehavior=()=>({
  format:'craftmine.behavior/1',id:'sliding-door',name:'交互滑门',description:'交互时改变门的位置和碰撞，进度记录开关状态。',stateVersion:1,initialState:{open:false},params:{doorId:'door-one',closedX:0,openX:1.2,y:6,z:7},targets:['door-one'],permissions:['objects.write','hud.message'],
  code:`export function step({frame,params,state}) {
  if(frame.event.type!=='interact'||frame.event.targetId!==params.doorId)return {state,commands:[]};
  const open=!state.open;
  return {state:{open},commands:[
    {type:'object.patch',id:params.doorId,position:{x:open?params.openX:params.closedX,y:params.y,z:params.z},visible:true,solid:!open,color:null},
    {type:'hud.message',text:open?'门已打开':'门已关闭'}
  ]};
}`,
});
export const bounceBehavior=()=>({
  format:'craftmine.behavior/1',id:'spring-pad',name:'弹跳板',description:'接触时按高度计算向上冲量，并限制重复触发。',stateVersion:1,initialState:{lastBounce:-100,bounces:0},params:{padId:'pad-one',height:3},targets:['pad-one'],permissions:['player.motion'],
  code:`export function step({frame,params,state}) {
  if(frame.event.type!=='contact'||frame.event.targetId!==params.padId||frame.time-state.lastBounce<.6)return {state,commands:[]};
  return {state:{lastBounce:frame.time,bounces:state.bounces+1},commands:[{type:'player.impulse',velocity:{x:0,y:Math.sqrt(2*24*params.height),z:0}}]};
}`,
});
import { part } from './scene-fixtures.mjs';
export const behaviorScene=()=>({format:'craftmine.scene/3',title:'源码玩法试验地',night:false,systems:[],behaviors:[doorBehavior(),bounceBehavior()],objects:[
  {id:'door-one',name:'木滑门',position:{x:0,y:6,z:7},source:null,components:{health:0,contactDamage:0},parts:[part([-.5,0,0],[1,2.5,.15],'#d3ad6d','box',true,'wood'),part([.25,1.1,.15],[.1,.12,.08],'#f2d598')]},
  {id:'pad-one',name:'弹跳板',position:{x:3,y:6,z:7},source:null,components:{health:0,contactDamage:0},parts:[part([-.7,0,-.7],[1.4,.15,1.4],'#6bcbbc','box',true)]},
]});
