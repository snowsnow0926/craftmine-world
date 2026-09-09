//! VM1: managed bare repositories, commits, branches, tags and working copies.
//!
//! Git is the authority for source content, parentage, branches and version
//! tags. SQLite only records deployment, task leases, operation logs and play
//! progress. The layout is:
//!
//! ```text
//! <root>/repos/<repoKey>/repo.git      managed bare repository
//! <root>/repos/<repoKey>/repo.json     repository identity and object format
//! <root>/repos/<repoKey>/copies/<key>  build copies, never containing .git
//! ```
//!
//! `repoKey` is a hash of the logical repository ID so case-insensitive file
//! systems cannot alias two worlds, and so no world-authored string becomes a
//! filesystem component.
//!
//! Copies are materialised by reading committed objects, never by checkout:
//! no hook, filter, smudge/clean driver or `.git` directory can reach a build
//! input. Unsupported entries (symlinks, submodules) are reported instead of
//! being silently skipped.

use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};

use super::{
    contract::{
        detect_path_collisions, validate_identifier, validate_oid, validate_relative_path,
        AssetLock, ContentRef, ASSET_LOCK_FILE,
    },
    git::{validate_ref_name, CommitRecord, GitAdapter, RefEntry, TreeEntry},
};

pub const MAIN_BRANCH: &str = "main";
pub const MIGRATION_REF_PREFIX: &str = "refs/craftmine/migration/";
pub const CHECKPOINT_REF_PREFIX: &str = "refs/craftmine/checkpoint/";
pub const DRAFT_REF_PREFIX: &str = "refs/craftmine/draft/";
pub const VERSION_REF_PREFIX: &str = "refs/craftmine/version/";
pub const APPLIED_REF_PREFIX: &str = "refs/craftmine/applied/";
pub const DEFAULT_OBJECT_FORMAT: &str = "sha1";

/// References that must survive reclaim, cache cleanup and backup pruning.
pub const PROTECTED_REF_PREFIXES: &[&str] = &[
    MIGRATION_REF_PREFIX,
    CHECKPOINT_REF_PREFIX,
    DRAFT_REF_PREFIX,
    VERSION_REF_PREFIX,
    APPLIED_REF_PREFIX,
];

/// Authoring paths that never belong in a world repository, even if a caller
/// asks for them. Save games, credentials and regenerated engine caches are
/// excluded from content history by design.
const AUTHORING_DENY_PREFIXES: &[&str] = &[
    ".godot/",
    ".git/",
    "credentials/",
    "secrets/",
    "user-data/",
    "save/",
    "saves/",
    "logs/",
];
const AUTHORING_DENY_EXACT: &[&str] = &[".env", ".git", "credentials", "secrets"];

const MAX_COMMIT_FILES: usize = 100_000;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_COMMIT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_HISTORY_PAGE: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoMetadata {
    pub format: String,
    pub repo_id: String,
    pub object_format: String,
    pub created_at: String,
    /// Set when the repository was created by migrating an immutable legacy
    /// world; the old backend is then read-only.
    pub legacy_world: Option<String>,
}

#[derive(Clone, Debug)]
pub struct RepoLayout {
    pub repo_id: String,
    pub git_dir: PathBuf,
    pub copies_dir: PathBuf,
    pub metadata_path: PathBuf,
}

/// One file destined for a commit. Bytes are exact; no text decoding happens
/// in the content history.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentFile {
    pub path: String,
    pub bytes: Vec<u8>,
}

impl ContentFile {
    pub fn text(path: &str, text: &str) -> Self {
        Self {
            path: path.to_string(),
            bytes: text.as_bytes().to_vec(),
        }
    }

    /// Canonical `craftmine.assets.lock.json` entry for a commit.
    pub fn asset_lock(lock: &AssetLock) -> Result<Self> {
        Ok(Self {
            path: ASSET_LOCK_FILE.to_string(),
            bytes: lock.canonical_bytes()?,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub records: Vec<CommitRecord>,
    pub skip: usize,
    pub limit: usize,
    pub total: u64,
    pub next_skip: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEntry {
    pub status: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FileDiff {
    Text {
        path: String,
        added: u64,
        removed: u64,
        patch: String,
    },
    Binary {
        path: String,
        old_bytes: Option<u64>,
        new_bytes: Option<u64>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOutcome {
    /// Merged tree, present only when Git produced a clean merge.
    pub tree: Option<String>,
    pub conflicted: bool,
    pub messages: Vec<String>,
    /// Paths reported as conflicted by Git. Semantic and gameplay conflicts are
    /// found later by the verifier, never inferred from this list.
    pub conflicts: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializedCopy {
    pub path: String,
    pub files: u64,
    pub bytes: u64,
    pub object_format: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReclaimPlan {
    pub keep_refs: Vec<String>,
    /// Objects reachable from the keep set.
    pub reachable_objects: u64,
    /// Objects reachable only from references outside the keep set. They are
    /// still referenced, so reclaim must not delete them.
    pub referenced_elsewhere: u64,
    /// Objects reachable from no reference at all: the only reclaim candidates.
    pub garbage_objects: u64,
    pub garbage_bytes: u64,
    pub sample: Vec<String>,
}

pub struct RepositoryStore {
    root: PathBuf,
    git: GitAdapter,
}

impl RepositoryStore {
    pub fn open(root: &Path, git: GitAdapter) -> Result<Self> {
        std::fs::create_dir_all(root.join("repos")).context("CONTENT_STORAGE_UNAVAILABLE")?;
        Ok(Self {
            root: root.to_path_buf(),
            git,
        })
    }

    pub fn git(&self) -> &GitAdapter {
        &self.git
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Logical identity to filesystem key. Never use the raw ID as a directory.
    pub fn repo_key(repo_id: &str) -> Result<String> {
        validate_identifier(repo_id, "INVALID_REPO_ID")?;
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(repo_id.as_bytes());
        Ok(digest
            .iter()
            .take(16)
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }

    pub fn layout(&self, repo_id: &str) -> Result<RepoLayout> {
        let key = Self::repo_key(repo_id)?;
        let base = self.root.join("repos").join(&key);
        Ok(RepoLayout {
            repo_id: repo_id.to_string(),
            git_dir: base.join("repo.git"),
            copies_dir: base.join("copies"),
            metadata_path: base.join("repo.json"),
        })
    }

    /// Create a managed bare repository. The object format is recorded instead
    /// of assuming 40-character object IDs.
    pub fn create(
        &self,
        repo_id: &str,
        object_format: &str,
        legacy_world: Option<&str>,
    ) -> Result<RepoLayout> {
        let layout = self.layout(repo_id)?;
        ensure!(
            !layout.git_dir.exists(),
            "CONTENT_REPOSITORY_EXISTS: {}",
            layout.repo_id
        );
        if let Some(world) = legacy_world {
            validate_identifier(world, "INVALID_WORLD_ID")?;
        }
        let format = self.git.init_bare(&layout.git_dir, object_format)?;
        ensure!(
            format == object_format,
            "GIT_OBJECT_FORMAT_UNSUPPORTED: requested {object_format}, got {format}"
        );
        std::fs::create_dir_all(&layout.copies_dir)?;
        let metadata = RepoMetadata {
            format: "craftmine.content-repository/1".to_string(),
            repo_id: repo_id.to_string(),
            object_format: format,
            created_at: timestamp(),
            legacy_world: legacy_world.map(|world| world.to_string()),
        };
        std::fs::write(
            &layout.metadata_path,
            serde_json::to_vec_pretty(&metadata)?,
        )?;
        Ok(layout)
    }

    pub fn open_existing(&self, repo_id: &str) -> Result<RepoLayout> {
        let layout = self.layout(repo_id)?;
        ensure!(
            layout.git_dir.is_dir() && layout.metadata_path.is_file(),
            "CONTENT_REPOSITORY_NOT_FOUND: {repo_id}"
        );
        self.git.assert_managed_config(&layout.git_dir)?;
        Ok(layout)
    }

    pub fn read_metadata(&self, layout: &RepoLayout) -> Result<RepoMetadata> {
        let text = std::fs::read_to_string(&layout.metadata_path)
            .context("CONTENT_REPOSITORY_NOT_FOUND")?;
        let metadata: RepoMetadata = serde_json::from_str(&text)?;
        ensure!(
            metadata.repo_id == layout.repo_id
                && metadata.format == "craftmine.content-repository/1",
            "CONTENT_REPOSITORY_CORRUPT"
        );
        Ok(metadata)
    }

    fn assert_authoring_path(path: &str) -> Result<()> {
        validate_relative_path(path)?;
        let lower = path.to_lowercase();
        for prefix in AUTHORING_DENY_PREFIXES {
            ensure!(
                !lower.starts_with(prefix),
                "CONTENT_PATH_EXCLUDED: {path}"
            );
        }
        ensure!(
            !AUTHORING_DENY_EXACT.iter().any(|name| lower == *name),
            "CONTENT_PATH_EXCLUDED: {path}"
        );
        Ok(())
    }

    /// Create one commit and move `refs/heads/<branch>` with a compare-and-swap.
    ///
    /// The blobs, tree and commit are written first; only the reference update
    /// decides whether the commit becomes visible. A concurrent writer that
    /// moved the branch meanwhile wins, and the losing objects stay
    /// unreferenced and harmless.
    pub fn commit(
        &self,
        layout: &RepoLayout,
        branch_id: &str,
        expected_head: Option<&str>,
        files: &[ContentFile],
        message: &str,
    ) -> Result<String> {
        validate_identifier(branch_id, "INVALID_BRANCH_ID")?;
        let branch = format!("refs/heads/{branch_id}");
        validate_ref_name(&branch)?;
        ensure!(
            !files.is_empty() && files.len() <= MAX_COMMIT_FILES,
            "CONTENT_COMMIT_FILE_LIMIT"
        );
        ensure!(
            !message.is_empty() && message.len() <= 64 * 1024,
            "CONTENT_COMMIT_MESSAGE_INVALID"
        );
        detect_path_collisions(files.iter().map(|file| file.path.as_str()))?;
        let mut total = 0u64;
        for file in files {
            Self::assert_authoring_path(&file.path)?;
            let bytes = file.bytes.len() as u64;
            ensure!(bytes <= MAX_FILE_BYTES, "CONTENT_FILE_TOO_LARGE");
            total = total.checked_add(bytes).context("CONTENT_COMMIT_TOO_LARGE")?;
            ensure!(total <= MAX_COMMIT_BYTES, "CONTENT_COMMIT_TOO_LARGE");
        }
        let oids = self.hash_blobs(layout, files)?;
        let entries: Vec<TreeEntry> = files
            .iter()
            .zip(oids)
            .map(|(file, oid)| TreeEntry {
                mode: "100644".to_string(),
                path: file.path.clone(),
                oid,
            })
            .collect();
        let tree = self.git.write_tree(&layout.git_dir, &entries)?;
        let parents: Vec<String> = match expected_head {
            Some(oid) => {
                validate_oid(oid)?;
                vec![oid.to_string()]
            }
            None => Vec::new(),
        };
        let commit = self
            .git
            .commit_tree(&layout.git_dir, &tree, &parents, message)?;
        self.git
            .update_ref(&layout.git_dir, &branch, &commit, expected_head)?;
        Ok(commit)
    }

    /// Write blobs and return their object IDs in input order.
    ///
    /// A single `hash-object -w --stdin-paths` call handles a whole commit so
    /// a ten-thousand-file import does not spawn ten thousand processes. The
    /// staging directory is removed afterwards; no filter or clean driver runs
    /// because Git only hashes the staged bytes.
    fn hash_blobs(&self, layout: &RepoLayout, files: &[ContentFile]) -> Result<Vec<String>> {
        if files.len() == 1 {
            return Ok(vec![self
                .git
                .hash_object(&layout.git_dir, &files[0].bytes)?]);
        }
        std::fs::create_dir_all(&layout.copies_dir)?;
        let staging = layout.copies_dir.join(format!(
            ".staging-{}-{}",
            std::process::id(),
            timestamp().replace(' ', "-")
        ));
        std::fs::create_dir_all(&staging)?;
        let result = (|| -> Result<Vec<String>> {
            let mut paths = Vec::with_capacity(files.len());
            for (index, file) in files.iter().enumerate() {
                let path = staging.join(format!("{index:08}.blob"));
                std::fs::write(&path, &file.bytes)?;
                paths.push(path);
            }
            let mut input = String::new();
            for path in &paths {
                input.push_str(&path.to_string_lossy());
                input.push('\n');
            }
            let output = self.git.repo_stdin(
                &layout.git_dir,
                &["hash-object", "-w", "--stdin-paths"],
                input.as_bytes(),
            )?;
            ensure!(
                output.ok(),
                "GIT_HASH_OBJECT_FAILED: {}",
                output.stderr.trim()
            );
            let oids: Vec<String> = output
                .stdout_text()?
                .lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .collect();
            ensure!(oids.len() == files.len(), "GIT_HASH_OBJECT_FAILED");
            for oid in &oids {
                validate_oid(oid)?;
            }
            Ok(oids)
        })();
        let _ = std::fs::remove_dir_all(&staging);
        result
    }

    /// Current head of a branch, or `None` when the branch does not exist.
    pub fn branch_head(&self, layout: &RepoLayout, branch_id: &str) -> Result<Option<String>> {
        validate_identifier(branch_id, "INVALID_BRANCH_ID")?;
        self.git
            .ref_value(&layout.git_dir, &format!("refs/heads/{branch_id}"))
    }

    pub fn branches(&self, layout: &RepoLayout) -> Result<Vec<RefEntry>> {
        self.git.list_refs(&layout.git_dir, "refs/heads/")
    }

    /// Read the committed asset lock of a commit. `None` means the commit has
    /// no lock file, which is the honest state of migrated source-only history.
    pub fn asset_lock(&self, layout: &RepoLayout, oid: &str) -> Result<Option<AssetLock>> {
        match self.read_file(layout, oid, ASSET_LOCK_FILE) {
            Ok(bytes) => Ok(Some(AssetLock::parse_canonical(&bytes)?)),
            Err(error) if error.to_string().contains("CONTENT_PATH_NOT_FOUND") => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Source content reference for a commit. Requires the commit to carry a
    /// canonical asset lock; source-only legacy commits are not playable
    /// content and must not be reported as such.
    pub fn content_ref(&self, layout: &RepoLayout, oid: &str) -> Result<ContentRef> {
        let lock = self
            .asset_lock(layout, oid)?
            .context("CONTENT_ASSET_LOCK_MISSING")?;
        Ok(ContentRef {
            repo_id: layout.repo_id.clone(),
            commit_oid: oid.to_string(),
            asset_lock_hash: lock.asset_lock_hash()?,
        })
    }

    pub fn tree_entries(&self, layout: &RepoLayout, oid: &str) -> Result<Vec<TreeEntry>> {
        validate_oid(oid)?;
        let output = self
            .git
            .repo(&layout.git_dir, &["ls-tree", "-r", "-z", "--full-tree", oid])?;
        ensure!(
            output.ok(),
            "GIT_LS_TREE_FAILED: {}",
            output.stderr.trim()
        );
        let mut entries = Vec::new();
        for record in output.stdout.split(|byte| *byte == 0) {
            if record.is_empty() {
                continue;
            }
            let text = std::str::from_utf8(record).context("GIT_TREE_PATH_NOT_UTF8")?;
            let (meta, path) = text.split_once('\t').context("GIT_LS_TREE_INVALID")?;
            let mut fields = meta.split_whitespace();
            let mode = fields.next().context("GIT_LS_TREE_INVALID")?;
            let object_type = fields.next().context("GIT_LS_TREE_INVALID")?;
            let object_oid = fields.next().context("GIT_LS_TREE_INVALID")?;
            validate_oid(object_oid)?;
            ensure!(object_type == "blob", "GIT_LS_TREE_INVALID: {object_type}");
            Self::assert_authoring_path(path)?;
            entries.push(TreeEntry {
                mode: mode.to_string(),
                path: path.to_string(),
                oid: object_oid.to_string(),
            });
        }
        Ok(entries)
    }

    pub fn read_file(&self, layout: &RepoLayout, oid: &str, path: &str) -> Result<Vec<u8>> {
        validate_relative_path(path)?;
        let reference = format!("{oid}:{path}");
        let output = self
            .git
            .repo(&layout.git_dir, &["cat-file", "blob", &reference])?;
        ensure!(
            output.ok(),
            "CONTENT_PATH_NOT_FOUND: {path}: {}",
            output.stderr.trim()
        );
        Ok(output.stdout)
    }

    /// Materialise a build copy without any Git metadata, hook or filter.
    pub fn materialize(
        &self,
        layout: &RepoLayout,
        oid: &str,
        target: &Path,
    ) -> Result<MaterializedCopy> {
        ensure!(!target.exists(), "CONTENT_COPY_EXISTS");
        let entries = self.tree_entries(layout, oid)?;
        ensure!(!entries.is_empty(), "CONTENT_COPY_EMPTY");
        std::fs::create_dir_all(target)?;
        let mut files = 0u64;
        let mut bytes = 0u64;
        for entry in &entries {
            ensure!(
                entry.mode == "100644" || entry.mode == "100755",
                "CONTENT_COPY_UNSUPPORTED_ENTRY: {} {}",
                entry.mode,
                entry.path
            );
            let content = self
                .git
                .cat_object(&layout.git_dir, &entry.oid)?;
            let destination = target.join(entry.path.replace('/', std::path::MAIN_SEPARATOR_STR));
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&destination, &content)?;
            files += 1;
            bytes += content.len() as u64;
        }
        let metadata = self.read_metadata(layout)?;
        Ok(MaterializedCopy {
            path: target.to_string_lossy().into_owned(),
            files,
            bytes,
            object_format: metadata.object_format,
        })
    }

    pub fn history(
        &self,
        layout: &RepoLayout,
        rev: &str,
        skip: usize,
        limit: usize,
    ) -> Result<HistoryPage> {
        ensure!(
            limit > 0 && limit <= MAX_HISTORY_PAGE,
            "INVALID_HISTORY_PAGE"
        );
        let records = self.git.log_page(&layout.git_dir, rev, skip, limit)?;
        let total = self.git.commit_count(&layout.git_dir, rev)?;
        let next = skip + records.len();
        Ok(HistoryPage {
            records,
            skip,
            limit,
            total,
            next_skip: (next < total as usize).then_some(next),
        })
    }

    /// File-level changes between two commits or trees.
    pub fn changes(&self, layout: &RepoLayout, from: &str, to: &str) -> Result<Vec<ChangeEntry>> {
        let output = self.git.repo(
            &layout.git_dir,
            &["diff", "--name-status", "-z", "--no-renames", from, to],
        )?;
        ensure!(output.ok(), "GIT_DIFF_FAILED: {}", output.stderr.trim());
        let mut tokens = output.stdout.split(|byte| *byte == 0);
        let mut entries = Vec::new();
        while let Some(status) = tokens.next() {
            if status.is_empty() {
                continue;
            }
            let path = tokens.next().context("GIT_DIFF_INVALID")?;
            let status = std::str::from_utf8(status).context("GIT_DIFF_INVALID")?;
            let path = std::str::from_utf8(path).context("GIT_DIFF_INVALID")?;
            entries.push(ChangeEntry {
                status: status.to_string(),
                path: path.to_string(),
            });
        }
        Ok(entries)
    }

    /// Exact file diff. Binary content is reported as binary and never shown as
    /// a text patch.
    pub fn file_diff(
        &self,
        layout: &RepoLayout,
        from: &str,
        to: &str,
        path: &str,
    ) -> Result<FileDiff> {
        validate_relative_path(path)?;
        let numstat = self.git.repo(
            &layout.git_dir,
            &["diff", "--numstat", "-z", "--no-renames", from, to, "--", path],
        )?;
        ensure!(numstat.ok(), "GIT_DIFF_FAILED: {}", numstat.stderr.trim());
        let tokens: Vec<&[u8]> = numstat.stdout.split(|byte| *byte == 0).collect();
        let header = tokens.first().copied().unwrap_or_default();
        let header = std::str::from_utf8(header).context("GIT_DIFF_INVALID")?;
        let mut fields = header.split('\t');
        let added = fields.next().unwrap_or_default();
        let removed = fields.next().unwrap_or_default();
        let _listed_path = fields.next().unwrap_or_default();
        if added == "-" || removed == "-" {
            let old_bytes = self.blob_size(layout, from, path)?;
            let new_bytes = self.blob_size(layout, to, path)?;
            return Ok(FileDiff::Binary {
                path: path.to_string(),
                old_bytes,
                new_bytes,
            });
        }
        let patch = self.git.repo(
            &layout.git_dir,
            &[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                from,
                to,
                "--",
                path,
            ],
        )?;
        ensure!(patch.ok(), "GIT_DIFF_FAILED: {}", patch.stderr.trim());
        Ok(FileDiff::Text {
            path: path.to_string(),
            added: added.parse().context("GIT_DIFF_INVALID")?,
            removed: removed.parse().context("GIT_DIFF_INVALID")?,
            patch: patch.stdout_text()?,
        })
    }

    fn blob_size(&self, layout: &RepoLayout, rev: &str, path: &str) -> Result<Option<u64>> {
        let reference = format!("{rev}:{path}");
        let output = self
            .git
            .repo(&layout.git_dir, &["cat-file", "-s", &reference])?;
        if !output.ok() {
            return Ok(None);
        }
        Ok(Some(output.trimmed()?.parse().context("GIT_DIFF_INVALID")?))
    }

    /// Three-way merge of two commits from a common base.
    ///
    /// A clean tree here only means Git merged text; the caller must still run
    /// the content verifier. A conflicted merge never returns a tree.
    pub fn merge(
        &self,
        layout: &RepoLayout,
        base: &str,
        ours: &str,
        theirs: &str,
    ) -> Result<MergeOutcome> {
        let base_option = format!("--merge-base={base}");
        let output = self.git.repo(
            &layout.git_dir,
            &[
                "merge-tree",
                "--write-tree",
                "--name-only",
                "--messages",
                &base_option,
                ours,
                theirs,
            ],
        )?;
        ensure!(
            matches!(output.code, 0 | 1),
            "GIT_MERGE_TREE_FAILED: {}",
            output.stderr.trim()
        );
        let text = output.stdout_text()?;
        let mut lines = text.lines();
        let tree = lines.next().unwrap_or_default().trim().to_string();
        let conflicted = output.code == 1;
        let mut messages = Vec::new();
        let mut conflicts = Vec::new();
        // Git prints the conflicted-file section first, then a blank line, then
        // the informational messages.
        let mut in_messages = false;
        for line in lines {
            if line.trim().is_empty() {
                in_messages = true;
                continue;
            }
            if in_messages {
                messages.push(line.to_string());
            } else {
                conflicts.push(line.to_string());
            }
        }
        if conflicted {
            ensure!(
                !conflicts.is_empty() || !messages.is_empty(),
                "GIT_MERGE_TREE_INVALID"
            );
            return Ok(MergeOutcome {
                tree: None,
                conflicted: true,
                messages,
                conflicts,
            });
        }
        validate_oid(&tree)?;
        Ok(MergeOutcome {
            tree: Some(tree),
            conflicted: false,
            messages,
            conflicts,
        })
    }

    /// Create a commit from a tree produced by a merge, then advance a branch.
    pub fn commit_tree(
        &self,
        layout: &RepoLayout,
        branch_id: &str,
        expected_head: Option<&str>,
        tree: &str,
        parents: &[String],
        message: &str,
    ) -> Result<String> {
        validate_identifier(branch_id, "INVALID_BRANCH_ID")?;
        let branch = format!("refs/heads/{branch_id}");
        validate_ref_name(&branch)?;
        let commit = self
            .git
            .commit_tree(&layout.git_dir, tree, parents, message)?;
        self.git
            .update_ref(&layout.git_dir, &branch, &commit, expected_head)?;
        Ok(commit)
    }

    /// Task checkpoint: a protected internal reference that is never shown as a
    /// player-visible version and never reclaimed while its task exists.
    pub fn set_checkpoint(
        &self,
        layout: &RepoLayout,
        task_id: &str,
        sequence: u32,
        oid: &str,
    ) -> Result<String> {
        validate_identifier(task_id, "INVALID_TASK_ID")?;
        validate_oid(oid)?;
        let name = format!("{CHECKPOINT_REF_PREFIX}{task_id}/{sequence:04}");
        validate_ref_name(&name)?;
        self.git
            .update_ref(&layout.git_dir, &name, oid, None)
            .or_else(|error| {
                if error.to_string().contains("GIT_REF_CAS_FAILED") {
                    // Same task, same sequence, same content is idempotent;
                    // different content is a real conflict.
                    let existing = self.git.ref_value(&layout.git_dir, &name)?;
                    ensure!(
                        existing.as_deref() == Some(oid),
                        "CONTENT_CHECKPOINT_CONFLICT: {name}"
                    );
                    Ok(())
                } else {
                    Err(error)
                }
            })?;
        Ok(name)
    }

    pub fn checkpoints(&self, layout: &RepoLayout, task_id: &str) -> Result<Vec<RefEntry>> {
        validate_identifier(task_id, "INVALID_TASK_ID")?;
        self.git
            .list_refs(&layout.git_dir, &format!("{CHECKPOINT_REF_PREFIX}{task_id}/"))
    }

    /// Autosaved draft reference for a branch. Drafts survive check failures
    /// and stale candidates; they are separate from `refs/heads`.
    pub fn set_draft(
        &self,
        layout: &RepoLayout,
        branch_id: &str,
        oid: &str,
        expected: Option<&str>,
    ) -> Result<String> {
        validate_identifier(branch_id, "INVALID_BRANCH_ID")?;
        let name = format!("{DRAFT_REF_PREFIX}{branch_id}");
        validate_ref_name(&name)?;
        self.git
            .update_ref(&layout.git_dir, &name, oid, expected)?;
        Ok(name)
    }

    pub fn draft(&self, layout: &RepoLayout, branch_id: &str) -> Result<Option<String>> {
        validate_identifier(branch_id, "INVALID_BRANCH_ID")?;
        self.git
            .ref_value(&layout.git_dir, &format!("{DRAFT_REF_PREFIX}{branch_id}"))
    }

    /// Named, offline-exportable version. The tag object carries the version
    /// metadata so it survives bundling without the product database.
    pub fn create_version(
        &self,
        layout: &RepoLayout,
        version_id: &str,
        oid: &str,
        message: &str,
    ) -> Result<String> {
        validate_identifier(version_id, "INVALID_VERSION_ID")?;
        validate_oid(oid)?;
        ensure!(
            !message.is_empty() && message.len() <= 64 * 1024 && !message.contains('\0'),
            "CONTENT_VERSION_MESSAGE_INVALID"
        );
        let name = format!("{VERSION_REF_PREFIX}{version_id}");
        validate_ref_name(&name)?;
        let identity = self.git.identity().clone();
        let body = format!(
            "object {oid}\ntype commit\ntag {version_id}\ntagger {name} <{email}> {stamp}\n\n{message}\n",
            name = identity.name,
            email = identity.email,
            stamp = git_timestamp(),
        );
        let output = self.git.repo_stdin(&layout.git_dir, &["mktag"], body.as_bytes())?;
        ensure!(output.ok(), "GIT_MKTAG_FAILED: {}", output.stderr.trim());
        let tag = output.trimmed()?;
        validate_oid(&tag)?;
        self.git
            .update_ref(&layout.git_dir, &name, &tag, None)
            .or_else(|error| {
                if error.to_string().contains("GIT_REF_CAS_FAILED") {
                    let existing = self.git.ref_value(&layout.git_dir, &name)?;
                    ensure!(
                        existing.as_deref() == Some(tag.as_str()),
                        "CONTENT_VERSION_EXISTS: {version_id}"
                    );
                    Ok(())
                } else {
                    Err(error)
                }
            })?;
        Ok(name)
    }

    pub fn versions(&self, layout: &RepoLayout) -> Result<Vec<RefEntry>> {
        self.git.list_refs(&layout.git_dir, VERSION_REF_PREFIX)
    }

    /// Record the content that the host confirmed as applied. The database
    /// remains the authority for "applied"; this reference makes the Git side
    /// auditable and recoverable.
    pub fn set_applied(
        &self,
        layout: &RepoLayout,
        world_key: &str,
        oid: &str,
        expected: Option<&str>,
    ) -> Result<String> {
        validate_identifier(world_key, "INVALID_WORLD_ID")?;
        validate_oid(oid)?;
        let name = format!("{APPLIED_REF_PREFIX}{world_key}");
        validate_ref_name(&name)?;
        self.git
            .update_ref(&layout.git_dir, &name, oid, expected)?;
        Ok(name)
    }

    pub fn applied(&self, layout: &RepoLayout, world_key: &str) -> Result<Option<String>> {
        validate_identifier(world_key, "INVALID_WORLD_ID")?;
        self.git
            .ref_value(&layout.git_dir, &format!("{APPLIED_REF_PREFIX}{world_key}"))
    }

    pub fn protected_refs(&self, layout: &RepoLayout) -> Result<Vec<RefEntry>> {
        let mut entries = Vec::new();
        for prefix in PROTECTED_REF_PREFIXES {
            entries.extend(self.git.list_refs(&layout.git_dir, prefix)?);
        }
        entries.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(entries)
    }

    /// Integrity check. Returns only real problems (missing, corrupt or
    /// unreadable objects), so progress chatter cannot be mistaken for damage
    /// and damage cannot be hidden behind a passing exit code.
    pub fn verify(&self, layout: &RepoLayout, refs: &[String]) -> Result<Vec<String>> {
        let output = self.git.fsck(&layout.git_dir, refs)?;
        const MARKERS: &[&str] = &[
            "error", "fatal", "missing", "broken", "corrupt", "unable", "invalid", "bad ",
        ];
        let mut lines: Vec<String> = output
            .stderr
            .lines()
            .chain(output.stdout_text()?.lines())
            .map(|line| line.trim().to_string())
            .filter(|line| {
                let lower = line.to_lowercase();
                MARKERS.iter().any(|marker| lower.contains(marker))
            })
            .collect();
        lines.sort();
        lines.dedup();
        Ok(lines)
    }

    /// Offline Git carrier for a full backup. Material bodies, drafts and
    /// database data are packaged separately by the backup owner.
    pub fn bundle(&self, layout: &RepoLayout, target: &Path, refs: &[String]) -> Result<()> {
        self.git.bundle_create(&layout.git_dir, target, refs)?;
        self.git.bundle_verify(&layout.git_dir, target)?;
        Ok(())
    }

    /// Reachability report for space reclaim. It never deletes anything.
    ///
    /// Only objects reachable from no reference are candidates. Objects that
    /// are merely outside the keep set remain protected by their own
    /// references and are reported separately.
    pub fn reclaim_plan(&self, layout: &RepoLayout, keep: &[String]) -> Result<ReclaimPlan> {
        ensure!(!keep.is_empty(), "CONTENT_RECLAIM_KEEP_EMPTY");
        for name in keep {
            validate_ref_name(name)?;
            ensure!(
                self.git.ref_value(&layout.git_dir, name)?.is_some(),
                "CONTENT_RECLAIM_REF_MISSING: {name}"
            );
        }
        let mut reachable_args = vec!["rev-list", "--objects"];
        reachable_args.extend(keep.iter().map(|name| name.as_str()));
        let keep_reachable = parse_object_ids(
            &self
                .git
                .repo(&layout.git_dir, &reachable_args)?
                .ensure_ok("GIT_REV_LIST_FAILED")?
                .stdout,
        )?;
        let all_refs = parse_object_ids(
            &self
                .git
                .repo(&layout.git_dir, &["rev-list", "--objects", "--all"])?
                .ensure_ok("GIT_REV_LIST_FAILED")?
                .stdout,
        )?;
        let all_objects = self.all_objects(layout)?;
        let mut garbage_bytes = 0u64;
        let mut sample = Vec::new();
        let mut garbage = 0u64;
        for (oid, size) in &all_objects {
            if all_refs.contains(oid) {
                continue;
            }
            garbage += 1;
            garbage_bytes = garbage_bytes.checked_add(*size).context("CONTENT_RECLAIM_TOO_LARGE")?;
            if sample.len() < 20 {
                sample.push(oid.clone());
            }
        }
        sample.sort();
        Ok(ReclaimPlan {
            keep_refs: keep.to_vec(),
            reachable_objects: keep_reachable.len() as u64,
            referenced_elsewhere: all_refs.difference(&keep_reachable).count() as u64,
            garbage_objects: garbage,
            garbage_bytes,
            sample,
        })
    }

    /// Every object in the repository with its size.
    fn all_objects(&self, layout: &RepoLayout) -> Result<BTreeMap<String, u64>> {
        let output = self.git.repo(
            &layout.git_dir,
            &[
                "cat-file",
                "--batch-all-objects",
                "--batch-check=%(objectname) %(objecttype) %(objectsize)",
            ],
        )?;
        ensure!(
            output.ok(),
            "GIT_CAT_FILE_FAILED: {}",
            output.stderr.trim()
        );
        let mut objects = BTreeMap::new();
        for line in output.stdout_text()?.lines() {
            let mut fields = line.split_whitespace();
            let oid = fields.next().unwrap_or_default();
            if oid.is_empty() {
                continue;
            }
            validate_oid(oid)?;
            let size: u64 = fields.nth(1).unwrap_or_default().parse().unwrap_or(0);
            objects.insert(oid.to_string(), size);
        }
        Ok(objects)
    }

    /// Delete objects unreachable from any reference. Only the reclaim owner
    /// may call this, and only after every eligibility condition passed.
    pub fn prune(&self, layout: &RepoLayout, keep: &[String]) -> Result<ReclaimPlan> {
        let plan = self.reclaim_plan(layout, keep)?;
        if plan.garbage_objects == 0 {
            return Ok(plan);
        }
        let output = self
            .git
            .repo(&layout.git_dir, &["prune", "--expire=now"])?;
        ensure!(output.ok(), "GIT_PRUNE_FAILED: {}", output.stderr.trim());
        Ok(plan)
    }
}

fn parse_object_ids(stdout: &[u8]) -> Result<BTreeSet<String>> {
    let mut set = BTreeSet::new();
    for line in stdout.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            continue;
        }
        let text = std::str::from_utf8(line).context("GIT_REV_LIST_INVALID")?;
        let oid = text.split_whitespace().next().unwrap_or_default();
        validate_oid(oid)?;
        set.insert(oid.to_string());
    }
    Ok(set)
}

fn timestamp() -> String {
    git_timestamp()
}

/// `git log`-style timestamp for tag objects.
fn git_timestamp() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{seconds} +0000")
}

/// Conventional commit message carrying the player request and bound task as
/// trailers. History groups by request id, not by commit subject text.
pub fn commit_message(request_id: &str, task_id: &str, title: &str, detail: &str) -> Result<String> {
    validate_identifier(request_id, "INVALID_REQUEST_ID")?;
    validate_identifier(task_id, "INVALID_TASK_ID")?;
    let title = title.trim();
    ensure!(
        !title.is_empty() && title.len() <= 200 && !title.contains('\n'),
        "CONTENT_COMMIT_MESSAGE_INVALID"
    );
    let mut message = format!("{title}\n");
    if !detail.trim().is_empty() {
        message.push('\n');
        message.push_str(detail.trim());
        message.push('\n');
    }
    message.push_str(&format!(
        "\nCraftmine-Request: {request_id}\nCraftmine-Task: {task_id}\n"
    ));
    Ok(message)
}

/// Group commits by the player request that produced them. Commits without a
/// request trailer are grouped alone so no history is invented.
pub fn group_by_request(records: &[CommitRecord]) -> BTreeMap<String, Vec<&CommitRecord>> {
    let mut groups: BTreeMap<String, Vec<&CommitRecord>> = BTreeMap::new();
    for record in records {
        let key = record
            .request_id
            .clone()
            .unwrap_or_else(|| record.oid.clone());
        groups.entry(key).or_default().push(record);
    }
    groups
}
