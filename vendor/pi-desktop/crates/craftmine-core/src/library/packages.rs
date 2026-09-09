//! Installable package registration: exact versions, exact dependency closure
//! and explicit compatibility. Nothing here resolves a moving "latest".
//!
//! Content stays in `craftmine_library`; this module only records the install
//! contract that references that immutable content.
use super::super::{
    digest,
    durable::{fields, text},
    worlds, TaskJournal,
};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const FORMAT: &str = "craftmine.package/1";
pub(super) const STATE_FORMAT: &str = "craftmine.package-state/1";
const MAX_DEPENDENCIES: usize = 64;
const MAX_PARTS: usize = 512;
const KINDS: &[&str] = &["creation", "object", "gameplay", "component", "scene"];
const ENTITY_KINDS: &[&str] = &["creation", "object", "gameplay"];

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_packages (
      id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL,
      library_id TEXT NOT NULL, library_version INTEGER NOT NULL, library_hash TEXT NOT NULL,
      kind TEXT NOT NULL, name TEXT NOT NULL, state_version INTEGER NOT NULL,
      manifest TEXT NOT NULL, manifest_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS craftmine_package_operations (
      operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL);",
    )?;
    Ok(())
}

pub(super) fn hash(value: &Value, key: &str) -> Result<String> {
    let raw = text(value, key, 64)?;
    ensure!(
        raw.len() == 64 && raw.bytes().all(|c| c.is_ascii_hexdigit()),
        "INVALID_HASH"
    );
    Ok(raw.to_ascii_lowercase())
}

fn part_path(value: &Value, key: &str) -> Result<String> {
    let path = text(value, key, 240)?;
    ensure!(
        !path.contains(['\\', ':'])
            && path
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".."),
        "INVALID_PACKAGE_PATH"
    );
    Ok(path.to_owned())
}

#[derive(Clone, Debug)]
pub(super) struct Dependency {
    pub id: String,
    pub version: u64,
    pub hash: String,
    pub optional: bool,
}

#[derive(Clone, Debug)]
pub(super) struct Target {
    pub base: String,
    pub base_version: String,
    pub engine: String,
    pub state_format: String,
    pub scene_format: Option<String>,
}

#[derive(Clone, Debug)]
pub(super) struct Manifest {
    pub id: String,
    pub version: u64,
    pub hash: String,
    pub kind: String,
    pub name: String,
    pub description: String,
    pub state_version: u64,
    pub base: String,
    pub base_version: String,
    pub engine: String,
    pub state_format: String,
    pub scene_format: String,
    pub dependencies: Vec<Dependency>,
    pub parts: Value,
    pub initial_state: Value,
    pub migration: Value,
    pub body: String,
    pub manifest_hash: String,
    pub manifest_value: Value,
}

impl Manifest {
    pub(super) fn reference(&self) -> Value {
        json!({"id": self.id, "version": self.version, "hash": self.hash})
    }

    pub(super) fn label(&self) -> String {
        format!("{}@{}", self.id, self.version)
    }

    fn parse_compatibility(value: &Value) -> Result<(String, String, String, String, String)> {
        fields(
            value,
            &["base", "baseVersion", "engine", "stateFormat", "sceneFormat"],
        )?;
        let base = text(value, "base", 80)?;
        worlds::validate_id(base)?;
        let base_version = text(value, "baseVersion", 80)?;
        ensure!(
            base_version
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_')),
            "INVALID_BASE_VERSION"
        );
        let engine = text(value, "engine", 80)?;
        let state_format = text(value, "stateFormat", 80)?;
        let scene_format = text(value, "sceneFormat", 80)?;
        Ok((
            base.to_owned(),
            base_version.to_owned(),
            engine.to_owned(),
            state_format.to_owned(),
            scene_format.to_owned(),
        ))
    }

    fn parse_dependencies(value: &Value) -> Result<Vec<Dependency>> {
        let items = value.as_array().context("DEPENDENCIES_REQUIRED")?;
        ensure!(items.len() <= MAX_DEPENDENCIES, "DEPENDENCY_LIMIT");
        let mut seen = BTreeSet::new();
        let mut parsed = Vec::new();
        for item in items {
            fields(item, &["id", "version", "hash", "optional"])?;
            let id = text(item, "id", 80)?.to_owned();
            worlds::validate_id(&id)?;
            let version = item["version"]
                .as_u64()
                .context("DEPENDENCY_VERSION_REQUIRED")?;
            ensure!(version > 0 && version <= 100000, "INVALID_VERSION");
            let optional = match item.get("optional") {
                None | Some(Value::Null) => false,
                Some(value) => value.as_bool().context("INVALID_OPTIONAL")?,
            };
            ensure!(
                seen.insert((id.clone(), version)),
                "DUPLICATE_DEPENDENCY: {}@{}",
                id,
                version
            );
            parsed.push(Dependency {
                id,
                version,
                hash: hash(item, "hash")?,
                optional,
            });
        }
        Ok(parsed)
    }

    fn parse_parts(value: &Value) -> Result<Value> {
        fields(value, &["scene", "source", "assets", "components"])?;
        let mut total = 0;
        let mut checked = Map::new();
        for group in ["scene", "source"] {
            let mut records = Vec::new();
            if let Some(items) = value.get(group) {
                for item in items.as_array().context("PART_ARRAY_REQUIRED")? {
                    fields(item, &["path", "hash"])?;
                    records.push(
                        json!({"path": part_path(item, "path")?, "hash": hash(item, "hash")?}),
                    );
                }
            }
            total += records.len();
            checked.insert(group.into(), json!(records));
        }
        for group in ["assets", "components"] {
            let mut records = Vec::new();
            if let Some(items) = value.get(group) {
                for item in items.as_array().context("PART_ARRAY_REQUIRED")? {
                    fields(item, &["id", "version", "hash"])?;
                    let id = text(item, "id", 80)?;
                    worlds::validate_id(id)?;
                    let version = item["version"]
                        .as_u64()
                        .context("PART_VERSION_REQUIRED")?;
                    ensure!(version > 0 && version <= 100000, "INVALID_VERSION");
                    records
                        .push(json!({"id": id, "version": version, "hash": hash(item, "hash")?}));
                }
            }
            total += records.len();
            checked.insert(group.into(), json!(records));
        }
        ensure!(total <= MAX_PARTS, "PART_LIMIT");
        Ok(Value::Object(checked))
    }

    fn parse_state(value: &Value, state_version: u64) -> Result<Value> {
        fields(value, &["format", "version", "entities", "fields", "once"])?;
        ensure!(
            value["format"] == STATE_FORMAT,
            "INVALID_PACKAGE_STATE_FORMAT"
        );
        ensure!(
            value["version"].as_u64() == Some(state_version),
            "PACKAGE_STATE_VERSION_MISMATCH"
        );
        fields(&value["entities"], &["objects", "behaviors", "systems"])?;
        for group in ["objects", "behaviors", "systems"] {
            ensure!(
                value["entities"][group].is_object(),
                "INVALID_PACKAGE_STATE_ENTITIES"
            );
        }
        ensure!(value["fields"].is_object(), "INVALID_PACKAGE_STATE_FIELDS");
        let once = value["once"]
            .as_array()
            .context("INVALID_PACKAGE_STATE_ONCE")?;
        ensure!(once.len() <= 4096, "PACKAGE_STATE_ONCE_LIMIT");
        let mut seen = BTreeSet::new();
        for key in once {
            let key = key.as_str().context("INVALID_ONCE_KEY")?;
            ensure!(
                !key.trim().is_empty() && key.len() <= 240 && !key.chars().any(char::is_control),
                "INVALID_ONCE_KEY"
            );
            ensure!(seen.insert(key.to_owned()), "DUPLICATE_ONCE_KEY: {}", key);
        }
        Ok(value.clone())
    }

    fn parse_migration(value: &Value) -> Result<Value> {
        fields(value, &["from"])?;
        let steps = value["from"].as_array().context("MIGRATION_FROM_REQUIRED")?;
        ensure!(steps.len() <= 64, "MIGRATION_STEP_LIMIT");
        let mut seen = BTreeSet::new();
        let mut checked = Vec::new();
        for step in steps {
            fields(step, &["stateVersion", "operations"])?;
            let version = step["stateVersion"]
                .as_u64()
                .context("MIGRATION_VERSION_REQUIRED")?;
            ensure!(version > 0 && version <= 100000, "INVALID_VERSION");
            ensure!(
                seen.insert(version),
                "DUPLICATE_MIGRATION_STEP: {}",
                version
            );
            let operations = step["operations"]
                .as_array()
                .context("MIGRATION_OPERATIONS_REQUIRED")?;
            ensure!(operations.len() <= 256, "MIGRATION_OPERATION_LIMIT");
            for operation in operations {
                validate_operation(operation)?;
            }
            checked.push(json!({"stateVersion": version, "operations": operations}));
        }
        Ok(json!({"from": checked}))
    }

    pub(super) fn build(args: &Value) -> Result<Manifest> {
        fields(
            args,
            &[
                "operationId",
                "ref",
                "kind",
                "name",
                "description",
                "stateVersion",
                "compatibility",
                "dependencies",
                "parts",
                "initialState",
                "migration",
            ],
        )?;
        let (id, version, content_hash) = super::reference(&args["ref"])?;
        let kind = text(args, "kind", 20)?.to_owned();
        ensure!(KINDS.contains(&kind.as_str()), "INVALID_PACKAGE_KIND");
        let name = text(args, "name", 240)?.to_owned();
        let description = match args.get("description") {
            None | Some(Value::Null) => String::new(),
            Some(value) => {
                let value = value.as_str().context("DESCRIPTION_REQUIRED")?;
                ensure!(value.len() <= 8000, "DESCRIPTION_LIMIT");
                value.to_owned()
            }
        };
        let state_version = args["stateVersion"]
            .as_u64()
            .context("STATE_VERSION_REQUIRED")?;
        ensure!(
            state_version > 0 && state_version <= 100000,
            "INVALID_VERSION"
        );
        let (base, base_version, engine, state_format, scene_format) =
            Self::parse_compatibility(&args["compatibility"])?;
        let dependencies = Self::parse_dependencies(&args["dependencies"])?;
        let parts = Self::parse_parts(&args["parts"])?;
        let initial_state = match args.get("initialState") {
            None | Some(Value::Null) => {
                Self::parse_state(&default_state(state_version), state_version)?
            }
            Some(value) => Self::parse_state(value, state_version)?,
        };
        let migration = match args.get("migration") {
            None | Some(Value::Null) => json!({"from": []}),
            Some(value) => Self::parse_migration(value)?,
        };
        let manifest = json!({
            "format": FORMAT,
            "ref": {"id": id, "version": version, "hash": content_hash},
            "kind": kind,
            "name": name,
            "description": description,
            "stateVersion": state_version,
            "compatibility": {"base": base, "baseVersion": base_version, "engine": engine,
                "stateFormat": state_format, "sceneFormat": scene_format},
            "dependencies": dependencies.iter().map(|d| json!({"id": d.id, "version": d.version,
                "hash": d.hash, "optional": d.optional})).collect::<Vec<_>>(),
            "parts": parts,
            "initialState": initial_state,
            "migration": migration
        });
        let body = serde_json::to_string(&manifest)?;
        ensure!(
            body.len() <= worlds::MAX_WORLD_BYTES,
            "PACKAGE_MANIFEST_TOO_LARGE"
        );
        Ok(Manifest {
            id: id.to_owned(),
            version,
            hash: content_hash.to_owned(),
            kind,
            name,
            description,
            state_version,
            base,
            base_version,
            engine,
            state_format,
            scene_format,
            dependencies,
            parts,
            initial_state,
            migration,
            manifest_hash: digest(&body),
            body,
            manifest_value: manifest,
        })
    }

    pub(super) fn from_row(manifest: &str, manifest_hash: &str) -> Result<Manifest> {
        ensure!(
            digest(manifest) == manifest_hash,
            "CORRUPT_PACKAGE_MANIFEST"
        );
        let value: Value = serde_json::from_str(manifest)?;
        ensure!(value["format"] == FORMAT, "INVALID_PACKAGE_FORMAT");
        let (id, version, content_hash) = super::reference(&value["ref"])?;
        let (base, base_version, engine, state_format, scene_format) =
            Self::parse_compatibility(&value["compatibility"])?;
        let state_version = value["stateVersion"]
            .as_u64()
            .context("STATE_VERSION_REQUIRED")?;
        ensure!(
            state_version > 0 && state_version <= 100000,
            "INVALID_VERSION"
        );
        let kind = value["kind"].as_str().context("INVALID_PACKAGE_KIND")?;
        ensure!(KINDS.contains(&kind), "INVALID_PACKAGE_KIND");
        Ok(Manifest {
            id: id.to_owned(),
            version,
            hash: content_hash.to_owned(),
            kind: kind.to_owned(),
            name: value["name"]
                .as_str()
                .context("INVALID_PACKAGE_NAME")?
                .to_owned(),
            description: value["description"].as_str().unwrap_or("").to_owned(),
            state_version,
            base,
            base_version,
            engine,
            state_format,
            scene_format,
            dependencies: Self::parse_dependencies(&value["dependencies"])?,
            parts: Self::parse_parts(&value["parts"])?,
            initial_state: Self::parse_state(&value["initialState"], state_version)?,
            migration: Self::parse_migration(&value["migration"])?,
            body: manifest.to_owned(),
            manifest_hash: manifest_hash.to_owned(),
            manifest_value: value,
        })
    }
}

pub(super) fn default_state(state_version: u64) -> Value {
    json!({"format": STATE_FORMAT, "version": state_version,
        "entities": {"objects": {}, "behaviors": {}, "systems": {}},
        "fields": {}, "once": []})
}

pub(super) fn state(value: &Value, state_version: u64) -> Result<Value> {
    Manifest::parse_state(value, state_version)
}

fn validate_operation(operation: &Value) -> Result<()> {
    let op = text(operation, "op", 20)?;
    match op {
        "rename" => {
            fields(operation, &["op", "target", "from", "to"])?;
            let target = text(operation, "target", 20)?;
            ensure!(
                ["object", "behavior", "system"].contains(&target),
                "INVALID_MIGRATION_TARGET"
            );
            text(operation, "from", 240)?;
            text(operation, "to", 240)?;
        }
        "add" => {
            fields(operation, &["op", "target", "id", "value"])?;
            let target = text(operation, "target", 20)?;
            ensure!(
                ["object", "behavior", "system"].contains(&target),
                "INVALID_MIGRATION_TARGET"
            );
            text(operation, "id", 240)?;
            ensure!(operation["value"].is_object(), "MIGRATION_VALUE_REQUIRED");
        }
        "remove" => {
            fields(operation, &["op", "target", "id", "expected"])?;
            let target = text(operation, "target", 20)?;
            ensure!(
                ["object", "behavior", "system"].contains(&target),
                "INVALID_MIGRATION_TARGET"
            );
            text(operation, "id", 240)?;
            ensure!(
                operation["expected"].is_object(),
                "MIGRATION_EXPECTED_REQUIRED"
            );
        }
        "renameField" => {
            fields(operation, &["op", "from", "to"])?;
            text(operation, "from", 240)?;
            text(operation, "to", 240)?;
        }
        "addField" => {
            fields(operation, &["op", "id", "value"])?;
            text(operation, "id", 240)?;
        }
        "removeField" => {
            fields(operation, &["op", "id", "expected"])?;
            text(operation, "id", 240)?;
        }
        "preserve" => {
            fields(operation, &["op", "path"])?;
            let path = text(operation, "path", 40)?;
            ensure!(path == "once", "INVALID_MIGRATION_PRESERVE");
        }
        _ => anyhow::bail!("INVALID_MIGRATION_OPERATION: {}", op),
    }
    Ok(())
}

/// Only the persisted build format decides compatibility metadata. Unknown
/// formats stay unknown instead of being guessed from conventions.
pub(super) fn world_target(record: &worlds::WorldRecord) -> Target {
    let scene = &record.world.build["scene"];
    let snapshot = &record.world.snapshot;
    match scene["format"].as_str() {
        Some("craftmine.godot-scene/1") => Target {
            base: scene["baseId"].as_str().unwrap_or("").to_owned(),
            base_version: snapshot["baseVersion"].as_str().unwrap_or("").to_owned(),
            engine: record.world.build["godot"]["engineVersion"]
                .as_str()
                .unwrap_or("")
                .to_owned(),
            state_format: snapshot["format"].as_str().unwrap_or("").to_owned(),
            scene_format: scene["format"].as_str().map(str::to_owned),
        },
        Some(format) if format.starts_with("craftmine.scene/") => Target {
            base: "legacy".into(),
            base_version: "1.0.0".into(),
            engine: "legacy".into(),
            state_format: snapshot["format"].as_str().unwrap_or("").to_owned(),
            scene_format: Some(format.to_owned()),
        },
        _ => Target {
            base: String::new(),
            base_version: String::new(),
            engine: String::new(),
            state_format: snapshot["format"].as_str().unwrap_or("").to_owned(),
            scene_format: None,
        },
    }
}

fn version_parts(value: &str) -> Option<Vec<u64>> {
    value.split('.').map(|part| part.parse::<u64>().ok()).collect()
}

fn at_least(actual: &str, required: &str) -> bool {
    match (version_parts(actual), version_parts(required)) {
        (Some(mut actual), Some(mut required)) => {
            let width = actual.len().max(required.len());
            actual.resize(width, 0);
            required.resize(width, 0);
            actual >= required
        }
        _ => actual == required,
    }
}

pub(super) fn compatibility(manifest: &Manifest, target: &Target) -> Vec<Value> {
    let mut reasons = Vec::new();
    if target.base.is_empty() || manifest.base != target.base {
        reasons.push(json!({"code": "PACKAGE_INCOMPATIBLE_BASE",
            "detail": format!("requires base {} but the world is {}", manifest.base,
                if target.base.is_empty() { "unknown".to_owned() } else { target.base.clone() })}));
    }
    if !target.base_version.is_empty() && !at_least(&target.base_version, &manifest.base_version) {
        reasons.push(json!({"code": "PACKAGE_INCOMPATIBLE_BASE_VERSION",
            "detail": format!("requires baseVersion {} but the world is {}", manifest.base_version, target.base_version)}));
    }
    if target.engine.is_empty() || manifest.engine != target.engine {
        reasons.push(json!({"code": "PACKAGE_INCOMPATIBLE_ENGINE",
            "detail": format!("requires engine {} but the world is {}", manifest.engine,
                if target.engine.is_empty() { "unknown".to_owned() } else { target.engine.clone() })}));
    }
    if target.state_format.is_empty() || manifest.state_format != target.state_format {
        reasons.push(json!({"code": "PACKAGE_INCOMPATIBLE_STATE_FORMAT",
            "detail": format!("requires state format {} but the world is {}", manifest.state_format,
                if target.state_format.is_empty() { "unknown".to_owned() } else { target.state_format.clone() })}));
    }
    if let Some(scene_format) = &target.scene_format {
        if &manifest.scene_format != scene_format {
            reasons.push(json!({"code": "PACKAGE_INCOMPATIBLE_SCENE_FORMAT",
                "detail": format!("requires scene format {} but the world is {}", manifest.scene_format, scene_format)}));
        }
    }
    reasons
}

pub(super) fn assert_compatible(manifest: &Manifest, target: &Target) -> Result<()> {
    let reasons = compatibility(manifest, target);
    if reasons.is_empty() {
        return Ok(());
    }
    let text = reasons
        .iter()
        .map(|reason| {
            format!(
                "{}: {}",
                reason["code"].as_str().unwrap_or("INCOMPATIBLE"),
                reason["detail"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    anyhow::bail!("{}", text)
}

pub(super) fn load(
    db: &Connection,
    id: &str,
    version: u64,
    expected_hash: &str,
) -> Result<Manifest> {
    let row: Option<(String, String, String)> = db
        .query_row(
            "SELECT hash,manifest,manifest_hash FROM craftmine_packages WHERE id=?1 AND version=?2",
            params![id, version as i64],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (hash, manifest, manifest_hash) =
        row.ok_or_else(|| anyhow::anyhow!("PACKAGE_VERSION_NOT_FOUND: {}@{}", id, version))?;
    ensure!(
        hash == expected_hash,
        "PACKAGE_HASH_MISMATCH: {}@{}",
        id,
        version
    );
    Manifest::from_row(&manifest, &manifest_hash)
}

pub(super) fn load_ref(db: &Connection, reference: &Value) -> Result<Manifest> {
    let (id, version, hash) = super::reference(reference)?;
    load(db, id, version, hash)
}

/// Exact dependency closure. Optional dependencies are pulled in when they are
/// registered, but a missing optional never blocks installation.
pub(super) fn closure(db: &Connection, root: &Manifest) -> Result<Vec<Manifest>> {
    let mut resolved: BTreeMap<String, Manifest> = BTreeMap::new();
    let mut visiting: Vec<String> = Vec::new();
    fn visit(
        db: &Connection,
        manifest: &Manifest,
        resolved: &mut BTreeMap<String, Manifest>,
        visiting: &mut Vec<String>,
    ) -> Result<()> {
        let key = manifest.label();
        if resolved.contains_key(&key) {
            return Ok(());
        }
        if let Some(index) = visiting.iter().position(|item| item == &key) {
            let mut cycle = visiting[index..].to_vec();
            cycle.push(key);
            anyhow::bail!("PACKAGE_DEPENDENCY_CYCLE: {}", cycle.join(" -> "));
        }
        visiting.push(key.clone());
        for dependency in &manifest.dependencies {
            let row: Option<(String, String, String)> = db
                .query_row(
                    "SELECT hash,manifest,manifest_hash FROM craftmine_packages WHERE id=?1 AND version=?2",
                    params![dependency.id, dependency.version as i64],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let Some((hash, body, manifest_hash)) = row else {
                if dependency.optional {
                    continue;
                }
                anyhow::bail!(
                    "PACKAGE_DEPENDENCY_MISSING: {}@{}",
                    dependency.id,
                    dependency.version
                );
            };
            ensure!(
                hash == dependency.hash,
                "PACKAGE_DEPENDENCY_HASH_MISMATCH: {}@{}",
                dependency.id,
                dependency.version
            );
            let dependency_manifest = Manifest::from_row(&body, &manifest_hash)?;
            visit(db, &dependency_manifest, resolved, visiting)?;
            let label = dependency_manifest.label();
            match resolved.get(&label) {
                Some(existing) => ensure!(
                    existing.manifest_hash == dependency_manifest.manifest_hash,
                    "PACKAGE_VERSION_CONFLICT: {}",
                    label
                ),
                None => {
                    resolved.insert(label, dependency_manifest);
                }
            }
        }
        visiting.pop();
        resolved.entry(key).or_insert_with(|| manifest.clone());
        Ok(())
    }
    visit(db, root, &mut resolved, &mut visiting)?;
    Ok(resolved.into_values().collect())
}

pub(super) fn resolve_and_assert(
    db: &Connection,
    root: &Manifest,
    target: &Target,
) -> Result<Vec<Manifest>> {
    assert_compatible(root, target)?;
    let closure = closure(db, root)?;
    for manifest in &closure {
        assert_compatible(manifest, target)?;
    }
    Ok(closure)
}

impl TaskJournal {
    pub fn package_register(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "operationId",
                "ref",
                "kind",
                "name",
                "description",
                "stateVersion",
                "compatibility",
                "dependencies",
                "parts",
                "initialState",
                "migration",
            ],
        )?;
        let operation = text(args, "operationId", 240)?;
        let manifest = Manifest::build(args)?;
        let request_hash = digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior: Option<(String, String)> = tx
            .query_row(
                "SELECT request_hash,result FROM craftmine_package_operations WHERE operation_id=?1",
                [operation],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((old, result)) = prior {
            ensure!(old == request_hash, "REPLAY_MISMATCH");
            return Ok(serde_json::from_str(&result)?);
        }
        // The referenced content must already exist at the exact version. That
        // is what makes "fixed version" real: no lookup of a newer version.
        let record = super::read(&tx, &manifest.reference())?;
        if ENTITY_KINDS.contains(&manifest.kind.as_str()) {
            let kind = record["bundle"]["module"]["kind"]
                .as_str()
                .context("PACKAGE_KIND_MISSING")?;
            ensure!(
                kind == manifest.kind,
                "PACKAGE_KIND_MISMATCH: {} vs {}",
                kind,
                manifest.kind
            );
        }
        // Registration only records the declaration. The exact dependency
        // closure and compatibility are resolved when a package is checked,
        // installed or upgraded, so a set of packages can be registered in any
        // order and a missing or cyclic dependency is reported at use.
        let existing: Option<(String, String)> = tx
            .query_row(
                "SELECT hash,manifest_hash FROM craftmine_packages WHERE id=?1 AND version=?2",
                params![manifest.id, manifest.version as i64],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((hash, manifest_hash)) = existing {
            ensure!(
                hash == manifest.hash && manifest_hash == manifest.manifest_hash,
                "IMMUTABLE_VERSION_CONFLICT: {}",
                manifest.label()
            );
        } else {
            let count: i64 =
                tx.query_row("SELECT COUNT(*) FROM craftmine_packages", [], |r| r.get(0))?;
            ensure!(count < 4096, "PACKAGE_LIMIT");
            tx.execute(
                "INSERT INTO craftmine_packages(id,version,hash,library_id,library_version,library_hash,
                 kind,name,state_version,manifest,manifest_hash,created_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    manifest.id,
                    manifest.version as i64,
                    manifest.hash,
                    manifest.id,
                    manifest.version as i64,
                    manifest.hash,
                    manifest.kind,
                    manifest.name,
                    manifest.state_version as i64,
                    manifest.body,
                    manifest.manifest_hash,
                    worlds::timestamp()?
                ],
            )?;
        }
        let result = json!({"ref": manifest.reference(), "packageHash": manifest.hash,
            "manifestHash": manifest.manifest_hash, "kind": manifest.kind,
            "stateVersion": manifest.state_version,
            "compatibility": manifest.manifest_value["compatibility"]});
        tx.execute(
            "INSERT INTO craftmine_package_operations(operation_id,request_hash,result) VALUES(?1,?2,?3)",
            params![operation, request_hash, serde_json::to_string(&result)?],
        )?;
        tx.commit()?;
        Ok(result)
    }

    pub fn package_check(&self, args: &Value) -> Result<Value> {
        fields(args, &["ref", "target"])?;
        fields(
            &args["target"],
            &["base", "baseVersion", "engine", "stateFormat"],
        )?;
        let manifest = load_ref(&self.db, &args["ref"])?;
        let target = Target {
            base: args["target"]["base"].as_str().unwrap_or("").to_owned(),
            base_version: args["target"]["baseVersion"]
                .as_str()
                .unwrap_or("")
                .to_owned(),
            engine: args["target"]["engine"].as_str().unwrap_or("").to_owned(),
            state_format: args["target"]["stateFormat"]
                .as_str()
                .unwrap_or("")
                .to_owned(),
            scene_format: None,
        };
        let closure = closure(&self.db, &manifest)?;
        let mut reasons = compatibility(&manifest, &target);
        for item in &closure {
            for reason in compatibility(item, &target) {
                reasons.push(json!({"code": reason["code"],
                    "detail": format!("{} {}", item.label(), reason["detail"].as_str().unwrap_or(""))}));
            }
        }
        Ok(json!({"ref": manifest.reference(), "compatible": reasons.is_empty(),
            "reasons": reasons,
            "closure": closure.iter().map(|item| item.reference()).collect::<Vec<_>>()}))
    }
}
