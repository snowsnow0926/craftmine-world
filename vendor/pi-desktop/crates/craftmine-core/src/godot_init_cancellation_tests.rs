use super::*;
use crate::godot_test_support::*;

fn initialize(journal:&mut TaskJournal)->Result<Value>{
    journal.godot_world_initialize(&json!({"worldId":"cancel-world","title":"Cancelled creation","baseId":"first-person","baseBuild":"base-a","snapshot":{"format":"craftmine.godot-progress/1","worldId":"cancel-world","baseId":"first-person","baseVersion":"0.1.0","stateVersion":1,"body":{"worldId":"cancel-world","player":{"position":[0,0,0]},"inventory":{}}}}))
}
fn check_to_candidate(journal:&mut TaskJournal,context:&WorkspaceContext,world:&str,project:&Value,call:&str)->Result<Value>{
    let job=journal.godot_build_start(&json!({"context":context,"worldId":world,"toolCallId":call,"revision":project["revision"],"manifestHash":project["manifestHash"],"mode":"check"}))?;
    let claimed=claim(journal,&job,"token-a","executor-a")?;
    let artifacts=write_artifact(&claimed,"web/index.html",b"<html>core transaction fixture</html>")?;
    finish(journal,&job,"token-a",&output(&claimed,true,json!([{"id":"core.fixture","passed":true,"detail":"synthetic transaction fixture, not engine execution"}]),artifacts,json!([])))
}

#[test]
fn initialization_cancel_is_durable_before_a_job_exists_and_only_explicit_retry_clears_it()->Result<()>{
    let (_dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;initialize(&mut journal)?;
    let original=journal.world_read("cancel-world")?;
    assert_eq!(journal.godot_world_init_cancel(&json!({"worldId":"cancel-world"}))?["status"],"cancelled");
    assert_eq!(journal.godot_world_init_cancel(&json!({"worldId":"cancel-world"}))?["cancelled"],true);
    drop(journal);let mut journal=TaskJournal::open(&path)?;
    for _ in 0..3{let status=journal.godot_world_init_status(&json!({"worldId":"cancel-world"}))?;assert_eq!(status["status"],"cancelled");assert_eq!(status["reason"],"GODOT_INITIALIZATION_CANCELLED");}
    assert_eq!(journal.world_read("cancel-world")?,original);
    journal.godot_world_init_cancel_clear(&json!({"worldId":"cancel-world"}))?;
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"cancel-world"}))?["status"],"pending");
    assert_eq!(journal.world_read("cancel-world")?,original);Ok(())
}

#[test]
fn initialization_cancel_requires_owned_jobs_and_leases_to_settle_and_preserves_checked_candidate()->Result<()>{
    let (_dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;initialize(&mut journal)?;let context=ctx("cancel-create");journal.workspace_open(&context,"cancel-world")?;
    register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("core-fixture"))?;
    let project=create_project_in(&mut journal,&context,"cancel-world","cancel-source")?;
    let checked=check_to_candidate(&mut journal,&context,"cancel-world",&project,"cancel-check")?;
    failed(journal.godot_world_init_cancel(&json!({"worldId":"cancel-world"})),"GODOT_INITIALIZATION_CANCEL_BUSY");
    journal.workspace_end_turn(&context.session_id,&context.turn_id,"aborted")?;
    journal.godot_world_init_cancel(&json!({"worldId":"cancel-world"}))?;
    let status=journal.godot_world_init_status(&json!({"worldId":"cancel-world"}))?;assert_eq!(status["status"],"cancelled");assert_eq!(status["candidateId"],checked["candidateId"]);
    journal.godot_world_init_cancel_clear(&json!({"worldId":"cancel-world"}))?;
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"cancel-world"}))?["status"],"checked");Ok(())
}

#[test]
fn initialization_cancel_after_durable_first_commit_is_noop_and_never_cancels_formal_play()->Result<()>{
    let (_dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;initialize(&mut journal)?;let context=ctx("commit-wins");journal.workspace_open(&context,"cancel-world")?;
    register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("core-fixture"))?;
    let project=create_project_in(&mut journal,&context,"cancel-world","commit-source")?;let checked=check_to_candidate(&mut journal,&context,"cancel-world",&project,"commit-check")?;
    let snapshot=journal.world_read("cancel-world")?.world.snapshot;
    let prepared=journal.godot_application_prepare(&json!({"id":"commit-before-cancel","token":"commit-token","worldId":"cancel-world","candidateId":checked["candidateId"],"revision":0,"snapshot":snapshot}))?;
    // Synthetic checked/launch receipts verify core transaction ordering only.
    journal.godot_application_commit(&json!({"id":"commit-before-cancel","token":"commit-token","evidence":{"format":"craftmine.godot-application/2","inputHash":prepared["inputHash"],"launch":{"passed":true,"buildId":prepared["buildId"],"instanceId":"core-fixture","stateHash":digest("state")},"player":null,"snapshot":snapshot}}))?;
    let formal=journal.world_read("cancel-world")?;
    assert_eq!(journal.godot_world_init_cancel(&json!({"worldId":"cancel-world"}))?["status"],"ready");assert_eq!(journal.world_read("cancel-world")?,formal);
    assert_eq!(journal.godot_world_init_status(&json!({"worldId":"cancel-world"}))?["playable"],true);Ok(())
}

#[test]
fn initialization_cancel_marker_survives_portable_backup_and_recoverable_deletion()->Result<()>{
    let (_dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;initialize(&mut journal)?;journal.godot_world_init_cancel(&json!({"worldId":"cancel-world"}))?;
    journal.world_archive_failed(&json!({"id":"cancel-world","revision":0,"baseBuild":"base-a"}))?;
    let archive_dir=tempfile::tempdir()?;let archive=archive_dir.path().join("cancelled.cmarchive");journal.backup_export_portable(&json!({"operationId":"cancel-export","archivePath":archive.to_string_lossy()}))?;
    let restored_dir=tempfile::tempdir()?;let target=restored_dir.path().join("data");let mut restored=TaskJournal::open(&target.join("tasks.sqlite"))?;
    restored.backup_restore_portable(&json!({"operationId":"cancel-restore","archivePath":archive.to_string_lossy(),"targetDirectory":target.to_string_lossy()}))?;
    assert_eq!(restored.world_archive_status("cancel-world")?["archived"],true);restored.world_restore_archived("cancel-world")?;
    assert_eq!(restored.godot_world_init_status(&json!({"worldId":"cancel-world"}))?["status"],"cancelled");Ok(())
}
