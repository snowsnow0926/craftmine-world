//! Static installer planning: turns a validated package into a deterministic
//! install plan (dependency order, new identity, entity map, conflicts) before
//! any scene, project file or database row is touched.
//!
//! The plan is data. R3's materializer executes it inside a draft and C/R2 turn
//! that draft into a candidate and a formal application; this module never
//! writes a world.
use super::package_format as format;
use super::super::{digest, durable::fields};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

#[cfg(test)]
#[path = "installer_tests.rs"]
mod tests;

/// Conflicts that block an install unless the player resolves them.
const CONFLICT_KEYS: &[(&str, &str)] = &[
    ("inputActions", "PACKAGE_CONFLICT_INPUT_ACTION"),
    ("autoloads", "PACKAGE_CONFLICT_AUTOLOAD"),
    ("globalClasses", "PACKAGE_CONFLICT_GLOBAL_CLASS"),
    ("uids", "PACKAGE_CONFLICT_UID"),
    ("paths", "PACKAGE_CONFLICT_PATH"),
    ("entityIds", "PACKAGE_CONFLICT_ENTITY_ID"),
];

fn strings(value: &Value, key: &str) -> Result<Vec<String>> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(items) => items
            .as_array()
            .context("STRING_ARRAY_REQUIRED")?
            .iter()
            .map(|item| {
                item.as_str()
                    .filter(|text| !text.is_empty() && text.len() <= 240)
                    .context("INVALID_DECLARATION")
                    .map(str::to_owned)
            })
            .collect(),
    }
}

fn label(id: &str, version: u64) -> String {
    format!("{id}@{version}")
}

fn instance_id(operation: &str, asset: &str) -> String {
    format!("ins-{}", &digest(&format!("craftmine.instance:{operation}:{asset}"))[..24])
}

fn entity_id(instance: &str, index: usize) -> String {
    format!("{instance}-e{index}")
}

struct Resource {
    asset_id: String,
    version: u64,
    kind: String,
    content_hash: String,
    dependencies: Vec<String>,
    compatibility: Value,
    interfaces: Value,
    entities: Vec<String>,
}

impl Resource {
    fn parse(manifest: &Value) -> Result<Resource> {
        let normalized = format::validate_resource_manifest(manifest)?;
        let content = &normalized["content"];
        let asset_id = content["assetId"].as_str().context("INVALID_ASSET_ID")?.to_owned();
        let version = content["version"].as_u64().context("INVALID_VERSION")?;
        let dependencies = content["dependencies"]
            .as_array()
            .context("DEPENDENCIES_REQUIRED")?
            .iter()
            .map(|item| {
                let id = item["id"].as_str().context("INVALID_ASSET_ID")?;
                let version = item["version"].as_u64().context("INVALID_VERSION")?;
                Ok(label(id, version))
            })
            .collect::<Result<Vec<_>>>()?;
        let entities = content["entry"]["entities"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .map(|item| {
                        item.as_str()
                            .or_else(|| item["id"].as_str())
                            .filter(|id| !id.is_empty() && id.len() <= 120)
                            .context("INVALID_TEMPLATE_ENTITY")
                            .map(str::to_owned)
                    })
                    .collect::<Result<Vec<_>>>()
            })
            .transpose()?
            .unwrap_or_default();
        Ok(Resource {
            asset_id,
            version,
            kind: content["kind"].as_str().context("INVALID_PACKAGE_KIND")?.to_owned(),
            content_hash: normalized["contentHash"].as_str().unwrap().to_owned(),
            dependencies,
            compatibility: content["compatibility"].clone(),
            interfaces: content["interfaces"].clone(),
            entities,
        })
    }

    fn label(&self) -> String {
        label(&self.asset_id, self.version)
    }
}

/// Dependencies first, stable by asset label. A missing dependency or a cycle
/// is an explicit failure, never a partial install.
fn order(resources: &BTreeMap<String, Resource>, roots: &[String]) -> Result<Vec<String>> {
    let mut ordered = Vec::new();
    let mut visited = BTreeSet::new();
    fn visit(
        resources: &BTreeMap<String, Resource>,
        node: &str,
        path: &mut Vec<String>,
        visited: &mut BTreeSet<String>,
        ordered: &mut Vec<String>,
    ) -> Result<()> {
        if visited.contains(node) {
            return Ok(());
        }
        if let Some(index) = path.iter().position(|item| item == node) {
            let mut cycle = path[index..].to_vec();
            cycle.push(node.to_owned());
            anyhow::bail!("PACKAGE_DEPENDENCY_CYCLE: {}", cycle.join(" -> "));
        }
        let resource = resources
            .get(node)
            .ok_or_else(|| anyhow::anyhow!("PACKAGE_MISSING_DEPENDENCY: {}", node))?;
        path.push(node.to_owned());
        for dependency in &resource.dependencies {
            visit(resources, dependency, path, visited, ordered)?;
        }
        path.pop();
        visited.insert(node.to_owned());
        ordered.push(node.to_owned());
        Ok(())
    }
    let mut sorted = roots.to_vec();
    sorted.sort();
    for root in &sorted {
        visit(resources, root, &mut Vec::new(), &mut visited, &mut ordered)?;
    }
    ensure!(ordered.len() == resources.len(), "PACKAGE_LOCK_UNREACHABLE_ENTRY");
    Ok(ordered)
}

fn compatibility_conflicts(resource: &Resource, target: &Value) -> Vec<Value> {
    let mut conflicts = Vec::new();
    let declared = &resource.compatibility;
    for (key, code) in [
        ("base", "PACKAGE_INCOMPATIBLE_BASE"),
        ("engine", "PACKAGE_INCOMPATIBLE_ENGINE"),
        ("stateFormat", "PACKAGE_INCOMPATIBLE_STATE_FORMAT"),
    ] {
        if let Some(required) = declared[key].as_str() {
            let actual = target[key].as_str().unwrap_or("");
            if required != actual {
                conflicts.push(json!({"code": code, "asset": resource.label(),
                    "detail": format!("requires {key} {required} but the world is {actual}")}));
            }
        }
    }
    if let Some(required) = declared["baseVersion"].as_str() {
        let actual = target["baseVersion"].as_str().unwrap_or("");
        if actual != required {
            conflicts.push(json!({"code": "PACKAGE_INCOMPATIBLE_BASE_VERSION",
                "asset": resource.label(),
                "detail": format!("requires baseVersion {required} but the world is {actual}")}));
        }
    }
    conflicts
}

impl super::super::TaskJournal {
    /// Plans an install. `resources` are the package's validated manifests;
    /// `target.inventory` is the destination world's existing names.
    pub fn package_plan_install(&self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "resources", "target", "options"])?;
        let operation = args["operationId"]
            .as_str()
            .filter(|value| !value.is_empty() && value.len() <= 240)
            .context("OPERATION_ID_REQUIRED")?;
        let target = &args["target"];
        fields(target, &["worldId", "base", "baseVersion", "engine", "stateFormat", "inventory"])?;
        let inventory = &target["inventory"];
        fields(inventory, &["inputActions", "autoloads", "globalClasses", "uids", "paths", "entityIds"])?;
        let options = &args["options"];
        fields(options, &["allowInputActionRemap"])?;
        let allow_remap = options["allowInputActionRemap"].as_bool().unwrap_or(false);

        let mut resources = BTreeMap::new();
        let mut requested = Vec::new();
        for manifest in args["resources"].as_array().context("RESOURCES_REQUIRED")? {
            let resource = Resource::parse(manifest)?;
            requested.push(resource.label());
            ensure!(
                resources.insert(resource.label(), resource).is_none(),
                "PACKAGE_VERSION_CONFLICT"
            );
        }
        let mut depended = BTreeSet::new();
        for resource in resources.values() {
            for dependency in &resource.dependencies {
                ensure!(
                    resources.contains_key(dependency),
                    "PACKAGE_MISSING_DEPENDENCY: {}",
                    dependency
                );
                depended.insert(dependency.clone());
            }
        }
        let roots = requested
            .iter()
            .filter(|label| !depended.contains(*label))
            .cloned()
            .collect::<Vec<_>>();
        // A set where every entry is depended upon can only be a cycle; start
        // the walk from every entry so the cycle is reported, not a fake root.
        let roots = if roots.is_empty() {
            requested.clone()
        } else {
            roots
        };
        let ordered = order(&resources, &roots)?;

        let mut instances = Vec::new();
        let mut conflicts = Vec::new();
        let mut remapped = Vec::new();
        let mut instance_of: BTreeMap<String, String> = BTreeMap::new();
        for label in &ordered {
            let resource = &resources[label];
            let instance = instance_id(operation, &resource.asset_id);
            instance_of.insert(label.clone(), instance.clone());
            conflicts.extend(compatibility_conflicts(resource, target));
            for (key, code) in CONFLICT_KEYS {
                let declared = strings(&resource.interfaces, key)?;
                let existing = strings(inventory, key)?.into_iter().collect::<BTreeSet<_>>();
                for name in declared {
                    if !existing.contains(&name) {
                        continue;
                    }
                    if *key == "inputActions" && allow_remap {
                        remapped.push(json!({"asset": resource.label(), "inputAction": name,
                            "to": format!("{instance}-{name}")}));
                    } else {
                        conflicts.push(json!({"code": code, "asset": resource.label(),
                            "detail": format!("{key} {name} already exists in the world")}));
                    }
                }
            }
            let mut entity_map = Map::new();
            for (index, template) in resource.entities.iter().enumerate() {
                entity_map.insert(template.clone(), json!(entity_id(&instance, index)));
            }
            instances.push(json!({"assetId": resource.asset_id, "version": resource.version,
                "kind": resource.kind, "contentHash": resource.content_hash,
                "instanceId": instance, "entityMap": entity_map,
                "dependencies": resource.dependencies, "localOverrides": []}));
        }
        let graph = resources
            .iter()
            .map(|(label, resource)| (label.clone(), json!(resource.dependencies)))
            .collect::<Map<_, _>>();
        let direct = roots.clone();
        let closure = resources.keys().cloned().collect::<Vec<_>>();
        Ok(json!({"ok": conflicts.is_empty(), "operationId": operation,
            "worldId": target["worldId"],
            "order": ordered,
            "instances": instances,
            "remappedInputActions": remapped,
            "conflicts": conflicts,
            "lock": {"format": format::LOCK_FORMAT, "direct": direct,
                "closure": closure, "graph": graph},
            "applied": false,
            "note": "plan only; R3's materializer must execute it inside a draft"}))
    }
}
