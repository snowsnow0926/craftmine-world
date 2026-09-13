//! Fixed additive progress rules. No caller-defined paths or transforms.
use super::*;
use std::collections::BTreeMap;

pub(super) fn derive(previous: &Value, defaults: &Value) -> Result<Value> {
    super::super::godot_runtime::validate_progress(previous)?;
    super::super::godot_runtime::validate_progress(defaults)?;
    for key in ["format", "worldId", "baseId", "baseVersion", "stateVersion"] {
        ensure!(previous[key] == defaults[key], "GODOT_ADDITIVE_IDENTITY_MISMATCH");
    }
    if previous["baseId"] == "creation-sandbox" { return derive_creation(previous, defaults); }
    ensure!(previous["baseId"] == "first-person" && previous["baseVersion"] == "0.1.0"
        && previous["stateVersion"] == 1, "GODOT_ADDITIVE_UNSUPPORTED");
    for state in [previous, defaults] {
        let body = &state["body"];
        ensure!(state.as_object().is_some_and(|map| map.len() == 6), "GODOT_ADDITIVE_UNSUPPORTED_SHAPE");
        let keys = ["format","stateVersion","base","baseVersion","worldId","savedAt","player","equipment","inventory","targets","interactables","quests"];
        ensure!(body.as_object().is_some_and(|map| map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key))),
            "GODOT_ADDITIVE_UNSUPPORTED_SHAPE");
        ensure!(body["format"] == "craftmine.godot-base-state/1" && body["stateVersion"] == 1
            && body["base"] == "first-person" && body["baseVersion"] == state["baseVersion"]
            && body["worldId"] == state["worldId"], "GODOT_ADDITIVE_IDENTITY_MISMATCH");
        let equipment = &body["equipment"];
        ensure!(equipment.as_object().is_some_and(|map|map.len()==2 && map.contains_key("active") && map.contains_key("items")), "GODOT_ADDITIVE_EQUIPMENT_SHAPE");
        let items = entries(&equipment["items"])?;
        ensure!(equipment["active"].as_str().is_some_and(|id|items.contains_key(id)), "GODOT_ADDITIVE_EQUIPMENT_ACTIVE");
        for item in items.values() {
            ensure!(item.as_object().is_some_and(|map|map.len()==3 && ["id","magazine","reserve"].iter().all(|key|map.contains_key(*key)))
                && ["magazine","reserve"].iter().all(|key|item[*key].as_f64().is_some_and(|value|value.is_finite() && value.fract()==0.0 && (0.0..=99999.0).contains(&value))), "GODOT_ADDITIVE_EQUIPMENT_SHAPE");
        }
    }
    let mut snapshot = previous.clone();
    let mut added = Vec::new();
    for (key, nested) in [("targets", None), ("interactables", None), ("equipment", Some("items"))] {
        let old_value = if let Some(field)=nested { &previous["body"][key][field] } else { &previous["body"][key] };
        let next_value = if let Some(field)=nested { &defaults["body"][key][field] } else { &defaults["body"][key] };
        let old = entries(old_value)?;
        let next = entries(next_value)?;
        ensure!(old.keys().all(|id| next.contains_key(id)), "GODOT_ADDITIVE_REMOVAL_REJECTED");
        let mut result = Vec::new();
        for entry in next_value.as_array().unwrap() {
            let id = entry["id"].as_str().unwrap();
            if let Some(existing) = old.get(id) {
                let a = existing.as_object().unwrap(); let b = entry.as_object().unwrap();
                ensure!(a.len() == b.len() && a.iter().all(|(key, value)| b.get(key).is_some_and(|other| kind(value) == kind(other))),
                    "GODOT_ADDITIVE_ENTITY_SHAPE_CHANGED");
                result.push((*existing).clone());
            }
            else {
                result.push(entry.clone());
                let path = if let Some(field)=nested {format!("/body/{key}/{field}")} else {format!("/body/{key}")};
                added.push(json!({"path":path,"id":id}));
            }
        }
        if let Some(field)=nested {snapshot["body"][key][field] = json!(result);} else {snapshot["body"][key] = json!(result);}
    }
    super::super::godot_runtime::validate_progress(&snapshot)?;
    Ok(json!({"format":"craftmine.godot-additive-progress/1","hashEncoding":"serde-json/1",
        "previousSnapshotHash":digest(&serde_json::to_string(previous)?),
        "defaultsSnapshotHash":digest(&serde_json::to_string(defaults)?),
        "snapshotHash":digest(&serde_json::to_string(&snapshot)?),"added":added,"snapshot":snapshot}))
}

fn derive_creation(previous: &Value, defaults: &Value) -> Result<Value> {
    ensure!(previous["baseVersion"] == "1.0.0" && previous["stateVersion"] == 1, "GODOT_ADDITIVE_UNSUPPORTED");
    let keys = ["format","worldId","baseVersion","player","timeOfDay","sourceTimeOfDay","inventory","openedChests","doors","rules"];
    let valid_id = |id: &str| {let bytes=id.as_bytes(); !bytes.is_empty() && bytes.len()<=64 && bytes[0].is_ascii_lowercase() && bytes.iter().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||matches!(*c,b'_'|b'-'))};
    let num = |v: &Value, min: f64, max: f64| v.as_f64().is_some_and(|n|n.is_finite() && n>=min && n<=max);
    for value in [previous,defaults] {
        let b=&value["body"];
        ensure!(b.as_object().is_some_and(|m|m.len()==keys.len()+usize::from(m.contains_key("components")) && keys.iter().all(|k|m.contains_key(*k))) && b["format"]=="craftmine.creation-progress/1" && b["worldId"]==value["worldId"] && b["baseVersion"]==value["baseVersion"],"GODOT_ADDITIVE_UNSUPPORTED_SHAPE");
        if let Some(components)=b.get("components") {validate_components(components)?;}
        let p=&b["player"];
        // Source-owned creation geometry is checked by the real candidate
        // restore. This structural merge must not impose the starter room.
        ensure!(p.as_object().is_some_and(|m|m.len()==4 && ["position","yaw","pitch","onFloor"].iter().all(|k|m.contains_key(*k))) && p["position"].as_array().is_some_and(|a|a.len()==3 && a.iter().all(|v|v.as_f64().is_some_and(f64::is_finite))) && num(&p["yaw"],-std::f64::consts::PI,std::f64::consts::PI) && num(&p["pitch"],-89.0*std::f64::consts::PI/180.0,89.0*std::f64::consts::PI/180.0) && p["onFloor"].is_boolean() && num(&b["timeOfDay"],0.0,24.0) && num(&b["sourceTimeOfDay"],0.0,24.0),"GODOT_ADDITIVE_CREATION_STATE_INVALID");
        for key in ["inventory","openedChests","doors","rules"] {
            let map=b[key].as_object().context("GODOT_ADDITIVE_CREATION_STATE_INVALID")?;
            ensure!(map.len()<=4096,"GODOT_ADDITIVE_CREATION_STATE_INVALID");
            for (id,v) in map {
                ensure!(valid_id(id),"GODOT_ADDITIVE_CREATION_STATE_INVALID");
                let valid=match key {
                    "inventory"=>num(v,0.0,999999.0) && v.as_f64().unwrap().fract()==0.0,
                    "openedChests"=>v==true,
                    "doors"=>v.is_boolean(),
                    _=>v.is_object(),
                };
                ensure!(valid,"GODOT_ADDITIVE_CREATION_STATE_INVALID");
            }
        }
    }
    let mut snapshot=previous.clone();let mut added=Vec::new();
    for key in ["doors","rules"] {
        let ordered:BTreeMap<_,_>=defaults["body"][key].as_object().unwrap().iter().collect();
        for (id,value) in ordered {
            let target=snapshot["body"][key].as_object_mut().unwrap();
            if !target.contains_key(id) {target.insert(id.clone(),value.clone());added.push(json!({"path":format!("/body/{key}"),"id":id}));}
        }
    }
    if previous["body"].get("components").is_some() || defaults["body"].get("components").is_some() {
        let mut components=previous["body"].get("components").cloned().unwrap_or(json!({}));
        if let Some(fresh)=defaults["body"].get("components").and_then(Value::as_object) {
            for (id,state) in fresh {
                if let Some(old)=components.get_mut(id) {
                    let a=old["sourceSettings"].as_object().unwrap();
                    let b=state["sourceSettings"].as_object().unwrap();
                    ensure!(old["format"]==state["format"] && a.len()==b.len() && a.iter().all(|(key,v)|b.get(key).is_some_and(|n|kind(n)==kind(v))),"GODOT_ADDITIVE_COMPONENT_SCHEMA_CHANGED");
                    for (key,value) in b {
                        if !super::super::godot_runtime::same_json(&old["sourceSettings"][key],value) {old["settings"][key]=state["settings"][key].clone();}
                    }
                    old["sourceSettings"]=state["sourceSettings"].clone();
                } else {
                    components.as_object_mut().unwrap().insert(id.clone(),state.clone());
                    added.push(json!({"path":"/body/components","id":id}));
                }
            }
        }
        validate_components(&components)?;
        snapshot["body"]["components"]=components;
    }
    if !super::super::godot_runtime::same_json(&previous["body"]["sourceTimeOfDay"],&defaults["body"]["sourceTimeOfDay"]) {
        snapshot["body"]["timeOfDay"]=defaults["body"]["sourceTimeOfDay"].clone();
        snapshot["body"]["sourceTimeOfDay"]=defaults["body"]["sourceTimeOfDay"].clone();
    }
    super::super::godot_runtime::validate_progress(&snapshot)?;
    Ok(json!({"format":"craftmine.godot-additive-progress/1","hashEncoding":"serde-json/1","previousSnapshotHash":digest(&serde_json::to_string(previous)?),"defaultsSnapshotHash":digest(&serde_json::to_string(defaults)?),"snapshotHash":digest(&serde_json::to_string(&snapshot)?),"added":added,"snapshot":snapshot}))
}

fn component_id(id:&str)->bool {
    !id.is_empty() && id.len()<=128 && id.as_bytes()[0].is_ascii_alphanumeric() && id.bytes().all(|c|c.is_ascii_alphanumeric()||matches!(c,b'.'|b'_'|b'-'))
}
fn component_json(value:&Value,depth:usize)->bool {
    if depth>8 {return false;}
    match value {
        Value::Object(map)=>map.len()<=128 && map.iter().all(|(key,v)|key.chars().count()<=128 && component_json(v,depth+1)),
        Value::Array(items)=>items.len()<=1024 && items.iter().all(|v|component_json(v,depth+1)),
        Value::String(s)=>s.chars().count()<=4096,
        Value::Number(n)=>n.as_f64().is_some_and(f64::is_finite),
        _=>true,
    }
}
fn validate_components(value:&Value)->Result<()> {
    let ledger=value.as_object().context("GODOT_ADDITIVE_COMPONENT_STATE_INVALID")?;
    ensure!(ledger.len()<=64,"GODOT_ADDITIVE_COMPONENT_STATE_INVALID");
    for (id,state) in ledger {
        ensure!(component_id(id) && state.is_object() && component_json(state,0) && serde_json::to_vec(state)?.len()<=65536 && state["entityId"]==*id && state["format"].as_str().is_some_and(|s|!s.is_empty()&&s.chars().count()<=128),"GODOT_ADDITIVE_COMPONENT_STATE_INVALID");
        let settings=state["settings"].as_object().context("GODOT_ADDITIVE_COMPONENT_STATE_INVALID")?;
        let source=state["sourceSettings"].as_object().context("GODOT_ADDITIVE_COMPONENT_STATE_INVALID")?;
        ensure!(source.len()<=16 && source.len()==settings.len(),"GODOT_ADDITIVE_COMPONENT_STATE_INVALID");
        for (key,v) in source {
            ensure!(component_id(key) && !v.is_array() && !v.is_object() && settings.get(key).is_some_and(|n|!n.is_array()&&!n.is_object()&&kind(n)==kind(v)),"GODOT_ADDITIVE_COMPONENT_STATE_INVALID");
        }
    }
    Ok(())
}

fn entries(value: &Value) -> Result<BTreeMap<&str, &Value>> {
    let items = value.as_array().context("GODOT_ADDITIVE_INVALID_ENTRIES")?;
    ensure!(items.len() <= 4096, "GODOT_ADDITIVE_INVALID_ENTRIES");
    let mut result = BTreeMap::new();
    for item in items {
        ensure!(item.is_object(), "GODOT_ADDITIVE_INVALID_ENTRIES");
        let id = item["id"].as_str().context("GODOT_ADDITIVE_INVALID_ENTRIES")?;
        ensure!(!id.is_empty() && id.encode_utf16().count() <= 256 && result.insert(id, item).is_none(),
            "GODOT_ADDITIVE_DUPLICATE_ID");
    }
    Ok(result)
}

fn kind(value: &Value) -> u8 {
    match value { Value::Null => 0, Value::Bool(_) => 1, Value::Number(_) => 2,
        Value::String(_) => 3, Value::Array(_) => 4, Value::Object(_) => 5 }
}

/// External JS hashes are diagnostic only. The authenticated job output and
/// stored descriptor bind provenance; independently derived JSON binds meaning.
pub(crate) fn verify_proof(previous: &Value, defaults: &Value, proof: &Value) -> Result<()> {
    ensure!(proof["format"] == "craftmine.godot-additive-progress/1", "GODOT_ADDITIVE_INVALID_PROOF");
    for key in ["previousSnapshotHash", "defaultsSnapshotHash", "snapshotHash"] {
        super::super::godot_projects::valid_hash(proof[key].as_str().context("GODOT_ADDITIVE_INVALID_PROOF")?)?;
    }
    let expected = derive(previous, defaults)?;
    ensure!(super::super::godot_runtime::same_json(&expected["snapshot"], &proof["snapshot"])
        && expected["added"] == proof["added"], "GODOT_ADDITIVE_INVALID_PROOF");
    Ok(())
}

pub(super) fn for_candidate(db: &Connection, candidate: &Value, previous: &Value) -> Result<Option<Value>> {
    let job = super::super::godot_jobs::read_job(db, candidate["checkJobId"].as_str().context("INVALID_GODOT_JOB")?)?;
    ensure!(job["status"] == "passed" && job["outputHash"] == candidate["checkOutputHash"], "GODOT_CANDIDATE_NOT_READY");
    let check = &job["output"]["check"];
    if check.get("defaultsSnapshot").is_none() && check.get("progressMigration").is_none() { return Ok(None); }
    let descriptor = super::super::godot_jobs::check_input(db, candidate["checkJobId"].as_str().unwrap())?;
    verify_proof(&descriptor["snapshot"], &check["defaultsSnapshot"], &check["progressMigration"])?;
    Ok(Some(derive(previous, &check["defaultsSnapshot"])?))
}

pub(crate) fn validate_prepared(db: &Connection, candidate: &Value, before: &worlds::WorldRecord, input: &Value) -> Result<()> {
    let previous = input.get("previousSnapshot").unwrap_or(&input["snapshot"]);
    assert_player_unchanged(before, previous)?;
    match for_candidate(db, candidate, previous)? {
        Some(proof) => ensure!(input["progressMigration"] == proof && input["snapshot"] == proof["snapshot"],
            "APPLICATION_PROGRESS_CHANGED"),
        None => ensure!(input["snapshot"] == *previous && input.get("progressMigration").is_none(),
            "APPLICATION_PROGRESS_CHANGED"),
    }
    Ok(())
}

#[cfg(test)]
mod equipment_tests {
    use super::*;
    use crate::godot_test_support::failed;

    fn component_world() -> Value {
        json!({"format":"craftmine.godot-progress/1","worldId":"alpha","baseId":"creation-sandbox","baseVersion":"1.0.0","stateVersion":1,"body":{"format":"craftmine.creation-progress/1","worldId":"alpha","baseVersion":"1.0.0","player":{"position":[2,0.9,6],"yaw":1,"pitch":0.1,"onFloor":true},"timeOfDay":18,"sourceTimeOfDay":12,"inventory":{"token":3},"openedChests":{"chest":true},"doors":{},"rules":{}}})
    }
    fn pet(id:&str)->Value {
        json!({"format":"craftmine.pet-companion-state/1","entityId":id,"settings":{"name":"小白","appearanceKey":"dog","following":true},"sourceSettings":{"name":"小白","appearanceKey":"dog","following":true},"position":[2,0,1],"yaw":1,"interactionCount":7})
    }
    #[test]
    fn recorded_city_pose_is_preserved_and_teleport_proofs_are_rejected() -> Result<()> {
        let recorded: Value = serde_json::from_str(include_str!("../../../../../tests/fixtures/creation-city-migration.json"))?;
        let previous=&recorded["previous"];let defaults=&recorded["defaults"];
        let proof=derive(previous,defaults)?;
        assert_eq!(proof["snapshot"],*previous);assert_eq!(proof["added"],json!([]));
        verify_proof(previous,defaults,&proof)?;
        let mut moved=proof.clone();moved["snapshot"]["body"]["player"]=defaults["body"]["player"].clone();
        assert!(verify_proof(previous,defaults,&moved).is_err());
        for pose in [json!([36,80,-169]),json!([-500,-20,900]),json!([1e100,0,-1e100])] {
            let mut state=previous.clone();state["body"]["player"]["position"]=pose.clone();
            assert_eq!(derive(&state,&state)?["snapshot"]["body"]["player"]["position"],pose);
        }
        for pose in [Value::Null,json!({}),json!([0,0]),json!([0,0,0,0]),json!(["36",0,0]),json!([0,null,0])] {
            let mut bad=previous.clone();bad["body"]["player"]["position"]=pose;
            assert!(derive(&bad,defaults).is_err());assert!(derive(defaults,&bad).is_err());
        }
        // Non-finite JSON numbers are rejected by serde before derivation.
        assert!(serde_json::from_str::<Value>("[1e999,0,0]").is_err());
        Ok(())
    }
    #[test]
    fn component_defaults_and_settings_changes_preserve_identity_progress_and_other_instances()->Result<()> {
        let empty=component_world();
        assert_eq!(derive(&empty,&empty)?["snapshot"],empty);
        let mut defaults=empty.clone();defaults["body"]["components"]=json!({"dog-1":pet("dog-1"),"dog-2":pet("dog-2")});
        let first=derive(&empty,&defaults)?;
        assert_eq!(first["snapshot"]["body"]["components"],defaults["body"]["components"]);
        verify_proof(&empty,&defaults,&first)?;
        let mut previous=first["snapshot"].clone();
        previous["body"]["components"]["dog-1"]["settings"]["following"]=json!(false);
        defaults["body"]["components"]["dog-1"]["settings"]["appearanceKey"]=json!("pomeranian-white");
        defaults["body"]["components"]["dog-1"]["sourceSettings"]["appearanceKey"]=json!("pomeranian-white");
        defaults["body"]["components"]["dog-1"]["position"]=json!([9,0,9]);
        defaults["body"]["components"]["dog-1"]["interactionCount"]=json!(0);
        let result=derive(&previous,&defaults)?;
        let dog=&result["snapshot"]["body"]["components"]["dog-1"];
        assert_eq!(dog["settings"]["appearanceKey"],"pomeranian-white");
        assert_eq!(dog["settings"]["following"],false);
        assert_eq!(dog["position"],json!([2,0,1]));assert_eq!(dog["interactionCount"],7);
        assert_eq!(result["snapshot"]["body"]["components"]["dog-2"],previous["body"]["components"]["dog-2"]);
        assert_eq!(result["snapshot"]["body"]["player"],previous["body"]["player"]);
        verify_proof(&previous,&defaults,&result)?;
        let mut forged=result.clone();forged["snapshot"]["body"]["components"]["dog-1"]["interactionCount"]=json!(999);
        assert!(verify_proof(&previous,&defaults,&forged).is_err());
        Ok(())
    }
    #[test]
    fn removed_component_ledgers_survive_and_malformed_or_new_schema_states_are_rejected()->Result<()> {
        let empty=component_world();let mut old=empty.clone();old["body"]["components"]=json!({"dog-1":pet("dog-1")});
        let removed=derive(&old,&empty)?["snapshot"].clone();assert_eq!(removed["body"]["components"],old["body"]["components"]);
        let mut fresh=old.clone();fresh["body"]["components"]["dog-1"]["interactionCount"]=json!(0);
        assert_eq!(derive(&removed,&fresh)?["snapshot"]["body"]["components"]["dog-1"]["interactionCount"],7);
        for invalid in [Value::Null,json!([]),json!({"dog-1":{}})] {
            let mut bad=old.clone();bad["body"]["components"]=invalid;assert!(derive(&old,&bad).is_err());
        }
        for (field,value) in [("entityId",json!("foreign")),("format",json!("future/2")),("sourceSettings",json!({"added":true})),("settings",json!({"name":"pet","appearanceKey":"dog","following":"yes"}))] {
            let mut bad=old.clone();bad["body"]["components"]["dog-1"][field]=value;assert!(derive(&old,&bad).is_err());
        }
        Ok(())
    }

    #[test]
    fn creation_additions_keep_old_ledgers_and_apply_only_explicit_time_changes() -> Result<()> {
        let previous=json!({"format":"craftmine.godot-progress/1","worldId":"alpha","baseId":"creation-sandbox","baseVersion":"1.0.0","stateVersion":1,"body":{"format":"craftmine.creation-progress/1","worldId":"alpha","baseVersion":"1.0.0","player":{"position":[2,0.9,6],"yaw":1,"pitch":0.1,"onFloor":true},"timeOfDay":18,"sourceTimeOfDay":12,"inventory":{"token":3},"openedChests":{"chest":true},"doors":{"old":true},"rules":{"old":{"cursor":3,"completed":true}}}});
        let mut defaults=previous.clone();defaults["body"]["doors"]=json!({"fresh":false});defaults["body"]["rules"]=json!({"new":{"presses":0,"completed":false}});defaults["body"]["inventory"]=json!({});defaults["body"]["openedChests"]=json!({});
        let proof=derive(&previous,&defaults)?;
        assert_eq!(proof["snapshot"]["body"]["inventory"],previous["body"]["inventory"]);
        assert_eq!(proof["snapshot"]["body"]["doors"],json!({"old":true,"fresh":false}));
        assert_eq!(proof["snapshot"]["body"]["timeOfDay"],18);
        assert_eq!(proof["added"],json!([{"path":"/body/doors","id":"fresh"},{"path":"/body/rules","id":"new"}]));
        verify_proof(&previous,&defaults,&proof)?;
        defaults["body"]["sourceTimeOfDay"]=json!(21);let changed=derive(&previous,&defaults)?;
        assert_eq!(changed["snapshot"]["body"]["timeOfDay"],21);
        let mut forged=changed.clone();forged["snapshot"]["body"]["inventory"]["token"]=json!(99);assert!(verify_proof(&previous,&defaults,&forged).is_err());
        defaults["body"]["player"]["pitch"]=json!(std::f64::consts::FRAC_PI_2);assert!(derive(&previous,&defaults).is_err());
        Ok(())
    }

    fn state() -> Value {
        json!({"format":"craftmine.godot-progress/1","worldId":"alpha","baseId":"first-person","baseVersion":"0.1.0","stateVersion":1,
            "body":{"format":"craftmine.godot-base-state/1","worldId":"alpha","base":"first-person","baseVersion":"0.1.0","stateVersion":1,"savedAt":null,
                "player":{},"equipment":{"active":"pistol","items":[{"id":"pistol","magazine":3,"reserve":17}]},"inventory":{},"targets":[],"interactables":[],"quests":{}}})
    }

    fn push(defaults: &mut Value, item: Value) {
        defaults["body"]["equipment"]["items"].as_array_mut().unwrap().push(item);
    }
    fn two_item_state() -> Value {
        let mut value=state();
        push(&mut value,json!({"id":"practice_sword","magazine":0,"reserve":0}));
        value
    }

    #[test]
    fn adds_equipment_without_changing_old_progress_and_rejects_forged_proof() -> Result<()> {
        let previous=state();let mut defaults=state();
        defaults["body"]["equipment"]["active"]=json!("hammer");
        defaults["body"]["equipment"]["items"][0]["magazine"]=json!(99);
        push(&mut defaults,json!({"id":"hammer","magazine":0,"reserve":0}));
        let proof=derive(&previous,&defaults)?;
        assert_eq!(proof["snapshot"]["body"]["equipment"]["active"],"pistol");
        assert_eq!(proof["snapshot"]["body"]["equipment"]["items"][0],previous["body"]["equipment"]["items"][0]);
        assert_eq!(proof["added"],json!([{"path":"/body/equipment/items","id":"hammer"}]));
        verify_proof(&previous,&defaults,&proof)?;
        let mut forged=proof.clone();forged["snapshot"]["body"]["equipment"]["items"][0]["reserve"]=json!(999);
        assert!(verify_proof(&previous,&defaults,&forged).is_err());
        defaults["body"]["equipment"]["items"][1]["reserve"]=json!(-1);
        assert!(derive(&previous,&defaults).is_err());
        Ok(())
    }

    /// The reported failure was `State is missing equipment: thunder_hammer`: an
    /// action added one definition and old saves had no entry for it. The new
    /// identity must take the values captured from the real candidate scene, and
    /// every old identity must keep its own numbers, selection included.
    #[test]
    fn new_equipment_takes_captured_defaults_and_old_progress_is_never_rewritten() -> Result<()> {
        let previous=state();
        let mut defaults=state();
        defaults["body"]["equipment"]["active"]=json!("thunder_hammer");
        defaults["body"]["equipment"]["items"][0]["magazine"]=json!(99);
        defaults["body"]["equipment"]["items"][0]["reserve"]=json!(99);
        push(&mut defaults,json!({"id":"thunder_hammer","magazine":2,"reserve":7}));
        let untouched_previous=previous.clone();
        let untouched_defaults=defaults.clone();
        let proof=derive(&previous,&defaults)?;
        assert_eq!(proof["snapshot"]["body"]["equipment"]["active"],json!("pistol"));
        assert_eq!(proof["snapshot"]["body"]["equipment"]["items"][0],json!({"id":"pistol","magazine":3,"reserve":17}));
        assert_eq!(proof["snapshot"]["body"]["equipment"]["items"][1],json!({"id":"thunder_hammer","magazine":2,"reserve":7}));
        assert_eq!(proof["added"],json!([{"path":"/body/equipment/items","id":"thunder_hammer"}]));
        assert_eq!(previous,untouched_previous);
        assert_eq!(defaults,untouched_defaults);
        Ok(())
    }

    #[test]
    fn a_save_that_predates_catalog_items_gains_each_of_them_from_the_candidate_scene() -> Result<()> {
        let previous=state();
        let mut defaults=state();
        push(&mut defaults,json!({"id":"practice_sword","magazine":0,"reserve":0}));
        let proof=derive(&previous,&defaults)?;
        assert_eq!(proof["snapshot"]["body"]["equipment"]["items"],
            json!([{"id":"pistol","magazine":3,"reserve":17},{"id":"practice_sword","magazine":0,"reserve":0}]));
        assert_eq!(proof["added"],json!([{"path":"/body/equipment/items","id":"practice_sword"}]));
        Ok(())
    }

    #[test]
    fn an_identical_candidate_snapshot_is_a_no_change_migration() -> Result<()> {
        let previous=state();
        let proof=derive(&previous,&previous)?;
        assert!(crate::godot_runtime::same_json(&proof["snapshot"],&previous));
        assert_eq!(proof["added"],json!([]));
        verify_proof(&previous,&previous,&proof)?;
        Ok(())
    }

    #[test]
    fn equipment_removal_duplication_shape_and_ammunition_are_rejected() -> Result<()> {
        let previous=two_item_state();
        let mut removal=previous.clone();
        removal["body"]["equipment"]["items"].as_array_mut().unwrap().pop();
        failed(derive(&previous,&removal),"GODOT_ADDITIVE_REMOVAL_REJECTED");
        let mut duplicate=state();
        let entry=duplicate["body"]["equipment"]["items"][0].clone();
        push(&mut duplicate,entry);
        failed(derive(&previous,&duplicate),"GODOT_ADDITIVE_DUPLICATE_ID");
        let mut extra_field=state();
        extra_field["body"]["equipment"]["items"][0]["extra"]=json!(1);
        failed(derive(&previous,&extra_field),"GODOT_ADDITIVE_EQUIPMENT_SHAPE");
        let mut extra_block=state();
        extra_block["body"]["equipment"]["extra"]=json!({});
        failed(derive(&previous,&extra_block),"GODOT_ADDITIVE_EQUIPMENT_SHAPE");
        let mut negative=state();
        negative["body"]["equipment"]["items"][0]["magazine"]=json!(-1);
        failed(derive(&previous,&negative),"GODOT_ADDITIVE_EQUIPMENT_SHAPE");
        let mut too_large=state();
        too_large["body"]["equipment"]["items"][0]["reserve"]=json!(100000);
        failed(derive(&previous,&too_large),"GODOT_ADDITIVE_EQUIPMENT_SHAPE");
        let mut fractional=state();
        fractional["body"]["equipment"]["items"][0]["magazine"]=json!(1.5);
        failed(derive(&previous,&fractional),"GODOT_ADDITIVE_EQUIPMENT_SHAPE");
        let mut wrong_type=state();
        wrong_type["body"]["equipment"]["items"][0]["reserve"]=json!("4");
        failed(derive(&previous,&wrong_type),"GODOT_ADDITIVE_EQUIPMENT_SHAPE");
        let mut unknown_active=state();
        unknown_active["body"]["equipment"]["active"]=json!("missing_item");
        failed(derive(&previous,&unknown_active),"GODOT_ADDITIVE_EQUIPMENT_ACTIVE");
        let mut missing_identity=state();
        missing_identity["body"]["equipment"]["items"][0].as_object_mut().unwrap().remove("reserve");
        failed(derive(&previous,&missing_identity),"GODOT_ADDITIVE_EQUIPMENT_SHAPE");
        // A previous state cannot claim an entry the candidate scene does not have.
        let mut forged=state();
        push(&mut forged,json!({"id":"thunder_hammer","magazine":9,"reserve":9}));
        failed(derive(&forged,&state()),"GODOT_ADDITIVE_REMOVAL_REJECTED");
        // A forged previous identity is rejected before any merge happens.
        let mut other_world=state();
        other_world["worldId"]=json!("beta");
        failed(derive(&previous,&other_world),"GODOT_PROGRESS_WORLD_MISMATCH");
        Ok(())
    }

    #[test]
    fn a_proof_that_inflates_new_ammunition_or_hides_an_addition_is_rejected() -> Result<()> {
        let previous=state();
        let mut defaults=state();
        push(&mut defaults,json!({"id":"thunder_hammer","magazine":2,"reserve":7}));
        let proof=derive(&previous,&defaults)?;
        verify_proof(&previous,&defaults,&proof)?;
        let mut inflated=proof.clone();
        inflated["snapshot"]["body"]["equipment"]["items"][1]["reserve"]=json!(9999);
        failed(verify_proof(&previous,&defaults,&inflated),"GODOT_ADDITIVE_INVALID_PROOF");
        let mut rewritten=proof.clone();
        rewritten["snapshot"]["body"]["equipment"]["items"][0]["magazine"]=json!(0);
        failed(verify_proof(&previous,&defaults,&rewritten),"GODOT_ADDITIVE_INVALID_PROOF");
        let mut hidden=proof.clone();
        hidden["added"]=json!([]);
        failed(verify_proof(&previous,&defaults,&hidden),"GODOT_ADDITIVE_INVALID_PROOF");
        let mut silent=proof.clone();
        silent["snapshot"]["body"]["equipment"]["items"].as_array_mut().unwrap().pop();
        failed(verify_proof(&previous,&defaults,&silent),"GODOT_ADDITIVE_INVALID_PROOF");
        let mut other_defaults=state();
        push(&mut other_defaults,json!({"id":"thunder_hammer","magazine":0,"reserve":0}));
        failed(verify_proof(&previous,&other_defaults,&proof),"GODOT_ADDITIVE_INVALID_PROOF");
        Ok(())
    }
}
