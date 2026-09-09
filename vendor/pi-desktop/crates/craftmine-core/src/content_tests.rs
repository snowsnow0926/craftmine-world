use super::*;
use crate::godot_test_support::*;
use crate::digest;
use rusqlite::params;

#[test]
fn two_branches_edit_check_and_apply_independently_without_replacing_main() -> Result<()> {
    let (_dir,path)=temp()?; let mut journal=setup(&path)?; let context=ctx("one");
    let main=create_project(&mut journal,&context)?;
    journal.content_migrate_apply(&json!({"worldId":"a"}))?;
    let original=journal.content_status(&json!({"worldId":"a"}))?;
    register(&mut journal,"executor-a",json!({"import":true,"build":true,"check":true}),&digest("branches"))?;
    let mut candidates=Vec::new();
    for branch in ["forest","cave"] {
        let created=journal.content_branch_create(&json!({"worldId":"a","branchId":branch,"fromRev":original["headOid"]}))?;
        let indexed=journal.godot_project_index(&json!({"context":context,"worldId":"a","branchId":branch}))?;
        let operation=json!({"operationId":format!("edit-{branch}"),"worldId":"a","repoId":original["repoId"],"branchId":branch,
            "expectedHeadOid":created["headOid"],"expectedAppliedOid":null,"expectedProgressRevision":0});
        let patched=journal.godot_project_patch(&json!({"context":context,"worldId":"a","toolCallId":format!("patch-{branch}"),
            "revision":indexed["revision"],"manifestHash":indexed["manifestHash"],"operation":operation,
            "operations":[{"op":"put","path":"branch.gd","text":format!("extends Node\nconst NAME = '{branch}'\n"),"expectedHash":null}]}))?;
        assert_eq!(patched["branchId"],branch);
        let job=journal.godot_build_start(&json!({"context":context,"worldId":"a","branchId":branch,"toolCallId":format!("check-{branch}"),
            "revision":patched["revision"],"manifestHash":patched["manifestHash"],"mode":"check"}))?;
        let claimed=claim(&mut journal,&job,"token-a","executor-a")?;
        let artifacts=write_artifact(&claimed,"web/index.html",b"<html>fixed fixture</html>")?;
        let done=finish(&mut journal,&job,"token-a",&output(&claimed,true,json!([{"id":"branch.fixture","passed":true}]),artifacts,json!([])))?;
        let candidate=journal.godot_candidate_read(&json!({"worldId":"a","candidateId":done["candidateId"]}))?;
        assert_eq!(candidate["candidate"]["content"]["branchId"],branch);
        assert_eq!(candidate["candidate"]["content"]["contentOid"],patched["commitOid"]);
        candidates.push((branch,patched,job,done));
    }
    assert_ne!(candidates[0].1["revision"],candidates[1].1["revision"]);
    assert_eq!(journal.godot_project_index(&json!({"context":context,"worldId":"a"}))?["manifestHash"],main["manifestHash"]);
    assert_eq!(journal.content_status(&json!({"worldId":"a"}))?["headOid"],original["headOid"]);
    for (branch,patched,job,done) in candidates {
        let before=journal.world_read("a")?;
        let app_id=format!("apply-{branch}"); let op_id=format!("content-{branch}");
        let prepared=journal.godot_application_prepare(&json!({"id":app_id,"token":"t","candidateId":done["candidateId"],
            "worldId":"a","revision":before.summary.revision,"snapshot":before.world.snapshot}))?;
        let status=journal.content_status(&json!({"worldId":"a"}))?;
        let request=json!({"worldId":"a","context":{"operationId":op_id,"worldId":"a","repoId":original["repoId"],"branchId":branch,
            "expectedHeadOid":patched["commitOid"],"expectedAppliedOid":status["appliedOid"],"expectedProgressRevision":before.summary.revision},
            "kind":"apply","targetOid":patched["commitOid"],"detail":"branch apply"});
        journal.content_apply_prepare(&request)?;
        journal.content_apply_advance(&json!({"operationId":op_id}))?;
        journal.godot_application_commit(&json!({"id":app_id,"token":"t","evidence":{"format":"craftmine.godot-application/1",
            "inputHash":prepared["inputHash"],"launch":{"passed":true,"buildId":job["buildId"],"instanceId":format!("instance-{branch}"),
                "stateHash":digest(branch)},"player":before.world.snapshot["player"]}}))?;
        let confirmed=journal.content_apply_confirm(&json!({"operationId":op_id,"applicationId":app_id,"detail":"confirmed"}))?;
        assert_eq!(confirmed["state"],"committed");
        assert_eq!(journal.content_apply_prepare(&request)?,confirmed);
        assert_eq!(journal.world_read("a")?.world.build["godot"]["sourceRevision"],patched["revision"]);
    }
    drop(journal);let mut journal=TaskJournal::open(&path)?;
    assert_eq!(journal.content_status(&json!({"worldId":"a"}))?["headOid"],original["headOid"]);
    assert_eq!(journal.content_apply_confirm(&json!({"operationId":"content-forest","applicationId":"apply-forest","detail":"lost old reply"}))?["state"],"committed");
    Ok(())
}

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
        "CONTENT_BRANCH_NOT_FOUND",
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

/// A content apply is committed only when a formally applied, launch-confirmed
/// deployment binds the exact Git commit. A caller-supplied object id or a
/// free-text claim can no longer mark content applied.
#[test]
fn a_content_apply_is_confirmed_only_by_a_launch_confirmed_deployment() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let project = create_project(&mut journal, &context)?;
    journal.content_migrate_apply(&json!({"worldId":"a"}))?;
    let status = journal.content_status(&json!({"worldId":"a"}))?;
    let repo = status["repoId"].as_str().unwrap().to_string();
    let head = status["headOid"].as_str().unwrap().to_string();

    // A checked candidate plus a launch-confirmed application publishes the
    // world and binds the build to the migrated commit.
    let (job, finished) = run_check(&mut journal, &context, &project, "check-one", true)?;
    let candidate = finished["candidateId"].as_str().unwrap().to_string();
    let prepared = journal.godot_application_prepare(&json!({"id":"apply-one","token":"token-a",
        "candidateId":candidate,"worldId":"a","revision":0,"snapshot":world().snapshot}))?;
    let application = json!({"id":"apply-one","token":"token-a","evidence":{
        "format":"craftmine.godot-application/1","inputHash":prepared["inputHash"],
        "launch":{"passed":true,"buildId":job["buildId"],"instanceId":"instance-1",
            "stateHash":digest("launched-state")},"player":world().snapshot["player"]}});
    // A prepared application is not deployment evidence.
    let operation = json!({"operationId":"op-apply","worldId":"a","repoId":repo,"branchId":"main",
        "expectedHeadOid":head,"expectedAppliedOid":null,"expectedProgressRevision":0});
    journal.content_apply_prepare(&json!({"worldId":"a","context":operation,"kind":"apply",
        "targetOid":head,"detail":"apply the checked candidate"}))?;
    journal.content_apply_advance(&json!({"operationId":"op-apply"}))?;
    failed(
        journal.content_apply_confirm(&json!({"operationId":"op-apply","applicationId":"apply-one",
            "detail":"prepared only"})),
        "GODOT_APPLICATION_NOT_APPLIED",
    );
    // The old self-attestation is gone: an object id is not deployment evidence.
    failed(
        journal.content_apply_confirm(&json!({"operationId":"op-apply","appliedOid":head,
            "detail":"host committed deployment"})),
        "unknown field",
    );
    // Confirming before the instance launched is refused.
    let mut unlaunched = application.clone();
    unlaunched["evidence"]["launch"]["passed"] = json!(false);
    failed(
        journal.godot_application_commit(&unlaunched),
        "GODOT_LAUNCH_REQUIRED",
    );
    journal.godot_application_commit(&application)?;
    let after = journal.world_read("a")?;
    assert_eq!(after.summary.revision, 1);
    assert_eq!(after.world.build["godot"]["sourceRevision"], 0);

    let committed = journal.content_apply_confirm(&json!({"operationId":"op-apply",
        "applicationId":"apply-one","detail":"deployment confirmed by the applied instance"}))?;
    assert_eq!(committed["state"], "committed");
    assert_eq!(committed["applicationId"], "apply-one");
    // A lost response is answered by the same operation instead of applying again.
    let replay = journal.content_apply_confirm(&json!({"operationId":"op-apply",
        "applicationId":"apply-one","detail":"deployment confirmed by the applied instance"}))?;
    assert_eq!(replay["state"], "committed");
    Ok(())
}
