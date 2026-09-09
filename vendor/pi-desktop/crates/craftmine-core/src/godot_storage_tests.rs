use super::*;
use crate::godot_test_support::*;

fn patch(
    journal: &mut TaskJournal,
    context: &WorkspaceContext,
    head: &Value,
    call: &str,
    path: &str,
) -> Result<Value> {
    journal.godot_project_patch(&json!({"context":context,"worldId":"a","toolCallId":call,
        "revision":head["revision"],"manifestHash":head["manifestHash"],
        "operations":[{"op":"put","path":path,"text":"extends Node\n","expectedHash":null}]}))
}

fn three_builds(journal: &mut TaskJournal, context: &WorkspaceContext) -> Result<(Value, Value, Value)> {
    let created = create_project(journal, context)?;
    let first = build_then_cancel(journal, context, "build-one", &created)?;
    let rev1 = patch(journal, context, &created, "patch-one", "one.gd")?;
    let second = build_then_cancel(journal, context, "build-two", &rev1)?;
    let rev2 = patch(journal, context, &rev1, "patch-two", "two.gd")?;
    let third = build_then_cancel(journal, context, "build-three", &rev2)?;
    Ok((first, second, third))
}

/// A blocked job still pins its build, so the test ends each build job first.
fn build_then_cancel(
    journal: &mut TaskJournal,
    context: &WorkspaceContext,
    call: &str,
    head: &Value,
) -> Result<Value> {
    let job = start(journal, context, call, head, "build")?;
    journal.godot_build_cancel(&json!({"worldId":"a","context":context,"jobId":job["jobId"]}))?;
    Ok(job)
}

fn build_row_exists(journal: &TaskJournal, build: &str) -> Result<bool> {
    Ok(journal.db.query_row(
        "SELECT EXISTS(SELECT 1 FROM craftmine_godot_builds WHERE world_id='a' AND build_id=?1)",
        [build],
        |row| row.get(0),
    )?)
}

#[test]
fn storage_status_counts_every_category_without_deleting_anything() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    put_asset(&mut journal, &context, "asset-one", "hero.png", "image/png", b"hero-bytes")?;
    let built = start(&mut journal, &context, "build-one", &created, "build")?;
    let status = journal.godot_storage_status(&json!({"worldId":"a","context":&context}))?;
    assert_eq!(status["format"], "craftmine.godot-storage/1");
    assert_eq!(status["categories"]["sourceHistory"]["revisions"], 1);
    assert!(status["categories"]["sourceHistory"]["bytes"].as_u64().unwrap() > 0);
    assert_eq!(status["categories"]["assetBlobs"]["assets"], 1);
    assert_eq!(status["categories"]["buildHistory"]["builds"], 1);
    assert!(status["categories"]["buildHistory"]["bytes"].as_u64().unwrap() > 0);
    assert!(status["quota"]["usedBytes"].as_u64().unwrap() > 0);
    assert_eq!(status["quota"]["limitBytes"], WORLD_STORAGE_TOTAL);
    assert_eq!(status["ownedByOthers"], json!(["assetBodies", "gitHistory", "backups"]));
    // Reporting is read-only.
    assert!(build_row_exists(&journal, built["buildId"].as_str().unwrap())?);
    assert!(build_dir(&journal.directory, "a", built["buildId"].as_str().unwrap())?.try_exists()?);
    Ok(())
}

#[test]
fn reclaim_protects_formal_and_recent_builds_and_commits_atomically() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let (first, second, third) = three_builds(&mut journal, &context)?;
    // The world is now formally on the middle build.
    let mut world = journal.world_read("a")?.world;
    world.build["id"] = second["buildId"].clone();
    let body = worlds::encode(&world)?;
    journal.db.execute(
        "UPDATE craftmine_worlds SET document=?1,content_hash=?2 WHERE id='a'",
        params![body, digest(&body)],
    )?;
    let plan = journal.godot_storage_reclaim_plan(&json!({"worldId":"a","context":&context}))?;
    let deletable: Vec<&str> = plan["deletable"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["buildId"].as_str())
        .collect();
    assert_eq!(deletable, vec![first["buildId"].as_str().unwrap()]);
    assert!(plan["protected"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["buildId"] == second["buildId"] && item["reason"] == "FORMAL_WORLD"));
    assert!(plan["freedBytes"].as_u64().unwrap() > 0);
    let committed = journal.godot_storage_reclaim_commit(&json!({"worldId":"a","context":&context,
        "planId":plan["planId"],"planHash":plan["planHash"]}))?;
    assert_eq!(committed["status"], "completed");
    assert_eq!(committed["removedBuilds"], 1);
    assert!(!build_row_exists(&journal, first["buildId"].as_str().unwrap())?);
    assert!(!build_dir(&journal.directory, "a", first["buildId"].as_str().unwrap())?.try_exists()?);
    assert!(build_dir(&journal.directory, "a", third["buildId"].as_str().unwrap())?.try_exists()?);
    let journal_row: (String, i64) = journal.db.query_row(
        "SELECT status,bytes FROM craftmine_godot_reclaims WHERE world_id='a'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    assert_eq!(journal_row.0, "completed");
    assert!(journal_row.1 > 0);
    // A consumed plan cannot be replayed into a second deletion.
    failed(
        journal.godot_storage_reclaim_commit(&json!({"worldId":"a","context":&context,
            "planId":plan["planId"],"planHash":plan["planHash"]})),
        "GODOT_RECLAIM_PLAN_STALE",
    );
    Ok(())
}

#[test]
fn a_reference_created_after_the_plan_blocks_reclamation() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let (first, _, _) = three_builds(&mut journal, &context)?;
    let plan = journal.godot_storage_reclaim_plan(&json!({"worldId":"a","context":&context}))?;
    assert_eq!(plan["deletable"].as_array().unwrap().len(), 1);
    // A new execution starts against that build before the commit runs.
    let task: String = journal.db.query_row(
        "SELECT task_id FROM craftmine_workspaces WHERE world_id='a'",
        [],
        |row| row.get(0),
    )?;
    journal.db.execute(
        "INSERT INTO craftmine_godot_jobs(id,world_id,task_id,tool_call_id,kind,build_id,
            source_revision,manifest_hash,asset_manifest_hash,base_id,base_build,request_hash,
            status,progress,created_at,updated_at)
         VALUES(?1,'a',?2,'late-reference','build',?3,0,?4,?4,'first-person','base-a','hash',
            'queued',0,1,1)",
        params![
            format!("gjob-{}", digest("late-reference")),
            task,
            first["buildId"].as_str().unwrap(),
            digest("manifest")
        ],
    )?;
    failed(
        journal.godot_storage_reclaim_commit(&json!({"worldId":"a","context":&context,
            "planId":plan["planId"],"planHash":plan["planHash"]})),
        "GODOT_RECLAIM_PLAN_STALE",
    );
    assert!(build_row_exists(&journal, first["buildId"].as_str().unwrap())?);
    assert!(build_dir(&journal.directory, "a", first["buildId"].as_str().unwrap())?.try_exists()?);
    // The pinned reference is now reported as protected, not deletable.
    let after = journal.godot_storage_reclaim_plan(&json!({"worldId":"a","context":&context}))?;
    assert!(after["deletable"].as_array().unwrap().is_empty());
    assert!(after["protected"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["buildId"] == first["buildId"] && item["reason"] == "ACTIVE_OR_PASSED_JOB"));
    Ok(())
}

#[test]
fn continuing_a_draft_whose_build_was_reclaimed_is_refused_clearly() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let (_, _, origin) = three_builds(&mut journal, &context)?;
    // Keep nothing: the cancelled draft's own build becomes reclaimable.
    let plan = journal.godot_storage_reclaim_plan(&json!({"worldId":"a","context":&context,
        "keepRecentBuilds":0}))?;
    assert_eq!(plan["deletable"].as_array().unwrap().len(), 3);
    journal.godot_storage_reclaim_commit(&json!({"worldId":"a","context":&context,
        "planId":plan["planId"],"planHash":plan["planHash"],"keepRecentBuilds":0}))?;
    assert!(!build_row_exists(&journal, origin["buildId"].as_str().unwrap())?);
    // The cancelled draft is still continuable in principle and its source is
    // still the head, but its immutable build copy is gone: say that plainly
    // instead of queueing a job that can only fail at claim.
    failed(
        journal.godot_job_continue(&json!({"context":&context,"worldId":"a",
            "toolCallId":"continue-reclaimed","originJobId":origin["jobId"]})),
        "GODOT_CONTINUATION_BUILD_GONE",
    );
    Ok(())
}

#[test]
fn a_caller_pin_from_works_backups_or_history_is_never_reclaimed() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let (first, _, _) = three_builds(&mut journal, &context)?;
    let plan = journal.godot_storage_reclaim_plan(&json!({"worldId":"a","context":&context,
        "protectedBuilds":[first["buildId"]]}))?;
    assert!(plan["deletable"].as_array().unwrap().is_empty());
    assert!(plan["protected"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["buildId"] == first["buildId"] && item["reason"] == "CALLER_PINNED"));
    // An invalid id is rejected instead of being joined onto a path.
    failed(
        journal.godot_storage_reclaim_plan(&json!({"worldId":"a","context":&context,
            "protectedBuilds":["../../etc"]})),
        "INVALID_GODOT_BUILD",
    );
    Ok(())
}
