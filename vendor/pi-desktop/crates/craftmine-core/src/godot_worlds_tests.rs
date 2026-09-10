use super::*;
use crate::godot_test_support::*;
use crate::WorkspaceContext;

#[test]
fn copied_runtime_rebind_is_exact_persistent_and_requires_independent_application() -> Result<()> {
    let (source_dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;
    let mut files=project_files();
    let source_config=format!("{PROJECT}\n[craftmine]\nruntime/world_id=\"g1\"\nruntime/enabled=true\n");
    files[0]["text"]=json!(source_config);
    applied_world_files(&mut journal,"g1",files)?;
    journal.content_migrate_apply(&json!({"worldId":"g1"}))?;
    journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g2","title":"Independent copy","progress":"formal"}))?;
    let before=journal.world_read("g2")?;
    failed(journal.godot_runtime_describe(&json!({"worldId":"g2"})),"GODOT_COPY_REBUILD_REQUIRED");
    let initial=journal.godot_world_rebuild_plan(&json!({"worldId":"g2"}))?;
    assert_eq!(initial["identityRebindRequired"],true);
    let rebound=journal.godot_world_prepare_copy_runtime(&json!({"worldId":"g2"}))?;
    assert_eq!(rebound["copied"],true);assert_eq!(rebound["replayed"],false);
    let replay=journal.godot_world_prepare_copy_runtime(&json!({"worldId":"g2"}))?;
    assert_eq!(replay["replayed"],true);assert_eq!(replay["contentOid"],rebound["contentOid"]);
    assert_eq!(journal.world_read("g2")?.world.snapshot,before.world.snapshot);
    let plan=journal.godot_world_rebuild_plan(&json!({"worldId":"g2"}))?;
    assert_eq!(plan["identityRebindRequired"],false);assert_eq!(plan["sourceParentOid"],initial["contentOid"]);
    assert_ne!(plan["contentOid"],initial["contentOid"]);
    let (store,layout)=journal.content_layout("g2")?;
    assert_eq!(store.read_file(&layout,plan["contentOid"].as_str().unwrap(),"project.godot")?,source_config.replace("world_id=\"g1\"","world_id=\"g2\"").as_bytes());
    assert_eq!(store.read_file(&layout,plan["contentOid"].as_str().unwrap(),"world.gd")?,SCRIPT.as_bytes());
    assert_eq!(store.branch_head(&layout,"main")?.as_deref(),plan["contentOid"].as_str(),"fresh main must carry target identity for normal authoring");
    // Invalid child refs cannot substitute a draft or lose exact parentage.
    let reference=crate::godot_copy_runtime::runtime_ref("g2",before.world.build["id"].as_str().unwrap());
    store.git().update_ref(&layout.git_dir,&reference,initial["contentOid"].as_str().unwrap(),Some(plan["contentOid"].as_str().unwrap()))?;
    assert_eq!(journal.godot_world_rebuild_plan(&json!({"worldId":"g2"}))?["identityRebindRequired"],true,"an interrupted ref at parent is not transformed");
    let repaired=journal.godot_world_prepare_copy_runtime(&json!({"worldId":"g2"}))?;
    let plan=journal.godot_world_rebuild_plan(&json!({"worldId":"g2"}))?;
    assert_eq!(repaired["contentOid"],plan["contentOid"]);
    // Existing copied drafts must keep their own content; only fixed identity
    // tokens change. Their child is never selected as the formal rebuild tree.
    journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g4","title":"Old copied draft","progress":"formal"}))?;
    let (draft_store,draft_layout)=journal.content_layout("g4")?;
    let parent=draft_store.branch_head(&draft_layout,"main")?.unwrap();
    let mut draft_files=Vec::new();
    for entry in draft_store.tree_entries(&draft_layout,&parent)? {
        let bytes=if entry.path=="world.gd"{b"extends Node3D\nvar damage := 99\n".to_vec()}else{draft_store.read_file(&draft_layout,&parent,&entry.path)?};
        draft_files.push(crate::content_history::repo::ContentFile{path:entry.path,bytes});
    }
    let draft_head=draft_store.commit_ref(&draft_layout,"refs/heads/main",Some(&parent),&draft_files,"Preserved user draft")?;
    let draft_bound=journal.godot_world_prepare_copy_runtime(&json!({"worldId":"g4"}))?;
    assert_eq!(draft_bound["draftTransform"]["sourceParentOid"],draft_head);
    assert_ne!(draft_bound["draftTransform"]["contentOid"],draft_bound["contentOid"]);
    let rebound_main=draft_store.branch_head(&draft_layout,"main")?.unwrap();
    assert_eq!(draft_store.read_file(&draft_layout,&rebound_main,"world.gd")?,b"extends Node3D\nvar damage := 99\n");
    assert_eq!(draft_store.read_file(&draft_layout,draft_bound["contentOid"].as_str().unwrap(),"world.gd")?,SCRIPT.as_bytes());
    assert!(String::from_utf8(draft_store.read_file(&draft_layout,&rebound_main,"project.godot")?)?.contains("world_id=\"g4\""));
    assert_eq!(journal.godot_world_prepare_copy_runtime(&json!({"worldId":"g4"}))?["draftTransform"]["alreadyBound"],true);
    assert_eq!(draft_store.branch_head(&draft_layout,"main")?,Some(rebound_main));
    let archive_dir=tempfile::tempdir()?;let archive=archive_dir.path().join("copied.cmarchive");
    journal.backup_export_portable(&json!({"operationId":"copy-export","archivePath":archive.to_string_lossy()}))?;
    drop(journal);
    let hidden=tempfile::tempdir()?;std::fs::rename(source_dir.path(),hidden.path().join("unavailable"))?;
    let target=tempfile::tempdir()?;let target_path=target.path().join("data");
    let mut journal=TaskJournal::open(&target_path.join("tasks.sqlite"))?;
    journal.backup_restore_portable(&json!({"operationId":"copy-restore","archivePath":archive.to_string_lossy(),"targetDirectory":target_path.to_string_lossy()}))?;
    assert_eq!(journal.godot_world_rebuild_plan(&json!({"worldId":"g2"}))?["identityTransform"],plan["identityTransform"]);
    assert_eq!(journal.world_read("g2")?.world.snapshot,before.world.snapshot);
    journal.content_branch_create(&json!({"worldId":"g2","branchId":plan["rebuildBranchId"],"fromRev":plan["contentOid"]}))?;
    let context=WorkspaceContext{project_id:"copy-rebuild".into(),session_id:"copy-rebuild".into(),turn_id:"copy-rebuild".into()};
    journal.workspace_open(&context,"g2")?;
    register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("copy restored fixture"))?;
    let index=journal.godot_project_index(&json!({"context":context,"worldId":"g2","branchId":plan["rebuildBranchId"]}))?;
    let job=journal.godot_build_start(&json!({"context":context,"worldId":"g2","branchId":plan["rebuildBranchId"],"toolCallId":"copy-check","revision":index["revision"],"manifestHash":index["manifestHash"],"mode":"check"}))?;
    let claimed=claim(&mut journal,&job,"copy-token","executor-a")?;
    let artifacts=write_artifact(&claimed,"web/index.html",b"<html>independent copy synthetic fixture</html>")?;
    let checked=finish(&mut journal,&job,"copy-token",&output(&claimed,true,json!([{"id":"synthetic-copy-check","passed":true,"detail":"core fixture only"}]),artifacts,json!([])))?;
    failed(journal.godot_runtime_describe(&json!({"worldId":"g2"})),"GODOT_COPY_REBUILD_REQUIRED");
    let current=journal.world_read("g2")?;
    let prepared=journal.godot_application_prepare(&json!({"id":"copy-apply","token":"copy-apply-token","worldId":"g2","candidateId":checked["candidateId"],"revision":current.summary.revision,"snapshot":current.world.snapshot}))?;
    let status=journal.content_status(&json!({"worldId":"g2"}))?;
    let branch=journal.godot_world_rebuild_plan(&json!({"worldId":"g2"}))?;
    let operation=json!({"operationId":"copy-apply","worldId":"g2","repoId":status["repoId"],"branchId":branch["rebuildBranchId"],"expectedHeadOid":branch["rebuildContentOid"],"expectedAppliedOid":status["appliedOid"],"expectedProgressRevision":current.summary.revision});
    journal.content_apply_prepare(&json!({"worldId":"g2","context":operation,"kind":"apply","targetOid":branch["rebuildContentOid"],"detail":"independent copy check"}))?;
    journal.content_apply_advance(&json!({"operationId":"copy-apply"}))?;
    journal.godot_application_commit(&json!({"id":"copy-apply","token":"copy-apply-token","evidence":{"format":"craftmine.godot-application/2","inputHash":prepared["inputHash"],"launch":{"passed":true,"buildId":prepared["buildId"],"instanceId":"copy-fixture","stateHash":digest("synthetic")},"player":null,"snapshot":current.world.snapshot}}))?;
    journal.content_apply_confirm(&json!({"operationId":"copy-apply","applicationId":"copy-apply","detail":"independent copy confirmed"}))?;
    let descriptor=journal.godot_runtime_describe(&json!({"worldId":"g2"}))?;
    assert!(descriptor["copiedFromWorldId"].is_null());
    assert_eq!(descriptor["snapshot"],before.world.snapshot);
    assert_ne!(descriptor["buildId"],before.world.build["id"]);
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"g2"}))?["playable"],true);
    // Copying an independently applied copy starts from that copy's identity.
    journal.godot_world_copy(&json!({"sourceWorldId":"g2","targetWorldId":"g3","title":"Next independent copy","progress":"formal"}))?;
    let next=journal.godot_world_prepare_copy_runtime(&json!({"worldId":"g3"}))?;
    assert_eq!(next["proof"]["sourceWorldId"],"g2");
    Ok(())
}

#[test]
fn portable_restore_rebuilds_applied_source_without_losing_progress_or_drafts() -> Result<()> {
    let (source_dir, path) = temp()?;
    let mut journal = TaskJournal::open(&path)?;
    applied_world(&mut journal, "g1")?;
    journal.content_migrate_apply(&json!({"worldId":"g1"}))?;
    let mut saved = journal.world_read("g1")?;
    saved.world.snapshot["body"]["inventory"] = json!({"ore":17,"seed":4});
    saved.world.snapshot["body"]["quests"] = json!({"intro":"finished"});
    journal.world_save_progress("g1",saved.summary.revision,saved.world.build["id"].as_str().unwrap(),&saved.world.snapshot)?;
    let original_plan = journal.godot_world_rebuild_plan(&json!({"worldId":"g1"}))?;
    assert_eq!(original_plan["rebuildRequired"], false);
    let context = ctx("draft-after-apply");
    journal.workspace_open(&context,"g1")?;
    let source = journal.godot_project_index(&json!({"context":context,"worldId":"g1"}))?;
    let status = journal.content_status(&json!({"worldId":"g1"}))?;
    let file = source["files"].as_array().unwrap().iter().find(|file|file["path"]=="world.gd").unwrap();
    let draft = journal.godot_project_patch(&json!({"context":context,"worldId":"g1","toolCallId":"unpublished",
        "revision":source["revision"],"manifestHash":source["manifestHash"],
        "operation":{"operationId":"unpublished","worldId":"g1","repoId":status["repoId"],"branchId":"main",
            "expectedHeadOid":status["headOid"],"expectedAppliedOid":status["appliedOid"],"expectedProgressRevision":null},
        "operations":[{"op":"put","path":"world.gd","expectedHash":file["sha256"],"text":"extends Node3D\nvar damage := 99\n"}]}))?;
    journal.workspace_end_turn(&context.session_id,&context.turn_id,"completed")?;
    let before_export=journal.backup_status(&json!({}))?;
    let exported=journal.godot_runtime_export_source(&json!({"worldId":"g1"}))?;
    assert_eq!(exported["format"],"craftmine.godot-export-source/1");
    assert_eq!(exported["contentOid"],original_plan["contentOid"]);
    assert_ne!(exported["contentOid"],journal.content_status(&json!({"worldId":"g1"}))?["headOid"]);
    assert_eq!(exported["snapshot"],journal.world_read("g1")?.world.snapshot);
    assert_eq!(exported["sourceWorldId"],"g1");
    assert_eq!(exported["sourceRevision"],0);
    assert_ne!(exported["sourceRevision"],exported["revision"],"source revision is not play-progress revision");
    let exported_script=exported["files"].as_array().unwrap().iter().find(|file|file["path"]=="world.gd").unwrap();
    assert_eq!(exported_script["sha256"],digest(SCRIPT));
    assert_eq!(exported_script["bytes"],SCRIPT.len());
    assert_eq!(journal.backup_status(&json!({}))?,before_export,"exportSource is readonly");
    let copied=journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g2","title":"Exact formal copy","progress":"formal"}))?;
    assert_eq!(copied["sourceRevision"],0,"copy must not inherit unpublished revision 1");
    let copy_context=WorkspaceContext {project_id:"copy".into(),session_id:"copy".into(),turn_id:"copy".into()};
    journal.workspace_open(&copy_context,"g2")?;
    let copy_index=journal.godot_project_index(&json!({"worldId":"g2","context":copy_context}))?;
    assert_eq!(journal.godot_project_read(&json!({"worldId":"g2","context":copy_context,"revision":copy_index["revision"],"manifestHash":copy_index["manifestHash"],"path":"world.gd"}))?["text"],SCRIPT);
    // A copy of a copy resolves the original formal build owner correctly.
    journal.godot_world_copy(&json!({"sourceWorldId":"g2","targetWorldId":"g3","title":"Second copy","progress":"formal"}))?;
    let origin=journal.godot_world_copy_status(&json!({"worldId":"g3","sourceWorldId":"g2"}))?;
    assert_eq!(origin["originalSourceWorldId"],"g2");
    assert_eq!(origin["sourceBuildOwnerWorldId"],"g1");
    failed(journal.godot_world_copy_status(&json!({"worldId":"g3","sourceWorldId":"g1"})),"GODOT_COPY_ORIGIN_MISMATCH");
    assert!(journal.godot_world_copy_status(&json!({"worldId":"missing"}))?.is_null());
    let g3_plan=journal.godot_world_rebuild_plan(&json!({"worldId":"g3"}))?;
    let copied_export=journal.godot_runtime_export_source(&json!({"worldId":"g3"}))?;
    assert_eq!(copied_export["worldId"],"g3");
    assert_eq!(copied_export["sourceWorldId"],"g1");
    assert_eq!(copied_export["contentOid"],g3_plan["contentOid"]);
    assert_eq!(copied_export["snapshot"]["body"]["worldId"],"g3");
    assert_eq!(copied_export["files"],exported["files"]);
    assert_eq!(copied_export["sourceRevision"],exported["sourceRevision"]);
    // Simulate an older copied world: it has an unpublished main draft and no
    // dedicated formal-source ref. Recovery must transfer from the source's
    // old formal revision, not either world's newer head.
    let g2_status=journal.content_status(&json!({"worldId":"g2"}))?;
    let (store,layout)=journal.content_layout("g2")?;
    let reference=copied_formal_ref("g2",copied["buildId"].as_str().unwrap());
    let retained=store.git().ref_value(&layout.git_dir,&reference)?.unwrap();
    assert!(store.protected_refs(&layout)?.iter().any(|entry|entry.name==reference));
    store.git().delete_ref(&layout.git_dir,&reference,&retained)?;
    failed(journal.godot_runtime_export_source(&json!({"worldId":"g2"})),"GODOT_REBUILD_SOURCE_TRANSFER_REQUIRED");
    let g2_file=copy_index["files"].as_array().unwrap().iter().find(|file|file["path"]=="world.gd").unwrap();
    let g2_draft=journal.godot_project_patch(&json!({"context":copy_context,"worldId":"g2","toolCallId":"old-copy-draft",
        "revision":copy_index["revision"],"manifestHash":copy_index["manifestHash"],
        "operation":{"operationId":"old-copy-draft","worldId":"g2","repoId":g2_status["repoId"],"branchId":"main","expectedHeadOid":g2_status["headOid"],"expectedAppliedOid":g2_status["appliedOid"],"expectedProgressRevision":null},
        "operations":[{"op":"put","path":"world.gd","expectedHash":g2_file["sha256"],"text":"extends Node3D\nvar damage := 73\n"}]}))?;
    journal.workspace_end_turn(&copy_context.session_id,&copy_context.turn_id,"completed")?;
    // A forged copied-formal ref pointing at a newer draft must fail even
    // though the commit is valid and belongs to the target repository.
    let wrong=store.branch_head(&layout,"main")?.unwrap();
    store.git().update_ref(&layout.git_dir,&reference,&wrong,None)?;
    failed(journal.godot_runtime_export_source(&json!({"worldId":"g2"})),"GODOT_COPIED_SOURCE_MISMATCH");
    store.git().delete_ref(&layout.git_dir,&reference,&wrong)?;
    let saved = journal.world_read("g1")?;
    let copied_progress=journal.world_read("g2")?.world.snapshot;
    let archives = tempfile::tempdir()?;
    let archive = archives.path().join("restore.cmarchive");
    journal.backup_export_portable(&json!({"operationId":"export-rebuild","archivePath":archive.to_string_lossy()}))?;
    drop(journal);
    let unavailable = tempfile::tempdir()?;
    std::fs::rename(source_dir.path(),unavailable.path().join("moved"))?;
    assert!(!path.exists());
    let target_root=tempfile::tempdir()?;let target=target_root.path().join("data");
    let mut restored=TaskJournal::open(&target.join("tasks.sqlite"))?;
    restored.backup_restore_portable(&json!({"operationId":"restore-rebuild","archivePath":archive.to_string_lossy(),"targetDirectory":target.to_string_lossy()}))?;
    assert!(!target.join("godot-builds").exists());
    assert_eq!(restored.world_read("g1")?.world.snapshot,saved.world.snapshot);
    assert_eq!(restored.world_read("g2")?.world.snapshot,copied_progress);
    assert_eq!(restored.godot_world_init_status(&json!({"worldId":"g2"}))?["playable"],false);
    assert_eq!(restored.godot_world_init_status(&json!({"worldId":"g2"}))?["rebuildRequired"],true);
    failed(restored.godot_world_rebuild_plan(&json!({"worldId":"g2"})),"GODOT_REBUILD_SOURCE_TRANSFER_REQUIRED");
    assert_eq!(restored.godot_world_rebuild_plan(&json!({"worldId":"g3"}))?["contentOid"],g3_plan["contentOid"]);
    assert_eq!(restored.godot_runtime_export_source(&json!({"worldId":"g3"}))?,copied_export,"export works after restore without Web artifacts");
    let (_,source_layout)=restored.content_layout("g1")?;
    let held_git=target.join("source-git-unavailable");
    std::fs::rename(&source_layout.git_dir,&held_git)?;
    failed(restored.godot_world_prepare_rebuild_source(&json!({"worldId":"g2"})),"GODOT_REBUILD_SOURCE_NOT_AVAILABLE");
    // A preserved target ref is independent of the original source Git files.
    assert_eq!(restored.godot_world_prepare_rebuild_source(&json!({"worldId":"g3"}))?["replayed"],true);
    assert_eq!(restored.godot_world_rebuild_plan(&json!({"worldId":"g3"}))?["contentOid"],g3_plan["contentOid"]);
    let (copy_store,copy_layout)=restored.content_layout("g3")?;
    let copy_ref=copied_formal_ref("g3",copied["buildId"].as_str().unwrap());
    copy_store.git().delete_ref(&copy_layout.git_dir,&copy_ref,g3_plan["contentOid"].as_str().unwrap())?;
    assert_eq!(restored.godot_world_prepare_rebuild_source(&json!({"worldId":"g3"}))?["adopted"],true);
    std::fs::rename(&held_git,&source_layout.git_dir)?;
    restored.godot_world_prepare_rebuild_source(&json!({"worldId":"g2"}))?;
    let recovered_copy=restored.godot_world_rebuild_plan(&json!({"worldId":"g2"}))?;
    assert_eq!(recovered_copy["rebuildRequired"],true);
    let (store,layout)=restored.content_layout("g2")?;
    assert_eq!(store.read_file(&layout,recovered_copy["contentOid"].as_str().unwrap(),"world.gd")?,SCRIPT.as_bytes());
    assert_eq!(restored.godot_project_index(&json!({"context":copy_context,"worldId":"g2"}))?["manifestHash"],g2_draft["manifestHash"]);
    let init=restored.godot_world_init_status(&json!({"worldId":"g1"}))?;
    assert_eq!(init["playable"],false);assert_eq!(init["rebuildRequired"],true);
    let plan=restored.godot_world_rebuild_plan(&json!({"worldId":"g1"}))?;
    assert_eq!(plan["rebuildRequired"],true);assert_eq!(plan["contentOid"],original_plan["contentOid"]);
    assert_ne!(plan["contentOid"],restored.content_status(&json!({"worldId":"g1"}))?["headOid"]);
    restored.content_branch_create(&json!({"worldId":"g1","branchId":plan["rebuildBranchId"],"fromRev":plan["contentOid"]}))?;
    let plan=restored.godot_world_rebuild_plan(&json!({"worldId":"g1"}))?;
    let context=ctx("restore-rebuild");restored.workspace_open(&context,"g1")?;
    let index=restored.godot_project_index(&json!({"context":context,"worldId":"g1","branchId":plan["rebuildBranchId"]}))?;
    let read=restored.godot_project_read(&json!({"context":context,"worldId":"g1","branchId":plan["rebuildBranchId"],"revision":index["revision"],"manifestHash":index["manifestHash"],"path":"world.gd"}))?;
    assert_eq!(read["text"],SCRIPT);
    register(&mut restored,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("restore fixture"))?;
    let job=restored.godot_build_start(&json!({"context":context,"worldId":"g1","branchId":plan["rebuildBranchId"],"toolCallId":"rebuild","revision":index["revision"],"manifestHash":index["manifestHash"],"mode":"check"}))?;
    let claimed=claim(&mut restored,&job,"token-a","executor-a")?;
    let artifacts=write_artifact(&claimed,"web/index.html",b"<html>rebuilt fixture</html>")?;
    let checked=finish(&mut restored,&job,"token-a",&output(&claimed,true,json!([{"id":"restore-fixture","passed":true,"detail":"synthetic core transaction fixture"}]),artifacts,json!([])))?;
    let current=restored.world_read("g1")?;
    assert_eq!(current.world.snapshot,saved.world.snapshot);
    let prepared=restored.godot_application_prepare(&json!({"id":"apply-rebuilt","token":"rebuild-token","worldId":"g1","candidateId":checked["candidateId"],"revision":current.summary.revision,"snapshot":current.world.snapshot}))?;
    let status=restored.content_status(&json!({"worldId":"g1"}))?;
    let operation=json!({"operationId":"apply-rebuilt","worldId":"g1","repoId":status["repoId"],"branchId":plan["rebuildBranchId"],"expectedHeadOid":plan["rebuildContentOid"],"expectedAppliedOid":status["appliedOid"],"expectedProgressRevision":current.summary.revision});
    restored.content_apply_prepare(&json!({"worldId":"g1","context":operation,"kind":"apply","targetOid":plan["rebuildContentOid"],"detail":"restore fixture"}))?;
    restored.content_apply_advance(&json!({"operationId":"apply-rebuilt"}))?;
    restored.godot_application_commit(&json!({"id":"apply-rebuilt","token":"rebuild-token","evidence":{"format":"craftmine.godot-application/2","inputHash":prepared["inputHash"],"launch":{"passed":true,"buildId":prepared["buildId"],"instanceId":"restore-fixture","stateHash":digest("fixture")},"player":null,"snapshot":current.world.snapshot}}))?;
    restored.content_apply_confirm(&json!({"operationId":"apply-rebuilt","applicationId":"apply-rebuilt","detail":"restore fixture confirmed"}))?;
    assert_eq!(restored.godot_world_init_status(&json!({"worldId":"g1"}))?["playable"],true);
    assert_eq!(restored.godot_runtime_describe(&json!({"worldId":"g1"}))?["snapshot"],saved.world.snapshot);
    assert_eq!(restored.godot_project_index(&json!({"context":context,"worldId":"g1"}))?["manifestHash"],draft["manifestHash"]);
    drop(restored);let restored=TaskJournal::open(&target.join("tasks.sqlite"))?;
    assert_eq!(restored.godot_runtime_describe(&json!({"worldId":"g1"}))?["snapshot"],saved.world.snapshot);
    Ok(())
}

fn progress(world: &str) -> Value {
    json!({"format":godot_runtime::PROGRESS_FORMAT,"worldId":world,"baseId":"first-person",
        "baseVersion":"0.1.0","stateVersion":1,
        "body":{"worldId":world,"player":{"position":[0,0,0]},"inventory":{}}})
}

fn initialize(journal: &mut TaskJournal, world: &str, base: &str) -> Result<Value> {
    journal.godot_world_initialize(&json!({"worldId":world,"title":"New World","baseId":"first-person",
        "baseBuild":base,"snapshot":progress(world)}))
}

#[test]
fn initialization_path_failure_is_hash_checked_finite_and_persistent() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = TaskJournal::open(&path)?;
    initialize(&mut journal, "g1", "base-a")?;
    let context = ctx("path-budget");
    journal.workspace_open(&context, "g1")?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let project = create_project_in(&mut journal, &context, "g1", "create-one")?;
    let job = journal.godot_build_start(&json!({"context":context,"worldId":"g1","toolCallId":"path-check",
        "revision":project["revision"],"manifestHash":project["manifestHash"],"mode":"check"}))?;
    let claimed = claim(&mut journal, &job, "path-token", "executor-a")?;
    let mut result = output(&claimed, false, json!([{"id":"executor.failed","passed":false}]), json!([]), json!(["GODOT_TASK_PATH_TOO_LONG"]));
    result["import"]["passed"] = json!(false);
    finish(&mut journal, &job, "path-token", &result)?;
    let before = journal.godot_world_init_status(&json!({"worldId":"g1"}))?;
    assert_eq!(before["reason"], "GODOT_TASK_PATH_TOO_LONG");
    assert_eq!(before["status"], "failed");assert_eq!(before["playable"], false);
    drop(journal);
    let mut journal = TaskJournal::open(&path)?;
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"g1"}))?["reason"], before["reason"]);
    // The exact recognized code cannot be read from a corrupt output row.
    journal.db.execute("UPDATE craftmine_godot_jobs SET output_hash='corrupt' WHERE id=?1", [job["jobId"].as_str().unwrap()])?;
    failed(journal.godot_world_init_status(&json!({"worldId":"g1"})), "CORRUPT_GODOT_JOB_OUTPUT");
    // Even hash-valid arbitrary text is not exposed through this new path.
    result["compile"]["errors"] = json!(["unknown C:/private/source"]);
    let body = serde_json::to_string(&result)?;
    journal.db.execute("UPDATE craftmine_godot_jobs SET output=?2,output_hash=?3 WHERE id=?1",
        params![job["jobId"].as_str().unwrap(), body, digest(&body)])?;
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"g1"}))?["reason"], "GODOT_JOB_FAILED");
    Ok(())
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
    applied_world_files(journal,world,project_files())
}

fn applied_world_files(journal: &mut TaskJournal, world: &str, files: Value) -> Result<()> {
    initialize(journal, world, "base-a")?;
    let context = ctx("one");
    journal.workspace_open(&context, world)?;
    register(journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let project = journal.godot_project_create(&json!({"context":context,"worldId":world,"toolCallId":"create-one",
        "baseBuild":"base-a","baseId":"first-person","files":files}))?;
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
    // The inherited source build is lineage evidence, not a runnable target
    // identity. A target must independently rebind, check and apply.
    let formal = journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g6",
        "title":"Formal Copy","progress":"formal"}))?;
    assert_eq!(formal["progressMode"], "formal");
    let inherited = journal.world_read("g6")?.world.snapshot;
    assert_eq!(inherited["worldId"], "g6");
    assert_eq!(inherited["body"]["worldId"], "g6");
    assert_eq!(inherited["body"]["inventory"], json!({"ore":9}));
    failed(journal.godot_runtime_describe(&json!({"worldId":"g6"})),"GODOT_COPY_REBUILD_REQUIRED");
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"g6"}))?["playable"],false);
    let descriptor = journal.runtime_describe_impl(&json!({"worldId":"g6"}),false)?;
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

/// A Git-backed world has no blob store: its commit is the content. Copying it
/// and describing it for backup must read that commit, not a blob that was
/// never written.
#[test]
fn a_git_backed_world_can_be_copied_and_described_from_its_commit() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = TaskJournal::open(&path)?;
    applied_world(&mut journal, "g1")?;
    journal.content_migrate_apply(&json!({"worldId":"g1"}))?;
    let status = journal.content_status(&json!({"worldId":"g1"}))?;
    assert_eq!(status["backend"], "git");
    assert!(status["headOid"].as_str().is_some_and(|oid| oid.len() >= 40));

    // Copy the Git-backed world. Its project bytes must come from the commit.
    let copied = journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g2",
        "title":"Git Copy","progress":"formal"}))?;
    assert_eq!(copied["sourceRevision"], 0);
    let copy_context = WorkspaceContext {
        project_id: "project-a".into(),
        session_id: "session-copy".into(),
        turn_id: "two".into(),
    };
    journal.workspace_open(&copy_context, "g2")?;
    let index = journal.godot_project_index(&json!({"context":&copy_context,"worldId":"g2"}))?;
    assert_eq!(index["revision"], 0);
    assert!(index["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file["path"] == "project.godot"));
    let read = journal.godot_project_read(&json!({"context":&copy_context,"worldId":"g2",
        "revision":0,"manifestHash":index["manifestHash"],"path":"project.godot"}))?;
    assert_eq!(read["text"], PROJECT);

    // The backup descriptor of the Git-backed source proves the live commit.
    let snapshot =
        journal.godot_world_backup_snapshot(&json!({"worldId":"g1","context":ctx("one")}))?;
    assert_eq!(snapshot["project"]["revision"], 0);
    assert!(snapshot["project"]["files"].as_array().unwrap().len() >= 3);
    let verified = journal.godot_world_verify_snapshot(&json!({"worldId":"g1","context":ctx("one"),
        "snapshot":snapshot}))?;
    assert_eq!(verified["matches"], true);
    Ok(())
}
