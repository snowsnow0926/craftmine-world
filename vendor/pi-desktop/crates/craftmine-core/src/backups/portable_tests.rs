//! Portable archive tests.
//!
//! The acceptance case is a restore into a completely new data directory while
//! the original data directory no longer exists. Every fixture is synthetic and
//! runs in an isolated temporary directory.
use super::*;
use crate::content_history::repo::{commit_message, ContentFile, MAIN_BRANCH};
use crate::godot_test_support::*;
use std::fs;

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
    let first = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[ContentFile::text("project.godot", "config_version=5\n")],
        &commit_message("req-1", "task-1", "create world", "")?,
    )?;
    let second = store.commit(
        &layout,
        MAIN_BRANCH,
        Some(&first),
        &[ContentFile::text(
            "project.godot",
            "config_version=5\nname=\"town\"\n",
        )],
        &commit_message("req-1", "task-1", "rename world", "AI patch")?,
    )?;
    db.db.execute(
        "INSERT INTO craftmine_content_repositories(world_id,repo_id,object_format,backend,
         legacy_head_revision,created_at,switched_at) VALUES('a','repo-world-a','sha1','git',NULL,1,1)",
        [],
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
    assert_eq!(exported["sessionIncluded"], false);
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

    // The moved-away source is untouched by the restore.
    assert!(moved.join("tasks.sqlite").is_file());
    assert!(!moved.join(".portable-staging").exists());
    Ok(())
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
    let mut offset = header_end;
    for entry in header["entries"].as_array().context("entries")? {
        let size = entry["bytes"].as_u64().context("bytes")? as usize;
        if entry["body"] == true && size > 0 {
            let mut copy = bytes.clone();
            copy[offset] ^= 0x01;
            fs::write(out, &copy)?;
            return Ok(());
        }
        offset += size;
    }
    anyhow::bail!("no content body found in the archive")
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
            .starts_with(".portable-staging")));

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
fn restore_refuses_a_target_that_already_holds_a_world() -> Result<()> {
    let mut fixture = fixture()?;
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
