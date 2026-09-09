use super::*;

const VECTORS: &str =
    include_str!("../../../../../../tests/godot-round2/R4/vectors/package-format-vectors.json");
const S3_VECTORS: &str =
    include_str!("../../../../../../tests/godot-round3/S3/vectors/asset-lock-vectors.json");
const CONTRACT_VECTORS: &str =
    include_str!("../../../../../../tests/godot-remaining/M/contract/asset-lock-vectors.json");

fn vectors() -> Value {
    parse(VECTORS).expect("vector file must be strict JSON")
}

fn s3_vectors() -> Value {
    parse(S3_VECTORS).expect("S3 vector file must be strict JSON")
}

fn contract_vectors() -> Value {
    serde_json::from_str(CONTRACT_VECTORS).expect("contract vector file must be JSON")
}

fn code(error: anyhow::Error) -> String {
    error.to_string()
}

#[test]
fn canonical_vectors_are_shared_with_javascript() {
    let vectors = vectors();
    for case in vectors["canonical"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let input = case["input"].as_str().unwrap();
        match case.get("error").and_then(Value::as_str) {
            Some(expected) => {
                let error = code(canonical_json(input).unwrap_err());
                assert!(error.contains(expected), "{name}: expected {expected}, got {error}");
            }
            None => {
                let actual = canonical_json(input)
                    .unwrap_or_else(|error| panic!("{name}: {error}"));
                assert_eq!(actual, case["canonical"].as_str().unwrap(), "{name}");
            }
        }
    }
}

#[test]
fn path_vectors_are_shared_with_javascript() {
    let vectors = vectors();
    for path in vectors["paths"]["accept"].as_array().unwrap() {
        let path = path.as_str().unwrap();
        assert!(validate_path(path).is_ok(), "accept {path}");
    }
    for case in vectors["paths"]["reject"].as_array().unwrap() {
        let path = case["path"].as_str().unwrap();
        let expected = case["error"].as_str().unwrap();
        let error = code(validate_path(path).unwrap_err());
        assert!(error.contains(expected), "reject {path}: {error}");
    }
}

#[test]
fn kind_vectors_are_shared_with_javascript() {
    let vectors = vectors();
    for kind in vectors["kinds"]["accept"].as_array().unwrap() {
        validate_kind(kind.as_str().unwrap()).unwrap();
    }
    for case in vectors["kinds"]["reject"].as_array().unwrap() {
        let error = code(validate_kind(case["kind"].as_str().unwrap()).unwrap_err());
        assert!(error.contains(case["error"].as_str().unwrap()), "{error}");
    }
}

#[test]
fn legacy_kinds_are_mapped_or_refused_never_guessed() {
    let vectors = vectors();
    for case in vectors["legacy"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        match case.get("error").and_then(Value::as_str) {
            Some(expected) => {
                let error = code(legacy_kind(&case["source"]).unwrap_err());
                assert!(error.contains(expected), "{name}: {error}");
            }
            None => {
                let actual = legacy_kind(&case["source"]).unwrap();
                if let Some(kind) = case.get("kind") {
                    assert_eq!(actual["kind"], *kind, "{name}");
                }
                if let Some(ambiguous) = case.get("ambiguous") {
                    assert_eq!(actual["ambiguous"], *ambiguous, "{name}");
                }
            }
        }
    }
}

/// The lock has one definition. Both languages execute these vectors: an
/// accepted document must canonicalize to the same `assetLockHash`, and a
/// refused document must fail with the same code. The frozen vectors come from
/// the Rust contract itself, so this also proves the JavaScript mirror
/// reproduces serde_json's pretty bytes exactly.
#[test]
fn lock_vectors_are_shared_with_javascript() {
    let vectors = s3_vectors();
    for case in vectors["accept"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let lock = validate_lock(&case["lock"])
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(
            lock.asset_lock_hash().unwrap(),
            case["assetLockHash"].as_str().unwrap(),
            "{name}: canonical hash"
        );
        // Idempotent: validating a canonical lock changes nothing.
        assert_eq!(
            lock,
            validate_lock(&case["lock"]).unwrap(),
            "{name}: idempotent"
        );
    }
    for case in vectors["reject"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let expected = case["error"].as_str().unwrap();
        let error = code(validate_lock(&case["lock"]).unwrap_err());
        assert!(error.contains(expected), "{name}: expected {expected}, got {error}");
    }
}

#[test]
fn frozen_contract_lock_vector_is_reproduced() {
    let vectors = contract_vectors();
    for case in vectors["vectors"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let text = case["lockText"].as_str().unwrap();
        let lock = validate_lock(&parse(text).unwrap())
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(
            lock.canonical_text().unwrap(),
            text,
            "{name}: canonical bytes"
        );
        assert_eq!(
            lock.asset_lock_hash().unwrap(),
            case["assetLockHash"].as_str().unwrap(),
            "{name}: assetLockHash"
        );
        assert_eq!(
            lock.assets.len(),
            case["lockText"].as_str().unwrap().matches("\"installPath\"").count(),
            "{name}: asset count"
        );
    }
}

#[test]
fn media_type_table_is_shared_with_javascript() {
    let vectors = s3_vectors();
    for case in vectors["mediaTypes"].as_array().unwrap() {
        assert_eq!(
            media_type_for_path(case["path"].as_str().unwrap()),
            case["mediaType"].as_str().unwrap(),
            "{}",
            case["path"]
        );
    }
    assert_eq!(media_type_for_path("no-extension"), "application/octet-stream");
    assert_eq!(media_type_for_path("a/b.GD"), "text/x-gdscript");
}

#[test]
fn package_dependency_metadata_converts_into_an_asset_ref() {
    let converted = dependency_to_asset_ref(&json!({"id": "stone", "version": 1,
        "sha256": "a".repeat(64)})).unwrap();
    assert_eq!(converted.asset_id, "stone");
    assert_eq!(converted.version, "1");
    assert_eq!(converted.content_hash, "a".repeat(64));
    assert!(code(
        dependency_to_asset_ref(&json!({"id": "stone", "version": 0,
            "sha256": "a".repeat(64)})).unwrap_err()
    )
    .contains("INVALID_VERSION"));
    assert!(code(
        dependency_to_asset_ref(&json!({"id": "stone", "version": 1,
            "sha256": "abc"})).unwrap_err()
    )
    .contains("INVALID_HASH"));
    // The package rule accepts uppercase hex and normalizes it.
    assert_eq!(
        dependency_to_asset_ref(&json!({"id": "stone", "version": 1,
            "sha256": "A".repeat(64)})).unwrap().content_hash,
        "a".repeat(64)
    );
}

#[test]
fn entry_collisions_and_unverified_normalization_are_refused() {
    let collision = vec!["a/B.txt".to_owned(), "a/b.txt".to_owned()];
    assert!(code(validate_entries(&collision).unwrap_err()).contains("PACKAGE_DUPLICATE_ENTRY"));
    let combining = vec!["a/e\u{0301}.txt".to_owned()];
    assert!(code(validate_entries(&combining).unwrap_err())
        .contains("PACKAGE_PATH_NEEDS_NORMALIZATION"));
    let ok = validate_entries(&["b.txt".to_owned(), "a.txt".to_owned()]).unwrap();
    assert_eq!(ok, vec!["a.txt".to_owned(), "b.txt".to_owned()]);
}

fn manifest() -> Value {
    let content = json!({"assetId": "chest", "version": 1, "kind": "object",
        "files": [{"path": "payload/chest.tscn", "bytes": 3, "sha256": "a".repeat(64)}],
        "dependencies": [], "entry": {}, "interfaces": {}, "compatibility": {},
        "state": {}, "licenses": {}});
    let hash = content_hash(&content).unwrap();
    json!({"format": RESOURCE_FORMAT, "content": content, "contentHash": hash})
}

#[test]
fn resource_manifest_identity_is_recomputed_not_trusted() {
    let manifest = manifest();
    let normalized = validate_resource_manifest(&manifest).unwrap();
    assert_eq!(normalized["contentHash"], manifest["contentHash"]);
    let mut tampered = manifest.clone();
    tampered["contentHash"] = json!("0".repeat(64));
    assert!(code(validate_resource_manifest(&tampered).unwrap_err())
        .contains("RESOURCE_CONTENT_HASH_MISMATCH"));
    let mut unknown = manifest.clone();
    unknown["extra"] = json!(1);
    assert!(code(validate_resource_manifest(&unknown).unwrap_err()).contains("UNKNOWN_FIELD"));
    let mut self_dependency = manifest.clone();
    self_dependency["content"]["dependencies"] = json!([{"id": "chest", "version": 1,
        "sha256": "a".repeat(64)}]);
    assert!(code(validate_resource_manifest(&self_dependency).unwrap_err())
        .contains("PACKAGE_SELF_DEPENDENCY"));
}

#[test]
fn package_index_refuses_unlisted_and_missing_entries() {
    let package = json!({"format": PACKAGE_FORMAT,
        "root": {"id": "chest", "version": 1, "sha256": "a".repeat(64)},
        "resources": [], "files": []});
    let unlisted = vec!["resources/deadbeef/manifest.json".to_owned()];
    assert!(code(validate_package_json(&package, &unlisted).unwrap_err())
        .contains("PACKAGE_ENTRY_NOT_LISTED"));
    let mut with_resource = package.clone();
    let manifest = manifest();
    with_resource["resources"] = json!([{"contentHash": manifest["contentHash"],
        "manifest": manifest, "files": []}]);
    let missing = Vec::new();
    assert!(code(validate_package_json(&with_resource, &missing).unwrap_err())
        .contains("PACKAGE_MISSING_FILE"));
}
