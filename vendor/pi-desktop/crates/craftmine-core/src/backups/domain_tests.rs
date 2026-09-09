//! Domain snapshot coverage tests.
//!
//! The domain archive is bounded by a hardcoded allowlist, so a table that is
//! registered after the allowlist was written must fail the export instead of
//! being dropped silently.
use super::*;

fn journal() -> Result<(tempfile::TempDir, TaskJournal)> {
    let dir = tempfile::tempdir()?;
    let journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    Ok((dir, journal))
}

fn seed_world(db: &Connection) -> Result<()> {
    db.execute(
        "INSERT INTO craftmine_worlds(id,title,revision,updated_at,document,content_hash)
         VALUES('world-a','World A',0,1,'{}','world-hash')",
        [],
    )?;
    Ok(())
}

#[test]
fn a_new_table_added_to_the_schema_fails_the_export() -> Result<()> {
    let (_dir, mut journal) = journal()?;
    journal
        .db
        .execute_batch("CREATE TABLE craftmine_drift_probe(id TEXT)")?;
    let error = journal
        .backup_export(&json!({"operationId":"drift"}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("BACKUP_SCHEMA_DRIFT"), "{error}");
    Ok(())
}

#[test]
fn the_domain_snapshot_carries_the_godot_and_git_tables() -> Result<()> {
    let (_dir, mut journal) = journal()?;
    seed_world(&journal.db)?;
    journal.db.execute(
        "INSERT INTO craftmine_godot_projects(world_id,revision,manifest,hash)
         VALUES('world-a',0,'{}','project-hash')",
        [],
    )?;
    journal.db.execute(
        "INSERT INTO craftmine_content_repositories(world_id,repo_id,object_format,backend,
         legacy_head_revision,created_at,switched_at)
         VALUES('world-a','repo-world-a','sha1','git',NULL,1,NULL)",
        [],
    )?;
    let result = journal.backup_export(&json!({"operationId":"snapshot"}))?;
    let tables = result["archive"]["tables"]
        .as_object()
        .context("BACKUP_TABLES_REQUIRED")?;
    for table in ["craftmine_godot_projects", "craftmine_content_repositories"] {
        let data = tables.get(table).context("BACKUP_TABLE_MISSING")?;
        assert_eq!(data["rows"].as_array().map(Vec::len), Some(1), "{table}");
    }
    assert!(tables.contains_key("craftmine_legacy_imports"));
    assert!(tables.contains_key("craftmine_asset_files"));
    Ok(())
}
