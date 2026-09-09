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

fn dependency(id: &str, version: u64) -> Value {
    json!({"id": id, "version": version, "sha256": "a".repeat(64)})
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
        json!([dependency("stone", 1)]),
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
    assert_eq!(plan["lock"]["direct"], json!(["recipe@1"]));
    assert_eq!(plan["lock"]["closure"].as_array().unwrap().len(), 2);
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

    // Same operation replays the same identity; another operation does not.
    let replay = db
        .package_plan_install(&json!({"operationId": "install-1",
            "resources": [recipe.clone(), stone.clone()], "target": target(inventory()),
            "options": {"allowInputActionRemap": false}}))
        .unwrap();
    assert_eq!(replay["instances"], plan["instances"]);
    let other = db
        .package_plan_install(&json!({"operationId": "install-2",
            "resources": [recipe, stone], "target": target(inventory()),
            "options": {"allowInputActionRemap": false}}))
        .unwrap();
    assert_ne!(other["instances"][0]["instanceId"], plan["instances"][0]["instanceId"]);
}

#[test]
fn missing_dependency_and_cycle_are_refused_without_a_plan() {
    let (_dir, db) = journal();
    let lonely = manifest(
        "recipe",
        1,
        "data",
        json!([dependency("stone", 1)]),
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

    let a = manifest("a", 1, "module", json!([dependency("b", 1)]), json!({}), json!([]), json!({}));
    let b = manifest("b", 1, "module", json!([dependency("a", 1)]), json!({}), json!([]), json!({}));
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
