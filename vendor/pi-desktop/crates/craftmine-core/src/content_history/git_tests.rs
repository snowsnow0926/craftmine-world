//! VM0 adapter tests. These run the real Git binary found on PATH and record
//! the version and SHA-256 actually used; they never claim a bundled binary.

use std::path::PathBuf;

use super::git::*;
use anyhow::Result;

fn identity() -> GitIdentity {
    GitIdentity::local("Craftmine Tester", "test-stable-id").expect("valid identity")
}

fn adapter(dir: &std::path::Path) -> Result<GitAdapter> {
    GitAdapter::discover(&dir.join("git-config"), &[], identity())
}

#[test]
fn discovery_records_provenance_instead_of_assuming_a_bundled_git() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let adapter = adapter(dir.path())?;
    let info = adapter.info();
    assert_eq!(info.source, GitSource::PathFallback);
    assert_eq!(info.sha256.len(), 64);
    assert!(info.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
    assert!((info.version_major, info.version_minor) >= MINIMUM_GIT);
    assert!(info.path.to_lowercase().contains("git"));
    // The same binary passed as a bundled candidate is recorded as bundled.
    let bundled = GitAdapter::discover(
        &dir.path().join("git-config-2"),
        &[PathBuf::from(&info.path)],
        identity(),
    )?;
    assert_eq!(bundled.info().source, GitSource::Bundled);
    assert_eq!(bundled.info().sha256, info.sha256);
    Ok(())
}

#[test]
fn user_and_system_git_configuration_is_never_read() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let adapter = adapter(dir.path())?;
    // The host has a global user.name; the managed environment must not see it.
    let host = std::process::Command::new(&adapter.info().path)
        .args(["config", "--global", "--get", "user.name"])
        .output()?;
    assert!(
        host.status.success() && !host.stdout.is_empty(),
        "test host has no global user.name; isolation cannot be proven"
    );
    let managed = adapter.raw(&["config", "--global", "--get", "user.name"])?;
    assert!(!managed.ok());
    assert!(managed.stdout.is_empty());
    // Every configuration origin is the managed file or a command-line
    // override: neither the user nor the system configuration is consulted.
    let listed = adapter.raw(&["config", "--list", "--show-origin"])?;
    assert!(listed.ok());
    let managed_path = adapter
        .config_dir()
        .join("gitconfig")
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();
    for line in listed.stdout_text()?.lines() {
        let origin = line.split('\t').next().unwrap_or_default().to_lowercase();
        if let Some(path) = origin.strip_prefix("file:") {
            assert_eq!(
                path.replace('\\', "/"),
                managed_path,
                "unexpected configuration origin: {line}"
            );
        }
    }
    Ok(())
}

#[test]
fn managed_configuration_isolates_hooks_and_identity() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let adapter = adapter(dir.path())?;
    let repo = dir.path().join("repo.git");
    adapter.init_bare(&repo, "sha1")?;
    let hooks = adapter.repo(&repo, &["config", "--get", "core.hooksPath"])?;
    assert!(hooks.ok());
    assert_eq!(
        hooks.trimmed()?,
        adapter
            .config_dir()
            .join("empty-hooks")
            .to_string_lossy()
            .into_owned()
    );
    // Commits do not need a player email: identity comes from the host.
    let blob = adapter.hash_object(&repo, b"scene")?;
    let tree = adapter.write_tree(
        &repo,
        &[TreeEntry {
            mode: "100644".into(),
            path: "project.godot".into(),
            oid: blob,
        }],
    )?;
    let commit = adapter.commit_tree(&repo, &tree, &[], "first\n")?;
    let record = &adapter.log_page(&repo, &commit, 0, 1)?[0];
    assert_eq!(record.author_email, "test-stable-id@craftmine.local");
    assert_eq!(record.author_name, "Craftmine Tester");
    Ok(())
}

#[test]
fn dangerous_subcommands_are_refused_before_spawning() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let adapter = adapter(dir.path())?;
    for args in [
        vec!["clone", "https://example.invalid/x.git"],
        vec!["fetch", "origin"],
        vec!["push", "origin", "main"],
        vec!["submodule", "update", "--init"],
        vec!["filter-branch", "--all"],
        vec!["daemon", "--reuseaddr"],
    ] {
        let error = adapter.raw(&args).unwrap_err().to_string();
        assert!(
            error.starts_with("GIT_SUBCOMMAND_REFUSED"),
            "unexpected error for {args:?}: {error}"
        );
    }
    Ok(())
}

#[test]
fn hostile_repository_configuration_is_rejected() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let adapter = adapter(dir.path())?;
    let repo = dir.path().join("repo.git");
    adapter.init_bare(&repo, "sha1")?;
    let config = repo.join("config");
    for (key, value) in [
        ("core.hooksPath", "C:/evil/hooks"),
        ("filter.evil.clean", "calc.exe"),
        ("filter.evil.smudge", "calc.exe"),
        ("core.fsmonitor", "C:/evil/monitor.exe"),
        ("diff.external", "C:/evil/diff.exe"),
        ("credential.helper", "C:/evil/cred.exe"),
        ("include.path", "C:/evil/extra"),
        ("alias.st", "!C:/evil/st.exe"),
    ] {
        let mut text = std::fs::read_to_string(&config)?;
        text.push_str(&format!("[{key}]\n\tvalue = {value}\n"));
        std::fs::write(&config, text)?;
        let error = adapter.assert_managed_config(&repo).unwrap_err().to_string();
        assert!(
            error.starts_with("GIT_CONFIG_FORBIDDEN"),
            "unexpected error for {key}: {error}"
        );
        let mut text = std::fs::read_to_string(&config)?;
        let marker = format!("[{key}]\n\tvalue = {value}\n");
        text = text.replace(&marker, "");
        std::fs::write(&config, text)?;
    }
    adapter.assert_managed_config(&repo)?;
    Ok(())
}

#[test]
fn reference_names_are_validated() -> Result<()> {
    validate_ref_name("refs/heads/main")?;
    validate_ref_name("refs/craftmine/checkpoint/task-1/0001")?;
    validate_ref_name("HEAD")?;
    for bad in [
        "",
        "main",
        "refs/heads/",
        "refs/heads/..",
        "refs/heads/a b",
        "refs/heads/a..b",
        "refs/heads/a.lock",
        "refs/heads/a~1",
        "refs/heads/a^",
        "refs/heads/a:b",
        "refs/heads/a?",
        "refs/heads/a*",
        "refs/heads/a[",
        "refs/heads/a\\b",
        "refs/heads//x",
    ] {
        assert_eq!(
            validate_ref_name(bad).unwrap_err().to_string(),
            "GIT_REF_NAME_INVALID",
            "reference {bad:?}"
        );
    }
    Ok(())
}

#[test]
fn identity_is_derived_and_validated() -> Result<()> {
    let identity = GitIdentity::local("玩家一号", "stable-9")?;
    assert_eq!(identity.email, "stable-9@craftmine.local");
    assert_eq!(identity.name, "玩家一号");
    for (name, stable) in [("", "x"), ("bad<name>", "x"), ("ok", "")] {
        assert_eq!(
            GitIdentity::local(name, stable).unwrap_err().to_string(),
            "INVALID_GIT_IDENTITY"
        );
    }
    Ok(())
}

#[test]
fn object_ids_are_not_assumed_to_be_forty_characters() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let adapter = adapter(dir.path())?;
    for format in ["sha1", "sha256"] {
        let repo = dir.path().join(format!("repo-{format}.git"));
        let recorded = adapter.init_bare(&repo, format)?;
        assert_eq!(recorded, format);
        let blob = adapter.hash_object(&repo, b"content")?;
        let expected = if format == "sha256" { 64 } else { 40 };
        assert_eq!(blob.len(), expected);
        assert_eq!(adapter.object_type(&repo, &blob)?, "blob");
        assert_eq!(adapter.cat_object(&repo, &blob)?, b"content");
    }
    Ok(())
}

#[test]
fn compare_and_swap_rejects_a_stale_reference_value() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let adapter = adapter(dir.path())?;
    let repo = dir.path().join("repo.git");
    adapter.init_bare(&repo, "sha1")?;
    let blob = adapter.hash_object(&repo, b"a")?;
    let tree = adapter.write_tree(
        &repo,
        &[TreeEntry {
            mode: "100644".into(),
            path: "a.gd".into(),
            oid: blob,
        }],
    )?;
    let first = adapter.commit_tree(&repo, &tree, &[], "first\n")?;
    let second = adapter.commit_tree(&repo, &tree, &[first.clone()], "second\n")?;
    adapter.update_ref(&repo, "refs/heads/main", &first, None)?;
    // create on an existing reference fails
    assert!(adapter
        .update_ref(&repo, "refs/heads/main", &second, None)
        .unwrap_err()
        .to_string()
        .contains("GIT_REF_CAS_FAILED"));
    // update with the wrong old value fails
    assert!(adapter
        .update_ref(&repo, "refs/heads/main", &second, Some(&second))
        .unwrap_err()
        .to_string()
        .contains("GIT_REF_CAS_FAILED"));
    assert_eq!(adapter.ref_value(&repo, "refs/heads/main")?, Some(first.clone()));
    // update with the exact old value succeeds
    adapter.update_ref(&repo, "refs/heads/main", &second, Some(&first))?;
    assert_eq!(adapter.ref_value(&repo, "refs/heads/main")?, Some(second.clone()));
    // batch create/update in one transaction
    let third = adapter.commit_tree(&repo, &tree, &[], "third\n")?;
    adapter.update_refs(
        &repo,
        &[
            ("refs/heads/plan-a", &third, None),
            ("refs/heads/main", &third, Some(&second)),
        ],
    )?;
    assert_eq!(adapter.ref_value(&repo, "refs/heads/plan-a")?, Some(third));
    Ok(())
}

#[test]
fn timeouts_are_enforced_and_kill_the_child() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let adapter = adapter(dir.path())?;
    let repo = dir.path().join("repo.git");
    adapter.init_bare(&repo, "sha1")?;
    let blob = adapter.hash_object(&repo, &vec![0u8; 1024 * 1024])?;
    adapter.cat_object(&repo, &blob)?;
    let impatient = GitAdapter::discover(&dir.path().join("git-config"), &[], identity())?
        .with_timeout(std::time::Duration::from_nanos(1));
    let error = impatient.cat_object(&repo, &blob).unwrap_err().to_string();
    assert!(error.starts_with("GIT_TIMEOUT"), "unexpected error: {error}");
    // The managed repository is still usable after a killed command.
    adapter.cat_object(&repo, &blob)?;
    Ok(())
}
