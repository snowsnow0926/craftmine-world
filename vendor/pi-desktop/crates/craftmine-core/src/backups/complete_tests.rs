use super::*;
use crate::worlds::WorldDocument;
use std::fs;

fn world(id: &str) -> WorldDocument {
    WorldDocument {
        build: json!({"id":"build-a",
            "scene":{"format":"craftmine.godot-scene/1","baseId":"top-down"},
            "godot":{"engineVersion":"4.7.2-stable","renderer":"compatibility","target":"web"}}),
        snapshot: json!({"format":"craftmine.godot-progress/1","worldId":id,"baseId":"top-down",
            "baseVersion":"1.0.0","stateVersion":1,"body":{}}),
        extensions: vec![],
    }
}

fn fixture() -> (tempfile::TempDir, TaskJournal) {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("legacy");
    fs::create_dir_all(source.join("builds/v-0123456789abcdef0123")).unwrap();
    fs::write(
        source.join("project.json"),
        r#"{"format":"craftmine.project/1","current":"v-0123456789abcdef0123",
        "snapshot":{"format":"craftmine.progress/1","player":{"x":0.5,"y":6,"z":12.5,"yaw":0,"pitch":0}},
        "assets":[],"extensions":[]}"#,
    )
    .unwrap();
    fs::write(
        source.join("builds/v-0123456789abcdef0123/build.json"),
        r#"{"hash":"0123456789abcdef0123","scene":{"format":"craftmine.scene/3","objects":[],
        "systems":[],"behaviors":[]}}"#,
    )
    .unwrap();
    let mut db = TaskJournal::open(&dir.path().join("desktop/domain.sqlite")).unwrap();
    db.world_create("world", "World", &world("world")).unwrap();
    db.legacy_capture("import", &source).unwrap();
    (dir, db)
}

fn rehash(mut archive: Value) -> Value {
    archive.as_object_mut().unwrap().remove("hash");
    let hash = crate::digest(&serde_json::to_string(&archive).unwrap());
    archive["hash"] = json!(hash);
    archive
}

#[test]
fn complete_backup_separates_caches_and_verifies_every_content_file() {
    let (_dir, mut db) = fixture();
    let exported = db
        .backup_export_full(&json!({"operationId": "full"}))
        .unwrap();
    assert_eq!(exported["credentialsIncluded"], false);
    assert_eq!(exported["sessionIncluded"], false);
    assert_eq!(exported["rebuildableExcluded"].as_array().unwrap().len(), 3);
    let archive = exported["archive"].clone();
    assert_eq!(archive["format"], FORMAT);
    // Rebuildable caches are named, never shipped.
    for entry in archive["rebuildable"].as_array().unwrap() {
        assert_eq!(entry["excluded"], true);
        assert!(entry["reason"].as_str().unwrap().len() > 10);
    }
    let files = archive["content"]["legacyImports"][0]["files"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(files, 2);

    let report = db.backup_verify(&json!({"archive": archive})).unwrap();
    assert_eq!(report["valid"], true);
    assert_eq!(report["verified"], 2);
    assert!(report["missing"].as_array().unwrap().is_empty());
    assert!(report["rebuildable"].as_array().unwrap().len() == 3);

    // A changed archive is refused before anything is read from disk.
    let mut tampered = archive.clone();
    tampered["createdAt"] = json!(0);
    assert!(db
        .backup_verify(&json!({"archive": tampered}))
        .unwrap_err()
        .to_string()
        .contains("BACKUP_HASH_MISMATCH"));

    // An escaping path is reported instead of being followed.
    let mut escaped = archive.clone();
    escaped["content"]["legacyImports"][0]["files"][0]["path"] = json!("../escape.json");
    let report = db
        .backup_verify(&json!({"archive": rehash(escaped)}))
        .unwrap();
    assert_eq!(report["valid"], false);
    assert_eq!(report["pathEscapes"].as_array().unwrap().len(), 1);

    // A deleted file is missing; a rewritten file is a hash mismatch. Both
    // block the restore and leave the current domain untouched.
    let project = db
        .directory
        .join("legacy-imports/import/source/project.json");
    let bytes = fs::read(&project).unwrap();
    fs::remove_file(&project).unwrap();
    let report = db.backup_verify(&json!({"archive": archive})).unwrap();
    assert_eq!(report["valid"], false);
    assert_eq!(report["missing"].as_array().unwrap().len(), 1);
    let current = db.backup_status(&json!({})).unwrap()["currentHash"].clone();
    let error = db
        .backup_restore_full(&json!({"operationId": "restore", "archive": archive,
            "expectedCurrentHash": current}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("BACKUP_CONTENT_INCOMPLETE"), "{error}");
    assert_eq!(db.backup_status(&json!({})).unwrap()["currentHash"], current);

    fs::write(&project, b"{}").unwrap();
    let report = db.backup_verify(&json!({"archive": archive})).unwrap();
    assert_eq!(report["valid"], false);
    assert_eq!(report["mismatched"].as_array().unwrap().len(), 1);

    // Restoring the exact bytes makes the same archive usable again.
    fs::write(&project, &bytes).unwrap();
    let report = db.backup_verify(&json!({"archive": archive})).unwrap();
    assert_eq!(report["valid"], true);
    let restored = db
        .backup_restore_full(&json!({"operationId": "restore", "archive": archive,
            "expectedCurrentHash": current}))
        .unwrap();
    assert_eq!(restored["contentVerified"], true);
    assert_eq!(restored["restore"]["status"], "completed");
    assert_eq!(db.world_list().unwrap().len(), 1);
    assert_eq!(
        db.backup_content_usage(&json!({})).unwrap()["legacyImports"],
        1
    );
}

#[test]
fn a_package_whose_library_content_disappeared_is_reported_as_missing() {
    let (_dir, mut db) = fixture();
    let payload = json!({"name": "gate"});
    let module_hash = crate::digest(
        &serde_json::to_string(&json!({"kind":"component","payload":payload})).unwrap(),
    );
    let bundle = json!({"format":"craftmine.library-bundle/1","module":{"format":"craftmine.module/1",
        "runtime":"craftmine-web/1","id":"gate","version":1,"kind":"component","hash":module_hash,
        "name":"gate","description":"","dependencies":[],"payload":payload,
        "origin":{"build":"build-a","definition":"gate","time":0}},"assets":[],"extensions":[]});
    let body = serde_json::to_string(&bundle).unwrap();
    db.db
        .execute(
            "INSERT INTO craftmine_library(id,version,hash,kind,name,description,project_id,
             world_scope,bundle,bundle_hash,metadata,created_at)
             VALUES('gate',1,?1,'component','gate','','project',NULL,?2,?3,'{}',1)",
            rusqlite::params![module_hash, body, crate::digest(&body)],
        )
        .unwrap();
    db.package_register(&json!({"operationId":"reg","ref":{"id":"gate","version":1,
        "hash":module_hash},"kind":"component","name":"gate","description":"",
        "stateVersion":1,"compatibility":{"base":"top-down","baseVersion":"1.0.0",
        "engine":"4.7.2-stable","stateFormat":"craftmine.godot-progress/1",
        "sceneFormat":"craftmine.godot-scene/1"},"dependencies":[],
        "parts":{"scene":[],"source":[],"assets":[],"components":[]}}))
        .unwrap();
    let archive = db
        .backup_export_full(&json!({"operationId": "full"}))
        .unwrap()["archive"]
        .clone();
    assert_eq!(
        db.backup_verify(&json!({"archive": archive})).unwrap()["valid"],
        true
    );
    // Removing the immutable content makes the package unresolvable.
    db.db
        .execute("DELETE FROM craftmine_library WHERE id='gate'", [])
        .unwrap();
    let report = db.backup_verify(&json!({"archive": archive})).unwrap();
    assert_eq!(report["valid"], false);
    assert_eq!(report["missing"][0]["path"], "package/gate@1");
}
