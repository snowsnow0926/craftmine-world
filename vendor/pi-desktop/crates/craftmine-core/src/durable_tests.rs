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
