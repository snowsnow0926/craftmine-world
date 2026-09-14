//! Feedback is durable user data, including imported identity and reply chains.
use super::*;
use crate::worlds::WorldDocument;
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::path::Path;

const TABLE: &str = "craftmine_playtest_feedback";
const PRODUCT_TABLES: &[&str] = &[
    TABLE,
    "craftmine_world_briefs",
    "craftmine_world_brief_operations",
    "craftmine_world_brief_proposals",
];
const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

fn fixture(path: &Path) -> Result<(TaskJournal, Vec<Value>)> {
    let mut journal = TaskJournal::open(path)?;
    let world = WorldDocument {
        build: json!({"id":"build-a","scene":{"format":"craftmine.scene/3","objects":[]}}),
        snapshot: json!({"format":"craftmine.progress/1","player":{"x":0.5,"y":6,"z":12.5,"yaw":0,"pitch":0}}),
        extensions: vec![],
    };
    journal.world_create("author", "Author", &world)?;
    journal.world_create("other", "Other", &world)?;
    let image_hash = Sha256::digest(STANDARD.decode(PNG)?)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let mut reports = Vec::new();
    for index in 0..2 {
        let mut report = json!({"format":"craftmine.playtest-feedback/1","createdAt":index+1,
            "context":{"worldId":"visitor-world","buildId":"visitor-build","worldRevision":7,
                "contentHash":"a".repeat(64),"baseId":"creation-sandbox","baseVersion":"1",
                "engineVersion":"4.7.2","progressFormat":"craftmine.godot-progress/1"},
            "client":{"version":"0.14.4-preview.22","commit":null},
            "description":if index==0 {"Dog blocks the road"} else {"Please preserve the city while repairing the dog"},
            "expected":"Walk past the companion","replyTo":reports.first().map(|v: &Value|v["id"].clone()),
            "screenshot":{"pngBase64":PNG,"sha256":image_hash,"worldId":"visitor-world","buildId":"visitor-build"}});
        report["id"] = json!(format!(
            "feedback-{}",
            digest(&serde_json::to_string(&report)?)
        ));
        journal.playtest_request(
            "playtest.record",
            &json!({"worldId":"author","origin":"imported","report":report}),
        )?;
        reports.push(report);
    }
    journal.world_brief_edit(&goal_request())?;
    let brief = journal.world_brief_read(&json!({"worldId":"author"}))?;
    journal.world_brief_edit(
        &json!({"worldId":"author","action":"review","operationId":"goal-review",
        "expectedRevision":1,"id":brief["entries"][0]["id"],"buildId":"build-a","accepted":true}),
    )?;
    let context = crate::WorkspaceContext {
        project_id: "project".into(),
        session_id: "author-session".into(),
        turn_id: "author-turn".into(),
    };
    journal.workspace_open(&context, "author")?;
    journal.task_record_context(&json!({"context":context,"requestId":"original-request","kind":"request","text":"Keep the entire city and repair the dog"}))?;
    journal.world_brief_tool(&json!({"context":context,"mode":"propose","operationId":"goal-proposal","expectedRevision":2,
        "entries":[{"kind":"goal","text":"The dog can be walked past"}]}))?;
    journal.workspace_end_turn(&context.session_id, &context.turn_id, "completed")?;
    Ok((journal, reports))
}

fn goal_request() -> Value {
    json!({"worldId":"author","action":"add","operationId":"goal-add",
    "expectedRevision":0,"kind":"preserve","text":"Keep the entire city"})
}

fn assert_brief(journal: &mut TaskJournal, expected: &Value) -> Result<()> {
    let brief = journal.world_brief_read(&json!({"worldId":"author"}))?;
    assert_eq!(&brief, expected);
    assert_eq!(
        brief["entries"][0]["review"],
        "player-accepted-current-build"
    );
    assert_eq!(brief["proposals"].as_array().unwrap().len(), 1);
    assert_eq!(
        brief["entries"].as_array().unwrap().len(),
        1,
        "pending proposal is not accepted"
    );
    assert_eq!(
        brief["recentRequests"][0]["text"],
        "Keep the entire city and repair the dog"
    );
    // The original operation receipt must survive; its stale CAS is a replay.
    journal.world_brief_edit(&goal_request())?;
    assert_eq!(
        journal.world_brief_read(&json!({"worldId":"author"}))?,
        brief
    );
    Ok(())
}

fn rows(db: &Connection) -> Result<Vec<(String, String, String, i64)>> {
    Ok(db
        .prepare("SELECT world_id,id,body,created_at FROM craftmine_playtest_feedback ORDER BY id")?
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?)
}

fn assert_reports(journal: &mut TaskJournal, reports: &[Value]) -> Result<()> {
    for report in reports {
        assert_eq!(
            journal.playtest_request(
                "playtest.read",
                &json!({"worldId":"author","id":report["id"]})
            )?,
            *report
        );
        assert!(journal
            .playtest_request(
                "playtest.read",
                &json!({"worldId":"other","id":report["id"]})
            )
            .is_err());
    }
    let listed = journal.playtest_request("playtest.list", &json!({"worldId":"author"}))?;
    assert_eq!(listed["items"].as_array().unwrap().len(), 2);
    let reply = listed["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == reports[1]["id"])
        .unwrap();
    assert_eq!(reply["replyTo"], reports[0]["id"]);
    assert_eq!(reply["sameBuild"], false);
    Ok(())
}

#[test]
fn feedback_reports_replies_and_screenshots_survive_all_archive_forms_and_cold_reopen() -> Result<()>
{
    for kind in ["domain", "complete", "portable"] {
        let dir = tempfile::tempdir()?;
        let (mut source, reports) = fixture(&dir.path().join("source/tasks.sqlite"))?;
        let before = rows(&source.db)?;
        let before_brief = source.world_brief_read(&json!({"worldId":"author"}))?;
        let archive_path = dir.path().join("feedback.cmarchive");
        let archive = match kind {
            "domain" => source.backup_export(&json!({"operationId":"export"}))?["archive"].clone(),
            "complete" => {
                source.backup_export_full(&json!({"operationId":"export"}))?["archive"].clone()
            }
            _ => source.backup_export_portable(
                &json!({"operationId":"export","archivePath":archive_path}),
            )?,
        };
        drop(source);
        std::fs::rename(
            dir.path().join("source"),
            dir.path().join("source-unavailable"),
        )?;
        let target = dir.path().join("target");
        let mut restored = TaskJournal::open(&target.join("tasks.sqlite"))?;
        let expected = restored.backup_status(&json!({}))?["currentHash"].clone();
        match kind {
            "domain" => {
                restored.backup_restore(&json!({"operationId":"restore","archive":archive,"expectedCurrentHash":expected}))?;
            }
            "complete" => {
                restored.backup_restore_full(&json!({"operationId":"restore","archive":archive,"expectedCurrentHash":expected}))?;
            }
            _ => {
                restored.backup_restore_portable(&json!({"operationId":"restore","archivePath":archive_path,"targetDirectory":target}))?;
            }
        }
        assert_eq!(rows(&restored.db)?, before, "{kind}");
        assert_reports(&mut restored, &reports)?;
        assert_brief(&mut restored, &before_brief)?;
        drop(restored);
        let mut reopened = TaskJournal::open(&target.join("tasks.sqlite"))?;
        assert_eq!(rows(&reopened.db)?, before, "{kind} cold reopen");
        assert_reports(&mut reopened, &reports)?;
        assert_brief(&mut reopened, &before_brief)?;
    }
    Ok(())
}

fn rehash_domain(archive: &mut Value) -> Result<()> {
    archive["hash"] = json!(digest(&serde_json::to_string(&archive["tables"])?));
    Ok(())
}

#[test]
fn archives_before_feedback_restore_only_the_known_absent_table_as_empty() -> Result<()> {
    for kind in ["domain", "complete", "portable"] {
        let dir = tempfile::tempdir()?;
        let (mut source, _) = fixture(&dir.path().join("source/tasks.sqlite"))?;
        let archive_path = dir.path().join("old.cmarchive");
        let archive = match kind {
            "domain" => {
                let mut archive =
                    source.backup_export(&json!({"operationId":"export"}))?["archive"].clone();
                for table in PRODUCT_TABLES {
                    archive["tables"].as_object_mut().unwrap().remove(*table);
                }
                rehash_domain(&mut archive)?;
                archive
            }
            "complete" => {
                let mut archive =
                    source.backup_export_full(&json!({"operationId":"export"}))?["archive"].clone();
                for table in PRODUCT_TABLES {
                    archive["domain"]["tables"]
                        .as_object_mut()
                        .unwrap()
                        .remove(*table);
                }
                rehash_domain(&mut archive["domain"])?;
                archive["provenance"]["domainHash"] = archive["domain"]["hash"].clone();
                archive.as_object_mut().unwrap().remove("hash");
                archive["hash"] = json!(digest(&serde_json::to_string(&archive)?));
                archive
            }
            _ => {
                // A real stream written from the exact pre-feedback table set.
                source.db.execute_batch(
                    "DROP TABLE craftmine_playtest_feedback;
                    DROP TABLE craftmine_world_brief_proposals;
                    DROP TABLE craftmine_world_brief_operations;
                    DROP TABLE craftmine_world_briefs;",
                )?;
                source.backup_export_portable(
                    &json!({"operationId":"export","archivePath":archive_path}),
                )?
            }
        };
        let target = dir.path().join("target");
        let mut restored = TaskJournal::open(&target.join("tasks.sqlite"))?;
        let expected = restored.backup_status(&json!({}))?["currentHash"].clone();
        match kind {
            "domain" => {
                restored.backup_restore(&json!({"operationId":"restore","archive":archive,"expectedCurrentHash":expected}))?;
            }
            "complete" => {
                restored.backup_restore_full(&json!({"operationId":"restore","archive":archive,"expectedCurrentHash":expected}))?;
            }
            _ => {
                restored.backup_restore_portable(&json!({"operationId":"restore","archivePath":archive_path,"targetDirectory":target}))?;
            }
        }
        assert!(rows(&restored.db)?.is_empty(), "{kind}");
        let brief = restored.world_brief_read(&json!({"worldId":"author"}))?;
        assert_eq!(brief["entries"], json!([]));
        assert_eq!(brief["proposals"], json!([]));
        assert_eq!(restored.world_list()?.len(), 2, "{kind}");
        assert_eq!(
            columns(&restored.db, TABLE)?,
            vec!["world_id", "id", "body", "created_at"]
        );
    }
    Ok(())
}

#[test]
fn malformed_present_feedback_table_is_rejected_without_changing_current_feedback() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let (mut journal, reports) = fixture(&dir.path().join("tasks.sqlite"))?;
    let archive = journal.backup_export(&json!({"operationId":"export"}))?["archive"].clone();
    let before = rows(&journal.db)?;
    let expected = journal.backup_status(&json!({}))?["currentHash"].clone();
    for kind in ["columns", "foreign-key", "hash"] {
        let mut bad = archive.clone();
        match kind {
            "columns" => {
                bad["tables"][TABLE]["columns"]
                    .as_array_mut()
                    .unwrap()
                    .remove(2);
            }
            "foreign-key" => {
                bad["tables"][TABLE]["rows"][0][0] = json!("absent-world");
            }
            _ => {
                bad["tables"][TABLE]["rows"][0][2] = json!("tampered body");
            }
        }
        if kind != "hash" {
            rehash_domain(&mut bad)?;
        }
        let failure = journal
            .backup_restore(
                &json!({"operationId":kind,"archive":bad,"expectedCurrentHash":expected}),
            )
            .unwrap_err()
            .to_string();
        assert!(
            failure.contains(match kind {
                "columns" => "BACKUP_COLUMNS_MISMATCH",
                "foreign-key" => "BACKUP_FOREIGN_KEY_FAILURE",
                _ => "BACKUP_HASH_MISMATCH",
            }),
            "{kind}: {failure}"
        );
        assert_eq!(rows(&journal.db)?, before);
        assert_eq!(journal.backup_status(&json!({}))?["currentHash"], expected);
        assert_reports(&mut journal, &reports)?;
    }
    Ok(())
}
