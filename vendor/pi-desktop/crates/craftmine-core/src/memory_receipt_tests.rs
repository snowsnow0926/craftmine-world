use super::*;
use crate::WorldDocument;

fn fixture() -> Result<(
    tempfile::TempDir,
    TaskJournal,
    WorkspaceContext,
    Value,
    Value,
)> {
    let dir = tempfile::tempdir()?;
    let mut journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    journal.world_create("receipt-world", "Receipt", &WorldDocument {
        build: json!({"id":"v-initial","scene":{"format":"craftmine.scene/2","title":"Receipt","night":false,"objects":[],"systems":[]}}),
        snapshot: json!({"format":"craftmine.progress/1","player":{"x":0,"y":6,"z":0,"yaw":0,"pitch":0}}), extensions:vec![] })?;
    let context = WorkspaceContext {
        project_id: "receipt-project".into(),
        session_id: "receipt-session".into(),
        turn_id: "receipt-turn".into(),
    };
    journal.workspace_open(&context, "receipt-world")?;
    let record = json!({"id":"rule:receipt","kind":"project-rule","claim":"Keep flowers small","scope":{"projectId":context.project_id},"sourceRefs":["user:receipt"],"tags":["plants"],"supersedes":[]});
    let proposed = json!({"context":context,"operationId":"receipt-one","record":record});
    let lookup = json!({"projectId":context.project_id,"sessionId":context.session_id,"worldId":"receipt-world","operationId":"receipt-one","request":{"kind":"project-rule","claim":"Keep flowers small","tags":["plants"],"supersedes":[]}});
    Ok((dir, journal, context, proposed, lookup))
}

#[test]
fn committed_receipt_survives_end_turn_and_process_reopen() -> Result<()> {
    let (dir, mut journal, context, proposed, lookup) = fixture()?;
    assert_eq!(journal.memory_find_receipt(&lookup)?, Value::Null);
    let saved = journal.memory_propose(&proposed)?;
    journal.workspace_end_turn(&context.session_id, &context.turn_id, "completed")?;
    assert_eq!(journal.memory_find_receipt(&lookup)?, saved);
    drop(journal);
    let journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(journal.memory_find_receipt(&lookup)?, saved);
    let count: i64 = journal
        .db
        .query_row("SELECT COUNT(*) FROM craftmine_memories", [], |r| r.get(0))?;
    assert_eq!(count, 1);
    Ok(())
}

#[test]
fn receipt_checks_full_request_owner_and_unknown_fields() -> Result<()> {
    let (_dir, mut journal, _, proposed, lookup) = fixture()?;
    journal.memory_propose(&proposed)?;
    for field in ["projectId", "sessionId", "worldId"] {
        let mut wrong = lookup.clone();
        wrong[field] = json!("other");
        assert!(journal
            .memory_find_receipt(&wrong)
            .unwrap_err()
            .to_string()
            .contains("OWNER_MISMATCH"));
    }
    for (field, value) in [
        ("claim", json!("Changed claim")),
        ("kind", json!("workflow")),
        ("tags", json!(["other"])),
        ("supersedes", json!(["rule:other"])),
    ] {
        let mut wrong = lookup.clone();
        wrong["request"][field] = value;
        assert!(journal
            .memory_find_receipt(&wrong)
            .unwrap_err()
            .to_string()
            .contains("REPLAY_MISMATCH"));
    }
    let mut wrong = lookup.clone();
    wrong["trusted"] = json!(true);
    assert!(journal.memory_find_receipt(&wrong).is_err());
    let mut wrong = lookup.clone();
    wrong["request"]["status"] = json!("validated");
    assert!(journal.memory_find_receipt(&wrong).is_err());
    let mut trimmed = lookup.clone();
    trimmed["request"]["claim"] = json!("  Keep flowers small \n");
    assert_eq!(
        journal.memory_find_receipt(&trimmed)?,
        journal.memory_find_receipt(&lookup)?
    );
    Ok(())
}

#[test]
fn legacy_schema_migrates_without_inventing_receipt_ownership() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("tasks.sqlite");
    let db = Connection::open(&path)?;
    db.execute_batch("CREATE TABLE craftmine_memory_operations(operation_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,result TEXT NOT NULL); INSERT INTO craftmine_memory_operations VALUES('legacy','unknown','{}');")?;
    drop(db);
    let journal = TaskJournal::open(&path)?;
    let lookup = json!({"projectId":"p","sessionId":"s","worldId":"w","operationId":"legacy","request":{"kind":"project-rule","claim":"Old claim"}});
    assert!(journal
        .memory_find_receipt(&lookup)
        .unwrap_err()
        .to_string()
        .contains("MEMORY_RECEIPT_UNVERIFIABLE"));
    drop(journal);
    TaskJournal::open(&path)?;
    Ok(())
}

#[test]
fn corrupted_original_request_is_rejected_by_lookup_and_backup() -> Result<()> {
    let (_dir, mut journal, _, proposed, lookup) = fixture()?;
    journal.memory_propose(&proposed)?;
    journal.db.execute(
        "UPDATE craftmine_memory_operations SET request_json='{}'",
        [],
    )?;
    assert!(journal
        .memory_find_receipt(&lookup)
        .unwrap_err()
        .to_string()
        .contains("RECEIPT_CORRUPT"));
    let exported = journal.backup_export(&json!({"operationId":"corrupt-export"}))?;
    assert!(journal
        .backup_inspect(&json!({"archive":exported["archive"]}))
        .unwrap_err()
        .to_string()
        .contains("RECEIPT_CORRUPT"));
    Ok(())
}

#[test]
fn backup_v2_roundtrip_preserves_receipt_and_v1_migrates_to_unverifiable() -> Result<()> {
    let (_dir, mut journal, context, proposed, lookup) = fixture()?;
    let saved = journal.memory_propose(&proposed)?;
    journal.workspace_end_turn(&context.session_id, &context.turn_id, "completed")?;
    let exported = journal.backup_export(&json!({"operationId":"export-v2"}))?;
    assert_eq!(exported["archive"]["schemaVersion"], 3);
    assert_eq!(
        journal.backup_inspect(&json!({"archive":exported["archive"]}))?["valid"],
        true
    );
    let hash = journal.backup_status(&json!({}))?["currentHash"].clone();
    journal.backup_restore(&json!({"operationId":"restore-v2","archive":exported["archive"],"expectedCurrentHash":hash}))?;
    assert_eq!(journal.memory_find_receipt(&lookup)?, saved);
    let mut legacy = exported["archive"].clone();
    legacy["schemaVersion"] = json!(1);
    legacy["tables"].as_object_mut().unwrap().remove("craftmine_budget_configurations");
    legacy["tables"]["craftmine_memory_operations"]["columns"]
        .as_array_mut()
        .unwrap()
        .pop();
    for row in legacy["tables"]["craftmine_memory_operations"]["rows"]
        .as_array_mut()
        .unwrap()
    {
        row.as_array_mut().unwrap().pop();
    }
    legacy["hash"] = json!(crate::digest(&serde_json::to_string(&legacy["tables"])?));
    assert_eq!(
        journal.backup_inspect(&json!({"archive":legacy}))?["valid"],
        true
    );
    let hash = journal.backup_status(&json!({}))?["currentHash"].clone();
    journal.backup_restore(
        &json!({"operationId":"restore-v1","archive":legacy,"expectedCurrentHash":hash}),
    )?;
    assert!(journal
        .memory_find_receipt(&lookup)
        .unwrap_err()
        .to_string()
        .contains("UNVERIFIABLE"));
    let again = journal.backup_export(&json!({"operationId":"export-migrated"}))?;
    assert_eq!(again["archive"]["schemaVersion"], 3);
    assert_eq!(
        journal.backup_inspect(&json!({"archive":again["archive"]}))?["valid"],
        true
    );
    Ok(())
}
