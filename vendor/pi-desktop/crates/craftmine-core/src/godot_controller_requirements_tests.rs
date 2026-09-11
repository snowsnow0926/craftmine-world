//! Real Web samples below retain their original identities. The SQLite finish
//! test explicitly rebinds copies as authored executor fixtures, not an engine run.
use super::*;
use crate::godot_test_support::*;

fn fixture()->Value {serde_json::from_str(include_str!("../../../../../tests/fixtures/creation-controller-binding-real-evidence.json")).unwrap()}
fn mutate(e:&mut Value,case:&str){
 let p=&mut e["observations"][1]["doorTrace"][3]["passage"];
 match case {
  "missing"=>{p.as_object_mut().unwrap().remove("controllerProfile");},
  "script"=>p["closed"]["controller"]["before"]["playerScriptId"]=json!("123"),
  "root-proxy"=>p["closed"]["controller"]["before"]["rootPlayerId"]=json!("123"),
  "camera"=>p["closed"]["controller"]["before"]["activeCameraId"]=json!("123"),
  "parameters"=>p["closed"]["controller"]["before"]["parameters"][0]=json!(9),
  "shape"=>p["closed"]["controller"]["before"]["shape"]["radius"]=json!(0.4),
  "walk-change"=>p["opened"]["controller"]["walk"]["bindingTrace"][100][2]=json!("123"),
  "gap"=>{p["opened"]["controller"]["walk"]["checkedTicks"].as_array_mut().unwrap().remove(100);},
  "direct-open"=>p["closed"]["lockedInteraction"]["doorOpen"]=json!(true),
  "no-lock"=>{p["closed"].as_object_mut().unwrap().remove("lockedInteraction");},
  "valid"=>{},
  _=>panic!("unknown case: {case}"),
 }
}

#[test]
fn fixed_controller_core_checks_original_real_web_facts_and_tick_identity()->Result<()> {
 let f=fixture();let d=&f["descriptor"];
 let r:requirements::Requirements=serde_json::from_value(d["checkRequirements"].clone())?;
 r.validate("creation-sandbox","check")?;assert_eq!(r.hash(),d["checkRequirementsHash"]);
 assert!(requirements::evidence_matches(&r,Some(&f["evidence"]),d));
 for case in ["missing","script","root-proxy","camera","parameters","shape","walk-change","gap","direct-open","no-lock"]{
  let mut e=f["evidence"].clone();mutate(&mut e,case);assert!(!requirements::evidence_matches(&r,Some(&e),d),"{case}");
 }
 let mut weak=d["checkRequirements"].clone();weak["creation"]["doorSequence"].as_object_mut().unwrap().remove("controllerProfile");
 let weak:requirements::Requirements=serde_json::from_value(weak)?;assert_ne!(weak.hash(),r.hash());
 Ok(())
}

#[test]
fn fixed_controller_core_finish_rejects_bad_facts_and_legacy_probe_without_touching_world()->Result<()> {
 for case in ["valid","missing","script","root-proxy","camera","parameters","shape","walk-change","gap","direct-open","no-lock","legacy-probe","modified-probe"]{
  let (_dir,path)=temp()?;let mut journal=setup(&path)?;let mut files=project_files();
  let source=if case=="legacy-probe"{crate::godot_creation_probe::files()}else{crate::godot_creation_probe::controller_files()};
  for(path,text)in source.into_iter().chain(crate::godot_creation_probe::passage_files()){
   let text=if case=="modified-probe"&&path.ends_with("controller_evidence.gd"){format!("{text}\n# changed")}else{text};
   files.as_array_mut().unwrap().push(json!({"path":path,"text":text}));
  }
  files[0]["text"]=json!(format!("{}\n[autoload]\nCraftmineRuntime=\"*res://craftmine_shared/runtime_bridge.gd\"\n[craftmine]\nruntime/adapter=\"res://craftmine_shared/base_adapter.gd\"\n",files[0]["text"].as_str().unwrap()));
  let project=journal.godot_project_create(&json!({"context":ctx("one"),"worldId":"a","toolCallId":"controller","baseBuild":"base-a","baseId":"creation-sandbox","files":files}))?;
  register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("e"))?;
  let f=fixture();let required=f["descriptor"]["checkRequirements"].clone();
  let args=json!({"context":ctx("one"),"worldId":"a","toolCallId":"controller-check","revision":project["revision"],"manifestHash":project["manifestHash"],"mode":"check","checkRequirements":required});
  let started=journal.godot_build_start(&args);
  if case=="legacy-probe"||case=="modified-probe"{assert!(started.unwrap_err().to_string().contains("CREATION_CONTROLLER_PROBE_UNSUPPORTED"));assert_eq!(journal.world_read("a")?.world.snapshot,world().snapshot);continue;}
  let job=started?;let claimed=claim(&mut journal,&job,"token-a","executor-a")?;
  let artifacts=write_artifact(&claimed,"web/index.html",b"<html>authored executor fixture</html>")?;
  let descriptor=journal.godot_job_check_descriptor(&json!({"jobId":job["jobId"],"token":"token-a","artifacts":artifacts}))?;
  assert_eq!(descriptor["checkRequirements"],required);
  let mut evidence=f["evidence"].clone();evidence["jobId"]=job["jobId"].clone();evidence["worldId"]=json!("a");evidence["buildId"]=job["buildId"].clone();mutate(&mut evidence,case);
  let mut result=output(&claimed,true,json!([{"id":"runtime.creation-requirements","passed":true}]),artifacts,json!([]));result["check"]["requirementsEvidence"]=evidence;
  let finished=finish(&mut journal,&job,"token-a",&result)?;
  assert_eq!(finished["status"],if case=="valid"{"passed"}else{"failed"},"{case}");
  let candidate=journal.godot_candidate_read(&json!({"worldId":"a","candidateId":finished["candidateId"]}))?;
  assert_eq!(candidate["candidate"]["status"],if case=="valid"{"ready"}else{"rejected"},"{case}");
  assert_eq!(journal.world_read("a")?.world.snapshot,world().snapshot);
 }
 Ok(())
}
