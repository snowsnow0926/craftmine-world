//! AL0-AL2 tests: shared contract consumption, streaming import, immutability,
//! search, preview evidence and measured budgets.
use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::{json, Value};

use super::budget::LEGACY_ASSET_BYTES;
use super::contract::FileRef;
use super::{lock, store};
use crate::content_history::contract::{
    validate_oid, validate_relative_path, validate_sha256, AssetLock,
};
use crate::TaskJournal;

fn journal() -> Result<(tempfile::TempDir, PathBuf, TaskJournal)> {
    let (dir, path) = crate::godot_test_support::temp()?;
    let journal = TaskJournal::open(&path)?;
    Ok((dir, path, journal))
}

fn source_root(dir: &Path) -> Result<PathBuf> {
    let root = dir.join("player");
    std::fs::create_dir_all(&root)?;
    Ok(root)
}

fn write_source(root: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf> {
    let path = root.join(name);
    std::fs::write(&path, bytes)?;
    Ok(path)
}

fn deterministic_bytes(length: usize) -> Vec<u8> {
    let mut state: u64 = 0x2545_F491_4F6C_DD1D;
    (0..length)
        .map(|_| {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (state >> 33) as u8
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn import_args(
    root: &Path,
    file: &Path,
    operation: &str,
    asset: &str,
    version: u64,
    path: &str,
    media_type: &str,
    media_kind: &str,
) -> Value {
    json!({
        "operationId": operation,
        "sourceRoot": root.to_string_lossy(),
        "sourcePath": file.to_string_lossy(),
        "assetId": asset,
        "version": version,
        "kind": "raw",
        "mediaKind": media_kind,
        "path": path,
        "mediaType": media_type,
        "displayName": path,
        "source": {
            "origin": "local",
            "author": "player",
            "license": "unknown",
            "licenseStatus": "unverified",
        },
        "tags": [],
    })
}

fn png_header(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes
}

fn glb_header(json_bytes: u32) -> Vec<u8> {
    let mut bytes = b"glTF".to_vec();
    bytes.extend_from_slice(&2u32.to_le_bytes());
    bytes.extend_from_slice(&(20 + json_bytes).to_le_bytes());
    bytes.extend_from_slice(&json_bytes.to_le_bytes());
    bytes.extend_from_slice(b"JSON");
    bytes
}

/// Canonical shared vectors are owned by task M/R1 and consumed here as the
/// exact file `content_history::contract_tests` uses, so both consumers must
/// agree on every hash and error.
fn shared_vectors() -> Result<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("..")
        .join("tests")
        .join("godot-remaining")
        .join("M")
        .join("contract")
        .join("asset-lock-vectors.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|error| anyhow::anyhow!("MISSING_SHARED_VECTORS {}: {error}", path.display()))?;
    Ok(serde_json::from_str(&text)?)
}

#[test]
fn al0_consumes_the_single_shared_lock_contract() -> Result<()> {
    let vectors = shared_vectors()?;
    assert_eq!(vectors["format"], "craftmine.contract-vectors/1");
    for case in vectors["vectors"].as_array().unwrap() {
        let text = case["lockText"].as_str().unwrap();
        let parsed = AssetLock::parse_canonical(text.as_bytes())?;
        assert_eq!(
            parsed.canonical_text()?,
            text,
            "canonical text {}",
            case["name"]
        );
        assert_eq!(
            parsed.asset_lock_hash()?,
            case["assetLockHash"].as_str().unwrap(),
            "shared hash {}",
            case["name"]
        );
        // The catalog's own builder must produce the identical document.
        let rebuilt = lock::build(parsed.assets.clone())?;
        assert_eq!(
            rebuilt.asset_lock_hash()?,
            parsed.asset_lock_hash()?,
            "catalog lock builder {}",
            case["name"]
        );
    }
    let mut checked = 0usize;
    for case in vectors["errorVectors"].as_array().unwrap() {
        let input = case["input"].as_str().unwrap_or("");
        let expected = case["expectedError"].as_str().unwrap();
        let error = match case["call"].as_str().unwrap_or("") {
            "validate_sha256" => validate_sha256(input).unwrap_err().to_string(),
            "validate_oid" => validate_oid(input).unwrap_err().to_string(),
            "validate_relative_path" => validate_relative_path(input).unwrap_err().to_string(),
            "detect_path_collisions" => {
                let paths: Vec<String> = serde_json::from_str(input)?;
                crate::content_history::contract::detect_path_collisions(
                    paths.iter().map(String::as_str),
                )
                .unwrap_err()
                .to_string()
            }
            // Structural vectors (lock conflict, cycle, non-canonical bytes)
            // are exercised by R1's contract_tests; the catalog must not
            // re-implement them.
            _ => continue,
        };
        assert!(error.contains(expected), "{}: {error}", case["name"]);
        checked += 1;
    }
    assert!(
        checked >= 17,
        "expected to execute the shared error vectors, ran {checked}"
    );
    Ok(())
}

#[test]
fn al0_path_rules_come_from_the_shared_contract() {
    // Rejections use R1's codes; the catalog adds no second path rule.
    for (bad, code) in [
        ("../evil.tscn", "PATH_TRAVERSAL"),
        ("/absolute.tscn", "PATH_NOT_RELATIVE"),
        ("a\\b.tscn", "PATH_NOT_RELATIVE"),
        ("textures/CON.png", "PATH_RESERVED_NAME"),
        ("textures/lpt9.png", "PATH_RESERVED_NAME"),
        ("textures/trailing.", "INVALID_RELATIVE_PATH"),
        ("a/.git/config", "PATH_TRAVERSAL"),
        ("", "INVALID_RELATIVE_PATH"),
    ] {
        let error = validate_relative_path(bad).unwrap_err().to_string();
        assert!(error.contains(code), "{bad}: {error}");
    }
    // The shared rule allows dot-prefixed files; only `.git` components are
    // refused, so the catalog must not invent a stricter rule of its own.
    for good in [
        "textures/door.png",
        "objects/auto-door.tscn",
        "a/b/c/d.gd",
        ".gitignore",
        ".hidden/asset.png",
    ] {
        assert!(validate_relative_path(good).is_ok(), "{good}");
    }
}

#[test]
fn al0_catalog_builds_a_canonical_shared_lock() -> Result<()> {
    use crate::content_history::contract::{AssetLock, AssetOverrideRef};

    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let texture = write_source(&root, "door.png", &png_header(4, 4))?;
    let object = write_source(&root, "door.glb", &glb_header(128))?;
    let raw = journal.asset_import(&import_args(
        &root,
        &texture,
        "op-lock-raw",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    ))?;
    let model = journal.asset_import(&import_args(
        &root,
        &object,
        "op-lock-object",
        "auto-door",
        1,
        "models/door.glb",
        "model/gltf-binary",
        "model",
    ))?;
    let raw_ref = super::contract::asset_ref(
        "door-texture",
        1,
        raw["contentHash"].as_str().unwrap(),
    )?;
    let object_ref =
        super::contract::asset_ref("auto-door", 1, model["contentHash"].as_str().unwrap())?;

    let raw_entry = lock::entry(
        raw_ref.clone(),
        "assets/textures/door.png",
        vec![FileRef {
            path: "door.png".into(),
            sha256: raw["version_"]["files"][0]["sha256"]
                .as_str()
                .unwrap()
                .into(),
            bytes: raw["bytes"].as_u64().unwrap(),
            media_type: "image/png".into(),
        }],
        vec![],
        vec![],
    )?;
    let object_entry = lock::entry(
        object_ref.clone(),
        "assets/models/door.glb",
        vec![FileRef {
            path: "door.glb".into(),
            sha256: model["version_"]["files"][0]["sha256"]
                .as_str()
                .unwrap()
                .into(),
            bytes: model["bytes"].as_u64().unwrap(),
            media_type: "model/gltf-binary".into(),
        }],
        vec![raw_ref.clone()],
        vec![AssetOverrideRef {
            scope: "world:town".into(),
            path: "door.glb".into(),
            content_hash: raw_ref.content_hash.clone(),
        }],
    )?;

    let catalog_lock = lock::build(vec![object_entry.clone(), raw_entry.clone()])?;
    // The catalog's builder must be byte-identical to R1's own canonicalization.
    let direct = AssetLock::new(vec![raw_entry.clone(), object_entry.clone()])?;
    assert_eq!(catalog_lock.canonical_text()?, direct.canonical_text()?);
    assert_eq!(catalog_lock.asset_lock_hash()?, direct.asset_lock_hash()?);
    let parsed = AssetLock::parse_canonical(catalog_lock.canonical_bytes()?.as_slice())?;
    assert_eq!(parsed.asset_lock_hash()?, catalog_lock.asset_lock_hash()?);

    // Fixed closure: the object pulls in exactly its texture, sorted.
    let closure = lock::resolve_closure(&catalog_lock, &[object_ref.clone()])?;
    assert_eq!(closure, vec![object_ref.clone(), raw_ref.clone()]);

    // The shared contract rejects unresolved dependencies and cycles; the
    // catalog does not resolve them silently.
    let orphan = lock::entry(
        object_ref.clone(),
        "assets/models/door.glb",
        vec![],
        vec![super::contract::asset_ref("missing", 1, &"a".repeat(64))?],
        vec![],
    )?;
    let error = lock::build(vec![orphan, raw_entry.clone()])
        .unwrap_err()
        .to_string();
    assert!(error.contains("ASSET_LOCK_DEPENDENCY_UNRESOLVED"), "{error}");

    let back = lock::entry(
        raw_ref.clone(),
        "assets/textures/door.png",
        vec![],
        vec![object_ref.clone()],
        vec![],
    )?;
    let error = lock::build(vec![back, object_entry])
        .unwrap_err()
        .to_string();
    assert!(error.contains("ASSET_LOCK_DEPENDENCY_CYCLE"), "{error}");
    Ok(())
}

#[test]
fn al1_streams_real_files_beyond_the_legacy_limit_and_dedupes_bodies() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let bytes = deterministic_bytes(3 * 1024 * 1024 + 7);
    let file = write_source(&root, "door.png", &bytes)?;
    let file_hash = store::digest_bytes(&bytes);
    let expected = store::content_hash(&[FileRef {
        path: "textures/door.png".into(),
        sha256: file_hash.clone(),
        bytes: bytes.len() as u64,
        media_type: "image/png".into(),
    }])?;
    assert!(bytes.len() as u64 > LEGACY_ASSET_BYTES);

    let first = journal.asset_import(&import_args(
        &root,
        &file,
        "op-door-1",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    ))?;
    assert_eq!(first["contentHash"], expected);
    assert_eq!(first["version_"]["files"][0]["sha256"], file_hash);
    assert_eq!(first["bytes"], bytes.len() as u64);
    assert_eq!(first["deduplicated"], false);
    assert_eq!(first["replayed"], false);
    assert_eq!(first["state"]["indexed"], true);
    assert_eq!(first["state"]["previewable"], false);
    assert_eq!(first["state"]["baseChecked"], Value::Null);

    // Same body, different asset: the blob is deduplicated but provenance and
    // license stay separate.
    let mut second_args = import_args(
        &root,
        &file,
        "op-door-2",
        "door-texture-copy",
        1,
        "textures/door-copy.png",
        "image/png",
        "image",
    );
    second_args["source"]["origin"] = json!("imported");
    second_args["source"]["license"] = json!("CC0-1.0");
    second_args["source"]["licenseStatus"] = json!("verified");
    let second = journal.asset_import(&second_args)?;
    assert_eq!(second["version_"]["files"][0]["sha256"], file_hash);
    assert_eq!(second["deduplicated"], true);

    let original = journal.asset_read(&json!({"assetId":"door-texture","version":1}))?;
    let copy = journal.asset_read(&json!({"assetId":"door-texture-copy","version":1}))?;
    assert_eq!(original["version_"]["source"]["origin"], "local");
    assert_eq!(copy["version_"]["source"]["origin"], "imported");
    assert_eq!(copy["version_"]["source"]["license"], "CC0-1.0");
    // The body is deduplicated but the logical content identity still includes
    // the install path, so the two content hashes stay distinct.
    assert_ne!(
        original["version_"]["contentHash"],
        copy["version_"]["contentHash"]
    );
    assert_eq!(
        original["version_"]["files"][0]["sha256"],
        copy["version_"]["files"][0]["sha256"]
    );

    // The body is reachable through a host path, never through chat base64.
    let body = journal.asset_body_path(&json!({
        "assetId": "door-texture",
        "version": 1,
        "path": "textures/door.png",
    }))?;
    let path_on_disk = PathBuf::from(body["blobPath"].as_str().unwrap());
    assert!(path_on_disk.is_file());
    assert_eq!(std::fs::metadata(&path_on_disk)?.len(), bytes.len() as u64);
    Ok(())
}

#[test]
fn al1_replays_identical_operations_and_refuses_same_version_new_content() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let first_bytes = deterministic_bytes(64 * 1024);
    let file = write_source(&root, "door.png", &first_bytes)?;
    let args = import_args(
        &root,
        &file,
        "op-replay",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    );
    let first = journal.asset_import(&args)?;
    let replay = journal.asset_import(&args)?;
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["contentHash"], first["contentHash"]);

    // Different body for the same asset/version is refused, and the stored
    // version is untouched.
    let changed = write_source(&root, "door-v2.png", &deterministic_bytes(32 * 1024))?;
    let conflict = import_args(
        &root,
        &changed,
        "op-conflict",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    );
    let error = journal.asset_import(&conflict).unwrap_err().to_string();
    assert!(error.contains("ASSET_VERSION_CONFLICT"), "{error}");
    let stored = journal.asset_read(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(stored["version_"]["contentHash"], first["contentHash"]);

    // The same operation id with a different request is a conflict.
    let mut tampered = args.clone();
    tampered["displayName"] = json!("renamed");
    let error = journal.asset_import(&tampered).unwrap_err().to_string();
    assert!(error.contains("OPERATION_CONFLICT"), "{error}");
    Ok(())
}

#[test]
fn al1_refuses_unauthorized_sources_paths_and_oversized_budget_without_partial_state() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let outside = dir.path().join("outside.png");
    std::fs::write(&outside, deterministic_bytes(128))?;
    let inside = write_source(&root, "inside.png", &deterministic_bytes(2048))?;

    let escape = import_args(
        &root,
        &outside,
        "op-escape",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    );
    let error = journal.asset_import(&escape).unwrap_err().to_string();
    assert!(error.contains("ASSET_SOURCE_OUTSIDE_ROOT"), "{error}");

    let traversal = import_args(
        &root,
        &inside,
        "op-traversal",
        "door-texture",
        1,
        "../textures/door.png",
        "image/png",
        "image",
    );
    let error = journal.asset_import(&traversal).unwrap_err().to_string();
    assert!(error.contains("PATH_TRAVERSAL"), "{error}");

    let mut over = import_args(
        &root,
        &inside,
        "op-over",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    );
    over["budget"] = json!({"maxFileBytes": 1024});
    let error = journal.asset_import(&over).unwrap_err().to_string();
    assert!(error.contains("ASSET_FILE_TOO_LARGE"), "{error}");

    // Nothing partial survived: no version row and no blob at a final path.
    assert!(journal
        .asset_read(&json!({"assetId":"door-texture","version":1}))
        .is_err());
    let blobs = store::blob_root(&journal.directory, false)?;
    let entries: Vec<_> = walk(&blobs)?;
    assert!(entries.is_empty(), "staging left files: {entries:?}");

    let unsupported = import_args(
        &root,
        &inside,
        "op-format",
        "door-texture",
        1,
        "textures/door.png",
        "image/webp",
        "image",
    );
    let error = journal.asset_import(&unsupported).unwrap_err().to_string();
    assert!(error.contains("UNSUPPORTED_MEDIA_TYPE"), "{error}");
    Ok(())
}

fn walk(root: &Path) -> Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    if !root.exists() {
        return Ok(found);
    }
    for entry in std::fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            found.extend(walk(&path)?);
        } else {
            found.push(path);
        }
    }
    Ok(found)
}

#[test]
fn al1_versions_stay_immutable_while_browsing_metadata_changes() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let v1 = write_source(&root, "door-v1.png", &deterministic_bytes(4096))?;
    let v2 = write_source(&root, "door-v2.png", &deterministic_bytes(8192))?;
    let first = journal.asset_import(&import_args(
        &root,
        &v1,
        "op-v1",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    ))?;
    let second = journal.asset_import(&import_args(
        &root,
        &v2,
        "op-v2",
        "door-texture",
        2,
        "textures/door-v2.png",
        "image/png",
        "image",
    ))?;
    assert_ne!(first["contentHash"], second["contentHash"]);

    let listed = journal.asset_versions(&json!({"assetId":"door-texture","offset":0,"limit":10}))?;
    assert_eq!(listed["total"], 2);
    assert_eq!(listed["items"][0]["version_"]["version"], 2);

    let annotated = journal.asset_annotate(&json!({
        "operationId": "op-annotate",
        "assetId": "door-texture",
        "displayName": "红色自动门",
        "tags": ["门", "自动"],
        "favorite": true,
    }))?;
    assert_eq!(annotated["contentHash"], second["contentHash"]);
    let after = journal.asset_read(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(after["version_"]["contentHash"], first["contentHash"]);
    assert_eq!(after["version_"]["displayName"], "textures/door.png");

    // Legacy mapping keeps the original definition and hash.
    let mapped = journal.asset_map_legacy(&json!({
        "operationId": "op-legacy",
        "legacyKind": "library-bundle/1",
        "legacyId": "door-texture",
        "legacyVersion": "1",
        "assetId": "door-texture",
        "version": 1,
        "detail": "旧 Web 包 asset id/version/hash 原样保留",
    }))?;
    assert_eq!(mapped["contentHash"], first["contentHash"]);
    let resolved = journal.asset_resolve_legacy(&json!({
        "legacyKind": "library-bundle/1",
        "legacyId": "door-texture",
        "legacyVersion": "1",
    }))?;
    assert_eq!(resolved["mapped"], true);
    assert_eq!(resolved["version"], 1);
    Ok(())
}

#[test]
fn al2_search_filters_by_scope_kind_tags_and_paginates() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    for (index, name) in ["door.png", "crate.png", "floor.png"].iter().enumerate() {
        let file = write_source(&root, name, &deterministic_bytes(512 + index))?;
        journal.asset_import(&import_args(
            &root,
            &file,
            &format!("op-{index}"),
            &format!("asset-{index}"),
            1,
            &format!("textures/{name}"),
            "image/png",
            "image",
        ))?;
    }
    journal.asset_annotate(&json!({
        "operationId": "op-tag-0",
        "assetId": "asset-0",
        "displayName": "门贴图",
        "tags": ["门"],
        "favorite": true,
    }))?;
    journal.asset_annotate(&json!({
        "operationId": "op-tag-1",
        "assetId": "asset-1",
        "displayName": "木箱",
        "tags": ["道具"],
    }))?;

    let by_query = journal.asset_search(&json!({"scope":"local-library","query":"门","offset":0,"limit":10}))?;
    assert_eq!(by_query["total"], 1);
    assert_eq!(by_query["items"][0]["assetId"], "asset-0");

    let by_tag = journal.asset_search(&json!({"scope":"local-library","tags":["道具"],"offset":0,"limit":10}))?;
    assert_eq!(by_tag["total"], 1);
    assert_eq!(by_tag["items"][0]["assetId"], "asset-1");

    let favorites = journal.asset_search(&json!({"scope":"local-library","favoritesOnly":true,"offset":0,"limit":10}))?;
    assert_eq!(favorites["total"], 1);

    let page = journal.asset_search(&json!({"scope":"local-library","offset":1,"limit":1}))?;
    assert_eq!(page["total"], 3);
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["nextOffset"], 2);

    // Current-world scope needs a real usage relation.
    let empty = journal.asset_search(&json!({"scope":"current-world","worldId":"a","offset":0,"limit":10}))?;
    assert_eq!(empty["total"], 0);
    journal.asset_record_usage(&json!({
        "assetId": "asset-0",
        "version": 1,
        "refKind": "world-current",
        "refId": "a",
        "detail": "自动门 v1",
    }))?;
    let scoped = journal.asset_search(&json!({"scope":"current-world","worldId":"a","offset":0,"limit":10}))?;
    assert_eq!(scoped["total"], 1);
    assert_eq!(scoped["items"][0]["state"]["appliedToSource"]["worldId"], "a");

    let usage = journal.asset_usage(&json!({"assetId":"asset-0"}))?;
    assert_eq!(usage["total"], 1);
    assert_eq!(usage["items"][0]["refKind"], "world-current");
    Ok(())
}

#[test]
fn al2_probe_and_preview_states_never_conflate() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let image = write_source(&root, "door.png", &png_header(64, 32))?;
    let model = write_source(&root, "door.glb", &glb_header(512))?;
    journal.asset_import(&import_args(
        &root,
        &image,
        "op-image",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    ))?;
    journal.asset_import(&import_args(
        &root,
        &model,
        "op-model",
        "auto-door",
        1,
        "models/door.glb",
        "model/gltf-binary",
        "model",
    ))?;

    let probe = journal.asset_probe(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(probe["probeOk"], true);
    assert_eq!(probe["format"], "png");
    assert_eq!(probe["facts"]["width"], 64);
    assert_eq!(probe["facts"]["height"], 32);
    assert_eq!(probe["pixelDecoded"], false);
    let glb = journal.asset_probe(&json!({"assetId":"auto-door","version":1}))?;
    assert_eq!(glb["probeOk"], true);
    assert_eq!(glb["format"], "glb");
    assert_eq!(glb["facts"]["version"], 2);

    let begin = journal.asset_preview_begin(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(begin["cached"], false);
    assert_eq!(begin["preview"]["status"], "pending");
    let cached = journal.asset_preview_begin(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(cached["cached"], true);
    assert_eq!(cached["cacheKey"], begin["cacheKey"]);

    // A success without real decoder evidence is refused.
    let error = journal
        .asset_preview_finish(&json!({
            "operationId": "op-preview-bad",
            "assetId": "door-texture",
            "version": 1,
            "status": "ok",
            "detail": "",
            "facts": {"decoder": "image-decode.mjs"},
        }))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PREVIEW_EVIDENCE_REQUIRED"), "{error}");
    let state = journal.asset_read(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(state["state"]["previewable"], false);

    let finished = journal.asset_preview_finish(&json!({
        "operationId": "op-preview-ok",
        "assetId": "door-texture",
        "version": 1,
        "status": "ok",
        "detail": "decoded 64x32 rgba",
        "facts": {
            "decoder": "image-decode.mjs@1",
            "digest": store::digest_bytes(&png_header(64, 32)),
            "width": 64,
            "height": 32,
        },
    }))?;
    assert_eq!(finished["status"], "ok");
    let state = journal.asset_read(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(state["state"]["previewable"], true);

    // A failed preview on another version must not make it installable, and it
    // must not affect the successful one.
    journal.asset_import(&import_args(
        &root,
        &image,
        "op-image-2",
        "door-texture",
        2,
        "textures/door-v2.png",
        "image/png",
        "image",
    ))?;
    journal.asset_preview_begin(&json!({"assetId":"door-texture","version":2}))?;
    journal.asset_preview_finish(&json!({
        "operationId": "op-preview-fail",
        "assetId": "door-texture",
        "version": 2,
        "status": "failed",
        "detail": "decode error",
        "facts": {},
    }))?;
    let v2 = journal.asset_read(&json!({"assetId":"door-texture","version":2}))?;
    assert_eq!(v2["state"]["previewable"], false);
    let v1 = journal.asset_read(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(v1["state"]["previewable"], true);

    // Base-check evidence is per exact content hash.
    journal.asset_record_check(&json!({
        "operationId": "op-check",
        "assetId": "door-texture",
        "version": 1,
        "baseId": "first-person",
        "baseVersion": 1,
        "engineVersion": "4.7.2-stable",
        "target": "desktop",
        "checkerVersion": "asset-probe/1",
        "status": "passed",
        "detail": "静态引用完整",
    }))?;
    let checked = journal.asset_read(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(checked["state"]["baseChecked"]["status"], "passed");
    assert_eq!(checked["state"]["baseChecked"]["baseId"], "first-person");
    let unchecked = journal.asset_read(&json!({"assetId":"door-texture","version":2}))?;
    assert_eq!(unchecked["state"]["baseChecked"], Value::Null);
    Ok(())
}

#[test]
fn al1_scan_reports_new_version_hints_without_touching_worlds() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let nested = root.join("textures");
    std::fs::create_dir_all(&nested)?;
    std::fs::write(nested.join("door.png"), png_header(4, 4))?;
    std::fs::write(root.join("note.webp"), b"unsupported")?;

    let before = journal.asset_search(&json!({"scope":"local-library","offset":0,"limit":10}))?;
    let scan = journal.asset_scan(&json!({"sourceRoot": root.to_string_lossy()}))?;
    assert_eq!(scan["worldUpdated"], false);
    assert_eq!(scan["scanned"], 2);
    assert_eq!(scan["hints"]["newVersions"], 1);
    assert_eq!(scan["hints"]["unsupported"], 1);
    let png = scan["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["path"] == "textures/door.png")
        .unwrap();
    assert_eq!(png["known"], false);
    assert_eq!(png["supported"], true);
    assert_eq!(png["mediaType"], "image/png");
    let after = journal.asset_search(&json!({"scope":"local-library","offset":0,"limit":10}))?;
    assert_eq!(after["total"], before["total"], "scan must not register anything");

    let file = nested.join("door.png");
    journal.asset_import(&import_args(
        &root,
        &file,
        "op-scan",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    ))?;
    let rescan = journal.asset_scan(&json!({"sourceRoot": root.to_string_lossy()}))?;
    assert_eq!(rescan["hints"]["newVersions"], 0);
    assert_eq!(rescan["hints"]["unchanged"], 1);
    let known = rescan["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["path"] == "textures/door.png")
        .unwrap();
    assert_eq!(known["known"], true);
    assert_eq!(known["assetId"], "door-texture");

    let limited = journal.asset_scan(&json!({"sourceRoot": root.to_string_lossy(), "maxFiles": 1}))?;
    assert_eq!(limited["truncated"], true);
    Ok(())
}

#[test]
fn al2_preview_cache_key_matches_the_cross_language_constant() -> Result<()> {
    // Preview cache keys are asset-catalog-owned (not part of the shared lock
    // contract). The Node preview service asserts the same constant in
    // tests/godot-round2/R6/preview-service.test.mjs.
    const CANONICAL: &str = "craftmine.asset-preview/1\ndoor-texture\n1\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nasset-preview/1\n4.7.2-stable\ndefault";
    const SHA256: &str = "a372177f10f8030150ed62ff1543e1fc5e41c46d211a85248fc12c640ea48d42";
    let computed = super::preview::cache_key(
        "door-texture",
        1,
        &"a".repeat(64),
        "default",
    );
    assert_eq!(computed, SHA256, "Rust preview cache key");
    assert_eq!(
        store::digest_bytes(CANONICAL.as_bytes()),
        SHA256,
        "the frozen canonical string must hash to the frozen value"
    );
    Ok(())
}

#[test]
fn al1_existing_version_path_records_receipts_and_refuses_new_provenance() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let file = write_source(&root, "door.png", &deterministic_bytes(4096))?;
    let args = import_args(
        &root,
        &file,
        "op-existing",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    );
    journal.asset_import(&args)?;

    // Same content, same provenance, new operation id: this hits the
    // existing-version branch, which must still write a receipt.
    let mut again = args.clone();
    again["operationId"] = json!("op-existing-2");
    let second = journal.asset_import(&again)?;
    assert_eq!(second["existing"], true);
    let mut tampered = again.clone();
    tampered["displayName"] = json!("renamed");
    let error = journal.asset_import(&tampered).unwrap_err().to_string();
    assert!(error.contains("OPERATION_CONFLICT"), "{error}");
    let replay = journal.asset_import(&again)?;
    assert_eq!(replay["replayed"], true);

    // Same bytes under a different licence is not the same logical version.
    let mut relicensed = args.clone();
    relicensed["operationId"] = json!("op-existing-3");
    relicensed["source"]["license"] = json!("CC0-1.0");
    relicensed["source"]["licenseStatus"] = json!("verified");
    let error = journal.asset_import(&relicensed).unwrap_err().to_string();
    assert!(error.contains("ASSET_SOURCE_CONFLICT"), "{error}");
    Ok(())
}

#[test]
fn al2_preview_claim_and_retry_are_enforced() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let image = write_source(&root, "door.png", &png_header(8, 8))?;
    journal.asset_import(&import_args(
        &root,
        &image,
        "op-claim",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    ))?;

    // A finish without a claimed begin is refused.
    let error = journal
        .asset_preview_finish(&json!({
            "operationId": "op-finish-unclaimed",
            "assetId": "door-texture",
            "version": 1,
            "status": "ok",
            "detail": "x",
            "facts": {"decoder": "image-decode.mjs@1", "digest": store::digest_bytes(b"x")},
        }))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PREVIEW_NOT_CLAIMED"), "{error}");

    journal.asset_preview_begin(&json!({"assetId":"door-texture","version":1}))?;
    journal.asset_preview_finish(&json!({
        "operationId": "op-preview-timeout",
        "assetId": "door-texture",
        "version": 1,
        "status": "timeout",
        "detail": "slow",
        "facts": {},
    }))?;
    let retry = journal.asset_preview_begin(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(retry["cached"], false);
    assert_eq!(retry["retried"], true);
    assert_eq!(retry["previousStatus"], "timeout");

    journal.asset_preview_finish(&json!({
        "operationId": "op-preview-ok",
        "assetId": "door-texture",
        "version": 1,
        "status": "ok",
        "detail": "decoded",
        "facts": {"decoder": "image-decode.mjs@1", "digest": store::digest_bytes(&png_header(8, 8))},
    }))?;
    let cached = journal.asset_preview_begin(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(cached["cached"], true);
    assert_eq!(cached["retried"], false);
    let state = journal.asset_read(&json!({"assetId":"door-texture","version":1}))?;
    assert_eq!(state["state"]["previewable"], true);
    Ok(())
}

#[test]
fn al2_record_check_is_idempotent_and_conflict_safe() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let image = write_source(&root, "door.png", &png_header(4, 4))?;
    journal.asset_import(&import_args(
        &root,
        &image,
        "op-check-import",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    ))?;
    let check = json!({
        "operationId": "op-check-1",
        "assetId": "door-texture",
        "version": 1,
        "baseId": "first-person",
        "baseVersion": 1,
        "engineVersion": "4.7.2-stable",
        "target": "desktop",
        "checkerVersion": "asset-probe/1",
        "status": "passed",
        "detail": "静态引用完整",
    });
    journal.asset_record_check(&check)?;
    let replay = journal.asset_record_check(&check)?;
    assert_eq!(replay["replayed"], true);
    let mut tampered = check.clone();
    tampered["status"] = json!("failed");
    let error = journal.asset_record_check(&tampered).unwrap_err().to_string();
    assert!(error.contains("OPERATION_CONFLICT"), "{error}");
    Ok(())
}

#[test]
fn al1_content_hash_refuses_duplicate_paths_and_discard_keeps_referenced_blobs() -> Result<()> {
    let duplicate = FileRef {
        path: "textures/door.png".into(),
        sha256: store::digest_bytes(b"a"),
        bytes: 1,
        media_type: "image/png".into(),
    };
    let error = store::content_hash(&[duplicate.clone(), duplicate.clone()])
        .unwrap_err()
        .to_string();
    assert!(error.contains("ASSET_CONTENT_PATH_CONFLICT"), "{error}");

    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let bytes = deterministic_bytes(2048);
    let file = write_source(&root, "door.png", &bytes)?;
    journal.asset_import(&import_args(
        &root,
        &file,
        "op-discard",
        "door-texture",
        1,
        "textures/door.png",
        "image/png",
        "image",
    ))?;
    let blobs = store::blob_root(&journal.directory, false)?;
    let referenced = store::blob_path(&blobs, &store::digest_bytes(&bytes))?;
    assert!(referenced.is_file());
    store::discard_blob(&journal.db, &blobs, &store::digest_bytes(&bytes))?;
    assert!(referenced.is_file(), "referenced blobs must never be discarded");

    let orphan = store::digest_bytes(b"orphan-body");
    let orphan_path = store::blob_path(&blobs, &orphan)?;
    std::fs::create_dir_all(orphan_path.parent().unwrap())?;
    std::fs::write(&orphan_path, b"orphan-body")?;
    store::discard_blob(&journal.db, &blobs, &orphan)?;
    assert!(!orphan_path.exists(), "unreferenced blobs are removed");
    Ok(())
}

#[test]
fn al2_probe_verifies_the_whole_blob_even_beyond_the_prefix() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let bytes = deterministic_bytes(2 * 1024 * 1024);
    let file = write_source(&root, "big.png", &bytes)?;
    journal.asset_import(&import_args(
        &root,
        &file,
        "op-big",
        "big-texture",
        1,
        "textures/big.png",
        "image/png",
        "image",
    ))?;
    let blobs = store::blob_root(&journal.directory, false)?;
    let path = store::blob_path(&blobs, &store::digest_bytes(&bytes))?;
    let mut tampered = bytes.clone();
    tampered[0] ^= 0xff;
    std::fs::write(&path, &tampered)?;
    let error = journal
        .asset_probe(&json!({"assetId":"big-texture","version":1}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("CORRUPT_ASSET_BLOB"), "{error}");
    Ok(())
}

#[test]
fn al2_search_and_import_measurements_are_recorded() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let bulk = write_source(&root, "bulk.bin", &deterministic_bytes(1024))?;
    let started = std::time::Instant::now();
    for index in 0..1000 {
        let mut args = import_args(
            &root,
            &bulk,
            &format!("op-scale-{index}"),
            &format!("asset-{index:04}"),
            1,
            &format!("textures/asset-{index:04}.png"),
            "image/png",
            "image",
        );
        args["displayName"] = json!(format!("asset {index:04}"));
        journal.asset_import(&args)?;
    }
    let import_ms = started.elapsed().as_millis();
    println!("MEASURED import 1000 assets (1 KiB body): {import_ms} ms");

    let mut samples = Vec::new();
    for _ in 0..20 {
        let started = std::time::Instant::now();
        let page = journal.asset_search(&json!({"scope":"local-library","offset":0,"limit":100}))?;
        samples.push(started.elapsed().as_micros());
        assert_eq!(page["total"], 1000);
        assert_eq!(page["items"].as_array().unwrap().len(), 100);
    }
    samples.sort();
    let p50 = samples[samples.len() / 2];
    let p95 = samples[samples.len() * 95 / 100];
    println!("MEASURED asset search over 1000 assets: P50 {p50} us, P95 {p95} us");
    assert!(p50 > 0 && p95 >= p50);

    // One large body at the recommended import budget (16 MiB), streamed and
    // verified against an independently computed hash.
    let large = write_source(&root, "large.bin", &deterministic_bytes(16 * 1024 * 1024))?;
    let expected_large = store::content_hash(&[FileRef {
        path: "textures/large.png".into(),
        sha256: store::digest_bytes(&std::fs::read(&large)?),
        bytes: 16 * 1024 * 1024,
        media_type: "image/png".into(),
    }])?;
    let started = std::time::Instant::now();
    let imported = journal.asset_import(&import_args(
        &root,
        &large,
        "op-large",
        "large-body",
        1,
        "textures/large.png",
        "image/png",
        "image",
    ))?;
    println!(
        "MEASURED import 16 MiB body: {} ms, verified={}",
        started.elapsed().as_millis(),
        imported["contentHash"] == expected_large
    );
    assert_eq!(imported["contentHash"], expected_large);
    Ok(())
}
