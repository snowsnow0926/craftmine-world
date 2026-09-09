//! The frozen shared contract vectors, executed by every consumer.
//!
//! `tests/godot-remaining/M/contract/asset-lock-vectors.json` is the single
//! source of truth for names and expected errors. A vector with no runner here
//! fails the test, so the file and the implementation cannot drift apart
//! silently, and R4/R6 run this same file against the same contract module.
use anyhow::{ensure, Result};
use serde_json::Value;

use super::contract::{
    detect_path_collisions, validate_oid, validate_relative_path, validate_sha256, AssetLock,
    AssetLockEntry, AssetOverrideRef, AssetRef, FileRef,
};

const VECTORS: &str =
    include_str!("../../../../../../tests/godot-remaining/M/contract/asset-lock-vectors.json");

fn asset(id: &str, version: &str, hash: char) -> AssetRef {
    AssetRef {
        asset_id: id.into(),
        version: version.into(),
        content_hash: hash.to_string().repeat(64),
    }
}

fn entry(id: &str, version: &str, hash: char, install: &str) -> AssetLockEntry {
    AssetLockEntry {
        asset: asset(id, version, hash),
        install_path: install.into(),
        files: vec![FileRef {
            path: install.into(),
            sha256: hash.to_string().repeat(64),
            bytes: 1,
            media_type: "application/octet-stream".into(),
        }],
        dependencies: Vec::new(),
        overrides: Vec::<AssetOverrideRef>::new(),
    }
}

/// Execute one named vector. Unknown names are a failure, never a skip.
fn run(name: &str, input: &str) -> Result<()> {
    match name {
        "forty-character-git-oid-is-not-a-sha256-hash" => validate_sha256(input),
        "sha256-shaped-uppercase-hex-rejected-as-git-oid"
        | "git-oid-longer-than-64-characters"
        | "uppercase-git-oid"
        | "non-hexadecimal-git-oid" => validate_oid(input),
        "mutable-version-latest" => asset("base-stone", "latest", 'a').validate(),
        "mutable-version-head" => asset("base-stone", "head", 'a').validate(),
        "conflicting-duplicate-asset-version" => {
            AssetLock::new(vec![
                entry("base-stone", "1.0.0", 'a', "assets/stone.png"),
                entry("base-stone", "1.0.0", 'b', "assets/stone.png"),
            ])
            .map(|_| ())
        }
        "unresolved-dependency" => {
            let mut with_dependency = entry("base-stone", "1.0.0", 'a', "assets/stone.png");
            with_dependency
                .dependencies
                .push(asset("missing", "1.0.0", 'c'));
            AssetLock::new(vec![with_dependency]).map(|_| ())
        }
        "dependency-cycle" => {
            let mut first = entry("a", "1", 'a', "assets/a.png");
            first.dependencies.push(asset("b", "1", 'b'));
            let mut second = entry("b", "1", 'b', "assets/b.png");
            second.dependencies.push(asset("a", "1", 'a'));
            AssetLock::new(vec![first, second]).map(|_| ())
        }
        "path-traversal" | "nested-path-traversal" | "dot-git-component"
        | "absolute-path" | "drive-letter-path" | "backslash-path"
        | "windows-device-name" | "windows-device-name-in-subdirectory"
        | "empty-path" | "trailing-separator" | "segment-ending-in-dot" => {
            validate_relative_path(input)
        }
        "case-collision-across-paths" => {
            detect_path_collisions(["Assets/A.png", "assets/a.png"])
        }
        "non-canonical-lock-bytes" => {
            let fixture = VECTORS_JSON()?;
            let text = fixture["vectors"]
                .as_array()
                .and_then(|vectors| {
                    vectors
                        .iter()
                        .find(|vector| vector["name"] == "fixture-lock")
                        .and_then(|vector| vector["lockText"].as_str())
                })
                .expect("fixture lock vector");
            let mut reindented = String::new();
            for line in text.lines() {
                reindented.push_str("      ");
                reindented.push_str(line.trim_start());
                reindented.push('\n');
            }
            AssetLock::parse_canonical(reindented.as_bytes()).map(|_| ())
        }
        "invalid-lock-json"
        | "legacy-direct-closure-lock-shape"
        | "legacy-direct-object-lock-shape"
        | "numeric-asset-version-in-lock" => AssetLock::parse(input.as_bytes()).map(|_| ()),
        "lock-format-mismatch" => {
            let mut lock = AssetLock::empty();
            lock.format = "craftmine.assets-lock/2".into();
            lock.canonicalize()
        }
        other => anyhow::bail!("CONTRACT_VECTOR_WITHOUT_RUNNER: {other}"),
    }
}

fn VECTORS_JSON() -> Result<Value> {
    Ok(serde_json::from_str(VECTORS)?)
}

#[test]
fn every_error_vector_fails_with_its_frozen_code() -> Result<()> {
    let document = VECTORS_JSON()?;
    ensure!(
        document["format"] == "craftmine.contract-vectors/1",
        "CONTRACT_VECTORS_FORMAT"
    );
    let vectors = document["errorVectors"]
        .as_array()
        .expect("error vectors");
    assert!(!vectors.is_empty());
    for vector in vectors {
        let name = vector["name"].as_str().expect("vector name");
        let expected = vector["expectedError"].as_str().expect("expected error");
        let input = vector["input"].as_str().unwrap_or_default();
        let error = run(name, input)
            .expect_err(&format!("{name} unexpectedly succeeded"))
            .to_string();
        assert!(
            error.contains(expected),
            "{name}: expected {expected}, got {error}"
        );
    }
    Ok(())
}

#[test]
fn every_positive_vector_reproduces_its_frozen_hash() -> Result<()> {
    let document = VECTORS_JSON()?;
    for vector in document["vectors"].as_array().expect("vectors") {
        let name = vector["name"].as_str().expect("vector name");
        let lock_text = vector["lockText"].as_str().expect("lock text");
        let expected_hash = vector["assetLockHash"].as_str().expect("asset lock hash");
        let lock = AssetLock::parse_canonical(lock_text.as_bytes())
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(lock.asset_lock_hash()?, expected_hash, "{name}");
        assert_eq!(
            lock.canonical_text()?,
            lock_text,
            "{name}: canonical text drifted"
        );
        assert_eq!(
            crate::digest(lock_text),
            vector["sha256OfLockText"].as_str().expect("sha256"),
            "{name}"
        );
        assert_eq!(lock_text.len(), vector["lockBytes"].as_u64().unwrap_or(0) as usize);
    }
    Ok(())
}
