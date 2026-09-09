// Reusable authored content. Nothing in this file is imported by the engine.
export const part=(offset,size,color,shape='box',solid=false,material='solid')=>({shape,offset:{x:offset[0],y:offset[1],z:offset[2]},size:{x:size[0],y:size[1],z:size[2]},color,solid,material});
const object=(id,name,x,z,parts,health=0)=>({id,name,position:{x,y:6,z},source:null,components:{health,contactDamage:0},parts});
export const flower=()=>object('wild-flower','粉色野花',-1.1,8,[
  part([.25,0,.25],[.05,.6,.05],'#4d934c'),part([.05,.3,.25],[.24,.13,.04],'#73ad53'),part([.29,.19,.25],[.22,.12,.04],'#5b9a48'),
  part([.08,.58,.23],[.19,.09,.13],'#f5a0b8'),part([.29,.58,.23],[.19,.09,.13],'#f5a0b8'),part([.21,.58,.04],[.14,.09,.2],'#f5a0b8'),part([.21,.58,.36],[.14,.09,.2],'#f5a0b8'),part([.23,.64,.24],[.09,.07,.09],'#f2cb64')]);
export const grass=()=>object('thin-grass','细叶草丛',1.2,8,[part([0,0,0],[.18,.46,.13],'#68a94c','blade'),part([.15,0,.1],[.15,.32,.18],'#82b654','blade'),part([.3,0,-.05],[.16,.52,.16],'#589044','blade')]);
export const tree=()=>object('oak-tree','小橡树',-3,5,[part([0,0,0],[.5,3,.5],'#ffffff','box',true,'wood'),part([-.8,2,-.8],[2.2,1.5,2.2],'#9ccc78','box',false,'leaves'),part([-.4,3.3,-.4],[1.4,.7,1.4],'#afd28c','box',false,'leaves')]);
export const systems=()=>[
  {id:'health-system',type:'health',name:'生命值',source:null,config:{maxHealth:100,fallDamage:5,regenPerSecond:0}},
  {id:'ranged-system',type:'ranged',name:'训练枪',source:null,config:{damage:20,range:30,cooldown:.2,magazine:3,reloadSeconds:.4}},
  {id:'melee-system',type:'melee',name:'训练剑',source:null,config:{damage:25,range:2,cooldown:.3}},
];
export const drainExtension=()=>({
  format:'craftmine.extension/1',id:'training-drain',name:'训练吸血',version:1,description:'按实际伤害恢复生命，保存每个玩法实例的施放次数。',
  requires:[],capabilities:[],permissions:['targets.write','health.write'],targets:['training-target'],
  provides:{commands:[{type:'training.drain',permission:'targets.write',fields:[{name:'targetId',description:'已绑定的目标 ID'},{name:'amount',description:'伤害 1–20'}]}],events:[]},
  code:`export function apply({command,world,state}) {
    const target=world.objects.find(o=>o.id===command.targetId);
    const amount=Math.min(target?.health||0,Math.max(1,Math.min(20,Number(command.amount)||1)));
    return {state:{calls:(state?.calls||0)+1},effects:amount?[{type:'target.damage',id:command.targetId,amount},{type:'health.add',amount}]:[]};
  }`,
  selfTests:[{name:'只吸取实际伤害',world:{playerHealth:50,objects:[{id:'training-target',position:{x:0,y:6,z:0},health:5,visible:true,mesh:true,solid:true}]},state:{},commands:[{type:'training.drain',targetId:'training-target',amount:10}],expect:[
    {id:'drain.damage',kind:'objectHealth',object:'training-target',exact:0,why:'目标实际失去五点生命',red:'没有伤害的空实现'},
    {id:'drain.heal',kind:'playerHealth',min:55,max:55,why:'只恢复五点实际伤害',red:'按请求量恢复十点'},
  ]}],
});
export function trainingScene(){
  const objects=[flower(),grass(),tree(),object('training-target','训练靶',0,6,[part([0,0,0],[.7,2,.4],'#bfa365','box',true)],60)];
  return {format:'craftmine.scene/3',title:'花园训练场',night:false,objects,systems:systems(),behaviors:[{
    format:'craftmine.behavior/3',id:'training-rewards',name:'花园训练场',description:'启动赠送一枚训练币，击破目标再奖励一枚。',
    stateVersion:1,initialState:{claimed:false},params:{},targets:objects.map(o=>o.id),permissions:['inventory.write'],capabilities:['inventory.read@1','inventory.items@1'],requires:['health@1','ranged@1','melee@1'],binding:null,keys:[],
    code:`export function step({frame,state}) {
      if(frame.event.type==='start')return {state,commands:[{type:'inventory.define',item:'training-token',name:'训练币',description:'花园训练奖励'},{type:'inventory.add',item:'training-token',count:1}]};
      const target=frame.objects.find(o=>o.id==='training-target');
      if(!state.claimed&&target?.health===0)return {state:{...state,claimed:true},commands:[{type:'inventory.add',item:'training-token',count:1}]};
      return {state,commands:[]};
    }`,
  },{
    format:'craftmine.behavior/3',id:'training-drain-key',name:'训练吸血',description:'按 G 从训练靶吸取最多十点生命。',stateVersion:1,initialState:{},params:{},targets:['training-target'],permissions:['targets.write','health.write'],capabilities:[],requires:['health@1','ext:training-drain@1'],binding:null,keys:['KeyG'],
    code:`export function step({frame,state}) {return {state,commands:frame.event.type==='key'&&frame.event.code==='KeyG'?[{type:'training.drain',targetId:'training-target',amount:10}]:[]};}`,
  }]};
}
