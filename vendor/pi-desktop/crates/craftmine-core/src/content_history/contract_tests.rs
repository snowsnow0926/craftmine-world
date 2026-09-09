//! Frozen contract tests and shared test vectors (VM0/AL0).
//!
//! The golden values below are the agreement between the content-history and
//! asset-catalog modules. Changing them is a contract change, not a bug fix.

use super::contract::*;
use anyhow::Result;

fn asset(id: &str, version: &str, seed: &str) -> AssetRef {
    AssetRef {
        asset_id: id.to_string(),
        version: version.to_string(),
        content_hash: sha256(seed),
    }
}

fn sha256(text: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn file(path: &str, seed: &str, bytes: u64, media: &str) -> FileRef {
    FileRef {
        path: path.to_string(),
        sha256: sha256(seed),
        bytes,
        media_type: media.to_string(),
    }
}

/// Canonical fixture shared with the asset catalog.
fn fixture() -> AssetLock {
    let stone = AssetLockEntry {
        asset: asset("base-stone", "1.0.0", "stone-content"),
        install_path: "assets/base/stone".to_string(),
        files: vec![
            file("textures/granite.png", "granite-bytes", 2048, "image/png"),
            file("model/block.glb", "block-bytes", 8192, "model/gltf-binary"),
        ],
        dependencies: vec![asset("palette-core", "2.1.0", "palette-content")],
        overrides: vec![AssetOverrideRef {
            scope: "world:town".to_string(),
            path: "textures/granite.png".to_string(),
            content_hash: sha256("town-granite"),
        }],
    };
    let palette = AssetLockEntry {
        asset: asset("palette-core", "2.1.0", "palette-content"),
        install_path: "assets/core/palette".to_string(),
        files: vec![file("palette.json", "palette-json", 512, "application/json")],
        dependencies: vec![],
        overrides: vec![],
    };
    // Deliberately out of order; canonicalization must sort it.
    AssetLock::new(vec![stone, palette]).expect("fixture is valid")
}

#[test]
fn canonical_fixture_matches_the_frozen_vector() -> Result<()> {
    let lock = fixture();
    let text = lock.canonical_text()?;
    assert_eq!(lock.asset_lock_hash()?, GOLDEN_LOCK_HASH);
    assert_eq!(sha256(&text), GOLDEN_LOCK_HASH);
    assert!(text.ends_with("}\n"));
    assert!(text.contains("\n  \"assets\": ["));
    assert_eq!(lock, AssetLock::parse_canonical(text.as_bytes())?);
    // Round-tripping through parse must not move the hash.
    let reparsed = AssetLock::parse(text.as_bytes())?;
    assert_eq!(reparsed.canonical_text()?, text);
    Ok(())
}

#[test]
fn canonical_fixture_has_the_frozen_first_bytes() -> Result<()> {
    let text = fixture().canonical_text()?;
    assert!(
        text.starts_with("{\n  \"format\": \"craftmine.assets-lock/1\",\n  \"assets\": [\n    {\n      \"asset\": {\n        \"assetId\": \"base-stone\",\n        \"version\": \"1.0.0\",\n        \"contentHash\": \""),
        "canonical head drifted:\n{}",
        &text[..text.len().min(400)]
    );
    Ok(())
}

#[test]
fn empty_lock_has_a_stable_hash() -> Result<()> {
    let lock = AssetLock::empty();
    assert_eq!(lock.canonical_text()?, EMPTY_LOCK_TEXT);
    assert_eq!(lock.asset_lock_hash()?, EMPTY_LOCK_HASH);
    Ok(())
}

#[test]
fn git_oids_are_not_assumed_to_be_forty_characters() -> Result<()> {
    // SHA-256 repositories produce 64-character object IDs.
    validate_oid(&"a".repeat(64))?;
    // Abbreviated object IDs are still valid references.
    validate_oid("0f1e2d")?;
    for bad in ["", "abc", &"a".repeat(65), "ABCDEF", "abcxyz"] {
        assert_eq!(
            validate_oid(bad).unwrap_err().to_string(),
            "INVALID_GIT_OID"
        );
    }
    // A 40-character Git OID is not a SHA-256 content hash and vice versa.
    assert_eq!(
        validate_sha256(&"a".repeat(40)).unwrap_err().to_string(),
        "INVALID_SHA256"
    );
    validate_sha256(&"a".repeat(64))?;
    Ok(())
}

#[test]
fn asset_lock_rejects_mutable_versions() {
    let mut entry = AssetLockEntry {
        asset: asset("base-stone", "latest", "x"),
        install_path: "assets/stone".to_string(),
        files: vec![],
        dependencies: vec![],
        overrides: vec![],
    };
    assert_eq!(
        entry.validate().unwrap_err().to_string(),
        "ASSET_LOCK_MUTABLE_VERSION"
    );
    entry.asset.version = "1.0.0".to_string();
    entry.validate().unwrap();
}

#[test]
fn asset_lock_rejects_conflicting_duplicate_versions() -> Result<()> {
    let first = AssetLockEntry {
        asset: asset("base-stone", "1.0.0", "content-a"),
        install_path: "assets/stone".to_string(),
        files: vec![],
        dependencies: vec![],
        overrides: vec![],
    };
    let mut second = first.clone();
    second.asset.content_hash = sha256("content-b");
    let error = AssetLock::new(vec![first.clone(), second])
        .unwrap_err()
        .to_string();
    assert!(
        error.starts_with("ASSET_LOCK_VERSION_CONFLICT"),
        "unexpected error: {error}"
    );
    // An exact duplicate is not a conflict; it is collapsed.
    let lock = AssetLock::new(vec![first.clone(), first])?;
    assert_eq!(lock.assets.len(), 1);
    Ok(())
}

#[test]
fn asset_lock_rejects_unresolved_and_cyclic_dependencies() {
    let orphan = AssetLockEntry {
        asset: asset("base-stone", "1.0.0", "stone"),
        install_path: "assets/stone".to_string(),
        files: vec![],
        dependencies: vec![asset("missing", "1.0.0", "missing")],
        overrides: vec![],
    };
    assert!(AssetLock::new(vec![orphan])
        .unwrap_err()
        .to_string()
        .starts_with("ASSET_LOCK_DEPENDENCY_UNRESOLVED"));

    let mut first = AssetLockEntry {
        asset: asset("a", "1", "a"),
        install_path: "assets/a".to_string(),
        files: vec![],
        dependencies: vec![asset("b", "1", "b")],
        overrides: vec![],
    };
    let mut second = AssetLockEntry {
        asset: asset("b", "1", "b"),
        install_path: "assets/b".to_string(),
        files: vec![],
        dependencies: vec![asset("a", "1", "a")],
        overrides: vec![],
    };
    first.files.clear();
    second.files.clear();
    let error = AssetLock::new(vec![first, second])
        .unwrap_err()
        .to_string();
    assert!(
        error.starts_with("ASSET_LOCK_DEPENDENCY_CYCLE"),
        "unexpected error: {error}"
    );
}

#[test]
fn paths_reject_traversal_absolute_links_and_device_names() -> Result<()> {
    validate_relative_path("scenes/城镇/主街.tscn").unwrap();
    validate_relative_path("assets/a/b/c.png").unwrap();
    for (path, code) in [
        ("../escape.gd", "PATH_TRAVERSAL"),
        ("a/../../b.gd", "PATH_TRAVERSAL"),
        ("a/.git/config", "PATH_TRAVERSAL"),
        ("/abs/path.gd", "PATH_NOT_RELATIVE"),
        ("C:/windows.gd", "PATH_NOT_RELATIVE"),
        ("a\\b.gd", "PATH_NOT_RELATIVE"),
        ("", "INVALID_RELATIVE_PATH"),
        ("con.gd", "PATH_RESERVED_NAME"),
        ("dir/COM1.txt", "PATH_RESERVED_NAME"),
        ("trailing /", "INVALID_RELATIVE_PATH"),
        ("dot./file.gd", "INVALID_RELATIVE_PATH"),
    ] {
        assert_eq!(
            validate_relative_path(path).unwrap_err().to_string(),
            code,
            "path {path:?}"
        );
    }
    assert_eq!(
        detect_path_collisions(["Assets/A.png", "assets/a.png"])
            .unwrap_err()
            .to_string(),
        "PATH_COLLISION"
    );
    detect_path_collisions(["Assets/A.png", "assets/b.png"]).unwrap();
    Ok(())
}

#[test]
fn lock_parse_requires_canonical_bytes_for_commits() -> Result<()> {
    let lock = fixture();
    let canonical = lock.canonical_text()?;
    // Re-indented JSON parses but is not accepted as a committed lock file.
    let reordered = canonical.replace("    ", "      ");
    assert!(AssetLock::parse(reordered.as_bytes()).is_ok());
    assert_eq!(
        AssetLock::parse_canonical(reordered.as_bytes())
            .unwrap_err()
            .to_string(),
        "ASSET_LOCK_NOT_CANONICAL"
    );
    assert_eq!(
        AssetLock::parse(b"not json").unwrap_err().to_string(),
        "INVALID_ASSET_LOCK"
    );
    Ok(())
}

#[test]
fn references_keep_source_progress_and_operation_identity_apart() -> Result<()> {
    let content = ContentRef {
        repo_id: "repo-world-1".to_string(),
        commit_oid: "b".repeat(64),
        asset_lock_hash: fixture().asset_lock_hash()?,
    };
    content.validate()?;
    let build = BuildRef {
        content: content.clone(),
        base_id: "first-person".to_string(),
        base_version: "1".to_string(),
        engine_version: "4.7.2-stable".to_string(),
        target: "web".to_string(),
        build_id: "build-1".to_string(),
    };
    build.validate()?;
    let progress = ProgressRef {
        world_id: "world-1".to_string(),
        progress_id: "progress-1".to_string(),
        revision: 7,
        build: build.clone(),
        state_schema_version: 3,
        content_hash: sha256("state"),
    };
    progress.validate()?;

    let context = OperationContext {
        operation_id: "op-1".to_string(),
        world_id: "world-1".to_string(),
        repo_id: "repo-world-1".to_string(),
        branch_id: "main".to_string(),
        expected_head_oid: Some("c".repeat(64)),
        expected_applied_oid: None,
        expected_progress_revision: Some(7),
    };
    context.validate()?;
    // The expected fields must be present in the protocol even when null.
    let json = serde_json::to_value(&context)?;
    assert!(json.get("expectedAppliedOid").is_some_and(|value| value.is_null()));
    assert!(json.get("expectedHeadOid").is_some());
    assert_eq!(
        serde_json::from_value::<OperationContext>(serde_json::json!({
            "operationId": "op-1",
            "worldId": "world-1",
            "repoId": "repo-world-1",
            "branchId": "main"
        }))
        .unwrap_err()
        .to_string()
        .contains("missing field"),
        true
    );
    Ok(())
}

/// Golden canonical lock hash. Regenerate only with an explicit contract
/// change reviewed by both owners.
const GOLDEN_LOCK_HASH: &str =
    "b95794a2afd498e782e6ec64ec84f1a595d9b56ac723ee4c997a15bbcaad9f0b";
const EMPTY_LOCK_TEXT: &str = "{\n  \"format\": \"craftmine.assets-lock/1\",\n  \"assets\": []\n}\n";
const EMPTY_LOCK_HASH: &str =
    "70396c0e7b3582530fb2765684ae9a8bbc6579c93066539e5ed83ce0db5a4809";

#[test]
#[ignore = "prints the frozen vectors; run with --ignored --nocapture"]
fn print_frozen_vectors() -> Result<()> {
    println!("LOCK_HASH={}", fixture().asset_lock_hash()?);
    println!("LOCK_TEXT_START");
    print!("{}", fixture().canonical_text()?);
    println!("LOCK_TEXT_END");
    println!("EMPTY_HASH={}", AssetLock::empty().asset_lock_hash()?);
    println!("EMPTY_TEXT={:?}", AssetLock::empty().canonical_text()?);
    Ok(())
}
