use super::*;
use crate::godot_test_support as fixture;

fn progress(world: &str) -> Value {
    json!({"format":PROGRESS_FORMAT,"worldId":world,"baseId":"first-person","baseVersion":"0.1.0",
        "stateVersion":1,"body":{"worldId":world,"player":{"position":[1200,0,-98]},
        "inventory":{"ore":12},"rooms":{"west":{"cleared":true}},"grantedRewards":["quest-a"],
        "customGameplay":{"天气":"晴","counter":2}}})
}

fn seed(journal: &mut TaskJournal) -> Result<()> {
    let world = worlds::WorldDocument {build:json!({"id":"base-a",
        "scene":{"format":"craftmine.godot-scene/1","baseId":"first-person"},"godot":{}}),
        snapshot:progress("a"),extensions:vec![]};
    journal.world_create("a", "A", &world)?;
    journal.workspace_open(&fixture::ctx("one"), "a")?;
    Ok(())
}

fn save_args(snapshot: &Value, build: &str, revision: u64) -> Value {
    let text = serde_json::to_string(snapshot).unwrap();
    json!({"worldId":"a","buildId":build,"revision":revision,"snapshot":snapshot,
        "runnerReceipt":{"format":"craftmine.godot-runner-receipt/1","worldId":"a","buildId":build,
            "instanceId":"runtime-one","snapshotText":text,"snapshotSha256":digest(&text),"bytes":text.len()}})
}

fn applied(journal: &mut TaskJournal) -> Result<Value> {
    seed(journal)?;
    let project = fixture::create_project(journal, &fixture::ctx("one"))?;
    let (_, checked) = fixture::run_check(journal, &fixture::ctx("one"), &project, "check", true)?;
    let candidate = &checked["candidateId"];
    let prepare = journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-apply",
        "candidateId":candidate,"worldId":"a","revision":0,"snapshot":progress("a")}))?;
    journal.godot_application_commit(&json!({"id":"apply-one","token":"token-apply",
        "evidence":{"format":"craftmine.godot-application/2","inputHash":prepare["inputHash"],
        "launch":{"passed":true,"buildId":prepare["buildId"],"instanceId":"runtime-a","stateHash":digest("state")},
        "player":null,"snapshot":progress("a")}}))?;
    Ok(project)
}

/// The only state that may persist Godot progress: a build the host really
/// applied after a verified check and a confirmed launch.
fn applied_state(journal: &mut TaskJournal) -> Result<(String, u64)> {
    applied(journal)?;
    let world = journal.world_read("a")?;
    Ok((
        world.world.build["id"].as_str().unwrap().to_string(),
        world.summary.revision,
    ))
}

#[test]
fn full_progress_is_lossless_across_restart_and_noop_save() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    let (build, revision) = applied_state(&mut journal)?;
    let mut snapshot = progress("a");
    snapshot["body"]["inventory"]["ore"] = json!(27);
    let args = save_args(&snapshot, &build, revision);
    let result = journal.godot_runtime_save_progress(&args)?;
    assert_eq!(result["receipt"]["revision"], revision + 1);
    assert_eq!(result["receipt"]["format"], "craftmine.godot-progress-receipt/1");
    drop(journal);
    let mut journal = TaskJournal::open(&path)?;
    assert_eq!(journal.world_read("a")?.world.snapshot, snapshot);
    let noop =
        journal.godot_runtime_save_progress(&save_args(&snapshot, &build, revision + 1))?;
    assert_eq!(noop["receipt"], result["receipt"]);
    fixture::failed(journal.godot_runtime_save_progress(&args), "WORLD_REVISION_CONFLICT");
    Ok(())
}

#[test]
fn a_new_turn_can_continue_applied_source_but_not_foreign_lineage() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    let project = applied(&mut journal)?;
    let first = fixture::ctx("one");
    journal.workspace_end_turn(&first.session_id, &first.turn_id, "completed")?;
    let second = fixture::ctx("two");
    journal.workspace_open(&second, "a")?;
    let before = journal.world_read("a")?;
    let request = json!({"context":second,"worldId":"a","toolCallId":"continue-applied",
        "revision":project["revision"],"manifestHash":project["manifestHash"],
        "operations":[{"op":"put","path":"continued.gd","text":"extends Node\n","expectedHash":null}]});
    let mut foreign = before.world.clone();
    foreign.build["godot"]["baseBuild"] = json!("unrelated-base");
    let body = worlds::encode(&foreign)?;
    journal.db.execute("UPDATE craftmine_worlds SET document=?1,content_hash=?2 WHERE id='a'", params![body, digest(&body)])?;
    fixture::failed(journal.godot_project_patch(&request), "WORLD_BUILD_CONFLICT");
    let body = worlds::encode(&before.world)?;
    journal.db.execute("UPDATE craftmine_worlds SET document=?1,content_hash=?2 WHERE id='a'", params![body, digest(&body)])?;
    let patched = journal.godot_project_patch(&request)?;
    assert_eq!(patched["revision"], project["revision"].as_u64().unwrap() + 1);
    assert_eq!(patched["baseBuild"], before.world.build["id"]);
    assert_eq!(journal.world_read("a")?, before);
    let job = fixture::start(&mut journal, &second, "build-continued", &patched, "check")?;
    assert_eq!(job["status"], "queued");
    Ok(())
}

#[test]
fn receipt_tampering_and_cross_world_saves_leave_formal_progress_intact() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    let (build, revision) = applied_state(&mut journal)?;
    let before = journal.world_read("a")?;
    for (field, value, code) in [
        ("worldId", json!("b"), "GODOT_RUNNER_RECEIPT_MISMATCH"),
        ("buildId", json!("wrong"), "GODOT_RUNNER_RECEIPT_MISMATCH"),
        ("bytes", json!(1), "GODOT_SNAPSHOT_HASH_MISMATCH"),
        ("snapshotSha256", json!(digest("wrong")), "GODOT_SNAPSHOT_HASH_MISMATCH"),
        ("instanceId", json!("../x"), "GODOT_RUNNER_RECEIPT_MISMATCH"),
    ] {
        let mut args = save_args(&progress("a"), &build, revision);
        args["runnerReceipt"][field] = value;
        fixture::failed(journal.godot_runtime_save_progress(&args), code);
        assert_eq!(journal.world_read("a")?, before);
    }
    fixture::failed(journal.godot_runtime_save_progress(&save_args(&progress("b"), &build, revision)), "GODOT_PROGRESS_WORLD_MISMATCH");
    let mut args = save_args(&progress("a"), &build, revision);
    args["snapshot"]["body"]["grantedRewards"] = json!([]);
    fixture::failed(journal.godot_runtime_save_progress(&args), "GODOT_SNAPSHOT_HASH_MISMATCH");
    assert_eq!(journal.world_read("a")?, before);
    // A build id the world merely claims is never enough: the formal build id is
    // the applied one, so claiming the base build is a build conflict.
    fixture::failed(
        journal.godot_runtime_save_progress(&save_args(&progress("a"), "base-a", revision)),
        "WORLD_BUILD_CONFLICT",
    );
    assert_eq!(journal.world_read("a")?, before);
    Ok(())
}

#[test]
fn base_and_schema_changes_need_explicit_migration_not_plain_save() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    let (build, revision) = applied_state(&mut journal)?;
    for (key, value, code) in [
        ("baseId", json!("top-down"), "GODOT_PROGRESS_BASE_MISMATCH"),
        ("baseVersion", json!("2.0.0"), "GODOT_PROGRESS_VERSION_MISMATCH"),
        ("stateVersion", json!(2), "GODOT_PROGRESS_VERSION_MISMATCH"),
    ] {
        let mut snapshot = progress("a");
        snapshot[key] = value;
        fixture::failed(journal.godot_runtime_save_progress(&save_args(&snapshot, &build, revision)), code);
    }
    fixture::failed(journal.world_save_progress("a", revision, &build, &fixture::world().snapshot), "GODOT_PROGRESS_MIGRATION_REQUIRED");
    assert_eq!(journal.world_read("a")?.summary.revision, revision);
    Ok(())
}

#[test]
fn progress_limits_count_utf8_and_do_not_truncate_custom_state() -> Result<()> {
    let mut snapshot = progress("a");
    snapshot["body"]["customGameplay"]["large"] = json!("界".repeat(PROGRESS_BYTES / 3));
    fixture::failed(validate_progress(&snapshot), "GODOT_PROGRESS_TOO_LARGE");
    snapshot["body"]["customGameplay"]["large"] = json!("界".repeat(100_000));
    validate_progress(&snapshot)?;
    snapshot["body"]["worldId"] = json!("b");
    fixture::failed(validate_progress(&snapshot), "GODOT_PROGRESS_WORLD_MISMATCH");
    Ok(())
}

#[test]
fn progress_is_refused_for_a_world_whose_build_was_never_applied() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    // A freshly initialised world claims a base build but has no application yet.
    journal.godot_world_initialize(&json!({"worldId":"g1","title":"New World","baseId":"first-person",
        "baseBuild":"base-a","snapshot":progress("g1")}))?;
    let revision = journal.world_read("g1")?.summary.revision;
    let mut snapshot = progress("g1");
    snapshot["body"]["inventory"] = json!({"ore": 3});
    let text = serde_json::to_string(&snapshot)?;
    fixture::failed(
        journal.godot_runtime_save_progress(&json!({"worldId":"g1","buildId":"base-a",
            "revision":revision,"snapshot":snapshot,"runnerReceipt":{"format":"craftmine.godot-runner-receipt/1",
            "worldId":"g1","buildId":"base-a","instanceId":"runtime-g1","snapshotText":text,
            "snapshotSha256":digest(&text),"bytes":text.len()}})),
        "GODOT_BUILD_NOT_APPLIED",
    );
    assert_eq!(journal.world_read("g1")?.summary.revision, revision);
    Ok(())
}

#[test]
fn godot_integral_floats_match_javascript_json_without_large_integer_aliases() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    let (build, revision) = applied_state(&mut journal)?;
    let mut args = save_args(&progress("a"), &build, revision);
    let text = args["runnerReceipt"]["snapshotText"].as_str().unwrap().replace("1200", "1200.0");
    args["runnerReceipt"]["snapshotText"] = json!(text);
    args["runnerReceipt"]["snapshotSha256"] = json!(digest(&text));
    args["runnerReceipt"]["bytes"] = json!(text.len());
    journal.godot_runtime_save_progress(&args)?;
    assert!(!same_json(&json!(9_007_199_254_740_993u64), &json!(9_007_199_254_740_992u64)));
    assert!(same_json(&json!({"pos":[1.0,0.0]}), &json!({"pos":[1,0]})));
    Ok(())
}

#[test]
fn descriptor_uses_only_applied_store_and_survives_newer_source_head() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    let project = applied(&mut journal)?;
    let descriptor = journal.godot_runtime_describe(&json!({"worldId":"a"}))?;
    assert_eq!(descriptor["entry"], "web/index.html");
    assert_eq!(descriptor["artifacts"].as_array().unwrap().len(), 1);
    assert_eq!(descriptor["snapshot"], progress("a"));
    // A model opening a new task and editing the source must not stop the
    // already applied world. Current-candidate checks belong at application.
    journal.db.execute("UPDATE craftmine_godot_projects SET revision=revision+1 WHERE world_id='a'", [])?;
    assert_eq!(journal.godot_runtime_describe(&json!({"worldId":"a"}))?, descriptor);
    assert!(project["revision"].is_number());
    drop(journal);
    let journal = TaskJournal::open(&path)?;
    assert_eq!(journal.godot_runtime_describe(&json!({"worldId":"a"}))?, descriptor);
    Ok(())
}

#[test]
fn descriptor_rehashes_exports_and_ignores_world_document_paths() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    applied(&mut journal)?;
    let descriptor = journal.godot_runtime_describe(&json!({"worldId":"a"}))?;
    let mut current = journal.world_read("a")?;
    current.world.build["godot"]["root"] = json!("C:/Users/secret");
    current.world.build["godot"]["entry"] = json!("../../secret.txt");
    let body = worlds::encode(&current.world)?;
    journal.db.execute("UPDATE craftmine_worlds SET document=?1,content_hash=?2 WHERE id='a'", params![body,digest(&body)])?;
    let resolved = journal.godot_runtime_describe(&json!({"worldId":"a"}))?;
    assert_eq!(resolved["root"], descriptor["root"]);
    assert_eq!(resolved["entry"], "web/index.html");
    let file = std::path::Path::new(resolved["root"].as_str().unwrap()).join("web/index.html");
    std::fs::write(file, b"<html>evil</html>")?;
    fixture::failed(journal.godot_runtime_describe(&json!({"worldId":"a"})), "CORRUPT_GODOT_ARTIFACT");
    Ok(())
}

#[test]
fn legacy_returns_null_but_unverified_godot_is_an_error() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    journal.world_create("legacy", "Legacy", &fixture::world())?;
    assert!(journal.godot_runtime_describe(&json!({"worldId":"legacy"}))?.is_null());
    seed(&mut journal)?;
    fixture::failed(journal.godot_runtime_describe(&json!({"worldId":"a"})), "INVALID_GODOT_BUILD");
    Ok(())
}

#[test]
fn applied_progress_requires_full_launch_state_and_prepared_world_is_frozen() -> Result<()> {
    let (_dir, path) = fixture::temp()?;
    let mut journal = TaskJournal::open(&path)?;
    seed(&mut journal)?;
    let project = fixture::create_project(&mut journal, &fixture::ctx("one"))?;
    let (_, checked) = fixture::run_check(&mut journal, &fixture::ctx("one"), &project, "check", true)?;
    let prepare = journal.godot_application_prepare(&json!({"id":"apply","token":"token-apply",
        "candidateId":checked["candidateId"],"worldId":"a","revision":0,"snapshot":progress("a")}))?;
    let describe = json!({"worldId":"a","applicationId":"apply","token":"token-apply"});
    let descriptor = journal.godot_runtime_describe_candidate(&describe)?;
    assert_eq!(descriptor["phase"], "candidate");
    assert_eq!(descriptor["buildId"], prepare["buildId"]);
    assert_eq!(descriptor["snapshot"], progress("a"));
    assert_eq!(journal.world_read("a")?.world.build["id"], "base-a");
    fixture::failed(journal.godot_runtime_describe_candidate(&json!({"worldId":"a","applicationId":"apply","token":"wrong"})), "GODOT_APPLICATION_OWNER_MISMATCH");
    fixture::failed(journal.godot_runtime_describe_candidate(&json!({"worldId":"b","applicationId":"apply","token":"token-apply"})), "PROJECT_WORLD_BINDING_MISMATCH");
    fixture::failed(journal.godot_runtime_save_progress(&save_args(&progress("a"), "base-a", 0)), "WORLD_APPLICATION_BUSY");
    let args = json!({"id":"apply","token":"token-apply","evidence":{"format":"craftmine.godot-application/1",
        "inputHash":prepare["inputHash"],"launch":{"passed":true,"buildId":prepare["buildId"],
        "instanceId":"run","stateHash":digest("state")},"player":null}});
    fixture::failed(journal.godot_application_commit(&args), "APPLICATION_PROGRESS_CHANGED");
    assert_eq!(journal.world_read("a")?.summary.revision, 0);
    journal.db.execute("UPDATE craftmine_godot_projects SET revision=revision+1 WHERE world_id='a'", [])?;
    fixture::failed(journal.godot_runtime_describe_candidate(&describe), "GODOT_CANDIDATE_STALE");
    journal.godot_application_abort(&json!({"id":"apply"}))?;
    fixture::failed(journal.godot_runtime_describe_candidate(&describe), "GODOT_APPLICATION_OWNER_MISMATCH");
    Ok(())
}
