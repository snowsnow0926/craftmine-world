import { validateBehavior,validateBehaviorFrame,validateBehaviorResult } from './behavior-contracts.mjs';

const shifted=(position,translation,sign)=>Object.fromEntries(['x','y','z'].map(k=>[k,position[k]+sign*translation[k]]));

// Source code and arbitrary JSON state stay in their authored coordinate system.
// Only the explicit host frame and commands cross the instance boundary.
export class BehaviorBinding {
  constructor(input){
    this.world=validateBehavior(input);this.binding=input.binding||null;
    this.localToWorld=new Map(this.binding?.objects.map(p=>[p.local,p.world])||[]);
    this.worldToLocal=new Map(this.binding?.objects.map(p=>[p.world,p.local])||[]);
    const {binding,requires,...base}=this.world;
    this.authored={...base,format:'craftmine.behavior/1',targets:this.binding?base.targets.map(id=>this.worldToLocal.get(id)):base.targets};
    validateBehavior(this.authored);
  }
  frame(input){
    validateBehaviorFrame(input);if(!this.binding)return structuredClone(input);
    const value=structuredClone(input),used=new Set(this.localToWorld.keys());
    value.objects=value.objects.map((object,index)=>{
      let id=this.worldToLocal.get(object.id);
      if(!id){let suffix=0;id='outside-'+index;while(used.has(id))id='outside-'+index+'-'+(++suffix);used.add(id);}
      return {...object,id,position:shifted(object.position,this.binding.translation,-1)};
    });
    value.player.position=shifted(value.player.position,this.binding.translation,-1);
    if(value.event.targetId!==null){value.event.targetId=this.worldToLocal.get(value.event.targetId);if(!value.event.targetId)throw Error('玩法事件超出实例绑定');}
    return validateBehaviorFrame(value,{local:true});
  }
  result(input,frame){
    if(!this.binding)return validateBehaviorResult(input,this.world,frame);
    validateBehaviorResult(input,this.authored,this.frame(frame),{local:true});
    const value=structuredClone(input);
    for(const command of value.commands)if(command.type==='object.patch'){
      command.id=this.localToWorld.get(command.id);
      if(command.position)command.position=shifted(command.position,this.binding.translation,1);
    }
    return validateBehaviorResult(value,this.world,frame);
  }
}
