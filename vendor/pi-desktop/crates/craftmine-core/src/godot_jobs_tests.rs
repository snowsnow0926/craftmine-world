use super::*;
use crate::godot_test_support::*;
use std::path::Path;

fn exported_failure(journal: &mut TaskJournal, context: &WorkspaceContext, project: &Value) -> Result<(Value,Value,Value)> {
    register(journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("e"))?;
    let job=start(journal,context,"exported-failure",project,"check")?;
    let owner=claim(journal,&job,"origin-token","executor-a")?;
    let artifacts=write_artifact(&owner,"web/index.html",b"<html>retained</html>")?;
    journal.godot_job_check_descriptor(&json!({"jobId":job["jobId"],"token":"origin-token","artifacts":artifacts}))?;
    let done=finish(journal,&job,"origin-token",&output(&owner,false,json!([{"id":"runtime.not-run","passed":false}]),artifacts.clone(),json!([])))?;
    Ok((done,owner,artifacts))
}

#[test]
fn fresh_export_variants_preserve_old_bytes_and_history_and_can_be_checked_and_applied() -> Result<()> {
    for (changed_toolchain,git_backed) in [(false,false),(true,false),(false,true),(true,true)] {
        let (_dir,path)=temp()?;
        let mut journal=setup(&path)?;
        let context=ctx("one");
        let project=create_project(&mut journal,&context)?;
        let asset=put_asset(&mut journal,&context,"asset-one","hero.png","image/png",b"unchanged asset")?;
        if git_backed {journal.content_migrate_apply(&json!({"worldId":"a"}))?;}
        register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("old engine evidence"))?;
        let old=start(&mut journal,&context,"old-export",&project,"check")?;
        let old_owner=claim(&mut journal,&old,"old-token","executor-a")?;
        let mut old_artifacts=write_artifact(&old_owner,"web/index.html",b"<html>same entry</html>")?;
        old_artifacts.as_array_mut().unwrap().extend(write_artifact(&old_owner,"web/index.pck",b"old nondeterministic pack")?.as_array().unwrap().clone());
        journal.godot_job_check_descriptor(&json!({"jobId":old["jobId"],"token":"old-token","artifacts":old_artifacts}))?;
        finish(&mut journal,&old,"old-token",&output(&old_owner,false,json!([{"id":"runtime.ready","passed":false}]),old_artifacts.clone(),json!([])))?;
        let old_record=read_job(&journal.db,old["jobId"].as_str().unwrap())?;
        let old_root=Path::new(old_owner["projectRoot"].as_str().unwrap()).parent().unwrap();
        let old_manifest=std::fs::read(old_root.join("manifest.json"))?;
        let old_pck=Path::new(old_owner["artifactsRoot"].as_str().unwrap()).join("web/index.pck");
        let old_modified=std::fs::metadata(&old_pck)?.modified()?;
        let before=journal.world_read("a")?;
        if changed_toolchain {
            register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("new engine evidence"))?;
            failed(journal.godot_job_continue(&json!({"context":context,"worldId":"a","originJobId":old["jobId"],"toolCallId":"wrong-toolchain-resume"})),"GODOT_CONTINUATION_TOOLCHAIN_CHANGED");
        }
        assert_eq!(start(&mut journal,&context,"old-export",&project,"check")?,old,"a recorded call keeps its original build across toolchain changes");
        failed(start(&mut journal,&context,"old-export",&project,"build"),"REPLAY_MISMATCH");
        let fresh=start(&mut journal,&context,"explicit-fresh-export",&project,"check")?;
        assert_ne!(fresh["buildId"],old["buildId"]);
        assert_ne!(fresh["jobId"],old["jobId"]);
        if git_backed {
            let content_ref=|build:&Value|->Result<(String,String)>{Ok(journal.db.query_row(
                "SELECT content_oid,asset_lock_hash FROM craftmine_godot_builds WHERE world_id='a' AND build_id=?1",
                [build["buildId"].as_str().unwrap()],|row|Ok((row.get(0)?,row.get(1)?)))?)};
            assert_eq!(content_ref(&old)?,content_ref(&fresh)?,"export variants retain the exact Git commit and asset lock");
        }
        for field in ["sourceRevision","manifestHash","assetManifestHash","baseId","baseBuild","engineVersion","renderer","target"] {
            assert_eq!(fresh[field],old[field],"only the export attempt changes: {field}");
        }
        assert_eq!(start(&mut journal,&context,"explicit-fresh-export",&project,"check")?,fresh);
        let new_owner=claim(&mut journal,&fresh,"fresh-token","executor-a")?;
        assert_ne!(new_owner["artifactsRoot"],old_owner["artifactsRoot"]);
        assert_eq!(new_owner["files"],old_owner["files"]);
        assert_eq!(new_owner["retainedExport"],Value::Null);
        let mut new_artifacts=write_artifact(&new_owner,"web/index.html",b"<html>same entry</html>")?;
        new_artifacts.as_array_mut().unwrap().extend(write_artifact(&new_owner,"web/index.pck",b"new nondeterministic pack")?.as_array().unwrap().clone());
        let descriptor=journal.godot_job_check_descriptor(&json!({"jobId":fresh["jobId"],"token":"fresh-token","artifacts":new_artifacts}))?;
        assert_eq!(descriptor["buildId"],fresh["buildId"]);
        assert_eq!(descriptor["artifacts"],new_artifacts);
        let checked=finish(&mut journal,&fresh,"fresh-token",&output(&new_owner,true,json!([{"id":"runtime.ready","passed":true}]),new_artifacts,json!([])))?;
        assert_eq!(checked["status"],"passed");
        assert_eq!(journal.world_read("a")?,before);
        let candidate=journal.godot_candidate_read(&json!({"context":context,"worldId":"a","candidateId":checked["candidateId"]}))?;
        assert_eq!(candidate["candidate"]["buildId"],fresh["buildId"]);
        let prepared=journal.godot_application_prepare(&json!({"id":"apply-fresh","token":"apply-token","candidateId":checked["candidateId"],
            "worldId":"a","revision":before.summary.revision,"snapshot":before.world.snapshot}))?;
        // Fixture launch evidence exercises the real native commit boundary; no
        // engine process or renderer is launched by this Rust integration test.
        let applied=journal.godot_application_commit(&json!({"id":"apply-fresh","token":"apply-token","evidence":{
            "format":"craftmine.godot-application/1","inputHash":prepared["inputHash"],
            "launch":{"passed":true,"buildId":fresh["buildId"],"instanceId":"fresh-instance","stateHash":digest("launched-state")},
            "player":before.world.snapshot["player"]}}))?;
        assert_eq!(applied["status"],"applied");
        assert_eq!(journal.world_read("a")?.world.build["id"],fresh["buildId"]);
        assert_eq!(journal.world_read("a")?.world.snapshot,before.world.snapshot);
        assert_eq!(std::fs::read(&old_pck)?,b"old nondeterministic pack");
        assert_eq!(std::fs::metadata(&old_pck)?.modified()?,old_modified);
        assert_eq!(std::fs::read(old_root.join("manifest.json"))?,old_manifest);
        assert_eq!(read_job(&journal.db,old["jobId"].as_str().unwrap())?,old_record);
        assert_eq!(std::fs::read(Path::new(new_owner["projectRoot"].as_str().unwrap()).join(asset["path"].as_str().unwrap()))?,b"unchanged asset");
        drop(journal);
        let journal=TaskJournal::open(&path)?;
        assert_eq!(journal.world_read("a")?.world.build["id"],fresh["buildId"]);
        assert_eq!(read_job(&journal.db,old["jobId"].as_str().unwrap())?,old_record);
        assert_eq!(read_job(&journal.db,fresh["jobId"].as_str().unwrap())?["status"],"passed");
    }
    Ok(())
}

#[test]
fn exported_failed_check_continuation_gets_verified_native_authority_and_a_new_descriptor() -> Result<()> {
    let (_dir,path)=temp()?;let mut journal=setup(&path)?;let context=ctx("one");let project=create_project(&mut journal,&context)?;
    let (origin,owner,artifacts)=exported_failure(&mut journal,&context,&project)?;
    let original=origin.clone();
    let next=journal.godot_job_continue(&json!({"context":context,"worldId":"a","originJobId":origin["jobId"],"toolCallId":"resume-export"}))?;
    let claimed=claim(&mut journal,&next,"new-token","executor-a")?;
    assert_eq!(claimed["retainedExport"]["originOutputHash"],origin["outputHash"]);
    assert_eq!(claimed["retainedExport"]["artifacts"],artifacts);
    assert_eq!(claimed["buildId"],origin["buildId"]);assert_ne!(claimed["inputHash"],owner["inputHash"]);
    // An origin's descriptor is never sufficient to finish the new check.
    failed(finish(&mut journal,&next,"new-token",&output(&claimed,true,json!([{"id":"runtime.ready","passed":true}]),artifacts.clone(),json!([]))),"GODOT_CHECK_INPUT");
    let mut foreign_artifacts=artifacts.clone();foreign_artifacts[0]["sha256"]=json!(digest("foreign"));
    failed(journal.godot_job_check_descriptor(&json!({"jobId":next["jobId"],"token":"new-token","artifacts":foreign_artifacts})),"GODOT_CONTINUATION_ARTIFACT_MISMATCH");
    let descriptor=journal.godot_job_check_descriptor(&json!({"jobId":next["jobId"],"token":"new-token","artifacts":artifacts}))?;
    assert_eq!(descriptor["jobId"],next["jobId"]);assert_eq!(descriptor["inputHash"],claimed["inputHash"]);
    let done=finish(&mut journal,&next,"new-token",&output(&claimed,true,json!([{"id":"runtime.ready","passed":true}]),artifacts,json!([])))?;
    assert_eq!(done["status"],"passed");assert_ne!(done["candidateId"],origin["candidateId"]);
    assert_eq!(journal.godot_build_read(&json!({"worldId":"a","jobId":origin["jobId"]}))?["output"],original["output"]);
    assert_eq!(read_job(&journal.db,origin["jobId"].as_str().unwrap())?["outputHash"],original["outputHash"]);
    Ok(())
}

#[test]
fn retained_export_cannot_cross_sessions_or_outlive_its_executor_lease() -> Result<()> {
    for foreign_session in [true,false] {
        let (_dir,path)=temp()?;let mut journal=setup(&path)?;let context=ctx("one");let project=create_project(&mut journal,&context)?;
        let (origin,_owner,artifacts)=exported_failure(&mut journal,&context,&project)?;
        if foreign_session {
            journal.workspace_end_turn(&context.session_id,&context.turn_id,"completed")?;
            let foreign=WorkspaceContext {session_id:"other-session".into(),..ctx("two")};
            journal.workspace_open(&foreign,"a")?;
            failed(journal.godot_job_continue(&json!({"context":foreign,"worldId":"a","originJobId":origin["jobId"],"toolCallId":"foreign-resume"})),"GODOT_CONTINUATION_SCOPE_MISMATCH");
        } else {
            let next=journal.godot_job_continue(&json!({"context":context,"worldId":"a","originJobId":origin["jobId"],"toolCallId":"resume-export"}))?;
            claim(&mut journal,&next,"new-token","executor-a")?;
            journal.godot_executor_revoke(&json!({"executorId":"executor-a"}))?;
            failed(journal.godot_job_check_descriptor(&json!({"jobId":next["jobId"],"token":"new-token","artifacts":artifacts})),"GODOT_JOB_OWNER_MISMATCH");
        }
        assert_eq!(read_job(&journal.db,origin["jobId"].as_str().unwrap())?["outputHash"],origin["outputHash"]);
    }
    Ok(())
}

#[test]
fn retained_export_rejects_changed_toolchain_corruption_and_stale_queued_source() -> Result<()> {
    for fault in ["toolchain","tamper","missing","stale","after-claim"] {
        let (_dir,path)=temp()?;let mut journal=setup(&path)?;let context=ctx("one");let project=create_project(&mut journal,&context)?;
        let (origin,owner,artifacts)=exported_failure(&mut journal,&context,&project)?;
        let args=json!({"context":context,"worldId":"a","originJobId":origin["jobId"],"toolCallId":"resume-export"});
        let file=Path::new(owner["artifactsRoot"].as_str().unwrap()).join("web/index.html");
        match fault {
            "toolchain"=>{register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("changed"))?;failed(journal.godot_job_continue(&args),"GODOT_CONTINUATION_TOOLCHAIN_CHANGED");},
            "tamper"=>{std::fs::write(&file,b"changed")?;failed(journal.godot_job_continue(&args),"CORRUPT_GODOT_ARTIFACT");assert_eq!(std::fs::read(&file)?,b"changed");},
            "missing"=>{std::fs::remove_file(&file)?;assert!(journal.godot_job_continue(&args).is_err());assert!(!file.exists());},
            "stale"=>{let next=journal.godot_job_continue(&args)?;journal.godot_project_patch(&json!({"context":context,"worldId":"a","toolCallId":"changed-head","revision":project["revision"],"manifestHash":project["manifestHash"],"operations":[{"op":"put","path":"new.gd","text":"extends Node\n","expectedHash":null}]}))?;failed(claim(&mut journal,&next,"new-token","executor-a"),"GODOT_CONTINUATION_STALE");},
            _=>{let next=journal.godot_job_continue(&args)?;claim(&mut journal,&next,"new-token","executor-a")?;std::fs::write(&file,b"changed")?;failed(journal.godot_job_check_descriptor(&json!({"jobId":next["jobId"],"token":"new-token","artifacts":artifacts})),"CORRUPT_GODOT_ARTIFACT");}
        }
        assert_eq!(read_job(&journal.db,origin["jobId"].as_str().unwrap())?["outputHash"],origin["outputHash"]);
    }
    Ok(())
}

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

/// A continued check reuses its origin's identical bytes, and a result
/// that claims different bytes for an already recorded path is refused without
/// replacing the first evidence.
#[test]
fn a_continued_check_reuses_recorded_artifacts_and_refuses_a_changed_one() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    let (first, checked) = run_check(&mut journal, &context, &project, "check-one", false)?;
    assert_eq!(checked["status"], "failed");
    let build = first["buildId"].as_str().unwrap().to_string();
    let root = build_root(&journal.directory, "a", &build, false)?.join("artifacts");
    let recorded = build_files(&journal.db, "a", &build, "artifact")?;
    assert_eq!(recorded.len(), 1);
    let original = recorded[0].clone();
    // Explicit continuation retains this exact export and receives a new check
    // descriptor. A fresh full export instead has its own build identity.
    let second = journal.godot_job_continue(&json!({"context":context,"worldId":"a","originJobId":first["jobId"],"toolCallId":"check-two"}))?;
    assert_eq!(second["buildId"], first["buildId"], "continuation keeps the origin's build identity");
    let claimed = claim(&mut journal, &second, "token-b", "executor-a")?;
    let identical = claimed["retainedExport"]["artifacts"].clone();
    journal.godot_job_check_descriptor(&json!({"jobId":second["jobId"],"token":"token-b","artifacts":identical}))?;
    let repeated = finish(&mut journal, &second, "token-b",
        &output(&claimed, true, json!([{"id":"runtime.ready","passed":true}]), identical, json!([])))?;
    assert_eq!(repeated["status"], "passed");
    assert_eq!(build_files(&journal.db, "a", &build, "artifact")?, vec![original.clone()]);
    // The artifact registry still cannot change a hash under the same build.
    failed(record_artifact(&journal.db,"a",&build,&Artifact{path:"web/index.html".into(),
        sha256:digest("a different export"),bytes:18}),"GODOT_ARTIFACT_CONFLICT");
    assert_eq!(build_files(&journal.db, "a", &build, "artifact")?, vec![original.clone()]);
    // No write was necessary: the original evidence still serves unchanged.
    let served = verified_artifacts(&journal.db, "a", &build, &root)?;
    assert_eq!(served.len(), 1);
    assert_eq!(served[0]["sha256"], original["sha256"]);
    Ok(())
}

#[test]
fn latest_world_job_is_filtered_by_the_host_session_without_starting_a_task() -> Result<()> {
    let (_dir,path)=temp()?;let mut journal=setup(&path)?;let context=ctx("one");
    assert!(journal.godot_build_latest(&json!({"worldId":"a","sessionId":context.session_id}))?.is_null());
    let project=create_project(&mut journal,&context)?;
    register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("e"))?;
    let job=start(&mut journal,&context,"latest-check",&project,"check")?;
    assert_eq!(journal.godot_build_latest(&json!({"worldId":"a","sessionId":context.session_id}))?["jobId"],job["jobId"]);
    assert!(journal.godot_build_latest(&json!({"worldId":"a","sessionId":"other-session"}))?.is_null());
    assert!(journal.godot_build_latest(&json!({"worldId":"b","sessionId":context.session_id}))?.is_null());
    // Reopening the session after selecting another world recovers its exact job.
    assert_eq!(journal.godot_build_latest(&json!({"sessionId":context.session_id}))?["jobId"],job["jobId"]);
    assert!(journal.godot_build_latest(&json!({"sessionId":"other-session"}))?.is_null());
    assert!(journal.godot_build_latest(&json!({})).is_err());
    assert!(journal.godot_build_latest(&json!({"sessionId":""})).is_err());
    Ok(())
}
