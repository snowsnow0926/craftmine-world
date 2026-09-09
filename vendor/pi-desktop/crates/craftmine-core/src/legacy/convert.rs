//! Legacy conversion writes a copy. The sealed archive and any existing world
//! stay byte-identical, and every content type is reported as supported,
//! needs-review or unsupported instead of pretending old code just runs.
use super::super::{
    digest,
    durable::{fields, text},
    worlds::{self, WorldDocument},
    TaskJournal,
};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

#[cfg(test)]
#[path = "convert_tests.rs"]
mod tests;

pub(super) fn migrate(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_legacy_conversions (
      operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL);",
    )?;
    Ok(())
}

fn entry(status: &str, code: &str, detail: String) -> Value {
    json!({"status": status, "code": code, "detail": detail})
}

/// Asset formats this build can carry over. Anything else is reported by name
/// instead of being claimed as supported because the engine could import it.
fn asset_support(record: &Value) -> (&'static str, String) {
    let format = record["format"]
        .as_str()
        .or_else(|| record["mime"].as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let animated = record["animations"]
        .as_array()
        .is_some_and(|items| !items.is_empty())
        || record
            .get("skeleton")
            .is_some_and(|value| !value.is_null())
        || record.get("skins").is_some_and(|value| !value.is_null());
    if format.contains("png") || format.contains("jpeg") || format.contains("jpg") {
        ("supported", format!("{format} static image"))
    } else if format.contains("glb") {
        if animated {
            (
                "unsupported",
                "animated or skinned GLB stays on the legacy base".into(),
            )
        } else {
            ("supported", "static GLB".into())
        }
    } else if format.contains("gltf") || format.contains("fbx") || format.contains("mp3") {
        ("unsupported", format!("{format} is not converted"))
    } else {
        ("needsReview", format!("unknown asset format {format}"))
    }
}

impl TaskJournal {
    fn legacy_report(&self, import: &str, project: &Value, converted: bool) -> Result<Value> {
        let mut supported = Vec::new();
        let mut needs_review = Vec::new();
        let mut unsupported = Vec::new();
        {
            let mut push = |status: &str, value: Value| match status {
                "supported" => supported.push(value),
                "needsReview" => needs_review.push(value),
                _ => unsupported.push(value),
            };
            let current = project["current"]
                .as_str()
                .context("LEGACY_PROJECT_VERSION_REQUIRED")?;
            let build = self.legacy_read(import, &format!("builds/{current}/build.json"))?;
            let scene = &build["scene"];
            let objects = scene["objects"].as_array().map(Vec::len).unwrap_or(0);
            let systems = scene["systems"].as_array().map(Vec::len).unwrap_or(0);
            let behaviors = scene["behaviors"].as_array().map(Vec::len).unwrap_or(0);
            push(
                "supported",
                entry(
                    "supported",
                    "geometry",
                    format!("{objects} objects keep position, size and collision"),
                ),
            );
            push(
                "supported",
                entry(
                    "supported",
                    "systems",
                    format!("{systems} gameplay systems keep their configuration"),
                ),
            );
            for asset in project["assets"]
                .as_array()
                .cloned()
                .unwrap_or_default()
            {
                let id = asset["id"].as_str().context("LEGACY_ASSET_ID_REQUIRED")?;
                for version in asset["versions"].as_array().cloned().unwrap_or_default() {
                    let number = version["version"]
                        .as_u64()
                        .context("LEGACY_ASSET_VERSION_REQUIRED")?;
                    let record =
                        self.legacy_read(import, &format!("assets/{id}/{number}.json"))?;
                    let (status, detail) = asset_support(&record);
                    push(
                        status,
                        entry(status, "asset", format!("{id}@{number}: {detail}")),
                    );
                }
            }
            if behaviors > 0 {
                push(
                    "unsupported",
                    entry(
                        "unsupported",
                        "legacy-gameplay",
                        format!("{behaviors} legacy JavaScript behaviors are not executed on the new base"),
                    ),
                );
            }
            match project["snapshot"]["format"].as_str().unwrap_or("") {
                "craftmine.progress/2" | "craftmine.progress/3" => push(
                    "supported",
                    entry(
                        "supported",
                        "progress",
                        "player, inventory, health, equipment and quests keep their values".into(),
                    ),
                ),
                "craftmine.progress/1" => {
                    push(
                        "supported",
                        entry(
                            "supported",
                            "progress",
                            "player position and rotation keep their values".into(),
                        ),
                    );
                    push(
                        "needsReview",
                        entry(
                            "needsReview",
                            "progress",
                            "inventory, health, equipment and quests need an explicit state version"
                                .into(),
                        ),
                    );
                }
                other => push(
                    "needsReview",
                    entry(
                        "needsReview",
                        "progress",
                        format!("unknown progress format {other}"),
                    ),
                ),
            }
            push(
                "needsReview",
                entry(
                    "needsReview",
                    "ownership",
                    "sessions, requirements and memories keep their source but are rebound to the copy"
                        .into(),
                ),
            );
        }
        let total = supported.len() + needs_review.len() + unsupported.len();
        Ok(json!({"supported": supported, "needsReview": needs_review,
            "unsupported": unsupported, "total": total, "converted": converted}))
    }

    /// A conversion is always a new world. `compiled` is the trusted
    /// compatibility compiler output; without it the copy keeps the legacy
    /// base and the report says so.
    pub fn legacy_convert(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "importId", "title", "compiled"])?;
        let operation = text(args, "operationId", 240)?;
        let import = text(args, "importId", 80)?;
        worlds::validate_id(import)?;
        let title = text(args, "title", 80)?;
        let request_hash = digest(&serde_json::to_string(args)?);
        let prior: Option<(String, String)> = self
            .db
            .query_row(
                "SELECT request_hash,result FROM craftmine_legacy_conversions WHERE operation_id=?1",
                [operation],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((old, result)) = prior {
            ensure!(old == request_hash, "REPLAY_MISMATCH");
            return Ok(serde_json::from_str(&result)?);
        }
        // The archive is re-hashed first, so a conversion can never publish
        // bytes that differ from what was captured.
        self.verify_archive(import)?;
        let manifest_hash = self.legacy_manifest_hash(import)?;
        let project = self.legacy_read(import, "project.json")?;
        ensure!(
            project["format"] == "craftmine.project/1",
            "LEGACY_PROJECT_FORMAT"
        );
        let world_id = format!(
            "legacy-{}",
            &digest(&format!("{import}:{manifest_hash}"))[..12]
        );
        let (document, converted) = match args.get("compiled") {
            None | Some(Value::Null) => {
                let current = project["current"]
                    .as_str()
                    .context("LEGACY_PROJECT_VERSION_REQUIRED")?;
                let build = self.legacy_read(import, &format!("builds/{current}/build.json"))?;
                ensure!(project["snapshot"].is_object(), "LEGACY_SNAPSHOT_REQUIRED");
                (
                    WorldDocument {
                        build: json!({"id": current, "scene": build["scene"]}),
                        snapshot: project["snapshot"].clone(),
                        extensions: project["extensions"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default(),
                    },
                    false,
                )
            }
            Some(compiled) => {
                fields(compiled, &["build", "snapshot", "extensions"])?;
                (
                    WorldDocument {
                        build: compiled["build"].clone(),
                        snapshot: compiled["snapshot"].clone(),
                        extensions: compiled["extensions"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default(),
                    },
                    true,
                )
            }
        };
        let report = self.legacy_report(import, &project, converted)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_worlds WHERE id=?1)",
            [&world_id],
            |r| r.get(0),
        )?;
        ensure!(!exists, "LEGACY_COPY_EXISTS: {}", world_id);
        worlds::insert(&tx, &world_id, title, &document)?;
        let result = json!({"worldId": world_id, "sourceUnchanged": true,
            "keptOnLegacyBase": !converted, "report": report,
            "sourceImportId": import, "sourceManifestHash": manifest_hash, "revision": 0});
        tx.execute(
            "INSERT INTO craftmine_legacy_conversions(operation_id,request_hash,result) VALUES(?1,?2,?3)",
            params![operation, request_hash, serde_json::to_string(&result)?],
        )?;
        tx.commit()?;
        // The source must still match the sealed manifest after the copy.
        self.verify_archive(import)?;
        Ok(result)
    }
}
