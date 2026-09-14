use super::*;
use crate::godot_test_support::*;

#[test]
fn assets_are_content_addressed_listed_and_isolated_per_world() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let first = put_asset(&mut journal, &context, "asset-one", "hero.png", "image/png", b"hero-bytes")?;
    assert_eq!(first["replayed"], false);
    assert_eq!(first["path"], "assets/hero.png");
    assert_eq!(first["sha256"], digest_bytes(b"hero-bytes"));
    assert_eq!(first["bytes"], 10);
    // A lost response is answered from the durable receipt, not by writing again.
    let replay = put_asset(&mut journal, &context, "asset-one", "hero.png", "image/png", b"hero-bytes")?;
    assert_eq!(replay, first);
    let mut changed = json!({"context":&context,"worldId":"a","toolCallId":"asset-one","name":"hero.png",
        "mediaType":"image/png","sha256":digest_bytes(b"other-bytes"),"bytesBase64":BASE64_STANDARD.encode(b"other-bytes")});
    failed(journal.godot_asset_put(&changed), "REPLAY_MISMATCH");
    // A different payload cannot silently take over an existing path.
    changed["toolCallId"] = json!("asset-two");
    failed(journal.godot_asset_put(&changed), "GODOT_ASSET_CONFLICT");
    let second = put_asset(&mut journal, &context, "asset-two", "other.png", "image/png", b"other-bytes")?;
    assert_ne!(second["sha256"], first["sha256"]);
    let listed = journal.godot_asset_list(&json!({"context":&context,"worldId":"a"}))?;
    assert_eq!(listed["totalAssets"], 2);
    assert_eq!(listed["items"][0]["path"], "assets/hero.png");
    assert_eq!(listed["items"][1]["path"], "assets/other.png");
    assert_ne!(listed["assetManifestHash"], first["assetManifestHash"]);
    // The same content in another world never shares identity or files.
    journal.workspace_open(
        &WorkspaceContext {
            session_id: "session-b".into(),
            ..context.clone()
        },
        "b",
    )?;
    let other = WorkspaceContext {
        session_id: "session-b".into(),
        ..context.clone()
    };
    create_project_in(&mut journal, &other, "b", "create-b")?;
    let foreign = journal.godot_asset_list(&json!({"context":&other,"worldId":"b"}))?;
    assert_eq!(foreign["totalAssets"], 0);
    assert_ne!(foreign["assetManifestHash"], listed["assetManifestHash"]);
    assert_eq!(journal.godot_project_index(&json!({"context":&context,"worldId":"a"}))?["revision"], created["revision"]);
    Ok(())
}

#[test]
fn a_forged_asset_hash_never_writes_anything() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    create_project(&mut journal, &context)?;
    let request = json!({"context":&context,"worldId":"a","toolCallId":"forged","name":"hero.png",
        "mediaType":"image/png","sha256":digest("not-the-payload"),"bytesBase64":BASE64_STANDARD.encode(b"hero-bytes")});
    failed(journal.godot_asset_put(&request), "CORRUPT_GODOT_ASSET");
    assert_eq!(journal.godot_asset_list(&json!({"context":&context,"worldId":"a"}))?["totalAssets"], 0);
    assert!(!asset_root(&journal.directory, "a", true)?.join(digest("not-the-payload")).try_exists()?);
    // Extension and media type must agree, and unsupported payloads are refused.
    failed(
        journal.godot_asset_put(&json!({"context":&context,"worldId":"a","toolCallId":"wrong-type",
            "name":"hero.png","mediaType":"audio/wav","sha256":digest_bytes(b"x"),
            "bytesBase64":BASE64_STANDARD.encode(b"x")})),
        "UNSUPPORTED_GODOT_ASSET",
    );
    failed(
        journal.godot_asset_put(&json!({"context":&context,"worldId":"a","toolCallId":"bad-name",
            "name":"../escape.png","mediaType":"image/png","sha256":digest_bytes(b"x"),
            "bytesBase64":BASE64_STANDARD.encode(b"x")})),
        "INVALID_GODOT_ASSET_NAME",
    );
    Ok(())
}

#[test]
fn a_build_copy_is_materialized_verified_and_replayed_without_touching_source() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let asset = put_asset(&mut journal, &context, "asset-one", "hero.png", "image/png", b"hero-bytes")?;
    let before = journal.world_read("a")?;
    let started = start(&mut journal, &context, "build-one", &created, "build")?;
    assert_eq!(started["replayed"], false);
    assert_eq!(started["materialized"]["files"], 7);
    assert_eq!(started["status"], "blocked");
    assert_eq!(started["blockedReason"], "GODOT_EXECUTION_UNAVAILABLE");
    assert_eq!(started["executionAvailable"], false);
    let root = build_root(&journal.directory, "a", started["buildId"].as_str().unwrap(), false)?;
    assert_eq!(fs::read_to_string(root.join("source").join("world.gd"))?, SCRIPT);
    assert_eq!(fs::read(root.join("source").join("assets").join("hero.png"))?, b"hero-bytes");
    let manifest: Value = serde_json::from_str(&fs::read_to_string(root.join("manifest.json"))?)?;
    assert_eq!(manifest["buildId"], started["buildId"]);
    assert_eq!(manifest["files"].as_array().unwrap().len(), 7);
    // Host-owned files are fixed into the build copy and recorded with their own
    // kind, so a project cannot silently replace the bridge or export preset.
    for (name, text) in crate::godot_host_resources::files() {
        assert_eq!(fs::read_to_string(root.join("source").join(name))?, text);
        assert!(manifest["files"].as_array().unwrap().iter().any(|file| {
            file["path"] == name && file["kind"] == "host" && file["sha256"] == digest(&text)
        }));
    }
    assert!(manifest["files"].as_array().unwrap().iter().any(|file| file["kind"] == "asset"));
    // Host rows must be recorded, not silently dropped by the old CHECK.
    let recorded: i64 = journal.db.query_row(
        "SELECT COUNT(*) FROM craftmine_godot_build_files WHERE world_id='a' AND build_id=?1 AND kind='host'",
        [started["buildId"].as_str().unwrap()],
        |row| row.get(0),
    )?;
    assert_eq!(recorded, 3);
    // The same call replays its durable receipt. A new complete build request
    // gets its own export root even with identical immutable source inputs.
    let replay = start(&mut journal, &context, "build-one", &created, "build")?;
    assert_eq!(replay, started);
    let again = start(&mut journal, &context, "build-two", &created, "build")?;
    assert_ne!(again["buildId"], started["buildId"]);
    assert_ne!(again["jobId"], started["jobId"]);
    assert_eq!(again["materialized"]["files"], 7);
    assert_eq!(journal.world_read("a")?, before);
    assert_eq!(journal.godot_project_index(&json!({"context":&context,"worldId":"a"}))?["revision"], created["revision"]);
    assert_eq!(journal.godot_asset_list(&json!({"context":&context,"worldId":"a"}))?["items"][0]["sha256"], asset["sha256"]);
    Ok(())
}

#[test]
fn build_identity_changes_with_source_assets_and_base() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let first = start(&mut journal, &context, "build-one", &created, "build")?;
    put_asset(&mut journal, &context, "asset-one", "hero.png", "image/png", b"hero-bytes")?;
    let with_asset = start(&mut journal, &context, "build-two", &created, "build")?;
    assert_ne!(first["buildId"], with_asset["buildId"]);
    let patched = journal.godot_project_patch(&json!({"context":&context,"worldId":"a",
        "toolCallId":"patch-one","revision":created["revision"],"manifestHash":created["manifestHash"],
        "operations":[{"op":"put","path":"world.gd","expectedHash":digest(SCRIPT),
            "text":"extends Node3D\nvar damage := 7\n"}]}))?;
    let after_patch = start(&mut journal, &context, "build-three", &patched, "build")?;
    assert_ne!(after_patch["buildId"], with_asset["buildId"]);
    assert_eq!(after_patch["sourceRevision"], 1);
    // The materialized copy still contains the exact patched source.
    let root = build_root(&journal.directory, "a", after_patch["buildId"].as_str().unwrap(), false)?;
    assert_eq!(
        fs::read_to_string(root.join("source").join("world.gd"))?,
        "extends Node3D\nvar damage := 7\n"
    );
    Ok(())
}

#[test]
fn a_stale_source_revision_cannot_start_a_build() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    journal.godot_project_patch(&json!({"context":&context,"worldId":"a","toolCallId":"patch-one",
        "revision":created["revision"],"manifestHash":created["manifestHash"],
        "operations":[{"op":"put","path":"world.gd","expectedHash":digest(SCRIPT),"text":"extends Node3D\nvar damage := 7\n"}]}))?;
    failed(start(&mut journal, &context, "stale", &created, "build"), "GODOT_SOURCE_STALE");
    let mut forged = created.clone();
    forged["manifestHash"] = json!(digest("not-a-manifest"));
    failed(start(&mut journal, &context, "forged", &forged, "build"), "GODOT_SOURCE_STALE");
    Ok(())
}

#[test]
fn cross_world_and_ended_turns_cannot_start_builds() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let first = start(&mut journal, &context, "resumed", &created, "build")?;
    // The workspace is bound to world "a"; naming another world must not work.
    failed(
        journal.godot_build_start(&json!({"context":&context,"worldId":"b","toolCallId":"cross",
            "revision":created["revision"],"manifestHash":created["manifestHash"],"mode":"build"})),
        "PROJECT_WORLD_BINDING_MISMATCH",
    );
    journal.workspace_end_turn("session-a", "one", "completed")?;
    // The ended turn can no longer hold its lease; the exact code is durable.
    failed(start(&mut journal, &context, "ended", &created, "build"), "TASK_INACTIVE");
    let next = ctx("two");
    journal.workspace_open(&next, "a")?;
    // A new turn reuses the same source project and can start a fresh build.
    let resumed = start(&mut journal, &next, "resumed", &created, "build")?;
    assert_ne!(resumed["buildId"],first["buildId"],"same call label in a different durable task is a distinct export");
    assert_eq!(resumed["sourceRevision"], 0);
    failed(start(&mut journal, &context, "old-turn", &created, "build"), "STALE_TURN");
    Ok(())
}

#[test]
fn a_corrupt_asset_blob_is_reported_and_never_repaired_silently() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let asset = put_asset(&mut journal, &context, "asset-one", "hero.png", "image/png", b"hero-bytes")?;
    let blob = asset_root(&journal.directory, "a", false)?.join(asset["sha256"].as_str().unwrap());
    fs::write(&blob, b"corrupted!!")?;
    failed(start(&mut journal, &context, "build-one", &created, "build"), "CORRUPT_GODOT_ASSET");
    assert_eq!(journal.godot_project_index(&json!({"context":&context,"worldId":"a"}))?["revision"], 0);
    assert_eq!(fs::read(&blob)?, b"corrupted!!");
    Ok(())
}

#[test]
fn a_binary_asset_over_the_model_limit_is_rejected_without_a_second_store() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    create_project(&mut journal, &context)?;
    let payload = vec![7u8; ASSET_MODEL_BYTES + 1];
    failed(
        journal.godot_asset_put(&json!({"context":&context,"worldId":"a","toolCallId":"huge",
            "name":"hero.png","mediaType":"image/png","sha256":digest_bytes(&payload),
            "bytesBase64":BASE64_STANDARD.encode(&payload)})),
        "GODOT_ASSET_TOO_LARGE",
    );
    assert!(!asset_root(&journal.directory, "a", true)?.join(digest_bytes(&payload)).try_exists()?);
    Ok(())
}

#[test]
fn a_database_with_the_old_build_file_check_is_rebuilt_for_host_rows() -> Result<()> {
    let (_dir, path) = temp()?;
    {
        let db = rusqlite::Connection::open(&path)?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE craftmine_godot_builds (
                world_id TEXT NOT NULL, build_id TEXT NOT NULL, source_revision INTEGER NOT NULL,
                manifest_hash TEXT NOT NULL, asset_manifest_hash TEXT NOT NULL, base_id TEXT NOT NULL,
                base_build TEXT NOT NULL, engine_version TEXT NOT NULL, renderer TEXT NOT NULL,
                target TEXT NOT NULL, files INTEGER NOT NULL, bytes INTEGER NOT NULL,
                created_at INTEGER NOT NULL, PRIMARY KEY(world_id,build_id)
             );
             CREATE TABLE craftmine_godot_build_files (
                world_id TEXT NOT NULL, build_id TEXT NOT NULL, path TEXT NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('source','asset','cache','artifact')),
                sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
                PRIMARY KEY(world_id,build_id,path),
                FOREIGN KEY(world_id,build_id) REFERENCES craftmine_godot_builds(world_id,build_id)
             );
             INSERT INTO craftmine_godot_builds VALUES('a','gbd-legacy',0,'m','a','first-person',
                'base-a','4.7.2-stable','gl_compatibility','web',1,1,1);
             INSERT INTO craftmine_godot_build_files VALUES('a','gbd-legacy','p','source','h',1);",
        )?;
    }
    let journal = TaskJournal::open(&path)?;
    let sql: String = journal.db.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='craftmine_godot_build_files'",
        [],
        |row| row.get(0),
    )?;
    assert!(sql.contains("'host'"));
    let kept: i64 = journal.db.query_row(
        "SELECT COUNT(*) FROM craftmine_godot_build_files",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(kept, 1);
    // A host row now records instead of being silently ignored by the old CHECK.
    journal.db.execute(
        "INSERT INTO craftmine_godot_build_files(world_id,build_id,path,kind,sha256,bytes)
         VALUES('a','gbd-legacy','craftmine_host_bridge.js','host','h2',2)",
        [],
    )?;
    Ok(())
}

#[test]
fn a_project_cannot_shadow_host_files_in_a_build_copy() -> Result<()> {
    let (_dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = journal.godot_project_create(&json!({"context":&context,"worldId":"a",
        "toolCallId":"create-host","baseBuild":"base-a","baseId":"first-person","files":[
            {"path":"project.godot","text":PROJECT},
            {"path":"main.tscn","text":SCENE},
            {"path":"export_presets.cfg","text":"[preset.0]\nname=\"evil\"\n"}]}))?;
    failed(
        start(&mut journal, &context, "build-host", &created, "build"),
        "GODOT_RESERVED_HOST_PATH",
    );
    // The rejected build leaves no half-materialized build copy behind.
    assert!(journal.godot_candidate_list(&json!({"worldId":"a"}))?["items"]
        .as_array()
        .unwrap()
        .is_empty());
    Ok(())
}
