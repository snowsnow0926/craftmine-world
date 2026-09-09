//! Immutable package index. Applied provenance is joined from journal receipts.
use super::{
    digest,
    durable::{fields, number, text},
    verification, worlds, TaskJournal,
};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS craftmine_library (
      id TEXT NOT NULL,version INTEGER NOT NULL,hash TEXT NOT NULL,kind TEXT NOT NULL,
      name TEXT NOT NULL,description TEXT NOT NULL,project_id TEXT NOT NULL,world_scope TEXT,
      bundle TEXT NOT NULL,bundle_hash TEXT NOT NULL,metadata TEXT NOT NULL,created_at INTEGER NOT NULL,
      PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS craftmine_library_operations (
      operation_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,result TEXT NOT NULL);")?;
    Ok(())
}
pub(super) fn reference(value: &Value) -> Result<(&str, u64, &str)> {
    fields(value, &["id", "version", "hash"])?;
    let id = text(value, "id", 80)?;
    worlds::validate_id(id)?;
    let version = number(value, "version", 100000)?;
    ensure!(version > 0, "INVALID_VERSION");
    let hash = text(value, "hash", 64)?;
    ensure!(
        hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit()),
        "INVALID_HASH"
    );
    Ok((id, version, hash))
}
pub(super) fn read(db: &Connection, reference_value: &Value) -> Result<Value> {
    let (id, version, hash) = reference(reference_value)?;
    let (stored,body,body_hash,metadata):(String,String,String,String)=db.query_row("SELECT hash,bundle,bundle_hash,metadata FROM craftmine_library WHERE id=?1 AND version=?2",params![id,version as i64],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).context("LIBRARY_VERSION_NOT_FOUND")?;
    ensure!(stored == hash, "LIBRARY_HASH_MISMATCH");
    ensure!(digest(&body) == body_hash, "CORRUPT_LIBRARY_PACKAGE");
    Ok(
        json!({"ref":reference_value,"bundle":serde_json::from_str::<Value>(&body)?,"packageHash":body_hash,"metadata":serde_json::from_str::<Value>(&metadata)?}),
    )
}
fn resource<'a>(scene: &'a Value, kind: &str, id: &str) -> Result<&'a Value> {
    let group = match kind {
        "object" => "objects",
        "gameplay" => "systems",
        "creation" => "behaviors",
        _ => anyhow::bail!("INVALID_MODULE_KIND"),
    };
    scene[group]
        .as_array()
        .context("RESOURCE_NOT_FOUND")?
        .iter()
        .find(|v| v["id"] == id)
        .context("RESOURCE_NOT_FOUND")
}
fn same_fields(actual: &Value, expected: &Value, keys: &[&str]) -> Result<()> {
    for key in keys {
        ensure!(
            actual.get(*key) == expected.get(*key),
            "CAPTURE_CONTENT_MISMATCH: {key}"
        );
    }
    Ok(())
}
fn source_object_id<'a>(original: &'a Value, local: &'a str) -> &'a str {
    original["binding"]["objects"]
        .as_array()
        .and_then(|bs| bs.iter().find(|b| b["local"] == local))
        .and_then(|b| b["world"].as_str())
        .unwrap_or(local)
}
fn translated(actual: &Value, position: &Value, anchor: &Value) -> Result<()> {
    for axis in ["x", "y", "z"] {
        let value = actual[axis].as_f64().context("CAPTURE_POSITION_REQUIRED")?;
        let expected = position[axis]
            .as_f64()
            .context("SOURCE_POSITION_REQUIRED")?
            - anchor[axis].as_f64().context("CAPTURE_ANCHOR_REQUIRED")?;
        ensure!((value - expected).abs() < 1e-7, "CAPTURE_POSITION_MISMATCH");
    }
    Ok(())
}
fn validate_capture(module: &Value, scene: &Value, kind: &str, id: &str) -> Result<()> {
    let source = resource(scene, kind, id)?;
    let payload = &module["payload"];
    ensure!(
        module["kind"] == kind && module["origin"]["definition"] == id,
        "CAPTURE_IDENTITY_MISMATCH"
    );
    match kind {
        "object" => same_fields(
            payload,
            source,
            &["name", "parts", "components", "appearance"],
        )?,
        "gameplay" => same_fields(payload, source, &["name", "type", "config"])?,
        _ => {
            let scripts = payload["scripts"]
                .as_array()
                .context("CREATION_SCRIPTS_REQUIRED")?;
            ensure!(
                !scripts.is_empty() && scripts.len() <= 8,
                "CREATION_SCRIPT_LIMIT"
            );
            let objects = payload["objects"]
                .as_array()
                .context("CREATION_OBJECTS_REQUIRED")?;
            ensure!(objects.len() <= 16, "CREATION_OBJECT_LIMIT");
            let source_bindings = source["binding"]["behaviors"].as_array();
            let first_object = objects
                .first()
                .and_then(|object| {
                    scripts.first().and_then(|script| {
                        script["objects"]
                            .as_array()?
                            .iter()
                            .find(|alias| alias["object"] == object["key"])
                    })
                })
                .and_then(|alias| alias["local"].as_str());
            let default_anchor = if let Some(local) = first_object {
                resource(scene, "object", source_object_id(source, local))?["position"].clone()
            } else {
                json!({"x":0,"y":6,"z":0})
            };
            let anchor = source["binding"].get("origin").unwrap_or(&default_anchor);
            for script in scripts {
                let local = text(script, "key", 80)?;
                let original_id = source_bindings
                    .and_then(|bs| bs.iter().find(|b| b["local"] == local))
                    .and_then(|b| b["world"].as_str())
                    .unwrap_or(local);
                let original = resource(scene, "creation", original_id)?;
                same_fields(
                    &script["definition"],
                    original,
                    &[
                        "name",
                        "description",
                        "code",
                        "stateVersion",
                        "initialState",
                        "params",
                        "keys",
                        "migrate",
                        "permissions",
                        "requires",
                        "capabilities",
                    ],
                )?;
                let aliases = script["objects"]
                    .as_array()
                    .context("CREATION_BINDINGS_REQUIRED")?;
                let zero = json!({"x":0,"y":0,"z":0});
                translated(
                    &script["translation"],
                    original["binding"].get("translation").unwrap_or(&zero),
                    anchor,
                )?;
                let original_targets = original["targets"]
                    .as_array()
                    .context("CREATION_TARGETS_REQUIRED")?;
                let captured_targets = script["definition"]["targets"]
                    .as_array()
                    .context("CREATION_TARGETS_REQUIRED")?;
                ensure!(
                    original_targets.len() == captured_targets.len(),
                    "CAPTURE_TARGETS_MISMATCH"
                );
                for (world_target, local_target) in original_targets.iter().zip(captured_targets) {
                    let local = local_target.as_str().context("CREATION_ALIAS_REQUIRED")?;
                    ensure!(
                        aliases.iter().any(|a| a["local"] == local)
                            && world_target == source_object_id(original, local),
                        "CAPTURE_TARGETS_MISMATCH"
                    );
                }
                for object in objects {
                    let key = text(object, "key", 80)?;
                    let alias = aliases
                        .iter()
                        .find(|a| a["object"] == key)
                        .context("CREATION_BINDING_INCOMPLETE")?;
                    let local = alias["local"].as_str().context("CREATION_ALIAS_REQUIRED")?;
                    let original_id = original["binding"]["objects"]
                        .as_array()
                        .and_then(|bs| bs.iter().find(|b| b["local"] == local))
                        .and_then(|b| b["world"].as_str())
                        .unwrap_or(local);
                    same_fields(
                        object,
                        resource(scene, "object", original_id)?,
                        &["name", "parts", "components", "appearance"],
                    )?;
                    translated(
                        &object["position"],
                        &resource(scene, "object", original_id)?["position"],
                        anchor,
                    )?;
                }
            }
            for system in payload["systems"]
                .as_array()
                .context("CREATION_SYSTEMS_REQUIRED")?
            {
                let original = resource(scene, "gameplay", text(system, "id", 80)?)?;
                same_fields(system, original, &["name", "type", "config"])?;
            }
        }
    }
    Ok(())
}
impl TaskJournal {
    pub fn library_capture(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "operationId",
                "applicationId",
                "worldId",
                "kind",
                "resourceId",
                "bundle",
                "scope",
                "tags",
            ],
        )?;
        let operation = text(args, "operationId", 240)?;
        let application = text(args, "applicationId", 240)?;
        let world = text(args, "worldId", 80)?;
        let kind = text(args, "kind", 20)?;
        let selected = text(args, "resourceId", 80)?;
        let scope = &args["scope"];
        fields(scope, &["projectId", "worldId"])?;
        let project = text(scope, "projectId", 240)?;
        if let Some(scope_world) = scope.get("worldId") {
            ensure!(scope_world == world, "SCOPE_WORLD_MISMATCH");
        }
        let bundle = &args["bundle"];
        fields(bundle, &["format", "module", "assets", "extensions"])?;
        ensure!(
            bundle["format"] == "craftmine.library-bundle/1",
            "INVALID_BUNDLE_FORMAT"
        );
        let module = &bundle["module"];
        fields(
            module,
            &[
                "format",
                "runtime",
                "id",
                "version",
                "kind",
                "hash",
                "name",
                "description",
                "dependencies",
                "payload",
                "origin",
            ],
        )?;
        ensure!(
            matches!(
                module["format"].as_str(),
                Some(
                    "craftmine.module/1"
                        | "craftmine.module/2"
                        | "craftmine.module/3"
                        | "craftmine.module/4"
                )
            ),
            "INVALID_MODULE_FORMAT"
        );
        let reference_value =
            json!({"id":module["id"],"version":module["version"],"hash":module["hash"]});
        let (id, version, hash) = reference(&reference_value)?;
        let name = text(module, "name", 240)?;
        let description = module["description"]
            .as_str()
            .context("DESCRIPTION_REQUIRED")?;
        ensure!(description.len() <= 8000, "DESCRIPTION_LIMIT");
        ensure!(
            digest(&serde_json::to_string(
                &json!({"kind":module["kind"],"payload":module["payload"]})
            )?) == hash,
            "MODULE_CONTENT_HASH_MISMATCH"
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
        let prior:Option<(String,String)>=tx.query_row("SELECT request_hash,result FROM craftmine_library_operations WHERE operation_id=?1",[operation],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((old, result)) = prior {
            ensure!(old == request_hash, "REPLAY_MISMATCH");
            return Ok(serde_json::from_str(&result)?);
        }
        let (status,input_body,input_hash):(String,String,String)=tx.query_row("SELECT status,input,input_hash FROM craftmine_applications WHERE id=?1 AND world_id=?2",params![application,world],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).context("APPLIED_SOURCE_REQUIRED")?;
        ensure!(
            status == "applied" && digest(&input_body) == input_hash,
            "APPLIED_SOURCE_REQUIRED"
        );
        let input: Value = serde_json::from_str(&input_body)?;
        ensure!(
            input["binding"]["projectId"] == project,
            "PROJECT_BINDING_MISMATCH"
        );
        let check = verification::read(
            &tx,
            input["verificationId"].as_str().context("CHECK_REQUIRED")?,
        )?;
        ensure!(
            check["status"] == "passed" && check["outputHash"] == input["verificationOutputHash"],
            "APPLIED_EVIDENCE_MISMATCH"
        );
        let artifact = &check["output"]["artifact"];
        ensure!(
            module["origin"]["build"] == artifact["build"]["id"],
            "SOURCE_BUILD_MISMATCH"
        );
        validate_capture(module, &artifact["build"]["scene"], kind, selected)?;
        for (field, available) in [
            ("assets", &artifact["build"]["assets"]),
            ("extensions", &artifact["extensions"]),
        ] {
            let deps = bundle[field]
                .as_array()
                .context("DEPENDENCY_ARRAY_REQUIRED")?;
            ensure!(deps.len() <= 32, "DEPENDENCY_LIMIT");
            for dep in deps {
                ensure!(
                    available.as_array().is_some_and(|all| all.contains(dep)),
                    "UNVERIFIED_DEPENDENCY"
                );
            }
        }
        let tags = args.get("tags").cloned().unwrap_or(json!([]));
        let tags_array = tags.as_array().context("TAGS_REQUIRED")?;
        ensure!(
            tags_array.len() <= 12
                && tags_array
                    .iter()
                    .all(|t| t.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 128)),
            "INVALID_TAGS"
        );
        let metadata = json!({"ref":reference_value,"kind":kind,"name":name,"description":description,"tags":tags,"scope":scope,"sourceWorldId":world,"sourceBuildHash":artifact["build"]["hash"],"sourceBuildId":artifact["build"]["id"],"applicationId":application,"verificationId":input["verificationId"],"reviewId":input["reviewId"],"evidence":{"proposed":true,"verified":true,"applied":true},"dependencies":module["dependencies"],"runtime":module["runtime"],"createdAt":worlds::timestamp()?});
        let existing: Option<(String, String)> = tx
            .query_row(
                "SELECT hash,bundle_hash FROM craftmine_library WHERE id=?1 AND version=?2",
                params![id, version as i64],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((old, package_hash)) = existing {
            ensure!(
                old == hash && package_hash == digest(&body),
                "IMMUTABLE_VERSION_CONFLICT"
            );
        } else {
            let count: i64 =
                tx.query_row("SELECT COUNT(*) FROM craftmine_library", [], |r| r.get(0))?;
            ensure!(count < 4096, "LIBRARY_VERSION_LIMIT");
            tx.execute("INSERT INTO craftmine_library(id,version,hash,kind,name,description,project_id,world_scope,bundle,bundle_hash,metadata,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",params![id,version as i64,hash,kind,name,description,project,scope["worldId"].as_str(),body,digest(&body),serde_json::to_string(&metadata)?,worlds::timestamp()?])?;
        }
        let result = json!({"ref":reference_value,"packageHash":digest(&body),"metadata":metadata});
        tx.execute("INSERT INTO craftmine_library_operations(operation_id,request_hash,result) VALUES(?1,?2,?3)",params![operation,request_hash,serde_json::to_string(&result)?])?;
        tx.commit()?;
        Ok(result)
    }
    pub fn library_read(&self, args: &Value) -> Result<Value> {
        fields(args, &["ref"])?;
        read(&self.db, &args["ref"])
    }
    pub fn library_search(&self, args: &Value) -> Result<Value> {
        fields(args, &["query", "kind", "tags", "scope", "offset", "limit"])?;
        let query = args["query"].as_str().unwrap_or("").to_lowercase();
        ensure!(query.len() <= 512, "QUERY_LIMIT");
        let offset = args["offset"].as_u64().unwrap_or(0);
        let limit = args["limit"].as_u64().unwrap_or(20);
        ensure!(offset <= 4096 && limit > 0 && limit <= 50, "PAGE_LIMIT");
        let scope = args.get("scope");
        if let Some(scope) = scope {
            fields(scope, &["projectId", "worldId"])?;
            text(scope, "projectId", 240)?;
        }
        let mut sql="SELECT metadata FROM craftmine_library WHERE (?1 IS NULL OR project_id=?1) AND (?2 IS NULL OR world_scope IS NULL OR world_scope=?2) AND (?3 IS NULL OR kind=?3) ORDER BY created_at DESC,id,version DESC".to_string();
        sql.push_str(" LIMIT 4096");
        let rows = self
            .db
            .prepare(&sql)?
            .query_map(
                params![
                    scope.and_then(|s| s["projectId"].as_str()),
                    scope.and_then(|s| s["worldId"].as_str()),
                    args["kind"].as_str()
                ],
                |r| r.get::<_, String>(0),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let wanted = args["tags"].as_array();
        let mut scored = Vec::new();
        for raw in rows {
            let item: Value = serde_json::from_str(&raw)?;
            if wanted.is_some_and(|tags| {
                tags.iter()
                    .any(|t| !item["tags"].as_array().unwrap().contains(t))
            }) {
                continue;
            }
            let hay = format!(
                "{} {} {}",
                item["name"].as_str().unwrap_or(""),
                item["description"].as_str().unwrap_or(""),
                item["tags"]
            )
            .to_lowercase();
            let score = if query.is_empty() {
                1
            } else if hay.contains(&query) {
                100
            } else {
                query
                    .chars()
                    .filter(|c| !c.is_whitespace() && hay.contains(*c))
                    .count()
            };
            if score > 0 {
                scored.push((score, item));
            }
        }
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        let total = scored.len();
        let items = scored
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .map(|(_, item)| item)
            .collect::<Vec<_>>();
        Ok(
            json!({"items":items,"offset":offset,"limit":limit,"total":total,"next":if offset+limit<total as u64{Some(offset+limit)}else{None}}),
        )
    }
}
