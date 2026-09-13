//! Opaque local CLI checkpoints. Rust's ordinary transcript remains canonical.
use anyhow::{anyhow, Result};
use serde_json::Value;
use crate::db::Database;

pub fn get(db: &Database, session: &str) -> Result<Option<Value>> {
    let exists: bool = db.conn().query_row("SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)", [session], |row| row.get(0))?;
    if !exists { return Err(anyhow!("CODEX_SESSION_MISSING")); }
    db.kv_get("codex-transport", session)
}

pub fn set(db: &Database, session: &str, turn: &str, value: &Value) -> Result<()> {
    let current: bool = db.conn().query_row("SELECT EXISTS(SELECT 1 FROM turns WHERE id=?1 AND session_id=?2 AND status='running')", [turn, session], |row| row.get(0))?;
    if !current { return Err(anyhow!("CODEX_ACTIVE_TURN_REQUIRED")); }
    validate(value)?;
    db.kv_set("codex-transport", session, value)
}

fn validate(value: &Value) -> Result<()> {
    let invalid = || anyhow!("CODEX_CHECKPOINT_INVALID");
    let object = value.as_object().ok_or_else(invalid)?;
    if object.keys().any(|key| !["bindingDigest", "transcriptDigest", "checkpoint"].contains(&key.as_str())) { return Err(invalid()); }
    for key in ["bindingDigest", "transcriptDigest"] {
        if !value[key].as_str().is_some_and(|v| v.len()==64 && v.bytes().all(|b| b.is_ascii_hexdigit())) { return Err(invalid()); }
    }
    let checkpoint = value["checkpoint"].as_object().ok_or_else(invalid)?;
    if checkpoint.keys().any(|key| !["version", "model", "effort", "threadId", "toolDigest", "submitted", "synchronized", "usageTotal"].contains(&key.as_str())) { return Err(invalid()); }
    let c = &value["checkpoint"];
    if c["version"] != 1 || c["model"] != "gpt-6-astra" || c["effort"] != "xhigh" ||
        !c["submitted"].is_boolean() || !c["synchronized"].is_boolean() ||
        !c["threadId"].as_str().is_some_and(|s| !s.is_empty() && s.len()<=160 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b==b'-' || b==b'_')) ||
        !c["toolDigest"].as_str().is_some_and(|s| s.len()==64 && s.bytes().all(|b| b.is_ascii_hexdigit())) { return Err(invalid()); }
    if let Some(usage) = c.get("usageTotal") {
        let usage = usage.as_object().ok_or_else(invalid)?;
        if usage.iter().any(|(key, v)| !["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheWriteInputTokens", "reasoningOutputTokens"].contains(&key.as_str()) || v.as_u64().is_none_or(|n| n>9_007_199_254_740_991)) { return Err(invalid()); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn checkpoint_survives_cold_reopen_but_ended_and_foreign_turns_cannot_write() {
        let directory=tempfile::tempdir().unwrap();
        let db=Database::open_in_dir(directory.path()).unwrap();
        let session=crate::sessions::create_session(&db,None,None,None,None,None).unwrap();
        let foreign=crate::sessions::create_session(&db,None,None,None,None,None).unwrap();
        let turn=crate::sessions::begin_turn(&db,&session.id,Some("codex-cli"),Some("gpt-6-astra")).unwrap();
        let value=json!({"bindingDigest":"a".repeat(64),"transcriptDigest":"b".repeat(64),"checkpoint":{
            "version":1,"model":"gpt-6-astra","effort":"xhigh","threadId":"thread-123","toolDigest":"c".repeat(64),"submitted":true,"synchronized":true}});
        assert!(set(&db,&foreign.id,&turn,&value).is_err());
        set(&db,&session.id,&turn,&value).unwrap();
        crate::sessions::end_turn(&db,&turn,"aborted",None,None,false).unwrap();
        assert!(set(&db,&session.id,&turn,&value).is_err());
        drop(db);
        let reopened=Database::open_in_dir(directory.path()).unwrap();
        assert_eq!(get(&reopened,&session.id).unwrap(),Some(value));
        crate::sessions::delete_session(&reopened,&session.id).unwrap();
        assert_eq!(reopened.kv_get("codex-transport",&session.id).unwrap(),None);
    }
    #[test]
    fn opaque_metadata_never_accepts_transcript_credentials_or_model_override() {
        let value = json!({"bindingDigest":"a".repeat(64),"transcriptDigest":"b".repeat(64),"checkpoint":{
            "version":1,"model":"gpt-6-astra","effort":"xhigh","threadId":"opaque-123","toolDigest":"c".repeat(64),"submitted":true,"synchronized":true,
            "usageTotal":{"inputTokens":7,"outputTokens":3,"totalTokens":10,"cacheWriteInputTokens":0}}});
        validate(&value).unwrap();
        for key in ["messages", "apiKey", "worldId"] {
            let mut forged=value.clone(); forged["checkpoint"][key]=json!("not metadata"); assert!(validate(&forged).is_err());
        }
        let mut wrong=value.clone(); wrong["checkpoint"]["model"]=json!("other"); assert!(validate(&wrong).is_err());
        let mut wrong=value.clone(); wrong["checkpoint"]["usageTotal"]["inputTokens"]=json!(-1); assert!(validate(&wrong).is_err());
    }
}
