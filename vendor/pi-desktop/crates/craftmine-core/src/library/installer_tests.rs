use super::*;
use crate::TaskJournal;

fn manifest(
    id: &str,
    version: u64,
    kind: &str,
    dependencies: Value,
    interfaces: Value,
    entities: Value,
    compatibility: Value,
) -> Value {
    let content = json!({"assetId": id, "version": version, "kind": kind,
        "files": [{"path": format!("payload/{id}.bin"), "bytes": 1, "sha256": "a".repeat(64)}],
        "dependencies": dependencies, "entry": {"entities": entities},
        "interfaces": interfaces, "compatibility": compatibility, "state": {},
        "licenses": {}});
    let hash = format::content_hash(&content).unwrap();
    json!({"format": format::RESOURCE_FORMAT, "content": content, "contentHash": hash})
}

fn dependency(manifest: &Value) -> Value {
    // A dependency declares the exact content hash of the resource it needs.
    json!({"id": manifest["content"]["assetId"], "version": manifest["content"]["version"],
        "sha256": manifest["contentHash"]})
}

fn target(inventory: Value) -> Value {
    json!({"worldId": "world", "base": "top-down", "baseVersion": "1.0.0",
        "engine": "4.7.2-stable", "stateFormat": "craftmine.godot-progress/1",
        "inventory": inventory})
}

fn inventory() -> Value {
    json!({"inputActions": [], "autoloads": [], "globalClasses": [], "uids": [],
        "paths": [], "entityIds": []})
}

fn journal() -> (tempfile::TempDir, TaskJournal) {
    let dir = tempfile::tempdir().unwrap();
    let db = TaskJournal::open(&dir.path().join("domain.sqlite")).unwrap();
    (dir, db)
}

#[test]
fn plans_dependencies_first_and_allocates_new_identity() {
    let (_dir, db) = journal();
    let stone = manifest("stone", 1, "raw", json!([]), json!({}), json!([]), json!({}));
    let recipe = manifest(
        "recipe",
        1,
        "data",
        json!([dependency(&stone)]),
        json!({}),
        json!(["table"]),
        json!({}),
    );
    let plan = db
        .package_plan_install(&json!({"operationId": "install-1",
            "resources": [recipe, stone], "target": target(inventory()),
            "options": {"allowInputActionRemap": false}}))
        .unwrap();
    assert_eq!(plan["ok"], true);
    assert_eq!(plan["order"], json!(["stone@1", "recipe@1"]));
    // One canonical lock: {format, assets[]} with fixed versions, content
    // hashes, install paths, files and the full dependency closure.
    assert_eq!(plan["lock"]["format"], "craftmine.assets-lock/1");
    assert_eq!(plan["assetLockHash"].as_str().unwrap().len(), 64);
    let assets = plan["lock"]["assets"].as_array().unwrap();
    assert_eq!(assets.len(), 2);
    assert_eq!(assets[0]["asset"]["assetId"], "recipe");
    assert_eq!(assets[0]["asset"]["version"], "1");
    assert_eq!(assets[0]["installPath"], "addons/recipe");
    assert_eq!(assets[0]["asset"]["contentHash"].as_str().unwrap().len(), 64);
    assert_eq!(assets[0]["dependencies"][0]["assetId"], "stone");
    assert_eq!(assets[0]["dependencies"][0]["version"], "1");
    assert_eq!(assets[0]["files"][0]["path"], "payload/recipe.bin");
    assert_eq!(assets[0]["files"][0]["mediaType"], "application/octet-stream");
    assert_eq!(assets[1]["asset"]["assetId"], "stone");
    assert_eq!(assets[1]["dependencies"].as_array().unwrap().len(), 0);
    assert_eq!(plan["applied"], false);
    let instances = plan["instances"].as_array().unwrap();
    assert_eq!(instances.len(), 2);
    assert_ne!(instances[0]["instanceId"], instances[1]["instanceId"]);
    let recipe_instance = instances
        .iter()
        .find(|item| item["assetId"] == "recipe")
        .unwrap();
    let map = recipe_instance["entityMap"].as_object().unwrap();
    assert_eq!(map.len(), 1);
    assert!(map["table"].as_str().unwrap().starts_with("ins-"));
    assert_eq!(recipe_instance["installPath"], "addons/recipe");

    // Same operation replays the same identity; another operation does not.
    let replay = db
        .package_plan_install(&json!({"operationId": "install-1",
            "resources": [recipe.clone(), stone.clone()], "target": target(inventory()),
            "options": {"allowInputActionRemap": false}}))
        .unwrap();
    assert_eq!(replay["instances"], plan["instances"]);
    assert_eq!(replay["lock"], plan["lock"]);
    assert_eq!(replay["assetLockHash"], plan["assetLockHash"]);
    let other = db
        .package_plan_install(&json!({"operationId": "install-2",
            "resources": [recipe, stone], "target": target(inventory()),
            "options": {"allowInputActionRemap": false}}))
        .unwrap();
    assert_ne!(other["instances"][0]["instanceId"], plan["instances"][0]["instanceId"]);
}

/// The plan's lock is the same document `package.formatCheck` validates, so the
/// installer can never emit a lock the package layer refuses.
#[test]
fn the_plan_lock_is_accepted_by_the_package_validator() {
    let (_dir, db) = journal();
    let stone = manifest("stone", 1, "raw", json!([]), json!({}), json!([]), json!({}));
    let plan = db
        .package_plan_install(&json!({"operationId": "install-1", "resources": [stone],
            "target": target(inventory()), "options": {"allowInputActionRemap": false}}))
        .unwrap();
    let checked = db
        .package_format_check(&json!({"lock": plan["lock"]}))
        .unwrap();
    assert_eq!(checked["lock"], "ok");
    assert_eq!(checked["lockFormat"], "craftmine.assets-lock/1");
    assert_eq!(checked["assetLockHash"], plan["assetLockHash"]);
    assert_eq!(checked["assets"], 1);
    // The legacy shape is refused with a migration hint instead of being
    // reinterpreted as this lock.
    let legacy = db
        .package_format_check(&json!({"lock": {"format": "craftmine.assets-lock/1",
            "direct": [{"id": "stone", "version": 1}], "closure": [], "graph": {}}}))
        .unwrap_err()
        .to_string();
    assert!(legacy.contains("ASSET_LOCK_LEGACY_SHAPE"), "{legacy}");
}

/// Regenerates the fixture the JavaScript draft installer consumes, so the
/// plan the Rust core actually emits is exercised by the Node layer:
///
///   cargo test -p craftmine-core --lib \
///     library::installer::tests::print_install_plan_fixture -- --ignored --nocapture
#[test]
#[ignore = "regenerates tests/godot-round3/S3/vectors/install-plan-fixture.json"]
fn print_install_plan_fixture() {
    let (_dir, db) = journal();
    let stone_bytes = "stone-payload";
    let stone_hash = digest(stone_bytes);
    let stone_content = json!({"assetId": "stone", "version": 1, "kind": "raw",
        "files": [{"path": "payload/stone.bin", "bytes": stone_bytes.len(),
            "sha256": stone_hash}],        "dependencies": [], "entry": {}, "interfaces": {}, "compatibility": {},
        "state": {}, "licenses": {}});
    let stone = json!({"format": format::RESOURCE_FORMAT, "content": stone_content,
        "contentHash": format::content_hash(&stone_content).unwrap()});
    let recipe_content = json!({"assetId": "recipe", "version": 1, "kind": "data",
        "files": [{"path": "data/recipes.json", "bytes": 2, "sha256": digest("{}")}],
        "dependencies": [{"id": "stone", "version": 1,
            "sha256": stone["contentHash"]}],
        "entry": {"entities": ["forge"]}, "interfaces": {}, "compatibility": {},
        "state": {}, "licenses": {}});
    let recipe = json!({"format": format::RESOURCE_FORMAT, "content": recipe_content,
        "contentHash": format::content_hash(&recipe_content).unwrap()});
    let plan = db
        .package_plan_install(&json!({"operationId": "install-fixture-1",
            "resources": [recipe, stone], "target": target(inventory()),
            "options": {"allowInputActionRemap": false}}))
        .unwrap();
    let fixture = json!({"format": "craftmine.install-plan-fixture/1",
        "generatedBy": "cargo test -p craftmine-core --lib library::installer::tests::print_install_plan_fixture -- --ignored --nocapture",
        "owner": "S3", "plan": plan,
        "payload": [
            {"contentHash": stone["contentHash"], "path": "payload/stone.bin",
             "text": stone_bytes},
            {"contentHash": recipe["contentHash"], "path": "data/recipes.json",
             "text": "{}"}
        ]});
    println!("PLAN_FIXTURE_BEGIN");
    println!("{}", serde_json::to_string_pretty(&fixture).unwrap());
    println!("PLAN_FIXTURE_END");
}

#[test]
fn a_dependency_with_the_wrong_hash_is_refused() {
    let (_dir, db) = journal();
    let stone = manifest("stone", 1, "raw", json!([]), json!({}), json!([]), json!({}));
    let wrong = json!({"id": "stone", "version": 1, "sha256": "b".repeat(64)});
    let recipe = manifest("recipe", 1, "data", json!([wrong]), json!({}), json!([]), json!({}));
    let error = db
        .package_plan_install(&json!({"operationId": "install-1", "resources": [recipe, stone],
            "target": target(inventory()), "options": {"allowInputActionRemap": false}}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PACKAGE_DEPENDENCY_HASH_MISMATCH: stone@1"), "{error}");
}

#[test]
fn missing_dependency_and_cycle_are_refused_without_a_plan() {
    let (_dir, db) = journal();
    let lonely = manifest(
        "recipe",
        1,
        "data",
        json!([{"id": "stone", "version": 1, "sha256": "a".repeat(64)}]),
        json!({}),
        json!([]),
        json!({}),
    );
    let error = db
        .package_plan_install(&json!({"operationId": "install-1",
            "resources": [lonely], "target": target(inventory()),
            "options": {"allowInputActionRemap": false}}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PACKAGE_MISSING_DEPENDENCY: stone@1"), "{error}");

    // A cycle is reported as a cycle even though the declared hashes cannot be
    // consistent with each other.
    let a = manifest("a", 1, "module",
        json!([{"id": "b", "version": 1, "sha256": "a".repeat(64)}]), json!({}), json!([]), json!({}));
    let b = manifest("b", 1, "module",
        json!([{"id": "a", "version": 1, "sha256": "a".repeat(64)}]), json!({}), json!([]), json!({}));
    let error = db
        .package_plan_install(&json!({"operationId": "install-2", "resources": [a, b],
            "target": target(inventory()), "options": {"allowInputActionRemap": false}}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PACKAGE_DEPENDENCY_CYCLE"), "{error}");
}

#[test]
fn conflicts_are_reported_and_never_silently_overwritten() {
    let (_dir, db) = journal();
    let door = manifest(
        "door",
        1,
        "object",
        json!([]),
        json!({"inputActions": ["interact"], "globalClasses": ["Door"],
            "autoloads": ["DoorBus"], "uids": ["uid://door"], "paths": ["res://door.gd"],
            "entityIds": ["door"]}),
        json!(["door"]),
        json!({"base": "top-down", "engine": "4.7.2-stable",
            "stateFormat": "craftmine.godot-progress/1"}),
    );
    let busy = json!({"inputActions": ["interact"], "autoloads": ["DoorBus"],
        "globalClasses": ["Door"], "uids": ["uid://door"], "paths": ["res://door.gd"],
        "entityIds": ["door"]});
    let plan = db
        .package_plan_install(&json!({"operationId": "install-1", "resources": [door.clone()],
            "target": target(busy.clone()), "options": {"allowInputActionRemap": false}}))
        .unwrap();
    assert_eq!(plan["ok"], false);
    let codes = plan["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["code"].as_str().unwrap().to_owned())
        .collect::<BTreeSet<_>>();
    for code in [
        "PACKAGE_CONFLICT_INPUT_ACTION",
        "PACKAGE_CONFLICT_AUTOLOAD",
        "PACKAGE_CONFLICT_GLOBAL_CLASS",
        "PACKAGE_CONFLICT_UID",
        "PACKAGE_CONFLICT_PATH",
        "PACKAGE_CONFLICT_ENTITY_ID",
    ] {
        assert!(codes.contains(code), "{code} missing from {codes:?}");
    }

    // Only the input action may be remapped, and only when explicitly allowed.
    let plan = db
        .package_plan_install(&json!({"operationId": "install-1", "resources": [door],
            "target": target(busy), "options": {"allowInputActionRemap": true}}))
        .unwrap();
    assert_eq!(plan["ok"], false);
    assert_eq!(plan["remappedInputActions"].as_array().unwrap().len(), 1);
    assert!(plan["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["code"] != "PACKAGE_CONFLICT_INPUT_ACTION"));
}

#[test]
fn incompatible_base_is_reported_as_a_conflict() {
    let (_dir, db) = journal();
    let module = manifest(
        "mining",
        1,
        "module",
        json!([]),
        json!({}),
        json!([]),
        json!({"base": "side-scroll", "engine": "4.7.2-stable",
            "stateFormat": "craftmine.godot-progress/1"}),
    );
    let plan = db
        .package_plan_install(&json!({"operationId": "install-1", "resources": [module],
            "target": target(inventory()), "options": {"allowInputActionRemap": false}}))
        .unwrap();
    assert_eq!(plan["ok"], false);
    assert_eq!(plan["conflicts"][0]["code"], "PACKAGE_INCOMPATIBLE_BASE");
}
