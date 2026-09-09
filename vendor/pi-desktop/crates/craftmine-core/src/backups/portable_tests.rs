//! Portable archive tests.
//!
//! The acceptance case is a restore into a completely new data directory while
//! the original data directory no longer exists. Every fixture is synthetic and
//! runs in an isolated temporary directory.
use super::*;
use crate::content_history::repo::{commit_message, ContentFile, MAIN_BRANCH};
use crate::godot_test_support::*;
use std::fs;

#[test]
fn portable_columns_require_explicit_migrations_and_never_default_missing_user_fields() -> Result<()> {
    let (dir,path)=temp()?;let mut journal=TaskJournal::open(&path)?;
    let names=tables(&journal.db)?;
    let mut domain=snapshot(&journal.db,&names)?;
    domain["craftmine_godot_builds"]["columns"].as_array_mut().unwrap().retain(|value|value!="branch_id");
    domain["craftmine_godot_jobs"]["columns"].as_array_mut().unwrap().retain(|value|value!="check_input" && value!="check_input_hash");
    let tx=journal.db.transaction()?;
    apply_domain_rows(&tx,&domain)?;tx.rollback()?;
    domain["craftmine_worlds"]["columns"].as_array_mut().unwrap().retain(|value|value!="title");
    let tx=journal.db.transaction()?;
    assert!(apply_domain_rows(&tx,&domain).unwrap_err().to_string().contains("BACKUP_COLUMNS_MISMATCH"));
    tx.rollback()?;drop(dir);Ok(())
}

const LEGACY_PROJECT: &str = r#"{"format":"craftmine.project/1","current":"v-0123456789abcdef0123",
    "snapshot":{"format":"craftmine.progress/1","player":{"x":0.5,"y":6,"z":12.5,"yaw":0,"pitch":0}},
    "assets":[],"extensions":[]}"#;
const LEGACY_BUILD: &str = r#"{"hash":"0123456789abcdef0123","scene":{"format":"craftmine.scene/3","objects":[],
    "systems":[],"behaviors":[]}}"#;
const HERO: &[u8] = b"hero-png-bytes";

fn seed_legacy(db: &mut TaskJournal) -> Result<()> {
    // The import source must live outside the data directory.
    let outside = tempfile::tempdir()?;
    let source = outside.path().join("legacy");
    fs::create_dir_all(source.join("builds/v-0123456789abcdef0123"))?;
    fs::write(source.join("project.json"), LEGACY_PROJECT)?;
    fs::write(
        source.join("builds/v-0123456789abcdef0123/build.json"),
        LEGACY_BUILD,
    )?;
    db.legacy_capture("import", &source)?;
    Ok(())
}

fn seed_catalog_asset(db: &TaskJournal) -> Result<String> {
    let sha = digest_bytes(HERO);
    let path = db
        .directory
        .join("asset-catalog/blobs")
        .join(&sha[..2])
        .join(&sha);
    fs::create_dir_all(path.parent().unwrap())?;
    fs::write(&path, HERO)?;
    db.db.execute(
        "INSERT INTO craftmine_asset_versions(asset_id,version,kind,content_hash,display_name,media_kind,
         bytes,file_count,origin,author,license,license_status,created_at)
         VALUES('hero',1,'model',?1,'hero','image/png',?2,1,'local','tester','CC0','ok',1)",
        rusqlite::params![sha, HERO.len() as i64],
    )?;
    db.db.execute(
        "INSERT INTO craftmine_asset_files(asset_id,version,path,sha256,bytes,media_type)
         VALUES('hero',1,'hero.png',?1,?2,'image/png')",
        rusqlite::params![sha, HERO.len() as i64],
    )?;
    db.db.execute(
        "INSERT INTO craftmine_asset_blobs(sha256,bytes,media_kind,created_at) VALUES(?1,?2,'image/png',1)",
        rusqlite::params![sha, HERO.len() as i64],
    )?;
    Ok(sha)
}

fn seed_repository(db: &TaskJournal) -> Result<String> {
    let store = repository_store(&db.directory)?;
    let layout = store.create("repo-world-a", "sha1", None)?;
    // The repository history must carry exactly the bytes the SQLite revision
    // manifest describes, so a revision resolves to a commit whose files match
    // its manifest hashes.
    let first = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[
            ContentFile::text("project.godot", PROJECT),
            ContentFile::text("main.tscn", SCENE),
            ContentFile::text("world.gd", SCRIPT),
        ],
        &commit_message("req-1", "task-1", "create world", "")?,
    )?;
    let second = store.commit(
        &layout,
        MAIN_BRANCH,
        Some(&first),
        &[
            ContentFile::text("project.godot", "config_version=5\nname=\"town\"\n"),
            ContentFile::text("main.tscn", SCENE),
            ContentFile::text("world.gd", SCRIPT),
        ],
        &commit_message("req-1", "task-1", "rename world", "AI patch")?,
    )?;
    db.db.execute(
        "INSERT INTO craftmine_content_repositories(world_id,repo_id,object_format,backend,
         legacy_head_revision,created_at,switched_at) VALUES('a','repo-world-a','sha1','git',NULL,1,1)",
        [],
    )?;
    // The world is Git-backed now, so the legacy revision it still carries must
    // have a verifiable commit index - exactly what the product's own migration
    // writes. Without it `godotProject.read` cannot resolve revision 0, and no
    // archive can restore a usable world.
    let tree = store
        .git()
        .repo(&layout.git_dir, &["rev-parse", &format!("{first}^{{tree}}")])?
        .ensure_ok("TEST_REV_PARSE_FAILED")?
        .trimmed()?;
    let manifest_hash: String = db.db.query_row(
        "SELECT hash FROM craftmine_godot_revisions WHERE world_id='a' AND revision=0",
        [],
        |row| row.get(0),
    )?;
    db.db.execute(
        "INSERT INTO craftmine_content_revision_map(world_id,legacy_revision,commit_oid,tree_oid,
         manifest_hash,file_count,byte_count,imported_at) VALUES('a',0,?1,?2,?3,3,?4,1)",
        rusqlite::params![
            first,
            tree,
            manifest_hash,
            (PROJECT.len() + SCENE.len() + SCRIPT.len()) as i64
        ],
    )?;
    Ok(second)
}

struct Fixture {
    _dir: tempfile::TempDir,
    db: TaskJournal,
    source_dir: PathBuf,
    repo_head: String,
    catalog_sha: String,
}

fn fixture() -> Result<Fixture> {
    let (dir, path) = temp()?;
    let mut db = setup(&path)?;
    let context = ctx("one");
    create_project(&mut db, &context)?;
    put_asset(&mut db, &context, "asset-one", "hero.png", "image/png", HERO)?;
    seed_legacy(&mut db)?;
    let catalog_sha = seed_catalog_asset(&db)?;
    let repo_head = seed_repository(&db)?;
    let source_dir = db.directory.clone();
    Ok(Fixture {
        _dir: dir,
        db,
        source_dir,
        repo_head,
        catalog_sha,
    })
}

fn export_to(db: &mut TaskJournal, path: &Path) -> Result<Value> {
    db.backup_export_portable(&json!({
        "operationId": "portable-1",
        "archivePath": path.to_string_lossy(),
    }))
}

#[test]
fn portable_archive_restores_into_a_new_directory_without_the_source() -> Result<()> {
    let mut fixture = fixture()?;
    let archives = tempfile::tempdir()?;
    let archive = archives.path().join("world.cmarchive");

    let exported = export_to(&mut fixture.db, &archive)?;
    assert_eq!(exported["status"], "completed");
    assert_eq!(exported["credentialsIncluded"], false);
    assert_eq!(exported["sessionRowsIncluded"], true);
    // Rebuildable caches are declared, never shipped.
    let excluded = exported["rebuildableExcluded"].as_array().unwrap();
    assert!(excluded.len() >= 3);
    assert!(excluded.iter().all(|entry| entry["excluded"] == true));
    // Every non-rebuildable body is inside the archive.
    assert!(exported["content"]["legacyImports"].as_u64().unwrap() >= 1);
    assert!(exported["content"]["sourceBlobs"].as_u64().unwrap() >= 1);
    assert!(exported["content"]["godotAssetBodies"].as_u64().unwrap() >= 1);
    assert!(exported["content"]["assetBlobs"].as_u64().unwrap() == 1);
    assert!(exported["content"]["gitRefs"].as_u64().unwrap() >= 1);

    let verified = fixture
        .db
        .backup_verify_portable(&json!({"archivePath": archive.to_string_lossy()}))?;
    assert_eq!(verified["valid"], true);
    assert!(verified["verifiedFiles"].as_u64().unwrap() >= 6);

    let domain_hash = exported["manifest"]["domainHash"].clone();
    let source_fingerprint = fingerprint(&fixture.db.db)?;
    assert_eq!(domain_hash, source_fingerprint);

    // The original data directory becomes unreadable before the restore starts.
    let source = fixture.source_dir.clone();
    let holding = tempfile::tempdir()?;
    let moved = holding.path().join("data-moved-away");
    drop(fixture.db);
    fs::rename(&source, &moved)?;
    assert!(!source.exists(), "the source path must no longer resolve");

    // Restore into a completely new data directory, as a fresh installation
    // would. Nothing from `source` is reachable.
    let fresh_root = tempfile::tempdir()?;
    let target = fresh_root.path().join("data");
    let mut fresh = TaskJournal::open(&target.join("tasks.sqlite"))?;
    let restored = fresh.backup_restore_portable(&json!({
        "operationId": "restore-1",
        "archivePath": archive.to_string_lossy(),
        "targetDirectory": target.to_string_lossy(),
    }))?;
    assert_eq!(restored["status"], "completed");
    assert_eq!(restored["restoredInPlace"], true);
    assert_eq!(restored["domainHash"], domain_hash);
    let proof=fresh.backup_restore_proof(&json!({"operationId":"restore-1","archiveHash":restored["archiveHash"]}))?;
    assert_eq!(proof["verified"],true);
    assert_eq!(proof["domainHash"],restored["domainHash"]);
    assert!(fresh.backup_restore_proof(&json!({"operationId":"another-restore","archiveHash":restored["archiveHash"]})).is_err());
    assert_eq!(restored["currentHash"], domain_hash);

    // Worlds, drafts, progress and source content are all back.
    assert_eq!(fresh.world_list()?.len(), 2);
    assert_eq!(fresh.world_read("a")?.world.snapshot, world().snapshot);
    let manifest_hash: String = fresh.db.query_row(
        "SELECT hash FROM craftmine_godot_revisions WHERE world_id='a' AND revision=0",
        [],
        |row| row.get(0),
    )?;
    let read = fresh.godot_project_read(&json!({
        "worldId": "a", "context": ctx("one"), "revision": 0,
        "manifestHash": manifest_hash, "path": "project.godot"
    }))?;
    assert_eq!(read["text"], PROJECT);
    let restored_blob = target
        .join("godot-source")
        .join(digest("a"))
        .join("blobs")
        .join(digest(PROJECT));
    assert_eq!(fs::read_to_string(&restored_blob)?, PROJECT);

    // The sealed legacy import, the Godot asset body and the asset library
    // body are byte-identical to what was archived.
    let legacy = target.join("legacy-imports/import/source/project.json");
    assert_eq!(fs::read_to_string(&legacy)?, LEGACY_PROJECT);
    let godot_asset = target
        .join("godot-assets")
        .join(digest("a"))
        .join(digest_bytes(HERO));
    assert_eq!(fs::read(&godot_asset)?, HERO);
    let catalog = target
        .join("asset-catalog/blobs")
        .join(&fixture.catalog_sha[..2])
        .join(&fixture.catalog_sha);
    assert_eq!(fs::read(&catalog)?, HERO);

    // Git history and branches survive through the offline carrier.
    let store = repository_store(&target)?;
    let layout = store.open_existing("repo-world-a")?;
    assert_eq!(
        store.branch_head(&layout, MAIN_BRANCH)?,
        Some(fixture.repo_head.clone())
    );
    assert_eq!(
        store.read_file(&layout, &fixture.repo_head, "project.godot")?,
        b"config_version=5\nname=\"town\"\n"
    );
    // History is queryable in the restored installation, not just present as
    // objects: both commits are reachable from the restored branch.
    let page = store.history(&layout, MAIN_BRANCH, 0, 10)?;
    assert_eq!(page.total, 2);
    assert_eq!(page.records.len(), 2);
    fresh.db.execute("UPDATE craftmine_worlds SET title='changed after restart' WHERE id='a'",[])?;
    let after=fresh.backup_restore_proof(&json!({"operationId":"restore-1","archiveHash":restored["archiveHash"]}))?;
    assert_eq!(after["domainHash"],proof["domainHash"]);
    assert_ne!(after["currentHash"],proof["currentHash"]);

    // The moved-away source is untouched by the restore.
    assert!(moved.join("tasks.sqlite").is_file());
    assert!(!moved.join(".craftmine-restore-receipt.json").exists());
    Ok(())
}

/// Rebuilds an archive in the same container format so tests can craft
/// deliberately broken input.
fn build_archive(entries: Vec<(Value, Vec<u8>)>) -> Vec<u8> {
    let snapshot_hash = entries
        .iter()
        .find(|(entry, _)| entry["kind"] == "domain")
        .map(|(entry, _)| entry["sha256"].clone())
        .unwrap_or(Value::Null);
    let header = json!({
        "format": FORMAT, "schemaVersion": SCHEMA_VERSION, "createdAt": 1,
        "sourceDigest": "synthetic", "entryCount": entries.len(),
        "rebuildable": [],
        "consistency": {"snapshotHash": snapshot_hash, "credentialsIncluded": false},
    });
    let mut out = Vec::new();
    let mut hasher = Sha256::new();
    out.extend_from_slice(MAGIC);
    let header_text = serde_json::to_string(&header).unwrap();
    out.extend_from_slice(header_text.as_bytes());
    out.push(b'\n');
    hasher.update(header_text.as_bytes());
    hasher.update(b"\n");
    for (entry, _) in &entries {
        let text = serde_json::to_string(entry).unwrap();
        out.extend_from_slice(text.as_bytes());
        out.push(b'\n');
        hasher.update(text.as_bytes());
        hasher.update(b"\n");
    }
    let mut content_bytes = 0u64;
    for (_, body) in &entries {
        out.extend_from_slice(body);
        content_bytes += body.len() as u64;
    }
    let footer = json!({
        "format": FORMAT, "entryCount": entries.len(),
        "contentBytes": content_bytes, "archiveHash": hex(hasher.finalize()),
    });
    out.extend_from_slice(serde_json::to_string(&footer).unwrap().as_bytes());
    out.push(b'\n');
    out
}

fn entry(kind: &str, path: &str, body: &[u8]) -> (Value, Vec<u8>) {
    (
        json!({
            "path": path, "kind": kind, "owner": "test", "world": null,
            "bytes": body.len(), "sha256": digest_bytes(body), "refs": [],
            "repoId": null, "objectFormat": null, "oid": null,
            "objectType": null, "body": !body.is_empty(),
        }),
        body.to_vec(),
    )
}

/// Flips one byte inside the first content body, so the failure is a body hash
/// mismatch rather than a broken metadata line.
fn corrupt_first_body(archive: &Path, out: &Path) -> Result<()> {
    let bytes = fs::read(archive)?;
    let header_end = bytes[MAGIC.len()..]
        .iter()
        .position(|byte| *byte == b'\n')
        .context("header line")?
        + MAGIC.len()
        + 1;
    let header: Value = serde_json::from_slice(&bytes[MAGIC.len()..header_end - 1])?;
    let count = header["entryCount"].as_u64().context("entryCount")? as usize;
    let mut cursor = header_end;
    for _ in 0..count {
        let newline = bytes[cursor..]
            .iter()
            .position(|byte| *byte == b'\n')
            .context("entry line")?
            + cursor;
        cursor = newline + 1;
    }
    let mut copy = bytes.clone();
    copy[cursor] ^= 0x01;
    fs::write(out, &copy)?;
    Ok(())
}

#[test]
fn a_damaged_archive_is_refused_and_never_touches_the_target() -> Result<()> {
    let mut fixture = fixture()?;
    let archives = tempfile::tempdir()?;
    let archive = archives.path().join("world.cmarchive");
    export_to(&mut fixture.db, &archive)?;

    // A single flipped body byte is detected before anything is restored.
    let damaged = archives.path().join("damaged.cmarchive");
    corrupt_first_body(&archive, &damaged)?;
    let error = fixture
        .db
        .backup_verify_portable(&json!({"archivePath": damaged.to_string_lossy()}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("BACKUP_HASH_MISMATCH"), "{error}");

    let fresh_root = tempfile::tempdir()?;
    let target = fresh_root.path().join("data");
    let mut fresh = TaskJournal::open(&target.join("tasks.sqlite"))?;
    let error = fresh
        .backup_restore_portable(&json!({
            "operationId": "restore-bad",
            "archivePath": damaged.to_string_lossy(),
            "targetDirectory": target.to_string_lossy(),
        }))
        .unwrap_err()
        .to_string();
    assert!(error.contains("BACKUP_HASH_MISMATCH"), "{error}");
    // A failed restore leaves no half-populated directory behind.
    assert!(fresh.world_list()?.is_empty());
    assert!(fs::read_dir(&target)?
        .filter_map(|entry| entry.ok())
        .all(|entry| !entry
            .file_name()
            .to_string_lossy()
            .starts_with(".craftmine-restore-")));

    // A truncated archive is refused as well.
    let bytes = fs::read(&archive)?;
    let truncated = archives.path().join("truncated.cmarchive");
    fs::write(&truncated, &bytes[..bytes.len() / 2])?;
    let error = fixture
        .db
        .backup_verify_portable(&json!({"archivePath": truncated.to_string_lossy()}))
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("BACKUP_ARCHIVE_TRUNCATED")
            || error.contains("BACKUP_HASH_MISMATCH")
            || error.contains("BACKUP_ARCHIVE_LINE_TOO_LARGE"),
        "{error}"
    );
    Ok(())
}

#[test]
fn a_domain_failure_leaves_no_half_populated_target() -> Result<()> {
    // Content that would be placed, plus a domain that applies but fails
    // integrity validation: a session row references a world that does not
    // exist. The restore must roll back and remove the content it had already
    // moved into the target.
    let body = b"legacy-bytes";
    let root = tempfile::tempdir()?;
    let target = root.path().join("data");
    let mut fresh = TaskJournal::open(&target.join("tasks.sqlite"))?;
    let mut domain = snapshot(&fresh.db, &tables(&fresh.db)?)?;
    domain["craftmine_session_worlds"]["rows"] = json!([["session-a", "project-a", "ghost", "task-a"]]);
    let domain_body = serde_json::to_vec(&domain)?;

    let mut entries = vec![
        entry("legacy-import", "legacy-imports/import/source/x.txt", body),
        (
            json!({
                "path": "domain.json", "kind": "domain", "owner": "test", "world": null,
                "bytes": domain_body.len(), "sha256": digest_bytes(&domain_body),
                "refs": [], "repoId": null, "objectFormat": null, "oid": null,
                "objectType": null, "body": true,
            }),
            domain_body,
        ),
    ];
    entries.sort_by(|left, right| left.0["path"].as_str().cmp(&right.0["path"].as_str()));
    let archives = tempfile::tempdir()?;
    let archive = archives.path().join("crafted.cmarchive");
    fs::write(&archive, build_archive(entries))?;

    let error = fresh
        .backup_restore_portable(&json!({
            "operationId": "restore-crafted",
            "archivePath": archive.to_string_lossy(),
            "targetDirectory": target.to_string_lossy(),
        }))
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("BACKUP_FOREIGN_KEY_FAILURE"),
        "{error}"
    );
    assert!(fresh.world_list()?.is_empty());
    assert!(
        !target.join("legacy-imports/import/source/x.txt").exists(),
        "content placed before the domain failure must be rolled back"
    );
    assert!(fs::read_dir(&target)?.all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".craftmine-restore-")
    }));
    Ok(())
}

#[test]
fn an_entry_cannot_write_outside_the_root_of_its_kind() -> Result<()> {
    let archives = tempfile::tempdir()?;
    for (kind, path) in [
        ("legacy-import", "tasks.sqlite"),
        ("legacy-import", "asset-catalog/blobs/aa/x"),
        ("godot-source-blob", "legacy-imports/import/manifest.json"),
        ("domain", "legacy-imports/import/manifest.json"),
        ("content-repo-object", "content-history/repo.git/objects/x"),
        ("unknown-kind", "legacy-imports/import/manifest.json"),
    ] {
        let archive = archives.path().join("crafted.cmarchive");
        fs::write(&archive, build_archive(vec![entry(kind, path, b"x")]))?;
        let root = tempfile::tempdir()?;
        let target = root.path().join("data");
        let fresh = TaskJournal::open(&target.join("tasks.sqlite"))?;
        let error = fresh
            .backup_verify_portable(&json!({"archivePath": archive.to_string_lossy()}))
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("INVALID_ARCHIVE_PATH"),
            "{kind} {path}: {error}"
        );
    }
    Ok(())
}

#[test]
fn restore_into_a_separate_empty_directory_creates_a_new_database() -> Result<()> {
    let mut fixture = fixture()?;
    let archives = tempfile::tempdir()?;
    let archive = archives.path().join("world.cmarchive");
    export_to(&mut fixture.db, &archive)?;

    let root = tempfile::tempdir()?;
    let target = root.path().join("elsewhere");
    let restored = fixture.db.backup_restore_portable(&json!({
        "operationId": "restore-elsewhere",
        "archivePath": archive.to_string_lossy(),
        "targetDirectory": target.to_string_lossy(),
    }))?;
    assert_eq!(restored["restoredInPlace"], false);
    assert!(target.join("tasks.sqlite").is_file());
    let reopened = TaskJournal::open(&target.join("tasks.sqlite"))?;
    assert_eq!(reopened.world_list()?.len(), 2);
    assert!(target
        .join("legacy-imports/import/source/project.json")
        .is_file());
    // The exporting installation is untouched.
    assert_eq!(fixture.db.world_list()?.len(), 2);
    Ok(())
}

#[test]
fn restore_refuses_a_target_that_already_holds_a_world() -> Result<()> {    let mut fixture = fixture()?;
    let archives = tempfile::tempdir()?;
    let archive = archives.path().join("world.cmarchive");
    export_to(&mut fixture.db, &archive)?;
    // The exporting installation still holds worlds, so it cannot restore over
    // itself.
    let error = fixture
        .db
        .backup_restore_portable(&json!({
            "operationId": "restore-over",
            "archivePath": archive.to_string_lossy(),
            "targetDirectory": fixture.source_dir.to_string_lossy(),
        }))
        .unwrap_err()
        .to_string();
    assert!(error.contains("BACKUP_TARGET_NOT_EMPTY"), "{error}");
    // Nothing changed.
    assert_eq!(fixture.db.world_list()?.len(), 2);
    Ok(())
}

#[test]
fn retained_archives_protect_content_from_the_reclaimer() -> Result<()> {
    let (dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let context = ctx("one");
    let created = create_project(&mut journal, &context)?;
    let job = start(&mut journal, &context, "build-one", &created, "build")?;
    journal.godot_build_cancel(&json!({"worldId": "a", "context": &context, "jobId": job["jobId"]}))?;
    let build = job["buildId"].as_str().unwrap().to_owned();

    let archives = tempfile::tempdir()?;
    let archive = archives.path().join("world.cmarchive");
    export_to(&mut journal, &archive)?;

    let protected = journal.backup_protected_refs(&json!({"worldId": null}))?;
    let builds: Vec<String> = protected["builds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_owned())
        .collect();
    assert!(builds.contains(&build), "the archive pins its builds");
    assert!(protected["sourceBlobs"].as_array().unwrap().len() >= 1);

    // R1's real reclaimer consumes exactly this list.
    let plan = journal.godot_storage_reclaim_plan(&json!({
        "worldId": "a", "context": &context, "protectedBuilds": builds, "keepRecentBuilds": 0
    }))?;
    assert!(
        plan["deletable"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["buildId"] != json!(build)),
        "a retained backup pins its build: {plan}"
    );
    assert!(plan["protected"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["buildId"] == json!(build) && entry["reason"] == "CALLER_PINNED"));

    // Releasing the archive hands the build back to the reclaimer.
    journal.backup_release_portable(&json!({"archiveId": "portable-1"}))?;
    let released = journal.backup_protected_refs(&json!({"worldId": null}))?;
    assert!(released["builds"].as_array().unwrap().is_empty());
    let plan = journal.godot_storage_reclaim_plan(&json!({
        "worldId": "a", "context": &context, "protectedBuilds": [], "keepRecentBuilds": 0
    }))?;
    assert!(plan["deletable"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["buildId"] == json!(build)));
    drop(dir);
    Ok(())
}

#[test]
fn an_interrupted_export_keeps_no_retained_protection() -> Result<()> {
    let (dir, path) = temp()?;
    let mut journal = setup(&path)?;
    // Simulate a crash between the pin transaction and the completed job row.
    journal.db.execute(
        "INSERT INTO craftmine_backup_jobs(id,kind,status,request_hash,receipt,created_at)
         VALUES('portable-1','export-portable','streaming','r','{}',1)",
        [],
    )?;
    journal.db.execute(
        "INSERT INTO craftmine_backup_pins(archive_id,kind,ref,world_id,status,created_at,updated_at)
         VALUES('portable-1','build','gbd-crashed','a','streaming',1,1)",
        [],
    )?;
    assert_eq!(journal.backup_recover()?, 1);
    let status: String = journal.db.query_row(
        "SELECT status FROM craftmine_backup_pins WHERE archive_id='portable-1'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(status, "abandoned");
    let protected = journal.backup_protected_refs(&json!({"worldId": null}))?;
    assert!(protected["builds"].as_array().unwrap().is_empty());
    drop(dir);
    Ok(())
}

#[test]
fn archive_paths_cannot_escape_the_target_directory() -> Result<()> {
    for name in [
        "../escape.json",
        "/absolute.json",
        "a/../../b.json",
        "C:/windows.json",
        "a\\b.json",
    ] {
        assert!(
            relative_path(name).is_err(),
            "{name} must be rejected as an archive path"
        );
    }
    assert!(relative_path("legacy-imports/import/source/project.json").is_ok());
    Ok(())
}

/// Evidence generator for the round-two report. Ignored by default because it
/// writes an archive; run with `R5_EVIDENCE_DIR` set and `--ignored --nocapture`.
#[test]
#[ignore = "evidence generator; requires R5_EVIDENCE_DIR"]
fn evidence_archive_manifest_and_restore_state() -> Result<()> {
    let out = PathBuf::from(std::env::var("R5_EVIDENCE_DIR").expect("R5_EVIDENCE_DIR"));
    fs::create_dir_all(&out)?;
    let mut fixture = fixture()?;
    // The archive itself is large and binary; only the text evidence is kept.
    let archive = std::env::temp_dir().join(format!(
        "r5-evidence-{}-{}.cmarchive",
        std::process::id(),
        worlds::timestamp()?
    ));
    let exported = export_to(&mut fixture.db, &archive)?;

    let bytes = fs::read(&archive)?;
    let header_end = bytes[MAGIC.len()..]
        .iter()
        .position(|byte| *byte == b'\n')
        .context("header line")?
        + MAGIC.len()
        + 1;
    let header: Value = serde_json::from_slice(&bytes[MAGIC.len()..header_end - 1])?;
    println!("=== archive manifest ===");
    println!("{}", serde_json::to_string_pretty(&header)?);
    println!(
        "archive: {} bytes at {} (not committed)",
        bytes.len(),
        archive.to_string_lossy()
    );
    println!("=== export receipt ===");
    println!("{}", serde_json::to_string_pretty(&exported)?);
    println!("=== verify report ===");
    println!(
        "{}",
        serde_json::to_string_pretty(
            &fixture
                .db
                .backup_verify_portable(&json!({"archivePath": archive.to_string_lossy()}))?
        )?
    );

    let domain_hash = exported["manifest"]["domainHash"].clone();
    let source = fixture.source_dir.clone();
    let holding = tempfile::tempdir()?;
    let moved = holding.path().join("data-moved-away");
    let source_listing: Vec<String> = fs::read_dir(&source)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    drop(fixture.db);
    fs::rename(&source, &moved)?;
    println!("=== source-unreadable condition ===");
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "sourceDirectory": source.to_string_lossy(),
            "sourceStillResolves": source.exists(),
            "movedTo": moved.to_string_lossy(),
            "movedStillResolves": moved.exists(),
            "topLevelBeforeMove": source_listing,
        }))?
    );

    let fresh_root = tempfile::tempdir()?;
    let target = fresh_root.path().join("data");
    let mut fresh = TaskJournal::open(&target.join("tasks.sqlite"))?;
    let restored = fresh.backup_restore_portable(&json!({
        "operationId": "evidence-restore",
        "archivePath": archive.to_string_lossy(),
        "targetDirectory": target.to_string_lossy(),
    }))?;
    println!("=== restore receipt ===");
    println!("{}", serde_json::to_string_pretty(&restored)?);
    println!("=== restored state ===");
    let store = repository_store(&target)?;
    let layout = store.open_existing("repo-world-a")?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "domainHash": domain_hash,
            "restoredCurrentHash": restored["currentHash"],
            "worlds": fresh.world_list()?.len(),
            "worldAProgress": fresh.world_read("a")?.world.snapshot,
            "legacyProjectRestored": target.join("legacy-imports/import/source/project.json").is_file(),
            "sourceBlobRestored": target
                .join("godot-source").join(digest("a")).join("blobs").join(digest(PROJECT)).is_file(),
            "godotAssetRestored": target
                .join("godot-assets").join(digest("a")).join(digest_bytes(HERO)).is_file(),
            "assetBlobRestored": target
                .join("asset-catalog/blobs").join(&fixture.catalog_sha[..2])
                .join(&fixture.catalog_sha).is_file(),
            "gitHead": store.branch_head(&layout, MAIN_BRANCH)?,
            "gitHeadMatchesSource": store.branch_head(&layout, MAIN_BRANCH)? == Some(fixture.repo_head.clone()),
            "gitFileMatchesSource": store.read_file(&layout, &fixture.repo_head, "project.godot")?
                == b"config_version=5\nname=\"town\"\n",
        }))?
    );
    Ok(())
}

/// The portable archive snapshots every registered `craftmine_*` table, not a
/// hardcoded list, so a module that registers tables later is covered.
#[test]
fn every_registered_table_is_inside_the_snapshot() -> Result<()> {
    let (dir, path) = temp()?;
    let journal = setup(&path)?;
    let registered = registered_tables(&journal.db)?;
    for expected in [
        "craftmine_worlds",
        "craftmine_tasks",
        "craftmine_godot_revisions",
        "craftmine_godot_builds",
        "craftmine_asset_versions",
        "craftmine_asset_files",
        "craftmine_content_repositories",
        "craftmine_library",
        "craftmine_packages",
    ] {
        assert!(registered.contains(&expected.to_owned()), "{expected}");
    }
    // Operational receipts describe this installation and never travel.
    assert!(!registered.contains(&"craftmine_backup_jobs".to_owned()));
    assert!(!registered.contains(&"craftmine_backup_pins".to_owned()));
    drop(dir);
    Ok(())
}

/// Deterministic pseudo-random body: the same bytes on every run.
fn pseudo_random_bytes(len: usize, seed: usize) -> Vec<u8> {
    (0..len)
        .map(|offset| ((seed * 31 + offset * 7) % 251) as u8)
        .collect()
}

/// High-water mark of this process's commit charge, in bytes.
#[cfg(windows)]
fn peak_pagefile_bytes() -> u64 {
    #[repr(C)]
    #[allow(dead_code)]
    #[derive(Default)]
    struct ProcessMemoryCountersEx {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
        private_usage: usize,
    }
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn K32GetProcessMemoryInfo(
            process: isize,
            counters: *mut ProcessMemoryCountersEx,
            cb: u32,
        ) -> i32;
    }
    let mut counters = ProcessMemoryCountersEx::default();
    counters.cb = std::mem::size_of::<ProcessMemoryCountersEx>() as u32;
    let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) };
    assert!(ok != 0, "K32GetProcessMemoryInfo failed");
    counters.peak_pagefile_usage as u64
}

/// 40 files of 2 MiB make roughly 80 MiB of `cat-file --batch` output, which is
/// above the adapter's 64 MiB buffered stdout limit. The export can only succeed
/// when the object bodies are streamed; the buffering path fails with
/// `BACKUP_GIT_TRUNCATED` before this test reaches its assertions. Ignored by
/// default because it moves a few hundred MiB through the disk; run explicitly:
/// `cargo test -p craftmine-core --lib backups::portable -- --ignored --nocapture`.
#[test]
#[ignore = "writes ~80 MiB of Git objects; run explicitly with --ignored"]
fn a_repository_larger_than_the_buffered_stdout_cap_exports_and_verifies() -> Result<()> {
    const FILES: usize = 40;
    const FILE_BYTES: usize = 2 * 1024 * 1024;
    // The export must not raise the process's commit-charge high-water mark by
    // more than this. Buffering one whole `cat-file --batch` stream would need
    // about 80 MiB, so the bound separates streaming from buffering.
    const MARGINAL_PEAK_LIMIT_MIB: u64 = 32;

    let (dir, path) = temp()?;
    let mut journal = setup(&path)?;
    let store = repository_store(&journal.directory)?;
    let layout = store.create("repo-large", "sha1", None)?;
    // Commit one 2 MiB blob at a time so the fixture itself never holds more
    // than one blob; the repository as a whole still streams ~80 MiB out of
    // `cat-file --batch`, which is what the export has to handle.
    let mut parent: Option<String> = None;
    for index in 0..FILES {
        let files = [ContentFile {
            path: format!("blob-{index:02}.bin"),
            bytes: pseudo_random_bytes(FILE_BYTES, index),
        }];
        parent = Some(store.commit(
            &layout,
            MAIN_BRANCH,
            parent.as_deref(),
            &files,
            &commit_message(
                "req-large",
                "task-large",
                &format!("large world {index}"),
                "",
            )?,
        )?);
    }
    journal.db.execute(
        "INSERT INTO craftmine_content_repositories(world_id,repo_id,object_format,backend,
         legacy_head_revision,created_at,switched_at) VALUES('a','repo-large','sha1','git',NULL,1,1)",
        [],
    )?;

    let archives = tempfile::tempdir()?;
    let archive = archives.path().join("large.cmarchive");
    #[cfg(windows)]
    let before = peak_pagefile_bytes();
    let exported = export_to(&mut journal, &archive)?;
    #[cfg(windows)]
    let after = peak_pagefile_bytes();

    assert_eq!(exported["status"], "completed");
    let content_bytes = exported["manifest"]["contentBytes"].as_u64().unwrap();
    assert!(
        content_bytes >= (FILES * FILE_BYTES) as u64,
        "every object body must be in the archive, got {content_bytes} bytes"
    );
    assert!(
        exported["content"]["gitObjects"].as_u64().unwrap() >= (FILES + 2) as u64,
        "the commit, its root tree and {FILES} blobs are all archived"
    );

    let verified = journal.backup_verify_portable(&json!({
        "archivePath": archive.to_string_lossy()
    }))?;
    assert_eq!(verified["valid"], true);
    assert!(verified["verifiedFiles"].as_u64().unwrap() >= (FILES + 2) as u64);

    #[cfg(windows)]
    {
        let marginal_mib = after.saturating_sub(before) / (1024 * 1024);
        println!(
            "export marginal peak commit: {marginal_mib} MiB \
             (peak before {before} bytes, peak after {after} bytes, content {content_bytes} bytes)"
        );
        assert!(
            marginal_mib <= MARGINAL_PEAK_LIMIT_MIB,
            "export raised the peak commit charge by {marginal_mib} MiB, above the \
             {MARGINAL_PEAK_LIMIT_MIB} MiB bound"
        );
    }
    #[cfg(not(windows))]
    let _ = MARGINAL_PEAK_LIMIT_MIB;

    drop(dir);
    Ok(())
}
