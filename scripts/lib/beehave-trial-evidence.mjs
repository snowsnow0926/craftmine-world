import {isDeepStrictEqual} from 'node:util';
// This checks a fixed developer fixture trace, not arbitrary trees or player success.
export function validateBeehaveTrace(trace){
  const errors=[];const check=(ok,message)=>{if(!ok)errors.push(message);};
  if(trace?.format!=='craftmine.beehave-follow-trace/1'||!Array.isArray(trace.samples))return {valid:false,errors:['TRACE_SCHEMA']};
  const samples=trace.samples;
  check(samples.length===391&&samples.every((s,i)=>s?.tick===i),'CONTIGUOUS_PHYSICS_SAMPLES');
  check(trace.physicsHz===60,'PHYSICS_HZ');
  const finiteVec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
  if(!samples.every(s=>Array.isArray(s?.actors)&&s.actors.length===3&&s.actors.map(a=>a?.id).join(',')==='follow,blocked,missing'&&s.actors.every(a=>finiteVec(a.position)&&finiteVec(a.velocity)&&finiteVec(a.target)&&Number.isInteger(a.moves)&&Number.isInteger(a.interrupts)&&Number.isInteger(a.collisions))))return {valid:false,errors:[...errors,'ACTOR_TRACE_SCHEMA']};
  const actor=(tick,id='follow')=>samples[tick]?.actors.find(a=>a.id===id);
  if(!actor(390))return {valid:false,errors:[...errors,'INCOMPLETE_TRACE']};
  const x=(tick,id)=>actor(tick,id).position[0];
  const stopped=(from,to,id='follow')=>samples.slice(from,to+1).every(s=>{const a=s.actors.find(a=>a.id===id);return Math.abs(a.position[0]-x(from,id))<0.001&&a.velocity.every(v=>Math.abs(v)<0.001);});
  check(Math.abs(x(0))<0.001&&Math.abs(actor(0).target[0]-4)<0.001,'INITIAL_SETUP');
  check(samples.every((s,i)=>s.actors.every((a,j)=>Math.abs(a.position[1]-0.5)<0.001&&Math.abs(a.position[2]-j*3)<0.001&&(!i||Math.abs(a.position[0]-samples[i-1].actors[j].position[0])<=2/60+0.001))),'NO_ACTOR_SETUP_TELEPORT_USED_AS_MOVEMENT');
  check(x(60)-x(1)>1.5&&x(180)>3.45&&x(180)<3.51,'ACTUAL_FOLLOW_DISPLACEMENT');
  check(stopped(170,180),'ARRIVAL_STOPS');
  check(x(210)-x(182)>0.8,'FOLLOW_RESUMES_FOR_MOVED_TARGET');
  check(stopped(212,230)&&actor(230).targetValid===false&&actor(230).interrupts>0,'REVOKED_TARGET_INTERRUPTS_AND_STOPS');
  check(x(240)-x(232)>0.2&&actor(240).velocity[0]>1.9,'ACTIVE_MOVEMENT_BEFORE_DISABLE');
  check(stopped(242,270)&&actor(270).enabled===false&&actor(270).interrupts>actor(240).interrupts,'DISABLED_TREE_INTERRUPTS_AND_STOPS');
  check(x(390)-x(272)>1.5&&x(390)>6.45&&x(390)<6.51,'REENABLED_TREE_FOLLOWS');
  check(stopped(375,390),'SECOND_ARRIVAL_STOPS');
  check(samples.every(s=>Math.abs(s.actors[2].position[0])<0.001&&s.actors[2].moves===0),'MISSING_TARGET_NEVER_MOVES');
  check(x(60,'blocked')>0.5&&x(390,'blocked')<1.01&&actor(390,'blocked').collisions>0&&actor(390,'blocked').moves>300,'WALL_COUNTEREXAMPLE_REMAINS_BLOCKED');
  check(actor(390,'blocked').target[0]-x(390,'blocked')>2.9,'BLOCKED_IS_NOT_ARRIVAL_OR_NAVIGATION');
  check(isDeepStrictEqual(trace.events,[{tick:181,setup:'target moves from x4 to x7'},{tick:211,setup:'target revoked'},{tick:231,setup:'target restored; resume before disable'},{tick:241,setup:'disable actively moving tree'},{tick:271,setup:'tree re-enabled'}]),'SETUP_EVENT_SCHEDULE');
  return {valid:errors.length===0,errors,scope:'Measured fixture positions, not generic navigation or combat',positions:{initial:x(0),arrived:x(180),beforeRevoke:x(210),revoked:x(230),beforeDisable:x(240),disabled:x(270),resumed:x(390),blocked:x(390,'blocked'),missing:x(390,'missing')}};
}
