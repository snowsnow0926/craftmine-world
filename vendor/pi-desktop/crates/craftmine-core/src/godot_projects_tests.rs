use super::*;
use crate::WorldDocument;

#[test]
fn a_private_file_install_is_atomic_binary_safe_and_replayable_on_both_backends() -> Result<()> {
    for git in [false,true] {
        let dir=tempfile::tempdir()?;
        let path=dir.path().join("tasks.sqlite");
        let mut journal=setup(&path)?;
        let context=ctx("one");
        let version=journal.godot_project_create(&create_request(&context))?;
        let mut operation=Value::Null;
        if git {
            journal.content_migrate_apply(&json!({"worldId":"a"}))?;
            let status=journal.content_status(&json!({"worldId":"a"}))?;
            operation=json!({"operationId":"install-op","worldId":"a","repoId":status["repoId"],"branchId":"main",
                "expectedHeadOid":status["headOid"],"expectedAppliedOid":status["appliedOid"],"expectedProgressRevision":0});
        }
        let binary=b"\x89PNG\r\n\x1a\n\0\xffexact bytes";
        let lock=crate::content_history::contract::AssetLock::empty().canonical_bytes()?;
        let mut request=json!({"context":context,"worldId":"a","toolCallId":"install-files","revision":version["revision"],
            "manifestHash":version["manifestHash"],"operation":operation,"files":[
                {"path":"images/nested/test.png","bytesBase64":STANDARD.encode(binary),"expectedHash":null},
                {"path":"craftmine.assets.lock.json","bytesBase64":STANDARD.encode(&lock),"expectedHash":null},
                {"path":"craftmine.instances.json","bytesBase64":STANDARD.encode(b"{}"),"expectedHash":null},
                {"path":"world.gd","bytesBase64":STANDARD.encode(b"extends Node3D\nvar installed := true\n"),"expectedHash":"0".repeat(64)}]});
        failed(journal.godot_project_apply_files(&request),"PROJECT_FILE_CONFLICT");
        assert_eq!(journal.godot_project_index(&index_request(&context))?["manifestHash"],version["manifestHash"]);
        request["files"][3]["expectedHash"]=json!(digest("extends Node3D\nvar damage := 12\n"));
        let installed=journal.godot_project_apply_files(&request)?;
        assert_eq!(installed["revision"],1);
        assert_eq!(journal.godot_project_apply_files(&request)?,installed);
        let read=journal.godot_project_read(&read_request(&context,&installed,"images/nested/test.png"))?;
        assert_eq!(STANDARD.decode(read["bytesBase64"].as_str().unwrap())?,binary);
        let job=journal.godot_build_start(&json!({"context":context,"worldId":"a","toolCallId":"installed-build",
            "revision":installed["revision"],"manifestHash":installed["manifestHash"],"mode":"build"}))?;
        let root=godot_builds::build_root(&journal.directory,"a",job["buildId"].as_str().unwrap(),false)?;
        assert_eq!(fs::read(root.join("source/images/nested/test.png"))?,binary);
        assert_eq!(fs::read(root.join("source/craftmine.assets.lock.json"))?,lock);
        drop(journal);
        let journal=TaskJournal::open(&path)?;
        assert_eq!(journal.godot_project_read(&read_request(&context,&installed,"images/nested/test.png"))?["bytesBase64"],read["bytesBase64"]);
    }
    Ok(())
}

fn ctx(turn: &str) -> WorkspaceContext {
    WorkspaceContext {
        project_id: "project-a".into(),
        session_id: "session-a".into(),
        turn_id: turn.into(),
    }
}
fn world() -> WorldDocument {
    WorldDocument {
        build: json!({"id":"base-a","scene":{"format":"craftmine.scene/3","objects":[]}}),
        snapshot: json!({"format":"craftmine.progress/1","player":{"x":0.5,"y":7.6,"z":0.5,"yaw":0,"pitch":0}}),
        extensions: vec![],
    }
}
fn setup(path: &Path) -> Result<TaskJournal> {
    let mut journal = TaskJournal::open(path)?;
    journal.world_create("a", "A", &world())?;
    journal.world_create("b", "B", &world())?;
    journal.workspace_open(&ctx("one"), "a")?;
    Ok(journal)
}
fn create_request(context: &WorkspaceContext) -> Value {
    json!({"context":context,"worldId":"a","toolCallId":"create-one","baseBuild":"base-a","baseId":"first-person",
        "files":[{"path":"project.godot","text":"config_version=5\n[application]\nrun/main_scene=\"res://world.tscn\"\n"},
        {"path":"world.tscn","text":"[gd_scene load_steps=2 format=3]\n[ext_resource type=\"Script\" path=\"res://world.gd\" id=\"1\"]\n[node name=\"World\" type=\"Node3D\"]\nscript = ExtResource(\"1\")\n"},
        {"path":"world.gd","text":"extends Node3D\nvar damage := 12\n"}]})
}
fn index_request(context: &WorkspaceContext) -> Value {
    json!({"context":context,"worldId":"a"})
}
fn patch_request(context: &WorkspaceContext, version: &Value, call: &str) -> Value {
    json!({"context":context,"worldId":"a","toolCallId":call,"revision":version["revision"],"manifestHash":version["manifestHash"],
        "operations":[{"op":"put","path":"world.gd","expectedHash":digest("extends Node3D\nvar damage := 12\n"),"text":"extends Node3D\nvar damage := 7\n"}]})
}
fn read_request(context: &WorkspaceContext, version: &Value, path: &str) -> Value {
    json!({"context":context,"worldId":"a","revision":version["revision"],"manifestHash":version["manifestHash"],"path":path})
}
fn failed<T: std::fmt::Debug>(result: Result<T>, code: &str) {
    assert!(
        result.unwrap_err().to_string().contains(code),
        "Expected {code}"
    );
}

#[test]
fn project_files_are_durable_and_independent_of_legacy_world_and_draft() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("tasks.sqlite");
    let context = ctx("one");
    let mut journal = setup(&path)?;
    let old_world = journal.world_read("a")?;
    let old_draft = journal.workspace_inspect(&context)?.task;
    let request = create_request(&context);
    let created = journal.godot_project_create(&request)?;
    assert_eq!(created["revision"], 0);
    assert_eq!(created["status"], "source-only");
    assert_eq!(created["applied"], false);
    assert_eq!(created["verified"], false);
    let patch = patch_request(&context, &created, "patch-one");
    let changed = journal.godot_project_patch(&patch)?;
    assert_eq!(changed["revision"], 1);
    assert_ne!(created["manifestHash"], changed["manifestHash"]);
    assert_eq!(
        journal.godot_project_read(&read_request(&context, &created, "world.gd"))?["text"],
        "extends Node3D\nvar damage := 12\n"
    );
    assert_eq!(
        journal.godot_project_read(&read_request(&context, &changed, "world.gd"))?["text"],
        "extends Node3D\nvar damage := 7\n"
    );
    let real_file = blob_directory(&journal.directory, "a", false)?
        .join(digest("extends Node3D\nvar damage := 7\n"));
    assert_eq!(
        fs::read_to_string(real_file)?,
        "extends Node3D\nvar damage := 7\n"
    );
    drop(journal);
    let journal = TaskJournal::open(&path)?;
    assert_eq!(
        journal.godot_project_index(&index_request(&context))?["manifestHash"],
        changed["manifestHash"]
    );
    assert_eq!(journal.world_read("a")?, old_world);
    assert_eq!(journal.workspace_inspect(&context)?.task, old_draft);
    Ok(())
}

#[test]
fn source_files_over_two_megabytes_do_not_use_the_legacy_json_limit() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = setup(&dir.path().join("tasks.sqlite"))?;
    let context = ctx("one");
    let mut request = create_request(&context);
    let text = format!("# {}", "a".repeat(2_100_000));
    request["files"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"large.gd","text":text}));
    let created = journal.godot_project_create(&request)?;
    assert!(created["bytes"].as_u64().unwrap() > 2_000_000);
    let mut read = read_request(&context, &created, "large.gd");
    read["offset"] = json!(2_099_990);
    read["limit"] = json!(16);
    let page = journal.godot_project_read(&read)?;
    assert_eq!(page["text"], "a".repeat(12));
    assert!(page["nextOffset"].is_null());
    let mut too_large = patch_request(&context, &created, "oversize");
    too_large["operations"][0]["text"] = json!("a".repeat(FILE_LIMIT + 1));
    failed(
        journal.godot_project_patch(&too_large),
        "INVALID_PROJECT_TEXT",
    );
    assert_eq!(
        journal.godot_project_index(&index_request(&context))?["revision"],
        0
    );
    Ok(())
}

#[test]
fn case_distinct_world_ids_have_separate_physical_files_on_windows() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = setup(&dir.path().join("tasks.sqlite"))?;
    let context = ctx("one");
    let created = journal.godot_project_create(&create_request(&context))?;
    journal.world_create("A", "Uppercase world", &world())?;
    let upper_context = WorkspaceContext {
        session_id: "uppercase-session".into(),
        ..context.clone()
    };
    journal.workspace_open(&upper_context, "A")?;
    let mut request = create_request(&upper_context);
    request["worldId"] = json!("A");
    let uppercase = journal.godot_project_create(&request)?;
    let hash = digest("extends Node3D\nvar damage := 12\n");
    let lower = blob_directory(&journal.directory, "a", false)?.join(&hash);
    let upper = blob_directory(&journal.directory, "A", false)?.join(&hash);
    assert_ne!(
        lower.to_string_lossy().to_ascii_lowercase(),
        upper.to_string_lossy().to_ascii_lowercase()
    );
    fs::write(&lower, "synthetic corruption")?;
    failed(
        journal.godot_project_read(&read_request(&context, &created, "world.gd")),
        "CORRUPT_PROJECT_FILE",
    );
    let mut read = read_request(&upper_context, &uppercase, "world.gd");
    read["worldId"] = json!("A");
    assert_eq!(
        journal.godot_project_read(&read)?["text"],
        "extends Node3D\nvar damage := 12\n"
    );
    Ok(())
}

#[test]
fn manifest_hash_and_stored_revision_mismatch_are_not_reset() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = setup(&dir.path().join("tasks.sqlite"))?;
    let context = ctx("one");
    let created = journal.godot_project_create(&create_request(&context))?;
    journal.db.execute(
        "UPDATE craftmine_godot_projects SET revision=2 WHERE world_id='a'",
        [],
    )?;
    failed(
        journal.godot_project_index(&index_request(&context)),
        "CORRUPT_PROJECT_MANIFEST",
    );
    journal.db.execute(
        "UPDATE craftmine_godot_projects SET revision=0, hash='invalid' WHERE world_id='a'",
        [],
    )?;
    failed(
        journal.godot_project_patch(&patch_request(&context, &created, "corrupt")),
        "CORRUPT_PROJECT_MANIFEST",
    );
    assert_eq!(
        journal.db.query_row(
            "SELECT hash FROM craftmine_godot_projects WHERE world_id='a'",
            [],
            |r| r.get::<_, String>(0)
        )?,
        "invalid"
    );
    assert!(
        journal.godot_project_read(&read_request(&context, &created, "world.gd"))?["text"]
            .as_str()
            .is_some()
    );
    Ok(())
}

#[test]
fn replay_is_exact_and_receipts_survive_turn_completion_and_restart() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("tasks.sqlite");
    let context = ctx("one");
    let mut journal = setup(&path)?;
    let request = create_request(&context);
    let created = journal.godot_project_create(&request)?;
    assert_eq!(journal.godot_project_create(&request)?, created);
    let patch = patch_request(&context, &created, "patch-one");
    let result = journal.godot_project_patch(&patch)?;
    assert_eq!(journal.godot_project_patch(&patch)?, result);
    let mut changed = patch.clone();
    changed["operations"][0]["text"] = json!("different");
    failed(journal.godot_project_patch(&changed), "REPLAY_MISMATCH");
    let binding = journal.workspace_inspect(&context)?.task.binding;
    journal.workspace_end_turn(&context.session_id, &context.turn_id, "completed")?;
    drop(journal);
    let journal = TaskJournal::open(&path)?;
    let receipt = json!({"binding":binding,"worldId":"a","toolCallId":"patch-one","method":"godotProject.patch","request":patch});
    assert_eq!(journal.godot_project_receipt(&receipt)?, result);
    let mut foreign = receipt.clone();
    foreign["worldId"] = json!("b");
    failed(
        journal.godot_project_receipt(&foreign),
        "PROJECT_WORLD_BINDING_MISMATCH",
    );
    let mut mismatched = receipt.clone();
    mismatched["request"] = changed;
    failed(
        journal.godot_project_receipt(&mismatched),
        "REPLAY_MISMATCH",
    );
    Ok(())
}

#[test]
fn panel_selection_foreign_context_and_stale_turn_cannot_redirect_files() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = setup(&dir.path().join("tasks.sqlite"))?;
    let context = ctx("one");
    let created = journal.godot_project_create(&create_request(&context))?;
    assert_eq!(journal.workspace_open(&context, "b")?.world_id, "a");
    let mut foreign = index_request(&context);
    foreign["worldId"] = json!("b");
    failed(
        journal.godot_project_index(&foreign),
        "PROJECT_WORLD_BINDING_MISMATCH",
    );
    let mut foreign = patch_request(&context, &created, "foreign");
    foreign["context"]["projectId"] = json!("foreign");
    failed(
        journal.godot_project_patch(&foreign),
        "PROJECT_BINDING_MISMATCH",
    );
    let second = WorkspaceContext {
        session_id: "session-b".into(),
        ..context.clone()
    };
    failed(journal.workspace_open(&second, "a"), "WORLD_BUSY");
    journal.workspace_end_turn(&context.session_id, &context.turn_id, "completed")?;
    failed(
        journal.godot_project_patch(&patch_request(&context, &created, "late")),
        "TASK_INACTIVE",
    );
    let next = ctx("two");
    journal.workspace_open(&next, "b")?;
    failed(
        journal.godot_project_patch(&patch_request(&context, &created, "stale")),
        "STALE_TURN",
    );
    let result = journal.godot_project_patch(&patch_request(&next, &created, "next-turn"))?;
    assert_eq!(result["worldId"], "a");
    assert_eq!(result["revision"], 1);
    assert!(!journal.directory.join("godot-source/b").exists());
    Ok(())
}

#[test]
fn optimistic_version_and_file_hash_conflicts_leave_the_head_unchanged() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("tasks.sqlite");
    let mut first = setup(&path)?;
    let mut second = TaskJournal::open(&path)?;
    let context = ctx("one");
    let created = first.godot_project_create(&create_request(&context))?;
    let mut wrong = patch_request(&context, &created, "wrong-file");
    wrong["operations"][0]["expectedHash"] = json!(digest("wrong"));
    failed(first.godot_project_patch(&wrong), "PROJECT_FILE_CONFLICT");
    let result = first.godot_project_patch(&patch_request(&context, &created, "first"))?;
    failed(
        second.godot_project_patch(&patch_request(&context, &created, "second")),
        "GODOT_PROJECT_REVISION_CONFLICT",
    );
    assert_eq!(
        second.godot_project_index(&index_request(&context))?["manifestHash"],
        result["manifestHash"]
    );
    first.db.execute("UPDATE craftmine_tasks SET binding=json_set(binding,'$.baseBuild','foreign-base') WHERE id=?1",[first.workspace_inspect(&context)?.task.binding.task_id])?;
    failed(
        first.godot_project_patch(&patch_request(&context, &result, "wrong-base")),
        "WORLD_BUILD_CONFLICT",
    );
    Ok(())
}

#[test]
fn all_path_aliases_collisions_unknown_fields_and_missing_config_are_rejected() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = setup(&dir.path().join("tasks.sqlite"))?;
    let context = ctx("one");
    let created = journal.godot_project_create(&create_request(&context))?;
    for path in [
        "../outside.gd",
        "/absolute.gd",
        "C:/escape.gd",
        "a\\b.gd",
        "a.gd:ads",
        "foo//bar.gd",
        ".godot/cache.gd",
        ".git/config.txt",
        "a/./b.gd",
        "NUL.gd",
        "con.gd",
        "COM1.txt",
        "LPT9.gd",
        "foo./bar.gd",
        "with space.gd",
        "a\0.gd",
        "wrong.exe",
    ] {
        let mut patch = patch_request(&context, &created, "bad-path");
        patch["operations"] = json!([{"op":"put","path":path,"text":"x","expectedHash":null}]);
        assert!(
            journal.godot_project_patch(&patch).is_err(),
            "Accepted {path:?}"
        );
    }
    for operations in [
        json!([{"op":"put","path":"WORLD.gd","text":"x","expectedHash":null}]),
        json!([{"op":"put","path":"world.gd/nested.gd","text":"x","expectedHash":null}]),
        json!([{"op":"put","path":"new.gd","text":"x","expectedHash":null},{"op":"put","path":"NEW.gd","text":"x","expectedHash":null}]),
    ] {
        let mut patch = patch_request(&context, &created, "collision");
        patch["operations"] = operations;
        failed(
            journal.godot_project_patch(&patch),
            "PROJECT_PATH_COLLISION",
        );
    }
    let config = journal.godot_project_read(&read_request(&context, &created, "project.godot"))?;
    let mut remove = patch_request(&context, &created, "remove-config");
    remove["operations"] =
        json!([{"op":"remove","path":"project.godot","expectedHash":config["sha256"]}]);
    failed(
        journal.godot_project_patch(&remove),
        "PROJECT_CONFIG_REQUIRED",
    );
    let mut extra = patch_request(&context, &created, "unknown");
    extra["execute"] = json!(true);
    assert!(journal.godot_project_patch(&extra).is_err());
    let mut missing_hash = patch_request(&context, &created, "missing-hash");
    missing_hash["operations"] = json!([{"op":"put","path":"new.gd","text":"extends Node"}]);
    assert!(journal.godot_project_patch(&missing_hash).is_err());
    assert_eq!(
        journal.godot_project_index(&index_request(&context))?["revision"],
        0
    );
    Ok(())
}

#[test]
fn paginated_index_and_unicode_reads_remain_bound_to_an_immutable_revision() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = setup(&dir.path().join("tasks.sqlite"))?;
    let context = ctx("one");
    let mut request = create_request(&context);
    request["files"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"notes.txt","text":"甲🙂乙é丙"}));
    let created = journal.godot_project_create(&request)?;
    let mut index = index_request(&context);
    index["limit"] = json!(2);
    let first = journal.godot_project_index(&index)?;
    assert_eq!(first["files"].as_array().unwrap().len(), 2);
    assert_eq!(first["nextOffset"], 2);
    journal.godot_project_patch(&patch_request(&context, &created, "patch"))?;
    index["revision"] = created["revision"].clone();
    index["manifestHash"] = created["manifestHash"].clone();
    index["offset"] = json!(2);
    let next = journal.godot_project_index(&index)?;
    assert_eq!(next["revision"], 0);
    assert!(next["nextOffset"].is_null());
    let mut read = read_request(&context, &created, "notes.txt");
    read["offset"] = json!(1);
    read["limit"] = json!(2);
    let text = journal.godot_project_read(&read)?;
    assert_eq!(text["text"], "🙂乙");
    assert_eq!(text["nextOffset"], 3);
    assert_eq!(text["totalCharacters"], 5);
    read["manifestHash"] = json!(digest("wrong"));
    failed(
        journal.godot_project_read(&read),
        "GODOT_PROJECT_REVISION_CONFLICT",
    );
    Ok(())
}

#[test]
fn sqlite_failure_cannot_publish_a_partial_file_set_or_receipt() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("tasks.sqlite");
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = journal.godot_project_create(&create_request(&context))?;
    journal.db.execute_batch("CREATE TRIGGER fail_project_receipt BEFORE INSERT ON craftmine_godot_receipts BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;")?;
    let patch = patch_request(&context, &created, "atomic");
    assert!(journal.godot_project_patch(&patch).is_err());
    assert_eq!(
        journal.godot_project_index(&index_request(&context))?["manifestHash"],
        created["manifestHash"]
    );
    assert_eq!(
        journal
            .db
            .query_row("SELECT count(*) FROM craftmine_godot_revisions", [], |r| {
                r.get::<_, i64>(0)
            })?,
        1
    );
    let orphan = blob_directory(&journal.directory, "a", false)?
        .join(digest("extends Node3D\nvar damage := 7\n"));
    assert!(orphan.is_file());
    journal
        .db
        .execute_batch("DROP TRIGGER fail_project_receipt")?;
    drop(journal);
    let mut journal = TaskJournal::open(&path)?;
    let changed = journal.godot_project_patch(&patch)?;
    assert_eq!(changed["revision"], 1);
    assert_eq!(journal.godot_project_patch(&patch)?, changed);
    Ok(())
}

#[test]
fn corrupt_existing_blob_is_rejected_on_read_reuse_and_unrelated_patch() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = setup(&dir.path().join("tasks.sqlite"))?;
    let context = ctx("one");
    let created = journal.godot_project_create(&create_request(&context))?;
    let path = blob_directory(&journal.directory, "a", false)?
        .join(digest("extends Node3D\nvar damage := 12\n"));
    fs::write(&path, "extends Node3D\nvar damage := 99\n")?;
    failed(
        journal.godot_project_read(&read_request(&context, &created, "world.gd")),
        "CORRUPT_PROJECT_FILE",
    );
    let mut patch = patch_request(&context, &created, "unrelated");
    patch["operations"] =
        json!([{"op":"put","path":"other.gd","text":"extends Node\n","expectedHash":null}]);
    failed(journal.godot_project_patch(&patch), "CORRUPT_PROJECT_FILE");
    patch["operations"] = json!([{"op":"put","path":"copy.gd","text":"extends Node3D\nvar damage := 12\n","expectedHash":null}]);
    failed(journal.godot_project_patch(&patch), "CORRUPT_PROJECT_FILE");
    assert_eq!(
        journal.godot_project_index(&index_request(&context))?["revision"],
        0
    );
    Ok(())
}

#[test]
fn deleting_a_source_preserves_history_and_file_sets_are_world_scoped() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = setup(&dir.path().join("tasks.sqlite"))?;
    let context = ctx("one");
    let created = journal.godot_project_create(&create_request(&context))?;
    let mut remove = patch_request(&context, &created, "remove");
    remove["operations"] = json!([{"op":"remove","path":"world.gd","expectedHash":digest("extends Node3D\nvar damage := 12\n")}]);
    let changed = journal.godot_project_patch(&remove)?;
    failed(
        journal.godot_project_read(&read_request(&context, &changed, "world.gd")),
        "PROJECT_FILE_NOT_FOUND",
    );
    assert!(
        journal.godot_project_read(&read_request(&context, &created, "world.gd"))?["text"]
            .as_str()
            .unwrap()
            .contains("12")
    );
    let second = WorkspaceContext {
        session_id: "session-b".into(),
        ..context.clone()
    };
    journal.workspace_open(&second, "b")?;
    let mut request = create_request(&second);
    request["worldId"] = json!("b");
    let world_b = journal.godot_project_create(&request)?;
    assert_eq!(world_b["revision"], 0);
    let hash = digest("extends Node3D\nvar damage := 12\n");
    let a = blob_directory(&journal.directory, "a", false)?.join(&hash);
    let b = blob_directory(&journal.directory, "b", false)?.join(&hash);
    assert_ne!(a, b);
    assert_eq!(fs::read(a)?, fs::read(b)?);
    Ok(())
}

#[test]
#[cfg_attr(
    windows,
    ignore = "Windows junction fixture setup was denied/timed out under the managed test runner; run explicitly only when fixture creation is available"
)]
fn filesystem_directory_links_cannot_redirect_managed_blob_reads() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut journal = setup(&dir.path().join("tasks.sqlite"))?;
    let context = ctx("one");
    let created = journal.godot_project_create(&create_request(&context))?;
    let original = blob_directory(&journal.directory, "a", false)?;
    let moved = dir.path().join("synthetic-link-target");
    fs::rename(&original, &moved)?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(&moved, &original)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let quoted = |path: &Path| {
            path.to_string_lossy()
                .trim_start_matches(r"\\?\")
                .replace('\'', "''")
        };
        let command = format!(
            "New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null",
            quoted(&original),
            quoted(&moved)
        );
        let executable = PathBuf::from(std::env::var("SystemRoot")?)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut child = std::process::Command::new(executable)
            .args(["-NoProfile", "-NonInteractive", "-Command", &command])
            .creation_flags(0x08000000)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while child.try_wait()?.is_none() {
            if std::time::Instant::now() > deadline {
                child.kill()?;
                let _ = child.wait();
                anyhow::bail!("Isolated junction creation exceeded 20 seconds");
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let output = child.wait_with_output()?;
        ensure!(
            output.status.success(),
            "Could not create isolated test junction: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    failed(
        journal.godot_project_read(&read_request(&context, &created, "world.gd")),
        "PROJECT_STORAGE_LINK_REFUSED",
    );
    failed(
        journal.godot_project_patch(&patch_request(&context, &created, "linked")),
        "PROJECT_STORAGE_LINK_REFUSED",
    );
    assert_eq!(
        journal.godot_project_index(&index_request(&context))?["revision"],
        0
    );
    Ok(())
}
