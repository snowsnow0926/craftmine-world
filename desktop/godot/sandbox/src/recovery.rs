//! Persistent recovery journal for tasks whose broker died before its final
//! response.
//!
//! A hard-terminated broker cannot run its destructors, so the profile, the
//! task's writable directory and any surviving child have to be reclaimed by a
//! later host-owned pass. This module owns that pass and nothing else: it only
//! reclaims resources whose task identity it can re-verify from data the
//! restricted child cannot write.
//!
//! Ownership evidence, in order:
//! 1. the broker that wrote the entry must no longer run (PID *and* creation
//!    FILETIME are recorded in the entry itself);
//! 2. the journal entry lives in a parent-owned directory outside the granted
//!    scope and records the exact `tasksRoot` it was created for;
//! 3. `tasksRoot/<taskId>/task-identity.json` carries the same random nonce as
//!    the journal entry; the task root itself is never granted to the task SID;
//! 4. the AppContainer profile SID is re-derived from the recorded profile name
//!    and must equal the SID measured at creation;
//! 5. a surviving process is only touched when its PID *and* creation FILETIME
//!    match the host-written pre-resume sidecar and its image sits in the task's
//!    own `bin` directory.
//!
//! Anything that fails a check is reported as skipped, never deleted, and the
//! journal entry is kept so a later pass can retry. A recovery pass never claims
//! `cleanup.verified`: it is by definition a run without a final broker response.
use crate::{report::sid_to_string, win, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_INVALID_PARAMETER, FILETIME, HANDLE, STILL_ACTIVE},
    Security::Isolation::{DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName},
    Security::{FreeSid, PSID},
    System::Threading::{
        GetCurrentProcess, GetExitCodeProcess, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
        TerminateProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    },
};

pub const JOURNAL_DIR: &str = ".recovery-journal";
pub const JOURNAL_POLICY_VERSION: &str = "craftmine.windows.recovery-journal.v1";
pub const IDENTITY_FILE: &str = "task-identity.json";
pub const IDENTITY_SCHEMA_VERSION: u32 = 1;

/// `PROCESS_TERMINATE`, not re-exported by the pinned `windows-sys` feature set.
const PROCESS_TERMINATE: u32 = 0x0001;
/// `SYNCHRONIZE`, not re-exported by the pinned `windows-sys` feature set.
const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;
const WAIT_OBJECT_0: u32 = 0;
const WAIT_TIMEOUT: u32 = 258;

static NONCE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn ordinary(path: &Path) -> Result<fs::Metadata> {
    use std::os::windows::fs::MetadataExt;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_attributes() & 0x400 != 0 {
        return Err("Recovery path contains a reparse point".into());
    }
    Ok(metadata)
}

fn now_unix_ms() -> Result<u128> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())
}

fn filetime_string(value: FILETIME) -> String {
    (((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64).to_string()
}

/// PID and creation FILETIME of the calling process. Used to decide whether the
/// broker that wrote a journal entry is still running.
pub fn current_process_identity() -> Result<(u32, String)> {
    let mut created = FILETIME::default();
    let mut exited = created;
    let mut kernel = created;
    let mut user = created;
    unsafe {
        win(
            GetProcessTimes(GetCurrentProcess(), &mut created, &mut exited, &mut kernel, &mut user),
            "GetProcessTimes(self)",
        )?;
    }
    Ok((std::process::id(), filetime_string(created)))
}

/// `Some(true)` alive, `Some(false)` gone, `None` cannot be determined. An
/// undetermined broker is treated as alive by callers: never reclaim on doubt.
/// A terminated-but-not-yet-reaped process still opens and keeps its creation
/// time, so the exit status decides.
fn process_alive(pid: u32, expected_filetime: &str) -> Option<bool> {
    let handle: HANDLE = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        let error = unsafe { GetLastError() };
        return match error {
            ERROR_INVALID_PARAMETER => Some(false),
            _ => None,
        };
    }
    let guard = CloseOnDrop(handle);
    let mut created = FILETIME::default();
    let mut exited = created;
    let mut kernel = created;
    let mut user = created;
    unsafe {
        if win(
            GetProcessTimes(guard.0, &mut created, &mut exited, &mut kernel, &mut user),
            "GetProcessTimes(peer)",
        )
        .is_err()
        {
            return None;
        }
    }
    if filetime_string(created) != expected_filetime {
        return Some(false);
    }
    let mut exit_code = 0u32;
    unsafe {
        if win(GetExitCodeProcess(guard.0, &mut exit_code), "GetExitCodeProcess(peer)").is_err() {
            return None;
        }
    }
    Some(exit_code as i32 == STILL_ACTIVE)
}

/// Task identity nonce. It only has to be unguessable by the restricted child,
/// which cannot write the task root at all.
pub fn new_identity_nonce() -> String {
    use sha2::{Digest, Sha256};
    let counter = NONCE_COUNTER.fetch_add(1, Ordering::SeqCst);
    let mut digest = Sha256::new();
    digest.update(std::process::id().to_le_bytes());
    digest.update(counter.to_le_bytes());
    digest.update(now_unix_ms().unwrap_or_default().to_le_bytes());
    digest.update(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.subsec_nanos())
            .unwrap_or_default()
            .to_le_bytes(),
    );
    digest.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Parent-owned marker written into a freshly created task root before any
/// directory is granted to the task SID.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskIdentity {
    pub schema_version: u32,
    pub task_id: String,
    pub nonce: String,
    pub created_at_unix_ms: u128,
}

pub fn write_identity(task_root: &Path, task_id: &str, nonce: &str) -> Result<PathBuf> {
    let path = task_root.join(IDENTITY_FILE);
    let identity = TaskIdentity {
        schema_version: IDENTITY_SCHEMA_VERSION,
        task_id: task_id.to_string(),
        nonce: nonce.to_string(),
        created_at_unix_ms: now_unix_ms()?,
    };
    use std::io::Write;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
    file.write_all(&serde_json::to_vec(&identity)?)?;
    file.sync_all()?;
    Ok(path)
}

pub fn read_identity(task_root: &Path) -> Result<TaskIdentity> {
    let path = task_root.join(IDENTITY_FILE);
    if !ordinary(&path)?.is_file() {
        return Err("Task identity marker is not a regular file".into());
    }
    Ok(serde_json::from_slice(&fs::read(&path)?)?)
}

/// One journal record per prepared task.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalEntry {
    pub schema_version: u32,
    pub policy_version: String,
    pub task_id: String,
    pub request_id: String,
    pub operation: String,
    pub tasks_root: String,
    pub task_root: String,
    pub profile_name: String,
    pub profile_sid: String,
    pub identity_nonce: String,
    /// The broker that owns this task. Recovery refuses to touch a task while
    /// this process still runs with the recorded creation time.
    pub broker_pid: u32,
    pub broker_creation_time_filetime: String,
    pub started_at_unix_ms: u128,
    /// `prepared` until the broker retires the entry after reclaiming its own
    /// resources.
    pub state: String,
}

impl JournalEntry {
    #[allow(clippy::too_many_arguments)]
    pub fn prepared(
        task_id: &str,
        request_id: &str,
        operation: &str,
        tasks_root: &Path,
        task_root: &Path,
        profile_name: &str,
        profile_sid: &str,
        identity_nonce: &str,
    ) -> Result<Self> {
        let (broker_pid, broker_creation_time_filetime) = current_process_identity()?;
        Ok(Self {
            schema_version: 1,
            policy_version: JOURNAL_POLICY_VERSION.into(),
            task_id: task_id.to_string(),
            request_id: request_id.to_string(),
            operation: operation.to_string(),
            tasks_root: tasks_root.to_string_lossy().into_owned(),
            task_root: task_root.to_string_lossy().into_owned(),
            profile_name: profile_name.to_string(),
            profile_sid: profile_sid.to_string(),
            identity_nonce: identity_nonce.to_string(),
            broker_pid,
            broker_creation_time_filetime,
            started_at_unix_ms: now_unix_ms()?,
            state: "prepared".into(),
        })
    }
}

pub struct Journal {
    root: PathBuf,
    tasks_root: PathBuf,
}

impl Journal {
    /// Opens (creating if needed) the parent-owned journal directory that
    /// belongs to exactly one `tasksRoot`.
    pub fn open(tasks_root: &Path) -> Result<Self> {
        if !tasks_root.is_absolute() {
            return Err("Journal tasks root must be absolute".into());
        }
        for ancestor in tasks_root.ancestors() {
            if !ordinary(ancestor)?.is_dir() {
                return Err("Journal tasks root ancestor is not an ordinary directory".into());
            }
        }
        let root = tasks_root.join(JOURNAL_DIR);
        match fs::create_dir(&root) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if !ordinary(&root)?.is_dir() {
                    return Err("Recovery journal path is not a directory".into());
                }
            }
            Err(error) => return Err(error.into()),
        }
        Ok(Self { root, tasks_root: tasks_root.to_path_buf() })
    }

    pub fn dir(&self) -> &Path {
        &self.root
    }

    pub fn tasks_root(&self) -> &Path {
        &self.tasks_root
    }

    pub fn entry_path(&self, task_id: &str) -> Result<PathBuf> {
        crate::task::validate_task_id(task_id)?;
        Ok(self.root.join(format!("{task_id}.json")))
    }

    /// Writes the entry exclusively and flushes it before any process starts.
    pub fn write(&self, entry: &JournalEntry) -> Result<PathBuf> {
        let path = self.entry_path(&entry.task_id)?;
        use std::io::Write;
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
        file.write_all(&serde_json::to_vec(entry)?)?;
        file.sync_all()?;
        Ok(path)
    }

    /// Removes the entry. A missing file counts as removed; any other failure is
    /// reported, never swallowed.
    pub fn clear(&self, task_id: &str) -> Result<()> {
        let path = self.entry_path(task_id)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    /// Reads every entry, keeping unreadable files visible instead of aborting
    /// the whole pass. A broker killed mid-write leaves a truncated file.
    pub fn entries(&self) -> Result<(Vec<(PathBuf, JournalEntry)>, Vec<UnreadableEntry>)> {
        let mut entries: Vec<(PathBuf, JournalEntry)> = Vec::new();
        let mut unreadable = Vec::new();
        for item in fs::read_dir(&self.root)? {
            let path = item?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if !ordinary(&path).map(|metadata| metadata.is_file()).unwrap_or(false) {
                unreadable.push(UnreadableEntry { file: path.to_string_lossy().into_owned(), error: "not a regular file".into() });
                continue;
            }
            match fs::read(&path).map_err(|error| error.to_string()).and_then(|bytes| {
                serde_json::from_slice::<JournalEntry>(&bytes).map_err(|error| error.to_string())
            }) {
                Ok(entry) => entries.push((path, entry)),
                Err(error) => unreadable.push(UnreadableEntry { file: path.to_string_lossy().into_owned(), error }),
            }
        }
        entries.sort_by(|left, right| left.1.task_id.cmp(&right.1.task_id));
        unreadable.sort_by(|left, right| left.file.cmp(&right.file));
        Ok((entries, unreadable))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadableEntry {
    pub file: String,
    pub error: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredTask {
    pub task_id: String,
    pub operation: String,
    pub identity_verified: bool,
    /// Always false: this pass exists because no final broker response arrived.
    pub final_receipt_observed: bool,
    pub broker_pid: u32,
    pub broker_still_running: Option<bool>,
    pub child_pid: Option<u32>,
    pub child_creation_time_filetime: Option<String>,
    pub child_process_state: String,
    pub profile_name: String,
    pub profile_deleted: bool,
    pub profile_hresult: Option<i32>,
    pub task_root_removed: bool,
    pub journal_removed: bool,
    pub reclaimed: Vec<String>,
    pub skipped: Vec<String>,
    pub notes: Vec<String>,
}

impl RecoveredTask {
    fn new(entry: &JournalEntry) -> Self {
        Self {
            task_id: entry.task_id.clone(),
            operation: entry.operation.clone(),
            identity_verified: false,
            final_receipt_observed: false,
            broker_pid: entry.broker_pid,
            broker_still_running: None,
            child_pid: None,
            child_creation_time_filetime: None,
            child_process_state: "not-recorded".into(),
            profile_name: entry.profile_name.clone(),
            profile_deleted: false,
            profile_hresult: None,
            task_root_removed: false,
            journal_removed: false,
            reclaimed: Vec::new(),
            skipped: Vec::new(),
            notes: Vec::new(),
        }
    }

    /// True only when the task identity was verified, every reclaim action
    /// succeeded and the journal entry was actually retired. It never means the
    /// build succeeded or that the task itself verified cleanup.
    pub fn reconciled(&self) -> bool {
        self.identity_verified && self.journal_removed
    }

    /// A leftover entry is retirable only when nothing was left unresolved.
    fn retire_eligible(&self) -> bool {
        self.identity_verified
            && self.task_root_removed
            && self.profile_deleted
            && !matches!(self.child_process_state.as_str(), "unknown" | "terminate-failed")
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub policy_version: String,
    pub tasks_root: String,
    pub journal_root: String,
    pub entries: Vec<RecoveredTask>,
    pub unreadable: Vec<UnreadableEntry>,
    pub reconciled_count: usize,
    pub skipped_count: usize,
}

/// Host-owned recovery pass. `tasks_root` must be the exact directory the
/// journal was created for; entries recorded for another root are skipped.
pub fn recover(tasks_root: &Path) -> Result<RecoveryReport> {
    let journal = Journal::open(tasks_root)?;
    let expected_root = tasks_root.canonicalize()?;
    let (entries, unreadable) = journal.entries()?;
    let mut report = RecoveryReport {
        policy_version: JOURNAL_POLICY_VERSION.into(),
        tasks_root: expected_root.to_string_lossy().into_owned(),
        journal_root: journal.dir().to_string_lossy().into_owned(),
        entries: Vec::new(),
        unreadable,
        reconciled_count: 0,
        skipped_count: 0,
    };
    for (path, entry) in entries {
        let mut record = RecoveredTask::new(&entry);
        if let Err(error) = reconcile(&expected_root, &entry, &mut record) {
            record.skipped.push(format!("error: {error}"));
        }
        if record.retire_eligible() {
            match fs::remove_file(&path) {
                Ok(()) => record.journal_removed = true,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => record.journal_removed = true,
                Err(error) => record.skipped.push(format!("journal-remove-failed: {error}")),
            }
        }
        if record.reconciled() {
            report.reconciled_count += 1;
        } else {
            report.skipped_count += 1;
        }
        report.entries.push(record);
    }
    Ok(report)
}

fn reconcile(expected_root: &Path, entry: &JournalEntry, record: &mut RecoveredTask) -> Result<()> {
    if entry.schema_version != 1 || entry.policy_version != JOURNAL_POLICY_VERSION {
        record.skipped.push("unsupported-journal-version".into());
        return Ok(());
    }
    crate::task::validate_task_id(&entry.task_id)?;
    // Never touch a task whose owning broker may still be running. The broker
    // records its own PID and creation time in the entry it wrote.
    match process_alive(entry.broker_pid, &entry.broker_creation_time_filetime) {
        Some(true) => {
            record.broker_still_running = Some(true);
            record.skipped.push("broker-still-running".into());
            return Ok(());
        }
        Some(false) => record.broker_still_running = Some(false),
        None => {
            record.broker_still_running = None;
            record.skipped.push("broker-liveness-unknown".into());
            return Ok(());
        }
    }
    // Cross-root protection: an entry may only ever reclaim inside the tasks
    // root it was created for.
    if Path::new(&entry.tasks_root).canonicalize()? != expected_root {
        record.skipped.push("tasks-root-mismatch".into());
        return Ok(());
    }
    // The task root must be exactly `tasksRoot/<taskId>`: the recorded path is
    // compared component-wise against the canonical tasks root, and when the
    // directory exists its canonical form must match too. No relative escape,
    // no reparse substitution and no other task's directory.
    let task_root = expected_root.join(&entry.task_id);
    let recorded = Path::new(&entry.task_root);
    let recorded_is_child = recorded.is_absolute()
        && recorded.file_name().and_then(|name| name.to_str()) == Some(entry.task_id.as_str())
        && recorded.parent().and_then(|parent| parent.canonicalize().ok()) == Some(expected_root.to_path_buf());
    let recorded_matches = recorded_is_child
        && (!task_root.is_dir() || recorded.canonicalize().ok() == task_root.canonicalize().ok());
    if !recorded_matches {
        record.skipped.push("task-root-mismatch".into());
        return Ok(());
    }
    if !task_root.is_dir() {
        // The directory is gone, so ownership cannot be re-verified. Report it
        // and keep the entry; the profile is left for an explicit host action
        // rather than deleted on a name alone.
        record.skipped.push("task-root-already-absent; identity-unverifiable".into());
        return Ok(());
    }
    for ancestor in task_root.ancestors() {
        if !ordinary(ancestor)?.is_dir() {
            record.skipped.push("task-root-not-ordinary".into());
            return Ok(());
        }
    }
    // Task identity: the nonce marker lives outside every granted directory.
    match read_identity(&task_root) {
        Ok(identity)
            if identity.schema_version == IDENTITY_SCHEMA_VERSION
                && identity.task_id == entry.task_id
                && identity.nonce == entry.identity_nonce =>
        {
            record.identity_verified = true;
        }
        Ok(_) => {
            record.skipped.push("identity-marker-mismatch".into());
            return Ok(());
        }
        Err(error) => {
            record.skipped.push(format!("identity-marker-unreadable: {error}"));
            return Ok(());
        }
    }

    // Child reclamation from the host-written pre-resume sidecar. The sidecar
    // only supplies PID and creation time; ownership is still decided here.
    let sidecar = task_root.join("logs").join("process-verification.json");
    if ordinary(&sidecar).map(|metadata| metadata.is_file()).unwrap_or(false) {
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&sidecar)?)?;
        let pid = value.get("pid").and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok()).filter(|value| *value > 0);
        let filetime = value.get("creationTimeFiletime").and_then(|value| value.as_str());
        match (pid, filetime) {
            (Some(pid), Some(filetime)) => {
                record.child_pid = Some(pid);
                record.child_creation_time_filetime = Some(filetime.to_string());
                record.child_process_state = reclaim_child(pid, filetime, &task_root.join("bin"), record);
            }
            _ => {
                record.skipped.push("sidecar-missing-identity".into());
                record.child_process_state = "not-recorded".into();
            }
        }
    } else {
        record.notes.push("no-child-sidecar-recorded".into());
    }

    // The nonce proves the directory's owner, not that every process has
    // stopped. Keep the profile, sidecar and journal for a later recovery pass
    // whenever a recorded child cannot be proven gone or safely terminated.
    if !child_reclamation_complete(&record.child_process_state)
        || record.skipped.iter().any(|reason| reason == "sidecar-missing-identity") {
        record.skipped.push("child-recovery-incomplete; resources-preserved".into());
        return Ok(());
    }

    // Profile: re-derive the SID from the recorded name and require it to match
    // the SID measured at creation before deleting anything.
    match derive_sid(&entry.profile_name) {
        Ok(derived) if derived == entry.profile_sid => {
            let name = crate::wide(&entry.profile_name);
            let code = unsafe { DeleteAppContainerProfile(name.as_ptr()) };
            record.profile_hresult = Some(code);
            record.profile_deleted = code >= 0;
            if code < 0 {
                record.skipped.push(format!("profile-delete-hresult-{:#x}", code as u32));
            }
        }
        Ok(_) => record.skipped.push("profile-sid-mismatch".into()),
        Err(error) => record.skipped.push(format!("profile-sid-derive-failed: {error}")),
    }
    if !record.profile_deleted {
        record.notes.push("profile-recovery-incomplete; identity-and-logs-preserved".into());
        return Ok(());
    }

    // Directory reclamation happens only after identity is verified.
    for name in ["work", "bin", "logs", "artifacts"] {
        if task_root.join(name).exists() {
            record.reclaimed.push(name.to_string());
        }
    }
    // A just-terminated child can still be releasing handles for a moment, so
    // deletion is retried a bounded number of times before it is reported.
    let mut last_error = None;
    let mut removed = false;
    for attempt in 0..4u32 {
        match fs::remove_dir_all(&task_root) {
            Ok(()) => {
                removed = true;
                if attempt > 0 {
                    record.notes.push(format!("task-root-removed-after-{attempt}-retries"));
                }
                break;
            }
            Err(error) => {
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
    if removed {
        record.task_root_removed = true;
    } else if let Some(error) = last_error {
        record.skipped.push(format!("task-root-remove-failed: {error}"));
    }
    Ok(())
}

fn child_reclamation_complete(state: &str) -> bool {
    matches!(state, "gone" | "terminated" | "pid-reused" | "not-recorded")
}

fn derive_sid(profile_name: &str) -> Result<String> {
    let mut sid: PSID = std::ptr::null_mut();
    let name = crate::wide(profile_name);
    // HRESULT API: S_OK is 0, so this must not use the BOOL-style `win` helper.
    let code = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
    if code < 0 {
        return Err(format!("DeriveAppContainerSidFromAppContainerName HRESULT {:#x}", code as u32).into());
    }
    if sid.is_null() {
        return Err("Derived AppContainer SID is null".into());
    }
    let text = unsafe { sid_to_string(sid)? };
    unsafe { FreeSid(sid) };
    Ok(text)
}

/// Returns one of `gone`, `terminated`, `pid-reused`, `terminate-failed`,
/// `unknown`. A reused PID is never terminated: it is another process. Failures
/// to identify a live process are recorded, never treated as success, and never
/// abort the rest of the reconciliation.
fn reclaim_child(
    pid: u32,
    expected_filetime: &str,
    bin_root: &Path,
    record: &mut RecoveredTask,
) -> String {
    let access = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE_ACCESS;
    let handle: HANDLE = unsafe { OpenProcess(access, 0, pid) };
    if handle.is_null() {
        let error = unsafe { GetLastError() };
        if error == ERROR_INVALID_PARAMETER {
            return "gone".into();
        }
        record.notes.push(format!("open-process-error-{error}"));
        return "unknown".into();
    }
    let guard = CloseOnDrop(handle);
    let mut created = FILETIME::default();
    let mut exited = created;
    let mut kernel = created;
    let mut user = created;
    unsafe {
        if win(
            GetProcessTimes(guard.0, &mut created, &mut exited, &mut kernel, &mut user),
            "GetProcessTimes",
        )
        .is_err()
        {
            record.notes.push("get-process-times-failed".into());
            return "unknown".into();
        }
    }
    if filetime_string(created) != expected_filetime {
        record.notes.push("recorded-pid-now-belongs-to-another-process".into());
        return "pid-reused".into();
    }
    // A Job-closed child is usually already dead by the time recovery runs. A
    // zombie handle still opens, so exit status decides before any termination.
    let mut exit_code = 0u32;
    unsafe {
        if win(GetExitCodeProcess(guard.0, &mut exit_code), "GetExitCodeProcess").is_err() {
            record.notes.push("get-exit-code-failed".into());
            return "unknown".into();
        }
    }
    if exit_code as i32 != STILL_ACTIVE {
        record.notes.push(format!("recorded-child-already-exited-{}", crate::hex(exit_code)));
        return "gone".into();
    }
    // The image must live in this task's own bin directory before we terminate.
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    unsafe {
        if win(
            QueryFullProcessImageNameW(guard.0, 0, buffer.as_mut_ptr(), &mut length),
            "QueryFullProcessImageNameW",
        )
        .is_err()
        {
            record.notes.push("live-process-image-unreadable; not terminated".into());
            return "unknown".into();
        }
    }
    let image = PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize]));
    let image_parent = image.canonicalize().ok().and_then(|path| path.parent().map(Path::to_path_buf));
    if image_parent != bin_root.canonicalize().ok() {
        record.notes.push("recorded-pid-image-outside-task-bin; not terminated".into());
        return "unknown".into();
    }
    unsafe {
        if win(TerminateProcess(guard.0, 91), "TerminateProcess").is_err() {
            record.notes.push("terminate-process-failed".into());
            return "unknown".into();
        }
    }
    let waited = unsafe { WaitForSingleObject(guard.0, 5000) };
    if waited != WAIT_OBJECT_0 {
        record.notes.push(format!("wait-for-terminated-child-returned-{waited}"));
        return "terminate-failed".into();
    }
    let mut final_code = 0u32;
    unsafe {
        let _ = GetExitCodeProcess(guard.0, &mut final_code);
    }
    record.notes.push(format!("terminated-exit-{}", crate::hex(final_code)));
    let _ = WAIT_TIMEOUT;
    "terminated".into()
}

struct CloseOnDrop(HANDLE);
impl Drop for CloseOnDrop {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                windows_sys::Win32::Foundation::CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "cm-recovery-{}-{}-{}",
            name,
            std::process::id(),
            now_unix_ms().unwrap()
        ));
        fs::create_dir(&root).unwrap();
        root
    }

    fn entry(root: &Path, task_id: &str, nonce: &str) -> JournalEntry {
        let (broker_pid, broker_creation_time_filetime) = current_process_identity().unwrap();
        JournalEntry {
            schema_version: 1,
            policy_version: JOURNAL_POLICY_VERSION.into(),
            task_id: task_id.into(),
            request_id: task_id.into(),
            operation: "import".into(),
            tasks_root: root.to_string_lossy().into_owned(),
            task_root: root.join(task_id).to_string_lossy().into_owned(),
            profile_name: format!("craftmine.godot.task.{task_id}"),
            profile_sid: "S-1-15-2-0".into(),
            identity_nonce: nonce.into(),
            broker_pid,
            broker_creation_time_filetime,
            started_at_unix_ms: 1,
            state: "prepared".into(),
        }
    }

    /// A dead broker is simulated by a PID that cannot exist with the recorded
    /// creation time.
    fn dead_broker(record: &mut JournalEntry) {
        record.broker_pid = 0xFFFF_FFFE;
        record.broker_creation_time_filetime = "1".into();
    }

    #[test]
    fn journal_entry_is_exclusive_and_survives_reopen() {
        let root = temp_root("journal");
        let journal = Journal::open(&root).unwrap();
        let record = entry(&root, "task-one", &"0".repeat(64));
        journal.write(&record).unwrap();
        assert!(journal.write(&record).is_err(), "a journal entry is never overwritten");
        let reopened = Journal::open(&root).unwrap();
        let (entries, unreadable) = reopened.entries().unwrap();
        assert_eq!(entries.len(), 1);
        assert!(unreadable.is_empty());
        assert_eq!(entries[0].1.task_id, "task-one");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn recovery_refuses_to_touch_a_task_whose_broker_is_still_running() {
        let root = temp_root("live");
        let journal = Journal::open(&root).unwrap();
        let nonce = new_identity_nonce();
        let task_root = root.join("task-live");
        fs::create_dir_all(&task_root).unwrap();
        write_identity(&task_root, "task-live", &nonce).unwrap();
        journal.write(&entry(&root, "task-live", &nonce)).unwrap();
        let report = recover(&root).unwrap();
        assert_eq!(report.reconciled_count, 0);
        assert!(report.entries[0].skipped.iter().any(|reason| reason == "broker-still-running"));
        assert!(task_root.exists(), "a live task is never reclaimed");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn recovery_skips_a_task_root_without_a_matching_identity_marker() {
        let root = temp_root("skip");
        let journal = Journal::open(&root).unwrap();
        let task_root = root.join("task-two");
        fs::create_dir_all(task_root.join("work")).unwrap();
        fs::write(task_root.join("work").join("stale.txt"), b"keep").unwrap();
        let mut record = entry(&root, "task-two", &"a".repeat(64));
        dead_broker(&mut record);
        journal.write(&record).unwrap();
        let report = recover(&root).unwrap();
        assert_eq!(report.reconciled_count, 0);
        assert_eq!(report.skipped_count, 1);
        assert!(report.entries[0].skipped.iter().any(|reason| reason.contains("identity-marker")));
        assert!(task_root.join("work").join("stale.txt").exists(), "unverified data is never deleted");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn recovery_refuses_an_entry_recorded_for_another_tasks_root() {
        let root = temp_root("cross");
        let other = temp_root("cross-other");
        let journal = Journal::open(&root).unwrap();
        let task_root = other.join("task-three");
        fs::create_dir_all(&task_root).unwrap();
        let nonce = new_identity_nonce();
        write_identity(&task_root, "task-three", &nonce).unwrap();
        let mut record = entry(&other, "task-three", &nonce);
        dead_broker(&mut record);
        journal.write(&record).unwrap();
        let report = recover(&root).unwrap();
        assert_eq!(report.reconciled_count, 0);
        assert!(report.entries[0].skipped.iter().any(|reason| reason == "tasks-root-mismatch"));
        assert!(task_root.exists(), "a foreign tasks root is never touched");
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&other).unwrap();
    }

    #[test]
    fn recovery_skips_an_entry_whose_task_root_was_replaced() {
        let root = temp_root("replace");
        let journal = Journal::open(&root).unwrap();
        let nonce = new_identity_nonce();
        let task_root = root.join("task-five");
        fs::create_dir_all(&task_root).unwrap();
        write_identity(&task_root, "task-five", &nonce).unwrap();
        let mut record = entry(&root, "task-five", &nonce);
        // A substituted task root: the recorded path no longer resolves there.
        record.task_root = root.join("task-other").to_string_lossy().into_owned();
        dead_broker(&mut record);
        journal.write(&record).unwrap();
        let report = recover(&root).unwrap();
        assert_eq!(report.reconciled_count, 0);
        assert!(report.entries[0].skipped.iter().any(|reason| reason == "task-root-mismatch"));
        assert!(task_root.exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn recovery_keeps_an_entry_when_the_task_root_is_already_absent() {
        let root = temp_root("absent");
        let journal = Journal::open(&root).unwrap();
        let mut record = entry(&root, "task-six", &"b".repeat(64));
        dead_broker(&mut record);
        journal.write(&record).unwrap();
        let report = recover(&root).unwrap();
        assert_eq!(report.reconciled_count, 0);
        assert!(!report.entries[0].identity_verified);
        assert!(report.entries[0].skipped.iter().any(|reason| reason.contains("already-absent")));
        assert!(journal.entry_path("task-six").unwrap().exists(), "unverifiable entries are kept");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn recovery_reports_a_truncated_entry_instead_of_aborting() {
        let root = temp_root("truncated");
        let journal = Journal::open(&root).unwrap();
        fs::write(journal.dir().join("task-bad.json"), b"{\"schemaVersion\":1").unwrap();
        let record = entry(&root, "task-good", &"c".repeat(64));
        journal.write(&record).unwrap();
        let report = recover(&root).unwrap();
        assert_eq!(report.unreadable.len(), 1);
        assert!(report.unreadable[0].file.contains("task-bad"));
        assert_eq!(report.entries.len(), 1);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn journal_clear_reports_a_real_removal() {
        let root = temp_root("clear");
        let journal = Journal::open(&root).unwrap();
        let record = entry(&root, "task-seven", &"d".repeat(64));
        journal.write(&record).unwrap();
        assert!(journal.entry_path("task-seven").unwrap().exists());
        journal.clear("task-seven").unwrap();
        assert!(!journal.entry_path("task-seven").unwrap().exists());
        journal.clear("task-seven").unwrap();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn identity_markers_are_exclusive_and_bound_to_the_task_id() {
        let root = temp_root("identity");
        let nonce = new_identity_nonce();
        write_identity(&root, "task-four", &nonce).unwrap();
        assert!(write_identity(&root, "task-four", &nonce).is_err());
        let read = read_identity(&root).unwrap();
        assert_eq!(read.task_id, "task-four");
        assert_eq!(read.nonce, nonce);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn nonces_are_not_repeated_within_a_process() {
        let first = new_identity_nonce();
        let second = new_identity_nonce();
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
    }

    #[test]
    fn own_process_is_reported_alive_and_a_missing_pid_is_not() {
        let (pid, filetime) = current_process_identity().unwrap();
        assert_eq!(process_alive(pid, &filetime), Some(true));
        assert_eq!(process_alive(pid, "1"), Some(false));
        assert_eq!(process_alive(0xFFFF_FFFE, "1"), Some(false));
    }

    #[test]
    fn incomplete_child_recovery_preserves_profile_and_retry_evidence() {
        assert!(!child_reclamation_complete("unknown"));
        assert!(!child_reclamation_complete("terminate-failed"));
        let root = temp_root("child-unknown");
        let journal = Journal::open(&root).unwrap();
        let nonce = new_identity_nonce();
        let task_root = root.join("task-child");
        fs::create_dir_all(task_root.join("logs")).unwrap();
        fs::create_dir_all(task_root.join("bin")).unwrap();
        write_identity(&task_root, "task-child", &nonce).unwrap();
        let mut record = entry(&root, "task-child", &nonce);
        dead_broker(&mut record);
        journal.write(&record).unwrap();
        // The current test process has a real PID/creation time but its image
        // is outside the empty task bin. Recovery must not terminate it.
        let (pid, filetime) = current_process_identity().unwrap();
        let sidecar = task_root.join("logs/process-verification.json");
        fs::write(&sidecar, serde_json::to_vec(&serde_json::json!({
            "pid":pid,"creationTimeFiletime":filetime
        })).unwrap()).unwrap();
        let report = recover(&root).unwrap();
        let recovered = &report.entries[0];
        assert_eq!(recovered.child_process_state, "unknown");
        assert_eq!(recovered.profile_hresult, None);
        assert!(!recovered.task_root_removed);
        assert!(!recovered.journal_removed);
        assert!(sidecar.exists());
        assert!(journal.entry_path("task-child").unwrap().exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn profile_identity_mismatch_preserves_task_marker_for_retry() {
        let root = temp_root("profile-mismatch");
        let journal = Journal::open(&root).unwrap();
        let nonce = new_identity_nonce();
        let task_root = root.join("task-profile");
        fs::create_dir_all(&task_root).unwrap();
        write_identity(&task_root, "task-profile", &nonce).unwrap();
        let mut record = entry(&root, "task-profile", &nonce);
        dead_broker(&mut record);
        // entry() deliberately carries a SID that cannot match this name.
        journal.write(&record).unwrap();
        let report = recover(&root).unwrap();
        assert!(!report.entries[0].profile_deleted);
        assert!(!report.entries[0].task_root_removed);
        assert!(read_identity(&task_root).is_ok());
        assert!(journal.entry_path("task-profile").unwrap().exists());
        fs::remove_dir_all(&root).unwrap();
    }
}
