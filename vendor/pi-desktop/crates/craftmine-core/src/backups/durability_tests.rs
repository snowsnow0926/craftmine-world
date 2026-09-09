//! Durability tests for the portable restore operation.
//!
//! Every persistent boundary is exercised by a real, separate process that is
//! ended abruptly inside the boundary. The parent then reopens the installation
//! and proves that startup recovery either undoes exactly the recorded work or
//! promotes a restore whose commit already happened.
#![cfg(test)]
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::Result;
use serde_json::{json, Value};

use super::RESTORE_STAGING_PREFIX;
use crate::{digest, godot_test_support::*, TaskJournal, WorkspaceContext};

/// Boundary names understood by the restore implementation. `before-commit` is
/// the case the receipt design rests on: the marker exists, the commit did not
/// happen.
const BEFORE_COMMIT: &[&str] = &[
    "after-claim",
    "after-stage",
    "after-content",
    "after-git",
    "before-commit",
];

/// Builds a source installation with a world, a project and an archive.
fn build_source(root: &Path) -> Result<(TaskJournal, PathBuf)> {
    let source = root.join("source");
    fs::create_dir_all(&source)?;
    let mut journal = setup(&source.join("tasks.sqlite"))?;
    create_project(&mut journal, &ctx("one"))?;
    let archive = root.join("world.cmarchive");
    journal.backup_export_portable(&json!({
        "operationId": "export-durability",
        "archivePath": archive.to_string_lossy(),
    }))?;
    Ok((journal, archive))
}

fn restore_args(archive: &Path, target: &Path) -> Value {
    json!({
        "operationId": "restore-durability",
        "archivePath": archive.to_string_lossy(),
        "targetDirectory": target.to_string_lossy(),
    })
}

/// Driven by the parent test in a separate process. Without `S4_CRASH_ROOT` it
/// does nothing, so an `--ignored` sweep can never build stray state.
#[test]
#[ignore = "crash helper: driven by S4_CRASH_ROOT and CRAFTMINE_S4_CRASH_AT"]
fn crash_helper() -> Result<()> {
    let Ok(root) = std::env::var("S4_CRASH_ROOT") else {
        return Ok(());
    };
    let root = PathBuf::from(root);
    let (source, archive) = build_source(&root)?;
    drop(source);
    let install = root.join("install");
    let mut fresh = TaskJournal::open(&install.join("tasks.sqlite"))?;
    let result = fresh.backup_restore_portable(&restore_args(&archive, &install));
    eprintln!(
        "helper finished without a crash point: {:?}",
        result.map(|_| "completed").map_err(|error| error.to_string())
    );
    Ok(())
}

/// Runs the helper in its own process and requires it to die at `boundary`.
fn crash_at(boundary: &str) -> Result<(tempfile::TempDir, PathBuf)> {
    let root = tempfile::tempdir()?;
    let output = Command::new(std::env::current_exe()?)
        .arg("--exact")
        .arg("backups::portable::durability_tests::crash_helper")
        .arg("--ignored")
        .arg("--nocapture")
        .env("S4_CRASH_ROOT", root.path())
        .env("CRAFTMINE_S4_CRASH_AT", boundary)
        .output()?;
    assert_eq!(
        output.status.code(),
        Some(86),
        "boundary {boundary} did not end the helper process: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    let install = root.path().join("install");
    Ok((root, install))
}

fn restore_leftovers(install: &Path) -> Vec<String> {
    let mut leftovers = Vec::new();
    if let Ok(entries) = fs::read_dir(install) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(RESTORE_STAGING_PREFIX)
                || name == ".craftmine-restore-receipt.json"
            {
                leftovers.push(name);
            }
        }
    }
    leftovers
}

fn job_status(journal: &TaskJournal, id: &str) -> Result<String> {
    Ok(journal.db.query_row(
        "SELECT status FROM craftmine_backup_jobs WHERE id=?1",
        [id],
        |row| row.get(0),
    )?)
}

fn project_text(journal: &TaskJournal) -> Result<String> {
    let manifest_hash: String = journal.db.query_row(
        "SELECT hash FROM craftmine_godot_revisions WHERE world_id='a' AND revision=0",
        [],
        |row| row.get(0),
    )?;
    let read = journal.godot_project_read(&json!({
        "worldId": "a", "context": ctx("one"), "revision": 0,
        "manifestHash": manifest_hash, "path": "project.godot"
    }))?;
    Ok(read["text"].as_str().unwrap_or_default().to_owned())
}

#[test]
fn a_kill_before_the_commit_is_undone_and_the_same_operation_can_retry() -> Result<()> {
    for boundary in BEFORE_COMMIT {
        let (root, install) = crash_at(boundary)?;
        let mut journal = TaskJournal::open(&install.join("tasks.sqlite"))?;
        // The durable intent existed before any body moved.
        assert_eq!(job_status(&journal, "restore-durability")?, "restoring", "{boundary}");
        let job: Option<String> = journal.db.query_row(
            "SELECT archive FROM craftmine_backup_jobs WHERE id='restore-durability'",
            [],
            |row| row.get(0),
        )?;
        assert!(job.is_some(), "{boundary}: the job row must carry its target");

        journal.backup_recover()?;
        assert_eq!(
            job_status(&journal, "restore-durability")?,
            "interrupted",
            "{boundary}"
        );
        assert!(journal.world_list()?.is_empty(), "{boundary}");
        assert!(
            restore_leftovers(&install).is_empty(),
            "{boundary}: {:?}",
            restore_leftovers(&install)
        );

        // A retry with the same operation id must converge, not be refused.
        let archive = root.path().join("world.cmarchive");
        let report = journal.backup_restore_portable(&restore_args(&archive, &install))?;
        assert_eq!(report["status"], "completed", "{boundary}");
        assert_eq!(journal.world_list()?.len(), 2, "{boundary}");
        assert_eq!(project_text(&journal)?, PROJECT, "{boundary}");
        assert!(
            restore_leftovers(&install).is_empty(),
            "{boundary}: {:?}",
            restore_leftovers(&install)
        );
        drop(root);
    }
    Ok(())
}

#[test]
fn a_kill_after_the_commit_is_promoted_from_the_precommit_receipt() -> Result<()> {
    let (root, install) = crash_at("after-commit")?;
    let mut journal = TaskJournal::open(&install.join("tasks.sqlite"))?;
    assert_eq!(job_status(&journal, "restore-durability")?, "restoring");
    journal.backup_recover()?;
    assert_eq!(job_status(&journal, "restore-durability")?, "completed");
    assert_eq!(journal.world_list()?.len(), 2);
    assert_eq!(project_text(&journal)?, PROJECT);
    assert!(restore_leftovers(&install).is_empty());

    // The reply may be lost; the same operation id returns the same result.
    let receipt: String = journal.db.query_row(
        "SELECT receipt FROM craftmine_backup_jobs WHERE id='restore-durability'",
        [],
        |row| row.get(0),
    )?;
    let receipt: Value = serde_json::from_str(&receipt)?;
    assert_eq!(receipt["status"], "completed");
    let archive = root.path().join("world.cmarchive");
    let again = journal.backup_restore_portable(&restore_args(&archive, &install))?;
    assert_eq!(again["currentHash"], receipt["currentHash"]);
    let status = journal.backup_status(&json!({"id": "restore-durability"}))?;
    assert_eq!(status["currentHash"], receipt["currentHash"]);
    Ok(())
}

#[test]
fn a_restored_installation_keeps_authoring_new_revisions() -> Result<()> {
    let source_root = tempfile::tempdir()?;
    let (_source, archive) = build_source(source_root.path())?;
    let root = tempfile::tempdir()?;
    let install = root.path().join("install");
    let mut journal = TaskJournal::open(&install.join("tasks.sqlite"))?;
    let restored = journal.backup_restore_portable(&restore_args(&archive, &install))?;
    assert_eq!(restored["status"], "completed");

    // The restored world loads and its project reads.
    assert_eq!(journal.world_read("a")?.world.snapshot, world().snapshot);
    assert_eq!(project_text(&journal)?, PROJECT);

    // Continue creating in the restored installation: a new project and a new
    // revision on the world that did not carry one before the restore.
    let authoring = WorkspaceContext {
        project_id: "project-a".into(),
        session_id: "session-b".into(),
        turn_id: "one".into(),
    };
    assert_eq!(journal.workspace_open(&authoring, "b")?.world_id, "b");
    let created = journal.godot_project_create(&json!({
        "context": &authoring, "worldId": "b", "toolCallId": "create-b",
        "baseBuild": "base-a", "baseId": "first-person", "files": project_files()
    }))?;
    let patched = journal.godot_project_patch(&json!({
        "context": &authoring, "worldId": "b", "toolCallId": "patch-b",
        "revision": created["revision"], "manifestHash": created["manifestHash"],
        "operations": [{
            "op": "put", "path": "world.gd", "expectedHash": digest(SCRIPT),
            "text": "extends Node3D\nvar damage := 99\n"
        }]
    }))?;
    assert_eq!(patched["revision"], 1);
    let read = journal.godot_project_read(&json!({
        "worldId": "b", "context": &authoring, "revision": patched["revision"],
        "manifestHash": patched["manifestHash"], "path": "world.gd"
    }))?;
    assert_eq!(read["text"], "extends Node3D\nvar damage := 99\n");
    Ok(())
}

#[test]
fn a_committed_restore_is_never_rolled_back_by_another_operation() -> Result<()> {
    // The first restore committed and its process died before the job row was
    // updated, so its staging area is still on disk. A second operation that
    // wants the same target must not undo that committed work.
    let (root, install) = crash_at("after-commit")?;
    let other = root.path().join("other");
    let mut other_journal = TaskJournal::open(&other.join("tasks.sqlite"))?;
    let archive = root.path().join("world.cmarchive");
    let error = other_journal
        .backup_restore_portable(&json!({
            "operationId": "restore-second",
            "archivePath": archive.to_string_lossy(),
            "targetDirectory": install.to_string_lossy(),
        }))
        .unwrap_err()
        .to_string();
    assert!(error.contains("BACKUP_TARGET_NOT_EMPTY"), "{error}");

    // The committed restore's data is intact and still recoverable.
    let mut journal = TaskJournal::open(&install.join("tasks.sqlite"))?;
    assert_eq!(journal.world_list()?.len(), 2);
    assert_eq!(project_text(&journal)?, PROJECT);
    journal.backup_recover()?;
    assert_eq!(job_status(&journal, "restore-durability")?, "completed");
    assert!(restore_leftovers(&install).is_empty());
    Ok(())
}

#[test]
fn a_lookalike_staging_directory_is_refused_and_never_deleted() -> Result<()> {
    let source_root = tempfile::tempdir()?;
    let (_source, archive) = build_source(source_root.path())?;
    let root = tempfile::tempdir()?;
    let target = root.path().join("data");
    fs::create_dir_all(&target)?;
    let lookalikes = [
        ".craftmine-restore-0123456789abcdef01234567",
        ".portable-staging-123-456",
    ];
    for name in lookalikes {
        let foreign = target.join(name);
        fs::create_dir(&foreign)?;
        fs::write(foreign.join("keep.txt"), b"user data")?;
    }
    let mut fresh = TaskJournal::open(&root.path().join("install").join("tasks.sqlite"))?;
    let error = fresh
        .backup_restore_portable(&json!({
            "operationId": "restore-foreign",
            "archivePath": archive.to_string_lossy(),
            "targetDirectory": target.to_string_lossy(),
        }))
        .unwrap_err()
        .to_string();
    assert!(error.contains("BACKUP_TARGET_NOT_EMPTY"), "{error}");
    for name in lookalikes {
        assert!(
            target.join(name).join("keep.txt").is_file(),
            "a directory that is not provably ours must survive: {name}"
        );
    }
    Ok(())
}

#[test]
fn a_cancel_request_converges_and_removes_only_owned_staging() -> Result<()> {
    let source_root = tempfile::tempdir()?;
    let (_source, archive) = build_source(source_root.path())?;
    let root = tempfile::tempdir()?;
    let install = root.path().join("install");
    let mut fresh = TaskJournal::open(&install.join("tasks.sqlite"))?;
    let job = json!({
        "archivePath": archive.to_string_lossy(),
        "targetDirectory": install.to_string_lossy(),
        "inPlace": true,
    });
    fresh.db.execute(
        "INSERT INTO craftmine_backup_jobs(id,kind,status,request_hash,receipt,archive,archive_hash,created_at)
         VALUES('restore-cancel','restore-portable','restoring','hash','{}',?1,'archive-hash',1)",
        rusqlite::params![serde_json::to_string(&job)?],
    )?;
    let staging = install.join(format!(
        "{RESTORE_STAGING_PREFIX}{}",
        &digest("restore-cancel")[..24]
    ));
    fs::create_dir_all(&staging)?;
    fs::write(
        staging.join("owner.json"),
        serde_json::to_vec(&json!({
            "format": "craftmine.restore-ownership/1",
            "operation_id": "restore-cancel",
            "archive_hash": "archive-hash",
            "target": install.to_string_lossy(),
            "in_place": true,
            "process_id": 1,
            "created_at": 1,
        }))?,
    )?;
    fs::write(
        staging.join("journal.jsonl"),
        serde_json::to_vec(&json!({
            "format": "craftmine.restore-ownership/1",
            "operation_id": "restore-cancel",
            "archive_hash": "archive-hash",
            "target": install.to_string_lossy(),
            "in_place": true,
            "process_id": 1,
            "created_at": 1,
        }))?,
    )?;

    let cancelled = fresh.backup_cancel_portable(&json!({"operationId": "restore-cancel"}))?;
    assert_eq!(cancelled["status"], "cancel-requested");
    fresh.backup_recover()?;
    assert_eq!(job_status(&fresh, "restore-cancel")?, "cancelled");
    assert!(!staging.exists());
    assert!(fresh.world_list()?.is_empty());
    Ok(())
}
