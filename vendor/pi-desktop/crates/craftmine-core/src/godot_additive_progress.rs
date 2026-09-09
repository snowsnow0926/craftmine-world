//! Fixed, additive FPS state migration. No caller-defined paths or transforms.
use super::*;
use std::collections::BTreeMap;

pub(super) fn derive(previous: &Value, defaults: &Value) -> Result<Value> {
    super::super::godot_runtime::validate_progress(previous)?;
    super::super::godot_runtime::validate_progress(defaults)?;
    for key in ["format", "worldId", "baseId", "baseVersion", "stateVersion"] {
        ensure!(previous[key] == defaults[key], "GODOT_ADDITIVE_IDENTITY_MISMATCH");
    }
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
    }
    let mut snapshot = previous.clone();
    let mut added = Vec::new();
    for key in ["targets", "interactables"] {
        let old = entries(&previous["body"][key])?;
        let next = entries(&defaults["body"][key])?;
        ensure!(old.keys().all(|id| next.contains_key(id)), "GODOT_ADDITIVE_REMOVAL_REJECTED");
        let mut result = Vec::new();
        for entry in defaults["body"][key].as_array().unwrap() {
            let id = entry["id"].as_str().unwrap();
            if let Some(existing) = old.get(id) {
                let a = existing.as_object().unwrap(); let b = entry.as_object().unwrap();
                ensure!(a.len() == b.len() && a.iter().all(|(key, value)| b.get(key).is_some_and(|other| kind(value) == kind(other))),
                    "GODOT_ADDITIVE_ENTITY_SHAPE_CHANGED");
                result.push((*existing).clone());
            }
            else {
                result.push(entry.clone());
                added.push(json!({"path":format!("/body/{key}"),"id":id}));
            }
        }
        snapshot["body"][key] = json!(result);
    }
    super::super::godot_runtime::validate_progress(&snapshot)?;
    Ok(json!({"format":"craftmine.godot-additive-progress/1","hashEncoding":"serde-json/1",
        "previousSnapshotHash":digest(&serde_json::to_string(previous)?),
        "defaultsSnapshotHash":digest(&serde_json::to_string(defaults)?),
        "snapshotHash":digest(&serde_json::to_string(&snapshot)?),"added":added,"snapshot":snapshot}))
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
