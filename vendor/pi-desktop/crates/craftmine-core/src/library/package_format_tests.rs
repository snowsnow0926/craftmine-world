use super::*;

const VECTORS: &str =
    include_str!("../../../../../../tests/godot-round2/R4/vectors/package-format-vectors.json");

fn vectors() -> Value {
    parse(VECTORS).expect("vector file must be strict JSON")
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

#[test]
fn lock_vectors_are_shared_with_javascript() {
    let vectors = vectors();
    for case in vectors["lock"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let lock = json!({"direct": case["direct"], "closure": case["closure"],
            "graph": case["graph"]});
        match case.get("error").and_then(Value::as_str) {
            Some(expected) => {
                let error = code(validate_lock(&lock).unwrap_err());
                assert!(error.contains(expected), "{name}: {error}");
            }
            None => assert!(validate_lock(&lock).is_ok(), "{name}"),
        }
    }
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
