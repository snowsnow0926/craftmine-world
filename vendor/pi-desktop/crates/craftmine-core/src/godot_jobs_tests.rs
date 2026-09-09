use super::*;
use crate::godot_test_support::*;
use std::path::Path;

#[test]
fn a_job_cannot_run_without_an_attested_executor() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let job = start(&mut journal, &context, "build-one", &created, "check")?;
    assert_eq!(job["status"], "blocked");
    assert_eq!(job["executionAvailable"], false);
    assert_eq!(job["blockedReason"], "GODOT_EXECUTION_UNAVAILABLE");
    // No executor, no execution: not even with a token.
    failed(claim(&mut journal, &job, "token-a", "executor-a"), "GODOT_EXECUTOR_UNAVAILABLE");
    failed(
        journal.godot_executor_register(&json!({"executorId":"executor-a","attestation":{
            "format":"craftmine.godot-executor/1","isolation":"appcontainer","evidenceHash":digest("e"),
            "engineVersion":"4.6.0-stable","capabilities":{"import":true,"build":true,"check":true}}})),
        "INVALID_EXECUTOR_ATTESTATION",
    );
    failed(
        journal.godot_executor_register(&json!({"executorId":"executor-a","attestation":{
            "format":"craftmine.godot-executor/1","isolation":"appcontainer","evidenceHash":"not-a-hash",
            "engineVersion":"4.7.2-stable","capabilities":{"import":true,"build":true,"check":true}}})),
        "INVALID_EXECUTOR_ATTESTATION",
    );
    // A build-only executor cannot run a check job.
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":false}), &digest("e"))?;
    assert_eq!(journal.godot_build_read(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?["status"], "queued");
    failed(claim(&mut journal, &job, "token-a", "executor-a"), "GODOT_EXECUTOR_CAPABILITY_MISSING");
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    assert_eq!(claimed["status"], "claimed");
    assert_eq!(claimed["inputHash"].as_str().map(|hash| hash.len()), Some(64));
    Ok(())
}

#[test]
fn a_claim_hands_the_executor_absolute_isolated_paths_and_verified_inputs() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    put_asset(&mut journal, &context, "asset-one", "hero.png", "image/png", b"hero-bytes")?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "build-one", &created, "build")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    for key in ["projectRoot", "cacheRoot", "artifactsRoot"] {
        let value = claimed[key].as_str().unwrap();
        assert!(Path::new(value).is_absolute(), "{key} must be absolute");
        assert!(value.starts_with(&journal.directory.to_string_lossy().to_string()));
    }
    assert_eq!(claimed["files"]["source"].as_array().unwrap().len(), 3);
    assert_eq!(claimed["files"]["asset"].as_array().unwrap().len(), 1);
    assert_eq!(claimed["engineVersion"], "4.7.2-stable");
    assert_eq!(claimed["isolation"], "appcontainer");
    assert_eq!(claimed["evidenceHash"], digest("e"));
    Ok(())
}

#[test]
fn a_wrong_token_cannot_observe_or_finish_a_job() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "build-one", &created, "build")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    failed(
        journal.godot_job_progress(&json!({"jobId":job["jobId"],"token":"token-b","stage":"import","percent":10})),
        "GODOT_JOB_OWNER_MISMATCH",
    );
    failed(
        journal.godot_job_heartbeat(&json!({"jobId":job["jobId"],"token":"token-b"})),
        "GODOT_JOB_OWNER_MISMATCH",
    );
    failed(
        finish(&mut journal, &job, "token-b", &output(&claimed, true, json!([]), json!([]), json!([]))),
        "GODOT_JOB_OWNER_MISMATCH",
    );
    assert_eq!(journal.godot_build_read(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?["status"], "claimed");
    Ok(())
}

#[test]
fn real_compile_errors_fail_the_job_even_when_the_executor_claims_success() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "check-one", &created, "check")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    let result = finish(
        &mut journal,
        &job,
        "token-a",
        &output(&claimed, true, json!([{"id":"crosshair.center","passed":true}]), json!([]), json!(["world.gd:3 parse error"])),
    )?;
    assert_eq!(result["status"], "failed");
    assert_eq!(result["output"]["compile"]["errors"][0], "world.gd:3 parse error");
    // A failed check produces a rejected candidate, never a ready one.
    let candidate = journal.godot_candidate_read(&json!({"context":&context,"worldId":"a",
        "candidateId":result["candidateId"]}))?;
    assert_eq!(candidate["candidate"]["status"], "rejected");
    failed(
        journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-a","candidateId":result["candidateId"],
            "worldId":"a","revision":0,"snapshot":world().snapshot})),
        "GODOT_CANDIDATE_NOT_READY",
    );
    assert_eq!(journal.world_read("a")?.world.build["id"], "base-a");
    Ok(())
}

#[test]
fn a_check_without_assertions_proves_nothing() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "check-one", &created, "check")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    failed(
        finish(&mut journal, &job, "token-a", &output(&claimed, true, json!([]), json!([]), json!([]))),
        "GODOT_CHECK_ASSERTIONS_REQUIRED",
    );
    assert_eq!(journal.godot_build_read(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?["status"], "claimed");
    Ok(())
}

#[test]
fn a_passing_check_creates_a_ready_candidate_and_supersedes_the_older_one() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let (job, first) = run_check(&mut journal, &context, &created, "check-one", true)?;
    assert_eq!(first["status"], "passed");
    let first_id = first["candidateId"].as_str().unwrap();
    let ready = journal.godot_candidate_read(&json!({"context":&context,"worldId":"a","candidateId":first_id}))?;
    assert_eq!(ready["candidate"]["status"], "ready");
    assert_eq!(ready["candidate"]["sourceRevision"], 0);
    assert_eq!(ready["checkStatus"], "passed");
    assert_eq!(ready["check"]["assertions"][0]["id"], "crosshair.center");
    assert_eq!(ready["candidate"]["buildId"], job["buildId"]);
    let patched = journal.godot_project_patch(&json!({"context":&context,"worldId":"a","toolCallId":"patch-one",
        "revision":created["revision"],"manifestHash":created["manifestHash"],
        "operations":[{"op":"put","path":"world.gd","expectedHash":digest(SCRIPT),"text":"extends Node3D\nvar damage := 7\n"}]}))?;
    // The candidate is bound to its exact source revision.
    failed(
        journal.godot_application_prepare(&json!({"id":"apply-stale","token":"token-a","candidateId":first_id,
            "worldId":"a","revision":0,"snapshot":world().snapshot})),
        "GODOT_CANDIDATE_STALE",
    );
    let (_, second) = run_check(&mut journal, &context, &patched, "check-two", true)?;
    let second_id = second["candidateId"].as_str().unwrap();
    assert_ne!(first_id, second_id);
    let superseded = journal.godot_candidate_read(&json!({"context":&context,"worldId":"a","candidateId":first_id}))?;
    assert_eq!(superseded["candidate"]["status"], "superseded");
    let listed = journal.godot_candidate_list(&json!({"context":&context,"worldId":"a"}))?;
    assert_eq!(listed["items"].as_array().unwrap().len(), 2);
    Ok(())
}

#[test]
fn a_cancelled_job_rejects_a_late_result_and_creates_no_candidate() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "check-one", &created, "check")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    let cancelled = journal.godot_build_cancel(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?;
    assert_eq!(cancelled["status"], "cancelled");
    failed(
        finish(&mut journal, &job, "token-a", &output(&claimed, true, json!([{"id":"a","passed":true}]), json!([]), json!([]))),
        "GODOT_JOB_INACTIVE",
    );
    let record = journal.godot_build_read(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?;
    assert_eq!(record["status"], "cancelled");
    assert!(record["candidateId"].is_null());
    failed(
        journal.godot_candidate_read(&json!({"context":&context,"worldId":"a","candidateId":format!("gcan-{}", "0".repeat(64))})),
        "GODOT_CANDIDATE_NOT_FOUND",
    );
    Ok(())
}

#[test]
fn a_restart_interrupts_a_running_job_and_refuses_its_late_result() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "check-one", &created, "check")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    journal.godot_job_progress(&json!({"jobId":job["jobId"],"token":"token-a","stage":"compile","percent":40}))?;
    drop(journal);
    let mut restored = TaskJournal::open(&path)?;
    // Registration is process-scoped, so a restarted core must be told again.
    failed(claim(&mut restored, &job, "token-a", "executor-a"), "GODOT_EXECUTOR_UNAVAILABLE");
    restored.godot_recover()?;
    let record = restored.godot_build_read(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?;
    assert_eq!(record["status"], "interrupted");
    assert!(record["leaseExpiresAt"].is_null());
    register(&mut restored, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    failed(
        finish(&mut restored, &job, "token-a", &output(&claimed, true, json!([{"id":"a","passed":true}]), json!([]), json!([]))),
        "GODOT_JOB_INACTIVE",
    );
    // The materialized build and the formal world are untouched by recovery.
    assert!(build_root(&restored.directory, "a", job["buildId"].as_str().unwrap(), false)?.exists());
    assert_eq!(restored.world_read("a")?.world.build["id"], "base-a");
    Ok(())
}

#[test]
fn an_artifact_that_does_not_match_its_declared_hash_is_rejected() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "check-one", &created, "check")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    // A declared artifact that is not on disk is not evidence.
    failed(
        finish(&mut journal, &job, "token-a", &output(&claimed, true,
            json!([{"id":"a","passed":true}]), json!([{"path":"web/index.html","sha256":digest("x"),"bytes":4}]), json!([]))),
        "GODOT_ARTIFACT_MISSING",
    );
    let artifact = write_artifact(&claimed, "web/index.html", b"<html></html>")?;
    let mut forged = artifact.clone();
    forged[0]["sha256"] = json!(digest("different"));
    failed(
        finish(&mut journal, &job, "token-a", &output(&claimed, true, json!([{"id":"a","passed":true}]), forged, json!([]))),
        "CORRUPT_GODOT_ARTIFACT",
    );
    failed(
        finish(&mut journal, &job, "token-a", &output(&claimed, true, json!([{"id":"a","passed":true}]),
            json!([{"path":"../escape.html","sha256":digest("<html></html>"),"bytes":13}]), json!([]))),
        "INVALID_GODOT_ARTIFACT",
    );
    // The real artifact is recorded exactly once and replayed on a duplicate finish.
    let finished = finish(&mut journal, &job, "token-a", &output(&claimed, true,
        json!([{"id":"a","passed":true}]), artifact.clone(), json!([])))?;
    assert_eq!(finished["status"], "passed");
    let again = finish(&mut journal, &job, "token-a", &output(&claimed, true,
        json!([{"id":"a","passed":true}]), artifact, json!([])))?;
    assert_eq!(again["outputHash"], finished["outputHash"]);
    assert_eq!(again["candidateId"], finished["candidateId"]);
    let read = journal.godot_build_read(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?;
    assert_eq!(read["artifacts"].as_array().unwrap().len(), 1);
    assert_eq!(read["artifacts"][0]["path"], "web/index.html");
    Ok(())
}

#[test]
fn a_result_from_another_job_is_rejected_by_the_input_hash() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let first = start(&mut journal, &context, "check-one", &created, "check")?;
    let second = start(&mut journal, &context, "check-two", &created, "check")?;
    let claimed_first = claim(&mut journal, &first, "token-a", "executor-a")?;
    let claimed_second = claim(&mut journal, &second, "token-b", "executor-a")?;
    assert_ne!(claimed_first["inputHash"], claimed_second["inputHash"]);
    // A result produced for another job cannot be accepted for this one.
    failed(
        finish(&mut journal, &second, "token-b", &output(&claimed_first, true, json!([{"id":"a","passed":true}]), json!([]), json!([]))),
        "GODOT_JOB_INPUT_MISMATCH",
    );
    Ok(())
}

#[test]
fn progress_is_monotonic_and_heartbeats_extend_the_lease() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "build-one", &created, "build")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    let first = journal.godot_job_progress(&json!({"jobId":job["jobId"],"token":"token-a","stage":"import","percent":30}))?;
    assert_eq!(first["status"], "running");
    failed(
        journal.godot_job_progress(&json!({"jobId":job["jobId"],"token":"token-a","stage":"import","percent":10})),
        "INVALID_GODOT_PROGRESS",
    );
    let before = first["leaseExpiresAt"].as_i64().unwrap();
    let beat = journal.godot_job_heartbeat(&json!({"jobId":job["jobId"],"token":"token-a"}))?;
    assert!(beat["leaseExpiresAt"].as_i64().unwrap() >= before);
    assert!(claimed["leaseExpiresAt"].as_i64().unwrap() <= before);
    Ok(())
}
