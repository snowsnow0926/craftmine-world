use super::*;
use crate::godot_test_support::*;
use crate::digest;
use rusqlite::params;

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
    // The same project API now writes a real commit instead of a second history.
    let head = status["headOid"].as_str().unwrap().to_string();
    let repo = status["repoId"].as_str().unwrap().to_string();
    let operation = |operation_id: &str, expected: Option<&str>| {
        json!({"operationId":operation_id,"worldId":"a","repoId":repo,"branchId":"main",
            "expectedHeadOid":expected,"expectedAppliedOid":null,"expectedProgressRevision":null})
    };
    let request = |call: &str, op: Value| {
        json!({"context":&context,"worldId":"a","toolCallId":call,"revision":project["revision"],
            "manifestHash":project["manifestHash"],"operation":op,
            "operations":[{"op":"put","path":"after.gd","text":"extends Node\n","expectedHash":null}]})
    };
    // A missing or stale expected HEAD cannot write over a moved branch.
    failed(
        journal.godot_project_patch(&json!({"context":&context,"worldId":"a","toolCallId":"patch-no-op",
            "revision":project["revision"],"manifestHash":project["manifestHash"],
            "operations":[{"op":"put","path":"after.gd","text":"extends Node\n","expectedHash":null}]})),
        "CONTENT_OPERATION_CONTEXT_REQUIRED",
    );
    failed(
        journal.godot_project_patch(&request("patch-stale", operation("op-stale", Some("deadbeef")))),
        "CONTENT_EXPECTED_HEAD_MISMATCH",
    );
    failed(
        journal.godot_project_patch(&request("patch-other-branch",
            json!({"operationId":"op-branch","worldId":"a","repoId":repo,"branchId":"idea",
                "expectedHeadOid":head,"expectedAppliedOid":null,"expectedProgressRevision":null}))),
        "CONTENT_WRITE_BRANCH_NOT_MAIN",
    );
    let patched =
        journal.godot_project_patch(&request("patch-after", operation("op-patch", Some(&head))))?;
    assert_eq!(patched["revision"], 1);
    assert_ne!(patched["commitOid"].as_str().unwrap(), head);
    assert_eq!(patched["assetLockHash"].as_str().unwrap().len(), 64);
    // Only the migrated row exists in the legacy table: no parallel history.
    let legacy_rows: i64 = journal.db.query_row(
        "SELECT COUNT(*) FROM craftmine_godot_revisions WHERE world_id='a'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(legacy_rows, 1);
    // The new commit is the head and the file is readable from Git.
    let status = journal.content_status(&json!({"worldId":"a"}))?;
    assert_eq!(status["headOid"], patched["commitOid"]);
    let file = journal.content_read_file(&json!({"worldId":"a","rev":patched["commitOid"],
        "path":"after.gd"}))?;
    assert_eq!(file["text"], "extends Node\n");
    // The initialising create path is refused for a Git-backed world too.
    failed(
        journal.godot_project_create(&json!({"context":&context,"worldId":"a","toolCallId":"create-after",
            "baseBuild":"base-a","baseId":"first-person","files":project_files()})),
        "GODOT_PROJECT_ALREADY_EXISTS",
    );
    Ok(())
}

#[test]
fn a_migrated_world_builds_from_git_and_a_moved_commit_makes_its_candidate_stale() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    journal.content_migrate_apply(&json!({"worldId":"a"}))?;
    register(&mut journal, "executor-a", json!({"import":true,"build":true,"check":true}), &digest("e"))?;
    let job = journal.godot_build_start(&json!({"context":&context,"worldId":"a","toolCallId":"check-git",
        "revision":project["revision"],"manifestHash":project["manifestHash"],"mode":"check"}))?;
    assert_eq!(job["status"], "queued");
    let claimed = claim(&mut journal, &job, "token-a", "executor-a")?;
    assert_eq!(claimed["files"]["source"].as_array().unwrap().len(), 3);
    // The build copy came from the commit and its identity carries the content ref.
    let build_id = job["buildId"].as_str().unwrap();
    let status = journal.content_status(&json!({"worldId":"a"}))?;
    let (content_oid, lock_hash): (String, String) = journal.db.query_row(
        "SELECT content_oid,asset_lock_hash FROM craftmine_godot_builds WHERE world_id='a' AND build_id=?1",
        [build_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    assert_eq!(content_oid, status["headOid"]);
    assert_eq!(lock_hash.len(), 64);
    let artifacts = write_artifact(&claimed, "web/index.html", b"<html></html>")?;
    let checked = finish(
        &mut journal,
        &job,
        "token-a",
        &output(&claimed, true, json!([{"id":"x","passed":true}]), artifacts, json!([])),
    )?;
    assert_eq!(checked["status"], "passed");
    let candidate = checked["candidateId"].as_str().unwrap().to_string();
    // A commit that landed without its index row (the crash window) leaves the
    // source revision unchanged but the content moved: the candidate is stale.
    let head = status["headOid"].as_str().unwrap().to_string();
    let repo = status["repoId"].as_str().unwrap().to_string();
    let patched = journal.godot_project_patch(&json!({"context":&context,"worldId":"a",
        "toolCallId":"patch-git","revision":project["revision"],"manifestHash":project["manifestHash"],
        "operation":{"operationId":"op-1","worldId":"a","repoId":repo,"branchId":"main",
            "expectedHeadOid":head,"expectedAppliedOid":null,"expectedProgressRevision":null},
        "operations":[{"op":"put","path":"new.gd","text":"extends Node\n","expectedHash":null}]}))?;
    journal.db.execute(
        "UPDATE craftmine_godot_project_commits SET commit_oid=?2 WHERE world_id='a' AND revision=0",
        params![project["revision"].as_i64(), patched["commitOid"].as_str().unwrap()],
    )?;
    failed(
        journal.godot_application_prepare(&json!({"id":"apply-git","token":"t","candidateId":candidate,
            "worldId":"a","revision":project["revision"],"snapshot":journal.world_read("a")?.world.snapshot})),
        "GODOT_CANDIDATE_STALE",
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

