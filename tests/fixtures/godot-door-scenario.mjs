// Host-owned GA11/GA20 fixture; authored placement is setup, never a play action.
export const doorScenario = {
 format:'craftmine.godot-scenario/1',fixtureRef:'creation-door-corridor-v1',
 steps:[{op:'wait',args:{frames:4}},{op:'walk',args:{forward:1,right:0,frames:90}},{op:'wait',args:{frames:4}},{op:'interact',args:{}},{op:'wait',args:{frames:4}},{op:'walk',args:{forward:1,right:0,frames:90}},{op:'wait',args:{frames:4}}],
 assertions:[
  {id:'initial-position',step:0,path:['playerPosition','2'],range:[2.99,3.01]},
  {id:'closed-door',step:0,path:['door','reportedOpen'],equals:false},
  {id:'closed-collision',step:0,path:['door','observedSolid'],equals:true},
  {id:'closed-walk-blocked',step:2,path:['playerPosition','2'],range:[0.54,0.7]},
  {id:'closed-walk-no-sideways-bypass',step:2,path:['playerPosition','0'],range:[-0.05,0.05]},
  {id:'interaction-through-raycast',step:3,path:['interacted'],equals:true},
  {id:'interaction-target',step:3,path:['entityId'],equals:'gate'},
  {id:'project-reports-open',step:4,path:['door','reportedOpen'],equals:true},
  {id:'actual-collision-released',step:4,path:['door','observedSolid'],equals:false},
  {id:'fixed-observer-open-geometry',step:4,path:['door','observedOpen'],equals:true},
  {id:'opened-walk-passed-door',step:6,path:['playerPosition','2'],range:[-7,-3]},
  {id:'opened-walk-no-sideways-bypass',step:6,path:['playerPosition','0'],range:[-0.05,0.05]},
 ]
};
