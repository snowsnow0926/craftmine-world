//! VM2: durable Git reference transaction for content application.
//!
//! Applying a candidate touches four things that do not share one atomic
//! transaction: the Git reference, the SQLite deployment record, asset bodies
//! and the running instance. This module owns only the Git half and the durable
//! operation log around it, so a crash at any point can be explained instead of
//! being guessed:
//!
//! 1. `prepare` writes the intent, including the expected old reference values.
//! 2. `advance` moves `refs/craftmine/applied/<world>` with compare-and-swap.
//! 3. the caller commits its own deployment, progress and receipt rows.
//! 4. `confirm` records that the Git half and the database agree.
//!
//! `recover` never decides that an operation succeeded. It reports what the Git
//! side proves and leaves the final deployment decision to the owner of the
//! deployment record (agent A), so a lost response cannot become a duplicate
//! application.

use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    contract::{validate_identifier, validate_oid, validate_sha256, OperationContext},
    repo::RepositoryStore,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationKind {
    Apply,
    Restore,
    Branch,
}

impl OperationKind {
    fn as_str(self) -> &'static str {
        match self {
            OperationKind::Apply => "apply",
            OperationKind::Restore => "restore",
            OperationKind::Branch => "branch",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "apply" => Ok(OperationKind::Apply),
            "restore" => Ok(OperationKind::Restore),
            "branch" => Ok(OperationKind::Branch),
            other => anyhow::bail!("CONTENT_OPERATION_KIND_UNKNOWN: {other}"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationState {
    /// Intent written; the Git reference has not moved.
    Prepared,
    /// The Git reference points at the target; the database has not confirmed.
    ReferenceAdvanced,
    /// Git reference and database record agree.
    Committed,
    /// Explicitly abandoned; the reference was not moved.
    Aborted,
}

impl OperationState {
    fn as_str(self) -> &'static str {
        match self {
            OperationState::Prepared => "prepared",
            OperationState::ReferenceAdvanced => "ref-advanced",
            OperationState::Committed => "committed",
            OperationState::Aborted => "aborted",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "prepared" => Ok(OperationState::Prepared),
            "ref-advanced" => Ok(OperationState::ReferenceAdvanced),
            "committed" => Ok(OperationState::Committed),
            "aborted" => Ok(OperationState::Aborted),
            other => anyhow::bail!("CONTENT_OPERATION_STATE_UNKNOWN: {other}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceIntent {
    pub operation_id: String,
    pub world_id: String,
    pub repo_id: String,
    pub branch_id: String,
    pub kind: OperationKind,
    pub state: OperationState,
    pub expected_head_oid: Option<String>,
    pub expected_applied_oid: Option<String>,
    pub expected_progress_revision: Option<u64>,
    pub target_oid: String,
    pub detail: String,
    /// The formally applied, launch-confirmed Godot application that proved this
    /// operation. `None` until `confirm` binds one.
    pub application_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// What the Git side proves after a restart. The caller still decides whether
/// the world is complete; nothing here is reported as "applied".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum RecoveryAction {
    /// The reference already points at the target. The caller must either
    /// finish its deployment record or roll the reference back.
    Complete {
        operation_id: String,
        target_oid: String,
    },
    /// The reference never moved. The operation can be aborted safely.
    RollBack {
        operation_id: String,
        expected_applied_oid: Option<String>,
    },
    /// The reference moved somewhere unexpected. Freeze writes and inspect.
    Conflict {
        operation_id: String,
        observed_oid: Option<String>,
        detail: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub world_id: String,
    pub applied_oid: Option<String>,
    pub actions: Vec<RecoveryAction>,
}

pub(crate) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_content_operations (
            operation_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            repo_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('apply','restore','branch')),
            state TEXT NOT NULL CHECK(state IN ('prepared','ref-advanced','committed','aborted')),
            expected_head_oid TEXT,
            expected_applied_oid TEXT,
            expected_progress_revision INTEGER,
            target_oid TEXT NOT NULL,
            detail TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS craftmine_content_operation_receipts (
            operation_id TEXT NOT NULL,
            tool_call_id TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            result TEXT NOT NULL,
            PRIMARY KEY(operation_id, tool_call_id)
        );",
    )?;
    // The deployment that proved an operation was added after the first release
    // of this table; it is additive and backfilled as NULL.
    let present: bool = db.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('craftmine_content_operations') WHERE name='application_id'",
        [],
        |row| row.get::<_, i64>(0).map(|count| count > 0),
    )?;
    if !present {
        db.execute(
            "ALTER TABLE craftmine_content_operations ADD COLUMN application_id TEXT",
            [],
        )?;
    }
    Ok(())
}

fn applied_ref(world: &str) -> Result<String> {
    validate_identifier(world, "INVALID_WORLD_ID")?;
    Ok(format!("refs/craftmine/applied/{world}"))
}

fn load(db: &Connection, operation_id: &str) -> Result<ReferenceIntent> {
    validate_identifier(operation_id, "INVALID_OPERATION_ID")?;
    let row = db
        .query_row(
            "SELECT world_id,repo_id,branch_id,kind,state,expected_head_oid,expected_applied_oid,
                    expected_progress_revision,target_oid,detail,created_at,updated_at,application_id
             FROM craftmine_content_operations WHERE operation_id=?1",
            [operation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, Option<String>>(12)?,
                ))
            },
        )
        .optional()?
        .context("CONTENT_OPERATION_NOT_FOUND")?;
    Ok(ReferenceIntent {
        operation_id: operation_id.to_string(),
        world_id: row.0,
        repo_id: row.1,
        branch_id: row.2,
        kind: OperationKind::parse(&row.3)?,
        state: OperationState::parse(&row.4)?,
        expected_head_oid: row.5,
        expected_applied_oid: row.6,
        expected_progress_revision: row.7.map(u64::try_from).transpose()?,
        target_oid: row.8,
        detail: row.9,
        created_at: row.10,
        updated_at: row.11,
        application_id: row.12,
    })
}

/// Read one durable operation intent. A caller that lost a response can use this
/// to observe the same operation by its stable id instead of applying again.
pub fn intent(db: &Connection, operation_id: &str) -> Result<ReferenceIntent> {
    load(db, operation_id)
}

/// Write the durable intent. Repeating the same call is idempotent; reusing an
/// operation id for different content is refused.
pub fn prepare(
    db: &mut Connection,
    context: &OperationContext,
    kind: OperationKind,
    target_oid: &str,
    detail: &str,
) -> Result<ReferenceIntent> {
    context.validate()?;
    validate_oid(target_oid)?;
    ensure!(detail.len() <= 4_000, "CONTENT_OPERATION_DETAIL_TOO_LONG");
    let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some(existing) = transaction
        .query_row(
            "SELECT target_oid,state FROM craftmine_content_operations WHERE operation_id=?1",
            [&context.operation_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    {
        let state = OperationState::parse(&existing.1)?;
        let old=load(&transaction,&context.operation_id)?;
        ensure!(
            existing.0 == target_oid && old.world_id==context.world_id && old.repo_id==context.repo_id
                && old.branch_id==context.branch_id && old.kind==kind
                && old.expected_head_oid==context.expected_head_oid && old.expected_applied_oid==context.expected_applied_oid
                && old.expected_progress_revision==context.expected_progress_revision,
            "CONTENT_OPERATION_ID_REUSED: {}",
            context.operation_id
        );
        ensure!(
            matches!(state, OperationState::Prepared | OperationState::ReferenceAdvanced | OperationState::Committed),
            "CONTENT_OPERATION_CLOSED: {} is {}",
            context.operation_id,
            existing.1
        );
        transaction.commit()?;
        return load(db, &context.operation_id);
    }
    let now = crate::worlds::timestamp()?;
    transaction.execute(
        "INSERT INTO craftmine_content_operations
         (operation_id,world_id,repo_id,branch_id,kind,state,expected_head_oid,expected_applied_oid,
          expected_progress_revision,target_oid,detail,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,'prepared',?6,?7,?8,?9,?10,?11,?11)",
        params![
            context.operation_id,
            context.world_id,
            context.repo_id,
            context.branch_id,
            kind.as_str(),
            context.expected_head_oid,
            context.expected_applied_oid,
            context.expected_progress_revision.map(i64::try_from).transpose()?,
            target_oid,
            detail,
            now
        ],
    )?;
    transaction.commit()?;
    load(db, &context.operation_id)
}

/// Move the applied reference with compare-and-swap on the expected old value.
pub fn advance(
    db: &mut Connection,
    store: &RepositoryStore,
    operation_id: &str,
) -> Result<ReferenceIntent> {
    let intent = load(db, operation_id)?;
    if intent.state==OperationState::Committed {return Ok(intent);}
    if intent.state == OperationState::ReferenceAdvanced {
        // Replaying a completed Git half is idempotent, but only if the
        // reference really is where the intent says.
        let layout = store.open_existing(&intent.repo_id)?;
        let observed = store
            .git()
            .ref_value(&layout.git_dir, &applied_ref(&intent.world_id)?)?;
        ensure!(
            observed.as_deref() == Some(intent.target_oid.as_str()),
            "CONTENT_OPERATION_REF_MOVED: {observed:?}"
        );
        return Ok(intent);
    }
    ensure!(
        intent.state == OperationState::Prepared,
        "CONTENT_OPERATION_STATE: {} is {}",
        operation_id,
        intent.state.as_str()
    );
    let layout = store.open_existing(&intent.repo_id)?;
    ensure!(store.branch_head(&layout,&intent.branch_id)?==intent.expected_head_oid,"CONTENT_EXPECTED_HEAD_MISMATCH");
    let ref_name = applied_ref(&intent.world_id)?;
    let observed = store.git().ref_value(&layout.git_dir, &ref_name)?;
    if observed.as_deref() == Some(intent.target_oid.as_str()) {
        // A previous attempt already moved it; the intent is the record of why.
        return finish_advance(db, operation_id, "already at target");
    }
    store.git().update_ref(
        &layout.git_dir,
        &ref_name,
        &intent.target_oid,
        intent.expected_applied_oid.as_deref(),
    )?;
    finish_advance(db, operation_id, "reference advanced")
}

fn finish_advance(db: &mut Connection, operation_id: &str, detail: &str) -> Result<ReferenceIntent> {
    let now = crate::worlds::timestamp()?;
    db.execute(
        "UPDATE craftmine_content_operations
         SET state='ref-advanced', detail=?2, updated_at=?3 WHERE operation_id=?1",
        params![operation_id, detail, now],
    )?;
    load(db, operation_id)
}

/// Trusted proof that a formal, launch-confirmed Godot deployment published the
/// exact Git content an operation targets.
///
/// The caller resolves this from the durable application record; it is never
/// built from a caller-supplied object id or a free-text "deployment" string.
/// `confirm` refuses to commit without it, so Git content, the SQLite deployment,
/// the check result and the latest formal progress are bound to one operation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentEvidence {
    /// The applied `craftmine_godot_applications` row.
    pub application_id: String,
    /// The build the application published.
    pub build_id: String,
    /// `craftmine_godot_builds.content_oid`: the Git commit the build was made from.
    pub content_oid: String,
    /// The checked candidate the application consumed.
    pub candidate_id: String,
    /// The passed check job and its output hash.
    pub check_job_id: String,
    pub check_output_hash: String,
    /// The formal world revision the application was prepared against.
    pub input_revision: u64,
    /// The formal world revision after the application committed.
    pub world_revision: u64,
    /// The instance that really launched the build.
    pub instance_id: String,
}

/// Record that the deployment record now agrees with the Git reference.
///
/// The caller passes the *resolved* deployment, so a mismatched or forged
/// deployment can never be silently marked complete.
pub fn confirm(
    db: &mut Connection,
    store: &RepositoryStore,
    operation_id: &str,
    evidence: &DeploymentEvidence,
    detail: &str,
) -> Result<ReferenceIntent> {
    validate_oid(&evidence.content_oid)?;
    validate_identifier(&evidence.application_id, "INVALID_APPLICATION_ID")?;
    validate_identifier(&evidence.build_id, "INVALID_GODOT_BUILD")?;
    validate_identifier(&evidence.candidate_id, "INVALID_GODOT_CANDIDATE")?;
    validate_identifier(&evidence.check_job_id, "INVALID_GODOT_JOB")?;
    validate_sha256(&evidence.check_output_hash)?;
    ensure!(
        !evidence.instance_id.trim().is_empty() && evidence.instance_id.len() <= 240,
        "GODOT_LAUNCH_REQUIRED"
    );
    ensure!(detail.len() <= 4_000, "CONTENT_OPERATION_DETAIL_TOO_LONG");
    let intent = load(db, operation_id)?;
    // A lost response is answered from the same operation instead of applying
    // again. The same deployment may confirm twice; a different one is a replay.
    if intent.state == OperationState::Committed {
        ensure!(
            intent.application_id.as_deref() == Some(evidence.application_id.as_str()),
            "REPLAY_MISMATCH: {operation_id} was confirmed by {:?}",
            intent.application_id
        );
        return Ok(intent);
    }
    ensure!(
        intent.state == OperationState::ReferenceAdvanced,
        "CONTENT_OPERATION_STATE: {} is {}",
        operation_id,
        intent.state.as_str()
    );
    ensure!(
        evidence.content_oid == intent.target_oid,
        "CONTENT_OPERATION_TARGET_MISMATCH: deployment {} != target {}",
        evidence.content_oid,
        intent.target_oid
    );
    // The deployment must have been prepared against exactly the formal progress
    // this operation expected, and must be the only step that advanced it.
    if let Some(expected) = intent.expected_progress_revision {
        ensure!(
            evidence.input_revision == expected,
            "CONTENT_PROGRESS_CONFLICT: deployment prepared at revision {} but the operation expected {}",
            evidence.input_revision,
            expected
        );
        ensure!(
            evidence.world_revision == expected + 1,
            "CONTENT_PROGRESS_CONFLICT: world revision {} is not one step past the expected {}",
            evidence.world_revision,
            expected
        );
    }
    let layout = store.open_existing(&intent.repo_id)?;
    let observed = store
        .git()
        .ref_value(&layout.git_dir, &applied_ref(&intent.world_id)?)?;
    ensure!(
        observed.as_deref() == Some(intent.target_oid.as_str()),
        "CONTENT_OPERATION_REF_MOVED: {observed:?}"
    );
    let now = crate::worlds::timestamp()?;
    db.execute(
        "UPDATE craftmine_content_operations
         SET state='committed', application_id=?4, detail=?2, updated_at=?3 WHERE operation_id=?1",
        params![operation_id, detail, now, evidence.application_id],
    )?;
    load(db, operation_id)
}

/// Abandon a prepared operation. The reference must not have moved.
pub fn abort(db: &mut Connection, operation_id: &str, reason: &str) -> Result<ReferenceIntent> {    let intent = load(db, operation_id)?;
    ensure!(
        intent.state == OperationState::Prepared,
        "CONTENT_OPERATION_STATE: {} is {}",
        operation_id,
        intent.state.as_str()
    );
    let now = crate::worlds::timestamp()?;
    db.execute(
        "UPDATE craftmine_content_operations
         SET state='aborted', detail=?2, updated_at=?3 WHERE operation_id=?1",
        params![operation_id, reason, now],
    )?;
    load(db, operation_id)
}

/// Undo the Git half after the reference advanced but before the deployment
/// record was confirmed. This is the recovery path for a crash between
/// `advance` and `confirm`.
pub fn rollback(
    db: &mut Connection,
    store: &RepositoryStore,
    operation_id: &str,
    reason: &str,
) -> Result<ReferenceIntent> {
    let intent = load(db, operation_id)?;
    ensure!(
        matches!(
            intent.state,
            OperationState::Prepared | OperationState::ReferenceAdvanced
        ),
        "CONTENT_OPERATION_STATE: {} is {}",
        operation_id,
        intent.state.as_str()
    );
    let layout = store.open_existing(&intent.repo_id)?;
    let ref_name = applied_ref(&intent.world_id)?;
    let observed = store.git().ref_value(&layout.git_dir, &ref_name)?;
    if observed.as_deref() == Some(intent.target_oid.as_str()) {
        match &intent.expected_applied_oid {
            Some(expected) => {
                store
                    .git()
                    .update_ref(&layout.git_dir, &ref_name, expected, Some(&intent.target_oid))?
            }
            None => store
                .git()
                .delete_ref(&layout.git_dir, &ref_name, &intent.target_oid)?,
        }
    }
    let now = crate::worlds::timestamp()?;
    db.execute(
        "UPDATE craftmine_content_operations
         SET state='aborted', detail=?2, updated_at=?3 WHERE operation_id=?1",
        params![operation_id, reason, now],
    )?;
    load(db, operation_id)
}

/// Restart-time reconciliation for one world. Only unresolved operations are
/// reported; committed and aborted ones are ignored.
pub fn recover(
    db: &Connection,
    store: &RepositoryStore,
    world: &str,
) -> Result<RecoveryReport> {
    validate_identifier(world, "INVALID_WORLD_ID")?;
    let mut statement = db.prepare(
        "SELECT operation_id,repo_id,target_oid,expected_applied_oid,state
         FROM craftmine_content_operations
         WHERE world_id=?1 AND state IN ('prepared','ref-advanced')
         ORDER BY created_at ASC",
    )?;
    let rows = statement.query_map([world], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut actions = Vec::new();
    let mut applied_oid = None;
    for row in rows {
        let (operation_id, repo_id, target_oid, expected_applied, state) = row?;
        let state = OperationState::parse(&state)?;
        let layout = store.open_existing(&repo_id)?;
        let observed = store
            .git()
            .ref_value(&layout.git_dir, &applied_ref(world)?)?;
        applied_oid = observed.clone();
        if observed.as_deref() == Some(target_oid.as_str()) {
            actions.push(RecoveryAction::Complete {
                operation_id,
                target_oid,
            });
            continue;
        }
        if observed == expected_applied {
            actions.push(RecoveryAction::RollBack {
                operation_id,
                expected_applied_oid: expected_applied,
            });
            continue;
        }
        actions.push(RecoveryAction::Conflict {
            operation_id,
            observed_oid: observed,
            detail: format!("state {state:?} does not match the applied reference"),
        });
    }
    Ok(RecoveryReport {
        world_id: world.to_string(),
        applied_oid,
        actions,
    })
}

/// Durable tool receipt. A lost response is answered by looking up the original
/// operation instead of applying again.
pub fn receipt(
    db: &mut Connection,
    operation_id: &str,
    tool_call_id: &str,
    request_hash: &str,
) -> Result<Option<Value>> {
    validate_identifier(operation_id, "INVALID_OPERATION_ID")?;
    validate_identifier(tool_call_id, "INVALID_CALL_ID")?;
    let prior: Option<(String, String)> = db
        .query_row(
            "SELECT request_hash,result FROM craftmine_content_operation_receipts
             WHERE operation_id=?1 AND tool_call_id=?2",
            params![operation_id, tool_call_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    prior
        .map(|(stored, result)| {
            ensure!(stored == request_hash, "REPLAY_MISMATCH");
            Ok(serde_json::from_str(&result)?)
        })
        .transpose()
}

/// Store the receipt for a finished call. The same call id cannot store a
/// different result.
pub fn store_receipt(
    db: &mut Connection,
    operation_id: &str,
    tool_call_id: &str,
    request_hash: &str,
    result: &Value,
) -> Result<()> {
    validate_identifier(operation_id, "INVALID_OPERATION_ID")?;
    validate_identifier(tool_call_id, "INVALID_CALL_ID")?;
    ensure!(request_hash.len() == 64, "INVALID_REQUEST_HASH");
    let body = serde_json::to_string(result)?;
    let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some((stored, existing)) = transaction
        .query_row(
            "SELECT request_hash,result FROM craftmine_content_operation_receipts
             WHERE operation_id=?1 AND tool_call_id=?2",
            params![operation_id, tool_call_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    {
        ensure!(stored == request_hash, "REPLAY_MISMATCH");
        ensure!(existing == body, "REPLAY_MISMATCH");
        transaction.commit()?;
        return Ok(());
    }
    transaction.execute(
        "INSERT INTO craftmine_content_operation_receipts(operation_id,tool_call_id,request_hash,result)
         VALUES(?1,?2,?3,?4)",
        params![operation_id, tool_call_id, request_hash, body],
    )?;
    transaction.commit()?;
    Ok(())
}
