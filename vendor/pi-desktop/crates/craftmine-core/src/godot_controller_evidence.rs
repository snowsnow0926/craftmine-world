//! Validate finite facts from the pinned controller sampler, not a profile label.
use serde_json::Value;
const PROFILE:&str="creation-fixed-controller/1";
fn exact(v:&Value,keys:&[&str])->bool {v.as_object().is_some_and(|o|o.len()==keys.len()&&keys.iter().all(|k|o.contains_key(*k)))}
fn id(v:&Value)->bool {v.as_str().is_some_and(|s|{let digits=s.strip_prefix('-').unwrap_or(s);!digits.is_empty()&&digits.len()<=20&&!digits.starts_with('0')&&digits.bytes().all(|c|c.is_ascii_digit())})}
fn tick(v:&Value)->Option<u64>{v.as_u64().filter(|n|*n<=9007199254740991)}
fn number(v:&Value,w:f64)->bool {v.as_f64().is_some_and(|n|n.is_finite()&&(n-w).abs()<=0.00001)}
fn vector(v:&Value,w:&[f64])->bool {v.as_array().is_some_and(|a|a.len()==w.len()&&a.iter().zip(w).all(|(v,w)|number(v,*w)))}
pub fn sample(v:&Value)->bool {
 if !exact(v,&["format","profile","status","reason","physicsTick","playerPath","playerId","playerClass","playerScriptId","fixedPlayerScriptId","playerScriptPath","rootPlayerId","rigPath","rigId","rigScriptId","fixedRigScriptId","rigScriptPath","playerRigId","rigParentId","pivotId","pivotParentId","cameraId","cameraParentId","rigCameraId","rigPivotId","activeCameraId","parameters","physicsRate","body","shape","cameraTransform"])
 ||v["format"]!="craftmine.creation-controller-evidence/1"||v["profile"]!=PROFILE||v["status"]!="supported"||v["reason"]!=""||tick(&v["physicsTick"]).is_none()||v["playerPath"]!="Player"||v["playerClass"]!="CharacterBody3D"||v["playerScriptPath"]!="res://scripts/reused/player_controller.gd"||v["rigPath"]!="Player/CameraRig"||v["rigScriptPath"]!="res://scripts/reused/camera_rig.gd"{return false;}
 for key in ["playerId","playerScriptId","fixedPlayerScriptId","rootPlayerId","rigId","rigScriptId","fixedRigScriptId","playerRigId","rigParentId","pivotId","pivotParentId","cameraId","cameraParentId","rigCameraId","rigPivotId","activeCameraId"]{if !id(&v[key]){return false;}}
 for (a,b) in [("playerScriptId","fixedPlayerScriptId"),("rigScriptId","fixedRigScriptId"),("playerId","rootPlayerId"),("rigId","playerRigId"),("playerId","rigParentId"),("rigId","pivotParentId"),("pivotId","cameraParentId"),("cameraId","rigCameraId"),("pivotId","rigPivotId"),("cameraId","activeCameraId")]{if v[a]!=v[b]{return false;}}
 if ["playerId","rigId","pivotId","cameraId"].iter().map(|k|v[*k].as_str().unwrap()).collect::<std::collections::HashSet<_>>().len()!=4||v["physicsRate"]!=60||!vector(&v["parameters"],&[4.5,1.7,4.2,14.0,3.0,1.0,30.0,9.8]){return false;}
 let b=&v["body"];let s=&v["shape"];let c=&v["cameraTransform"];
 if !exact(b,&["layer","mask","scale","rotation","globalScale","physicsProcessing","processMode"])||b["layer"]!=8||b["mask"]!=3||b["physicsProcessing"]!=true||b["processMode"]!=0||!vector(&b["scale"],&[1.0,1.0,1.0])||!vector(&b["globalScale"],&[1.0,1.0,1.0])||!vector(&b["rotation"],&[0.0,0.0,0.0]){return false;}
 if !exact(s,&["id","resourceId","bodyResourceId","kind","radius","height","disabled","ownerDisabled","ownerCount","shapeCount","ownerNodeId","position","rotation","scale"])||!["id","resourceId","bodyResourceId","ownerNodeId"].iter().all(|k|id(&s[*k]))||s["id"]!=s["ownerNodeId"]||s["resourceId"]!=s["bodyResourceId"]||s["kind"]!="CapsuleShape3D"||!number(&s["radius"],0.3)||!number(&s["height"],1.8)||s["disabled"]!=false||s["ownerDisabled"]!=false||s["ownerCount"]!=1||s["shapeCount"]!=1||!vector(&s["position"],&[0.0,0.0,0.0])||!vector(&s["rotation"],&[0.0,0.0,0.0])||!vector(&s["scale"],&[1.0,1.0,1.0]){return false;}
 if !exact(c,&["rigPosition","rigRotation","rigScale","pivotPosition","pivotRotation","pivotScale","cameraPosition","cameraRotation","cameraScale","pitchLimit","yaw","pitch"]){return false;}
 let(Some(yaw),Some(pitch))=(c["yaw"].as_f64(),c["pitch"].as_f64())else{return false;};
 yaw.is_finite()&&yaw.abs()<=std::f64::consts::PI+0.00001&&pitch.is_finite()&&pitch.abs()<=std::f64::consts::FRAC_PI_2&&c["pitchLimit"]==89&&vector(&c["rigPosition"],&[0.0,0.65,0.0])&&vector(&c["rigRotation"],&[0.0,yaw,0.0])&&vector(&c["rigScale"],&[1.0,1.0,1.0])&&vector(&c["pivotPosition"],&[0.0,0.0,0.0])&&vector(&c["pivotRotation"],&[pitch,0.0,0.0])&&vector(&c["pivotScale"],&[1.0,1.0,1.0])&&vector(&c["cameraPosition"],&[0.0,0.0,0.0])&&vector(&c["cameraRotation"],&[0.0,0.0,0.0])&&vector(&c["cameraScale"],&[1.0,1.0,1.0])
}
pub fn same(a:&Value,b:&Value)->bool {sample(a)&&sample(b)&&["playerId","playerScriptId","rigId","rigScriptId","pivotId","cameraId"].iter().all(|k|a[*k]==b[*k])&&a["shape"]["id"]==b["shape"]["id"]&&a["shape"]["resourceId"]==b["shape"]["resourceId"]}
pub fn walk(w:&Value,before:&Value,after:&Value)->bool {
 if !exact(w,&["format","profile","playerId","cameraId","shapeId","requestedFrames","completedFrames","checkedTicks","bindingTrace","startedTick","finishedTick","before","after"])||w["format"]!="craftmine.creation-controller-walk/1"||w["profile"]!=PROFILE||w["requestedFrames"]!=240||w["completedFrames"]!=240||!same(before,&w["before"])||!same(&w["before"],&w["after"])||!same(&w["after"],after){return false;}
 let(Some(start),Some(end),Some(ticks))=(tick(&w["startedTick"]),tick(&w["finishedTick"]),w["checkedTicks"].as_array())else{return false;};
 let ids=[&before["playerId"],&before["playerScriptId"],&before["rigId"],&before["rigScriptId"],&before["cameraId"],&before["activeCameraId"],&before["shape"]["id"],&before["shape"]["resourceId"]];
 if !w["bindingTrace"].as_array().is_some_and(|rows|rows.len()==ticks.len()&&rows.iter().enumerate().all(|(i,row)|row.as_array().is_some_and(|a|a.len()==9&&a[0]==ticks.get(i).cloned().unwrap_or(Value::Null)&&ids.iter().enumerate().all(|(j,v)|&a[j+1]==*v)))){return false;}
 (241..=244).contains(&ticks.len())&&ticks.iter().all(|v|tick(v).is_some())&&ticks.windows(2).all(|pair|tick(&pair[0]).is_some_and(|n|tick(&pair[1])==Some(n+1)))&&tick(&ticks[0])==Some(start)&&tick(ticks.last().unwrap())==Some(end)&&tick(&w["before"]["physicsTick"])==Some(start)&&tick(&w["after"]["physicsTick"])==Some(end)&&tick(&before["physicsTick"]).is_some_and(|n|start>=n)&&tick(&after["physicsTick"]).is_some_and(|n|end<=n)&&w["playerId"]==before["playerId"]&&w["cameraId"]==before["cameraId"]&&w["shapeId"]==before["shape"]["id"]
}
pub fn motion(v:&Value,closed:bool,door:&str)->bool {
 let c=&v["controller"];
 if !exact(c,&["before","walk","after"])||!walk(&c["walk"],&c["before"],&c["after"])||c["before"]["physicsTick"]!=v["startedTick"]||c["after"]["physicsTick"]!=v["finishedTick"]{return false;}
 if !closed{return v.get("lockedInteraction").is_none();}
 let lock=&v["lockedInteraction"];
 exact(lock,&["op","targetId","physicsTick","doorOpen"])&&lock["op"]=="interact"&&lock["targetId"]==door&&lock["doorOpen"]==false&&tick(&lock["physicsTick"]).is_some_and(|n|n>=tick(&v["startedTick"]).unwrap_or(u64::MAX)&&n<=tick(&c["walk"]["startedTick"]).unwrap_or(0))
}
