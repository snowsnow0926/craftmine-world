//! Finite, host-requested runtime expectations. This is not a script evaluator.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::digest;

pub const FORMAT: &str = "craftmine.godot-check-requirements/1";
pub const ASSERTION: &str = "runtime.target-feedback";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Requirements {
    format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    target_feedback: Option<TargetFeedback>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    creation: Option<Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TargetFeedback {
    target_id: String,
    hit_flash_milliseconds: u16,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

impl Requirements {
    pub fn validate(&self, base: &str, mode: &str) -> Result<()> {
        ensure!(mode == "check" && self.format == FORMAT, "GODOT_CHECK_REQUIREMENTS_SCOPE");
        match (&self.target_feedback,&self.creation) {
            (Some(target),None) => {ensure!(base=="first-person", "GODOT_CHECK_REQUIREMENTS_SCOPE");ensure!(identifier(&target.target_id) && (1..=1000).contains(&target.hit_flash_milliseconds), "INVALID_GODOT_CHECK_REQUIREMENTS");},
            (None,Some(creation)) => ensure!(base=="creation-sandbox" && valid_creation(creation), "INVALID_GODOT_CHECK_REQUIREMENTS"),
            _ => anyhow::bail!("INVALID_GODOT_CHECK_REQUIREMENTS"),
        }
        Ok(())
    }
    pub fn assertion(&self) -> &'static str {if self.creation.is_some(){"runtime.creation-requirements"}else{ASSERTION}}
    pub fn hash(&self) -> String {
        if let Some(creation)=&self.creation {return digest(&serde_json::to_string(&canonical_creation(creation)).unwrap_or_default());}
        let target=self.target_feedback.as_ref().expect("validated requirements");
        digest(&format!("{}\n{}\n{}\n", FORMAT, target.target_id,target.hit_flash_milliseconds))
    }
}

pub fn store(db: &Connection, job: &str, requirements: Option<&Requirements>) -> Result<()> {
    if let Some(requirements) = requirements {
        db.execute("UPDATE craftmine_godot_jobs SET check_requirements=?2,check_requirements_hash=?3 WHERE id=?1",
            params![job, serde_json::to_string(requirements)?, requirements.hash()])?;
    }
    Ok(())
}

pub fn read(db: &Connection, job: &str) -> Result<Option<Requirements>> {
    let (body, hash, base, mode): (Option<String>, Option<String>, String, String) = db.query_row(
        "SELECT check_requirements,check_requirements_hash,base_id,kind FROM craftmine_godot_jobs WHERE id=?1",
        [job], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    match (body, hash) {
        (None, None) => Ok(None),
        (Some(body), Some(hash)) => {
            let requirements: Requirements = serde_json::from_str(&body).context("GODOT_CHECK_REQUIREMENTS_CORRUPT")?;
            requirements.validate(&base, &mode).context("GODOT_CHECK_REQUIREMENTS_CORRUPT")?;
            ensure!(hash == requirements.hash(), "GODOT_CHECK_REQUIREMENTS_CORRUPT");
            Ok(Some(requirements))
        },
        _ => anyhow::bail!("GODOT_CHECK_REQUIREMENTS_CORRUPT"),
    }
}

pub fn attach(db: &Connection, job: &str, result: &mut Value) -> Result<()> {
    if let Some(requirements) = read(db, job)? {
        result["checkRequirementsHash"] = json!(requirements.hash());
        result["checkRequirements"] = serde_json::to_value(requirements)?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Evidence {
    format: String,
    requirements_hash: String,
    job_id: String,
    world_id: String,
    build_id: String,
    instance_id: String,
    observations: Vec<Observation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    phase: String,
    #[serde(default)]
    target_id: Option<String>,
    #[serde(default)]
    hit_flash_milliseconds: Option<f64>,
    #[serde(default)]
    entities: Option<Vec<Value>>,
    #[serde(default)]
    time_of_day: Option<f64>,
    #[serde(default)]
    door_trace: Option<Vec<Value>>,
    #[serde(default)]
    harvest_trace: Option<Vec<Value>>,
}

/// A registered executor remains the runtime trust boundary. The core verifies
/// that its bounded evidence describes this exact immutable check input.
pub fn evidence_matches(requirements: &Requirements, evidence: Option<&Value>, descriptor: &Value) -> bool {
    let Some(evidence) = evidence else { return false; };
    let Ok(evidence) = serde_json::from_value::<Evidence>(evidence.clone()) else { return false; };
    evidence.format == "craftmine.godot-check-requirements-evidence/1"
        && evidence.requirements_hash == requirements.hash()
        && descriptor["format"] == "craftmine.godot-check-descriptor/1"
        && descriptor["phase"] == "check"
        && descriptor["checkRequirementsHash"] == requirements.hash()
        && descriptor["checkRequirements"] == serde_json::to_value(requirements).unwrap_or(Value::Null)
        && descriptor["jobId"] == evidence.job_id
        && descriptor["worldId"] == evidence.world_id
        && descriptor["buildId"] == evidence.build_id
        && identifier(&evidence.instance_id)
        && evidence.observations.len() == 2
        && evidence.observations.iter().zip(["loaded", "running"]).all(|(actual, phase)| {
            if actual.phase != phase {return false;}
            if let Some(creation)=&requirements.creation {return actual.target_id.is_none() && actual.hit_flash_milliseconds.is_none() && actual.entities.as_ref().is_some_and(|entities|creation_matches(creation,entities)) && creation.get("timeOfDay").is_none_or(|expected|actual.time_of_day==expected.as_f64()) && (if phase=="running" {door_trace_matches(creation,actual.door_trace.as_ref()) && harvest_trace_matches(creation,actual.harvest_trace.as_ref())}else{actual.door_trace.is_none() && actual.harvest_trace.is_none()});}
            let Some(target)=&requirements.target_feedback else{return false;};
            actual.entities.is_none() && actual.time_of_day.is_none() && actual.door_trace.is_none() && actual.harvest_trace.is_none() && actual.target_id.as_deref()==Some(target.target_id.as_str()) && actual.hit_flash_milliseconds.is_some_and(|value|value.is_finite()&&(value-f64::from(target.hit_flash_milliseconds)).abs()<=1e-6)
        })
}
fn keys(value:&Value,allowed:&[&str])->bool {value.as_object().is_some_and(|o|o.keys().all(|k|allowed.contains(&k.as_str())))}
fn vec3(value:&Value)->bool {value.as_array().is_some_and(|a|a.len()==3&&a.iter().all(|v|v.as_f64().is_some_and(|n|n.is_finite()&&n.abs()<=100000.0)))}
fn kind(value:&Value)->bool {value.as_str().is_some_and(|s|["tree","rock","chest","door","marker"].contains(&s))}
fn valid_creation(v:&Value)->bool {
 if !keys(v,&["format","requestHash","entities","counts","doorSequence","harvest","timeOfDay","duplicates"])||v["format"]!="craftmine.creation-requirements/1"||!v["requestHash"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase())) {return false;}
 let (Some(es),Some(cs))=(v["entities"].as_array(),v["counts"].as_array())else{return false;};
 v.get("timeOfDay").is_none_or(|t|t==18)&&valid_duplicates(v.get("duplicates"))&&valid_harvest(v.get("harvest"))&&valid_door(v.get("doorSequence"))&&es.len()<=256&&cs.len()<=5&&(! (es.is_empty()&&cs.is_empty())||v.get("doorSequence").is_some()||v.get("harvest").is_some()||v.get("timeOfDay").is_some()||v.get("duplicates").is_some())&&es.iter().all(|e|keys(e,&["id","kind","position","scale","color","absent","excludeIds"])&&(e.get("id").is_some()||e.get("kind").is_some())&&e.get("id").is_none_or(|i|i.as_str().is_some_and(identifier))&&e.get("kind").is_none_or(kind)&&e.get("position").is_none_or(vec3)&&e.get("scale").is_none_or(|s|vec3(s)&&s.as_array().unwrap().iter().all(|n|n.as_f64().is_some_and(|n|n>0.0&&n<=20.0)))&&e.get("color").is_none_or(|c|c.as_str().is_some_and(|s|s.len()==7&&s.starts_with('#')&&s[1..].bytes().all(|c|c.is_ascii_hexdigit())))&&e.get("absent").is_none_or(|a|a==true&&e["id"].as_str().is_some_and(identifier))&&e.get("excludeIds").is_none_or(|ids|ids.as_array().is_some_and(|ids|ids.len()<=256&&ids.iter().all(|id|id.as_str().is_some_and(identifier)))))&&cs.iter().all(|c|keys(c,&["kind","count"])&&kind(&c["kind"])&&c["count"].as_u64().is_some_and(|n|n<=256))
}
fn creation_matches(r:&Value,entities:&[Value])->bool {
 if entities.len()>256||entities.iter().any(|e|!e["id"].as_str().is_some_and(identifier)||!kind(&e["kind"])||!vec3(&e["position"])||!vec3(&e["scale"])) {return false;}
 let ids:std::collections::HashSet<_>=entities.iter().map(|e|e["id"].as_str().unwrap()).collect();if ids.len()!=entities.len(){return false;}
 let close=|a:&Value,b:&Value| a.as_array().unwrap().iter().zip(b.as_array().unwrap()).all(|(a,b)|(a.as_f64().unwrap()-b.as_f64().unwrap()).abs()<=0.005);
 if let Some(d)=r.get("duplicates"){if !duplicates_match(d,entities){return false;}}
 r["counts"].as_array().unwrap().iter().all(|c|entities.iter().filter(|e|e["kind"]==c["kind"]).count() as u64==c["count"].as_u64().unwrap())&&r["entities"].as_array().unwrap().iter().all(|w|{
 if w["absent"]==true{return !entities.iter().any(|e|e["id"]==w["id"]);}
 entities.iter().filter(|e|w.get("id").is_none_or(|id|&e["id"]==id)&&w.get("kind").is_none_or(|kind|&e["kind"]==kind)&&w["excludeIds"].as_array().is_none_or(|ids|!ids.contains(&e["id"]))&&w.get("position").is_none_or(|v|close(&e["position"],v))&&w.get("scale").is_none_or(|v|close(&e["scale"],v))&&w.get("color").is_none_or(|c|e["color"].as_str().is_some_and(|s|s.eq_ignore_ascii_case(c.as_str().unwrap())))).count()==1
 })
}

fn valid_door(v:Option<&Value>)->bool {v.is_none_or(|v|keys(v,&["doorId","steps"])&&v["doorId"].as_str().is_some_and(identifier)&&v["steps"].as_array().is_some_and(|steps|steps.len()>=2&&steps.len()<=8&&steps.iter().all(|s|s.as_str().is_some_and(identifier))&&steps.iter().map(|s|s.as_str().unwrap()).collect::<std::collections::HashSet<_>>().len()==steps.len()))}
fn door_trace_matches(r:&Value,trace:Option<&Vec<Value>>)->bool {
 let Some(rule)=r.get("doorSequence")else{return trace.is_none();};let Some(trace)=trace else{return false;};
 let Some(steps)=rule["steps"].as_array()else{return false;};
 let mut expected=vec![json!("initial"),steps[1].clone()];expected.extend(steps.iter().cloned());
 trace.len()==expected.len()&&trace.iter().enumerate().all(|(i,e)|keys(e,&["step","doorOpen","interacted"])&&e["step"]==expected[i]&&e["doorOpen"]==json!(i==expected.len()-1)&&e["interacted"]==json!(i!=0))
}

fn canonical_creation(value:&Value)->Value {match value {
 Value::Number(number)=>{let number=number.as_f64().unwrap_or(f64::NAN);json!({"$f64":format!("{:016x}",if number==0.0{0.0_f64.to_bits()}else{number.to_bits()})})},
 Value::Array(array)=>Value::Array(array.iter().map(canonical_creation).collect()),
 Value::Object(object)=>Value::Object(object.iter().map(|(k,v)|(k.clone(),canonical_creation(v))).collect()),
 _=>value.clone(),
}}

fn valid_harvest(v:Option<&Value>)->bool {v.is_none_or(|v|keys(v,&["entityId","inventoryId","reward","regrowFrames"])&&v["entityId"].as_str().is_some_and(identifier)&&v["inventoryId"]=="wood"&&v["reward"]==1&&v["regrowFrames"]==300)}
fn harvest_trace_matches(r:&Value,trace:Option<&Vec<Value>>)->bool {
 if r.get("harvest").is_none(){return trace.is_none();}let Some(trace)=trace else{return false;};
 let steps=["initial","harvested","repeat","midway","restored","before-regrowth","regrown","second-harvest"];
 if trace.len()!=steps.len(){return false;}
 let Some(baseline)=trace[0]["inventory"].as_object()else{return false;};
 if baseline.values().any(|v|!v.as_u64().is_some_and(|n|n<=999999)){return false;}
 trace.iter().enumerate().all(|(i,e)|{let mut expected=baseline.clone();if i>0 {expected.insert("wood".into(),json!(baseline.get("wood").and_then(Value::as_u64).unwrap_or(0)+if i==7{2}else{1}));}
 keys(e,&["step","inventory","visible","solid","progressRestored","elapsedTicks"])&&e["elapsedTicks"].as_u64().is_some_and(|ticks|(i!=5||(270..300).contains(&ticks))&&(i!=6||(300..=360).contains(&ticks)))&&e["step"]==steps[i]&&e["visible"]==json!(i==0||i==6)&&e["solid"]==json!(i==0||i==6)&&e["progressRestored"]==json!(i==4)&&e["inventory"]==Value::Object(expected)
 })
}

fn valid_duplicates(v:Option<&Value>)->bool {v.is_none_or(|v|keys(v,&["kind","count","scale","color","priorIds"])&&kind(&v["kind"])&&v["count"]==2&&vec3(&v["scale"])&&v["scale"].as_array().unwrap().iter().all(|n|n.as_f64().is_some_and(|n|n>0.0&&n<=20.0))&&v["color"].as_str().is_some_and(|s|s.len()==7&&s.starts_with('#')&&s[1..].bytes().all(|c|c.is_ascii_hexdigit()))&&v["priorIds"].as_array().is_some_and(|ids|ids.len()<=256&&ids.iter().all(|id|id.as_str().is_some_and(identifier))))}
fn duplicates_match(d:&Value,entities:&[Value])->bool {
 let ids=d["priorIds"].as_array().unwrap();let copies:Vec<_>=entities.iter().filter(|e|e["kind"]==d["kind"]&&!ids.contains(&e["id"])).collect();
 let bounds=|e:&Value|vec3(&e["bounds"]["min"])&&vec3(&e["bounds"]["max"])&&(0..3).all(|i|e["bounds"]["min"][i].as_f64().unwrap()<e["bounds"]["max"][i].as_f64().unwrap());
 copies.len()==2&&copies.iter().all(|e|e["visible"]==true&&e["solid"]==true&&bounds(e)&&e["color"].as_str().is_some_and(|c|c.eq_ignore_ascii_case(d["color"].as_str().unwrap()))&&(0..3).all(|i|(e["scale"][i].as_f64().unwrap()-d["scale"][i].as_f64().unwrap()).abs()<=0.005)&&entities.iter().all(|other|other["id"]==e["id"]||other["solid"]!=true||(bounds(other)&&!(0..3).all(|i|e["bounds"]["min"][i].as_f64().unwrap()<other["bounds"]["max"][i].as_f64().unwrap()-0.001&&e["bounds"]["max"][i].as_f64().unwrap()>other["bounds"]["min"][i].as_f64().unwrap()+0.001))))
}
