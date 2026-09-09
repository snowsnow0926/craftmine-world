use super::*;
use std::fs;

fn fixture() -> (tempfile::TempDir, std::path::PathBuf, TaskJournal) {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("legacy");
    fs::create_dir_all(source.join("builds/v-0123456789abcdef0123")).unwrap();
    fs::create_dir_all(source.join("assets/stone/1")).unwrap();
    fs::write(
        source.join("project.json"),
        r#"{"format":"craftmine.project/1","current":"v-0123456789abcdef0123",
        "snapshot":{"format":"craftmine.progress/1","player":{"x":0.5,"y":6,"z":12.5,"yaw":0,"pitch":0}},
        "assets":[{"id":"stone","versions":[{"version":1,"hash":"aa"}]}],"extensions":[]}"#,
    )
    .unwrap();
    fs::write(
        source.join("builds/v-0123456789abcdef0123/build.json"),
        r#"{"hash":"0123456789abcdef0123","scene":{"format":"craftmine.scene/3","title":"Old",
        "objects":[{"id":"floor","name":"Floor","position":{"x":0,"y":0,"z":0},
        "parts":[{"id":"p","offset":{"x":0,"y":0,"z":0},"size":{"x":4,"y":1,"z":4},"solid":true}],
        "components":{},"appearance":{}}],
        "systems":[],"behaviors":[{"id":"door-logic","name":"Door","code":"function tick(){}"}]}}"#,
    )
    .unwrap();
    fs::write(source.join("assets/stone/1.json"), r#"{"id":"stone","format":"png"}"#).unwrap();
    let db = TaskJournal::open(&dir.path().join("desktop/domain.sqlite")).unwrap();
    (dir, source, db)
}

#[test]
fn conversion_writes_a_copy_and_reports_each_content_type() {
    let (dir, source, mut db) = fixture();
    db.legacy_capture("import", &source).unwrap();
    let before = fs::read(source.join("project.json")).unwrap();
    let converted = db
        .legacy_convert(&json!({"operationId": "convert", "importId": "import",
            "title": "Old world copy"}))
        .unwrap();
    let world_id = converted["worldId"].as_str().unwrap();
    assert!(world_id.starts_with("legacy-"));
    assert_eq!(converted["sourceUnchanged"], true);
    assert_eq!(converted["keptOnLegacyBase"], true);
    assert_eq!(fs::read(source.join("project.json")).unwrap(), before);

    let report = &converted["report"];
    let codes = |key: &str| {
        report[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["code"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    assert!(codes("supported").contains(&"geometry".to_owned()));
    assert!(codes("supported").contains(&"asset".to_owned()));
    assert!(codes("unsupported").contains(&"legacy-gameplay".to_owned()));
    assert!(codes("needsReview").contains(&"ownership".to_owned()));

    // The copy is an independent world; the sealed import stays unlinked to it.
    let world = db.world_read(world_id).unwrap();
    assert_eq!(world.world.snapshot["format"], "craftmine.progress/1");
    assert_eq!(db.world_list().unwrap().len(), 1);

    // Replay returns the same receipt; a new operation refuses to duplicate.
    let replay = db
        .legacy_convert(&json!({"operationId": "convert", "importId": "import",
            "title": "Old world copy"}))
        .unwrap();
    assert_eq!(replay, converted);
    let error = db
        .legacy_convert(&json!({"operationId": "convert-2", "importId": "import",
            "title": "Old world copy"}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("LEGACY_COPY_EXISTS"), "{error}");
    drop(db);
    drop(dir);
}

#[test]
fn compiled_conversion_and_corrupt_archive_are_reported_without_changing_the_source() {
    let (dir, source, mut db) = fixture();
    db.legacy_capture("import", &source).unwrap();
    let compiled = json!({
        "build": {"id":"build-new","scene":{"format":"craftmine.scene/3","objects":[]}},
        "snapshot": {"format":"craftmine.progress/1",
            "player":{"x":0.5,"y":6,"z":12.5,"yaw":0,"pitch":0}},
        "extensions": []
    });
    let converted = db
        .legacy_convert(&json!({"operationId": "convert", "importId": "import",
            "title": "Converted", "compiled": compiled}))
        .unwrap();
    assert_eq!(converted["keptOnLegacyBase"], false);
    assert_eq!(converted["report"]["converted"], true);
    assert_eq!(
        db.world_read(converted["worldId"].as_str().unwrap())
            .unwrap()
            .world
            .build["id"],
        "build-new"
    );

    // A tampered archive fails before any world is created.
    fs::write(
        db_archive(&db, "import").join("source/project.json"),
        "{}",
    )
    .unwrap();
    let before = db.world_list().unwrap().len();
    let error = db
        .legacy_convert(&json!({"operationId": "convert-2", "importId": "import",
            "title": "Broken"}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("CORRUPT_LEGACY_ARCHIVE"), "{error}");
    assert_eq!(db.world_list().unwrap().len(), before);
    drop(db);
    drop(dir);
}

fn db_archive(db: &TaskJournal, id: &str) -> std::path::PathBuf {
    db.directory.join("legacy-imports").join(id)
}
