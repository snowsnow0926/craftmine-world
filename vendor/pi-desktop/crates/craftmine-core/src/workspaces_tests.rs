use super::*;
use crate::WorldDocument;

fn context(turn: &str) -> WorkspaceContext {
    WorkspaceContext {
        project_id: "project-a".into(),
        session_id: "session-a".into(),
        turn_id: turn.into(),
    }
}

fn world() -> WorldDocument {
    WorldDocument {
        build: json!({"id":"v-base","scene":{"format":"craftmine.scene/3","objects":[]}}),
        snapshot: json!({"format":"craftmine.progress/1","player":{"x":0.5,"y":7.6,"z":0.5,"yaw":0,"pitch":0}}),
        extensions: vec![],
    }
}

#[test]
fn selection_changes_never_redirect_an_existing_session() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    journal.world_create("a", "A", &world())?;
    journal.world_create("b", "B", &world())?;
    let ctx = context("one");
    let first = journal.workspace_open(&ctx, "a")?;
    assert_eq!(journal.workspace_open(&ctx, "b")?.task, first.task);
    let foreign = WorkspaceContext {
        project_id: "foreign".into(),
        ..ctx.clone()
    };
    assert!(journal
        .workspace_open(&foreign, "b")
        .unwrap_err()
        .to_string()
        .contains("PROJECT_BINDING_MISMATCH"));
    journal.workspace_end_turn(&ctx.session_id, &ctx.turn_id, "completed")?;
    assert_eq!(journal.workspace_open(&context("two"), "b")?.world_id, "a");
    Ok(())
}

#[test]
fn exclusive_world_drafts_survive_connections_and_release_at_turn_end() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("tasks.sqlite");
    let mut a = TaskJournal::open(&path)?;
    let mut b = TaskJournal::open(&path)?;
    a.world_create("a", "A", &world())?;
    let first = context("one");
    let second = WorkspaceContext {
        session_id: "session-b".into(),
        ..first.clone()
    };
    a.workspace_open(&first, "a")?;
    assert!(b
        .workspace_open(&second, "a")
        .unwrap_err()
        .to_string()
        .contains("WORLD_BUSY"));
    a.workspace_end_turn(&first.session_id, &first.turn_id, "aborted")?;
    assert_eq!(b.workspace_open(&second, "a")?.world_id, "a");
    assert!(a.workspace_open(&first, "a").is_err());
    Ok(())
}

#[test]
fn committed_reads_and_receipts_survive_restart_and_old_turns_cannot_write() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("tasks.sqlite");
    let mut journal = TaskJournal::open(&path)?;
    journal.world_create("a", "A", &world())?;
    let ctx = context("one");
    let first = journal.workspace_open(&ctx, "a")?;
    let hash = digest("tree");
    journal.workspace_record_read(&ctx, 0, "object:tree", &hash)?;
    let next = json!({"scene":{"format":"craftmine.scene/3","objects":[{"id":"tree"}]}});
    let request = json!({"workspaceRevision":0,"operations":[{"id":"tree"}]});
    let result =
        journal.workspace_commit(&ctx, &first.task.binding, "host-call", 0, &request, &next)?;
    drop(journal);
    let mut journal = TaskJournal::open(&path)?;
    assert_eq!(journal.workspace_inspect(&ctx)?.reads["object:tree"], hash);
    assert_eq!(
        journal.workspace_receipt(&ctx, "host-call", &request)?,
        Some(result.clone())
    );
    assert_eq!(
        journal.workspace_commit(&ctx, &first.task.binding, "host-call", 0, &request, &next)?,
        result
    );
    assert!(journal
        .workspace_receipt(&ctx, "host-call", &json!({"forged":true}))
        .unwrap_err()
        .to_string()
        .contains("REPLAY_MISMATCH"));
    assert!(journal
        .workspace_record_read(&ctx, 0, "object:tree", &hash)
        .is_err());
    let resumed = journal.workspace_open(&context("two"), "a")?;
    assert_eq!(resumed.task.draft, next);
    assert_eq!(
        resumed.resumed_from.as_deref(),
        Some(first.task.binding.task_id.as_str())
    );
    assert!(journal
        .workspace_open(&ctx, "a")
        .unwrap_err()
        .to_string()
        .contains("STALE_TURN"));
    assert!(journal
        .workspace_commit(
            &ctx,
            &first.task.binding,
            "late",
            1,
            &json!({}),
            &json!({"scene":{}})
        )
        .is_err());
    assert_eq!(journal.world_read("a")?.world, world());
    Ok(())
}

#[test]
fn cancelled_before_first_tool_cannot_create_a_draft() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    journal.world_create("a", "A", &world())?;
    let ctx = context("one");
    journal.workspace_end_turn(&ctx.session_id, &ctx.turn_id, "aborted")?;
    assert!(journal
        .workspace_open(&ctx, "a")
        .unwrap_err()
        .to_string()
        .contains("TURN_ENDED"));
    assert!(journal
        .workspace_open(
            &WorkspaceContext {
                session_id: "@craftmine/home".into(),
                ..ctx
            },
            "a"
        )
        .is_err());
    Ok(())
}

#[test]
fn a_resumed_revision_zero_draft_is_not_discarded_when_the_world_base_changes() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    journal.world_create("a", "A", &world())?;
    let ctx = context("one");
    let first = journal.workspace_open(&ctx, "a")?;
    let edited = json!({"scene":{"objects":[{"id":"saved-tree"}]}});
    journal.workspace_commit(
        &ctx,
        &first.task.binding,
        "edit",
        0,
        &json!({"edit":true}),
        &edited,
    )?;
    let resumed = journal.workspace_open(&context("two"), "a")?;
    assert_eq!(resumed.task.revision, 0);
    let mut changed = world();
    changed.build["id"] = json!("v-new-base");
    let body = worlds::encode(&changed)?;
    journal.db.execute(
        "UPDATE craftmine_worlds SET document=?1,content_hash=?2 WHERE id='a'",
        params![body, digest(&body)],
    )?;
    assert!(journal
        .workspace_open(&context("three"), "a")
        .unwrap_err()
        .to_string()
        .contains("DRAFT_BASE_CONFLICT"));
    assert_eq!(
        journal.workspace_inspect(&context("two"))?.task.draft,
        edited
    );
    assert_eq!(
        journal.workspace_inspect(&context("two"))?.task.status,
        "running"
    );
    Ok(())
}

#[test]
fn draft_revision_conflicts_and_foreign_bindings_leave_history_unchanged() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("tasks.sqlite");
    let mut a = TaskJournal::open(&path)?;
    let mut b = TaskJournal::open(&path)?;
    a.world_create("a", "A", &world())?;
    let ctx = context("one");
    let first = a.workspace_open(&ctx, "a")?;
    let next = json!({"scene":{"objects":[{"id":"tree"}]}});
    a.workspace_commit(&ctx, &first.task.binding, "one", 0, &json!({"n":1}), &next)?;
    assert!(b
        .workspace_commit(
            &ctx,
            &first.task.binding,
            "two",
            0,
            &json!({"n":2}),
            &json!({"scene":{}})
        )
        .unwrap_err()
        .to_string()
        .contains("STALE_DRAFT"));
    let foreign = TaskBinding {
        base_build: "forged".into(),
        ..first.task.binding
    };
    assert!(b
        .workspace_commit(
            &ctx,
            &foreign,
            "two",
            1,
            &json!({"n":2}),
            &json!({"scene":{}})
        )
        .is_err());
    let revisions: i64 = a.db.query_row(
        "SELECT COUNT(*) FROM craftmine_workspace_revisions",
        [],
        |r| r.get(0),
    )?;
    assert_eq!(revisions, 2);
    assert_eq!(b.workspace_inspect(&ctx)?.task.draft, next);
    Ok(())
}
