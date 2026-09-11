//! Fixed door passage evidence. The executor owns collection; the core owns
//! immutable requirements and checks actual displacement, never a passed flag.
use serde::Deserialize;
use serde_json::Value;
#[path="godot_controller_evidence.rs"]mod controller;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Bounds {min:[f64;3],max:[f64;3]}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Motion {before:[f64;3],after:[f64;3],started_tick:u64,finished_tick:u64,target_id:Option<String>,#[serde(default,rename="controller")]_controller:Option<Value>,#[serde(default,rename="lockedInteraction")]_locked_interaction:Option<Value>}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Passage {format:String,door_id:String,instance_id:String,setup:String,bounds_source:String,bounds:Bounds,axis:usize,frames:u16,closed:Motion,opened:Motion,#[serde(default)]controller_profile:Option<String>}
fn vector(v:&[f64;3])->bool {v.iter().all(|n|n.is_finite()&&n.abs()<=100000.0)}
fn near(a:f64,b:f64,t:f64)->bool {(a-b).abs()<=t}
fn motion(p:&Passage,m:&Motion,closed:bool)->bool {
 if !vector(&m.before)||!vector(&m.after)||m.started_tick>9007199254740991||m.finished_tick>9007199254740991{return false;}
 let Some(ticks)=m.finished_tick.checked_sub(m.started_tick)else{return false;};
 if !(240..=360).contains(&ticks){return false;}
 let a=p.axis;let other=if a==0{2}else{0};let b=&p.bounds;
 if !near(m.before[a],b.max[a]+1.0,0.02)||!near(m.before[other],(b.min[other]+b.max[other])/2.0,0.02)||!near(m.before[1],b.min[1]+0.9,0.05)||!near(m.after[other],m.before[other],0.05)||!near(m.after[1],m.before[1],0.05){return false;}
 if closed {m.target_id.as_deref()==Some(p.door_id.as_str())&&m.after[a]>=b.max[a]+0.28&&m.after[a]<=b.max[a]+0.45}
 else {m.after[a]<=b.min[a]-0.4&&m.after[a]>=m.before[a]-24.0}
}
pub fn matches(requirements:&Value,value:Option<&Value>,instance:&str)->bool {
 if requirements["doorSequence"]["verifyPassage"]!=true{return value.is_none();}
 let Some(value)=value else{return false;};if value["closed"].get("targetId").is_none()||value["opened"].get("targetId").is_none(){return false;}
 let Ok(p)=serde_json::from_value::<Passage>(value.clone())else{return false;};
 let strong=requirements["doorSequence"]["controllerProfile"]==crate::godot_creation_probe::CONTROLLER_PROFILE;
 if strong {
  if p.controller_profile.as_deref()!=Some(crate::godot_creation_probe::CONTROLLER_PROFILE)||!controller::motion(&value["closed"],true,&p.door_id)||!controller::motion(&value["opened"],false,&p.door_id)||!controller::same(&value["closed"]["controller"]["after"],&value["opened"]["controller"]["before"]){return false;}
 }else if value.get("controllerProfile").is_some()||value["closed"].get("controller").is_some()||value["opened"].get("controller").is_some()||value["closed"].get("lockedInteraction").is_some()||value["opened"].get("lockedInteraction").is_some(){return false;}
 if p.format!="craftmine.creation-door-passage/1"||requirements["doorSequence"]["doorId"].as_str()!=Some(p.door_id.as_str())||p.instance_id!=instance||p.setup!="snapshot-player-only"||p.bounds_source!="collision"||p.frames!=240||![0,2].contains(&p.axis)||!vector(&p.bounds.min)||!vector(&p.bounds.max)||(0..3).any(|i|p.bounds.min[i]>=p.bounds.max[i]){return false;}
 let Some(door)=requirements["entities"].as_array().and_then(|es|es.iter().find(|e|e["id"]==p.door_id&&e["kind"]=="door"))else{return false;};
 let Ok(position)=serde_json::from_value::<[f64;3]>(door["position"].clone())else{return false;};
 let b=&p.bounds;let axis=if b.max[0]-b.min[0]<b.max[2]-b.min[2]{0}else{2};
 p.axis==axis&&b.max[axis]-b.min[axis]<=16.0&&near((b.min[0]+b.max[0])/2.0,position[0],0.02)&&near((b.min[2]+b.max[2])/2.0,position[2],0.02)&&near(b.min[1],position[1],0.02)&&motion(&p,&p.closed,true)&&motion(&p,&p.opened,false)&&p.opened.started_tick>p.closed.finished_tick
}
pub fn valid_requirement(r:&Value)->bool {
 if r["doorSequence"]["verifyPassage"]!=true{return true;}
 r["entities"].as_array().is_some_and(|entities|entities.iter().filter(|e|e["id"]==r["doorSequence"]["doorId"]&&e["kind"]=="door"&&e["position"].as_array().is_some_and(|p|p.len()==3)&&e["scale"].as_array().is_some_and(|p|p.len()==3)).count()==1)
}
