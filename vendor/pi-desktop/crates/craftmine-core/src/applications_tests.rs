use super::*;
use crate::WorkspaceContext;

// These are journal fixtures, not model, compiler, or native-render evidence.
fn ready() -> Result<(tempfile::TempDir, TaskJournal, WorkspaceContext, String)> {
    let dir = tempfile::tempdir()?;
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    j.world_create("world","Test",&WorldDocument{
        build:json!({"id":"base","scene":{"title":"Test","objects":[]}}),
        snapshot:json!({"format":"craftmine.progress/1","player":{"x":0,"y":6,"z":12,"yaw":0,"pitch":0}}),extensions:vec![]})?;
    let ctx = WorkspaceContext {
        project_id: "project".into(),
        session_id: "session".into(),
        turn_id: "turn".into(),
    };
    let w = j.workspace_open(&ctx, "world")?;
    j.workspace_commit(
        &ctx,
        &w.task.binding,
        "patch",
        0,
        &json!({"add":"tree"}),
        &json!({"scene":{"title":"Test","objects":[{"id":"tree"}]}}),
    )?;
    let job = j.verification_submit_with_origin(
        &ctx,
        "check",
        1,
        "Tree",
        &json!({"modelKey":"fixture/model","request":{"messageId":"user-1","text":"Add a tree"}}),
    )?;
    let id = job["id"].as_str().unwrap().to_string();
    let record = j.verification_claim(&id, "verify-owner")?;
    let hash = "a".repeat(64);
    let build_id = format!("v-{}", "a".repeat(20));
    j.verification_finish(&id,"verify-owner",&json!({"inputHash":record["inputHash"],
        "artifact":{"build":{"id":build_id,"hash":hash,"scene":record["input"]["draft"]["scene"],"behaviors":[]},"extensions":[]},
        "evidence":{"format":"craftmine.desktop-check/1","passed":true,"compiler":{"passed":true},
            "behaviors":{"build":hash,"passed":true,"modules":[]},"render":{"passed":true,"version":build_id}}}))?;
    Ok((dir, j, ctx, id))
}

fn review(j: &mut TaskJournal, check: &str, id: &str, pass: bool) -> Result<Value> {
    let record = j.review_start(check, id, "review-owner")?;
    let plan=j.review_plan(id,"review-owner",&json!({"modelKey":"fixture/model","text":"Consider a different leaf color.","assertions":[{"id":"tree"}]}))?;
    j.review_finish(id,"review-owner",&json!({"format":"craftmine.desktop-review/1","inputHash":record["inputHash"],
        "planHash":plan["hash"],
        "modelKey":"fixture/model","advisory":true,"verdict":"block","text":"Consider a different leaf color.",
        "acceptance":{"passed":pass,"assertions":[{"id":"tree","passed":pass}],"verificationOutputHash":record["input"]["verificationOutputHash"]}}))
}

fn prepare(j: &mut TaskJournal, check: &str, id: &str) -> Result<Value> {
    let w = j.world_read("world")?;
    j.application_prepare(
        id,
        "apply-owner",
        check,
        "review",
        "world",
        w.summary.revision,
        &w.world.snapshot,
    )
}
fn proof(receipt: &Value) -> Value {
    json!({"format":"craftmine.desktop-application/1","inputHash":receipt["inputHash"],
        "render":{"passed":true,"version":receipt["input"]["buildId"],"capture":{"sha256":"b".repeat(64)}},
        "player":receipt["input"]["snapshot"]["player"]})
}

#[test]
fn application_is_atomic_replayable_and_advances_only_consumed_drafts() -> Result<()> {
    let (dir, mut j, ctx, check) = ready()?;
    let original = j.world_read("world")?;
    let mut latest = original.world.snapshot.clone();
    latest["player"]["x"] = json!(9);
    j.world_save_progress("world", 0, "base", &latest)?;
    review(&mut j, &check, "review", true)?; // Advisory "block" does not block.
    j.workspace_end_turn("session", "turn", "completed")?;
    let receipt = prepare(&mut j, &check, "apply")?;
    let evidence = proof(&receipt);
    assert_eq!(j.world_read("world")?.world.build["id"], "base");
    assert_eq!(
        j.application_commit("apply", "apply-owner", &evidence)?["status"],
        "applied"
    );
    assert_eq!(
        j.application_commit("apply", "apply-owner", &evidence)?["status"],
        "applied"
    );
    let formal = j.world_read("world")?;
    assert_eq!(formal.summary.revision, 2);
    assert_eq!(formal.world.snapshot, latest);
    assert_eq!(formal.world.build["id"], receipt["input"]["buildId"]);
    let (backup, hash): (String, String) = j.db.query_row(
        "SELECT previous_world,previous_hash FROM craftmine_applications WHERE id='apply'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    assert_eq!(digest(&backup), hash);
    assert_eq!(
        serde_json::from_str::<WorldDocument>(&backup)?.snapshot,
        latest
    );
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(j.application_recover()?, 0);
    assert_eq!(j.application_read("apply")?["status"], "applied");
    let next = WorkspaceContext {
        turn_id: "next".into(),
        ..ctx
    };
    let w = j.workspace_open(&next, "ignored-selected-world")?;
    assert_eq!(
        w.task.binding.base_build,
        formal.world.build["id"].as_str().unwrap()
    );
    assert_eq!(w.task.draft["scene"], formal.world.build["scene"]);
    assert!(w.resumed_from.is_none());
    Ok(())
}

#[test]
fn missing_review_failed_request_and_forged_load_cannot_publish() -> Result<()> {
    let (_dir, mut j, _ctx, check) = ready()?;
    assert!(prepare(&mut j, &check, "apply").is_err());
    review(&mut j, &check, "review", false)?;
    assert!(prepare(&mut j, &check, "apply")
        .unwrap_err()
        .to_string()
        .contains("REQUEST_CHECK_FAILED"));
    review(&mut j, &check, "review-ok", true)?;
    let w = j.world_read("world")?;
    let mut moved = w.world.snapshot.clone();
    moved["player"]["x"] = json!(20);
    assert!(j
        .application_prepare(
            "apply",
            "apply-owner",
            &check,
            "review-ok",
            "world",
            0,
            &moved
        )
        .is_err());
    assert!(j
        .application_prepare(
            "apply",
            "apply-owner",
            &check,
            "review-ok",
            "foreign",
            0,
            &w.world.snapshot
        )
        .is_err());
    let receipt = j.application_prepare(
        "apply",
        "apply-owner",
        &check,
        "review-ok",
        "world",
        0,
        &w.world.snapshot,
    )?;
    let valid = proof(&receipt);
    for (pointer, bad) in [
        ("/inputHash", json!("wrong")),
        ("/render/passed", json!(false)),
        ("/render/version", json!("wrong")),
        ("/render/capture/sha256", json!("é".repeat(32))),
        ("/player/x", json!(1)),
    ] {
        let mut forged = valid.clone();
        *forged.pointer_mut(pointer).unwrap() = bad;
        assert!(
            j.application_commit("apply", "apply-owner", &forged)
                .is_err(),
            "{pointer}"
        );
        assert_eq!(j.world_read("world")?, w);
    }
    assert!(j
        .application_commit("apply", "foreign-owner", &valid)
        .is_err());
    assert_eq!(j.world_read("world")?, w);
    Ok(())
}

#[test]
fn preparing_excludes_writes_and_abort_preserves_draft_and_progress() -> Result<()> {
    let (_dir, mut j, ctx, check) = ready()?;
    review(&mut j, &check, "review", true)?;
    let original = j.world_read("world")?;
    let w = j.workspace_inspect(&ctx)?;
    let receipt = prepare(&mut j, &check, "apply")?;
    assert!(j
        .world_save_progress("world", 0, "base", &original.world.snapshot)
        .unwrap_err()
        .to_string()
        .contains("APPLICATION_BUSY"));
    assert!(j
        .workspace_commit(
            &ctx,
            &w.task.binding,
            "late",
            1,
            &json!({"x":1}),
            &w.task.draft
        )
        .is_err());
    assert!(j
        .workspace_open(
            &WorkspaceContext {
                turn_id: "next".into(),
                ..ctx.clone()
            },
            "world"
        )
        .is_err());
    assert!(prepare(&mut j, &check, "other-apply").is_err());
    assert_eq!(prepare(&mut j, &check, "apply")?["id"], receipt["id"]);
    j.application_abort("apply")?;
    assert!(j
        .application_commit("apply", "apply-owner", &proof(&receipt))
        .is_err());
    assert_eq!(j.world_read("world")?, original);
    assert_eq!(j.workspace_inspect(&ctx)?.task.draft, w.task.draft);
    j.world_save_progress("world", 0, "base", &original.world.snapshot)?;
    Ok(())
}

#[test]
fn restart_timeout_and_cancel_revoke_pending_publication() -> Result<()> {
    let (dir, mut j, ctx, check) = ready()?;
    review(&mut j, &check, "review", true)?;
    let receipt = prepare(&mut j, &check, "apply")?;
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(j.application_recover()?, 1);
    assert!(j
        .application_commit("apply", "apply-owner", &proof(&receipt))
        .is_err());
    let timed = prepare(&mut j, &check, "timed")?;
    j.db.execute(
        "UPDATE craftmine_applications SET updated_at=0 WHERE id='timed'",
        [],
    )?;
    assert_eq!(j.application_read("timed")?["status"], "interrupted");
    assert!(j
        .application_commit("timed", "apply-owner", &proof(&timed))
        .is_err());
    let cancel = prepare(&mut j, &check, "cancel")?;
    j.workspace_end_turn(&ctx.session_id, &ctx.turn_id, "aborted")?;
    assert!(j
        .application_commit("cancel", "apply-owner", &proof(&cancel))
        .is_err());
    j.application_abort("cancel")?;
    assert_eq!(j.world_read("world")?.world.build["id"], "base");
    Ok(())
}

#[test]
fn review_requires_exact_model_input_and_persists_machine_failures() -> Result<()> {
    let (_dir, mut j, ctx, check) = ready()?;
    let r = j.review_start(&check, "review", "owner")?;
    let plan = j.review_plan(
        "review",
        "owner",
        &json!({"modelKey":"fixture/model","text":"Suggestion","assertions":[{"id":"tree"}]}),
    )?;
    let good = json!({"format":"craftmine.desktop-review/1","inputHash":r["inputHash"],"advisory":true,
        "planHash":plan["hash"],"modelKey":"fixture/model","text":"Suggestion", "acceptance":{"verificationOutputHash":r["input"]["verificationOutputHash"],"passed":false,"assertions":[{"id":"tree","passed":false}]}});
    for (pointer, value) in [
        ("/inputHash", json!("forged")),
        ("/modelKey", json!("other/model")),
        ("/acceptance/passed", json!(true)),
        ("/advisory", json!(false)),
    ] {
        let mut bad = good.clone();
        *bad.pointer_mut(pointer).unwrap() = value;
        assert!(j.review_finish("review", "owner", &bad).is_err());
    }
    assert!(j.review_finish("review", "other", &good).is_err());
    assert_eq!(
        j.review_finish("review", "owner", &good)?["status"],
        "completed"
    );
    assert_eq!(j.review_finish("review", "owner", &good)?["output"], good);
    let w = j.workspace_inspect(&ctx)?;
    j.workspace_commit(
        &ctx,
        &w.task.binding,
        "next",
        1,
        &json!({"change":true}),
        &json!({"scene":{"objects":[]}}),
    )?;
    assert_eq!(j.review_read("review")?["current"], false);
    assert!(prepare(&mut j, &check, "apply").is_err());
    Ok(())
}

#[test]
fn uncommitted_draft_is_never_reset_by_an_unrelated_application() -> Result<()> {
    let (_dir, mut j, ctx, check) = ready()?;
    review(&mut j, &check, "review", true)?;
    let receipt = prepare(&mut j, &check, "apply")?;
    j.application_commit("apply", "apply-owner", &proof(&receipt))?;
    let next = WorkspaceContext {
        turn_id: "dirty".into(),
        ..ctx
    };
    let w = j.workspace_open(&next, "world")?;
    let draft = json!({"scene":{"objects":[{"id":"unfinished"}]}});
    j.workspace_commit(
        &next,
        &w.task.binding,
        "dirty",
        0,
        &json!({"edit":true}),
        &draft,
    )?;
    // Simulate a different committed base through the trusted database boundary.
    let mut world = j.world_read("world")?.world;
    world.build["id"] = json!("other-build");
    let body = worlds::encode(&world)?;
    j.db.execute(
        "UPDATE craftmine_worlds SET document=?1,content_hash=?2 WHERE id='world'",
        params![body, digest(&body)],
    )?;
    assert!(j
        .workspace_open(
            &WorkspaceContext {
                turn_id: "later".into(),
                ..next.clone()
            },
            "world"
        )
        .unwrap_err()
        .to_string()
        .contains("DRAFT_BASE_CONFLICT"));
    assert_eq!(j.workspace_inspect(&next)?.task.draft, draft);
    Ok(())
}
