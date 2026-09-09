//! VM1/VM3/VM4 store tests against real managed Git repositories.

use std::path::Path;

use super::contract::{AssetLock, AssetLockEntry, AssetRef};
use super::git::{GitAdapter, GitIdentity};
use super::repo::*;
use anyhow::Result;

fn store(root: &Path) -> Result<RepositoryStore> {
    let git = GitAdapter::discover(
        &root.join("git-config"),
        &[],
        GitIdentity::local("Craftmine Tester", "test-stable-id")?,
    )?;
    RepositoryStore::open(&root.join("content"), git)
}

fn text_file(path: &str, text: &str) -> ContentFile {
    ContentFile::text(path, text)
}

fn fixture_lock() -> Result<AssetLock> {
    AssetLock::new(vec![AssetLockEntry {
        asset: AssetRef {
            asset_id: "base-stone".into(),
            version: "1.0.0".into(),
            content_hash: "a".repeat(64),
        },
        install_path: "assets/stone".into(),
        files: vec![],
        dependencies: vec![],
        overrides: vec![],
    }])
}

#[test]
fn commit_branch_history_and_asset_lock_are_authoritative_in_git() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let layout = store.create("repo-world-1", "sha1", None)?;
    assert_eq!(store.branch_head(&layout, MAIN_BRANCH)?, None);

    let first = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[text_file("project.godot", "config_version=5\n")],
        &commit_message("req-1", "task-1", "create world", "")?,
    )?;
    let lock = fixture_lock()?;
    let second = store.commit(
        &layout,
        MAIN_BRANCH,
        Some(&first),
        &[
            text_file("project.godot", "config_version=5\nname=\"town\"\n"),
            ContentFile::asset_lock(&lock)?,
        ],
        &commit_message("req-1", "task-1", "add rifle", "AI patch 1")?,
    )?;
    assert_ne!(first, second);
    assert_eq!(store.branch_head(&layout, MAIN_BRANCH)?, Some(second.clone()));
    assert_eq!(store.branches(&layout)?.len(), 1);

    // History paging is newest first and grouped by request.
    let page = store.history(&layout, MAIN_BRANCH, 0, 1)?;
    assert_eq!(page.total, 2);
    assert_eq!(page.records[0].oid, second);
    assert_eq!(page.records[0].request_id.as_deref(), Some("req-1"));
    assert_eq!(page.records[0].task_id.as_deref(), Some("task-1"));
    assert_eq!(page.next_skip, Some(1));
    let page = store.history(&layout, MAIN_BRANCH, 1, 5)?;
    assert_eq!(page.records[0].oid, first);
    assert_eq!(page.records[0].parents, Vec::<String>::new());
    assert_eq!(page.next_skip, None);
    let full_page = store.history(&layout, MAIN_BRANCH, 0, 10)?;
    let grouped = group_by_request(&full_page.records);
    assert_eq!(grouped.len(), 1);
    assert_eq!(grouped["req-1"].len(), 2);

    // The lock file is the canonical form and identifies playable content.
    let lock_bytes = store.read_file(&layout, &second, super::contract::ASSET_LOCK_FILE)?;
    assert_eq!(lock_bytes, lock.canonical_bytes()?);
    assert_eq!(store.asset_lock(&layout, &second)?, Some(lock.clone()));
    let content = store.content_ref(&layout, &second)?;
    assert_eq!(content.repo_id, "repo-world-1");
    assert_eq!(content.commit_oid, second);
    assert_eq!(content.asset_lock_hash, lock.asset_lock_hash()?);
    // A source-only commit has no lock and is not reported as playable content.
    assert_eq!(store.asset_lock(&layout, &first)?, None);
    assert_eq!(
        store.content_ref(&layout, &first).unwrap_err().to_string(),
        "CONTENT_ASSET_LOCK_MISSING"
    );

    // Checkpoints, drafts, named versions and the applied marker are protected.
    let checkpoint = store.set_checkpoint(&layout, "task-1", 1, &second)?;
    assert_eq!(checkpoint, "refs/craftmine/checkpoint/task-1/0001");
    store.set_checkpoint(&layout, "task-1", 1, &second)?;
    assert_eq!(
        store
            .set_checkpoint(&layout, "task-1", 1, &first)
            .unwrap_err()
            .to_string(),
        "CONTENT_CHECKPOINT_CONFLICT: refs/craftmine/checkpoint/task-1/0001"
    );
    assert_eq!(store.checkpoints(&layout, "task-1")?.len(), 1);
    store.set_draft(&layout, "plan-a", &second, None)?;
    assert_eq!(store.draft(&layout, "plan-a")?, Some(second.clone()));
    store.create_version(&layout, "v-town-1", &second, "town release 1")?;
    assert_eq!(store.versions(&layout)?.len(), 1);
    store.set_applied(&layout, "world-1", &second, None)?;
    assert_eq!(store.applied(&layout, "world-1")?, Some(second.clone()));
    let protected = store.protected_refs(&layout)?;
    assert_eq!(protected.len(), 4);
    Ok(())
}

#[test]
fn concurrent_branch_writes_are_rejected_by_compare_and_swap() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let layout = store.create("repo-world-1", "sha1", None)?;
    let first = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[text_file("a.gd", "one\n")],
        "first\n",
    )?;
    // A second writer that still believes the branch is at its old head loses.
    let stale = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[text_file("a.gd", "stale\n")],
        "stale\n",
    );
    assert!(stale
        .unwrap_err()
        .to_string()
        .starts_with("GIT_REF_CAS_FAILED"));
    assert_eq!(store.branch_head(&layout, MAIN_BRANCH)?, Some(first.clone()));
    let second = store.commit(
        &layout,
        MAIN_BRANCH,
        Some(&first),
        &[text_file("a.gd", "two\n")],
        "second\n",
    )?;
    assert_eq!(store.branch_head(&layout, MAIN_BRANCH)?, Some(second));
    // Two plan branches stay independent.
    store.commit(
        &layout,
        "plan-a",
        None,
        &[text_file("a.gd", "plan a\n")],
        "plan a\n",
    )?;
    store.commit(
        &layout,
        "plan-b",
        None,
        &[text_file("a.gd", "plan b\n")],
        "plan b\n",
    )?;
    let mut names: Vec<String> = store
        .branches(&layout)?
        .into_iter()
        .map(|entry| entry.name)
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec!["refs/heads/main", "refs/heads/plan-a", "refs/heads/plan-b"]
    );
    Ok(())
}

#[test]
fn materialised_copy_has_no_git_metadata_and_reports_unsupported_entries() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let layout = store.create("repo-world-1", "sha1", None)?;
    let commit = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[
            text_file("project.godot", "config_version=5\n"),
            text_file("scenes/城镇/主街.tscn", "[gd_scene]\n"),
            text_file("scripts/深层/目录/文件.gd", "extends Node\n"),
        ],
        "create\n",
    )?;
    let target = dir.path().join("copy");
    let copy = store.materialize(&layout, &commit, &target)?;
    assert_eq!(copy.files, 3);
    assert!(!target.join(".git").exists());
    assert_eq!(
        std::fs::read_to_string(target.join("scenes/城镇/主街.tscn"))?,
        "[gd_scene]\n"
    );
    assert_eq!(copy.object_format, "sha1");
    // Materialising twice is refused rather than merged silently.
    assert_eq!(
        store
            .materialize(&layout, &commit, &target)
            .unwrap_err()
            .to_string(),
        "CONTENT_COPY_EXISTS"
    );

    // A symlink entry must be reported, not silently skipped.
    let link_commit = {
        let blob = store.git().hash_object(&layout.git_dir, b"target")?;
        let tree = store.git().write_tree(
            &layout.git_dir,
            &[
                super::git::TreeEntry {
                    mode: "100644".into(),
                    path: "project.godot".into(),
                    oid: store
                        .git()
                        .hash_object(&layout.git_dir, b"config_version=5\n")?,
                },
                super::git::TreeEntry {
                    mode: "120000".into(),
                    path: "link.gd".into(),
                    oid: blob,
                },
            ],
        )?;
        store
            .git()
            .commit_tree(&layout.git_dir, &tree, &[], "link\n")?
    };
    let error = store
        .materialize(&layout, &link_commit, &dir.path().join("copy-link"))
        .unwrap_err()
        .to_string();
    assert!(
        error.starts_with("CONTENT_COPY_UNSUPPORTED_ENTRY"),
        "unexpected error: {error}"
    );
    Ok(())
}

#[test]
fn authoring_exclusions_traversal_and_case_collisions_are_refused() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let layout = store.create("repo-world-1", "sha1", None)?;
    for (files, code) in [
        (vec![text_file(".godot/cache.bin", "x")], "CONTENT_PATH_EXCLUDED"),
        (vec![text_file("credentials/token.txt", "x")], "CONTENT_PATH_EXCLUDED"),
        (vec![text_file("../escape.gd", "x")], "PATH_TRAVERSAL"),
        (
            vec![text_file("Scenes/A.gd", "x"), text_file("scenes/a.gd", "y")],
            "PATH_COLLISION",
        ),
    ] {
        let error = store
            .commit(&layout, MAIN_BRANCH, None, &files, "bad\n")
            .unwrap_err()
            .to_string();
        assert!(
            error.starts_with(code),
            "expected {code} for {files:?}, got {error}"
        );
    }
    assert_eq!(store.branch_head(&layout, MAIN_BRANCH)?, None);
    Ok(())
}

#[test]
fn changes_and_file_diffs_separate_text_from_binary() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let layout = store.create("repo-world-1", "sha1", None)?;
    let base = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[
            text_file("scripts/player.gd", "var speed = 1\nvar jump = 2\n"),
            ContentFile {
                path: "assets/logo.png".into(),
                bytes: vec![0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02],
            },
        ],
        "base\n",
    )?;
    let changed = store.commit(
        &layout,
        MAIN_BRANCH,
        Some(&base),
        &[
            text_file("scripts/player.gd", "var speed = 5\nvar jump = 2\n"),
            ContentFile {
                path: "assets/logo.png".into(),
                bytes: vec![0x89, 0x50, 0x4e, 0x47, 0x00, 0x09, 0x09],
            },
            text_file("scripts/enemy.gd", "extends Node\n"),
        ],
        "change\n",
    )?;
    let changes = store.changes(&layout, &base, &changed)?;
    let paths: Vec<&str> = changes.iter().map(|entry| entry.path.as_str()).collect();
    assert_eq!(paths, vec!["assets/logo.png", "scripts/enemy.gd", "scripts/player.gd"]);
    assert!(changes.iter().all(|entry| entry.status == "M" || entry.status == "A"));

    match store.file_diff(&layout, &base, &changed, "scripts/player.gd")? {
        FileDiff::Text {
            added,
            removed,
            patch,
            ..
        } => {
            assert_eq!((added, removed), (1, 1));
            assert!(patch.contains("-var speed = 1"));
            assert!(patch.contains("+var speed = 5"));
        }
        other => panic!("expected text diff, got {other:?}"),
    }
    match store.file_diff(&layout, &base, &changed, "assets/logo.png")? {
        FileDiff::Binary {
            old_bytes,
            new_bytes,
            ..
        } => {
            assert_eq!(old_bytes, Some(7));
            assert_eq!(new_bytes, Some(7));
        }
        other => panic!("expected binary diff, got {other:?}"),
    }
    Ok(())
}

#[test]
fn merge_reports_clean_text_and_real_conflicts_without_reusing_parent_checks() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let layout = store.create("repo-world-1", "sha1", None)?;
    let base = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[
            text_file("shared.gd", "one\ntwo\n"),
            text_file("only-a.gd", "a\n"),
            text_file("only-b.gd", "b\n"),
        ],
        "base\n",
    )?;
    let ours = store.commit(
        &layout,
        "plan-a",
        None,
        &[
            text_file("shared.gd", "one\ntwo\n"),
            text_file("only-a.gd", "a changed\n"),
            text_file("only-b.gd", "b\n"),
        ],
        "ours\n",
    )?;
    let theirs = store.commit(
        &layout,
        "plan-b",
        None,
        &[
            text_file("shared.gd", "one\ntwo\n"),
            text_file("only-a.gd", "a\n"),
            text_file("only-b.gd", "b changed\n"),
        ],
        "theirs\n",
    )?;
    let clean = store.merge(&layout, &base, &ours, &theirs)?;
    assert!(!clean.conflicted, "unexpected conflict: {clean:?}");
    assert!(clean.tree.is_some());

    // Same line changed on both sides is a real conflict; no tree is returned.
    let conflicting_a = store.commit(
        &layout,
        "plan-c",
        None,
        &[
            text_file("shared.gd", "ours\n"),
            text_file("only-a.gd", "a\n"),
            text_file("only-b.gd", "b\n"),
        ],
        "ours conflict\n",
    )?;
    let conflicting_b = store.commit(
        &layout,
        "plan-d",
        None,
        &[
            text_file("shared.gd", "theirs\n"),
            text_file("only-a.gd", "a\n"),
            text_file("only-b.gd", "b\n"),
        ],
        "theirs conflict\n",
    )?;
    let conflicted = store.merge(&layout, &base, &conflicting_a, &conflicting_b)?;
    assert!(conflicted.conflicted);
    assert_eq!(conflicted.tree, None);
    assert!(
        conflicted.conflicts.iter().any(|path| path == "shared.gd"),
        "conflicts: {:?}",
        conflicted.conflicts
    );
    Ok(())
}

#[test]
fn bundle_reclaim_and_prune_only_touch_unreachable_objects() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let layout = store.create("repo-world-1", "sha1", None)?;
    let keep = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[text_file("keep.gd", "keep\n")],
        "keep\n",
    )?;
    store.create_version(&layout, "v1", &keep, "release")?;
    let bundle = dir.path().join("world.bundle");
    store.bundle(
        &layout,
        &bundle,
        &["refs/heads/main".to_string(), "refs/craftmine/version/v1".to_string()],
    )?;
    assert!(bundle.is_file());

    // An abandoned experiment is unreachable once its reference is deleted.
    let abandoned = store.commit(
        &layout,
        "plan-gone",
        None,
        &[text_file("junk.gd", "junk\n")],
        "junk\n",
    )?;
    let plan = store.reclaim_plan(&layout, &["refs/heads/main".to_string()])?;
    assert_eq!(plan.garbage_objects, 0, "plan-gone is still referenced");
    assert!(
        plan.referenced_elsewhere > 0,
        "objects of a non-keep branch are still referenced"
    );
    store
        .git()
        .delete_ref(&layout.git_dir, "refs/heads/plan-gone", &abandoned)?;
    let plan = store.reclaim_plan(&layout, &["refs/heads/main".to_string()])?;
    assert!(plan.garbage_objects > 0);
    assert!(plan.garbage_bytes > 0);
    assert!(plan.reachable_objects > 0);
    assert!(!plan.sample.is_empty());

    // Reclaim never deletes a protected version.
    let protected_plan = store.reclaim_plan(
        &layout,
        &[
            "refs/heads/main".to_string(),
            "refs/craftmine/version/v1".to_string(),
        ],
    )?;
    assert_eq!(protected_plan.garbage_objects, plan.garbage_objects);
    let pruned = store.prune(
        &layout,
        &[
            "refs/heads/main".to_string(),
            "refs/craftmine/version/v1".to_string(),
        ],
    )?;
    assert!(pruned.garbage_objects > 0);
    let after = store.reclaim_plan(&layout, &["refs/heads/main".to_string()])?;
    assert_eq!(after.garbage_objects, 0);
    // The kept history still verifies.
    assert!(store.verify(&layout, &["refs/heads/main".to_string()])?.is_empty());
    Ok(())
}

#[test]
fn sha256_repositories_record_their_object_format_end_to_end() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let layout = store.create("repo-world-sha256", "sha256", Some("world-legacy"))?;
    let metadata = store.read_metadata(&layout)?;
    assert_eq!(metadata.object_format, "sha256");
    assert_eq!(metadata.legacy_world.as_deref(), Some("world-legacy"));
    let commit = store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[text_file("project.godot", "config_version=5\n")],
        "create\n",
    )?;
    assert_eq!(commit.len(), 64);
    let lock = fixture_lock()?;
    let with_lock = store.commit(
        &layout,
        MAIN_BRANCH,
        Some(&commit),
        &[
            text_file("project.godot", "config_version=5\n"),
            ContentFile::asset_lock(&lock)?,
        ],
        "lock\n",
    )?;
    assert_eq!(
        store.content_ref(&layout, &with_lock)?.asset_lock_hash,
        lock.asset_lock_hash()?
    );
    let copy = store.materialize(&layout, &with_lock, &dir.path().join("copy"))?;
    assert_eq!(copy.object_format, "sha256");
    assert_eq!(copy.files, 2);
    Ok(())
}

#[test]
fn repository_identity_never_becomes_a_filesystem_component() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let upper = store.layout("Repo-World")?;
    let lower = store.layout("repo-world")?;
    assert_ne!(upper.git_dir, lower.git_dir);
    assert!(!upper.git_dir.to_string_lossy().contains("Repo-World"));
    assert_eq!(RepositoryStore::repo_key("repo-world")?.len(), 32);
    assert_eq!(
        RepositoryStore::repo_key("../escape").unwrap_err().to_string(),
        "INVALID_REPO_ID"
    );
    Ok(())
}

#[test]
fn bulk_commit_hashes_all_files_in_one_git_invocation() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = store(dir.path())?;
    let layout = store.create("repo-world-1", "sha1", None)?;
    let files: Vec<ContentFile> = (0..200)
        .map(|index| {
            text_file(
                &format!("scripts/module_{index:04}.gd"),
                &format!("extends Node\n# {index}\n"),
            )
        })
        .collect();
    let started = std::time::Instant::now();
    let commit = store.commit(&layout, MAIN_BRANCH, None, &files, "bulk\n")?;
    let elapsed = started.elapsed();
    assert_eq!(store.tree_entries(&layout, &commit)?.len(), 200);
    assert!(
        elapsed < std::time::Duration::from_secs(30),
        "bulk commit took {elapsed:?}"
    );
    // Staging files never leak into the repository or the copies directory.
    let copies = std::fs::read_dir(&layout.copies_dir)?
        .filter_map(|entry| entry.ok())
        .count();
    assert_eq!(copies, 0);
    Ok(())
}
