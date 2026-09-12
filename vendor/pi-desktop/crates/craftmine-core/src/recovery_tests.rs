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

/// Model elapsed wall-clock time in an authored fixture only. No production
/// caller may write a deadline or clear an already charged request.
fn expire_fixture_window(journal: &mut TaskJournal, owner: &str) -> Result<()> {
    journal.db.execute("UPDATE craftmine_budget_limits SET limits=json_set(limits,'$.deadlineAt',1) WHERE owner=?1",[owner])?;
    Ok(())
}

#[test]
fn explicit_new_message_window_preserves_budget_history_and_is_transactional() -> Result<()> {
    let (_directory, mut journal, context) = fixture()?;
    let before = journal.task_context(&json!({"context":context}))?;
    let owner = before["binding"]["taskId"].as_str().unwrap().to_string();
    let binding = before["binding"].clone();
    journal.budget_call("budget.reserve",&json!({"binding":binding,"generation":1,"requestId":"first","purpose":"creation","estimatedInputTokens":70,"maxOutputTokens":30,"limits":{"maxRequests":2,"maxTokens":500,"maxCompactions":2,"deadlineAt":worlds::timestamp()?+1_800_000}}))?;
    journal.budget_call("budget.settle",&json!({"binding":binding,"generation":1,"requestId":"first","status":"known","usage":{"inputTokens":10,"outputTokens":20}}))?;
    journal.budget_call("budget.boundary",&json!({"binding":binding,"generation":1,"eventId":"compression","kind":"compaction"}))?;
    journal.task_record_context(&json!({"context":context,"requestId":"goal","text":"Keep the original creation","kind":"request"}))?;
    expire_fixture_window(&mut journal,&owner)?;
    assert!(reserve(&mut journal,&context,"expired").unwrap_err().to_string().contains("TASK_DEADLINE_EXCEEDED"));
    journal.workspace_end_turn(&context.session_id,&context.turn_id,"aborted")?;
    let retained = journal.task_context(&json!({"context":context}))?;
    let original = journal.workspace_inspect(&context)?;
    let original_request: String = journal.db.query_row("SELECT settlement FROM craftmine_budget_requests WHERE owner=?1 AND request_id='first'",[&owner],|r|r.get(0))?;
    let mut next=context.clone();next.turn_id="explicit-continue".into();
    let mut other=context.clone();other.session_id="other-session".into();other.turn_id="other-turn".into();
    journal.workspace_open(&other,"world-a")?;
    let args=json!({"context":next,"taskId":owner,"generation":1,"renewRequestWindow":true});
    assert!(journal.task_resume(&args).unwrap_err().to_string().contains("WORLD_BUSY"));
    assert_eq!(journal.task_context(&json!({"context":context}))?["budget"],retained["budget"]);
    journal.workspace_end_turn(&other.session_id,&other.turn_id,"completed")?;
    assert!(journal.task_resume(&json!({"context":next,"taskId":owner,"generation":99,"renewRequestWindow":true})).is_err());
    let start=worlds::timestamp()?;
    let resumed=journal.task_resume(&args)?;
    let deadline=resumed["budget"]["limits"]["deadlineAt"].as_i64().unwrap();
    assert!(deadline>=start+1_800_000 && deadline<=worlds::timestamp()?+1_800_000);
    let mut expected=retained["budget"].clone();expected["limits"]["deadlineAt"]=json!(deadline);
    assert_eq!(resumed["budget"],expected);
    assert_eq!(journal.workspace_inspect(&next)?.task.draft,original.task.draft);
    assert_eq!(journal.task_context(&json!({"context":next}))?["requirements"],retained["requirements"]);
    assert_eq!(journal.task_resume(&args)?["budget"]["limits"]["deadlineAt"],deadline);
    assert_eq!(journal.db.query_row("SELECT settlement FROM craftmine_budget_requests WHERE owner=?1 AND request_id='first'",[&owner],|r|r.get::<_,String>(0))?,original_request);
    let next_id=journal.workspace_inspect(&next)?.task.binding.task_id;
    let receipt:String=journal.db.query_row("SELECT result FROM craftmine_receipts WHERE task_id=?1 AND tool_call_id='@host:resume-request-window'",[next_id],|r|r.get(0))?;
    assert_eq!(serde_json::from_str::<Value>(&receipt)?["previousLimits"],retained["budget"]["limits"]);
    let second=reserve(&mut journal,&next,"second")?;
    assert_eq!(second["budget"]["requestCount"],2);
    assert_eq!(second["budget"]["actualTokens"],30);
    assert_eq!(second["budget"]["compactionCount"],1);
    assert!(reserve(&mut journal,&next,"third").unwrap_err().to_string().contains("REQUEST_BUDGET_EXHAUSTED"));
    Ok(())
}

#[test]
fn generic_resume_and_replay_cannot_renew_an_expired_window() -> Result<()> {
    let (_directory,mut journal,context)=fixture()?;
    reserve(&mut journal,&context,"first")?;
    let before=journal.task_context(&json!({"context":context}))?;
    let owner=before["binding"]["taskId"].as_str().unwrap().to_string();
    expire_fixture_window(&mut journal,&owner)?;
    journal.workspace_end_turn(&context.session_id,&context.turn_id,"aborted")?;
    let mut next=context.clone();next.turn_id="generic-resume".into();
    let args=json!({"context":next,"taskId":owner,"generation":1});
    let resumed=journal.task_resume(&args)?;
    assert_eq!(resumed["budget"]["limits"]["deadlineAt"],1);
    // Adding the intent to an already completed resume is not a new message.
    let mut replay=args.clone();replay["renewRequestWindow"]=json!(true);
    assert_eq!(journal.task_resume(&replay)?["budget"]["limits"]["deadlineAt"],1);
    assert!(reserve(&mut journal,&next,"blocked").unwrap_err().to_string().contains("TASK_DEADLINE_EXCEEDED"));
    Ok(())
}

#[test]
fn renewal_preserves_null_policy_and_rejects_raw_deadlines() -> Result<()> {
    let (_directory,mut journal,context)=fixture()?;
    let original=journal.task_context(&json!({"context":context}))?;
    journal.budget_call("budget.reserve",&json!({"binding":original["binding"],"generation":1,"requestId":"first","purpose":"creation","estimatedInputTokens":70,"maxOutputTokens":30,"limits":{"maxRequests":null,"maxTokens":null,"maxCompactions":8,"deadlineAt":null}}))?;
    journal.workspace_end_turn(&context.session_id,&context.turn_id,"aborted")?;
    let old=journal.task_context(&json!({"context":context}))?;
    let mut next=context.clone();next.turn_id="continue-null".into();
    let args=json!({"context":next,"taskId":original["binding"]["taskId"],"generation":1,"renewRequestWindow":true});
    let mut invalid=args.clone();invalid["renewRequestWindow"]=json!(9_999_999);
    assert!(journal.task_resume(&invalid).unwrap_err().to_string().contains("INVALID_REQUEST_WINDOW_INTENT"));
    invalid=args.clone();invalid["deadlineAt"]=json!(9_999_999);
    assert!(journal.task_resume(&invalid).is_err());
    assert_eq!(journal.task_resume(&args)?["budget"],old["budget"]);
    Ok(())
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
#[test]
fn real_error_end_preserves_exhausted_task_and_resumes_after_player_removes_limit() -> Result<()> {
    let (directory, mut journal, context) = fixture()?;
    journal.task_record_context(&json!({"context":context,"requestId":"goal","kind":"request","text":"Keep the tree and original goal"}))?;
    let work = journal.workspace_inspect(&context)?;
    journal.workspace_commit(
        &context,
        &work.task.binding,
        "tree-edit",
        0,
        &json!({"add":"tree"}),
        &json!({"scene":{"title":"World A","objects":[{"id":"tree"}]}}),
    )?;
    let facts = journal.task_context(&json!({"context":context}))?;
    let configuration = json!({"projectId":context.project_id,"sessionId":context.session_id,"worldId":"world-a","taskId":facts["binding"]["taskId"],"generation":1,"operationId":"finite-limit","maxTokens":120});
    journal.budget_configure(&configuration)?;
    reserve(&mut journal, &context, "known-request")?;
    journal.budget_call("budget.settle",&json!({"binding":facts["binding"],"generation":1,"requestId":"known-request","status":"known","usage":{"inputTokens":15,"outputTokens":5}}))?;
    reserve(&mut journal, &context, "pending-request")?;
    assert!(reserve(&mut journal, &context, "over-limit")
        .unwrap_err()
        .to_string()
        .contains("TOKEN_BUDGET_EXHAUSTED"));
    // This is the actual host ending path; no task.interrupt setup shortcut.
    journal.workspace_end_turn(&context.session_id, &context.turn_id, "error")?;
    let ended = journal.task_context(&json!({"context":context}))?;
    assert_eq!(ended["status"], "cancelled");
    assert_eq!(ended["recovery"], "interrupted");
    let next = WorkspaceContext {
        turn_id: "explicit-resume".into(),
        ..context.clone()
    };
    assert!(journal
        .workspace_open(&next, "world-a")
        .unwrap_err()
        .to_string()
        .contains("EXPLICIT_RECOVERY_REQUIRED"));
    assert_eq!(
        journal
            .db
            .query_row("SELECT COUNT(*) FROM craftmine_world_leases", [], |row| row
                .get::<_, i64>(0))?,
        0
    );
    drop(journal);
    let mut journal = TaskJournal::open(&directory.path().join("tasks.sqlite"))?;
    journal.task_recover()?;
    let recovered = journal.task_context(&json!({"context":context}))?;
    assert_eq!(recovered["budget"]["actualTokens"], 20);
    assert_eq!(recovered["budget"]["reservedTokens"], 100);
    assert_eq!(recovered["budget"]["unknownRequestCount"], 1);
    let mut unlimited = configuration;
    unlimited["operationId"] = json!("remove-limit");
    unlimited["maxTokens"] = Value::Null;
    journal.budget_configure(&unlimited)?;
    journal
        .task_resume(&json!({"context":next,"taskId":facts["binding"]["taskId"],"generation":1}))?;
    let resumed = journal.task_context(&json!({"context":next}))?;
    assert_eq!(
        resumed["budget"]["ownerTaskId"],
        recovered["budget"]["ownerTaskId"]
    );
    assert_eq!(resumed["budget"]["actualTokens"], 20);
    assert_eq!(resumed["budget"]["reservedTokens"], 100);
    assert_eq!(resumed["budget"]["unknownRequestCount"], 1);
    assert_eq!(resumed["budget"]["limits"]["maxTokens"], Value::Null);
    assert_eq!(resumed["draft"]["hash"], facts["draft"]["hash"]);
    assert_eq!(resumed["requirements"], facts["requirements"]);
    assert_eq!(resumed["generation"], 2);
    Ok(())
}

#[test]
fn startup_repairs_only_proven_legacy_failed_current_heads() -> Result<()> {
    for scenario in [
        "error",
        "aborted",
        "completed",
        "discarded",
        "old-head",
        "no-ended-row",
    ] {
        let (directory, mut journal, context) = fixture()?;
        let id = journal.workspace_inspect(&context)?.task.binding.task_id;
        journal.task_context(&json!({"context":context}))?;
        if scenario == "no-ended-row" {
            journal.db.execute(
                "UPDATE craftmine_tasks SET status='cancelled' WHERE id=?1",
                [&id],
            )?;
            journal
                .db
                .execute("DELETE FROM craftmine_world_leases WHERE task_id=?1", [&id])?;
        } else {
            journal.workspace_end_turn(
                &context.session_id,
                &context.turn_id,
                if scenario == "completed" {
                    "completed"
                } else if scenario == "aborted" {
                    "aborted"
                } else {
                    "error"
                },
            )?;
            if scenario == "discarded" {
                journal.task_discard(
                    &json!({"projectId":context.project_id,"taskId":id,"generation":1}),
                )?;
            } else {
                // Reproduce the previous release's persisted cancelled+none gap.
                journal.db.execute(
                    "UPDATE craftmine_task_runtime SET recovery='none' WHERE task_id=?1",
                    [&id],
                )?;
            }
            if scenario == "old-head" {
                let next = WorkspaceContext {
                    turn_id: "new-head".into(),
                    ..context.clone()
                };
                journal.workspace_open(&next, "world-a")?;
                journal.workspace_end_turn(&next.session_id, &next.turn_id, "completed")?;
            }
        }
        let original = read_task(&journal.db, &id)?;
        drop(journal);
        let mut journal = TaskJournal::open(&directory.path().join("tasks.sqlite"))?;
        let recovered = journal.task_recover()?;
        let should_recover = matches!(scenario, "error" | "aborted");
        assert_eq!(
            recovered["interruptedTasks"]
                .as_array()
                .unwrap()
                .contains(&json!(id)),
            should_recover,
            "{scenario}"
        );
        assert_eq!(
            runtime(&journal.db, &id)?.2,
            if should_recover {
                "interrupted"
            } else if scenario == "discarded" {
                "discarded"
            } else {
                "none"
            },
            "{scenario}"
        );
        assert_eq!(read_task(&journal.db, &id)?.draft_hash, original.draft_hash);
        assert_eq!(journal.task_recover()?["interruptedTasks"], json!([]));
    }
    Ok(())
}

#[test]
fn first_end_result_is_idempotent_and_completed_tasks_do_not_revive() -> Result<()> {
    for status in ["completed", "error", "aborted"] {
        let (_directory, mut journal, context) = fixture()?;
        journal.workspace_end_turn(&context.session_id, &context.turn_id, status)?;
        journal.workspace_end_turn(
            &context.session_id,
            &context.turn_id,
            if status == "completed" {
                "error"
            } else {
                "completed"
            },
        )?;
        journal.task_recover()?;
        let result = journal.task_context(&json!({"context":context}))?;
        assert_eq!(
            result["status"],
            if status == "completed" {
                "finished"
            } else {
                "cancelled"
            }
        );
        assert_eq!(
            result["recovery"],
            if status == "completed" {
                "none"
            } else {
                "interrupted"
            }
        );
    }
    Ok(())
}
