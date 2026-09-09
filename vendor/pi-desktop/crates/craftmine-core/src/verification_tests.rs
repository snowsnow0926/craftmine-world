use super::*;
use crate::WorldDocument;

fn setup() -> Result<(tempfile::TempDir, TaskJournal, WorkspaceContext)> {
    let dir = tempfile::tempdir()?;
    let mut journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    let world = WorldDocument {
        build: json!({"id":"base","scene":{"title":"Test","objects":[]}}),
        snapshot: json!({"format":"craftmine.progress/1","player":{"x":0,"y":6,"z":12,"yaw":0,"pitch":0}}),
        extensions: vec![],
    };
    journal.world_create("world", "Test", &world)?;
    let ctx = WorkspaceContext {
        project_id: "project".into(),
        session_id: "session".into(),
        turn_id: "turn".into(),
    };
    let work = journal.workspace_open(&ctx, "world")?;
    journal.workspace_commit(
        &ctx,
        &work.task.binding,
        "patch",
        0,
        &json!({"add":"tree"}),
        &json!({"scene":{"title":"Test","objects":[{"id":"tree"}]}}),
    )?;
    Ok((dir, journal, ctx))
}

fn start(journal: &mut TaskJournal, ctx: &WorkspaceContext) -> Result<(String, Value)> {
    let job = journal.verification_submit(ctx, "submit", 1, "Add a tree")?;
    let id = job["id"].as_str().unwrap().to_string();
    let record = journal.verification_claim(&id, "runner")?;
    Ok((id, record))
}

fn successful(record: &Value) -> Value {
    let hash = "a".repeat(64);
    let id = format!("v-{}", "a".repeat(20));
    json!({"inputHash":record["inputHash"],"artifact":{"build":{"id":id,"hash":hash,
        "scene":record["input"]["draft"]["scene"],"behaviors":[]},"extensions":[]},
        "evidence":{"format":"craftmine.desktop-check/1","passed":true,"compiler":{"passed":true},
        "behaviors":{"build":hash,"passed":true,"modules":[]},"render":{"passed":true,"version":id}}})
}

#[test]
fn input_receipt_and_evidence_survive_restart() -> Result<()> {
    let (dir, mut j, ctx) = setup()?;
    let (id, record) = start(&mut j, &ctx)?;
    assert_eq!(
        j.verification_submit(&ctx, "submit", 1, "Add a tree")?["id"],
        id
    );
    assert!(j
        .verification_submit(&ctx, "submit", 1, "Different")
        .unwrap_err()
        .to_string()
        .contains("REPLAY_MISMATCH"));
    assert!(j
        .verification_submit(&ctx, "another", 1, "Tree")
        .unwrap_err()
        .to_string()
        .contains("VERIFICATION_BUSY"));
    let output = successful(&record);
    j.workspace_end_turn("session", "turn", "completed")?;
    assert_eq!(
        j.verification_finish(&id, "runner", &output)?["status"],
        "passed"
    );
    assert_eq!(
        j.verification_finish(&id, "runner", &output)?["status"],
        "passed"
    );
    drop(j);
    let mut restored = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(restored.verification_recover()?, 0);
    let stored = restored.verification_read(&id, Some(&ctx))?;
    assert_eq!(stored["output"], output);
    assert_eq!(stored["current"], true);
    assert_eq!(restored.world_read("world")?.world.build["id"], "base");
    Ok(())
}

#[test]
fn forged_success_and_foreign_identity_are_rejected() -> Result<()> {
    let (_dir, mut j, ctx) = setup()?;
    let (id, record) = start(&mut j, &ctx)?;
    let output = successful(&record);
    assert!(j
        .verification_finish(&id, "foreign", &output)
        .unwrap_err()
        .to_string()
        .contains("OWNER_MISMATCH"));
    for (pointer, value) in [
        ("/inputHash", json!("forged")),
        ("/artifact/build/scene", json!({"objects":[]})),
        ("/evidence/render/passed", json!(false)),
        ("/evidence/behaviors/build", json!("another")),
        ("/evidence/behaviors/modules", json!([{"passed":true}])),
        ("/artifact/build/hash", json!("é".repeat(32))),
    ] {
        let mut bad = output.clone();
        *bad.pointer_mut(pointer).unwrap() = value;
        assert!(
            j.verification_finish(&id, "runner", &bad).is_err(),
            "{pointer}"
        );
    }
    let foreign = WorkspaceContext {
        session_id: "foreign".into(),
        ..ctx.clone()
    };
    assert!(j.verification_read(&id, Some(&foreign)).is_err());
    assert!(j.verification_cancel(&id, Some(&foreign)).is_err());
    assert_eq!(j.verification_read(&id, None)?["status"], "running");
    Ok(())
}

#[test]
fn edits_abort_and_recovery_revoke_completion() -> Result<()> {
    for event in ["edit", "abort", "new-turn", "recover", "cancel"] {
        let (_dir, mut j, ctx) = setup()?;
        let (id, record) = start(&mut j, &ctx)?;
        match event {
            "edit" => {
                let task = j.workspace_inspect(&ctx)?.task;
                j.workspace_commit(
                    &ctx,
                    &task.binding,
                    "patch2",
                    1,
                    &json!({"change":true}),
                    &json!({"scene":{"title":"Changed","objects":[]}}),
                )?;
            }
            "abort" => j.workspace_end_turn("session", "turn", "aborted")?,
            "new-turn" => {
                j.workspace_open(
                    &WorkspaceContext {
                        turn_id: "next".into(),
                        ..ctx.clone()
                    },
                    "world",
                )?;
            }
            "recover" => {
                assert_eq!(j.verification_recover()?, 1);
            }
            _ => {
                j.verification_cancel(&id, Some(&ctx))?;
            }
        }
        assert!(
            j.verification_finish(&id, "runner", &successful(&record))
                .is_err(),
            "{event}"
        );
        assert_eq!(
            j.verification_read(&id, None)?["status"],
            if event == "recover" {
                "interrupted"
            } else {
                "cancelled"
            }
        );
        assert_eq!(j.world_read("world")?.world.build["id"], "base");
    }
    Ok(())
}

#[test]
fn failed_checks_and_tampered_storage_are_distinguished() -> Result<()> {
    let (_dir, mut j, ctx) = setup()?;
    let (id, record) = start(&mut j, &ctx)?;
    let fail = json!({"inputHash":record["inputHash"],"evidence":{"format":"craftmine.desktop-check/1","passed":false,"error":"Worker exceeded deadline"}});
    assert_eq!(
        j.verification_finish(&id, "runner", &fail)?["status"],
        "failed"
    );
    let mut different = fail.clone();
    different["evidence"]["error"] = json!("other");
    assert!(j
        .verification_finish(&id, "runner", &different)
        .unwrap_err()
        .to_string()
        .contains("REPLAY_MISMATCH"));
    j.db.execute(
        "UPDATE craftmine_verifications SET output='{}' WHERE id=?1",
        [&id],
    )?;
    assert!(j
        .verification_read(&id, None)
        .unwrap_err()
        .to_string()
        .contains("CORRUPT_VERIFICATION_OUTPUT"));
    Ok(())
}

#[test]
fn stale_and_empty_drafts_cannot_queue_checks() -> Result<()> {
    let (_dir, mut j, ctx) = setup()?;
    assert!(j
        .verification_submit(&ctx, "stale", 0, "Tree")
        .unwrap_err()
        .to_string()
        .contains("STALE_DRAFT"));
    let task = j.workspace_inspect(&ctx)?.task;
    j.workspace_commit(
        &ctx,
        &task.binding,
        "revert",
        1,
        &json!({"revert":true}),
        &json!({"scene":j.world_read("world")?.world.build["scene"]}),
    )?;
    assert!(j
        .verification_submit(&ctx, "empty", 2, "Nothing")
        .unwrap_err()
        .to_string()
        .contains("NO_CHANGE"));
    Ok(())
}

#[test]
fn a_lost_worker_receipt_expires_instead_of_running_forever() -> Result<()> {
    let (_dir, mut j, ctx) = setup()?;
    let (id, record) = start(&mut j, &ctx)?;
    j.db.execute(
        "UPDATE craftmine_verifications SET updated_at=0 WHERE id=?1",
        [&id],
    )?;
    assert_eq!(j.verification_read(&id, None)?["status"], "interrupted");
    assert!(j
        .verification_finish(&id, "runner", &successful(&record))
        .is_err());
    assert_eq!(
        j.verification_submit(&ctx, "retry-new-call", 1, "Retry")?["status"],
        "queued"
    );
    Ok(())
}
