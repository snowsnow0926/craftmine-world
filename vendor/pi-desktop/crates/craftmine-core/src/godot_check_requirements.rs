//! Finite, host-requested runtime expectations. This is not a script evaluator.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::digest;

pub const FORMAT: &str = "craftmine.godot-check-requirements/1";
pub const ASSERTION: &str = "runtime.target-feedback";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Requirements {
    format: String,
    target_feedback: TargetFeedback,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TargetFeedback {
    target_id: String,
    hit_flash_milliseconds: u16,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

impl Requirements {
    pub fn validate(&self, base: &str, mode: &str) -> Result<()> {
        ensure!(base == "first-person" && mode == "check", "GODOT_CHECK_REQUIREMENTS_SCOPE");
        ensure!(self.format == FORMAT && identifier(&self.target_feedback.target_id)
            && (1..=1000).contains(&self.target_feedback.hit_flash_milliseconds),
            "INVALID_GODOT_CHECK_REQUIREMENTS");
        Ok(())
    }

    pub fn hash(&self) -> String {
        digest(&format!("{}\n{}\n{}\n", FORMAT, self.target_feedback.target_id,
            self.target_feedback.hit_flash_milliseconds))
    }
}

pub fn store(db: &Connection, job: &str, requirements: Option<&Requirements>) -> Result<()> {
    if let Some(requirements) = requirements {
        db.execute("UPDATE craftmine_godot_jobs SET check_requirements=?2,check_requirements_hash=?3 WHERE id=?1",
            params![job, serde_json::to_string(requirements)?, requirements.hash()])?;
    }
    Ok(())
}

pub fn read(db: &Connection, job: &str) -> Result<Option<Requirements>> {
    let (body, hash, base, mode): (Option<String>, Option<String>, String, String) = db.query_row(
        "SELECT check_requirements,check_requirements_hash,base_id,kind FROM craftmine_godot_jobs WHERE id=?1",
        [job], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    match (body, hash) {
        (None, None) => Ok(None),
        (Some(body), Some(hash)) => {
            let requirements: Requirements = serde_json::from_str(&body).context("GODOT_CHECK_REQUIREMENTS_CORRUPT")?;
            requirements.validate(&base, &mode).context("GODOT_CHECK_REQUIREMENTS_CORRUPT")?;
            ensure!(hash == requirements.hash(), "GODOT_CHECK_REQUIREMENTS_CORRUPT");
            Ok(Some(requirements))
        },
        _ => anyhow::bail!("GODOT_CHECK_REQUIREMENTS_CORRUPT"),
    }
}

pub fn attach(db: &Connection, job: &str, result: &mut Value) -> Result<()> {
    if let Some(requirements) = read(db, job)? {
        result["checkRequirementsHash"] = json!(requirements.hash());
        result["checkRequirements"] = serde_json::to_value(requirements)?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Evidence {
    format: String,
    requirements_hash: String,
    job_id: String,
    world_id: String,
    build_id: String,
    instance_id: String,
    observations: Vec<Observation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    phase: String,
    target_id: String,
    hit_flash_milliseconds: f64,
}

/// A registered executor remains the runtime trust boundary. The core verifies
/// that its bounded evidence describes this exact immutable check input.
pub fn evidence_matches(requirements: &Requirements, evidence: Option<&Value>, descriptor: &Value) -> bool {
    let Some(evidence) = evidence else { return false; };
    let Ok(evidence) = serde_json::from_value::<Evidence>(evidence.clone()) else { return false; };
    evidence.format == "craftmine.godot-check-requirements-evidence/1"
        && evidence.requirements_hash == requirements.hash()
        && descriptor["format"] == "craftmine.godot-check-descriptor/1"
        && descriptor["phase"] == "check"
        && descriptor["checkRequirementsHash"] == requirements.hash()
        && descriptor["checkRequirements"] == serde_json::to_value(requirements).unwrap_or(Value::Null)
        && descriptor["jobId"] == evidence.job_id
        && descriptor["worldId"] == evidence.world_id
        && descriptor["buildId"] == evidence.build_id
        && identifier(&evidence.instance_id)
        && evidence.observations.len() == 2
        && evidence.observations.iter().zip(["loaded", "running"]).all(|(actual, phase)|
            actual.phase == phase && actual.target_id == requirements.target_feedback.target_id
                && actual.hit_flash_milliseconds.is_finite()
                && (actual.hit_flash_milliseconds - f64::from(requirements.target_feedback.hit_flash_milliseconds)).abs() <= 1e-6)
}
