//! Real SQLite/Git copy and reopen tests. Check/application receipts below are
//! explicit core fixtures; they do not claim native engine/gameplay acceptance.
use super::*;
use crate::godot_test_support::*;

fn progress(world:&str)->Value {
    json!({"format":"craftmine.godot-progress/1","worldId":world,"baseId":"mining-sandbox","baseVersion":"1.0.0","stateVersion":1,
      "body":{"format":"craftmine.godot-mining-sandbox-managed/1","worldId":world,"baseId":"mining-sandbox","baseVersion":"1.0.0","stateVersion":1,
        "seed":31415926,"mapSize":[96,48],"terrainHash":"fixed-terrain-fixture","chunks":{"0_0":{"revision":2,"cells":[[8,12,"air"],[9,12,"stone_brick"]]}},
        "state":{"format":"craftmine.godot-mining-sandbox-state/1","worldId":world,"stateVersion":1,"player":{"tile":[8,12],"position":[136,192],"facing":"right","health":3},
          "inventory":{"stone":5,"stone_brick":2},"tools":[],"equipped":"","flags":[{"id":"g1"}],"chunkIndex":{},"editCount":2,"terrainHash":"fixed-terrain-fixture","worldRevision":2,
          "ledger":[{"requestId":"g1","result":{"detail":"g1 is an authored value"}}],"ledgerEvicted":0}}})
}

fn applied_mine(journal:&mut TaskJournal)->Result<()> {
    let snapshot=progress("g1");
    journal.godot_world_initialize(&json!({"worldId":"g1","title":"Mine","baseId":"mining-sandbox","baseBuild":"base-a","snapshot":snapshot}))?;
    let context=ctx("mining-copy");journal.workspace_open(&context,"g1")?;
    register(journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("core mining copy fixture"))?;
    let mut files=project_files();
    files[0]["text"]=json!(format!("{PROJECT}\n[craftmine]\nruntime/world_id=\"g1\"\nruntime/enabled=true\n"));
    files.as_array_mut().unwrap().push(json!({"path":"world.json","text":r#"{ "format":"craftmine.godot-mining-sandbox-world/1", "baseId":"mining-sandbox", "worldId":"g1", "entities":[{"id":"g1"}], "notes":"g1" }"#}));
    let project=journal.godot_project_create(&json!({"context":context,"worldId":"g1","toolCallId":"mine-create","baseBuild":"base-a","baseId":"mining-sandbox","files":files}))?;
    let job=journal.godot_build_start(&json!({"context":context,"worldId":"g1","toolCallId":"mine-check","revision":project["revision"],"manifestHash":project["manifestHash"],"mode":"check"}))?;
    let claimed=claim(journal,&job,"mine-token","executor-a")?;
    let artifacts=write_artifact(&claimed,"web/index.html",b"<html>synthetic core mining fixture</html>")?;
    let checked=finish(journal,&job,"mine-token",&output(&claimed,true,json!([{"id":"core-fixture","passed":true,"detail":"not engine acceptance"}]),artifacts,json!([])))?;
    let prepared=journal.godot_application_prepare(&json!({"id":"mine-apply","token":"mine-apply-token","candidateId":checked["candidateId"],"worldId":"g1","revision":0,"snapshot":snapshot}))?;
    journal.godot_application_commit(&json!({"id":"mine-apply","token":"mine-apply-token","evidence":{"format":"craftmine.godot-application/2","inputHash":prepared["inputHash"],"launch":{"passed":true,"buildId":prepared["buildId"],"instanceId":"core-fixture","stateHash":digest("fixture")},"player":null,"snapshot":snapshot}}))?;
    Ok(())
}

#[test]
fn mining_copy_preserves_all_progress_and_exact_formal_parent_and_draft_after_reopen()->Result<()> {
    let (_dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;applied_mine(&mut journal)?;
    journal.content_migrate_apply(&json!({"worldId":"g1"}))?;
    let original=journal.world_read("g1")?.world.snapshot;
    journal.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g2","title":"Copied mine","progress":"formal"}))?;
    let mut expected=original.clone();expected["worldId"]=json!("g2");expected["body"]["worldId"]=json!("g2");expected["body"]["state"]["worldId"]=json!("g2");
    assert_eq!(journal.world_read("g2")?.world.snapshot,expected);
    let initial=journal.godot_world_rebuild_plan(&json!({"worldId":"g2"}))?;
    let (store,layout)=journal.content_layout("g2")?;
    let parent=store.branch_head(&layout,"main")?.unwrap();let mut draft_files=Vec::new();
    for entry in store.tree_entries(&layout,&parent)? {
        let bytes=if entry.path=="world.gd" {b"extends Node3D\n# player draft g1 untouched\n".to_vec()}else{store.read_file(&layout,&parent,&entry.path)?};
        draft_files.push(crate::content_history::repo::ContentFile{path:entry.path,bytes});
    }
    let draft=store.commit_ref(&layout,"refs/heads/main",Some(&parent),&draft_files,"Keep mining draft")?;
    let bound=journal.godot_world_prepare_copy_runtime(&json!({"worldId":"g2"}))?;
    assert_eq!(bound["sourceParentOid"],initial["contentOid"]);
    let formal=bound["contentOid"].as_str().unwrap();
    assert_eq!(store.history(&layout,formal,0,1)?.records[0].parents,vec![initial["contentOid"].as_str().unwrap().to_string()]);
    assert_eq!(store.read_file(&layout,formal,"world.gd")?,SCRIPT.as_bytes());
    let metadata:Value=serde_json::from_slice(&store.read_file(&layout,formal,"world.json")?)?;
    assert_eq!(metadata["worldId"],"g2");assert_eq!(metadata["entities"][0]["id"],"g1");assert_eq!(metadata["notes"],"g1");
    let draft_bound=bound["draftTransform"]["contentOid"].as_str().unwrap();
    assert_eq!(bound["draftTransform"]["sourceParentOid"],draft);assert_ne!(draft_bound,formal);
    assert_eq!(store.read_file(&layout,draft_bound,"world.gd")?,b"extends Node3D\n# player draft g1 untouched\n");
    assert_eq!(journal.world_read("g1")?.world.snapshot,original);
    drop(journal);let mut reopened=TaskJournal::open(&path)?;
    assert_eq!(reopened.world_read("g2")?.world.snapshot,expected);
    let replay=reopened.godot_world_prepare_copy_runtime(&json!({"worldId":"g2"}))?;
    assert_eq!(replay["replayed"],true);assert_eq!(replay["contentOid"],bound["contentOid"]);assert_eq!(replay["draftTransform"]["alreadyBound"],true);
    let mut bad=progress("g3");bad["body"]["state"]["worldId"]=json!("foreign");
    failed(reopened.godot_world_copy(&json!({"sourceWorldId":"g1","targetWorldId":"g3","title":"Invalid mine","progress":"initial","snapshot":bad})),"GODOT_COPY_PROGRESS_IDENTITY_MISMATCH");
    assert!(reopened.world_read("g3").is_err());
    Ok(())
}

#[test]
fn mining_copy_rejects_unknown_or_mixed_native_identity_without_mutating_source()->Result<()> {
    let original=progress("g1");let mut bad=original.clone();bad["body"]["state"]["worldId"]=json!("foreign");
    failed(rebind_copy_progress(&bad,"g1","g2"),"GODOT_COPY_PROGRESS_IDENTITY_MISMATCH");
    bad=original.clone();bad["body"]["format"]=json!("unrecognized-native-format");
    failed(rebind_copy_progress(&bad,"g1","g2"),"GODOT_COPY_PROGRESS_IDENTITY_MISMATCH");
    assert_eq!(original,progress("g1"));Ok(())
}
