use super::*;
use crate::{WorkspaceContext, WorldDocument};
fn fixture() -> Result<(tempfile::TempDir, TaskJournal, WorkspaceContext, Value)> {
    let dir = tempfile::tempdir()?;
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    let scene = json!({"format":"craftmine.scene/2","title":"Test","night":false,"objects":[],"systems":[]});
    j.world_create("world-a","World A",&WorldDocument{build:json!({"id":"v-initial","scene":scene}),snapshot:json!({"format":"craftmine.progress/1","player":{"x":0,"y":6,"z":0,"yaw":0,"pitch":0}}),extensions:vec![]})?;
    let ctx = WorkspaceContext {
        project_id: "project-a".into(),
        session_id: "session-a".into(),
        turn_id: "turn-a".into(),
    };
    let workspace = j.workspace_open(&ctx, "world-a")?;
    let identity = json!({"binding":workspace.task.binding,"generation":1});
    Ok((dir, j, ctx, identity))
}
fn reserve(identity: &Value, id: &str) -> Value {
    let mut args = identity.clone();
    args["requestId"] = json!(id);
    args["purpose"] = json!("creation");
    args["estimatedInputTokens"] = json!(100);
    args["maxOutputTokens"] = json!(100);
    args
}
fn settle(identity: &Value, id: &str, status: &str) -> Value {
    let mut args = identity.clone();
    args["requestId"] = json!(id);
    args["status"] = json!(status);
    args
}
#[test]
fn accounting_is_idempotent_and_unknown_usage_remains_charged() -> Result<()> {
    let (_dir, mut j, _ctx, id) = fixture()?;
    let mut request = reserve(&id, "one");
    request["limits"] = json!({"maxRequests":3,"maxTokens":400});
    j.budget_call("budget.reserve", &request)?;
    j.budget_call("budget.reserve", &request)?;
    let unknown = settle(&id, "one", "unknown");
    j.budget_call("budget.settle", &unknown)?;
    j.budget_call("budget.settle", &unknown)?;
    j.budget_call("budget.reserve", &reserve(&id, "two"))?;
    let mut known = settle(&id, "two", "known");
    known["usage"] = json!({"inputTokens":20,"outputTokens":30,"totalTokens":50});
    j.budget_call("budget.settle", &known)?;
    let budget = j.budget_call("budget.inspect", &id)?;
    assert_eq!(budget["requestCount"], 2);
    assert_eq!(budget["actualTokens"], 50);
    assert_eq!(budget["reservedTokens"], 200);
    assert_eq!(budget["remainingTokens"], 150);
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "three"))
        .unwrap_err()
        .to_string()
        .contains("TOKEN_BUDGET"));
    known["usage"]["totalTokens"] = json!(51);
    assert!(j.budget_call("budget.settle", &known).is_err());
    let mut forged = id.clone();
    forged["binding"]["projectId"] = json!("other");
    assert!(j.budget_call("budget.inspect", &forged).is_err());
    Ok(())
}
#[test]
fn three_compactions_retain_ledger_and_requirements_across_explicit_recovery() -> Result<()> {
    let (dir, mut j, ctx, id) = fixture()?;
    j.task_record_context(
        &json!({"context":ctx,"requestId":"request-1","text":"Generate a tree","kind":"request"}),
    )?;
    for n in 0..3 {
        let mut args = id.clone();
        args["eventId"] = json!(format!("compaction-{n}"));
        args["kind"] = json!("compaction");
        j.budget_call("budget.boundary", &args)?;
        j.budget_call("budget.boundary", &args)?;
    }
    j.budget_call("budget.reserve", &reserve(&id, "pending"))?;
    let workspace = j.workspace_inspect(&ctx)?;
    let draft = json!({"scene":{"objects":[{"id":"tree","name":"Saved tree"}],"systems":[]}});
    j.workspace_commit(
        &ctx,
        &workspace.task.binding,
        "edit",
        0,
        &json!({"op":"create"}),
        &draft,
    )?;
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    j.task_recover()?;
    let mut next = ctx.clone();
    next.turn_id = "turn-resumed".into();
    assert!(j
        .workspace_open(&next, "world-a")
        .unwrap_err()
        .to_string()
        .contains("EXPLICIT_RECOVERY"));
    let result =
        j.task_resume(&json!({"taskId":id["binding"]["taskId"],"generation":1,"context":next}))?;
    assert_eq!(result["generation"], 2);
    assert_eq!(result["workspace"]["task"]["draft"], draft);
    assert_eq!(result["budget"]["compactionCount"], 3);
    assert_eq!(result["budget"]["reservedTokens"], 200);
    let late = json!({"binding":id["binding"],"generation":1,"requestId":"pending","status":"known","usage":{"inputTokens":10,"outputTokens":20,"totalTokens":30}});
    j.budget_call("budget.settle", &late)?;
    assert_eq!(j.budget_call("budget.inspect", &id)?["actualTokens"], 30);
    assert_eq!(
        j.task_resume(&json!({"taskId":id["binding"]["taskId"],"generation":1,"context":next}))?
            ["replayed"],
        true
    );
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "late"))
        .is_err());
    assert!(j
        .workspace_commit(
            &ctx,
            &workspace.task.binding,
            "late",
            1,
            &json!({}),
            &json!({"scene":{}})
        )
        .is_err());
    let facts = j.task_context(&json!({"context":next}))?;
    assert_eq!(facts["requirements"][0]["text"], "Generate a tree");
    assert_eq!(facts["modifiedResources"][0], "object:tree");
    Ok(())
}
#[test]
fn cancelled_task_accepts_only_reserved_settlement_and_discard_keeps_code() -> Result<()> {
    let (_dir, mut j, ctx, id) = fixture()?;
    j.budget_call("budget.reserve", &reserve(&id, "request"))?;
    j.workspace_end_turn(&ctx.session_id, &ctx.turn_id, "aborted")?;
    j.budget_call("budget.settle", &settle(&id, "request", "cancelled"))?;
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "late"))
        .is_err());
    assert!(j
        .budget_call("budget.settle", &settle(&id, "invented", "cancelled"))
        .is_err());
    let mut next = ctx.clone();
    next.turn_id = "next".into();
    j.workspace_open(&next, "world-a")?;
    let task = j.workspace_inspect(&next)?.task;
    j.task_recover()?;
    j.task_discard(
        &json!({"taskId":task.binding.task_id,"projectId":ctx.project_id,"generation":1}),
    )?;
    assert_eq!(j.inspect(&task.binding)?.draft, task.draft);
    next.turn_id = "fresh".into();
    assert!(j.workspace_open(&next, "world-a").is_ok());
    Ok(())
}
#[test]
fn request_limits_deadline_generation_and_unknown_fields_are_enforced() -> Result<()> {
    let (_dir, mut j, _ctx, id) = fixture()?;
    let mut request = reserve(&id, "expired");
    request["limits"] = json!({"deadlineAt":1});
    assert!(j.budget_call("budget.reserve", &request).is_err());
    request = reserve(&id, "first");
    request["generation"] = json!(2);
    assert!(j.budget_call("budget.reserve", &request).is_err());
    request["generation"] = json!(1);
    request["forged"] = json!(true);
    assert!(j.budget_call("budget.reserve", &request).is_err());
    request = reserve(&id, "first");
    request["limits"] = json!({"maxRequests":1});
    j.budget_call("budget.reserve", &request)?;
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "second"))
        .is_err());
    Ok(())
}

#[test]
fn requirements_keep_original_goal_and_three_latest_corrections() -> Result<()> {
    let (_dir, mut journal, context, _) = fixture()?;
    let original = format!(
        "{}FINAL REQUIREMENT: preserve movement",
        "树🌷".repeat(1200)
    );
    journal.task_record_context(
        &json!({"context":context,"requestId":"z-original","kind":"request","text":original}),
    )?;
    for id in ["z-fix", "y-fix", "x-fix", "w-fix", "v-fix", "u-fix"] {
        journal.task_record_context(&json!({"context":context,"requestId":id,"kind":"correction","text":format!("Correction {id}")}))?;
    }
    journal.task_record_context(&json!({"context":context,"requestId":"a-later-request","kind":"request","text":"An additional request does not displace the original goal"}))?;
    let facts = journal.task_context(&json!({"context":context}))?;
    let requirements = facts["requirements"].as_array().unwrap();
    assert_eq!(
        requirements
            .iter()
            .map(|item| item["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["z-original", "u-fix", "v-fix", "w-fix"]
    );
    assert_eq!(
        requirements[0]["text"].as_str().unwrap().chars().count(),
        1000
    );
    assert_eq!(requirements[0]["truncated"], true);
    assert!(requirements[1..]
        .iter()
        .all(|item| item["truncated"] == false));
    let mut recovered = String::new();
    let mut start = 0;
    loop {
        let page = journal.task_read_requirements(
            &json!({"context":context,"requestId":"z-original","start":start,"limit":713}),
        )?;
        for item in page["items"].as_array().unwrap() {
            recovered.push_str(item["text"].as_str().unwrap());
        }
        match page["next"].as_u64() {
            Some(next) => {
                assert!(next > start);
                start = next;
            }
            None => break,
        }
    }
    assert_eq!(recovered, original);
    assert!(recovered.ends_with("FINAL REQUIREMENT: preserve movement"));
    // Retrying an earlier correction cannot move it to the newest position.
    journal.task_record_context(&json!({"context":context,"requestId":"z-fix","kind":"correction","text":"Correction z-fix"}))?;
    assert_eq!(
        journal.task_context(&json!({"context":context}))?["requirements"],
        facts["requirements"]
    );
    Ok(())
}

#[test]
fn requirement_pages_bound_characters_segments_and_reject_forged_inputs() -> Result<()> {
    let (_dir, mut journal, context, _) = fixture()?;
    let empty = journal.task_read_requirements(&json!({"context":context}))?;
    assert_eq!(empty["totalRecords"], 0);
    assert_eq!(empty["next"], Value::Null);
    let mut expected = String::new();
    for index in 0..45 {
        let body = if index == 44 {
            "世界🌷".repeat(1400)
        } else {
            "🌷".into()
        };
        expected.push_str(&body);
        journal.task_record_context(&json!({"context":context,"requestId":format!("r-{index}"),"kind":if index==0 {"request"} else {"correction"},"text":body}))?;
    }
    let first = journal.task_read_requirements(&json!({"context":context}))?;
    assert_eq!(first["items"].as_array().unwrap().len(), 32);
    assert_eq!(first["next"], 32);
    let mut recovered = String::new();
    let mut start = 0;
    loop {
        let page = journal.task_read_requirements(&json!({"context":context,"start":start}))?;
        let items = page["items"].as_array().unwrap();
        assert!(items.len() <= 32);
        assert!(
            items
                .iter()
                .map(|item| item["text"].as_str().unwrap().chars().count())
                .sum::<usize>()
                <= 4000
        );
        for item in items {
            recovered.push_str(item["text"].as_str().unwrap());
        }
        match page["next"].as_u64() {
            Some(next) => {
                assert!(next > start);
                start = next;
            }
            None => break,
        }
    }
    assert_eq!(recovered, expected);
    assert_eq!(
        journal
            .task_read_requirements(&json!({"context":context,"start":expected.chars().count()}))?
            ["items"],
        json!([])
    );
    for extras in [
        json!({"limit":0}),
        json!({"limit":4001}),
        json!({"limit":1.5}),
        json!({"start":-1}),
        json!({"start":999999}),
        json!({"requestId":"missing"}),
        json!({"worldId":"world-other"}),
        json!({"taskId":"invented"}),
    ] {
        let mut args = extras;
        args["context"] = json!(context);
        assert!(
            journal.task_read_requirements(&args).is_err(),
            "accepted {args}"
        );
    }
    let mut forged = json!({"context":context});
    forged["context"]["sessionId"] = json!("someone-else");
    assert!(journal.task_read_requirements(&forged).is_err());
    forged = json!({"context":context});
    forged["context"]["worldId"] = json!("forged");
    assert!(journal.task_read_requirements(&forged).is_err());
    Ok(())
}

#[test]
fn requirements_survive_explicit_recovery_but_do_not_enter_ordinary_new_tasks() -> Result<()> {
    let (_dir, mut journal, context, identity) = fixture()?;
    let original = format!("{}KEEP THE ORIGINAL END", "原始目标".repeat(1100));
    journal.task_record_context(
        &json!({"context":context,"requestId":"original","kind":"request","text":original}),
    )?;
    for index in 0..7 {
        journal.task_record_context(&json!({"context":context,"requestId":format!("fix-{index}"),"kind":"correction","text":format!("Correction {index}")}))?;
    }
    let before = journal.task_context(&json!({"context":context}))?["requirements"].clone();
    journal.task_recover()?;
    let mut resumed = context.clone();
    resumed.turn_id = "resumed-turn".into();
    journal.task_resume(
        &json!({"taskId":identity["binding"]["taskId"],"generation":1,"context":resumed}),
    )?;
    assert_eq!(
        journal.task_context(&json!({"context":resumed}))?["requirements"],
        before
    );
    let tail = journal
        .task_read_requirements(&json!({"context":resumed,"requestId":"original","start":4000}))?;
    assert!(tail["items"][0]["text"]
        .as_str()
        .unwrap()
        .ends_with("KEEP THE ORIGINAL END"));
    journal.workspace_end_turn(&resumed.session_id, &resumed.turn_id, "completed")?;
    let mut next = resumed.clone();
    next.turn_id = "ordinary-new-turn".into();
    journal.workspace_open(&next, "world-a")?;
    assert_eq!(
        journal.task_context(&json!({"context":next}))?["requirements"],
        json!([])
    );
    assert_eq!(
        journal.task_read_requirements(&json!({"context":next}))?["totalRecords"],
        0
    );
    journal.task_record_context(&json!({"context":next,"requestId":"new-goal","kind":"request","text":"Independent new goal"}))?;
    assert_eq!(
        journal.task_context(&json!({"context":next}))?["requirements"][0]["id"],
        "new-goal"
    );
    assert!(journal
        .task_read_requirements(&json!({"context":next,"requestId":"original"}))
        .is_err());
    Ok(())
}
fn configure(id: &Value, operation: &str, max: Value) -> Value {
    json!({"projectId":id["binding"]["projectId"],"sessionId":id["binding"]["sessionId"],"worldId":"world-a","taskId":id["binding"]["taskId"],"generation":id["generation"],"operationId":operation,"maxTokens":max})
}
#[test]
fn unlimited_budget_keeps_other_boundaries_and_never_clears_usage() -> Result<()> {
    let (_dir, mut j, _ctx, id) = fixture()?;
    let mut request = reserve(&id, "large");
    request["estimatedInputTokens"] = json!(2_000_000);
    request["limits"] = json!({"maxTokens":null,"maxRequests":1,"maxCompactions":1});
    let result = j.budget_call("budget.reserve", &request)?;
    assert!(result["budget"]["remainingTokens"].is_null());
    assert!(result["budget"]["limits"]["maxTokens"].is_null());
    assert_eq!(result["budget"]["reservedTokens"], 2_000_100);
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "second"))
        .unwrap_err()
        .to_string()
        .contains("REQUEST_BUDGET"));
    let mut event = id.clone();
    event["eventId"] = json!("c1");
    event["kind"] = json!("compaction");
    j.budget_call("budget.boundary", &event)?;
    event["eventId"] = json!("c2");
    assert!(j
        .budget_call("budget.boundary", &event)
        .unwrap_err()
        .to_string()
        .contains("COMPACTION_BUDGET"));
    Ok(())
}
#[test]
fn player_removes_exhausted_limit_with_durable_bound_receipt_and_model_denial() -> Result<()> {
    let (dir, mut j, ctx, id) = fixture()?;
    let mut request = reserve(&id, "pending");
    request["limits"] = json!({"maxTokens":200});
    j.budget_call("budget.reserve", &request)?;
    j.budget_call("budget.settle", &settle(&id, "pending", "unknown"))?;
    j.task_interrupt(&json!({"context":ctx,"reason":"TOKEN_BUDGET_EXHAUSTED"}))?;
    let config = configure(&id, "player-unlimited", Value::Null);
    let result = j.budget_configure(&config)?;
    assert_eq!(result["budget"]["reservedTokens"], 200);
    assert_eq!(result["budget"]["unknownRequestCount"], 1);
    assert_eq!(result["budget"]["requestCount"], 1);
    assert_eq!(result["budget"]["ownerTaskId"], id["binding"]["taskId"]);
    assert_eq!(result["previousMaxTokens"], 200);
    assert_eq!(j.budget_configure(&config)?, result);
    let mut changed = config.clone();
    changed["maxTokens"] = json!(300);
    assert!(j
        .budget_configure(&changed)
        .unwrap_err()
        .to_string()
        .contains("REPLAY_MISMATCH"));
    for (key, value) in [
        ("sessionId", json!("foreign")),
        ("worldId", json!("foreign")),
        ("projectId", json!("foreign")),
        ("generation", json!(2)),
        ("maxTokens", json!(0)),
        ("maxTokens", json!(-1)),
        ("maxTokens", json!(9007199254740992u64)),
    ] {
        let mut bad = config.clone();
        bad[key] = value;
        assert!(j.budget_configure(&bad).is_err());
    }
    assert!(j
        .budget_call("budget.configure", &config)
        .unwrap_err()
        .to_string()
        .contains("UNKNOWN_METHOD"));
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(j.budget_configure(&config)?, result);
    let mut next = ctx.clone();
    next.turn_id = "budget-resume".into();
    let resumed =
        j.task_resume(&json!({"taskId":id["binding"]["taskId"],"generation":1,"context":next}))?;
    assert!(resumed["budget"]["limits"]["maxTokens"].is_null());
    assert_eq!(resumed["budget"]["reservedTokens"], 200);
    assert!(j.budget_configure(&config).is_err());
    Ok(())
}
#[test]
fn existing_owners_keep_policy_across_atomic_migration_and_reopen() -> Result<()> {
    let (dir, j, _ctx, id) = fixture()?;
    runtime(&j.db, id["binding"]["taskId"].as_str().unwrap())?;
    j.db.execute_batch("DROP TABLE craftmine_budget_configurations;")?;
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(
        j.budget_call("budget.inspect", &id)?["limits"]["maxTokens"],
        1_000_000
    );
    j.budget_configure(&configure(&id, "explicit", Value::Null))?;
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert!(j.budget_call("budget.inspect", &id)?["limits"]["maxTokens"].is_null());
    Ok(())
}
#[test]
fn legacy_backup_missing_limits_keeps_policy_and_schema_three_keeps_audit() -> Result<()> {
    let (_dir, mut j, ctx, id) = fixture()?;
    runtime(&j.db, id["binding"]["taskId"].as_str().unwrap())?;
    j.workspace_end_turn(&ctx.session_id, &ctx.turn_id, "completed")?;
    let exported = j.backup_export(&json!({"operationId":"budget-export"}))?;
    let mut archive = exported["archive"].clone();
    assert_eq!(archive["schemaVersion"], 3);
    archive["schemaVersion"] = json!(2);
    archive["tables"]
        .as_object_mut()
        .unwrap()
        .remove("craftmine_budget_configurations");
    archive["hash"] = json!(digest(&serde_json::to_string(&archive["tables"])?));
    assert_eq!(
        j.backup_inspect(&json!({"archive":archive}))?["valid"],
        true
    );
    let current = j.backup_status(&json!({}))?["currentHash"].clone();
    j.backup_restore(
        &json!({"operationId":"budget-legacy","archive":archive,"expectedCurrentHash":current}),
    )?;
    assert_eq!(
        j.budget_call("budget.inspect", &id)?["limits"]["maxTokens"],
        1_000_000
    );
    let config = configure(&id, "after-import", Value::Null);
    let result = j.budget_configure(&config)?;
    let new = j.backup_export(&json!({"operationId":"budget-export-new"}))?;
    assert_eq!(
        new["archive"]["tables"]["craftmine_budget_configurations"]["rows"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        j.backup_inspect(&json!({"archive":new["archive"]}))?["valid"],
        true
    );
    assert_eq!(j.budget_configure(&config)?, result);
    let mut future = new["archive"].clone();
    future["schemaVersion"] = json!(4);
    assert!(j
        .backup_inspect(&json!({"archive":future}))
        .unwrap_err()
        .to_string()
        .contains("VERSION_UNSUPPORTED"));
    Ok(())
}
