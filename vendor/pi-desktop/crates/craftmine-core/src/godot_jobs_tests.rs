use super::*;
use crate::godot_test_support::*;
use std::path::Path;

#[test]
fn runtime_check_descriptor_requires_a_live_owner_and_verified_staged_bytes() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "check-preview", &project, "check")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    let files = write_artifact(&claimed, "web/index.html", b"<html>staged</html>")?;
    let args = json!({"jobId":job["jobId"],"token":"token-a","artifacts":files});
    let result = journal.godot_job_check_descriptor(&args)?;
    assert_eq!(result["phase"], "check");
    assert_eq!(result["inputHash"], claimed["inputHash"]);
    assert_eq!(result["root"], claimed["artifactsRoot"]);
    assert!(result["snapshot"].is_null());
    // A descriptor is private inspection input; it never registers a candidate.
    assert!(journal.godot_candidate_list(&json!({"worldId":"a"}))?["items"].as_array().unwrap().is_empty());
    let mut foreign = args.clone();
    foreign["token"] = json!("token-b");
    failed(journal.godot_job_check_descriptor(&foreign), "GODOT_JOB_OWNER_MISMATCH");
    let mut duplicate = args.clone();
    duplicate["artifacts"].as_array_mut().unwrap().push(files[0].clone());
    failed(journal.godot_job_check_descriptor(&duplicate), "GODOT_ARTIFACT_CONFLICT");
    std::fs::write(Path::new(claimed["artifactsRoot"].as_str().unwrap()).join("web/index.html"), b"<html>changed</html>")?;
    failed(journal.godot_job_check_descriptor(&args), "CORRUPT_GODOT_ARTIFACT");
    journal.godot_executor_revoke(&json!({"executorId":"executor-a"}))?;
    assert_eq!(journal.godot_executor_status()["build"], false);
    assert_eq!(journal.godot_build_read(&json!({"worldId":"a","jobId":job["jobId"]}))?["status"], "interrupted");
    failed(journal.godot_job_check_descriptor(&args), "GODOT_JOB_OWNER_MISMATCH");
    Ok(())
}

#[test]
fn executor_gate_finds_a_capable_executor_and_revocation_interrupts_only_its_jobs() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    register(&mut journal, "build-only", json!({"import":true,"build":true,"check":false}), &digest("a"))?;
    assert_eq!(journal.godot_executor_status()["check"], false);
    register(&mut journal, "checks", json!({"import":true,"build":true,"check":true}), &digest("b"))?;
    assert_eq!(journal.godot_executor_status()["check"], true);
    let job = start(&mut journal, &context, "check-revoke", &project, "check")?;
    claim(&mut journal, &job, "owner", "checks")?;
    assert_eq!(journal.godot_executor_revoke(&json!({"executorId":"build-only"}))?["interrupted"], 0);
    assert_eq!(journal.godot_executor_status()["check"], true);
    assert_eq!(journal.godot_executor_revoke(&json!({"executorId":"checks"}))?["interrupted"], 1);
    assert_eq!(journal.godot_build_read(&json!({"worldId":"a","jobId":job["jobId"]}))?["status"], "interrupted");
    assert_eq!(journal.godot_build_read(&json!({"worldId":"a","jobId":job["jobId"]}))?["interruptReason"], "GODOT_EXECUTOR_REVOKED");
    failed(journal.godot_job_heartbeat(&json!({"jobId":job["jobId"],"token":"owner"})), "GODOT_JOB_OWNER_MISMATCH");
    Ok(())
}

#[test]
fn a_continuation_keeps_its_origin_and_refuses_a_moved_source() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "check-origin", &project, "check")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    // The executor died: the lease expires and the job says why.
    journal.db.execute(
        "UPDATE craftmine_godot_jobs SET lease_expires_at=1 WHERE id=?1",
        [job["jobId"].as_str().unwrap()],
    )?;
    let expired = journal.godot_build_read(&json!({"worldId":"a","jobId":job["jobId"]}))?;
    assert_eq!(expired["status"], "interrupted");
    assert_eq!(expired["interruptReason"], "GODOT_LEASE_EXPIRED");
    // A late result from the dead executor can never revive the job.
    let artifacts = write_artifact(&claimed, "web/index.html", b"<html></html>")?;
    failed(
        finish(&mut journal, &job, "token-a", &output(&claimed, true, json!([{"id":"x","passed":true}]), artifacts, json!([]))),
        "GODOT_JOB_INACTIVE",
    );
    // The saved draft continues as a new execution with a recorded origin.
    let args = json!({"context":&context,"worldId":"a","toolCallId":"continue-one","originJobId":job["jobId"]});
    let continued = journal.godot_job_continue(&args)?;
    assert_eq!(continued["originJobId"], job["jobId"]);
    assert_eq!(continued["buildId"], job["buildId"]);
    assert_eq!(continued["status"], "queued");
    assert_eq!(continued["replayed"], false);
    let replay = journal.godot_job_continue(&args)?;
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["jobId"], continued["jobId"]);
    // Once the source moved, the old draft is a conflict, never a silent rebase.
    journal.godot_project_patch(&json!({"context":&context,"worldId":"a","toolCallId":"patch-one",
        "revision":project["revision"],"manifestHash":project["manifestHash"],
        "operations":[{"op":"put","path":"continued.gd","text":"extends Node\n","expectedHash":null}]}))?;
    failed(
        journal.godot_job_continue(&json!({"context":&context,"worldId":"a","toolCallId":"continue-two",
            "originJobId":job["jobId"]})),
        "GODOT_CONTINUATION_STALE",
    );
    // A job that already succeeded is not a continuable draft.
    let head = journal.godot_project_index(&json!({"context":&context,"worldId":"a"}))?;
    let (done, _) = run_check(&mut journal, &context, &head, "check-two", true)?;
    failed(
        journal.godot_job_continue(&json!({"context":&context,"worldId":"a","toolCallId":"continue-three",
            "originJobId":done["jobId"]})),
        "GODOT_JOB_NOT_CONTINUABLE",
    );
    Ok(())
}

#[test]
fn usage_summary_reports_core_counters_and_keeps_model_counters_unknown() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    let (job, checked) = run_check(&mut journal, &context, &project, "check-one", true)?;
    assert_eq!(checked["status"], "passed");
    let usage = journal.godot_usage_summary(&json!({"worldId":"a","context":&context}))?;
    assert_eq!(usage["format"], "craftmine.godot-usage/1");
    assert_eq!(usage["items"].as_array().unwrap().len(), 1);
    assert_eq!(usage["items"][0]["jobId"], job["jobId"]);
    assert_eq!(usage["items"][0]["outcome"], "passed");
    assert_eq!(usage["items"][0]["artifactBytes"], 13);
    assert_eq!(usage["items"][0]["originJobId"], Value::Null);
    assert!(usage["items"][0]["hostBytes"].as_i64().unwrap() > 0);
    assert_eq!(usage["totals"]["executions"], 1);
    assert_eq!(usage["totals"]["artifactBytes"], 13);
    assert_eq!(
        usage["unknown"],
        json!(["modelTokens", "modelRequests", "compactions", "contextTokens", "serviceQuota"])
    );
    assert_eq!(usage["limits"]["unknown"], usage["unknown"]);
    assert_eq!(usage["limits"]["buildFileCount"], 4096);
    // Repeating the sweep cannot double count.
    assert_eq!(journal.godot_usage_summary(&json!({"worldId":"a","context":&context}))?, usage);
    Ok(())
}

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
    assert_eq!(std::fs::read_to_string(Path::new(claimed["projectRoot"].as_str().unwrap()).join("project.godot"))?, PROJECT);
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

#[test]
fn engine_sized_artifacts_are_streamed_and_corruption_is_refused() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "large-export", &created, "build")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    // Actual size observed for the pinned Godot Web engine, beyond both old 4 MiB limits.
    let bytes = vec![0x5au8; 39_514_754];
    let artifact = write_artifact(&claimed, "web/index.wasm", &bytes)?;
    let file = Path::new(claimed["artifactsRoot"].as_str().unwrap()).join("web/index.wasm");
    { use std::io::Write; std::fs::OpenOptions::new().write(true).open(&file)?.write_all(b"changed")?; }
    failed(finish(&mut journal, &job, "token-a", &output(&claimed, true, json!([]), artifact.clone(), json!([]))), "CORRUPT_GODOT_ARTIFACT");
    std::fs::write(&file, &bytes)?;
    let finished = finish(&mut journal, &job, "token-a", &output(&claimed, true, json!([]), artifact, json!([])))?;
    assert_eq!(finished["status"], "passed");
    assert_eq!(finished["output"]["artifacts"][0]["bytes"], 39_514_754);
    let oversized = Artifact { path:"web/huge.wasm".into(), sha256:digest("x"), bytes:ARTIFACT_FILE_BYTES + 1 };
    failed(verify_artifact(Path::new(claimed["artifactsRoot"].as_str().unwrap()), &oversized), "GODOT_ARTIFACT_TOO_LARGE");
    Ok(())
}

#[test]
fn claim_rechecks_materialized_source_before_granting_a_job() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "build-one", &created, "build")?;
    let root = build_root(&journal.directory, "a", job["buildId"].as_str().unwrap(), false)?;
    std::fs::write(root.join("source/world.gd"), b"corrupt materialized source")?;
    failed(claim(&mut journal, &job, "token-a", "executor-a"), "CORRUPT_GODOT_BUILD");
    assert_eq!(read_job(&journal.db, job["jobId"].as_str().unwrap())?["status"], "queued");
    Ok(())
}

/// A refused result must not settle the job, and the executor's explicit
/// no-artifact failure is what a model can actually read. This drives the real
/// core, not a ledger stand-in.
#[test]
fn a_refused_result_is_settled_as_a_failure_without_touching_staged_artifacts() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = start(&mut journal, &context, "check-refused", &project, "check")?;
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    let artifacts = write_artifact(&claimed, "web/index.html", b"<html>staged</html>")?;
    let build = job["buildId"].as_str().unwrap().to_string();
    let staged = Path::new(claimed["artifactsRoot"].as_str().unwrap()).join("web/index.html");
    // The same path claimed twice is the shape the recorded real run hit: the
    // core refuses the whole result and records nothing.
    let mut duplicated = artifacts.clone();
    duplicated.as_array_mut().unwrap().push(artifacts[0].clone());
    failed(
        finish(&mut journal, &job, "token-a",
            &output(&claimed, true, json!([{"id":"runtime.ready","passed":true}]), duplicated, json!([]))),
        "GODOT_ARTIFACT_CONFLICT",
    );
    let active = journal.godot_build_read(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?;
    assert!(
        matches!(active["status"].as_str(), Some("claimed" | "running")),
        "a refused result leaves the lease active, so the failure has to be submitted explicitly: {active}"
    );
    assert!(active["output"].is_null());
    assert!(build_files(&journal.db, "a", &build, "artifact")?.is_empty());
    assert_eq!(std::fs::read(&staged)?, b"<html>staged</html>");
    // The settlement the executor submits after a refusal: a real failure that
    // claims no artifacts and keeps the refusal as its own evidence.
    let reason = "GODOT_ARTIFACT_CONFLICT";
    let settlement = json!({"format":"craftmine.godot-job-result/1","inputHash":claimed["inputHash"],"passed":false,
        "import":{"passed":false,"log":""},
        "compile":{"passed":false,"errors":[reason],"warnings":[]},
        "check":{"passed":false,"assertions":[{"id":"executor.finish-refused","passed":false,"detail":reason}]},
        "artifacts":[],
        "engine":{"version":"4.7.2-stable","isolation":"appcontainer","evidenceHash":claimed["evidenceHash"]}});
    let settled = finish(&mut journal, &job, "token-a", &settlement)?;
    assert_eq!(settled["status"], "failed");
    let read = journal.godot_build_read(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?;
    assert_eq!(read["status"], "failed");
    assert_eq!(read["stage"], "failed");
    assert!(read["leaseExpiresAt"].is_null(), "a settled job holds no lease: {read}");
    assert_eq!(read["output"]["compile"]["errors"][0], reason);
    assert_eq!(read["output"]["check"]["assertions"][0]["detail"], reason);
    assert!(read["output"]["artifacts"].as_array().unwrap().is_empty());
    assert!(build_files(&journal.db, "a", &build, "artifact")?.is_empty());
    // Bytes the engine already staged are never removed by the settlement.
    assert_eq!(std::fs::read(&staged)?, b"<html>staged</html>");
    // A late different result can never overwrite the confirmed failure, and
    // replaying the exact settlement is idempotent.
    failed(
        finish(&mut journal, &job, "token-a",
            &output(&claimed, true, json!([{"id":"runtime.ready","passed":true}]), artifacts, json!([]))),
        "REPLAY_MISMATCH",
    );
    assert_eq!(finish(&mut journal, &job, "token-a", &settlement)?["status"], "failed");
    assert_eq!(journal.godot_build_read(&json!({"context":&context,"worldId":"a","jobId":job["jobId"]}))?["status"], "failed");
    Ok(())
}

/// A repeated check of the same source reuses identical bytes, and a result
/// that claims different bytes for an already recorded path is refused without
/// replacing the first evidence.
#[test]
fn a_repeated_check_reuses_recorded_artifacts_and_refuses_a_changed_one() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    let (first, checked) = run_check(&mut journal, &context, &project, "check-one", true)?;
    assert_eq!(checked["status"], "passed");
    let build = first["buildId"].as_str().unwrap().to_string();
    let root = build_root(&journal.directory, "a", &build, false)?.join("artifacts");
    let recorded = build_files(&journal.db, "a", &build, "artifact")?;
    assert_eq!(recorded.len(), 1);
    let original = recorded[0].clone();
    // Same source, same build identity: the identical bytes are reused and the
    // repeated result is accepted.
    let second = start(&mut journal, &context, "check-two", &project, "check")?;
    assert_eq!(second["buildId"], first["buildId"], "the same source keeps its build identity");
    let claimed = claim(&mut journal, &second, "token-b", "executor-a")?;
    let identical = write_artifact(&claimed, "web/index.html", b"<html></html>")?;
    let repeated = finish(&mut journal, &second, "token-b",
        &output(&claimed, true, json!([{"id":"runtime.ready","passed":true}]), identical, json!([])))?;
    assert_eq!(repeated["status"], "passed");
    assert_eq!(build_files(&journal.db, "a", &build, "artifact")?, vec![original.clone()]);
    // Different bytes for an already recorded path are a conflict: the job stays
    // unsettled and the recorded evidence keeps the first hash.
    let third = start(&mut journal, &context, "check-three", &project, "check")?;
    let claimed = claim(&mut journal, &third, "token-c", "executor-a")?;
    let changed = write_artifact(&claimed, "web/index.html", b"<html>a different build produced this</html>")?;
    assert_ne!(changed[0]["sha256"], original["sha256"]);
    failed(
        finish(&mut journal, &third, "token-c",
            &output(&claimed, true, json!([{"id":"runtime.ready","passed":true}]), changed, json!([]))),
        "GODOT_ARTIFACT_CONFLICT",
    );
    assert_eq!(read_job(&journal.db, third["jobId"].as_str().unwrap())?["status"], "claimed");
    assert_eq!(build_files(&journal.db, "a", &build, "artifact")?, vec![original.clone()]);
    // With the verified bytes back in place the build still serves the first
    // evidence, so the refusal left nothing behind.
    std::fs::write(root.join("web/index.html"), b"<html></html>")?;
    let served = verified_artifacts(&journal.db, "a", &build, &root)?;
    assert_eq!(served.len(), 1);
    assert_eq!(served[0]["sha256"], original["sha256"]);
    Ok(())
}
