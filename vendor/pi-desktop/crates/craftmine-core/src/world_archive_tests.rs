use super::*;
use crate::godot_test_support::*;
use serde_json::json;

fn failed_world(journal: &mut TaskJournal) -> Result<(crate::WorkspaceContext, Value)> {
    let snapshot=json!({"format":"craftmine.godot-progress/1","worldId":"failed-world","baseId":"first-person","baseVersion":"0.1.0","stateVersion":1,"body":{"worldId":"failed-world","player":{"position":[0,0,0]},"inventory":{}}});
    journal.godot_world_initialize(&json!({"worldId":"failed-world","title":"Failed work","baseId":"first-person","baseBuild":"base-a","snapshot":snapshot}))?;
    let context=ctx("failed-create");journal.workspace_open(&context,"failed-world")?;
    let project=create_project_in(journal,&context,"failed-world","create-source")?;
    journal.content_migrate_apply(&json!({"worldId":"failed-world"}))?;
    let job=journal.godot_build_start(&json!({"context":context,"worldId":"failed-world","toolCallId":"check-source","revision":project["revision"],"manifestHash":project["manifestHash"],"mode":"check"}))?;
    assert_eq!(job["status"],"blocked","no executor is deliberately installed in this core-only fixture");
    Ok((context,job))
}

#[test]
fn world_archive_failed_preserves_world_draft_job_and_session_across_restart_and_restore() -> Result<()> {
    let (_dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;
    let (context,job)=failed_world(&mut journal)?;
    journal.workspace_end_turn(&context.session_id,&context.turn_id,"error")?;
    let original=journal.world_read("failed-world")?;
    let content=journal.content_status(&json!({"worldId":"failed-world"}))?;
    let request=json!({"id":"failed-world","revision":original.summary.revision,"baseBuild":original.world.build["id"]});
    assert_eq!(journal.world_archive_failed(&request)?["archived"],true);
    assert_eq!(journal.world_archive_failed(&request)?["archived"],true);
    assert!(journal.world_list()?.is_empty());assert_eq!(journal.world_archived_list()?.len(),1);
    assert_eq!(journal.world_read("failed-world")?,original);
    assert_eq!(journal.content_status(&json!({"worldId":"failed-world"}))?["headOid"],content["headOid"]);
    assert_eq!(journal.godot_build_read(&json!({"worldId":"failed-world","jobId":job["jobId"]}))?["status"],"blocked");
    failed(journal.workspace_open(&ctx("new-turn"),"failed-world"),"WORLD_ARCHIVED");
    failed(journal.godot_application_prepare(&json!({"id":"late-preview","token":"preview-token","candidateId":"gcan-stale","worldId":"failed-world","revision":0,"snapshot":original.world.snapshot})),"WORLD_ARCHIVED");
    failed(journal.world_save_progress("failed-world",original.summary.revision,"base-a",&original.world.snapshot),"WORLD_ARCHIVED");
    drop(journal);let mut journal=TaskJournal::open(&path)?;
    assert!(journal.world_list()?.is_empty());assert_eq!(journal.world_archived_list()?.len(),1);
    assert_eq!(journal.world_read("failed-world")?,original);
    assert_eq!(journal.world_restore_archived("failed-world")?["archived"],false);
    assert_eq!(journal.world_restore_archived("failed-world")?["archived"],false);
    assert_eq!(journal.world_list()?.len(),1);assert!(journal.world_archived_list()?.is_empty());
    failed(journal.workspace_open(&ctx("restored-turn"),"failed-world"),"EXPLICIT_RECOVERY_REQUIRED");
    let mut restored_context=ctx("restored-turn");restored_context.session_id="restored-session".into();
    journal.workspace_open(&restored_context,"failed-world")?;
    assert_eq!(journal.world_read("failed-world")?,original);
    assert_eq!(journal.content_status(&json!({"worldId":"failed-world"}))?["headOid"],content["headOid"]);
    Ok(())
}

#[test]
fn world_archive_failed_rejects_active_lease_stale_revision_build_and_unknown_fields() -> Result<()> {
    let (_dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;
    let (context,_)=failed_world(&mut journal)?;let original=journal.world_read("failed-world")?;
    let request=json!({"id":"failed-world","revision":0,"baseBuild":"base-a"});
    failed(journal.world_archive_failed(&request),"WORLD_REMOVAL_BUSY");
    journal.workspace_end_turn(&context.session_id,&context.turn_id,"error")?;
    let mut stale=request.clone();stale["revision"]=json!(99);failed(journal.world_archive_failed(&stale),"WORLD_REVISION_CONFLICT");
    stale=request.clone();stale["baseBuild"]=json!("other-build");failed(journal.world_archive_failed(&stale),"WORLD_BUILD_CONFLICT");
    stale=request.clone();stale["deleteFiles"]=json!(true);failed(journal.world_archive_failed(&stale),"unknown field");
    assert_eq!(journal.world_read("failed-world")?,original);assert_eq!(journal.world_list()?.len(),1);assert!(journal.world_archived_list()?.is_empty());
    Ok(())
}

#[test]
fn world_archive_failed_marker_and_preserved_git_sources_survive_portable_backup_restore() -> Result<()> {
    let (_dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;
    let (context,_)=failed_world(&mut journal)?;journal.workspace_end_turn(&context.session_id,&context.turn_id,"error")?;
    let original=journal.world_read("failed-world")?;let content=journal.content_status(&json!({"worldId":"failed-world"}))?;
    journal.world_archive_failed(&json!({"id":"failed-world","revision":0,"baseBuild":"base-a"}))?;
    let archive_dir=tempfile::tempdir()?;let archive=archive_dir.path().join("deleted-world.cmarchive");
    journal.backup_export_portable(&json!({"operationId":"export-removed","archivePath":archive.to_string_lossy()}))?;
    let restored_root=tempfile::tempdir()?;let target=restored_root.path().join("data");let mut restored=TaskJournal::open(&target.join("tasks.sqlite"))?;
    restored.backup_restore_portable(&json!({"operationId":"restore-removed","archivePath":archive.to_string_lossy(),"targetDirectory":target.to_string_lossy()}))?;
    assert!(restored.world_list()?.is_empty());assert_eq!(restored.world_archived_list()?.len(),1);
    assert_eq!(restored.world_read("failed-world")?,original);
    restored.world_restore_archived("failed-world")?;
    assert_eq!(restored.content_status(&json!({"worldId":"failed-world"}))?["headOid"],content["headOid"]);
    assert_eq!(restored.world_list()?.len(),1);
    Ok(())
}
