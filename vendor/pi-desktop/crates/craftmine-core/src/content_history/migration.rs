//! VM1: migrate a world's immutable legacy revisions into a managed Git
//! repository, one commit per revision, verifying every byte.
//!
//! The legacy store keeps a manifest plus content-addressed blobs and an
//! increasing revision number. That numbering is not a Git branch graph, so it
//! is imported as a linear history with an explicit mapping table. After the
//! switch, the legacy entry points must refuse to write (see
//! [`assert_legacy_writes_allowed`]); otherwise a second content history would
//! keep growing beside Git.
//!
//! Honesty rules from the plan:
//! * a legacy revision has no asset lock, so the commit is marked source-only
//!   and is never reported as playable content;
//! * a missing blob, a hash mismatch or an unknown state is reported, never
//!   repaired by substituting current data;
//! * the old directory and rows are left untouched for audit and rollback.

use std::{collections::BTreeMap, path::Path};

use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::{
    contract::validate_identifier,
    repo::{ContentFile, RepositoryStore, MAIN_BRANCH, MIGRATION_REF_PREFIX},
};
use crate::godot_projects::{blob_read, load_manifest};

pub const REPOSITORY_FORMAT: &str = "craftmine.content-repository/1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentBackend {
    /// Immutable revision rows in SQLite plus content-addressed blobs.
    Legacy,
    /// Real Git repository; the legacy entry points are read-only.
    Git,
}

impl ContentBackend {
    fn as_str(self) -> &'static str {
        match self {
            ContentBackend::Legacy => "legacy",
            ContentBackend::Git => "git",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "legacy" => Ok(ContentBackend::Legacy),
            "git" => Ok(ContentBackend::Git),
            other => anyhow::bail!("CONTENT_BACKEND_UNKNOWN: {other}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyRevisionSummary {
    pub revision: u64,
    pub task_id: String,
    pub manifest_hash: String,
    pub file_count: u64,
    pub byte_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPlan {
    pub world_id: String,
    pub repo_id: String,
    pub object_format: String,
    /// Stable digest of the legacy source as it is right now.
    pub source_digest: String,
    pub head_revision: u64,
    pub revisions: Vec<LegacyRevisionSummary>,
    /// Real problems found while reading. A non-empty list blocks the import.
    pub problems: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub world_id: String,
    pub repo_id: String,
    pub object_format: String,
    pub already_migrated: bool,
    pub imported: u64,
    /// Revisions adopted from an interrupted earlier run after re-verification.
    pub adopted: u64,
    pub resumed_from: Option<u64>,
    pub head_oid: Option<String>,
    pub mapping: Vec<LegacyMapping>,
    pub problems: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMapping {
    pub revision: u64,
    pub commit_oid: String,
    pub tree_oid: String,
    pub manifest_hash: String,
    pub file_count: u64,
    pub byte_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendState {
    pub world_id: String,
    pub repo_id: String,
    pub object_format: String,
    pub backend: ContentBackend,
    pub legacy_head_revision: Option<u64>,
    pub created_at: i64,
    pub switched_at: Option<i64>,
}

pub(crate) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_content_repositories (
            world_id TEXT PRIMARY KEY REFERENCES craftmine_worlds(id),
            repo_id TEXT NOT NULL UNIQUE,
            object_format TEXT NOT NULL,
            backend TEXT NOT NULL CHECK(backend IN ('legacy','git')),
            legacy_head_revision INTEGER,
            created_at INTEGER NOT NULL,
            switched_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS craftmine_content_revision_map (
            world_id TEXT NOT NULL,
            legacy_revision INTEGER NOT NULL,
            commit_oid TEXT NOT NULL,
            tree_oid TEXT NOT NULL,
            manifest_hash TEXT NOT NULL,
            file_count INTEGER NOT NULL CHECK(file_count >= 0),
            byte_count INTEGER NOT NULL CHECK(byte_count >= 0),
            imported_at INTEGER NOT NULL,
            PRIMARY KEY(world_id, legacy_revision)
        );
        CREATE TABLE IF NOT EXISTS craftmine_content_migrations (
            world_id TEXT PRIMARY KEY,
            repo_id TEXT NOT NULL,
            source_digest TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('planned','imported','switched')),
            detail TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    )?;
    Ok(())
}

/// Stable logical repository identity for a world.
pub fn repo_id_for(world: &str) -> Result<String> {
    validate_identifier(world, "INVALID_WORLD_ID")?;
    let sanitized: String = world
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    Ok(format!("world-{sanitized}"))
}

pub fn backend(db: &Connection, world: &str) -> Result<Option<BackendState>> {
    validate_identifier(world, "INVALID_WORLD_ID")?;
    let row: Option<(String, String, String, Option<i64>, i64, Option<i64>)> = db
        .query_row(
            "SELECT repo_id,object_format,backend,legacy_head_revision,created_at,switched_at
             FROM craftmine_content_repositories WHERE world_id=?1",
            [world],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?;
    row.map(
        |(repo_id, object_format, backend, legacy_head, created_at, switched_at)| {
            Ok(BackendState {
                world_id: world.to_string(),
                repo_id,
                object_format,
                backend: ContentBackend::parse(&backend)?,
                legacy_head_revision: legacy_head
                    .map(u64::try_from)
                    .transpose()
                    .context("CONTENT_BACKEND_CORRUPT")?,
                created_at,
                switched_at,
            })
        },
    )
    .transpose()
}

pub fn is_git_backed(db: &Connection, world: &str) -> Result<bool> {
    Ok(backend(db, world)?.map(|state| state.backend) == Some(ContentBackend::Git))
}

/// Guard for the legacy write path. The legacy `godotProject.create` and
/// `godotProject.patch` entry points must call this before writing, so a
/// switched world cannot grow a second content history.
pub fn assert_legacy_writes_allowed(db: &Connection, world: &str) -> Result<()> {
    ensure!(
        !is_git_backed(db, world)?,
        "CONTENT_BACKEND_SWITCHED: {world} is managed by Git; use the content history API"
    );
    Ok(())
}

fn legacy_revisions(db: &Connection, world: &str) -> Result<Vec<(u64, String, String)>> {
    let mut statement = db.prepare(
        "SELECT revision,task_id,hash FROM craftmine_godot_revisions
         WHERE world_id=?1 ORDER BY revision ASC",
    )?;
    let rows = statement.query_map([world], |row| {
        Ok((row.get::<_, i64>(0)?, row.get(1)?, row.get(2)?))
    })?;
    let mut revisions = Vec::new();
    for row in rows {
        let (revision, task_id, hash) = row?;
        revisions.push((
            u64::try_from(revision).context("CONTENT_MIGRATION_CORRUPT")?,
            task_id,
            hash,
        ));
    }
    Ok(revisions)
}

fn source_digest(
    world: &str,
    revisions: &[(u64, String, String)],
    summaries: &[LegacyRevisionSummary],
) -> Result<String> {
    let mut body = format!("craftmine.legacy-source/1\n{world}\n");
    for ((revision, task, hash), summary) in revisions.iter().zip(summaries) {
        body.push_str(&format!(
            "{revision}\0{task}\0{hash}\0{}\0{}\n",
            summary.file_count, summary.byte_count
        ));
    }
    use sha2::{Digest, Sha256};
    Ok(Sha256::digest(body.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Read-only preflight. Every revision and every blob is read and verified
/// before anything is written.
pub fn plan(db: &Connection, directory: &Path, world: &str) -> Result<MigrationPlan> {
    validate_identifier(world, "INVALID_WORLD_ID")?;
    let repo_id = repo_id_for(world)?;
    let revisions = legacy_revisions(db, world)?;
    let mut summaries = Vec::new();
    let mut problems = Vec::new();
    for (revision, task_id, hash) in &revisions {
        match load_manifest(db, world, Some(*revision)) {
            Ok((manifest, stored_hash)) => {
                let mut file_count = 0u64;
                let mut byte_count = 0u64;
                for (path, entry) in &manifest.files {
                    match blob_read(directory, world, entry) {
                        Ok(text) => {
                            file_count += 1;
                            byte_count += text.len() as u64;
                        }
                        Err(error) => problems.push(format!(
                            "revision {revision} path {path}: {}",
                            error
                        )),
                    }
                }
                if &stored_hash != hash {
                    problems.push(format!("revision {revision}: manifest hash mismatch"));
                }
                summaries.push(LegacyRevisionSummary {
                    revision: *revision,
                    task_id: task_id.clone(),
                    manifest_hash: stored_hash,
                    file_count,
                    byte_count,
                });
            }
            Err(error) => problems.push(format!("revision {revision}: {error}")),
        }
    }
    let head_revision = revisions
        .last()
        .map(|(revision, _, _)| *revision)
        .unwrap_or(0);
    let digest = source_digest(world, &revisions, &summaries)?;
    Ok(MigrationPlan {
        world_id: world.to_string(),
        repo_id,
        object_format: super::repo::DEFAULT_OBJECT_FORMAT.to_string(),
        source_digest: digest,
        head_revision,
        revisions: summaries,
        problems,
    })
}

fn existing_mapping(db: &Connection, world: &str) -> Result<BTreeMap<u64, LegacyMapping>> {
    let mut statement = db.prepare(
        "SELECT legacy_revision,commit_oid,tree_oid,manifest_hash,file_count,byte_count
         FROM craftmine_content_revision_map WHERE world_id=?1",
    )?;
    let rows = statement.query_map([world], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
        ))
    })?;
    let mut mapping = BTreeMap::new();
    for row in rows {
        let (revision, commit_oid, tree_oid, manifest_hash, file_count, byte_count) = row?;
        let revision = u64::try_from(revision).context("CONTENT_MIGRATION_CORRUPT")?;
        mapping.insert(
            revision,
            LegacyMapping {
                revision,
                commit_oid,
                tree_oid,
                manifest_hash,
                file_count: u64::try_from(file_count).context("CONTENT_MIGRATION_CORRUPT")?,
                byte_count: u64::try_from(byte_count).context("CONTENT_MIGRATION_CORRUPT")?,
            },
        );
    }
    Ok(mapping)
}

/// Import every legacy revision as one commit and switch the backend.
///
/// Idempotent and resumable: a crash after some revisions leaves a partial
/// mapping, and a later run continues from the first missing revision after
/// re-verifying the ones already imported.
pub fn apply(
    db: &mut Connection,
    directory: &Path,
    store: &RepositoryStore,
    world: &str,
) -> Result<MigrationReport> {
    let plan = plan(db, directory, world)?;
    ensure!(
        plan.problems.is_empty(),
        "CONTENT_MIGRATION_SOURCE_INVALID: {}",
        plan.problems.join("; ")
    );
    ensure!(
        !plan.revisions.is_empty(),
        "CONTENT_MIGRATION_NO_LEGACY_REVISIONS"
    );
    let repo_id = plan.repo_id.clone();
    let layout = store.layout(&repo_id)?;
    let mut mapping = existing_mapping(db, world)?;
    let already = is_git_backed(db, world)?;
    if already && mapping.len() == plan.revisions.len() {
        return Ok(MigrationReport {
            world_id: world.to_string(),
            repo_id,
            object_format: store
                .read_metadata(&layout)
                .map(|meta| meta.object_format)
                .unwrap_or_else(|_| plan.object_format.clone()),
            already_migrated: true,
            imported: 0,
            adopted: 0,
            resumed_from: None,
            head_oid: mapping.last_key_value().map(|(_, row)| row.commit_oid.clone()),
            mapping: mapping.into_values().collect(),
            problems: Vec::new(),
        });
    }
    if !layout.git_dir.exists() {
        store.create(&repo_id, &plan.object_format, Some(world))?;
    } else {
        store.open_existing(&repo_id)?;
    }
    let resumed_from = mapping.keys().next_back().copied();
    let mut parent = resumed_from.and_then(|revision| {
        mapping
            .get(&revision)
            .map(|row| row.commit_oid.clone())
    });
    let mut problems = Vec::new();
    let mut imported = 0u64;
    let mut adopted = 0u64;

    for summary in &plan.revisions {
        if mapping.contains_key(&summary.revision) {
            parent = Some(mapping[&summary.revision].commit_oid.clone());
            continue;
        }
        let (manifest, _) = load_manifest(db, world, Some(summary.revision))?;
        let mut files = Vec::with_capacity(manifest.files.len());
        for (path, entry) in &manifest.files {
            let text = blob_read(directory, world, entry)
                .with_context(|| format!("revision {} path {path}", summary.revision))?;
            files.push(ContentFile {
                path: path.clone(),
                bytes: text.into_bytes(),
            });
        }

        // Recovery: an interrupted run may have committed this revision and
        // died before recording the mapping. The commit trailer is the
        // evidence; it is adopted only after its bytes are re-verified.
        if let Some(commit) = find_committed_revision(store, &layout, summary)? {
            let mut mismatch = false;
            for file in &files {
                if store.read_file(&layout, &commit, &file.path)? != file.bytes {
                    mismatch = true;
                    problems.push(format!(
                        "revision {} path {}: recovered commit bytes differ",
                        summary.revision, file.path
                    ));
                }
            }
            ensure!(
                !mismatch,
                "CONTENT_MIGRATION_BYTE_MISMATCH: {}",
                problems.join("; ")
            );
            let tree = store
                .git()
                .resolve(&layout.git_dir, &format!("{commit}^{{tree}}"))?;
            record_mapping(db, world, summary, &commit, &tree)?;
            ensure_migration_tag(store, &layout, &repo_id, summary.revision, &commit)?;
            mapping.insert(
                summary.revision,
                LegacyMapping {
                    revision: summary.revision,
                    commit_oid: commit.clone(),
                    tree_oid: tree,
                    manifest_hash: summary.manifest_hash.clone(),
                    file_count: summary.file_count,
                    byte_count: summary.byte_count,
                },
            );
            parent = Some(commit);
            adopted += 1;
            continue;
        }

        let message = legacy_message(summary, &manifest.task.task_id)?;
        let commit = store.commit(
            &layout,
            MAIN_BRANCH,
            parent.as_deref(),
            &files,
            &message,
        )?;
        // Re-read from Git and compare bytes: the mapping is only recorded for
        // content that Git really stores.
        for file in &files {
            let stored = store.read_file(&layout, &commit, &file.path)?;
            if stored != file.bytes {
                problems.push(format!(
                    "revision {} path {}: imported bytes differ",
                    summary.revision, file.path
                ));
            }
        }
        let tree = store
            .git()
            .resolve(&layout.git_dir, &format!("{commit}^{{tree}}"))?;
        record_mapping(db, world, summary, &commit, &tree)?;
        ensure_migration_tag(store, &layout, &repo_id, summary.revision, &commit)?;
        mapping.insert(
            summary.revision,
            LegacyMapping {
                revision: summary.revision,
                commit_oid: commit.clone(),
                tree_oid: tree,
                manifest_hash: summary.manifest_hash.clone(),
                file_count: summary.file_count,
                byte_count: summary.byte_count,
            },
        );
        parent = Some(commit);
        imported += 1;
    }
    ensure!(
        problems.is_empty(),
        "CONTENT_MIGRATION_BYTE_MISMATCH: {}",
        problems.join("; ")
    );

    // The branch head is the newest imported revision.
    let head = parent.clone();
    if let Some(head_oid) = &head {
        let current = store.branch_head(&layout, MAIN_BRANCH)?;
        if current.as_deref() != Some(head_oid.as_str()) {
            store.git().update_ref(
                &layout.git_dir,
                &format!("refs/heads/{MAIN_BRANCH}"),
                head_oid,
                current.as_deref(),
            )?;
        }
    }
    let now = crate::worlds::timestamp()?;
    let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute(
        "INSERT INTO craftmine_content_repositories
         (world_id,repo_id,object_format,backend,legacy_head_revision,created_at,switched_at)
         VALUES(?1,?2,?3,'git',?4,?5,?5)
         ON CONFLICT(world_id) DO UPDATE SET
            repo_id=excluded.repo_id, object_format=excluded.object_format,
            backend='git', legacy_head_revision=excluded.legacy_head_revision,
            switched_at=excluded.switched_at",
        params![
            world,
            repo_id,
            plan.object_format,
            i64::try_from(plan.head_revision)?,
            now
        ],
    )?;
    transaction.execute(
        "INSERT INTO craftmine_content_migrations(world_id,repo_id,source_digest,status,detail,updated_at)
         VALUES(?1,?2,?3,'switched',?4,?5)
         ON CONFLICT(world_id) DO UPDATE SET
            repo_id=excluded.repo_id, source_digest=excluded.source_digest,
            status=excluded.status, detail=excluded.detail, updated_at=excluded.updated_at",
        params![
            world,
            repo_id,
            plan.source_digest,
            format!("{} revisions", plan.revisions.len()),
            now
        ],
    )?;
    transaction.commit()?;
    Ok(MigrationReport {
        world_id: world.to_string(),
        repo_id,
        object_format: plan.object_format,
        already_migrated: false,
        imported,
        adopted,
        resumed_from,
        head_oid: head,
        mapping: mapping.into_values().collect(),
        problems,
    })
}

fn record_mapping(
    db: &Connection,
    world: &str,
    summary: &LegacyRevisionSummary,
    commit: &str,
    tree: &str,
) -> Result<()> {
    let now = crate::worlds::timestamp()?;
    db.execute(
        "INSERT INTO craftmine_content_revision_map
         (world_id,legacy_revision,commit_oid,tree_oid,manifest_hash,file_count,byte_count,imported_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            world,
            i64::try_from(summary.revision)?,
            commit,
            tree,
            summary.manifest_hash,
            i64::try_from(summary.file_count)?,
            i64::try_from(summary.byte_count)?,
            now
        ],
    )?;
    Ok(())
}

/// Create or repair the protected migration tag for a revision. A tag left by
/// an interrupted attempt is replaced only after its commit is re-verified and
/// recorded, so the mapping table stays the authority.
fn ensure_migration_tag(
    store: &RepositoryStore,
    layout: &super::repo::RepoLayout,
    repo_id: &str,
    revision: u64,
    commit: &str,
) -> Result<()> {
    let tag = format!(
        "{MIGRATION_REF_PREFIX}{}/{:08}",
        RepositoryStore::repo_key(repo_id)?,
        revision
    );
    match store.git().ref_value(&layout.git_dir, &tag)? {
        Some(existing) if existing == commit => Ok(()),
        Some(existing) => {
            store
                .git()
                .delete_ref(&layout.git_dir, &tag, &existing)?;
            store.git().update_ref(&layout.git_dir, &tag, commit, None)
        }
        None => store.git().update_ref(&layout.git_dir, &tag, commit, None),
    }
}

/// Find a commit already produced for this legacy revision by an interrupted
/// run, identified by its trailers rather than by guessing.
fn find_committed_revision(
    store: &RepositoryStore,
    layout: &super::repo::RepoLayout,
    summary: &LegacyRevisionSummary,
) -> Result<Option<String>> {
    if store.branch_head(layout, MAIN_BRANCH)?.is_none() {
        return Ok(None);
    }
    let mut skip = 0usize;
    let mut found = None;
    loop {
        let page = store.history(layout, MAIN_BRANCH, skip, 200)?;
        for record in &page.records {
            if record.legacy_revision == Some(summary.revision)
                && record.legacy_manifest_hash.as_deref()
                    == Some(summary.manifest_hash.as_str())
            {
                found = Some(record.oid.clone());
                break;
            }
        }
        match (found.is_some(), page.next_skip) {
            (true, _) | (false, None) => break,
            (false, Some(next)) => skip = next,
        }
    }
    Ok(found)
}

fn legacy_message(summary: &LegacyRevisionSummary, task_id: &str) -> Result<String> {
    validate_identifier(task_id, "INVALID_TASK_ID")?;
    // Legacy revisions carry no player-request identity, so only the bound task
    // trailer is written. History grouping must not invent a request.
    Ok(format!(
        "Migrate legacy revision {}\n\nCraftmine-Task: {task_id}\nCraftmine-Legacy-Revision: {}\nCraftmine-Manifest-Hash: {}\nCraftmine-Assets: source-only\n",
        summary.revision, summary.revision, summary.manifest_hash
    ))
}

/// Re-verify an existing mapping against the legacy blobs. Any problem means
/// the Git history and the legacy source disagree; nothing is auto-repaired.
pub fn verify(
    db: &Connection,
    directory: &Path,
    store: &RepositoryStore,
    world: &str,
) -> Result<Vec<String>> {
    let state = backend(db, world)?.context("CONTENT_BACKEND_UNKNOWN")?;
    let layout = store.open_existing(&state.repo_id)?;
    let mapping = existing_mapping(db, world)?;
    let mut problems = Vec::new();
    for (revision, row) in &mapping {
        let (manifest, _) = load_manifest(db, world, Some(*revision))?;
        if manifest.files.len() as u64 != row.file_count {
            problems.push(format!(
                "revision {revision}: file count {} != {}",
                manifest.files.len(),
                row.file_count
            ));
        }
        for (path, entry) in &manifest.files {
            let legacy = match blob_read(directory, world, entry) {
                Ok(text) => text.into_bytes(),
                Err(error) => {
                    problems.push(format!("revision {revision} path {path}: {error}"));
                    continue;
                }
            };
            match store.read_file(&layout, &row.commit_oid, path) {
                Ok(stored) if stored == legacy => {}
                Ok(_) => problems.push(format!(
                    "revision {revision} path {path}: Git bytes differ from legacy"
                )),
                Err(error) => problems.push(format!(
                    "revision {revision} path {path}: {error}"
                )),
            }
        }
    }
    let head = store.branch_head(&layout, MAIN_BRANCH)?;
    let expected = mapping
        .last_key_value()
        .map(|(_, row)| row.commit_oid.clone());
    if head != expected {
        problems.push(format!(
            "main head {head:?} does not match the newest mapped revision {expected:?}"
        ));
    }
    Ok(problems)
}
