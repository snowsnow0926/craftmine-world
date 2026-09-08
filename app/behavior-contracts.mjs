// Data-only boundary shared by builds, the game host and isolated code runners.
import { exactKeys, identifier, bounded } from './gameplay.mjs';

export const BEHAVIOR_FORMAT='craftmine.behavior/1';
export const BEHAVIOR_PERMISSIONS=['objects.write','player.motion','hud.message','inventory.write'];
export const BEHAVIOR_LIMITS={code:32000,state:16000,params:8000,commands:32,targets:16};

export function jsonRecord(value,maxBytes=16000){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('状态和参数必须是 JSON 对象');
  let nodes=0;
  function visit(v,depth){
    if(++nodes>2048||depth>10)throw Error('JSON 数据过于复杂');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isFinite(v))throw Error('JSON 不能包含非有限数值');return;}
    if(typeof v==='string'){if(v.length>maxBytes)throw Error('JSON 数据超过大小限制');return;}
    if(typeof v!=='object')throw Error('状态只能包含 JSON 值');
    if(Array.isArray(v)){for(const item of v)visit(item,depth+1);return;}
    if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw Error('状态不能包含非 JSON 类型');
    for(const [key,item]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(key))throw Error('JSON 字段名无效');visit(item,depth+1);}
  }
  visit(value,0);if(new TextEncoder().encode(JSON.stringify(value)).length>maxBytes)throw Error('JSON 数据超过大小限制');
  return structuredClone(value);
}
const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('代码模块文字字段无效');};
const safeId=value=>identifier(value)&&!['constructor','prototype'].includes(value);
const vec=(value,min,max)=>{exactKeys(value,['x','y','z']);for(const n of Object.values(value))bounded(n,min,max);};
export function validateBehavior(definition){
  exactKeys(definition,['format','id','name','description','code','stateVersion','initialState','params','targets','permissions']);
  if(definition.format!==BEHAVIOR_FORMAT||!safeId(definition.id))throw Error('代码模块格式或 ID 无效');
  text(definition.name,60);text(definition.description,1000);text(definition.code,BEHAVIOR_LIMITS.code);
  if(!Number.isInteger(definition.stateVersion)||definition.stateVersion<1||definition.stateVersion>10000)throw Error('代码模块状态版本无效');
  jsonRecord(definition.initialState,BEHAVIOR_LIMITS.state);jsonRecord(definition.params,BEHAVIOR_LIMITS.params);
  for(const [name,limit]of [['targets',BEHAVIOR_LIMITS.targets],['permissions',BEHAVIOR_PERMISSIONS.length]]){
    const list=definition[name];if(!Array.isArray(list)||list.length>limit||new Set(list).size!==list.length)throw Error('代码模块范围声明无效');
    for(const entry of list)if(name==='targets'?!safeId(entry):!BEHAVIOR_PERMISSIONS.includes(entry))throw Error('代码模块范围或权限无效');
  }
  return structuredClone(definition);
}
export function validateBehaviorFrame(frame){
  exactKeys(frame,['dt','time','event','player','objects']);bounded(frame.dt,0,.5);bounded(frame.time,0,1e12);
  exactKeys(frame.event,['type','targetId']);if(!['start','tick','interact','contact','attack','land'].includes(frame.event.type)||(frame.event.targetId!==null&&!identifier(frame.event.targetId)))throw Error('玩法事件无效');
  exactKeys(frame.player,['position','grounded','health']);vec(frame.player.position,-48,48);if(frame.player.position.y<6||frame.player.position.y>38||typeof frame.player.grounded!=='boolean')throw Error('玩法玩家上下文无效');if(frame.player.health!==null)bounded(frame.player.health,0,10000);
  if(!Array.isArray(frame.objects)||frame.objects.length>128)throw Error('玩法对象上下文过大');
  const ids=new Set();for(const object of frame.objects){exactKeys(object,['id','position','visible','solid','health']);if(!identifier(object.id)||ids.has(object.id)||typeof object.visible!=='boolean'||typeof object.solid!=='boolean')throw Error('玩法对象上下文无效');ids.add(object.id);vec(object.position,-48,48);bounded(object.health,0,10000);}
  return structuredClone(frame);
}
export function validateBehaviorResult(result,definition,frame){
  exactKeys(result,['state','commands']);const state=jsonRecord(result.state,BEHAVIOR_LIMITS.state);
  if(!Array.isArray(result.commands)||result.commands.length>BEHAVIOR_LIMITS.commands)throw Error('玩法命令超过每步 32 条限制');
  const permit=permission=>{if(!definition.permissions.includes(permission))throw Error('玩法没有声明所需权限：'+permission);};
  for(const command of result.commands){
    if(command?.type==='object.patch'){
      permit('objects.write');exactKeys(command,['type','id','position','visible','solid','color']);
      if(!definition.targets.includes(command.id)||!frame.objects.some(o=>o.id===command.id))throw Error('玩法试图修改未授权或已不存在的对象');
      if(command.position!==null){vec(command.position,-40,40);if(command.position.y<6||command.position.y>38)throw Error('对象位置超出范围');}
      for(const key of ['visible','solid'])if(command[key]!==null&&typeof command[key]!=='boolean')throw Error('对象修改字段无效');
      if(command.color!==null&&(typeof command.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(command.color)))throw Error('对象颜色无效');
    }else if(command?.type==='player.impulse'){
      permit('player.motion');exactKeys(command,['type','velocity']);vec(command.velocity,-18,18);
    }else if(command?.type==='hud.message'){
      permit('hud.message');exactKeys(command,['type','text']);text(command.text,160);
    }else if(command?.type==='inventory.add'){
      permit('inventory.write');exactKeys(command,['type','item','count']);if(!safeId(command.item)||!Number.isInteger(command.count)||command.count< -100||command.count>100)throw Error('物品变化无效');
    }else throw Error('不支持的玩法命令');
  }
  // The caller only receives a result after every command has passed.
  return {state,commands:structuredClone(result.commands)};
}

export const BEHAVIOR_API_GUIDE=`玩法源文件必须导出同步或异步函数 step({frame,params,state})，返回 {state,commands}。state 为可保存的 JSON 对象；必须返回完整状态，不使用模块全局变量存储进度。
frame={dt,time,event:{type,targetId},player:{position:{x,y,z},grounded,health},objects:[{id,position,visible,solid,health}]}。事件有 start/tick/interact/contact/attack/land，位置单位为米，地面 y=6。
commands 每步最多32条，仅能使用声明的权限和 targets：
objects.write: {type:'object.patch',id,position:null或{x,y,z},visible:null或boolean,solid:null或boolean,color:null或'#RRGGBB'}，null表示保留原字段。
player.motion: {type:'player.impulse',velocity:{x,y,z}}，各轴 -18..18。
hud.message: {type:'hud.message',text:'最多160字'}。
inventory.write: {type:'inventory.add',item:'稳定英文ID',count:整数-100..100}。
模块在 Worker 中执行，没有 DOM、开发服务、网络请求、文件访问、计时器或创建新 Worker 的能力。不得使用 import、eval、Function、fetch、全局消息接口。每步应快速结束；持续行为使用 frame.dt 与返回的 state。params 保存可调参数。源码是真正的逻辑，请用事件与状态编程实现需求，不要只返回说明文字。`;
