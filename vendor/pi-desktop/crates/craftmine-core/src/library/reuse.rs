//! Cross-world reuse: package instances get their own identity and their own
//! progress. Installing, upgrading and uninstalling never touch another
//! world's state, and never silently drop instance progress.
use super::super::{
    digest,
    durable::{fields, text},
    worlds, TaskJournal,
};
use super::packages::{self, Manifest};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

pub(super) const WORK_PACKAGE_FORMAT: &str = "craftmine.work-package/1";
const MAX_STATE_BYTES: usize = 1024 * 1024;
const FORBIDDEN_KEYS: &[&str] = &[
    "credential",
    "credentials",
    "token",
    "apikey",
    "sessionid",
    "session",
    "password",
    "secret",
    "authorization",
];

#[cfg(test)]
#[path = "reuse_tests.rs"]
mod tests;

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_package_instances (
      instance_id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      package_id TEXT NOT NULL, package_version INTEGER NOT NULL, package_hash TEXT NOT NULL,
      kind TEXT NOT NULL, name TEXT NOT NULL,
      manifest TEXT NOT NULL, manifest_hash TEXT NOT NULL,
      state_version INTEGER NOT NULL, state TEXT NOT NULL, state_hash TEXT NOT NULL,
      status TEXT NOT NULL, revision INTEGER NOT NULL,
      origin_instance_id TEXT, origin_world_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, receipt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS craftmine_package_instance_operations (
      operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL);",
    )?;
    Ok(())
}

fn instance_id(operation: &str) -> String {
    format!(
        "ins-{}",
        &digest(&format!("craftmine.instance:{operation}"))[..24]
    )
}

struct Instance {
    instance_id: String,
    world_id: String,
    manifest: Manifest,
    state_version: u64,
    state: Value,
    state_hash: String,
    status: String,
    revision: u64,
    origin_instance_id: Option<String>,
    origin_world_id: Option<String>,
    created_at: u64,
    updated_at: u64,
}

impl Instance {
    fn reference(&self) -> Value {
        self.manifest.reference()
    }

    fn summary(&self) -> Value {
        json!({"instanceId": self.instance_id, "worldId": self.world_id,
            "ref": self.reference(), "kind": self.manifest.kind, "name": self.manifest.name,
            "stateVersion": self.state_version, "stateHash": self.state_hash,
            "status": self.status, "revision": self.revision,
            "origin": match (&self.origin_instance_id, &self.origin_world_id) {
                (None, None) => Value::Null,
                (instance, world) => json!({"instanceId": instance, "worldId": world}),
            },
            "createdAt": self.created_at, "updatedAt": self.updated_at})
    }
}

type InstanceRow = (
    String,
    String,
    String,
    i64,
    String,
    String,
    i64,
    String,
    String,
    String,
    i64,
    Option<String>,
    Option<String>,
    i64,
    i64,
);

fn read_instance(db: &Connection, id: &str) -> Result<Instance> {
    let row: Option<InstanceRow> = db
        .query_row(
            "SELECT world_id,package_id,package_hash,package_version,manifest,manifest_hash,
             state_version,state,state_hash,status,revision,origin_instance_id,origin_world_id,
             created_at,updated_at FROM craftmine_package_instances WHERE instance_id=?1",
            [id],
            |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
                    r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                    r.get(14)?,
                ))
            },
        )
        .optional()?;
    let (
        world_id,
        package_id,
        package_hash,
        package_version,
        manifest,
        manifest_hash,
        state_version,
        state,
        state_hash,
        status,
        revision,
        origin_instance_id,
        origin_world_id,
        created_at,
        updated_at,
    ) = row.ok_or_else(|| anyhow::anyhow!("PACKAGE_INSTANCE_NOT_FOUND: {}", id))?;
    ensure!(digest(&state) == state_hash, "CORRUPT_PACKAGE_INSTANCE_STATE");
    let manifest = Manifest::from_row(&manifest, &manifest_hash)?;
    ensure!(
        manifest.id == package_id
            && manifest.version == package_version as u64
            && manifest.hash == package_hash,
        "CORRUPT_PACKAGE_INSTANCE_MANIFEST"
    );
    ensure!(
        status == "installed" || status == "uninstalled",
        "CORRUPT_PACKAGE_INSTANCE_STATUS"
    );
    Ok(Instance {
        instance_id: id.to_owned(),
        world_id,
        manifest,
        state_version: state_version.try_into()?,
        state: serde_json::from_str(&state)?,
        state_hash,
        status,
        revision: revision.try_into()?,
        origin_instance_id,
        origin_world_id,
        created_at: created_at.try_into()?,
        updated_at: updated_at.try_into()?,
    })
}

fn write_state(
    db: &Connection,
    id: &str,
    state: &Value,
    state_version: u64,
    revision: u64,
) -> Result<String> {
    let body = serde_json::to_string(state)?;
    ensure!(body.len() <= MAX_STATE_BYTES, "PACKAGE_STATE_TOO_LARGE");
    let hash = digest(&body);
    db.execute(
        "UPDATE craftmine_package_instances SET state=?2,state_hash=?3,state_version=?4,
         revision=?5,updated_at=?6 WHERE instance_id=?1",
        params![
            id,
            body,
            hash,
            state_version as i64,
            revision as i64,
            worlds::timestamp()?
        ],
    )?;
    Ok(hash)
}

fn entity_group(target: &str) -> Result<&'static str> {
    match target {
        "object" => Ok("objects"),
        "behavior" => Ok("behaviors"),
        "system" => Ok("systems"),
        _ => anyhow::bail!("INVALID_MIGRATION_TARGET"),
    }
}

/// Declarative migration only. An operation that would discard live data has to
/// declare the exact expected value; otherwise the upgrade is refused instead
/// of resetting the instance.
fn migrate_state(
    from_version: u64,
    to_version: u64,
    target: &Manifest,
    mut state: Value,
    applied: &mut Vec<Value>,
) -> Result<Value> {
    if from_version == to_version {
        return Ok(state);
    }
    ensure!(
        from_version < to_version,
        "PACKAGE_DOWNGRADE_UNSUPPORTED: {} -> {}",
        from_version,
        to_version
    );
    let steps = target.migration["from"]
        .as_array()
        .context("MIGRATION_FROM_REQUIRED")?;
    let mut current = from_version;
    while current < to_version {
        let step = steps
            .iter()
            .find(|step| step["stateVersion"].as_u64() == Some(current))
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "PACKAGE_MIGRATION_MISSING: {} -> {}",
                    from_version,
                    to_version
                )
            })?;
        for operation in step["operations"]
            .as_array()
            .context("MIGRATION_OPERATIONS_REQUIRED")?
        {
            apply_operation(&mut state, operation)?;
            applied.push(operation.clone());
        }
        current += 1;
        state["version"] = json!(current);
    }
    packages::state(&state, to_version)
}

fn apply_operation(state: &mut Value, operation: &Value) -> Result<()> {
    let op = operation["op"]
        .as_str()
        .context("MIGRATION_OPERATION_REQUIRED")?;
    match op {
        "rename" => {
            let group = entity_group(operation["target"].as_str().unwrap_or(""))?;
            let from = operation["from"]
                .as_str()
                .context("MIGRATION_SOURCE_REQUIRED")?;
            let to = operation["to"]
                .as_str()
                .context("MIGRATION_TARGET_REQUIRED")?;
            let entities = state["entities"][group]
                .as_object_mut()
                .context("INVALID_PACKAGE_STATE_ENTITIES")?;
            if let Some(value) = entities.remove(from) {
                ensure!(
                    !entities.contains_key(to),
                    "PACKAGE_MIGRATION_TARGET_EXISTS: {}/{}",
                    group,
                    to
                );
                entities.insert(to.to_owned(), value);
            }
        }
        "add" => {
            let group = entity_group(operation["target"].as_str().unwrap_or(""))?;
            let id = operation["id"]
                .as_str()
                .context("MIGRATION_TARGET_REQUIRED")?;
            let value = operation["value"].clone();
            let entities = state["entities"][group]
                .as_object_mut()
                .context("INVALID_PACKAGE_STATE_ENTITIES")?;
            match entities.get(id) {
                Some(existing) => ensure!(
                    existing == &value,
                    "PACKAGE_MIGRATION_TARGET_EXISTS: {}/{}",
                    group,
                    id
                ),
                None => {
                    entities.insert(id.to_owned(), value);
                }
            }
        }
        "remove" => {
            let group = entity_group(operation["target"].as_str().unwrap_or(""))?;
            let id = operation["id"]
                .as_str()
                .context("MIGRATION_TARGET_REQUIRED")?;
            let expected = &operation["expected"];
            let entities = state["entities"][group]
                .as_object_mut()
                .context("INVALID_PACKAGE_STATE_ENTITIES")?;
            if let Some(existing) = entities.get(id) {
                ensure!(
                    existing == expected,
                    "PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS: {}/{}",
                    group,
                    id
                );
                entities.remove(id);
            }
        }
        "renameField" => {
            let from = operation["from"]
                .as_str()
                .context("MIGRATION_SOURCE_REQUIRED")?;
            let to = operation["to"]
                .as_str()
                .context("MIGRATION_TARGET_REQUIRED")?;
            let fields = state["fields"]
                .as_object_mut()
                .context("INVALID_PACKAGE_STATE_FIELDS")?;
            if let Some(value) = fields.remove(from) {
                ensure!(
                    !fields.contains_key(to),
                    "PACKAGE_MIGRATION_TARGET_EXISTS: fields/{}",
                    to
                );
                fields.insert(to.to_owned(), value);
            }
        }
        "addField" => {
            let id = operation["id"]
                .as_str()
                .context("MIGRATION_TARGET_REQUIRED")?;
            let value = operation["value"].clone();
            let fields = state["fields"]
                .as_object_mut()
                .context("INVALID_PACKAGE_STATE_FIELDS")?;
            match fields.get(id) {
                Some(existing) => ensure!(
                    existing == &value,
                    "PACKAGE_MIGRATION_TARGET_EXISTS: fields/{}",
                    id
                ),
                None => {
                    fields.insert(id.to_owned(), value);
                }
            }
        }
        "removeField" => {
            let id = operation["id"]
                .as_str()
                .context("MIGRATION_TARGET_REQUIRED")?;
            let expected = &operation["expected"];
            let fields = state["fields"]
                .as_object_mut()
                .context("INVALID_PACKAGE_STATE_FIELDS")?;
            if let Some(existing) = fields.get(id) {
                ensure!(
                    existing == expected,
                    "PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS: fields/{}",
                    id
                );
                fields.remove(id);
            }
        }
        "preserve" => {
            ensure!(
                state["once"].is_array(),
                "PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS: once"
            );
        }
        _ => anyhow::bail!("INVALID_MIGRATION_OPERATION: {}", op),
    }
    Ok(())
}

fn assert_no_private_keys(value: &Value) -> Result<()> {
    match value {
        Value::Object(map) => {
            for (key, item) in map {
                let lower = key.to_ascii_lowercase();
                ensure!(
                    !FORBIDDEN_KEYS.iter().any(|forbidden| lower.contains(forbidden)),
                    "PACKAGE_EXPORT_CONTAINS_PRIVATE_DATA: {}",
                    key
                );
                assert_no_private_keys(item)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                assert_no_private_keys(item)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn position(value: &Value) -> Result<Value> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    fields(value, &["x", "y", "z"])?;
    for axis in ["x", "y", "z"] {
        let number = value[axis]
            .as_f64()
            .with_context(|| format!("{axis}: NUMBER_REQUIRED"))?;
        ensure!(
            number.is_finite() && number >= -80.0 && number <= 80.0,
            "INVALID_PLACEMENT"
        );
    }
    Ok(value.clone())
}

fn replay(db: &Connection, operation: &str, request_hash: &str) -> Result<Option<Value>> {
    let prior: Option<(String, String)> = db
        .query_row(
            "SELECT request_hash,result FROM craftmine_package_instance_operations WHERE operation_id=?1",
            [operation],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match prior {
        Some((old, result)) => {
            ensure!(old == request_hash, "REPLAY_MISMATCH");
            Ok(Some(serde_json::from_str(&result)?))
        }
        None => Ok(None),
    }
}

fn record(db: &Connection, operation: &str, request_hash: &str, result: &Value) -> Result<()> {
    db.execute(
        "INSERT INTO craftmine_package_instance_operations(operation_id,request_hash,result) VALUES(?1,?2,?3)",
        params![operation, request_hash, serde_json::to_string(result)?],
    )?;
    Ok(())
}

impl TaskJournal {
    pub fn package_install(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "operationId",
                "ref",
                "worldId",
                "mode",
                "sourceInstanceId",
                "position",
            ],
        )?;
        let operation = text(args, "operationId", 240)?;
        let world_id = text(args, "worldId", 80)?;
        worlds::validate_id(world_id)?;
        let mode = text(args, "mode", 16)?;
        ensure!(mode == "initial" || mode == "copy", "INVALID_INSTALL_MODE");
        let placement = position(args.get("position").unwrap_or(&Value::Null))?;
        let request_hash = digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(result) = replay(&tx, operation, &request_hash)? {
            return Ok(result);
        }
        let manifest = packages::load_ref(&tx, &args["ref"])?;
        let world_record = worlds::read(&tx, world_id)?;
        let target = packages::world_target(&world_record);
        let closure = packages::resolve_and_assert(&tx, &manifest, &target)?;
        let (state, origin_instance, origin_world) = if mode == "initial" {
            (manifest.initial_state.clone(), None, None)
        } else {
            let source_id = text(args, "sourceInstanceId", 240)?;
            let source = read_instance(&tx, source_id)?;
            ensure!(source.status == "installed", "PACKAGE_SOURCE_INSTANCE_INACTIVE");
            let state = if source.manifest.id == manifest.id
                && source.state_version != manifest.state_version
            {
                let mut applied = Vec::new();
                migrate_state(
                    source.state_version,
                    manifest.state_version,
                    &manifest,
                    source.state.clone(),
                    &mut applied,
                )?
            } else {
                ensure!(
                    source.state_version == manifest.state_version,
                    "PACKAGE_SOURCE_INCOMPATIBLE: {}@{} -> {}@{}",
                    source.manifest.id,
                    source.state_version,
                    manifest.id,
                    manifest.state_version
                );
                source.state.clone()
            };
            (state, Some(source.instance_id), Some(source.world_id))
        };
        let state = packages::state(&state, manifest.state_version)?;
        let id = instance_id(operation);
        ensure!(
            !tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM craftmine_package_instances WHERE instance_id=?1)",
                [&id],
                |r| r.get::<_, bool>(0),
            )?,
            "PACKAGE_INSTANCE_EXISTS: {}",
            id
        );
        let body = serde_json::to_string(&state)?;
        let state_hash = digest(&body);
        let now = worlds::timestamp()?;
        let receipt = json!({"instanceId": id, "worldId": world_id, "ref": manifest.reference(),
            "packageHash": manifest.hash, "kind": manifest.kind,
            "stateVersion": manifest.state_version, "stateHash": state_hash, "revision": 0,
            "status": "installed",
            "origin": match (&origin_instance, &origin_world) {
                (None, None) => Value::Null,
                (instance, world) => json!({"instanceId": instance, "worldId": world}),
            },
            "position": placement,
            "closure": closure.iter().map(|item| item.reference()).collect::<Vec<_>>(),
            "credentialsIncluded": false, "sessionIncluded": false});
        tx.execute(
            "INSERT INTO craftmine_package_instances(instance_id,world_id,package_id,package_version,
             package_hash,kind,name,manifest,manifest_hash,state_version,state,state_hash,status,
             revision,origin_instance_id,origin_world_id,created_at,updated_at,receipt)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'installed',0,?13,?14,?15,?15,?16)",
            params![
                id,
                world_id,
                manifest.id,
                manifest.version as i64,
                manifest.hash,
                manifest.kind,
                manifest.name,
                manifest.body,
                manifest.manifest_hash,
                manifest.state_version as i64,
                body,
                state_hash,
                origin_instance,
                origin_world,
                now,
                serde_json::to_string(&receipt)?
            ],
        )?;
        record(&tx, operation, &request_hash, &receipt)?;
        tx.commit()?;
        Ok(receipt)
    }

    pub fn package_list(&self, args: &Value) -> Result<Value> {
        fields(args, &["worldId", "status", "offset", "limit"])?;
        let offset = args["offset"].as_u64().unwrap_or(0);
        let limit = args["limit"].as_u64().unwrap_or(20);
        ensure!(offset <= 4096 && limit > 0 && limit <= 50, "PAGE_LIMIT");
        let mut statement = self.db.prepare(
            "SELECT instance_id FROM craftmine_package_instances
             WHERE (?1 IS NULL OR world_id=?1) AND (?2 IS NULL OR status=?2)
             ORDER BY created_at DESC,instance_id LIMIT 4096",
        )?;
        let ids = statement
            .query_map(
                params![args["worldId"].as_str(), args["status"].as_str()],
                |r| r.get::<_, String>(0),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let total = ids.len();
        let mut items = Vec::new();
        for id in ids.into_iter().skip(offset as usize).take(limit as usize) {
            items.push(read_instance(&self.db, &id)?.summary());
        }
        Ok(json!({"items": items, "offset": offset, "limit": limit, "total": total,
            "next": if offset + limit < total as u64 { Some(offset + limit) } else { None }}))
    }

    pub fn package_read(&self, args: &Value) -> Result<Value> {
        fields(args, &["instanceId"])?;
        let id = text(args, "instanceId", 240)?;
        let instance = read_instance(&self.db, id)?;
        let mut summary = instance.summary();
        summary["state"] = instance.state.clone();
        summary["compatibility"] = instance.manifest.manifest_value["compatibility"].clone();
        Ok(summary)
    }

    pub fn package_progress(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "instanceId", "revision", "state"])?;
        let operation = text(args, "operationId", 240)?;
        let id = text(args, "instanceId", 240)?;
        let expected = args["revision"].as_u64().context("REVISION_REQUIRED")?;
        let request_hash = digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(result) = replay(&tx, operation, &request_hash)? {
            return Ok(result);
        }
        let instance = read_instance(&tx, id)?;
        ensure!(
            instance.status == "installed",
            "PACKAGE_INSTANCE_UNINSTALLED: {}",
            id
        );
        ensure!(
            instance.revision == expected,
            "PACKAGE_INSTANCE_REVISION_CONFLICT: {} != {}",
            instance.revision,
            expected
        );
        let state = packages::state(&args["state"], instance.state_version)?;
        let revision = instance.revision + 1;
        let state_hash = write_state(&tx, id, &state, instance.state_version, revision)?;
        let result = json!({"instanceId": id, "revision": revision,
            "stateVersion": instance.state_version, "stateHash": state_hash});
        record(&tx, operation, &request_hash, &result)?;
        tx.commit()?;
        Ok(result)
    }

    /// One-time rewards use a key ledger, so a repeated grant or an upgrade
    /// cannot pay the same reward twice.
    pub fn package_grant(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "instanceId", "key", "reward"])?;
        let operation = text(args, "operationId", 240)?;
        let id = text(args, "instanceId", 240)?;
        let key = text(args, "key", 240)?;
        let reward = &args["reward"];
        ensure!(reward.is_object(), "REWARD_OBJECT_REQUIRED");
        let request_hash = digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(result) = replay(&tx, operation, &request_hash)? {
            return Ok(result);
        }
        let instance = read_instance(&tx, id)?;
        ensure!(
            instance.status == "installed",
            "PACKAGE_INSTANCE_UNINSTALLED: {}",
            id
        );
        let mut state = instance.state.clone();
        let granted = !state["once"]
            .as_array()
            .context("INVALID_PACKAGE_STATE_ONCE")?
            .iter()
            .any(|item| item.as_str() == Some(key));
        if granted {
            state["once"]
                .as_array_mut()
                .context("INVALID_PACKAGE_STATE_ONCE")?
                .push(json!(key));
            let fields = state["fields"]
                .as_object_mut()
                .context("INVALID_PACKAGE_STATE_FIELDS")?;
            let grants = fields.entry("grants").or_insert_with(|| json!({}));
            grants
                .as_object_mut()
                .context("INVALID_PACKAGE_STATE_GRANTS")?
                .insert(key.to_owned(), reward.clone());
        }
        let revision = instance.revision + 1;
        let state_hash = write_state(&tx, id, &state, instance.state_version, revision)?;
        let result = json!({"instanceId": id, "key": key, "granted": granted,
            "revision": revision, "stateHash": state_hash, "once": state["once"]});
        record(&tx, operation, &request_hash, &result)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn package_upgrade(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "instanceId", "toRef"])?;
        let operation = text(args, "operationId", 240)?;
        let id = text(args, "instanceId", 240)?;
        let request_hash = digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(result) = replay(&tx, operation, &request_hash)? {
            return Ok(result);
        }
        let instance = read_instance(&tx, id)?;
        ensure!(
            instance.status == "installed",
            "PACKAGE_INSTANCE_UNINSTALLED: {}",
            id
        );
        let target_manifest = packages::load_ref(&tx, &args["toRef"])?;
        ensure!(
            target_manifest.kind == instance.manifest.kind,
            "PACKAGE_UPGRADE_KIND_MISMATCH: {} vs {}",
            instance.manifest.kind,
            target_manifest.kind
        );
        let record_world = worlds::read(&tx, &instance.world_id)?;
        let target = packages::world_target(&record_world);
        packages::resolve_and_assert(&tx, &target_manifest, &target)?;
        let mut applied = Vec::new();
        let state = migrate_state(
            instance.state_version,
            target_manifest.state_version,
            &target_manifest,
            instance.state.clone(),
            &mut applied,
        )?;
        let state = packages::state(&state, target_manifest.state_version)?;
        let revision = instance.revision + 1;
        let body = serde_json::to_string(&state)?;
        ensure!(body.len() <= MAX_STATE_BYTES, "PACKAGE_STATE_TOO_LARGE");
        let state_hash = digest(&body);
        tx.execute(
            "UPDATE craftmine_package_instances SET package_id=?2,package_version=?3,package_hash=?4,
             kind=?5,name=?6,manifest=?7,manifest_hash=?8,state_version=?9,state=?10,state_hash=?11,
             revision=?12,updated_at=?13 WHERE instance_id=?1",
            params![
                id,
                target_manifest.id,
                target_manifest.version as i64,
                target_manifest.hash,
                target_manifest.kind,
                target_manifest.name,
                target_manifest.body,
                target_manifest.manifest_hash,
                target_manifest.state_version as i64,
                body,
                state_hash,
                revision as i64,
                worlds::timestamp()?
            ],
        )?;
        let result = json!({"instanceId": id, "fromRef": instance.reference(),
            "toRef": target_manifest.reference(), "fromStateVersion": instance.state_version,
            "toStateVersion": target_manifest.state_version, "stateHash": state_hash,
            "revision": revision, "migration": applied, "preservedOnce": state["once"]});
        record(&tx, operation, &request_hash, &result)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn package_uninstall(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "instanceId", "expectedRevision"])?;
        let operation = text(args, "operationId", 240)?;
        let id = text(args, "instanceId", 240)?;
        let expected = args["expectedRevision"]
            .as_u64()
            .context("REVISION_REQUIRED")?;
        let request_hash = digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(result) = replay(&tx, operation, &request_hash)? {
            return Ok(result);
        }
        let instance = read_instance(&tx, id)?;
        ensure!(
            instance.revision == expected,
            "PACKAGE_INSTANCE_REVISION_CONFLICT: {} != {}",
            instance.revision,
            expected
        );
        tx.execute(
            "UPDATE craftmine_package_instances SET status='uninstalled',updated_at=?2 WHERE instance_id=?1",
            params![id, worlds::timestamp()?],
        )?;
        // Progress is retained so an uninstall is always reversible.
        let result = json!({"instanceId": id, "status": "uninstalled",
            "stateHash": instance.state_hash, "restorable": true});
        record(&tx, operation, &request_hash, &result)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn package_restore(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "instanceId"])?;
        let operation = text(args, "operationId", 240)?;
        let id = text(args, "instanceId", 240)?;
        let request_hash = digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(result) = replay(&tx, operation, &request_hash)? {
            return Ok(result);
        }
        let instance = read_instance(&tx, id)?;
        // Restoring needs the exact immutable version; a vanished version is an
        // explicit failure instead of a silent downgrade.
        packages::load(
            &tx,
            &instance.manifest.id,
            instance.manifest.version,
            &instance.manifest.hash,
        )
        .map_err(|_| {
            anyhow::anyhow!(
                "PACKAGE_VERSION_UNAVAILABLE: {}",
                instance.manifest.label()
            )
        })?;
        tx.execute(
            "UPDATE craftmine_package_instances SET status='installed',updated_at=?2 WHERE instance_id=?1",
            params![id, worlds::timestamp()?],
        )?;
        let result = json!({"instanceId": id, "status": "installed",
            "stateHash": instance.state_hash});
        record(&tx, operation, &request_hash, &result)?;
        tx.commit()?;
        Ok(result)
    }

    /// Offline work package: content and install contract only. Instance
    /// progress, host sessions and credentials are deliberately absent.
    pub fn package_export(&self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "instanceId"])?;
        text(args, "operationId", 240)?;
        let id = text(args, "instanceId", 240)?;
        let instance = read_instance(&self.db, id)?;
        let record = super::read(&self.db, &instance.reference())?;
        let package = json!({
            "format": WORK_PACKAGE_FORMAT,
            "ref": instance.reference(),
            "kind": instance.manifest.kind,
            "name": instance.manifest.name,
            "description": instance.manifest.description,
            "stateVersion": instance.manifest.state_version,
            "compatibility": instance.manifest.manifest_value["compatibility"],
            "dependencies": instance.manifest.manifest_value["dependencies"],
            "parts": instance.manifest.parts,
            "initialState": instance.manifest.initial_state,
            "migration": instance.manifest.manifest_value["migration"],
            "content": record["bundle"],
            "provenance": {"worldId": instance.world_id,
                "sourceInstanceId": instance.instance_id,
                "exportedAt": worlds::timestamp()?}
        });
        assert_no_private_keys(&package)?;
        let body = serde_json::to_string(&package)?;
        ensure!(body.len() <= worlds::MAX_WORLD_BYTES, "WORK_PACKAGE_TOO_LARGE");
        Ok(json!({"package": package, "packageHash": digest(&body),
            "credentialsIncluded": false, "sessionIncluded": false, "progressIncluded": false}))
    }

    pub fn package_import(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "package"])?;
        let operation = text(args, "operationId", 240)?;
        let package = &args["package"];
        ensure!(
            package["format"] == WORK_PACKAGE_FORMAT,
            "INVALID_WORK_PACKAGE_FORMAT"
        );
        fields(
            package,
            &[
                "format",
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
                "content",
                "provenance",
            ],
        )?;
        assert_no_private_keys(package)?;
        let (id, version, hash) = super::reference(&package["ref"])?;
        let register = json!({"operationId": format!("import:{}", operation),
            "ref": package["ref"], "kind": package["kind"], "name": package["name"],
            "description": package["description"], "stateVersion": package["stateVersion"],
            "compatibility": package["compatibility"],
            "dependencies": package["dependencies"], "parts": package["parts"],
            "initialState": package["initialState"], "migration": package["migration"]});
        let manifest = Manifest::build(&register)?;
        ensure!(manifest.hash == hash, "WORK_PACKAGE_REF_HASH_MISMATCH");
        let bundle = &package["content"];
        ensure!(
            bundle["format"] == "craftmine.library-bundle/1",
            "INVALID_LIBRARY_BUNDLE"
        );
        ensure!(
            bundle["module"]["hash"] == manifest.hash,
            "WORK_PACKAGE_CONTENT_HASH_MISMATCH"
        );
        let body = serde_json::to_string(bundle)?;
        ensure!(
            body.len() <= worlds::MAX_WORLD_BYTES,
            "LIBRARY_PACKAGE_TOO_LARGE"
        );
        let request_hash = digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(result) = replay(&tx, operation, &request_hash)? {
            return Ok(result);
        }
        let existing: Option<String> = tx
            .query_row(
                "SELECT bundle_hash FROM craftmine_library WHERE id=?1 AND version=?2",
                params![id, version as i64],
                |r| r.get(0),
            )
            .optional()?;
        let content_hash = digest(&body);
        match existing {
            Some(stored) => ensure!(
                stored == content_hash,
                "IMMUTABLE_VERSION_CONFLICT: {}@{}",
                id,
                version
            ),
            None => {
                let metadata = json!({"ref": manifest.reference(), "kind": manifest.kind,
                    "name": manifest.name, "description": manifest.description, "tags": [],
                    "scope": {"projectId": "imported"},
                    "sourceWorldId": package["provenance"]["worldId"],
                    "evidence": {"proposed": false, "verified": false, "applied": false,
                        "imported": true, "needsRevalidation": true},
                    "dependencies": manifest.dependencies.iter().map(|d| json!({"id": d.id,
                        "version": d.version, "hash": d.hash})).collect::<Vec<_>>(),
                    "createdAt": worlds::timestamp()?});
                tx.execute(
                    "INSERT INTO craftmine_library(id,version,hash,kind,name,description,project_id,
                     world_scope,bundle,bundle_hash,metadata,created_at)
                     VALUES(?1,?2,?3,?4,?5,?6,'imported',NULL,?7,?8,?9,?10)",
                    params![
                        id,
                        version as i64,
                        manifest.hash,
                        manifest.kind,
                        manifest.name,
                        manifest.description,
                        body,
                        content_hash,
                        serde_json::to_string(&metadata)?,
                        worlds::timestamp()?
                    ],
                )?;
            }
        }
        let existing_package: Option<String> = tx
            .query_row(
                "SELECT manifest_hash FROM craftmine_packages WHERE id=?1 AND version=?2",
                params![id, version as i64],
                |r| r.get(0),
            )
            .optional()?;
        match existing_package {
            Some(stored) => ensure!(
                stored == manifest.manifest_hash,
                "IMMUTABLE_VERSION_CONFLICT: {}@{}",
                id,
                version
            ),
            None => {
                tx.execute(
                    "INSERT INTO craftmine_packages(id,version,hash,library_id,library_version,
                     library_hash,kind,name,state_version,manifest,manifest_hash,created_at)
                     VALUES(?1,?2,?3,?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![
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
        }
        let result = json!({"ref": manifest.reference(), "contentHash": content_hash,
            "packageHash": digest(&serde_json::to_string(package)?),
            "imported": true, "needsRevalidation": true, "credentialsIncluded": false});
        record(&tx, operation, &request_hash, &result)?;
        tx.commit()?;
        Ok(result)
    }

    /// Reference protection for archive/cleanup decisions.
    pub fn package_usage(&self, args: &Value) -> Result<Value> {
        fields(args, &["ref"])?;
        let (id, version, hash) = super::reference(&args["ref"])?;
        let mut statement = self.db.prepare(
            "SELECT instance_id,world_id,status FROM craftmine_package_instances
             WHERE package_id=?1 AND package_version=?2 AND package_hash=?3
             ORDER BY world_id,instance_id",
        )?;
        let instances = statement
            .query_map(params![id, version as i64, hash], |r| {
                Ok(json!({"instanceId": r.get::<_, String>(0)?, "worldId": r.get::<_, String>(1)?,
                    "status": r.get::<_, String>(2)?}))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let count = instances.len();
        Ok(
            json!({"ref": {"id": id, "version": version, "hash": hash}, "instances": instances,
            "count": count, "removable": count == 0}),
        )
    }
}

/// Distinct world/instance pairs are what make "two compatible worlds reuse the
/// same fixed version" observable.
#[allow(dead_code)]
pub(super) fn instance_world_pairs(db: &Connection) -> Result<Vec<(String, String)>> {
    let mut statement = db.prepare(
        "SELECT instance_id,world_id FROM craftmine_package_instances ORDER BY instance_id",
    )?;
    let rows = statement
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Kept explicit so a future archive step cannot drop a package that a live
/// instance still references.
#[allow(dead_code)]
pub(super) fn referenced(db: &Connection, id: &str, version: u64, hash: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM craftmine_package_instances
         WHERE package_id=?1 AND package_version=?2 AND package_hash=?3)",
        params![id, version as i64, hash],
        |r| r.get::<_, bool>(0),
    )?)
}
