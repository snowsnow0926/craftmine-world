//! Real SQLite/core/filesystem tests with authored executor evidence. No engine
//! is launched here; native observation is tested by the isolated verifier.
use super::*;
use crate::godot_test_support::*;

fn requirement() -> Value {
    json!({"format":requirements::FORMAT,"targetFeedback":{"targetId":"target_a","hitFlashMilliseconds":500}})
}

fn request(project: &Value, call: &str) -> Value {
    json!({"context":ctx("one"),"worldId":"a","toolCallId":call,"revision":project["revision"],
        "manifestHash":project["manifestHash"],"mode":"check","checkRequirements":requirement()})
}

fn ready(journal: &mut TaskJournal) -> Result<(Value, Value, Value)> {
    let project = create_project(journal, &ctx("one"))?;
    register(journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("e"))?;
    let job = journal.godot_build_start(&request(&project,"check-one"))?;
    let claimed = claim(journal,&job,"token-a","executor-a")?;
    let artifacts = write_artifact(&claimed,"web/index.html",b"<html>authored check fixture</html>")?;
    let descriptor = journal.godot_job_check_descriptor(&json!({"jobId":job["jobId"],"token":"token-a","artifacts":artifacts}))?;
    let mut result = output(&claimed,true,json!([{"id":"runtime.target-feedback","passed":true}]),artifacts,json!([]));
    result["check"]["requirementsEvidence"] = json!({"format":"craftmine.godot-check-requirements-evidence/1",
        "requirementsHash":claimed["checkRequirementsHash"],"jobId":job["jobId"],"worldId":"a",
        "buildId":job["buildId"],"instanceId":"runtime-one","observations":[
            {"phase":"loaded","targetId":"target_a","hitFlashMilliseconds":500.0},
            {"phase":"running","targetId":"target_a","hitFlashMilliseconds":500.0}]});
    assert_eq!(claimed["checkRequirements"], requirement());
    assert_eq!(descriptor["checkRequirements"], requirement());
    assert_eq!(descriptor["checkRequirementsHash"], claimed["checkRequirementsHash"]);
    Ok((job,result,descriptor))
}

#[test]
fn finite_requirements_validate_scope_hash_and_start_replay() -> Result<()> {
    let (_dir,path) = temp()?;
    let mut journal = setup(&path)?;
    let project = create_project(&mut journal,&ctx("one"))?;
    let args = request(&project,"check-one");
    let job = journal.godot_build_start(&args)?;
    assert_eq!(job["checkRequirementsHash"],digest("craftmine.godot-check-requirements/1\ntarget_a\n500\n"));
    let replay = journal.godot_build_start(&args)?;
    assert_eq!(job["jobId"],replay["jobId"]);
    let mut changed = args.clone();
    changed["checkRequirements"]["targetFeedback"]["hitFlashMilliseconds"] = json!(700);
    failed(journal.godot_build_start(&changed),"REPLAY_MISMATCH");
    for value in [json!(0),json!(1001),json!(1.5),json!("500"),json!(-1)] {
        changed["checkRequirements"]["targetFeedback"]["hitFlashMilliseconds"] = value;
        assert!(journal.godot_build_start(&changed).is_err());
    }
    for target in ["", "a\nb", "target/a", "目标"] {
        changed = args.clone();
        changed["checkRequirements"]["targetFeedback"]["targetId"] = json!(target);
        assert!(journal.godot_build_start(&changed).is_err());
    }
    changed = args.clone(); changed["checkRequirements"]["unknown"] = json!(true);
    assert!(journal.godot_build_start(&changed).is_err());
    changed = args.clone(); changed["mode"] = json!("build");
    failed(journal.godot_build_start(&changed),"GODOT_CHECK_REQUIREMENTS_SCOPE");
    let requirements: requirements::Requirements = serde_json::from_value(requirement())?;
    failed(requirements.validate("top-down","check"),"GODOT_CHECK_REQUIREMENTS_SCOPE");
    let legacy = start(&mut journal,&ctx("one"),"legacy",&project,"check")?;
    assert!(legacy.get("checkRequirements").is_none());
    assert!(legacy.get("checkRequirementsHash").is_none());
    Ok(())
}

#[test]
fn finite_requirements_actual_match_passes_and_survives_restart_replay() -> Result<()> {
    let (_dir,path) = temp()?;
    let mut journal = setup(&path)?;
    let (job,result,descriptor) = ready(&mut journal)?;
    let checked = finish(&mut journal,&job,"token-a",&result)?;
    assert_eq!(checked["status"],"passed");
    assert_eq!(checked["output"]["check"]["requirementsEvidence"],result["check"]["requirementsEvidence"]);
    drop(journal);
    let mut journal = TaskJournal::open(&path)?;
    assert_eq!(check_input(&journal.db,job["jobId"].as_str().unwrap())?,descriptor);
    assert_eq!(finish(&mut journal,&job,"token-a",&result)?,checked);
    let candidate = journal.godot_candidate_read(&json!({"worldId":"a","candidateId":checked["candidateId"]}))?;
    assert_eq!(candidate["candidate"]["status"],"ready");
    println!("{}",json!({"evidenceType":"real-core-authored-executor","case":"match-after-restart","jobId":checked["jobId"],"status":checked["status"],"candidate":candidate["candidate"]["status"],"checkRequirementsHash":checked["checkRequirementsHash"],"check":checked["output"]["check"]}));
    Ok(())
}

#[test]
fn finite_requirements_missing_false_or_mixed_evidence_rejects_candidate_durably() -> Result<()> {
    for case in ["missing", "wrong-hash", "wrong-job", "wrong-world", "wrong-build", "wrong-instance",
        "loaded-700", "running-700", "wrong-target", "partial", "reordered", "unknown-field",
        "missing-assertion", "false-assertion", "duplicate-assertion", "no-descriptor"] {
        let (_dir,path) = temp()?;
        let mut journal = setup(&path)?;
        let (job,mut result,_) = ready(&mut journal)?;
        let evidence = &mut result["check"]["requirementsEvidence"];
        match case {
            "missing" => {result["check"].as_object_mut().unwrap().remove("requirementsEvidence");},
            "wrong-hash" => evidence["requirementsHash"] = json!(digest("wrong")),
            "wrong-job" => evidence["jobId"] = json!("other-job"),
            "wrong-world" => evidence["worldId"] = json!("b"),
            "wrong-build" => evidence["buildId"] = json!("other-build"),
            "wrong-instance" => evidence["instanceId"] = json!(""),
            "loaded-700" => evidence["observations"][0]["hitFlashMilliseconds"] = json!(700),
            "running-700" => evidence["observations"][1]["hitFlashMilliseconds"] = json!(700),
            "wrong-target" => evidence["observations"][1]["targetId"] = json!("target_b"),
            "partial" => {evidence["observations"].as_array_mut().unwrap().pop();},
            "reordered" => evidence["observations"].as_array_mut().unwrap().swap(0,1),
            "unknown-field" => evidence["expectedInsteadOfObserved"] = json!(true),
            "missing-assertion" => result["check"]["assertions"] = json!([]),
            "false-assertion" => result["check"]["assertions"][0]["passed"] = json!(false),
            "duplicate-assertion" => result["check"]["assertions"].as_array_mut().unwrap().push(json!({"id":"runtime.target-feedback","passed":true})),
            "no-descriptor" => {journal.db.execute("UPDATE craftmine_godot_jobs SET check_input=NULL,check_input_hash=NULL WHERE id=?1",[job["jobId"].as_str().unwrap()])?;},
            _ => unreachable!(),
        }
        let checked = finish(&mut journal,&job,"token-a",&result)?;
        assert_eq!(checked["status"],"failed","{case}");
        assert_eq!(checked["output"]["passed"],false,"{case}");
        assert_eq!(finish(&mut journal,&job,"token-a",&result)?,checked,"{case}");
        let candidate = journal.godot_candidate_read(&json!({"worldId":"a","candidateId":checked["candidateId"]}))?;
        assert_eq!(candidate["candidate"]["status"],"rejected","{case}");
        println!("{}",json!({"evidenceType":"real-core-authored-executor","case":case,"jobId":checked["jobId"],"status":checked["status"],"candidate":candidate["candidate"]["status"],"checkRequirementsHash":checked["checkRequirementsHash"],"check":checked["output"]["check"]}));
        failed(journal.godot_application_prepare(&json!({"id":"apply-one","token":"apply-token",
            "candidateId":checked["candidateId"],"worldId":"a","revision":0,"snapshot":world().snapshot})),"GODOT_CANDIDATE_NOT_READY");
        assert_eq!(journal.world_read("a")?.world.snapshot,world().snapshot);
    }
    Ok(())
}

#[test]
fn finite_requirements_continue_preserves_expectations_and_corrupt_pair_is_refused() -> Result<()> {
    let (_dir,path) = temp()?;
    let mut journal = setup(&path)?;
    let (job,mut result,_) = ready(&mut journal)?;
    result["check"].as_object_mut().unwrap().remove("requirementsEvidence");
    finish(&mut journal,&job,"token-a",&result)?;
    let args = json!({"context":ctx("one"),"worldId":"a","toolCallId":"continue-one","originJobId":job["jobId"]});
    let continued = journal.godot_job_continue(&args)?;
    assert_eq!(continued["checkRequirements"],requirement());
    assert_eq!(continued["checkRequirementsHash"],job["checkRequirementsHash"]);
    assert_ne!(continued["jobId"],job["jobId"]);
    assert_eq!(journal.godot_job_continue(&args)?["jobId"],continued["jobId"]);
    journal.db.execute("UPDATE craftmine_godot_jobs SET check_requirements_hash=NULL WHERE id=?1",[continued["jobId"].as_str().unwrap()])?;
    failed(read_job(&journal.db,continued["jobId"].as_str().unwrap()),"GODOT_CHECK_REQUIREMENTS_CORRUPT");
    Ok(())
}

#[test]
fn finite_requirements_bound_tolerance_keeps_raw_actual_and_old_backup_columns_default_to_none() -> Result<()> {
    let (_dir,path) = temp()?;
    let mut journal = setup(&path)?;
    let (job,mut result,_) = ready(&mut journal)?;
    result["check"]["requirementsEvidence"]["observations"][1]["hitFlashMilliseconds"] = json!(500.0000001);
    let checked = finish(&mut journal,&job,"token-a",&result)?;
    assert_eq!(checked["status"],"passed");
    assert_eq!(checked["output"]["check"]["requirementsEvidence"]["observations"][1]["hitFlashMilliseconds"],json!(500.0000001));
    for column in ["check_requirements","check_requirements_hash"] {
        assert_eq!(crate::backups::additive_column_default("craftmine_godot_jobs",column),Some(Value::Null));
    }
    Ok(())
}
