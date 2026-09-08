// Data-only boundary shared by builds, the game host and isolated code runners.
import { exactKeys, identifier, bounded,validateSource } from './gameplay.mjs';

export const BEHAVIOR_FORMAT='craftmine.behavior/1';
export const BEHAVIOR_PERMISSIONS=['objects.write','player.motion','hud.message','inventory.write','audio.play','targets.write','resources.write','health.write'];
export const AUDIO_SOUNDS=['shoot','hit','open','pickup','error','jump','land','step','explode','heal','hurt','unlock','deny','win'];
export const MESSAGE_TONES=['info','warn','success'];
// 可供创作模块声明的按键。引擎自己占用的键（WASD/空格/Shift/1/2/E/F/R/T/Enter/Esc）不在此列。
export const BEHAVIOR_KEYS=['KeyB','KeyC','KeyG','KeyH','KeyI','KeyJ','KeyK','KeyL','KeyM','KeyN','KeyO','KeyP','KeyQ','KeyU','KeyV','KeyX','KeyY','KeyZ','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9'];
export const BEHAVIOR_LIMITS={code:32000,state:16000,params:8000,commands:32,targets:16};
export const BEHAVIOR_REQUIREMENTS=['health@1','ranged@1','melee@1','resource@1'];
export const BEHAVIOR_CAPABILITIES=['inventory.read@1','inventory.items@1','hud.panel@1'];

// 只校验允许的键；required 之外的字段可以省略（例如可选的能力、按键声明）。
export function allowKeys(value,allowed,required){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('模块字段不符合格式：需要一个 JSON 对象');
  const extra=Object.keys(value).filter(k=>!allowed.includes(k)),missing=required.filter(k=>!Object.hasOwn(value,k));
  if(extra.length||missing.length)throw Error(`模块字段不符合格式：${missing.length?'缺少 '+missing.join('、'):''}${missing.length&&extra.length?'；':''}${extra.length?'多出 '+extra.join('、'):''}。允许的字段只有：${allowed.join('、')}`);
}

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
export function validateInventory(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>128)throw Error('背包最多 128 种物品');
  for(const [id,count]of Object.entries(value))if(!safeId(id)||!Number.isInteger(count)||count<0||count>9999)throw Error('物品 ID 或库存数无效');
}
export function validateItem(value){exactKeys(value,['name','description']);text(value.name,40);if(typeof value.description!=='string'||value.description.length>200)throw Error('物品说明最多 200 字');}
export function validatePanel(value){
  exactKeys(value,['title','lines']);text(value.title,48);
  if(!Array.isArray(value.lines)||value.lines.length>6)throw Error('任务面板最多 6 行');
  for(const line of value.lines)text(line,120);
}
export function validateBehavior(definition){
  const capable=definition?.format==='craftmine.behavior/3',portable=capable||definition?.format==='craftmine.behavior/2';
  const required=['format','id','name','description','code','stateVersion','initialState','params','targets','permissions',...(portable?['requires','binding']:[]),...(capable?['capabilities']:[])];
  allowKeys(definition,[...required,'keys','migrate'],required);
  if(definition.keys!==undefined&&(!Array.isArray(definition.keys)||definition.keys.length>4||new Set(definition.keys).size!==definition.keys.length||definition.keys.some(k=>!BEHAVIOR_KEYS.includes(k))))throw Error('代码模块按键声明无效，可用：'+BEHAVIOR_KEYS.join('、'));
  if(definition.migrate!==undefined){
    const stateKey=value=>typeof value==='string'&&value.length>0&&value.length<=64&&!['__proto__','constructor','prototype'].includes(value);
    if(!Array.isArray(definition.migrate)||definition.migrate.length>8)throw Error('状态迁移声明无效：最多 8 条');
    const froms=new Set();
    for(const step of definition.migrate){
      const keys=step&&typeof step==='object'&&!Array.isArray(step)?Object.keys(step):[];
      if(!keys.includes('from')||keys.some(k=>!['from','keep','rename','add'].includes(k)))throw Error('状态迁移声明无效：只允许 from/keep/rename/add');
      if(!Number.isInteger(step.from)||step.from<1||step.from>=definition.stateVersion||froms.has(step.from))throw Error('状态迁移的起始版本无效或重复');
      froms.add(step.from);
      if(step.keep!==undefined&&(!Array.isArray(step.keep)||step.keep.length>32||new Set(step.keep).size!==step.keep.length||step.keep.some(k=>!stateKey(k))))throw Error('状态迁移保留字段无效');
      if(step.rename!==undefined){
        if(!step.rename||typeof step.rename!=='object'||Array.isArray(step.rename)||Object.keys(step.rename).length>32)throw Error('状态迁移重命名字段无效');
        for(const [from,to]of Object.entries(step.rename))if(!stateKey(from)||!stateKey(to))throw Error('状态迁移重命名字段无效');
      }
      if(step.add!==undefined)jsonRecord(step.add,BEHAVIOR_LIMITS.state);
    }
  }
  if((!portable&&definition.format!==BEHAVIOR_FORMAT)||!safeId(definition.id))throw Error('代码模块格式或 ID 无效');
  text(definition.name,60);text(definition.description,1000);text(definition.code,BEHAVIOR_LIMITS.code);
  if(!Number.isInteger(definition.stateVersion)||definition.stateVersion<1||definition.stateVersion>10000)throw Error('代码模块状态版本无效');
  jsonRecord(definition.initialState,BEHAVIOR_LIMITS.state);jsonRecord(definition.params,BEHAVIOR_LIMITS.params);
  for(const [name,limit]of [['targets',BEHAVIOR_LIMITS.targets],['permissions',BEHAVIOR_PERMISSIONS.length]]){
    const list=definition[name];if(!Array.isArray(list)||list.length>limit||new Set(list).size!==list.length)throw Error('代码模块范围声明无效');
    for(const entry of list)if(name==='targets'?!safeId(entry):!BEHAVIOR_PERMISSIONS.includes(entry))throw Error('代码模块范围或权限无效');
  }
  if(capable){
    const c=definition.capabilities;
    if(!Array.isArray(c)||c.length>BEHAVIOR_CAPABILITIES.length||new Set(c).size!==c.length||c.some(v=>!BEHAVIOR_CAPABILITIES.includes(v)))throw Error('代码模块能力声明无效');
    if((c.includes('inventory.items@1')&&!definition.permissions.includes('inventory.write'))||(c.includes('hud.panel@1')&&!definition.permissions.includes('hud.message')))throw Error('代码模块能力缺少所需权限');
  }
  if(portable){
    if(!Array.isArray(definition.requires)||definition.requires.length>BEHAVIOR_REQUIREMENTS.length||new Set(definition.requires).size!==definition.requires.length||definition.requires.some(r=>!BEHAVIOR_REQUIREMENTS.includes(r)))throw Error('代码模块依赖无效');
    if(definition.binding!==null){
      const b=definition.binding;exactKeys(b,['instanceId','source','origin','translation','objects','behaviors']);
      if(!safeId(b.instanceId)||!b.source)throw Error('代码模块实例来源无效');validateSource(b.source);vec(b.origin,-40,40);vec(b.translation,-80,80);
      for(const [key,limit]of [['objects',16],['behaviors',8]]){
        if(!Array.isArray(b[key])||b[key].length>limit)throw Error('代码模块绑定范围无效');
        const local=new Set(),world=new Set(),keys=new Set();for(const pair of b[key]){exactKeys(pair,key==='objects'?['key','local','world']:['local','world']);if(!safeId(pair.local)||!safeId(pair.world)||(key==='objects'&&(!safeId(pair.key)||keys.has(pair.key)))||local.has(pair.local)||world.has(pair.world))throw Error('代码模块绑定 ID 无效或重复');local.add(pair.local);world.add(pair.world);keys.add(pair.key);}
      }
      if(!b.behaviors.some(p=>p.world===definition.id)||definition.targets.some(id=>!b.objects.some(p=>p.world===id)))throw Error('代码模块声明的对象未绑定');
    }
  }
  return structuredClone(definition);
}
export function validateBehaviorFrame(frame,{local=false,definition}={}){
  const inventory=Object.hasOwn(frame||{},'inventory');
  exactKeys(frame,['dt','time','event','player','objects',...(inventory?['inventory']:[])]);bounded(frame.dt,0,.5);bounded(frame.time,0,1e12);
  if(definition&&inventory!==!!definition.capabilities?.includes('inventory.read@1'))throw Error('库存上下文与读取能力声明不一致');
  if(inventory)validateInventory(frame.inventory);
  allowKeys(frame.event,['type','targetId','code'],['type','targetId']);if(!['start','tick','interact','contact','attack','land','key'].includes(frame.event.type)||(frame.event.targetId!==null&&!identifier(frame.event.targetId))||(frame.event.code!==undefined&&!BEHAVIOR_KEYS.includes(frame.event.code)))throw Error('玩法事件无效');
  exactKeys(frame.player,['position','grounded','health']);vec(frame.player.position,local?-128:-48,local?128:48);if((!local&&(frame.player.position.y<6||frame.player.position.y>38))||typeof frame.player.grounded!=='boolean')throw Error('玩法玩家上下文无效');if(frame.player.health!==null)bounded(frame.player.health,0,10000);
  if(!Array.isArray(frame.objects)||frame.objects.length>128)throw Error('玩法对象上下文过大');
  const ids=new Set();for(const object of frame.objects){exactKeys(object,['id','position','visible','solid','health']);if(!identifier(object.id)||ids.has(object.id)||typeof object.visible!=='boolean'||typeof object.solid!=='boolean')throw Error('玩法对象上下文无效');ids.add(object.id);vec(object.position,local?-128:-48,local?128:48);bounded(object.health,0,10000);}
  return structuredClone(frame);
}
export function validateBehaviorResult(result,definition,frame,{local=false}={}){
  exactKeys(result,['state','commands']);const state=jsonRecord(result.state,BEHAVIOR_LIMITS.state);
  if(!Array.isArray(result.commands)||result.commands.length>BEHAVIOR_LIMITS.commands)throw Error('玩法命令超过每步 32 条限制');
  const permit=permission=>{if(!definition.permissions.includes(permission))throw Error('玩法没有声明所需权限：'+permission);};
  const capability=name=>{if(!definition.capabilities?.includes(name))throw Error('玩法没有声明所需能力：'+name);};
  for(const command of result.commands){
    if(command?.type==='object.patch'){
      permit('objects.write');allowKeys(command,['type','id','position','visible','solid','color','yaw','duration'],['type','id']);
      for(const key of ['position','visible','solid','color','yaw'])if(!Object.hasOwn(command,key))command[key]=null;
      if(command.duration!==undefined&&command.duration!==null&&(!Number.isFinite(command.duration)||command.duration<0||command.duration>5))throw Error('移动时长需要在 0 到 5 秒之间');
      if(!definition.targets.includes(command.id)||!frame.objects.some(o=>o.id===command.id))throw Error('玩法试图修改未授权或已不存在的对象');
      if(command.position!==null){vec(command.position,local?-128:-40,local?128:40);if(!local&&(command.position.y<6||command.position.y>38))throw Error('对象位置超出范围');}
      for(const key of ['visible','solid'])if(command[key]!==null&&typeof command[key]!=='boolean')throw Error('对象修改字段无效');
      if(command.color!==null&&(typeof command.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(command.color)))throw Error('对象颜色无效');
      if(command.yaw!==null&&![0,90,180,270].includes(command.yaw))throw Error('对象朝向只支持 0、90、180、270 度');
    }else if(command?.type==='player.impulse'){
      permit('player.motion');exactKeys(command,['type','velocity']);vec(command.velocity,-18,18);
    }else if(command?.type==='hud.message'){
      permit('hud.message');allowKeys(command,['type','text','tone','duration'],['type','text']);text(command.text,160);
      if(command.tone!==undefined&&!MESSAGE_TONES.includes(command.tone))throw Error('飘字色调无效，可用：'+MESSAGE_TONES.join('、'));
      if(command.duration!==undefined&&(!Number.isInteger(command.duration)||command.duration<1000||command.duration>10000))throw Error('飘字时长需要是 1000 到 10000 毫秒的整数');
    }else if(command?.type==='audio.play'){
      permit('audio.play');allowKeys(command,['type','sound','volume'],['type','sound']);
      if(!AUDIO_SOUNDS.includes(command.sound))throw Error('音效名称无效，可用：'+AUDIO_SOUNDS.join('、'));
      if(command.volume!==undefined&&(!Number.isFinite(command.volume)||command.volume<0||command.volume>1))throw Error('音量需要在 0 到 1 之间');
    }else if(command?.type==='target.revive'){
      permit('targets.write');allowKeys(command,['type','id'],['type','id']);
      if(!definition.targets.includes(command.id))throw Error('玩法试图复活未授权的目标');
    }else if(command?.type==='inventory.add'){
      permit('inventory.write');exactKeys(command,['type','item','count']);if(!safeId(command.item)||!Number.isInteger(command.count)||command.count< -100||command.count>100)throw Error('物品变化无效');
    }else if(command?.type==='inventory.define'){
      permit('inventory.write');capability('inventory.items@1');exactKeys(command,['type','item','name','description']);if(!safeId(command.item))throw Error('物品 ID 无效');validateItem({name:command.name,description:command.description});
    }else if(command?.type==='hud.panel'){
      permit('hud.message');capability('hud.panel@1');exactKeys(command,['type','key','panel']);if(!safeId(command.key))throw Error('任务面板 ID 无效');if(command.panel!==null)validatePanel(command.panel);
    }else if(command?.type==='resource.add'){
      permit('resources.write');exactKeys(command,['type','id','amount']);if(!safeId(command.id))throw Error('资源 ID 无效');bounded(command.amount,-10000,10000);
    }else if(command?.type==='resource.set'){
      permit('resources.write');exactKeys(command,['type','id','value']);if(!safeId(command.id))throw Error('资源 ID 无效');bounded(command.value,0,10000);
    }else if(command?.type==='health.add'){
      permit('health.write');exactKeys(command,['type','amount']);bounded(command.amount,-10000,10000);
    }else if(command?.type==='target.damage'){
      permit('targets.write');exactKeys(command,['type','id','amount']);if(!safeId(command.id))throw Error('目标 ID 无效');bounded(command.amount,0,10000);
      if(!definition.targets.includes(command.id))throw Error('玩法试图伤害未授权的目标');
    }else throw Error('不支持的玩法命令');
  }
  // The caller only receives a result after every command has passed.
  return {state,commands:structuredClone(result.commands)};
}

export const BEHAVIOR_API_GUIDE=`玩法源文件必须导出同步或异步函数 step({frame,params,state})，返回 {state,commands}。state 为可保存的 JSON 对象；必须返回完整状态，不使用模块全局变量存储进度。
改变 stateVersion 时必须同时声明数据迁移，否则旧进度会被拒绝：在模块定义里加 migrate:[{from:旧版本号,rename:{旧字段:'新字段'},keep:['要保留的字段'],add:{新字段:默认值}}]。宿主只做数据迁移（改名、丢弃、补默认值），不执行迁移代码；initialState 里缺少的字段会自动补齐。不要为了绕过迁移而把 stateVersion 改回旧值。
frame={dt,time,event:{type,targetId,code},player:{position:{x,y,z},grounded,health},objects:[{id,position,visible,solid,health}]}。事件有 start/tick/interact/contact/attack/land/key，位置单位为米，地面 y=6。
frame 里没有按键状态：不存在 frame.keys，也不能轮询按键。玩家按键必须用模块自己的 keys 字段声明（最多 4 个，例如 keys:['KeyG']），宿主只在引擎未占用该键时派发 {type:'key',code:'KeyG'} 事件。引擎已占用、不能声明：W/A/S/D、空格、Shift、1、2、E、F、R、T、Enter、Esc。
commands 每步最多32条，仅能使用声明的权限和 targets：
objects.write: {type:'object.patch',id,position:null或{x,y,z},visible:null或boolean,solid:null或boolean,color:null或'#RRGGBB',yaw:null或0/90/180/270,duration:可选0..5}，null表示保留原字段；position/visible/solid/color/yaw 可以整项省略，省略等同于 null。yaw 是绕对象自身原点的水平朝向，只支持 90 度整步（宿主把旋转烘焙成轴对齐包围盒，碰撞随之改变）。duration 是平滑移动的秒数：宿主把网格从旧位置插值到新位置，碰撞和存档立即使用目标位置；省略或 0 表示瞬间移动。让它“走过去”“滑过去”时用它，不要每 tick 发一串位置。
制作后才出现的对象，也要先在场地内定义合法位置与几何；在 start 根据已保存状态返回 visible:false、solid:false 隐藏未解锁对象，解锁后才显示。不能通过把对象埋到地下、移到边界外或设为零尺寸来隐藏，否则源码执行前的场景检查就会拒绝。
player.motion: {type:'player.impulse',velocity:{x,y,z}}，各轴 -18..18。
hud.message: {type:'hud.message',text:'最多160字',tone:可选'info'|'warn'|'success',duration:可选1000..10000毫秒}。tone 决定飘字颜色，duration 决定停留时间（默认 4500 毫秒）。
audio.play: {type:'audio.play',sound:'shoot'|'hit'|'open'|'pickup'|'error'|'jump'|'land'|'step'|'explode'|'heal'|'hurt'|'unlock'|'deny'|'win',volume:可选0..1}。宿主用内置音效合成播放，不需要素材。
targets.write: {type:'target.revive',id}。把该目标的血量恢复到上限并让它重新出现（用于刷新怪物）。只能用于声明过的 targets；被杀死的目标必须用它复活，object.patch 的 visible:true 不会让已死目标重新生效。
resources.write: {type:'resource.add',id:'资源系统ID',amount:整数-10000..10000} 或 {type:'resource.set',id:'资源系统ID',value:0..10000}。id 是场景里 type 为 resource 的系统 ID（例如体力、魔法、饥饿、护甲）；结果会自动夹在 0 到该系统 max 之间。资源条会显示在屏幕左下角。
health.write: {type:'health.add',amount:整数-10000..10000}。正数治疗、负数扣血，结果夹在 0 到玩家血量上限之间；需要玩家生命值系统。
targets.write: {type:'target.damage',id,amount:0..10000}。直接扣目标血量（用于吸血、中毒、爆炸等）；只能作用于声明过的 targets，血量归零时模型会消失，复活仍必须用 target.revive。
inventory.write: {type:'inventory.add',item:'稳定英文ID',count:整数-100..100}。
需要共享背包读取、物品名称或持久任务时，使用 craftmine.behavior/3，保留 /2 的 requires 与 binding，并声明 capabilities（只选需要的）：
- inventory.read@1：frame.inventory 是本步开始时的共享库存 {wood:3,...}，缺少 ID 表示 0。只读快照，修改它不能改变背包；不同模块按场景顺序依次读取最新已提交库存。配方先检查 (frame.inventory.wood||0)>=所需数量，不足时返回提示与原状态；不要尝试扣负库存，否则整步拒绝并停止模块。
- inventory.items@1（需 inventory.write）：{type:'inventory.define',item:'wood',name:'木材',description:'最多200字'}。name 最多40字；按稳定 ID 注册显示名称，第一次已提交的定义保留，后续同 ID 定义不覆盖。可在 start 注册，不能在 start 重复发放物品；同类物品跨创作沿用同 ID，不同物品用不同 ID。
- hud.panel@1（需 hud.message）：{type:'hud.panel',key:'quest',panel:{title:'任务名称',lines:['采集木材 1 / 3','最多6行，每行120字']}}。title 最多48字，每模块最多3个面板；panel:null 删除该面板。全部为纯文本，按 key 替换本模块面板，不能操作别的模块面板。面板随进度保存，卸载隐藏，恢复兼容版本后继续；仅状态改变时更新，不必每 tick 重发。
扣料、对象变化、任务面板和 state 在同一步全部校验后一起提交。一次性奖励用 state 标记已领取；初始状态须兼容新增字段（例如 state.rewarded??false），不能靠 start 重置已完成任务。
模块在 Worker 中执行，没有 DOM、开发服务、网络请求、文件访问、计时器或创建新 Worker 的能力。不得使用 import、eval、Function、fetch、全局消息接口。每步应快速结束；持续行为使用 frame.dt 与返回的 state。params 保存可调参数。源码是真正的逻辑，请用事件与状态编程实现需求，不要只返回说明文字。`;
