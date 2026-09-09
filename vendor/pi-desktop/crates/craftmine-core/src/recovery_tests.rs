use super::*;
use crate::WorldDocument;

fn fixture() -> Result<(tempfile::TempDir, TaskJournal, WorkspaceContext)> {
    let directory = tempfile::tempdir()?;
    let mut journal = TaskJournal::open(&directory.path().join("tasks.sqlite"))?;
    journal.world_create("world-a", "World A", &WorldDocument {
        build: json!({"id":"v-initial","scene":{"format":"craftmine.scene/2","title":"World A","night":false,"objects":[],"systems":[]}}),
        snapshot: json!({"format":"craftmine.progress/1","player":{"x":0,"y":6,"z":0,"yaw":0,"pitch":0}}),
        extensions: vec![],
    })?;
    let context = WorkspaceContext {
        project_id: "project-a".into(),
        session_id: "session-a".into(),
        turn_id: "turn-original".into(),
    };
    journal.workspace_open(&context, "world-a")?;
    Ok((directory, journal, context))
}

fn reserve(journal: &mut TaskJournal, context: &WorkspaceContext, id: &str) -> Result<Value> {
    let facts = journal.task_context(&json!({"context":context}))?;
    journal.budget_call("budget.reserve",&json!({"binding":facts["binding"],"generation":facts["generation"],"requestId":id,"purpose":"creation","estimatedInputTokens":70,"maxOutputTokens":30}))
}

#[test]
fn failed_resume_launch_can_resume_again_without_resetting_budget_draft_or_goal() -> Result<()> {
    let (_directory, mut journal, context) = fixture()?;
    journal.task_record_context(&json!({"context":context,"requestId":"original-goal","kind":"request","text":"Keep the original tree and movement"}))?;
    let original = journal.workspace_inspect(&context)?;
    let draft = json!({"scene":{"format":"craftmine.scene/2","title":"World A","night":false,"objects":[{"id":"tree"}],"systems":[]}});
    journal.workspace_commit(
        &context,
        &original.task.binding,
        "edit-tree",
        0,
        &json!({"edit":"tree"}),
        &draft,
    )?;
    reserve(&mut journal, &context, "original-model")?;
    let before = journal.task_context(&json!({"context":context}))?;
    journal.budget_call("budget.settle",&json!({"binding":before["binding"],"generation":1,"requestId":"original-model","status":"known","usage":{"inputTokens":10,"outputTokens":20}}))?;
    for id in ["compression-1", "compression-2", "compression-3"] {
        journal.budget_call(
            "budget.boundary",
            &json!({"binding":before["binding"],"generation":1,"eventId":id,"kind":"compaction"}),
        )?;
    }
    journal.task_recover()?;
    let mut launched = context.clone();
    launched.turn_id = "resumed-launch".into();
    journal.task_resume(
        &json!({"context":launched,"taskId":before["binding"]["taskId"],"generation":1}),
    )?;
    reserve(&mut journal, &launched, "new-launch-request")?;
    let interrupted_args = json!({"context":launched,"reason":"RESUME_LAUNCH_FAILED"});
    let receipt = journal.task_interrupt(&interrupted_args)?;
    assert_eq!(receipt["generation"], 2);
    assert_eq!(
        receipt["budget"]["ownerTaskId"],
        before["budget"]["ownerTaskId"]
    );
    assert_eq!(receipt["budget"]["actualTokens"], 30);
    assert_eq!(receipt["budget"]["reservedTokens"], 100);
    assert_eq!(receipt["budget"]["unknownRequestCount"], 1);
    assert_eq!(receipt["budget"]["compactionCount"], 3);
    assert_eq!(journal.task_interrupt(&interrupted_args)?, receipt);
    assert!(journal
        .task_interrupt(&json!({"context":launched,"reason":"DIFFERENT_FAILURE"}))
        .is_err());
    journal.workspace_end_turn(&launched.session_id, &launched.turn_id, "error")?;
    assert_eq!(
        journal.task_context(&json!({"context":launched}))?["recovery"],
        "interrupted"
    );
    assert_eq!(journal.task_interrupt(&interrupted_args)?, receipt);
    let mut next = launched.clone();
    next.turn_id = "resumed-again".into();
    assert!(journal
        .workspace_open(&next, "world-a")
        .unwrap_err()
        .to_string()
        .contains("EXPLICIT_RECOVERY_REQUIRED"));
    let resumed =
        journal.task_resume(&json!({"context":next,"taskId":receipt["taskId"],"generation":2}))?;
    assert_eq!(resumed["generation"], 3);
    assert_eq!(resumed["budget"], receipt["budget"]);
    assert_eq!(journal.workspace_inspect(&next)?.task.draft, draft);
    assert_eq!(
        journal.task_context(&json!({"context":next}))?["requirements"][0]["text"],
        "Keep the original tree and movement"
    );
    assert!(journal
        .task_interrupt(&interrupted_args)
        .unwrap_err()
        .to_string()
        .contains("STALE_TURN"));
    assert!(journal
        .task_interrupt(&json!({"context":context,"reason":"OLD_TURN"}))
        .is_err());
    assert_eq!(
        journal.task_context(&json!({"context":next}))?["status"],
        "running"
    );
    Ok(())
}

#[test]
fn interrupt_revokes_only_its_jobs_and_lease_and_rejects_untrusted_reason_text() -> Result<()> {
    let (_directory, mut journal, context) = fixture()?;
    let initial = journal.workspace_inspect(&context)?;
    let draft = json!({"scene":{"format":"craftmine.scene/2","title":"World A","night":false,"objects":[{"id":"tree"}],"systems":[]}});
    journal.workspace_commit(
        &context,
        &initial.task.binding,
        "edit",
        0,
        &json!({}),
        &draft,
    )?;
    let job = journal.verification_submit(&context, "check", 1, "Check draft")?;
    let task_id = &initial.task.binding.task_id;
    // Durable job-state fixtures only. These rows test revocation of worker
    // tokens; they do not claim a review, application or model has succeeded.
    journal.db.execute("INSERT INTO craftmine_reviews(id,verification_id,input,input_hash,status,token,created_at,updated_at) VALUES('review-interrupt',?1,'{}','fixture','running','old-token',0,0)",[job["id"].as_str().unwrap()])?;
    journal.db.execute("INSERT INTO craftmine_applications(id,world_id,verification_id,review_id,request_hash,input,input_hash,previous_world,previous_hash,status,token,created_at,updated_at) VALUES('application-interrupt','world-a',?1,'review-interrupt','fixture','{}','fixture','{}','fixture','prepared','old-token',0,0)",[job["id"].as_str().unwrap()])?;
    let now = worlds::timestamp()?;
    journal.db.execute(
        "UPDATE craftmine_reviews SET created_at=?1,updated_at=?1 WHERE id='review-interrupt'",
        [now],
    )?;
    journal.db.execute("UPDATE craftmine_applications SET created_at=?1,updated_at=?1 WHERE id='application-interrupt'", [now])?;
    // A separate lease and budget reservation must remain unaffected.
    let world = journal.world_read("world-a")?.world;
    journal.world_create("world-b", "World B", &world)?;
    let other = WorkspaceContext {
        project_id: "project-b".into(),
        session_id: "session-b".into(),
        turn_id: "other-turn".into(),
    };
    journal.workspace_open(&other, "world-b")?;
    reserve(&mut journal, &other, "other-reservation")?;
    for reason in [
        "failure with raw provider details",
        "API_KEY=secret",
        "C:/Users/private",
        "",
        "lowercase",
        "123_BAD",
    ] {
        assert!(journal
            .task_interrupt(&json!({"context":context,"reason":reason}))
            .is_err());
    }
    assert!(journal
        .task_interrupt(&json!({"context":context,"reason":"X".repeat(81)}))
        .is_err());
    assert!(journal
        .task_interrupt(&json!({"context":context,"reason":"LAUNCH_FAILED","generation":1}))
        .is_err());
    let mut forged = context.clone();
    forged.project_id = "forged-owner".into();
    assert!(journal
        .task_interrupt(&json!({"context":forged,"reason":"LAUNCH_FAILED"}))
        .is_err());
    assert_eq!(
        journal.task_context(&json!({"context":context}))?["status"],
        "running"
    );
    journal.task_interrupt(&json!({"context":context,"reason":"LAUNCH_FAILED"}))?;
    for (table, id, status) in [
        ("craftmine_reviews", "review-interrupt", "cancelled"),
        ("craftmine_applications", "application-interrupt", "aborted"),
    ] {
        let (actual, token): (String, Option<String>) = journal.db.query_row(
            &format!("SELECT status,token FROM {table} WHERE id=?1"),
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(actual, status);
        assert_eq!(token, None);
    }
    assert_eq!(
        journal.db.query_row(
            "SELECT status FROM craftmine_verifications WHERE id=?1",
            [job["id"].as_str().unwrap()],
            |row| row.get::<_, String>(0)
        )?,
        "cancelled"
    );
    assert_eq!(
        journal.db.query_row(
            "SELECT COUNT(*) FROM craftmine_world_leases WHERE task_id=?1",
            [task_id],
            |row| row.get::<_, i64>(0)
        )?,
        0
    );
    let unaffected = journal.task_context(&json!({"context":other}))?;
    assert_eq!(unaffected["lease"]["owned"], true);
    assert_eq!(unaffected["status"], "running");
    assert_eq!(unaffected["budget"]["unknownRequestCount"], 0);
    assert_eq!(unaffected["budget"]["reservedTokens"], 100);
    Ok(())
}
