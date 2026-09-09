use super::*;
use crate::godot_test_support::*;

#[test]
fn content_git_program_is_reported_with_its_real_source() -> Result<()> {
    let (_dir, path) = temp()?;
    let journal = TaskJournal::open(&path)?;
    let info = journal.content_git_info(&json!({}))?;
    assert_eq!(info["format"], "craftmine.git-info/1");
    assert!(info["version"].as_str().is_some_and(|value| !value.is_empty()));
    // Honest provenance: a PATH fallback is never reported as bundled.
    assert!(matches!(
        info["source"].as_str(),
        Some("bundled" | "pathFallback")
    ));
    assert_eq!(info["sha256"].as_str().unwrap().len(), 64);
    assert_eq!(info["minimum"]["major"], 2);
    Ok(())
}

#[test]
fn legacy_revisions_migrate_to_git_and_the_legacy_writer_is_refused() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    let before = journal.content_status(&json!({"worldId":"a"}))?;
    assert_eq!(before["registered"], false);
    let plan = journal.content_migrate_plan(&json!({"worldId":"a"}))?;
    assert_eq!(plan["problems"].as_array().unwrap().len(), 0);
    assert_eq!(plan["revisions"].as_array().unwrap().len(), 1);
    let report = journal.content_migrate_apply(&json!({"worldId":"a"}))?;
    assert_eq!(report["imported"], 1);
    assert_eq!(report["problems"].as_array().unwrap().len(), 0);
    let status = journal.content_status(&json!({"worldId":"a"}))?;
    assert_eq!(status["backend"], "git");
    assert_eq!(status["registered"], true);
    assert!(status["headOid"].as_str().is_some_and(|oid| oid.len() >= 40));
    assert_eq!(status["migratedRevisions"], 1);
    // The migrated history is readable through Git and keeps its legacy origin.
    let history = journal.content_history(&json!({"worldId":"a","limit":10}))?;
    assert_eq!(history["records"].as_array().unwrap().len(), 1);
    assert_eq!(history["records"][0]["legacyRevision"], 0);
    assert_eq!(history["records"][0]["legacyManifestHash"], project["manifestHash"]);
    // Git bytes still match the legacy blobs.
    let verified = journal.content_migrate_verify(&json!({"worldId":"a"}))?;
    assert_eq!(verified["verified"], true);
    // A world on the Git backend must not grow a second source history.
    failed(
        journal.godot_project_patch(&json!({"context":&context,"worldId":"a","toolCallId":"patch-after",
            "revision":project["revision"],"manifestHash":project["manifestHash"],
            "operations":[{"op":"put","path":"after.gd","text":"extends Node\n","expectedHash":null}]})),
        "CONTENT_BACKEND_SWITCHED",
    );
    failed(
        journal.godot_project_create(&json!({"context":&context,"worldId":"a","toolCallId":"create-after",
            "baseBuild":"base-a","baseId":"first-person","files":project_files()})),
        "CONTENT_BACKEND_SWITCHED",
    );
    Ok(())
}

#[test]
fn branches_versions_and_file_reads_come_from_the_git_history() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    create_project(&mut journal, &context)?;
    journal.content_migrate_apply(&json!({"worldId":"a"}))?;
    let status = journal.content_status(&json!({"worldId":"a"}))?;
    let head = status["headOid"].as_str().unwrap().to_string();
    // Read a real file out of the commit, both as text and as bytes.
    let file = journal.content_read_file(&json!({"worldId":"a","rev":head,"path":"world.gd"}))?;
    assert_eq!(file["text"], SCRIPT);
    assert_eq!(file["sha256"].as_str().unwrap().len(), 64);
    let encoded = journal.content_read_file(&json!({"worldId":"a","rev":head,"path":"world.gd",
        "encoding":"base64"}))?;
    assert!(encoded["base64"].as_str().is_some());
    // A branch starts at the same content without rewriting it.
    let branch = journal.content_branch_create(&json!({"worldId":"a","branchId":"idea-one",
        "fromRev":head,"title":"idea"}))?;
    assert_eq!(branch["fromOid"], head);
    let listed = journal.content_branch_list(&json!({"worldId":"a"}))?;
    let names: Vec<&str> = listed["branches"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|entry| entry["name"].as_str())
        .collect();
    assert!(names.contains(&"refs/heads/idea-one"));
    assert!(names.contains(&"refs/heads/main"));
    // A named version pins the commit with an annotated tag.
    let version = journal.content_version_create(&json!({"worldId":"a","versionId":"v1",
        "rev":head,"message":"first playable"}))?;
    assert_eq!(version["oid"], head);
    let versions = journal.content_version_list(&json!({"worldId":"a"}))?;
    assert_eq!(versions["versions"].as_array().unwrap().len(), 1);
    // Reclaim planning protects the head, branches and versions.
    let plan = journal.content_reclaim_plan(&json!({"worldId":"a"}))?;
    assert!(plan["garbageObjects"].as_u64().unwrap_or(1) == 0);
    Ok(())
}
