//! VM1 migration tests: legacy immutable revisions become real Git history,
//! byte for byte, and the legacy write path closes afterwards.

use std::{collections::BTreeMap, path::Path};

use anyhow::Result;
use serde_json::json;

use super::git::{GitAdapter, GitIdentity};
use super::migration::*;
use super::repo::{RepositoryStore, MAIN_BRANCH, MIGRATION_REF_PREFIX};
use crate::{digest, TaskJournal};

struct Fixture {
    _dir: tempfile::TempDir,
    journal: TaskJournal,
    store: RepositoryStore,
    directory: std::path::PathBuf,
}

fn fixture(revisions: &[(u64, &str, &str)]) -> Result<Fixture> {
    let dir = tempfile::tempdir()?;
    let journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    let directory = dir.path().to_path_buf();
    journal.db.execute(
        "INSERT INTO craftmine_worlds(id,title,revision,updated_at,document,content_hash)
         VALUES(?1,'Legacy world',0,0,'{}',?2)",
        rusqlite::params!["world-legacy", digest("{}")],
    )?;
    for (revision, path, text) in revisions {
        write_legacy_revision(&journal, &directory, *revision, &[(*path, *text)])?;
    }
    let store = RepositoryStore::open(
        &directory.join("content-history"),
        GitAdapter::discover(
            &directory.join("git-config"),
            &[],
            GitIdentity::local("Craftmine Tester", "test-stable-id")?,
        )?,
    )?;
    Ok(Fixture {
        _dir: dir,
        journal,
        store,
        directory,
    })
}

/// Insert one legacy revision exactly as the old backend would have stored it:
/// a validated manifest row plus content-addressed blobs on disk.
fn write_legacy_revision(
    journal: &TaskJournal,
    directory: &Path,
    revision: u64,
    files: &[(&str, &str)],
) -> Result<()> {
    let world = "world-legacy";
    let mut entries = BTreeMap::new();
    for (path, text) in files {
        let sha256 = digest(text);
        entries.insert(
            path.to_string(),
            json!({"sha256": sha256, "bytes": text.len() as u64}),
        );
        let blobs = directory
            .join("godot-source")
            .join(digest(world))
            .join("blobs");
        std::fs::create_dir_all(&blobs)?;
        std::fs::write(blobs.join(&sha256), text)?;
    }
    if !entries.contains_key("project.godot") {
        let text = "config_version=5\n";
        let sha256 = digest(text);
        entries.insert(
            "project.godot".to_string(),
            json!({"sha256": sha256, "bytes": text.len() as u64}),
        );
        let blobs = directory
            .join("godot-source")
            .join(digest(world))
            .join("blobs");
        std::fs::create_dir_all(&blobs)?;
        std::fs::write(blobs.join(&sha256), text)?;
    }
    let manifest = json!({
        "format": "craftmine.godot-project/1",
        "worldId": world,
        "baseBuild": "build-1",
        "baseId": "first-person",
        "engineVersion": "4.7.2-stable",
        "language": "GDScript",
        "renderer": "gl_compatibility",
        "target": "web",
        "revision": revision,
        "task": {
            "projectId": world,
            "sessionId": "session-1",
            "turnId": format!("turn-{revision}"),
            "taskId": format!("task-{revision}"),
            "baseBuild": "build-1"
        },
        "files": entries
    });
    let body = serde_json::to_string(&manifest)?;
    let hash = digest(&body);
    let task_id = format!("task-{revision}");
    let binding = json!({
        "projectId": world,
        "sessionId": "session-1",
        "turnId": format!("turn-{revision}"),
        "taskId": task_id,
        "baseBuild": "build-1"
    });
    journal.db.execute(
        "INSERT INTO craftmine_tasks(id,binding,status,revision,draft,draft_hash)
         VALUES(?1,?2,'finished',0,'{}',?3)",
        rusqlite::params![task_id, serde_json::to_string(&binding)?, digest("{}")],
    )?;
    journal.db.execute(
        "INSERT INTO craftmine_godot_revisions(world_id,revision,task_id,manifest,hash)
         VALUES(?1,?2,?3,?4,?5)",
        rusqlite::params![
            world,
            i64::try_from(revision)?,
            format!("task-{revision}"),
            body,
            hash
        ],
    )?;    journal.db.execute(
        "INSERT INTO craftmine_godot_projects(world_id,revision,manifest,hash)
         VALUES(?1,?2,?3,?4)
         ON CONFLICT(world_id) DO UPDATE SET
            revision=excluded.revision,manifest=excluded.manifest,hash=excluded.hash",
        rusqlite::params![world, i64::try_from(revision)?, body, hash],
    )?;
    Ok(())
}

#[test]
fn plan_reads_every_revision_and_writes_nothing() -> Result<()> {
    let mut fixture = fixture(&[(0, "scenes/a.tscn", "[gd_scene]\n"), (1, "scenes/a.tscn", "[gd_scene name=\"a\"]\n")])?;
    let first = plan(&fixture.journal.db, &fixture.directory, "world-legacy")?;
    assert_eq!(first.world_id, "world-legacy");
    assert_eq!(first.repo_id, "world-world-legacy");
    assert_eq!(first.object_format, "sha1");
    assert_eq!(first.head_revision, 1);
    assert_eq!(first.revisions.len(), 2);
    assert_eq!(first.revisions[0].revision, 0);
    assert_eq!(first.revisions[0].task_id, "task-0");
    assert_eq!(first.revisions[0].manifest_hash.len(), 64);
    assert!(first.problems.is_empty());
    assert_eq!(first.source_digest.len(), 64);
    // Preflight is read-only.
    assert!(!fixture.store.layout(&first.repo_id)?.git_dir.exists());
    assert_eq!(backend(&fixture.journal.db, "world-legacy")?, None);
    assert!(!is_git_backed(&fixture.journal.db, "world-legacy")?);
    assert_legacy_writes_allowed(&fixture.journal.db, "world-legacy")?;

    // The same source always produces the same digest.
    let again = plan(&fixture.journal.db, &fixture.directory, "world-legacy")?;
    assert_eq!(again.source_digest, first.source_digest);
    Ok(())
}

#[test]
fn a_missing_blob_is_reported_and_blocks_the_import() -> Result<()> {
    let mut fixture = fixture(&[(0, "scenes/a.tscn", "[gd_scene]\n")])?;
    let blob = fixture
        .directory
        .join("godot-source")
        .join(digest("world-legacy"))
        .join("blobs")
        .join(digest("[gd_scene]\n"));
    std::fs::remove_file(&blob)?;
    let plan = plan(&fixture.journal.db, &fixture.directory, "world-legacy")?;
    assert_eq!(plan.problems.len(), 1);
    assert!(plan.problems[0].contains("revision 0"));
    let error = apply(
        &mut fixture.journal.db,
        &fixture.directory,
        &fixture.store,
        "world-legacy",
    )
    .unwrap_err()
    .to_string();
    assert!(
        error.starts_with("CONTENT_MIGRATION_SOURCE_INVALID"),
        "unexpected error: {error}"
    );
    assert!(!fixture.store.layout("world-world-legacy")?.git_dir.exists());
    assert_eq!(backend(&fixture.journal.db, "world-legacy")?, None);
    Ok(())
}

#[test]
fn every_revision_becomes_one_commit_and_the_backend_switches() -> Result<()> {
    let mut fixture = fixture(&[
        (0, "scenes/a.tscn", "[gd_scene]\n"),
        (1, "scenes/a.tscn", "[gd_scene name=\"a\"]\n"),
        (2, "scripts/player.gd", "extends Node\n"),
    ])?;
    let report = apply(
        &mut fixture.journal.db,
        &fixture.directory,
        &fixture.store,
        "world-legacy",
    )?;
    assert!(!report.already_migrated);
    assert_eq!(report.imported, 3);
    assert_eq!(report.mapping.len(), 3);
    assert_eq!(report.resumed_from, None);
    let head = report.head_oid.clone().expect("head commit");
    let layout = fixture.store.layout(&report.repo_id)?;

    // Linear history: each commit's parent is the previous revision.
    for pair in report.mapping.windows(2) {
        let parents = fixture
            .store
            .git()
            .log_page(&layout.git_dir, &pair[1].commit_oid, 0, 1)?[0]
            .parents
            .clone();
        assert_eq!(parents, vec![pair[0].commit_oid.clone()]);
    }
    assert_eq!(fixture.store.branch_head(&layout, MAIN_BRANCH)?, Some(head.clone()));

    // Git content matches the legacy bytes for every revision.
    for ((revision, path, text), mapping) in [
        (0, "scenes/a.tscn", "[gd_scene]\n"),
        (1, "scenes/a.tscn", "[gd_scene name=\"a\"]\n"),
        (2, "scripts/player.gd", "extends Node\n"),
    ]
    .iter()
    .zip(&report.mapping)
    {
        assert_eq!(mapping.revision, *revision);
        assert_eq!(
            fixture
                .store
                .read_file(&layout, &mapping.commit_oid, path)?,
            text.as_bytes()
        );
        // Migrated commits have no asset lock and are not playable content.
        assert_eq!(fixture.store.asset_lock(&layout, &mapping.commit_oid)?, None);
    }

    // History is newest first and carries the legacy task trailer, never a
    // fabricated player request.
    let history = fixture.store.history(&layout, MAIN_BRANCH, 0, 10)?;
    assert_eq!(history.total, 3);
    assert_eq!(history.records[0].subject, "Migrate legacy revision 2");
    assert_eq!(history.records[0].task_id.as_deref(), Some("task-2"));
    assert_eq!(history.records[0].request_id, None);

    // Backend state, protected migration tags and the write guard.
    let state = backend(&fixture.journal.db, "world-legacy")?.expect("backend row");
    assert_eq!(state.backend, ContentBackend::Git);
    assert_eq!(state.legacy_head_revision, Some(2));
    assert!(state.switched_at.is_some());
    assert!(is_git_backed(&fixture.journal.db, "world-legacy")?);
    assert!(assert_legacy_writes_allowed(&fixture.journal.db, "world-legacy")
        .unwrap_err()
        .to_string()
        .starts_with("CONTENT_BACKEND_SWITCHED"));
    let protected = fixture.store.protected_refs(&layout)?;
    assert_eq!(protected.len(), 3);
    assert!(protected
        .iter()
        .all(|entry| entry.name.starts_with(MIGRATION_REF_PREFIX)));

    // Re-verification and idempotency.
    assert!(verify(
        &fixture.journal.db,
        &fixture.directory,
        &fixture.store,
        "world-legacy"
    )?
    .is_empty());
    let second = apply(
        &mut fixture.journal.db,
        &fixture.directory,
        &fixture.store,
        "world-legacy",
    )?;
    assert!(second.already_migrated);
    assert_eq!(second.imported, 0);
    assert_eq!(second.head_oid, Some(head));
    Ok(())
}

#[test]
fn a_partial_import_resumes_instead_of_starting_a_second_history() -> Result<()> {
    let mut fixture = fixture(&[
        (0, "scenes/a.tscn", "[gd_scene]\n"),
        (1, "scenes/a.tscn", "[gd_scene name=\"a\"]\n"),
    ])?;
    let report = apply(
        &mut fixture.journal.db,
        &fixture.directory,
        &fixture.store,
        "world-legacy",
    )?;
    let layout = fixture.store.layout(&report.repo_id)?;
    let head = report.head_oid.clone().expect("head");

    // Crash window A: the commit exists on main but the mapping row was never
    // written. The next run must adopt that exact commit, not create a fork.
    fixture.journal.db.execute(
        "DELETE FROM craftmine_content_revision_map WHERE world_id='world-legacy' AND legacy_revision=1",
        [],
    )?;
    fixture.journal.db.execute(
        "UPDATE craftmine_content_repositories SET backend='legacy', switched_at=NULL WHERE world_id='world-legacy'",
        [],
    )?;
    let adopted = apply(
        &mut fixture.journal.db,
        &fixture.directory,
        &fixture.store,
        "world-legacy",
    )?;
    assert!(!adopted.already_migrated);
    assert_eq!(adopted.imported, 0);
    assert_eq!(adopted.adopted, 1);
    assert_eq!(adopted.mapping.len(), 2);
    assert_eq!(adopted.mapping[1].commit_oid, report.mapping[1].commit_oid);
    assert_eq!(adopted.head_oid, Some(head.clone()));

    // Crash window B: the reference moved back before the mapping row landed,
    // so there is nothing to adopt. A fresh commit continues the same history.
    fixture.journal.db.execute(
        "DELETE FROM craftmine_content_revision_map WHERE world_id='world-legacy' AND legacy_revision=1",
        [],
    )?;
    fixture.journal.db.execute(
        "UPDATE craftmine_content_repositories SET backend='legacy', switched_at=NULL WHERE world_id='world-legacy'",
        [],
    )?;
    fixture.store.git().update_ref(
        &layout.git_dir,
        &format!("refs/heads/{MAIN_BRANCH}"),
        &report.mapping[0].commit_oid,
        Some(&head),
    )?;

    let resumed = apply(
        &mut fixture.journal.db,
        &fixture.directory,
        &fixture.store,
        "world-legacy",
    )?;
    assert!(!resumed.already_migrated);
    assert_eq!(resumed.imported, 1);
    assert_eq!(resumed.adopted, 0);
    assert_eq!(resumed.resumed_from, Some(0));
    assert_eq!(resumed.mapping.len(), 2);
    // The resumed commit continues the existing history rather than forking it.
    assert_eq!(resumed.mapping[1].revision, 1);
    assert_ne!(resumed.mapping[1].commit_oid, report.mapping[1].commit_oid);
    let parents = fixture
        .store
        .git()
        .log_page(&layout.git_dir, &resumed.mapping[1].commit_oid, 0, 1)?[0]
        .parents
        .clone();
    assert_eq!(parents, vec![resumed.mapping[0].commit_oid.clone()]);
    assert!(is_git_backed(&fixture.journal.db, "world-legacy")?);
    Ok(())
}

#[test]
fn verification_reports_legacy_damage_after_the_switch() -> Result<()> {
    let mut fixture = fixture(&[(0, "scenes/a.tscn", "[gd_scene]\n")])?;
    apply(
        &mut fixture.journal.db,
        &fixture.directory,
        &fixture.store,
        "world-legacy",
    )?;
    let blob = fixture
        .directory
        .join("godot-source")
        .join(digest("world-legacy"))
        .join("blobs")
        .join(digest("[gd_scene]\n"));
    std::fs::write(&blob, "tampered\n")?;
    let problems = verify(
        &fixture.journal.db,
        &fixture.directory,
        &fixture.store,
        "world-legacy",
    )?;
    assert!(!problems.is_empty());
    assert!(problems.iter().any(|problem| problem.contains("scenes/a.tscn")));
    // Nothing was repaired silently and the backend stays switched.
    assert!(is_git_backed(&fixture.journal.db, "world-legacy")?);
    Ok(())
}
