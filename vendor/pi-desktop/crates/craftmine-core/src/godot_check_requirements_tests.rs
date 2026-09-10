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

#[test]
fn creation_requirements_bind_persist_and_reject_wrong_runtime_entities() -> Result<()> {
 let (_dir,path)=temp()?;let mut journal=setup(&path)?;
 let project=journal.godot_project_create(&json!({"context":ctx("one"),"worldId":"a","toolCallId":"creation","baseBuild":"base-a","baseId":"creation-sandbox","files":project_files()}))?;
 register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("e"))?;
 let requirement=json!({"format":requirements::FORMAT,"creation":{"format":"craftmine.creation-requirements/1","requestHash":digest("double tree"),"entities":[{"id":"tree-a","kind":"tree","scale":[2,2,2],"visible":true,"solid":true}],"counts":[]}});
 let mut args=request(&project,"creation-check");args["checkRequirements"]=requirement.clone();
 let job=journal.godot_build_start(&args)?;let claimed=claim(&mut journal,&job,"token-a","executor-a")?;
 let artifacts=write_artifact(&claimed,"web/index.html",b"<html>fixture only</html>")?;
 let descriptor=journal.godot_job_check_descriptor(&json!({"jobId":job["jobId"],"token":"token-a","artifacts":artifacts}))?;
 assert_eq!(descriptor["checkRequirements"],requirement);
 let required:requirements::Requirements=serde_json::from_value(requirement)?;
 let entity=json!({"id":"tree-a","kind":"tree","position":[0,0,0],"scale":[2,2,2],"visible":true,"solid":true});
 let evidence=json!({"format":"craftmine.godot-check-requirements-evidence/1","requirementsHash":required.hash(),"jobId":job["jobId"],"worldId":"a","buildId":job["buildId"],"instanceId":"real-check","observations":[{"phase":"loaded","entities":[entity.clone()]},{"phase":"running","entities":[entity]}]});
 assert!(requirements::evidence_matches(&required,Some(&evidence),&descriptor));
 for field in ["id","scale","visible","solid"] {let mut bad=evidence.clone();bad["observations"][1]["entities"][0][field]=if field=="id"{json!("other")}else if field=="scale"{json!([1,1,1])}else{json!(false)};assert!(!requirements::evidence_matches(&required,Some(&bad),&descriptor));}
 let mut result=output(&claimed,true,json!([{"id":"runtime.creation-requirements","passed":true}]),artifacts,json!([]));result["check"]["requirementsEvidence"]=evidence;
 assert_eq!(finish(&mut journal,&job,"token-a",&result)?["status"],"passed");
 drop(journal);let journal=TaskJournal::open(&path)?;assert_eq!(requirements::read(&journal.db,job["jobId"].as_str().unwrap())?.unwrap().hash(),required.hash());
 Ok(())
}

#[test]
fn creation_requirements_hash_is_identical_to_host_for_small_floats() -> Result<()> {
 let r:requirements::Requirements=serde_json::from_value(json!({"format":requirements::FORMAT,"creation":{"format":"craftmine.creation-requirements/1","requestHash":"a".repeat(64),"entities":[{"id":"tree-a","position":[0.000001,2.4,0],"scale":[1,2,3]}],"counts":[]}}))?;
 r.validate("creation-sandbox","check")?;
 assert_eq!(r.hash(),"f85e44d5f4e124c7527d53f15378a5a0dca699e08c1e14edca73a10bef061a2e");Ok(())
}
#[test]
fn creation_door_trace_rejects_unconditional_open_missing_steps_and_wrong_order() -> Result<()> {
 let value=json!({"format":requirements::FORMAT,"creation":{"format":"craftmine.creation-requirements/1","requestHash":digest("sequence"),"entities":[],"counts":[],"doorSequence":{"doorId":"door-a","steps":["marker-a","marker-b"]}}});
 let r:requirements::Requirements=serde_json::from_value(value.clone())?;r.validate("creation-sandbox","check")?;
 let descriptor=json!({"format":"craftmine.godot-check-descriptor/1","phase":"check","checkRequirements":value,"checkRequirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build"});
 let trace=json!([{"step":"initial","doorOpen":false,"interacted":false},{"step":"marker-b","doorOpen":false,"interacted":true},{"step":"marker-a","doorOpen":false,"interacted":true},{"step":"marker-b","doorOpen":true,"interacted":true}]);
 let evidence=json!({"format":"craftmine.godot-check-requirements-evidence/1","requirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build","instanceId":"engine","observations":[{"phase":"loaded","entities":[]},{"phase":"running","entities":[],"doorTrace":trace}]});
 assert!(requirements::evidence_matches(&r,Some(&evidence),&descriptor));
 let mut missing=evidence.clone();missing["observations"][1].as_object_mut().unwrap().remove("doorTrace");assert!(!requirements::evidence_matches(&r,Some(&missing),&descriptor));
 for index in 0..3 {let mut bad=evidence.clone();bad["observations"][1]["doorTrace"][index]["doorOpen"]=json!(true);assert!(!requirements::evidence_matches(&r,Some(&bad),&descriptor));}
 let mut bad=evidence.clone();bad["observations"][1]["doorTrace"][2]["step"]=json!("marker-b");assert!(!requirements::evidence_matches(&r,Some(&bad),&descriptor));Ok(())
}

#[test]
fn creation_harvest_trace_requires_reward_collision_and_persistence() -> Result<()> {
 let value=json!({"format":requirements::FORMAT,"creation":{"format":"craftmine.creation-requirements/1","requestHash":digest("harvest"),"entities":[],"counts":[],"harvest":{"entityId":"tree-a","inventoryId":"wood","reward":1,"regrowFrames":300}}});
 let r:requirements::Requirements=serde_json::from_value(value.clone())?;r.validate("creation-sandbox","check")?;
 let descriptor=json!({"format":"craftmine.godot-check-descriptor/1","phase":"check","checkRequirements":value,"checkRequirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build"});
 let steps=["initial","harvested","repeat","midway","restored","before-regrowth","regrown","second-harvest"];
 let trace:Vec<Value>=steps.iter().enumerate().map(|(i,step)|json!({"step":step,"inventory":if i==0{json!({"stone":3})}else{json!({"stone":3,"wood":if i==7{2}else{1}})},"visible":i==0||i==6,"solid":i==0||i==6,"progressRestored":i==4,"elapsedTicks":if i==5{280}else if i==6{330}else{i*10}})).collect();
 let evidence=json!({"format":"craftmine.godot-check-requirements-evidence/1","requirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build","instanceId":"engine","observations":[{"phase":"loaded","entities":[]},{"phase":"running","entities":[],"harvestTrace":trace}]});
 assert!(requirements::evidence_matches(&r,Some(&evidence),&descriptor));
 for (index,field,value) in [(1,"solid",json!(true)),(4,"progressRestored",json!(false)),(5,"visible",json!(true)),(2,"inventory",json!({"stone":3,"wood":2}))]{let mut bad=evidence.clone();bad["observations"][1]["harvestTrace"][index][field]=value;assert!(!requirements::evidence_matches(&r,Some(&bad),&descriptor));}Ok(())
}

#[test]
fn creation_copy_bounds_and_time_are_checked_by_core() -> Result<()> {
 let value=json!({"format":requirements::FORMAT,"creation":{"format":"craftmine.creation-requirements/1","requestHash":digest("copies and time"),"entities":[],"counts":[],"timeOfDay":18,"duplicates":{"kind":"tree","count":2,"scale":[1,1,1],"color":"#84a866","priorIds":["tree-a"]}}});
 let r:requirements::Requirements=serde_json::from_value(value.clone())?;r.validate("creation-sandbox","check")?;
 let descriptor=json!({"format":"craftmine.godot-check-descriptor/1","phase":"check","checkRequirements":value,"checkRequirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build"});
 let entities:Vec<_>=[("tree-a",0.0),("copy-a",4.0),("copy-b",8.0)].iter().map(|(id,x)|json!({"id":id,"kind":"tree","scale":[1,1,1],"position":[x,0,0],"color":"#84A866","visible":true,"solid":true,"bounds":{"min":[x-0.6,0,-0.6],"max":[x+0.6,4,0.6]}})).collect();
 let evidence=json!({"format":"craftmine.godot-check-requirements-evidence/1","requirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build","instanceId":"engine","observations":[{"phase":"loaded","entities":entities,"timeOfDay":18},{"phase":"running","entities":entities,"timeOfDay":18}]});
 assert!(requirements::evidence_matches(&r,Some(&evidence),&descriptor));
 let mut bad=evidence.clone();bad["observations"][1]["timeOfDay"]=json!(12);assert!(!requirements::evidence_matches(&r,Some(&bad),&descriptor));
 let mut bad=evidence.clone();bad["observations"][1]["entities"][2]["bounds"]=bad["observations"][1]["entities"][1]["bounds"].clone();assert!(!requirements::evidence_matches(&r,Some(&bad),&descriptor));
 let mut bad=evidence.clone();bad["observations"][1]["entities"][2]["solid"]=json!(false);assert!(!requirements::evidence_matches(&r,Some(&bad),&descriptor));Ok(())
}
