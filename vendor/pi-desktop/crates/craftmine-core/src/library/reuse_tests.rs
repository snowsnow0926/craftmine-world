use super::*;
use crate::worlds::WorldDocument;
use rusqlite::params;

fn world(id: &str, base: &str, base_version: &str) -> WorldDocument {
    WorldDocument {
        build: json!({"id":"build-a",
            "scene":{"format":"craftmine.godot-scene/1","baseId":base},
            "godot":{"engineVersion":"4.7.2-stable","renderer":"compatibility","target":"web"}}),
        snapshot: json!({"format":"craftmine.godot-progress/1","worldId":id,"baseId":base,
            "baseVersion":base_version,"stateVersion":1,"body":{}}),
        extensions: vec![],
    }
}

fn journal() -> (tempfile::TempDir, TaskJournal) {
    let dir = tempfile::tempdir().unwrap();
    let db = TaskJournal::open(&dir.path().join("domain.sqlite")).unwrap();
    (dir, db)
}

/// Seeds immutable library content the way `library.capture` would, so package
/// registration has real content to reference.
fn seed(db: &TaskJournal, id: &str, version: u64, kind: &str) -> Value {
    let payload = json!({"name": id});
    let module_hash =
        digest(&serde_json::to_string(&json!({"kind": kind, "payload": payload})).unwrap());
    let module = json!({"format":"craftmine.module/1","runtime":"craftmine-web/1","id":id,
        "version":version,"kind":kind,"hash":module_hash,"name":id,"description":"",
        "dependencies":[],"payload":payload,
        "origin":{"build":"build-a","definition":id,"time":0}});
    let bundle = json!({"format":"craftmine.library-bundle/1","module":module,
        "assets":[],"extensions":[]});
    let body = serde_json::to_string(&bundle).unwrap();
    db.db
        .execute(
            "INSERT INTO craftmine_library(id,version,hash,kind,name,description,project_id,
             world_scope,bundle,bundle_hash,metadata,created_at)
             VALUES(?1,?2,?3,?4,?5,'','project',NULL,?6,?7,'{}',1)",
            params![id, version as i64, module_hash, kind, id, body, digest(&body)],
        )
        .unwrap();
    json!({"id": id, "version": version, "hash": module_hash})
}

fn register(
    db: &mut TaskJournal,
    operation: &str,
    reference: &Value,
    kind: &str,
    state_version: u64,
    dependencies: Value,
    migration: Value,
) -> Result<Value> {
    db.package_register(&json!({
        "operationId": operation,
        "ref": reference,
        "kind": kind,
        "name": format!("{}", reference["id"]),
        "description": "test package",
        "stateVersion": state_version,
        "compatibility": {"base":"top-down","baseVersion":"1.0.0","engine":"4.7.2-stable",
            "stateFormat":"craftmine.godot-progress/1","sceneFormat":"craftmine.godot-scene/1"},
        "dependencies": dependencies,
        "parts": {"scene":[],"source":[],"assets":[],"components":[]},
        "initialState": packages::default_state(state_version),
        "migration": migration
    }))
}

fn install(db: &mut TaskJournal, operation: &str, reference: &Value, world_id: &str) -> Value {
    db.package_install(&json!({"operationId": operation, "ref": reference, "worldId": world_id,
        "mode": "initial"}))
    .unwrap()
}

fn state_with(db: &TaskJournal, instance: &str) -> Value {
    db.package_read(&json!({"instanceId": instance})).unwrap()["state"].clone()
}

fn revision(db: &TaskJournal, instance: &str) -> u64 {
    db.package_read(&json!({"instanceId": instance})).unwrap()["revision"]
        .as_u64()
        .unwrap()
}

fn target(base: &str) -> Value {
    json!({"base": base, "baseVersion": "1.0.0", "engine": "4.7.2-stable",
        "stateFormat": "craftmine.godot-progress/1"})
}

#[test]
fn fixed_version_closure_and_explicit_failures() {
    let (_dir, mut db) = journal();
    let dep = seed(&db, "gate-kit", 1, "component");
    let root = seed(&db, "door", 1, "creation");
    let newer = seed(&db, "door", 2, "creation");
    register(
        &mut db,
        "reg-dep",
        &dep,
        "component",
        1,
        json!([]),
        json!({"from":[]}),
    )
    .unwrap();
    register(
        &mut db,
        "reg-root",
        &root,
        "creation",
        1,
        json!([{"id":dep["id"],"version":dep["version"],"hash":dep["hash"],"optional":false}]),
        json!({"from":[]}),
    )
    .unwrap();
    register(
        &mut db,
        "reg-newer",
        &newer,
        "creation",
        1,
        json!([]),
        json!({"from":[]}),
    )
    .unwrap();
    db.world_create("world", "World", &world("world", "top-down", "1.0.0"))
        .unwrap();

    // Exact version: asking for v1 never resolves v2.
    let receipt = install(&mut db, "install-v1", &root, "world");
    assert_eq!(receipt["ref"]["version"], 1);
    assert_eq!(receipt["closure"].as_array().unwrap().len(), 2);
    assert_eq!(receipt["credentialsIncluded"], false);
    assert_eq!(receipt["sessionIncluded"], false);

    // A missing dependency is refused at install time, not silently skipped.
    let missing = seed(&db, "missing-dep", 1, "component");
    let bad = seed(&db, "needs-missing", 1, "creation");
    register(
        &mut db,
        "reg-missing",
        &bad,
        "creation",
        1,
        json!([{"id":missing["id"],"version":1,"hash":missing["hash"],"optional":false}]),
        json!({"from":[]}),
    )
    .unwrap();
    let error = db
        .package_install(&json!({"operationId":"install-missing","ref":bad,"worldId":"world",
            "mode":"initial"}))
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("PACKAGE_DEPENDENCY_MISSING: missing-dep@1"),
        "{error}"
    );

    // A cycle is detected by the closure walk, not by registration order.
    let cycle_a = seed(&db, "cycle-a", 1, "component");
    let cycle_b = seed(&db, "cycle-b", 1, "component");
    register(
        &mut db,
        "reg-cycle-a",
        &cycle_a,
        "component",
        1,
        json!([{"id":cycle_b["id"],"version":1,"hash":cycle_b["hash"],"optional":false}]),
        json!({"from":[]}),
    )
    .unwrap();
    register(
        &mut db,
        "reg-cycle-b",
        &cycle_b,
        "component",
        1,
        json!([{"id":cycle_a["id"],"version":1,"hash":cycle_a["hash"],"optional":false}]),
        json!({"from":[]}),
    )
    .unwrap();
    let error = db
        .package_check(&json!({"ref": cycle_a, "target": target("top-down")}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PACKAGE_DEPENDENCY_CYCLE"), "{error}");

    let unknown = json!({"id":"door","version":9,"hash":root["hash"]});
    let error = db
        .package_install(&json!({"operationId":"install-v9","ref":unknown,"worldId":"world",
            "mode":"initial"}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PACKAGE_VERSION_NOT_FOUND: door@9"), "{error}");

    let check = db
        .package_check(&json!({"ref": root, "target": target("side-scroll")}))
        .unwrap();
    assert_eq!(check["compatible"], false);
    assert_eq!(check["reasons"][0]["code"], "PACKAGE_INCOMPATIBLE_BASE");
    db.world_create("scroll", "Scroll", &world("scroll", "side-scroll", "1.0.0"))
        .unwrap();
    let error = db
        .package_install(&json!({"operationId":"install-wrong-base","ref":root,
            "worldId":"scroll","mode":"initial"}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PACKAGE_INCOMPATIBLE_BASE"), "{error}");
}

#[test]
fn two_worlds_reuse_the_same_version_with_independent_identity_and_progress() {
    let (_dir, mut db) = journal();
    let reference = seed(&db, "shop", 1, "creation");
    register(
        &mut db,
        "reg",
        &reference,
        "creation",
        1,
        json!([]),
        json!({"from":[]}),
    )
    .unwrap();
    db.world_create("first", "First", &world("first", "top-down", "1.0.0"))
        .unwrap();
    db.world_create("second", "Second", &world("second", "top-down", "1.0.0"))
        .unwrap();

    let one = install(&mut db, "install-first", &reference, "first");
    let two = install(&mut db, "install-second", &reference, "second");
    assert_ne!(one["instanceId"], two["instanceId"]);
    assert_eq!(one["ref"], two["ref"]);
    assert!(one["origin"].is_null());

    let mut state = state_with(&db, one["instanceId"].as_str().unwrap());
    state["fields"]["gold"] = json!(42);
    db.package_progress(&json!({"operationId":"progress-first",
        "instanceId": one["instanceId"], "revision": 0, "state": state}))
        .unwrap();

    // The second world keeps its own progress untouched.
    let untouched = state_with(&db, two["instanceId"].as_str().unwrap());
    assert!(untouched["fields"].get("gold").is_none());
    assert_ne!(
        db.package_read(&json!({"instanceId": one["instanceId"]})).unwrap()["stateHash"],
        db.package_read(&json!({"instanceId": two["instanceId"]})).unwrap()["stateHash"]
    );

    let usage = db.package_usage(&json!({"ref": reference})).unwrap();
    assert_eq!(usage["count"], 2);
    assert_eq!(usage["removable"], false);
    assert_eq!(
        crate::library::reuse::instance_world_pairs(&db.db)
            .unwrap()
            .len(),
        2
    );

    // Copy mode derives a new identity from another instance's state.
    let copied = db
        .package_install(&json!({"operationId":"install-copy","ref":reference,"worldId":"second",
            "mode":"copy","sourceInstanceId": one["instanceId"]}))
        .unwrap();
    assert_ne!(copied["instanceId"], one["instanceId"]);
    assert_eq!(copied["origin"]["instanceId"], one["instanceId"]);
    assert_eq!(copied["origin"]["worldId"], "first");
    assert_eq!(
        state_with(&db, copied["instanceId"].as_str().unwrap())["fields"]["gold"],
        42
    );
}

#[test]
fn upgrade_is_declarative_and_never_drops_progress_or_repeats_rewards() {
    let (_dir, mut db) = journal();
    let one = seed(&db, "quest-hall", 1, "creation");
    let two = seed(&db, "quest-hall", 2, "creation");
    let three = seed(&db, "quest-hall", 3, "creation");
    register(
        &mut db,
        "reg-1",
        &one,
        "creation",
        1,
        json!([]),
        json!({"from":[]}),
    )
    .unwrap();
    register(
        &mut db,
        "reg-2",
        &two,
        "creation",
        2,
        json!([]),
        json!({"from":[{"stateVersion":1,"operations":[
            {"op":"rename","target":"object","from":"old-gate","to":"new-gate"},
            {"op":"addField","id":"visits","value":0},
            {"op":"preserve","path":"once"}]}]}),
    )
    .unwrap();
    register(
        &mut db,
        "reg-3",
        &three,
        "creation",
        3,
        json!([]),
        json!({"from":[{"stateVersion":2,"operations":[
            {"op":"removeField","id":"visits","expected":0}]}]}),
    )
    .unwrap();
    db.world_create("world", "World", &world("world", "top-down", "1.0.0"))
        .unwrap();
    let instance = install(&mut db, "install", &one, "world");
    let id = instance["instanceId"].as_str().unwrap();

    let mut state = state_with(&db, id);
    state["entities"]["objects"]["old-gate"] = json!({"open": false});
    state["fields"]["gold"] = json!(7);
    db.package_progress(&json!({"operationId":"progress","instanceId":id,
        "revision": revision(&db, id), "state": state}))
        .unwrap();
    let first = db
        .package_grant(&json!({"operationId":"grant-1","instanceId":id,"key":"quest-hall-clear",
            "reward":{"gold":100}}))
        .unwrap();
    assert_eq!(first["granted"], true);

    let upgraded = db
        .package_upgrade(&json!({"operationId":"upgrade-2","instanceId":id,"toRef":two}))
        .unwrap();
    assert_eq!(upgraded["toStateVersion"], 2);
    assert_eq!(upgraded["preservedOnce"], json!(["quest-hall-clear"]));
    let state = state_with(&db, id);
    assert!(state["entities"]["objects"]["new-gate"].is_object());
    assert!(state["entities"]["objects"].get("old-gate").is_none());
    assert_eq!(state["fields"]["gold"], 7);
    assert_eq!(state["fields"]["visits"], 0);

    let again = db
        .package_grant(&json!({"operationId":"grant-2","instanceId":id,"key":"quest-hall-clear",
            "reward":{"gold":100}}))
        .unwrap();
    assert_eq!(again["granted"], false);
    assert_eq!(state_with(&db, id)["fields"]["grants"]["quest-hall-clear"]["gold"], 100);

    // A migration that would discard live data is refused, and the instance
    // stays exactly at its previous version and state.
    let mut live = state_with(&db, id);
    live["fields"]["visits"] = json!(3);
    db.package_progress(&json!({"operationId":"progress-2","instanceId":id,
        "revision": revision(&db, id), "state": live}))
        .unwrap();
    let before = db.package_read(&json!({"instanceId": id})).unwrap();
    let error = db
        .package_upgrade(&json!({"operationId":"upgrade-3","instanceId":id,"toRef":three}))
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS: fields/visits"),
        "{error}"
    );
    let after = db.package_read(&json!({"instanceId": id})).unwrap();
    assert_eq!(after["ref"], before["ref"]);
    assert_eq!(after["stateHash"], before["stateHash"]);
    assert_eq!(after["revision"], before["revision"]);

    // Removing an already-default field is allowed and keeps everything else.
    let mut default = state_with(&db, id);
    default["fields"]["visits"] = json!(0);
    db.package_progress(&json!({"operationId":"progress-3","instanceId":id,
        "revision": revision(&db, id), "state": default}))
        .unwrap();
    let upgraded = db
        .package_upgrade(&json!({"operationId":"upgrade-3b","instanceId":id,"toRef":three}))
        .unwrap();
    assert_eq!(upgraded["toStateVersion"], 3);
    assert!(state_with(&db, id)["fields"].get("visits").is_none());

    // A missing migration path is an explicit failure, never a silent reset.
    let error = db
        .package_upgrade(&json!({"operationId":"upgrade-back","instanceId":id,"toRef":one}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PACKAGE_DOWNGRADE_UNSUPPORTED"), "{error}");
}

#[test]
fn uninstall_keeps_progress_and_restore_is_reversible() {
    let (_dir, mut db) = journal();
    let reference = seed(&db, "beacon", 1, "object");
    register(
        &mut db,
        "reg",
        &reference,
        "object",
        1,
        json!([]),
        json!({"from":[]}),
    )
    .unwrap();
    db.world_create("world", "World", &world("world", "top-down", "1.0.0"))
        .unwrap();
    let instance = install(&mut db, "install", &reference, "world");
    let id = instance["instanceId"].as_str().unwrap();
    let mut state = state_with(&db, id);
    state["fields"]["charges"] = json!(2);
    db.package_progress(&json!({"operationId":"progress","instanceId":id,"revision":0,"state":state}))
        .unwrap();
    let before = db.package_read(&json!({"instanceId": id})).unwrap();

    let removed = db
        .package_uninstall(&json!({"operationId":"uninstall","instanceId":id,
            "expectedRevision": revision(&db, id)}))
        .unwrap();
    assert_eq!(removed["status"], "uninstalled");
    assert_eq!(removed["restorable"], true);
    let error = db
        .package_progress(&json!({"operationId":"progress-2","instanceId":id,
            "revision": revision(&db, id), "state": state_with(&db, id)}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PACKAGE_INSTANCE_UNINSTALLED"), "{error}");

    let restored = db
        .package_restore(&json!({"operationId":"restore","instanceId":id}))
        .unwrap();
    assert_eq!(restored["status"], "installed");
    let after = db.package_read(&json!({"instanceId": id})).unwrap();
    assert_eq!(after["stateHash"], before["stateHash"]);
    assert_eq!(after["state"]["fields"]["charges"], 2);
}

#[test]
fn offline_package_round_trip_carries_no_credentials_or_progress() {
    let (dir, mut db) = journal();
    let reference = seed(&db, "lamps", 1, "object");
    register(
        &mut db,
        "reg",
        &reference,
        "object",
        1,
        json!([]),
        json!({"from":[]}),
    )
    .unwrap();
    db.world_create("world", "World", &world("world", "top-down", "1.0.0"))
        .unwrap();
    let instance = install(&mut db, "install", &reference, "world");
    let id = instance["instanceId"].as_str().unwrap();
    let mut state = state_with(&db, id);
    state["fields"]["lit"] = json!(true);
    db.package_progress(&json!({"operationId":"progress","instanceId":id,"revision":0,"state":state}))
        .unwrap();

    let exported = db
        .package_export(&json!({"operationId":"export","instanceId":id}))
        .unwrap();
    assert_eq!(exported["credentialsIncluded"], false);
    assert_eq!(exported["sessionIncluded"], false);
    assert_eq!(exported["progressIncluded"], false);
    let package = &exported["package"];
    assert!(package.get("state").is_none());
    assert_eq!(package["content"]["module"]["id"], "lamps");
    assert!(package["provenance"]["worldId"] == "world");

    // A fresh profile imports the fixed version and installs it again.
    let other_dir = tempfile::tempdir().unwrap();
    let mut other = TaskJournal::open(&other_dir.path().join("domain.sqlite")).unwrap();
    let imported = other
        .package_import(&json!({"operationId":"import","package":package}))
        .unwrap();
    assert_eq!(imported["ref"], reference);
    assert_eq!(imported["needsRevalidation"], true);
    other
        .world_create("world", "World", &world("world", "top-down", "1.0.0"))
        .unwrap();
    let reused = install(&mut other, "install", &reference, "world");
    assert_eq!(reused["ref"]["version"], 1);
    assert!(
        state_with(&other, reused["instanceId"].as_str().unwrap())["fields"]
            .get("lit")
            .is_none()
    );
    drop(other);
    drop(db);
    drop(dir);

    // Private fields are refused instead of being exported.
    let mut private = package.clone();
    private["content"]["module"]["sessionId"] = json!("abc");
    let (_third_dir, mut third) = journal();
    let error = third
        .package_import(&json!({"operationId":"import-private","package":private}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("PACKAGE_EXPORT_CONTAINS_PRIVATE_DATA"), "{error}");
}
