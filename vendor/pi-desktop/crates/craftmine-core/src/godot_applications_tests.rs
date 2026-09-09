use super::*;
use crate::godot_test_support::*;

fn evidence(prepared: &Value, build_id: &str, player: &Value) -> Value {
    json!({"id":"apply-one","token":"token-a","evidence":{"format":"craftmine.godot-application/1",
        "inputHash":prepared["inputHash"],"launch":{"passed":true,"buildId":build_id,
            "instanceId":"instance-1","stateHash":digest("launched-state")},"player":player}})
}

fn prepare(journal: &mut TaskJournal, candidate: &str, revision: u64) -> Result<Value> {
    journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-a","candidateId":candidate,
        "worldId":"a","revision":revision,"snapshot":world().snapshot}))
}

#[test]
fn a_verified_candidate_publishes_only_after_a_real_new_instance_launch() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let candidate = finished["candidateId"].as_str().unwrap();
    let prepared = prepare(&mut journal, candidate, 0)?;
    assert_eq!(prepared["status"], "prepared");
    assert_eq!(prepared["buildId"], job["buildId"]);
    // Preparing alone never changes the formal world.
    assert_eq!(journal.world_read("a")?.world.build["id"], "base-a");
    let before_revision = journal.world_read("a")?.summary.revision;
    let committed = journal.godot_application_commit(&evidence(
        &prepared,
        job["buildId"].as_str().unwrap(),
        &world().snapshot["player"],
    ))?;
    assert_eq!(committed["status"], "applied");
    let applied = journal.world_read("a")?;
    assert_eq!(applied.world.build["id"], job["buildId"]);
    assert_eq!(applied.world.build["scene"]["format"], "craftmine.godot-scene/1");
    assert_eq!(applied.world.build["scene"]["baseId"], "first-person");
    assert_eq!(applied.world.build["godot"]["engineVersion"], "4.7.2-stable");
    assert_eq!(applied.world.build["godot"]["sourceRevision"], 0);
    assert_eq!(applied.world.build["godot"]["baseBuild"], "base-a");
    assert_eq!(applied.world.snapshot, world().snapshot);
    assert_eq!(applied.summary.revision, before_revision + 1);
    let candidate_record = journal.godot_candidate_read(&json!({"context":&context,"worldId":"a","candidateId":candidate}))?;
    assert_eq!(candidate_record["candidate"]["status"], "applied");
    Ok(())
}

#[test]
fn the_previous_world_and_its_progress_stay_recoverable() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let prepared = prepare(&mut journal, finished["candidateId"].as_str().unwrap(), 0)?;
    journal.godot_application_commit(&evidence(&prepared, job["buildId"].as_str().unwrap(), &world().snapshot["player"]))?;
    let (previous, hash): (String, String) = journal.db.query_row(
        "SELECT previous_world,previous_hash FROM craftmine_godot_applications WHERE id='apply-one'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    assert_eq!(digest(&previous), hash);
    let stored: crate::WorldDocument = serde_json::from_str(&previous)?;
    assert_eq!(stored.build["id"], "base-a");
    assert_eq!(stored.snapshot, world().snapshot);
    // The authoring task is closed and its draft recorded as applied, so the
    // next turn continues from the applied build instead of a stale scene.
    let (status, drafts): (String, i64) = journal.db.query_row(
        "SELECT (SELECT status FROM craftmine_tasks WHERE id=author_task_id),
                (SELECT COUNT(*) FROM craftmine_godot_applied_drafts WHERE task_id=author_task_id)
         FROM craftmine_godot_applications WHERE id='apply-one'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    assert_eq!(status, "finished");
    assert_eq!(drafts, 1);
    let next = journal.workspace_open(&ctx("two"), "a")?;
    assert_eq!(next.task.binding.base_build, job["buildId"]);
    assert_eq!(next.task.draft["scene"], journal.world_read("a")?.world.build["scene"]);
    // Development continues from the applied build lineage.
    let resumed = start(&mut journal, &ctx("two"), "build-two", &created, "build")?;
    assert_eq!(resumed["sourceRevision"], 0);
    assert_eq!(resumed["baseBuild"], "base-a");
    Ok(())
}

#[test]
fn launch_evidence_must_prove_the_exact_candidate_build() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let prepared = prepare(&mut journal, finished["candidateId"].as_str().unwrap(), 0)?;
    let build = job["buildId"].as_str().unwrap();
    let player = &world().snapshot["player"];
    let mut wrong_build = evidence(&prepared, build, player);
    wrong_build["evidence"]["launch"]["buildId"] = json!(format!("gbd-{}", "1".repeat(64)));
    failed(journal.godot_application_commit(&wrong_build), "GODOT_LAUNCH_REQUIRED");
    let mut not_launched = evidence(&prepared, build, player);
    not_launched["evidence"]["launch"]["passed"] = json!(false);
    failed(journal.godot_application_commit(&not_launched), "GODOT_LAUNCH_REQUIRED");
    let mut no_state = evidence(&prepared, build, player);
    no_state["evidence"]["launch"]["stateHash"] = json!("short");
    failed(journal.godot_application_commit(&no_state), "GODOT_LAUNCH_REQUIRED");
    let mut wrong_input = evidence(&prepared, build, player);
    wrong_input["evidence"]["inputHash"] = json!(digest("other-request"));
    failed(journal.godot_application_commit(&wrong_input), "APPLICATION_EVIDENCE_MISMATCH");
    let mut moved_player = evidence(&prepared, build, player);
    moved_player["evidence"]["player"] = json!({"x":9.0,"y":7.6,"z":0.5,"yaw":0,"pitch":0});
    failed(journal.godot_application_commit(&moved_player), "APPLICATION_PLAYER_CHANGED");
    assert_eq!(journal.world_read("a")?.world.build["id"], "base-a");
    assert_eq!(journal.godot_application_read(&json!({"id":"apply-one"}))?["status"], "prepared");
    // The real launch still commits after all refused attempts.
    journal.godot_application_commit(&evidence(&prepared, build, player))?;
    assert_eq!(journal.world_read("a")?.world.build["id"], build);
    Ok(())
}

#[test]
fn newer_formal_progress_cannot_be_overwritten_by_a_prepared_application() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let prepared = prepare(&mut journal, finished["candidateId"].as_str().unwrap(), 0)?;
    let mut progress = world().snapshot;
    progress["player"]["x"] = json!(8);
    journal.world_save_progress("a", 0, "base-a", &progress)?;
    failed(
        journal.godot_application_commit(&evidence(&prepared, job["buildId"].as_str().unwrap(), &progress["player"])),
        "WORLD_REVISION_CONFLICT",
    );
    assert_eq!(journal.world_read("a")?.world.snapshot, progress);
    assert_eq!(journal.world_read("a")?.world.build["id"], "base-a");
    Ok(())
}

#[test]
fn prepare_rejects_a_progress_change_and_a_second_application() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (_, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let candidate = finished["candidateId"].as_str().unwrap();
    let mut moved = world().snapshot;
    moved["player"]["x"] = json!(8);
    failed(
        journal.godot_application_prepare(&json!({"id":"apply-moved","token":"token-a","candidateId":candidate,
            "worldId":"a","revision":0,"snapshot":moved})),
        "APPLICATION_PLAYER_CHANGED",
    );
    failed(
        journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-a","candidateId":candidate,
            "worldId":"a","revision":1,"snapshot":world().snapshot})),
        "WORLD_REVISION_CONFLICT",
    );
    prepare(&mut journal, candidate, 0)?;
    failed(
        journal.godot_application_prepare(&json!({"id":"apply-two","token":"token-b","candidateId":candidate,
            "worldId":"a","revision":0,"snapshot":world().snapshot})),
        "WORLD_APPLICATION_BUSY",
    );
    // A different world is not blocked by this one.
    assert_eq!(journal.world_read("b")?.world.build["id"], "base-a");
    Ok(())
}

#[test]
fn commit_is_replay_safe_and_a_wrong_token_is_refused() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let prepared = prepare(&mut journal, finished["candidateId"].as_str().unwrap(), 0)?;
    let build = job["buildId"].as_str().unwrap();
    let mut forged = evidence(&prepared, build, &world().snapshot["player"]);
    forged["token"] = json!("token-b");
    failed(journal.godot_application_commit(&forged), "GODOT_APPLICATION_OWNER_MISMATCH");
    let first = journal.godot_application_commit(&evidence(&prepared, build, &world().snapshot["player"]))?;
    let revision = journal.world_read("a")?.summary.revision;
    // A lost response is answered from the committed receipt, not applied twice.
    let replay = journal.godot_application_commit(&evidence(&prepared, build, &world().snapshot["player"]))?;
    assert_eq!(replay["outputHash"], first["outputHash"]);
    assert_eq!(journal.world_read("a")?.summary.revision, revision);
    let mut changed = evidence(&prepared, build, &world().snapshot["player"]);
    changed["evidence"]["launch"]["instanceId"] = json!("instance-2");
    failed(journal.godot_application_commit(&changed), "REPLAY_MISMATCH");
    Ok(())
}

#[test]
fn a_restarted_core_never_applies_an_unconfirmed_candidate() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let prepared = prepare(&mut journal, finished["candidateId"].as_str().unwrap(), 0)?;
    drop(journal);
    let mut restored = TaskJournal::open(&path)?;
    restored.godot_application_recover()?;
    assert_eq!(restored.godot_application_read(&json!({"id":"apply-one"}))?["status"], "interrupted");
    failed(
        restored.godot_application_commit(&evidence(&prepared, job["buildId"].as_str().unwrap(), &world().snapshot["player"])),
        "GODOT_APPLICATION_OWNER_MISMATCH",
    );
    assert_eq!(restored.world_read("a")?.world.build["id"], "base-a");
    assert_eq!(restored.world_read("a")?.summary.revision, 0);
    // The candidate remains ready and can be applied again deliberately.
    let again = restored.godot_application_prepare(&json!({"id":"apply-two","token":"token-b",
        "candidateId":finished["candidateId"],"worldId":"a","revision":0,"snapshot":world().snapshot}))?;
    assert_eq!(again["status"], "prepared");
    Ok(())
}

#[test]
fn a_rejected_candidate_cannot_replace_the_formal_world() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (_, failed_check) = run_check(&mut journal, &context, &created, "check-one", false)?;
    let candidate = failed_check["candidateId"].as_str().unwrap();
    failed(
        journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-a","candidateId":candidate,
            "worldId":"a","revision":0,"snapshot":world().snapshot})),
        "GODOT_CANDIDATE_NOT_READY",
    );
    // A foreign world cannot prepare this candidate either.
    failed(
        journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-a","candidateId":candidate,
            "worldId":"b","revision":0,"snapshot":world().snapshot})),
        "PROJECT_WORLD_BINDING_MISMATCH",
    );
    assert_eq!(journal.world_read("a")?.world.build["id"], "base-a");
    assert_eq!(journal.world_read("a")?.summary.revision, 0);
    Ok(())
}

#[test]
fn matching_player_does_not_authorize_replacing_other_formal_progress() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let mut formal = world();
    formal.snapshot["inventory"] = json!({"coins":37,"apples":2});
    formal.snapshot["quests"] = json!({"shop":"completed"});
    journal.world_save_progress("a", 0, "base-a", &formal.snapshot)?;
    let before = journal.world_read("a")?;
    failed(prepare(&mut journal, finished["candidateId"].as_str().unwrap(), before.summary.revision), "APPLICATION_PROGRESS_CHANGED");
    assert_eq!(journal.world_read("a")?.world.snapshot, formal.snapshot);
    let prepared = journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-a",
        "candidateId":finished["candidateId"],"worldId":"a","revision":before.summary.revision,"snapshot":formal.snapshot}))?;
    journal.godot_application_commit(&evidence(&prepared, job["buildId"].as_str().unwrap(), &formal.snapshot["player"]))?;
    assert_eq!(journal.world_read("a")?.world.snapshot, formal.snapshot);
    Ok(())
}

#[test]
fn source_edits_after_prepare_revoke_publication() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let prepared = prepare(&mut journal, finished["candidateId"].as_str().unwrap(), 0)?;
    journal.godot_project_patch(&json!({"context":&context,"worldId":"a","toolCallId":"patch-after-prepare",
        "revision":created["revision"],"manifestHash":created["manifestHash"],
        "operations":[{"op":"put","path":"world.gd","expectedHash":digest(SCRIPT),"text":"extends Node3D\nvar damage := 7\n"}]}))?;
    failed(journal.godot_application_commit(&evidence(&prepared, job["buildId"].as_str().unwrap(), &world().snapshot["player"])), "GODOT_CANDIDATE_STALE");
    assert_eq!(journal.world_read("a")?.world.build["id"], "base-a");
    assert_eq!(journal.world_read("a")?.summary.revision, 0);
    Ok(())
}

#[test]
fn asset_edits_after_prepare_revoke_publication() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, finished) = run_check(&mut journal, &context, &created, "check-one", true)?;
    let prepared = prepare(&mut journal, finished["candidateId"].as_str().unwrap(), 0)?;
    put_asset(&mut journal, &context, "new-asset", "new.png", "image/png", b"new resource")?;
    failed(journal.godot_application_commit(&evidence(&prepared, job["buildId"].as_str().unwrap(), &world().snapshot["player"])), "GODOT_CANDIDATE_STALE");
    assert_eq!(journal.world_read("a")?.world.build["id"], "base-a");
    Ok(())
}
