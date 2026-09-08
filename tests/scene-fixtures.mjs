export const part=(offset,size,color,shape='box',solid=false,material='solid')=>({shape,offset:{x:offset[0],y:offset[1],z:offset[2]},size:{x:size[0],y:size[1],z:size[2]},color,solid,material});
export const flower=(id='flower-one',x=0,z=9,color='#f5a0b8')=>({id,name:'粉色野花',position:{x,y:6,z},source:null,components:{health:0,contactDamage:0},parts:[
  part([.25,0,.25],[.05,.6,.05],'#4d934c'),part([.05,.3,.25],[.24,.13,.04],'#73ad53'),part([.29,.19,.25],[.22,.12,.04],'#5b9a48'),
  part([.08,.58,.23],[.19,.09,.13],color),part([.29,.58,.23],[.19,.09,.13],color),part([.21,.58,.04],[.14,.09,.2],color),part([.21,.58,.36],[.14,.09,.2],color),part([.23,.64,.24],[.09,.07,.09],'#f2cb64'),
]});
export const grass=(id='grass-one',x=1,z=9)=>({id,name:'细叶草丛',position:{x,y:6,z},source:null,components:{health:0,contactDamage:0},parts:[part([0,0,0],[.18,.46,.13],'#68a94c','blade'),part([.15,0,.1],[.15,.32,.18],'#82b654','blade'),part([.3,0,-.05],[.16,.52,.16],'#589044','blade')]});
export const systems=()=>[
  {id:'system-health',type:'health',name:'生命值',config:{maxHealth:100,fallDamage:5,regenPerSecond:0},source:null},
  {id:'system-ranged',type:'ranged',name:'训练枪',config:{damage:20,range:50,cooldown:.15,magazine:3,reloadSeconds:.3},source:null},
  {id:'system-melee',type:'melee',name:'训练剑',config:{damage:25,range:2,cooldown:.2},source:null},
];
export const floraScene=()=>({format:'craftmine.scene/2',title:'花与草的试验地',night:false,objects:[flower(),flower('flower-two',-1.1,8.5,'#f2d77d'),flower('flower-three',1,7.8,'#f5ece1'),grass(),grass('grass-two',-.7,9.6)],systems:[]});
export const gameplayScene=()=>{const scene=floraScene();scene.systems=systems();scene.objects.push(
  {id:'tree-one',name:'小树',position:{x:-3,y:6,z:5},source:null,components:{health:0,contactDamage:0},parts:[part([0,0,0],[.5,3,.5],'#ffffff','box',true,'wood'),part([-.8,2,-.8],[2.2,1.5,2.2],'#9ccc78','box',false,'leaves'),part([-.4,3.3,-.4],[1.4,.7,1.4],'#afd28c','box',false,'leaves')]},
  {id:'target-one',name:'训练靶',position:{x:.2,y:6,z:6},source:null,components:{health:60,contactDamage:0},parts:[part([0,0,0],[.6,1.8,.3],'#8a7856','box',true),part([-.15,1.3,-.03],[.9,.7,.4],'#d7b16b','box',true),part([.05,1.5,.38],[.5,.32,.03],'#a25349')]}
);return scene;};

export const legacyFloraScene=()=>({format:'craftmine.scene/1',title:'最初的世界',night:false,objects:[
  {id:'tree-001',name:'阔叶树',position:{x:0,y:6,z:7},parts:[{offset:{x:0,y:0,z:0},size:{x:1,y:5,z:1},material:'wood'},{offset:{x:-2,y:3,z:-2},size:{x:5,y:2,z:5},material:'leaves'}]},
  ...[[-10,12],[-6,10],[-13,16]].map(([x,z],i)=>({id:'flower-00'+(i+1),name:'旧版方块花'+(i+1),position:{x,y:6,z},parts:[{offset:{x:0,y:0,z:0},size:{x:1,y:1,z:1},material:'leaves'},{offset:{x:-1,y:1,z:0},size:{x:3,y:1,z:1},material:'brick'},{offset:{x:0,y:2,z:0},size:{x:1,y:1,z:1},material:'sand'}]})),
  ...[[-8,14],[-12,9]].map(([x,z],i)=>({id:'grass-clump-00'+(i+1),name:'旧版草丛'+(i+1),position:{x,y:6,z},parts:[{offset:{x:0,y:0,z:0},size:{x:1,y:1,z:1},material:'grass'},{offset:{x:1,y:0,z:0},size:{x:1,y:2,z:1},material:'leaves'}]})),
]});
