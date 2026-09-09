use super::*;
use crate::godot_test_support::*;
use crate::WorkspaceContext;

fn progress(world: &str) -> Value {
    json!({"format":godot_runtime::PROGRESS_FORMAT,"worldId":world,"baseId":"first-person",
        "baseVersion":"0.1.0","stateVersion":1,
        "body":{"worldId":world,"player":{"position":[0,0,0]},"inventory":{}}})
}

fn initialize(journal: &mut TaskJournal, world: &str, base: &str) -> Result<Value> {
    journal.godot_world_initialize(&json!({"worldId":world,"title":"New World","baseId":"first-person",
        "baseBuild":base,"snapshot":progress(world)}))
}

fn check_to_candidate(
    journal: &mut TaskJournal,
    context: &WorkspaceContext,
    world: &str,
    revision: &Value,
    call: &str,
) -> Result<Value> {
    let job = journal.godot_build_start(&json!({"context":context,"worldId":world,"toolCallId":call,
        "revision":revision["revision"],"manifestHash":revision["manifestHash"],"mode":"check"}))?;
    let claimed = claim(journal, &job, "token-a", "executor-a")?;
    let artifacts = write_artifact(&claimed, "web/index.html", b"<html></html>")?;
    let assertions = json!([{"id":"crosshair.center","passed":true,"detail":"centered"}]);
    finish(journal, &job, "token-a", &output(&claimed, true, assertions, artifacts, json!([])))
}

#[test]
fn initialize_creates_a_recoverable_record_and_never_declares_a_playable_world() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = TaskJournal::open(&path)?;
    let created = initialize(&mut journal, "g1", "base-a")?;
    assert_eq!(created["replayed"], false);
    assert_eq!(created["init"]["status"], "pending");
    assert_eq!(created["world"]["world"]["build"]["id"], "base-a");
    assert_eq!(created["world"]["world"]["build"]["godot"]["initializing"], true);
    // The same request replays; a different base is a real conflict.
    assert_eq!(initialize(&mut journal, "g1", "base-a")?["replayed"], true);
    failed(initialize(&mut journal, "g1", "base-b"), "WORLD_EXISTS");
    // An initialising world is not runnable, whatever its build string says.
    let status = journal.godot_world_init_status(&json!({"worldId":"g1"}))?;
    assert_eq!(status["status"], "pending");
    assert_eq!(status["playable"], false);
    assert_eq!(status["formalBuildId"], "base-a");
    failed(journal.godot_runtime_describe(&json!({"worldId":"g1"})), "GODOT_WORLD_NOT_INITIALIZED");
    // A legacy or empty progress document cannot become a new Godot world.
    let mut legacy = progress("g2");
    legacy["format"] = json!("craftmine.progress/1");
    failed(
        journal.godot_world_initialize(&json!({"worldId":"g2","title":"Legacy","baseId":"first-person",
            "baseBuild":"base-a","snapshot":legacy})),
        "INVALID_GODOT_PROGRESS",
    );
    let mut wrong_base = progress("g3");
    wrong_base["baseId"] = json!("top-down");
    failed(
        journal.godot_world_initialize(&json!({"worldId":"g3","title":"Wrong","baseId":"first-person",
            "baseBuild":"base-a","snapshot":wrong_base})),
        "GODOT_PROGRESS_BASE_MISMATCH",
    );
    failed(
        journal.godot_world_initialize(&json!({"worldId":"g4","title":"Bad Base","baseId":"voxel",
            "baseBuild":"base-a","snapshot":progress("g4")})),
        "INVALID_GODOT_BASE",
    );
    // The creation record survives a restart.
    drop(journal);
    let mut journal = TaskJournal::open(&path)?;
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"g1"}))?["status"], "pending");
    Ok(())
}

#[test]
fn only_a_real_verified_application_confirms_initialization() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = TaskJournal::open(&path)?;
    initialize(&mut journal, "g1", "base-a")?;
    let context = ctx("one");
    journal.workspace_open(&context, "g1")?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let project = create_project_in(&mut journal, &context, "g1", "create-one")?;
    let checked = check_to_candidate(&mut journal, &context, "g1", &project, "check-one")?;
    assert_eq!(checked["status"], "passed");
    let checked_state = journal.godot_world_init_status(&json!({"worldId":"g1"}))?;
    assert_eq!(checked_state["status"], "checked");
    assert_eq!(checked_state["playable"], false);
    assert_eq!(checked_state["candidateId"], checked["candidateId"]);
    let snapshot = journal.world_read("g1")?.world.snapshot;
    let prepare = journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-apply",
        "candidateId":checked["candidateId"],"worldId":"g1","revision":0,"snapshot":snapshot}))?;
    // Preparing is not applying: the world is still not playable.
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"g1"}))?["playable"], false);
    journal.godot_application_commit(&json!({"id":"apply-one","token":"token-apply",
        "evidence":{"format":"craftmine.godot-application/2","inputHash":prepare["inputHash"],
        "launch":{"passed":true,"buildId":prepare["buildId"],"instanceId":"runtime-g1",
            "stateHash":digest("state")},"player":null,"snapshot":snapshot}}))?;
    let confirmed = journal.godot_world_init_status(&json!({"worldId":"g1"}))?;
    assert_eq!(confirmed["status"], "confirmed");
    assert_eq!(confirmed["playable"], true);
    assert_eq!(confirmed["applicationId"], "apply-one");
    assert_eq!(confirmed["reason"], Value::Null);
    assert!(godot_builds::valid_build_id(confirmed["formalBuildId"].as_str().unwrap()).is_ok());
    // The confirmed world now describes its applied build.
    let descriptor = journal.godot_runtime_describe(&json!({"worldId":"g1"}))?;
    assert_eq!(descriptor["phase"], "formal");
    assert_eq!(descriptor["buildId"], confirmed["formalBuildId"]);
    Ok(())
}

#[test]
fn a_failed_initialization_keeps_a_recoverable_record_and_can_be_retried() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = TaskJournal::open(&path)?;
    initialize(&mut journal, "g1", "base-a")?;
    let context = ctx("one");
    journal.workspace_open(&context, "g1")?;
    let project = create_project_in(&mut journal, &context, "g1", "create-one")?;
    // No executor yet: the world reports why it is waiting, not a fake success.
    let blocked = start_in(&mut journal, &context, "g1", "check-one", &project)?;
    assert_eq!(blocked["status"], "blocked");
    let waiting = journal.godot_world_init_status(&json!({"worldId":"g1"}))?;
    assert_eq!(waiting["status"], "blocked");
    assert_eq!(waiting["reason"], "GODOT_EXECUTION_UNAVAILABLE");
    assert_eq!(waiting["playable"], false);
    // The executor appears and the job is cancelled: the record explains it and
    // a later retry is still possible.
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let retry = start_in(&mut journal, &context, "g1", "check-two", &project)?;
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"g1"}))?["status"], "building");
    journal.godot_build_cancel(&json!({"worldId":"g1","context":&context,"jobId":retry["jobId"]}))?;
    let failed_state = journal.godot_world_init_status(&json!({"worldId":"g1"}))?;
    assert_eq!(failed_state["status"], "failed");
    assert_eq!(failed_state["reason"], "GODOT_CANCELLED_BY_USER");
    assert_eq!(failed_state["playable"], false);
    let again = start_in(&mut journal, &context, "g1", "check-three", &project)?;
    assert_eq!(again["status"], "queued");
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"g1"}))?["status"], "building");
    Ok(())
}

fn start_in(
    journal: &mut TaskJournal,
    context: &WorkspaceContext,
    world: &str,
    call: &str,
    revision: &Value,
) -> Result<Value> {
    journal.godot_build_start(&json!({"context":context,"worldId":world,"toolCallId":call,
        "revision":revision["revision"],"manifestHash":revision["manifestHash"],"mode":"check"}))
}

/// Full initialisation of one world up to a confirmed application.
fn applied_world(journal: &mut TaskJournal, world: &str) -> Result<()> {
    initialize(journal, world, "base-a")?;
    let context = ctx("one");
    journal.workspace_open(&context, world)?;
    register(journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let project = create_project_in(journal, &context, world, "create-one")?;
    let checked = check_to_candidate(journal, &context, world, &project, "check-one")?;
    let snapshot = journal.world_read(world)?.world.snapshot;
    let prepare = journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-apply",
        "candidateId":checked["candidateId"],"worldId":world,"revision":0,"snapshot":snapshot}))?;
    journal.godot_application_commit(&json!({"id":"apply-one","token":"token-apply",
        "evidence":{"format":"craftmine.godot-application/2","inputHash":prepare["inputHash"],
        "launch":{"passed":true,"buildId":prepare["buildId"],"instanceId":"runtime-one",
            "stateHash":digest("state")},"player":null,"snapshot":snapshot}}))?;
    Ok(())
}

#[test]
fn copying_a_formal_world_keeps_identity_separate_and_can_start_from_initial_state() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = TaskJournal::open(&path)?;
    applied_world(&mut journal, "g1")?;
    // Move the source progress so the copy proves it does not inherit it.
    let mut moved = progress("g1");
    moved["body"]["inventory"] = json!({"ore":9});
    let revision = journal.world_read("g1")?.summary.revision;
    let build = journal.world_read("g1")?.world.build["id"]
        .as_str()
        .unwrap()
        .to_string();
    journal.godot_runtime_save_progress(&json!({"worldId":"g1","buildId":build,"revision":revision,
        "snapshot":moved,"runnerReceipt":{"format":"craftmine.godot-runner-receipt/1","worldId":"g1",
            "buildId":build,"instanceId":"runtime-one","snapshotText":serde_json::to_string(&moved)?,
            "snapshotSha256":digest(&serde_json::to_string(&moved)?),
            "bytes":serde_json::to_string(&moved)?.len()}}))?;
    let copied = journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g2",
        "title":"Copy","progress":"initial","snapshot":progress("g2")}))?;
    assert_eq!(copied["buildId"], build);
    assert_eq!(copied["sourceRevision"], 0);
    assert_eq!(copied["progressMode"], "initial");
    assert_eq!(journal.world_read("g2")?.world.snapshot, progress("g2"));
    assert_ne!(journal.world_read("g2")?.world.snapshot, moved);
    // The copy keeps its own editable project and assets, and its own identity.
    let copy_context = WorkspaceContext {
        project_id: "project-a".into(),
        session_id: "session-copy".into(),
        turn_id: "two".into(),
    };
    journal.workspace_open(&copy_context, "g2")?;
    let index = journal.godot_project_index(&json!({"context":&copy_context,"worldId":"g2"}))?;
    assert_eq!(index["revision"], 0);
    assert!(index["files"].as_array().unwrap().len() >= 3);
    let listed = journal.godot_asset_list(&json!({"context":&copy_context,"worldId":"g2"}))?;
    assert_eq!(listed["items"].as_array().unwrap().len(), 0);
    // A world without an applied build is not copiable, and neither is a
    // duplicate target.
    failed(
        journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g2","title":"Again",
            "progress":"formal"})),
        "WORLD_EXISTS",
    );
    initialize(&mut journal, "g3", "base-a")?;
    failed(
        journal.godot_world_copy(&json!({"sourceWorldId":"g3","targetWorldId":"g4","title":"Init",
            "progress":"formal"})),
        "GODOT_WORLD_NOT_COPIABLE",
    );
    // A copy with the wrong world identity in its progress is refused.
    failed(
        journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g5","title":"Bad",
            "progress":"initial","snapshot":progress("g9")})),
        "GODOT_PROGRESS_BASE_MISMATCH",
    );
    // A formal copy shares the immutable build, carries the target identity in
    // its progress, and stays runnable through the source's launch evidence.
    let formal = journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g6",
        "title":"Formal Copy","progress":"formal"}))?;
    assert_eq!(formal["progressMode"], "formal");
    let inherited = journal.world_read("g6")?.world.snapshot;
    assert_eq!(inherited["worldId"], "g6");
    assert_eq!(inherited["body"]["worldId"], "g6");
    assert_eq!(inherited["body"]["inventory"], json!({"ore":9}));
    let descriptor = journal.godot_runtime_describe(&json!({"worldId":"g6"}))?;
    assert_eq!(descriptor["phase"], "formal");
    assert_eq!(descriptor["copiedFromWorldId"], "g1");
    assert_eq!(descriptor["buildId"], build);
    // The shared build is never reclaimed while either world references it.
    let plan = journal.godot_storage_reclaim_plan(&json!({"worldId":"g1"}))?;
    assert!(plan["protected"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["reason"] == "WORLD_COPY"));
    // A copy's backup descriptor resolves the shared build from its source.
    let copied_backup = journal.godot_world_backup_snapshot(&json!({"worldId":"g6"}))?;
    assert_eq!(copied_backup["copiedFromWorldId"], "g1");
    assert_eq!(copied_backup["build"]["buildId"], build);
    assert_eq!(copied_backup["worldId"], "g6");
    assert_eq!(copied_backup["snapshotHash"].as_str().unwrap().len(), 64);
    Ok(())
}

#[test]
fn backup_descriptor_verifies_the_live_store_and_detects_tampering() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = TaskJournal::open(&path)?;
    applied_world(&mut journal, "g1")?;
    let snapshot = journal.godot_world_backup_snapshot(&json!({"worldId":"g1","context":ctx("one")}))?;
    assert_eq!(snapshot["format"], "craftmine.godot-backup/1");
    assert_eq!(snapshot["project"]["revision"], 0);
    assert!(snapshot["build"]["files"].as_array().unwrap().len() >= 4);
    assert_eq!(snapshot["application"]["applicationId"], "apply-one");
    assert_eq!(snapshot["init"]["status"], "confirmed");
    assert!(snapshot["snapshotHash"].as_str().unwrap().len() == 64);
    let verified = journal.godot_world_verify_snapshot(&json!({"worldId":"g1","context":ctx("one"),
        "snapshot":snapshot}))?;
    assert_eq!(verified["matches"], true);
    // A tampered descriptor is rejected without touching the world.
    let mut tampered = snapshot.clone();
    tampered["project"]["revision"] = json!(7);
    failed(
        journal.godot_world_verify_snapshot(&json!({"worldId":"g1","context":ctx("one"),
            "snapshot":tampered})),
        "GODOT_BACKUP_MISMATCH",
    );
    // A tampered build file on disk is detected by the descriptor itself.
    let build = snapshot["build"]["buildId"].as_str().unwrap();
    let file = snapshot["build"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["kind"] == "source")
        .unwrap()["path"]
        .as_str()
        .unwrap()
        .to_string();
    let target = godot_builds::build_root(&journal.directory, "g1", build, false)?
        .join("source")
        .join(&file);
    std::fs::write(&target, b"tampered")?;
    failed(
        journal.godot_world_backup_snapshot(&json!({"worldId":"g1","context":ctx("one")})),
        "CORRUPT_GODOT_BUILD",
    );
    Ok(())
}
