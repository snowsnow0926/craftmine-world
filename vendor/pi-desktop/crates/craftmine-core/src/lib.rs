//! Durable task state for the Craftmine domain. UI and model processes never
//! own this database. This journal records drafts; publishing a playable world
//! additionally requires the domain compiler and verification service.
use std::{path::Path, time::Duration};

use anyhow::{bail, ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

mod applications;
mod asset_catalog;
// The asset catalog's RPC entry point. Task S5 owns `asset_catalog/**`; this
// re-export is the two-line hook task S1 keeps in the core entry point.
pub use asset_catalog::dispatch as asset_catalog_dispatch;
mod backups;
// The portable archive carries Git objects through the managed repository
// store; R1 owns the module registration and the remaining wiring.
mod content;
mod content_history;
mod durable;
mod godot_applications;
mod godot_builds;
mod godot_host_resources;
mod godot_jobs;
mod godot_projects;
mod godot_runtime;
mod godot_storage;
mod godot_worlds;
mod legacy;
mod library;
mod memories;
mod recovery;
mod reviews;
mod verification;
mod workspaces;
mod worlds;
#[cfg(test)]
mod godot_test_support;
pub use workspaces::WorkspaceContext;
pub use worlds::{WorldDocument, WorldRecord, WorldSummary};

const MAX_DOCUMENT_BYTES: usize = 2_000_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskBinding {
    pub project_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub task_id: String,
    pub base_build: String,
}

impl TaskBinding {
    fn validate(&self) -> Result<()> {
        for value in [
            &self.project_id,
            &self.session_id,
            &self.turn_id,
            &self.task_id,
            &self.base_build,
        ] {
            ensure!(
                !value.trim().is_empty()
                    && value.len() <= 240
                    && !value.chars().any(char::is_control),
                "INVALID_BINDING"
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub binding: TaskBinding,
    pub status: String,
    pub revision: u64,
    pub draft: Value,
    pub draft_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftReceipt {
    pub task_id: String,
    pub tool_call_id: String,
    pub revision: u64,
    pub draft_hash: String,
}

pub struct TaskJournal {
    db: Connection,
    directory: std::path::PathBuf,
    /// Live isolation attestations of registered executors. Deliberately not
    /// durable: a restarted core requires the executor to prove itself again.
    pub(crate) executors: std::collections::BTreeMap<String, godot_jobs::Executor>,
    /// Discovered managed Git program, pinned once per process. `OnceCell`
    /// keeps the probe (version + binary hash) off the hot path without making
    /// the journal shared across threads.
    pub(crate) git: std::cell::OnceCell<content_history::git::GitAdapter>,
}

fn document(value: &Value) -> Result<String> {
    ensure!(value.is_object(), "INVALID_DRAFT: an object is required");
    let text = serde_json::to_string(value)?;
    ensure!(text.len() <= MAX_DOCUMENT_BYTES, "DOCUMENT_TOO_LARGE");
    Ok(text)
}

fn digest(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn read_task(db: &Connection, task_id: &str) -> Result<TaskSnapshot> {
    let (binding, status, revision, draft, draft_hash): (String, String, i64, String, String) = db
        .query_row(
            "SELECT binding, status, revision, draft, draft_hash FROM craftmine_tasks WHERE id=?1",
            [task_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .context("TASK_NOT_FOUND")?;
    ensure!(digest(&draft) == draft_hash, "CORRUPT_DRAFT");
    Ok(TaskSnapshot {
        binding: serde_json::from_str(&binding)?,
        status,
        revision: revision.try_into().context("INVALID_REVISION")?,
        draft: serde_json::from_str(&draft)?,
        draft_hash,
    })
}

fn assert_binding(snapshot: &TaskSnapshot, binding: &TaskBinding) -> Result<()> {
    ensure!(&snapshot.binding == binding, "TASK_BINDING_MISMATCH");
    Ok(())
}

impl TaskJournal {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let db = Connection::open(path)?;
        db.busy_timeout(Duration::from_secs(2))?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS craftmine_tasks (
                id TEXT PRIMARY KEY, binding TEXT NOT NULL, status TEXT NOT NULL
                    CHECK(status IN ('running','cancelled','finished')),
                revision INTEGER NOT NULL CHECK(revision >= 0), draft TEXT NOT NULL, draft_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS craftmine_receipts (
                task_id TEXT NOT NULL REFERENCES craftmine_tasks(id), tool_call_id TEXT NOT NULL,
                request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(task_id, tool_call_id)
            );")?;
        worlds::migrate(&db)?;
        legacy::migrate(&db)?;
        workspaces::migrate(&db)?;
        verification::migrate(&db)?;
        reviews::migrate(&db)?;
        applications::migrate(&db)?;
        durable::migrate(&db)?;
        library::migrate(&db)?;
        asset_catalog::migrate(&db)?;
        memories::migrate(&db)?;
        backups::migrate(&db)?;
        godot_projects::migrate(&db)?;
        godot_builds::migrate(&db)?;
        godot_jobs::migrate(&db)?;
        godot_applications::migrate(&db)?;
        godot_storage::migrate(&db)?;
        godot_worlds::migrate(&db)?;
        // The managed Git content history owns authored source from here on.
        content_history::migration::migrate(&db)?;
        content_history::apply::migrate(&db)?;
        let directory = std::fs::canonicalize(
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )?;
        Ok(Self {
            db,
            directory,
            executors: std::collections::BTreeMap::new(),
            git: std::cell::OnceCell::new(),
        })
    }

    /// Duplicate starts are rejected rather than resetting an existing task.
    pub fn start(&mut self, binding: &TaskBinding, draft: &Value) -> Result<TaskSnapshot> {
        binding.validate()?;
        let body = document(draft)?;
        self.db
            .execute(
                "INSERT INTO craftmine_tasks(id,binding,status,revision,draft,draft_hash)
            VALUES(?1,?2,'running',0,?3,?4)",
                params![
                    binding.task_id,
                    serde_json::to_string(binding)?,
                    body,
                    digest(&body)
                ],
            )
            .context("TASK_ALREADY_EXISTS")?;
        self.inspect(binding)
    }

    pub fn inspect(&self, binding: &TaskBinding) -> Result<TaskSnapshot> {
        binding.validate()?;
        let snapshot = read_task(&self.db, &binding.task_id)?;
        assert_binding(&snapshot, binding)?;
        Ok(snapshot)
    }

    /// One transaction publishes the new draft and its receipt. A successful
    /// tool response may be lost; replay returns the committed receipt without
    /// performing the mutation again. The binding and call ID come from host
    /// execution context, never from model-authored tool arguments.
    pub fn commit_draft(
        &mut self,
        binding: &TaskBinding,
        tool_call_id: &str,
        expected_revision: u64,
        request: &Value,
        next_draft: &Value,
    ) -> Result<DraftReceipt> {
        binding.validate()?;
        ensure!(
            !tool_call_id.trim().is_empty()
                && tool_call_id.len() <= 240
                && !tool_call_id.chars().any(char::is_control),
            "INVALID_CALL_ID"
        );
        let body = document(next_draft)?;
        let request_hash = digest(&document(
            &json!({"revision":expected_revision,"request":request,"draft":next_draft}),
        )?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = read_task(&tx, &binding.task_id)?;
        assert_binding(&current, binding)?;
        ensure!(current.status == "running", "TASK_INACTIVE");
        let prior: Option<(String, String)> = tx.query_row(
            "SELECT request_hash,result FROM craftmine_receipts WHERE task_id=?1 AND tool_call_id=?2",
            params![binding.task_id,tool_call_id], |row| Ok((row.get(0)?,row.get(1)?))).optional()?;
        if let Some((hash, result)) = prior {
            ensure!(hash == request_hash, "REPLAY_MISMATCH");
            return Ok(serde_json::from_str(&result)?);
        }
        ensure!(current.revision == expected_revision, "STALE_DRAFT");
        let draft_hash = digest(&body);
        ensure!(draft_hash != current.draft_hash, "NO_CHANGE");
        let receipt = DraftReceipt {
            task_id: binding.task_id.clone(),
            tool_call_id: tool_call_id.into(),
            revision: current.revision.checked_add(1).context("REVISION_LIMIT")?,
            draft_hash,
        };
        let stored_revision = i64::try_from(receipt.revision).context("REVISION_LIMIT")?;
        tx.execute(
            "UPDATE craftmine_tasks SET revision=?2,draft=?3,draft_hash=?4 WHERE id=?1",
            params![binding.task_id, stored_revision, body, receipt.draft_hash],
        )?;
        tx.execute("INSERT INTO craftmine_receipts(task_id,tool_call_id,request_hash,result) VALUES(?1,?2,?3,?4)",
            params![binding.task_id,tool_call_id,request_hash,serde_json::to_string(&receipt)?])?;
        tx.commit()?;
        Ok(receipt)
    }

    pub fn cancel(&mut self, binding: &TaskBinding) -> Result<TaskSnapshot> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let snapshot = read_task(&tx, &binding.task_id)?;
        assert_binding(&snapshot, binding)?;
        if snapshot.status == "finished" {
            bail!("TASK_ALREADY_FINISHED");
        }
        tx.execute(
            "UPDATE craftmine_tasks SET status='cancelled' WHERE id=?1",
            [&binding.task_id],
        )?;
        tx.commit()?;
        self.inspect(binding)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> TaskBinding {
        TaskBinding {
            project_id: "world-a".into(),
            session_id: "session-a".into(),
            turn_id: "turn-a".into(),
            task_id: "task-a".into(),
            base_build: "build-a".into(),
        }
    }
    fn draft(n: u32) -> Value {
        json!({"format":"craftmine.scene/3","objects":[{"id":"tree","height":n}]})
    }

    #[test]
    fn lost_response_is_recovered_without_repeating_edit_after_restart() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("tasks.sqlite");
        let b = binding();
        let mut journal = TaskJournal::open(&path)?;
        journal.start(&b, &draft(1))?;
        let receipt = journal.commit_draft(&b, "call_1", 0, &json!({"height":2}), &draft(2))?;
        drop(journal);
        let mut restored = TaskJournal::open(&path)?;
        assert_eq!(
            restored.commit_draft(&b, "call_1", 0, &json!({"height":2}), &draft(2))?,
            receipt
        );
        assert_eq!(restored.inspect(&b)?.revision, 1);
        assert_eq!(restored.inspect(&b)?.draft, draft(2));
        Ok(())
    }

    #[test]
    fn cancelled_task_stays_cancelled_and_late_writes_are_rejected() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("tasks.sqlite");
        let b = binding();
        let mut journal = TaskJournal::open(&path)?;
        journal.start(&b, &draft(1))?;
        journal.cancel(&b)?;
        drop(journal);
        let mut journal = TaskJournal::open(&path)?;
        assert_eq!(journal.inspect(&b)?.status, "cancelled");
        assert!(journal
            .commit_draft(&b, "late", 0, &json!({}), &draft(2))
            .unwrap_err()
            .to_string()
            .contains("TASK_INACTIVE"));
        assert_eq!(journal.inspect(&b)?.revision, 0);
        assert!(journal.start(&b, &draft(1)).is_err());
        Ok(())
    }

    #[test]
    fn binding_and_replay_conflicts_cannot_change_the_draft() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
        let b = binding();
        journal.start(&b, &draft(1))?;
        let mut foreign = b.clone();
        foreign.project_id = "world-b".into();
        assert!(journal
            .inspect(&foreign)
            .unwrap_err()
            .to_string()
            .contains("BINDING_MISMATCH"));
        assert!(journal.cancel(&foreign).is_err());
        journal.commit_draft(&b, "once", 0, &json!({}), &draft(2))?;
        assert!(journal
            .commit_draft(&b, "once", 0, &json!({}), &draft(3))
            .unwrap_err()
            .to_string()
            .contains("REPLAY_MISMATCH"));
        assert_eq!(journal.inspect(&b)?.draft, draft(2));
        Ok(())
    }

    #[test]
    fn independent_connections_observe_revision_conflicts_atomically() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("tasks.sqlite");
        let b = binding();
        let mut first = TaskJournal::open(&path)?;
        first.start(&b, &draft(1))?;
        let mut second = TaskJournal::open(&path)?;
        first.commit_draft(&b, "first", 0, &json!({}), &draft(2))?;
        assert!(second
            .commit_draft(&b, "second", 0, &json!({}), &draft(3))
            .unwrap_err()
            .to_string()
            .contains("STALE_DRAFT"));
        assert!(second
            .commit_draft(&b, "invalid", 1, &json!({}), &json!([]))
            .is_err());
        assert_eq!(second.inspect(&b)?.revision, 1);
        second.commit_draft(&b, "second", 1, &json!({}), &draft(3))?;
        assert_eq!(first.inspect(&b)?.draft, draft(3));
        Ok(())
    }
}
