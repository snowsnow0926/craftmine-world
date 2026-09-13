//! Real SQLite/core/filesystem tests with authored executor evidence. No engine
//! is launched here; native observation is tested by the isolated verifier.
use super::*;

#[test]
fn creation_coordinate_json_roundtrip_preserves_ieee754_identity() {
    let source = "4.0837792158126796";
    let number: serde_json::Value = serde_json::from_str(source).unwrap();
    assert_eq!(number.as_f64().unwrap().to_bits(), 4.0837792158126796_f64.to_bits());
    let restored: serde_json::Value = serde_json::from_str(&serde_json::to_string(&number).unwrap()).unwrap();
    assert_eq!(restored.as_f64().unwrap().to_bits(), number.as_f64().unwrap().to_bits());
}
use crate::godot_test_support::*;

fn passage_fixture() -> Result<(requirements::Requirements,Value,Value)> {
 let value=json!({"format":requirements::FORMAT,"creation":{"format":"craftmine.creation-requirements/1","requestHash":digest("passage"),"entities":[{"id":"door-a","kind":"door","position":[0,0,0],"scale":[1,1,1]}],"counts":[],"doorSequence":{"doorId":"door-a","steps":["marker-a","marker-b"],"verifyPassage":true}}});
 let required:requirements::Requirements=serde_json::from_value(value.clone())?;required.validate("creation-sandbox","check")?;
 let descriptor=json!({"format":"craftmine.godot-check-descriptor/1","phase":"check","checkRequirements":value,"checkRequirementsHash":required.hash(),"jobId":"job","worldId":"world","buildId":"build"});
 let passage=json!({"format":"craftmine.creation-door-passage/1","doorId":"door-a","instanceId":"engine","setup":"snapshot-player-only","boundsSource":"collision","bounds":{"min":[-0.8,0,-0.25],"max":[0.8,2.6,0.25]},"axis":2,"frames":240,"closed":{"before":[0,0.9,1.25],"after":[0,0.9,0.55],"startedTick":10,"finishedTick":260,"targetId":"door-a"},"opened":{"before":[0,0.9,1.25],"after":[0,0.9,-16],"startedTick":400,"finishedTick":650,"targetId":null}});
 let trace=json!([{"step":"initial","doorOpen":false,"interacted":false},{"step":"marker-b","doorOpen":false,"interacted":true},{"step":"marker-a","doorOpen":false,"interacted":true},{"step":"marker-b","doorOpen":true,"interacted":true,"passage":passage}]);
 let entities=json!([{"id":"door-a","kind":"door","position":[0,0,0],"scale":[1,1,1]}]);
 let evidence=json!({"format":"craftmine.godot-check-requirements-evidence/1","requirementsHash":required.hash(),"jobId":"job","worldId":"world","buildId":"build","instanceId":"engine","observations":[{"phase":"loaded","entities":entities},{"phase":"running","entities":entities,"doorTrace":trace}]});
 Ok((required,descriptor,evidence))
}

#[test]
fn creation_door_passage_accepts_fixed_real_web_observations_without_rewriting_identity() -> Result<()> {
 let fixture:Value=serde_json::from_str(include_str!("../../../../../tests/fixtures/creation-door-passage-real-evidence.json"))?;
 let descriptor=&fixture["descriptor"];let evidence=&fixture["evidence"];
 let required:requirements::Requirements=serde_json::from_value(descriptor["checkRequirements"].clone())?;
 required.validate("creation-sandbox","check")?;
 assert_eq!(descriptor["checkRequirementsHash"],required.hash());
 assert!(requirements::evidence_matches(&required,Some(evidence),descriptor));
 let mut changed=evidence.clone();changed["observations"][1]["doorTrace"][3]["passage"]["opened"]["after"]=json!([0,0.9,0.55]);
 assert!(!requirements::evidence_matches(&required,Some(&changed),descriptor));
 Ok(())
}

#[test]
fn creation_door_passage_rejects_weakening_wrong_identity_and_nonphysical_witnesses() -> Result<()> {
 let (required,descriptor,evidence)=passage_fixture()?;
 assert!(requirements::evidence_matches(&required,Some(&evidence),&descriptor));
 for case in ["missing","ghost","retained","teleport","other-door","other-instance","no-frames","replayed","wrong-axis","shifted-bounds","sideways","jumped","extra-key","no-target","fallback"] {
  let mut bad=evidence.clone();let last=&mut bad["observations"][1]["doorTrace"][3];
  match case {
   "missing"=>{last.as_object_mut().unwrap().remove("passage");},
   "ghost"=>last["passage"]["closed"]["after"]=json!([0,0.9,-16]),
   "retained"=>last["passage"]["opened"]["after"]=json!([0,0.9,0.55]),
   "teleport"=>last["passage"]["opened"]["before"]=json!([0,0.9,-16]),
   "other-door"=>last["passage"]["closed"]["targetId"]=json!("door-b"),
   "other-instance"=>last["passage"]["instanceId"]=json!("old-engine"),
   "no-frames"=>last["passage"]["opened"]["finishedTick"]=json!(401),
   "replayed"=>last["passage"]["opened"]["startedTick"]=json!(10),
   "wrong-axis"=>last["passage"]["axis"]=json!(0),
   "shifted-bounds"=>last["passage"]["bounds"]["max"][2]=json!(9),
   "sideways"=>last["passage"]["opened"]["after"][0]=json!(2),
   "jumped"=>last["passage"]["opened"]["after"][1]=json!(4),
   "extra-key"=>last["passage"]["passed"]=json!(true),
   "no-target"=>{last["passage"]["opened"].as_object_mut().unwrap().remove("targetId");},
   "fallback"=>last["passage"]["boundsSource"]=json!("declaration-fallback"),
   _=>unreachable!(),
  }
  assert!(!requirements::evidence_matches(&required,Some(&bad),&descriptor),"{case}");
 }
 let mut legacy=descriptor["checkRequirements"].clone();legacy["creation"]["doorSequence"].as_object_mut().unwrap().remove("verifyPassage");
 let old:requirements::Requirements=serde_json::from_value(legacy.clone())?;old.validate("creation-sandbox","check")?;assert_ne!(old.hash(),required.hash());
 for value in [json!(false),Value::Null,json!({"optional":true})]{let mut invalid=legacy.clone();invalid["creation"]["doorSequence"]["verifyPassage"]=value;let parsed:requirements::Requirements=serde_json::from_value(invalid)?;assert!(parsed.validate("creation-sandbox","check").is_err());}
 let mut no_pose=descriptor["checkRequirements"].clone();no_pose["creation"]["entities"][0].as_object_mut().unwrap().remove("position");let parsed:requirements::Requirements=serde_json::from_value(no_pose)?;assert!(parsed.validate("creation-sandbox","check").is_err());
 Ok(())
}

#[test]
fn creation_door_passage_controls_core_finish_and_candidate_readiness() -> Result<()> {
 for case in ["valid","missing","ghost","weakened","controller-changed","legacy-controller-changed"] {
  let (_dir,path)=temp()?;let mut journal=setup(&path)?;
  let mut files=project_files();for(path,text)in crate::godot_creation_probe::files(){files.as_array_mut().unwrap().push(json!({"path":path,"text":text}));}
  for(path,text)in crate::godot_creation_probe::passage_files(){let text=if case.ends_with("controller-changed")&&path.ends_with("player_controller.gd"){format!("{text}\n# authored custom controller\n")}else{text};files.as_array_mut().unwrap().push(json!({"path":path,"text":text}));}
  files[0]["text"]=json!(format!("{}\n[autoload]\nCraftmineRuntime=\"*res://craftmine_shared/runtime_bridge.gd\"\n[craftmine]\nruntime/adapter=\"res://craftmine_shared/base_adapter.gd\"\n",files[0]["text"].as_str().unwrap()));
  let project=journal.godot_project_create(&json!({"context":ctx("one"),"worldId":"a","toolCallId":"passage","baseBuild":"base-a","baseId":"creation-sandbox","files":files}))?;
  register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("e"))?;
  let (required,template,mut evidence)=passage_fixture()?;
  let mut args=request(&project,"passage-check");args["checkRequirements"]=template["checkRequirements"].clone();
  if case=="legacy-controller-changed"{args["checkRequirements"]["creation"]["doorSequence"].as_object_mut().unwrap().remove("verifyPassage");}
  let started=journal.godot_build_start(&args);
  if case=="controller-changed"{assert!(started.unwrap_err().to_string().contains("CREATION_PASSAGE_CONTROLLER_UNSUPPORTED"));assert_eq!(journal.world_read("a")?.world.snapshot,world().snapshot);continue;}
  let job=started?;if case=="legacy-controller-changed"{assert!(job["jobId"].is_string());continue;}
  let claimed=claim(&mut journal,&job,"token-a","executor-a")?;
  let artifacts=write_artifact(&claimed,"web/index.html",b"<html>authored executor fixture</html>")?;
  let descriptor=journal.godot_job_check_descriptor(&json!({"jobId":job["jobId"],"token":"token-a","artifacts":artifacts}))?;
  assert_eq!(descriptor["checkRequirements"],template["checkRequirements"]);
  evidence["jobId"]=job["jobId"].clone();evidence["worldId"]=json!("a");evidence["buildId"]=job["buildId"].clone();
  match case {
   "missing"=>{evidence["observations"][1]["doorTrace"][3].as_object_mut().unwrap().remove("passage");},
   "ghost"=>evidence["observations"][1]["doorTrace"][3]["passage"]["closed"]["after"]=json!([0,0.9,-16]),
   "weakened"=>{let mut weak=template["checkRequirements"].clone();weak["creation"]["doorSequence"].as_object_mut().unwrap().remove("verifyPassage");let weak:requirements::Requirements=serde_json::from_value(weak)?;evidence["requirementsHash"]=json!(weak.hash());},
   _=>{},
  }
  let mut output=output(&claimed,true,json!([{"id":"runtime.creation-requirements","passed":true}]),artifacts,json!([]));output["check"]["requirementsEvidence"]=evidence;
  let finished=finish(&mut journal,&job,"token-a",&output)?;
  assert_eq!(finished["status"],if case=="valid"{"passed"}else{"failed"},"{case}");
  let candidate=journal.godot_candidate_read(&json!({"worldId":"a","candidateId":finished["candidateId"]}))?;
  assert_eq!(candidate["candidate"]["status"],if case=="valid"{"ready"}else{"rejected"},"{case}");
  drop(journal);let journal=TaskJournal::open(&path)?;assert_eq!(requirements::read(&journal.db,job["jobId"].as_str().unwrap())?.unwrap().hash(),required.hash());
  assert_eq!(journal.world_read("a")?.world.snapshot,world().snapshot);
 }
 Ok(())
}

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
 let mut files=project_files();for(path,text)in crate::godot_creation_probe::files(){files.as_array_mut().unwrap().push(json!({"path":path,"text":text}));}
 files[0]["text"]=json!(format!("{}\n[autoload]\nCraftmineRuntime=\"*res://craftmine_shared/runtime_bridge.gd\"\n[craftmine]\nruntime/adapter=\"res://craftmine_shared/base_adapter.gd\"\n",files[0]["text"].as_str().unwrap()));
 let project=journal.godot_project_create(&json!({"context":ctx("one"),"worldId":"a","toolCallId":"creation","baseBuild":"base-a","baseId":"creation-sandbox","files":files}))?;
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
fn frozen_marker_label_rejects_changed_declaration_and_preserves_legacy() -> Result<()> {
 let value=json!({"format":requirements::FORMAT,"creation":{"format":"craftmine.creation-requirements/1","requestHash":digest("red marker"),"entities":[{"id":"red-mark","kind":"marker","declaredLabel":"红","color":"#ff0000"}],"counts":[]}});
 let r:requirements::Requirements=serde_json::from_value(value.clone())?;r.validate("creation-sandbox","check")?;
 let descriptor=json!({"format":"craftmine.godot-check-descriptor/1","phase":"check","checkRequirements":value,"checkRequirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build"});
 let entity=json!({"id":"red-mark","kind":"marker","position":[0,0,0],"scale":[1,1,1],"color":"#ff0000","parameters":{"label":"红"}});
 let evidence=json!({"format":"craftmine.godot-check-requirements-evidence/1","requirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build","instanceId":"engine","observations":[{"phase":"loaded","entities":[entity.clone()]},{"phase":"running","entities":[entity]}]});
 assert!(requirements::evidence_matches(&r,Some(&evidence),&descriptor));
 for label in [json!("黄"),Value::Null,json!(9)] {let mut bad=evidence.clone();bad["observations"][1]["entities"][0]["parameters"]["label"]=label;assert!(!requirements::evidence_matches(&r,Some(&bad),&descriptor));}
 let mut legacy=value.clone();legacy["creation"]["entities"][0].as_object_mut().unwrap().remove("declaredLabel");let old:requirements::Requirements=serde_json::from_value(legacy.clone())?;old.validate("creation-sandbox","check")?;
 let mut old_descriptor=descriptor.clone();old_descriptor["checkRequirements"]=legacy;old_descriptor["checkRequirementsHash"]=json!(old.hash());
 let mut old_evidence=evidence.clone();old_evidence["requirementsHash"]=json!(old.hash());old_evidence["observations"][1]["entities"][0]["parameters"]=Value::Null;
 assert!(requirements::evidence_matches(&old,Some(&old_evidence),&old_descriptor));
 for (kind,label) in [("door",json!("red")),("marker",json!("a".repeat(81))),("marker",json!(true))] {let mut bad=value.clone();bad["creation"]["entities"][0]["kind"]=json!(kind);bad["creation"]["entities"][0]["declaredLabel"]=label;let invalid:requirements::Requirements=serde_json::from_value(bad)?;assert!(invalid.validate("creation-sandbox","check").is_err());}
 Ok(())
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

#[test]
fn creation_requirement_build_rejects_modified_probe_and_redirected_entry() -> Result<()> {
 for target in ["craftmine_shared/base_adapter.gd","craftmine_shared/runtime_bridge.gd","craftmine_shared/state_guard.gd","project.godot"]{
  let (_dir,path)=temp()?;let mut journal=setup(&path)?;let mut files=project_files();
  for(path,text)in crate::godot_creation_probe::files(){files.as_array_mut().unwrap().push(json!({"path":path,"text":text}));}
  files[0]["text"]=json!(format!("{}\n[autoload]\nCraftmineRuntime=\"*res://craftmine_shared/runtime_bridge.gd\"\n[craftmine]\nruntime/adapter=\"res://craftmine_shared/base_adapter.gd\"\n",files[0]["text"].as_str().unwrap()));
  let file=files.as_array_mut().unwrap().iter_mut().find(|f|f["path"]==target).unwrap();
  file["text"]=json!(if target=="project.godot"{file["text"].as_str().unwrap().replace("base_adapter.gd","forged_adapter.gd")}else{format!("{}\n# authored replacement",file["text"].as_str().unwrap())});
  let project=journal.godot_project_create(&json!({"context":ctx("one"),"worldId":"a","toolCallId":"creation","baseBuild":"base-a","baseId":"creation-sandbox","files":files}))?;
  let mut args=request(&project,"check-pinned");args["checkRequirements"]=json!({"format":requirements::FORMAT,"creation":{"format":"craftmine.creation-requirements/1","requestHash":digest("wish"),"entities":[{"id":"tree-a","scale":[2,2,2]}],"counts":[]}});
  failed(journal.godot_build_start(&args),if target=="project.godot"{"CREATION_PROBE_ENTRY_MISMATCH"}else{"CREATION_PROBE_SOURCE_MISMATCH"});
  let jobs:i64=journal.db.query_row("SELECT count(*) FROM craftmine_godot_jobs",[],|row|row.get(0))?;assert_eq!(jobs,0);
 }
 Ok(())
}

#[test]
fn creation_transform_requirements_verify_observed_yaw_and_position() -> Result<()> {
 let value=json!({"format":requirements::FORMAT,"creation":{"format":"craftmine.creation-requirements/1","requestHash":digest("move and rotate"),"entities":[{"id":"tree-a","kind":"tree","position":[5,0,1],"rotationY":180}],"counts":[]}});
 let r:requirements::Requirements=serde_json::from_value(value.clone())?;r.validate("creation-sandbox","check")?;
 let descriptor=json!({"format":"craftmine.godot-check-descriptor/1","phase":"check","checkRequirements":value,"checkRequirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build"});
 let entity=json!({"id":"tree-a","kind":"tree","position":[5,0,1],"rotationY":-180,"scale":[1,1,1]});
 let evidence=json!({"format":"craftmine.godot-check-requirements-evidence/1","requirementsHash":r.hash(),"jobId":"job","worldId":"world","buildId":"build","instanceId":"engine","observations":[{"phase":"loaded","entities":[entity]},{"phase":"running","entities":[entity]}]});
 assert!(requirements::evidence_matches(&r,Some(&evidence),&descriptor));
 for (field,wrong) in [("rotationY",json!(0)),("rotationY",Value::Null),("position",json!([0,0,0]))]{let mut bad=evidence.clone();bad["observations"][1]["entities"][0][field]=wrong;assert!(!requirements::evidence_matches(&r,Some(&bad),&descriptor));}
 for wrong in [json!(181),json!("90"),Value::Null]{let mut bad=value.clone();bad["creation"]["entities"][0]["rotationY"]=wrong;let r:requirements::Requirements=serde_json::from_value(bad)?;assert!(r.validate("creation-sandbox","check").is_err());}
 Ok(())
}
