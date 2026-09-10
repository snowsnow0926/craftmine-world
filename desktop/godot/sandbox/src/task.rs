//! Product-facing task API for managed Godot builds.
//!
//! This is the interface other components (task B's executor, the PI tools and
//! the desktop UI) use. It owns the whole lifetime of a build task: pinned
//! engine/template inputs, a per-task AppContainer profile, a task desktop,
//! scoped directory permissions, the resource budget, cancellation, log
//! capture and artifact handoff.
//!
//! Security rules encoded here:
//! - A task id is validated and only ever used to build new paths.
//! - Only directories created for this task are granted to the task SID.
//! - The engine, templates and probe binaries are hash-pinned before use.
//! - Artifacts are hashed by the parent; they stay untrusted model output.
//! - Cancellation and timeout always terminate the whole task job.
use crate::{
    acl::{grant_new_directory, inspect_new_work_label},
    desktop::{PrivateDesktop, StationChoice},
    launch::{minimal_environment, JobPolicy, LaunchSpec, Redirection},
    profile::AppContainerProfile,
    Result,
};
use sha2::{Digest, Sha256};
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::AtomicBool,
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
};

/// Which managed operation the task performs. There is no free-form command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskKind {
    Version,
    Import,
    ExportWeb,
    ExportWindows,
}

impl TaskKind {
    fn args(&self, project: &Path, export_dir: &Path) -> Vec<String> {
        match self {
            TaskKind::Version => vec!["--headless".into(), "--version".into()],
            TaskKind::Import => vec![
                "--headless".into(),
                "--path".into(),
                project.to_string_lossy().into_owned(),
                "--import".into(),
            ],
            TaskKind::ExportWeb => vec![
                "--headless".into(),
                "--path".into(),
                project.to_string_lossy().into_owned(),
                "--export-release".into(),
                "Web".into(),
                export_dir.join("index.html").to_string_lossy().into_owned(),
            ],
            TaskKind::ExportWindows => vec![
                "--headless".into(), "--path".into(),
                project.to_string_lossy().into_owned(), "--export-release".into(),
                "Windows Desktop".into(), export_dir.join("game.exe").to_string_lossy().into_owned(),
            ],
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct TaskBudget {
    pub timeout: Duration,
    pub job: JobPolicy,
    pub resource: ResourceBudget,
}

impl Default for TaskBudget {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(600),
            job: JobPolicy::default(),
            resource: ResourceBudget::default(),
        }
    }
}

/// Runtime resource ceiling sampled by the host while a task runs.
///
/// This is deliberately described as a sampled budget, not a filesystem quota:
/// the task can transiently exceed the limit by up to one sampling interval,
/// and the parent then terminates the whole job. Windows has no per-directory
/// hard disk quota that can be applied to an AppContainer without machine-wide
/// policy, which this project must not change.
#[derive(Clone, Copy, Debug)]
pub struct ResourceBudget {
    /// Maximum bytes allowed under the task's writable `work` directory.
    pub work_bytes: u64,
    /// Maximum size of the task's inherited diagnostic log file.
    pub log_bytes: u64,
    /// How often the parent samples both counters.
    pub sample_interval: Duration,
}

impl Default for ResourceBudget {
    fn default() -> Self {
        Self {
            work_bytes: 1024 * 1024 * 1024,
            log_bytes: 4 * 1024 * 1024,
            // A shorter interval directly reduces the bounded overshoot, because
            // the breach is only observed at the next sample.
            sample_interval: Duration::from_millis(50),
        }
    }
}

/// What the parent actually measured and enforced for one task.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceEnforcement {
    pub policy_version: String,
    /// Honest scope statement for consumers; see [`ResourceBudget`].
    pub scope: String,
    pub hard_filesystem_quota: bool,
    pub work_bytes_limit: u64,
    pub log_bytes_limit: u64,
    pub sample_interval_ms: u64,
    pub samples: u64,
    pub max_observed_work_bytes: u64,
    pub max_observed_log_bytes: u64,
    pub enforced: bool,
    pub reason: Option<String>,
}

impl ResourceEnforcement {
    fn new(budget: &ResourceBudget) -> Self {
        Self {
            policy_version: RESOURCE_POLICY_VERSION.into(),
            scope: "sampled-task-work-directory-and-log-size; parent terminates the job on breach".into(),
            hard_filesystem_quota: false,
            work_bytes_limit: budget.work_bytes,
            log_bytes_limit: budget.log_bytes,
            sample_interval_ms: budget.sample_interval.as_millis() as u64,
            samples: 0,
            max_observed_work_bytes: 0,
            max_observed_log_bytes: 0,
            enforced: false,
            reason: None,
        }
    }
}

pub const RESOURCE_POLICY_VERSION: &str = "craftmine.windows.sampled-work-budget.v1";

/// Total bytes of every stream of a file. `metadata.len()` counts only the
/// unnamed stream, so a task could otherwise hide data in an alternate data
/// stream and stay under the budget. Falls back to the unnamed size when stream
/// enumeration is unavailable.
fn file_total_bytes(path: &Path, unnamed: u64) -> u64 {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            FindFirstStreamW, FindNextStreamW, FindStreamInfoStandard, WIN32_FIND_STREAM_DATA,
        },
    };
    const MAX_STREAMS: usize = 64;
    let wide = crate::wide(path);
    let mut data = WIN32_FIND_STREAM_DATA::default();
    let handle = unsafe {
        FindFirstStreamW(
            wide.as_ptr(),
            FindStreamInfoStandard,
            (&mut data as *mut WIN32_FIND_STREAM_DATA).cast(),
            0,
        )
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return unnamed;
    }
    let mut total = 0u64;
    let mut count = 0usize;
    loop {
        total = total.saturating_add(data.StreamSize.max(0) as u64);
        count += 1;
        if count >= MAX_STREAMS {
            break;
        }
        let more = unsafe { FindNextStreamW(handle, (&mut data as *mut WIN32_FIND_STREAM_DATA).cast()) };
        if more == 0 {
            break;
        }
    }
    unsafe {
        CloseHandle(handle);
    }
    if total == 0 {
        unnamed
    } else {
        total
    }
}

/// Bounded recursive byte count. Stops as soon as the cap is exceeded so a
/// hostile task cannot make the parent walk an unbounded tree, and ignores
/// entries that vanish mid-walk: the Godot editor creates and deletes files
/// continuously, and a transient `NotFound` must never fail the task.
fn directory_bytes(root: &Path, cap: u64) -> Result<u64> {
    fn visit(root: &Path, cap: u64, total: &mut u64) {
        use std::os::windows::fs::MetadataExt;
        let entries = match fs::read_dir(root) {
            Ok(entries) => entries,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if *total > cap {
                return;
            }
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.file_attributes() & 0x400 != 0 {
                // Reparse point: never followed or counted.
                continue;
            }
            if metadata.is_dir() {
                visit(&path, cap, total);
            } else if metadata.is_file() {
                *total = total.saturating_add(file_total_bytes(&path, metadata.len()));
            }
        }
    }
    let mut total = 0u64;
    if root.is_dir() {
        visit(root, cap, &mut total);
    }
    Ok(total)
}

/// A pinned engine input. The caller supplies the hash, never the task.
#[derive(Clone, Debug)]
pub struct PinnedInput {
    pub source: PathBuf,
    pub sha256: String,
    /// File name inside the task's `bin` (engine) or template directory.
    pub file_name: String,
}

#[derive(Clone, Debug)]
pub struct EnginePins {
    pub editor: PinnedInput,
    /// Export templates are copied into the task's `work` directory so the
    /// engine finds them through its redirected `APPDATA`.
    pub templates: Vec<PinnedInput>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskState {
    Prepared,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug)]
pub struct TaskStatus {
    pub state: TaskState,
    pub exit_code: Option<u32>,
    pub message: String,
}

#[derive(Clone, Debug)]
pub struct Artifact {
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Validates a task id: only `[A-Za-z0-9._-]`, 1..=96 characters.
pub fn validate_task_id(task_id: &str) -> Result<()> {
    if task_id.is_empty() || task_id.len() > 96 {
        return Err("Task id must be 1..=96 characters".into());
    }
    if !task_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err("Task id may only contain ASCII letters, digits, '.', '_' and '-'".into());
    }
    if task_id.starts_with('.') || task_id.ends_with('.') {
        return Err("Task id must not start or end with '.'".into());
    }
    let stem = task_id.split('.').next().unwrap_or_default().to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") ||
        ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 &&
            matches!(stem.as_bytes()[3], b'1'..=b'9')) {
        return Err("Reserved Windows task name".into());
    }
    Ok(())
}

fn ordinary(path: &Path) -> Result<fs::Metadata> {
    use std::os::windows::fs::MetadataExt;
    let meta = fs::symlink_metadata(path)?;
    if meta.file_attributes() & 0x400 != 0 { return Err("Task path contains a reparse point".into()); }
    Ok(meta)
}

fn digest(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn copy_pinned(input: &PinnedInput, destination: &Path) -> Result<()> {
    validate_task_id(&input.file_name)?;
    if !ordinary(&input.source)?.is_file() { return Err("Pinned input is not a regular file".into()); }
    let actual = digest(&input.source)?;
    if actual != input.sha256 {
        return Err(format!(
            "Pinned input {} hash mismatch: expected {} got {actual}",
            input.source.display(),
            input.sha256
        )
        .into());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&input.source, destination)?;
    if digest(destination)? != input.sha256 { return Err("Pinned input changed while being copied".into()); }
    Ok(())
}

/// Directory layout owned by one task. Only these directories are ever created
/// or granted to the task SID.
pub struct TaskLayout {
    pub root: PathBuf,
    pub bin: PathBuf,
    pub work: PathBuf,
    pub logs: PathBuf,
    pub artifacts: PathBuf,
    pub project: PathBuf,
    pub export_dir: PathBuf,
}

/// Godot's Windows editor cache creation in AppContainer does not reliably
/// accept long paths. Keep the observed working compatibility budget
/// explicit, including AppContainer's redirected Packages/<profile>/AC path.
/// This is a compatibility budget, not a claim of arbitrary long-path support.
pub const EDITOR_CACHE_PATH_LIMIT: usize = 245;
pub fn validate_editor_cache_path(tasks_root: &Path, task_id: &str) -> Result<()> {
    let cache = tasks_root.join(task_id).join("work").join("Packages")
        .join(format!("craftmine.godot.task.{task_id}")).join("AC").join("Godot");
    let units = cache.to_string_lossy().encode_utf16().count();
    if units > EDITOR_CACHE_PATH_LIMIT {
        return Err(format!("GODOT_TASK_PATH_TOO_LONG: prepare editor-cache path uses {units} UTF-16 units; limit {EDITOR_CACHE_PATH_LIMIT}").into());
    }
    Ok(())
}

impl TaskLayout {
    pub fn create(root: &Path, task_id: &str) -> Result<Self> {
        validate_task_id(task_id)?;
        if !root.is_absolute() { return Err("Task root must be absolute".into()); }
        for ancestor in root.ancestors() {
            if !ordinary(ancestor)?.is_dir() { return Err("Task root ancestor is not a directory".into()); }
        }
        let root = root.join(task_id);
        // create_dir is exclusive: a retry must use a fresh task id, never merge
        // new inputs into prior task files, permissions or artifacts.
        fs::create_dir(&root)?;
        let layout = Self {
            bin: root.join("bin"),
            work: root.join("work"),
            logs: root.join("logs"),
            artifacts: root.join("artifacts"),
            project: root.join("work").join("project"),
            export_dir: root.join("work").join("export"),
            root,
        };
        for path in [
            &layout.bin,
            &layout.work,
            &layout.logs,
            &layout.artifacts,
            &layout.project,
            &layout.export_dir,
        ] {
            fs::create_dir(path)?;
        }
        Ok(layout)
    }
}

/// Removes a freshly created task root if preparation fails before the broker
/// writes its journal entry. Disarmed once the task is fully constructed.
struct TaskRootGuard {
    root: PathBuf,
    armed: bool,
}

impl TaskRootGuard {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TaskRootGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

/// One managed build task.
pub struct Task {
    pub task_id: String,
    pub kind: TaskKind,
    pub layout: TaskLayout,
    pub budget: TaskBudget,
    /// AppContainer profile name, recorded so a later recovery pass can
    /// re-derive and verify the SID before deleting it.
    pub profile_name: String,
    /// Parent-owned identity nonce, also written to the task root marker.
    pub identity_nonce: String,
    profile: AppContainerProfile,
    desktop: PrivateDesktop,
    sid: String,
    status: TaskStatus,
    log: PathBuf,
    engine: PathBuf,
    process_verification: Option<crate::verification::ProcessVerification>,
    network_preflight: Option<crate::preflight::NetworkPreflight>,
    resource_enforcement: Option<ResourceEnforcement>,
    completed_job_active_processes: Option<u32>,
}

impl Task {
    /// Prepares a task: validates inputs, pins them, creates the AppContainer
    /// profile, the task desktop and the scoped directory permissions.
    ///
    /// `project_source` is copied into the task's own work directory, so the
    /// caller's project is never handed to the restricted process directly.
    pub fn prepare(
        tasks_root: &Path,
        task_id: &str,
        kind: TaskKind,
        project_source: Option<&Path>,
        pins: &EnginePins,
        budget: TaskBudget,
    ) -> Result<Self> {
        if budget.job.active_process_limit != 1 || budget.job.process_memory_bytes == 0 || budget.timeout.is_zero() {
            return Err("Managed task requires one active process and positive memory/time limits".into());
        }
        validate_task_id(&pins.editor.file_name)?;
        for template in &pins.templates { validate_task_id(&template.file_name)?; }
        validate_task_id(task_id)?;
        // --version never initializes the editor cache. Discovery must still
        // attest the actual process/network policy on a long data root; the
        // subsequent import fails as a durable job before engine startup.
        if !matches!(kind, TaskKind::Version) {
            validate_editor_cache_path(tasks_root, task_id)?;
        }
        let layout = TaskLayout::create(tasks_root, task_id)?;
        // A task root must never exist without a journal entry: the broker writes
        // the entry after `prepare` succeeds. If preparation fails, remove the
        // directory we just created so nothing is left outside recovery's view.
        let mut guard = TaskRootGuard { root: layout.root.clone(), armed: true };
        copy_pinned(&pins.editor, &layout.bin.join(&pins.editor.file_name))?;
        for template in &pins.templates {
            let target = layout
                .work
                .join("Godot")
                .join("export_templates")
                .join("4.7.2.stable")
                .join(&template.file_name);
            copy_pinned(template, &target)?;
        }
        if let Some(source) = project_source {
            copy_tree(source, &layout.project)?;
        }
        let identity_nonce = crate::recovery::new_identity_nonce();
        crate::recovery::write_identity(&layout.root, task_id, &identity_nonce)?;
        let profile_name = format!("craftmine.godot.task.{task_id}");
        let profile = AppContainerProfile::create(
            &profile_name,
            "Craftmine managed Godot build task",
        )?;
        let sid = unsafe { crate::report::sid_to_string(profile.sid())? };
        let desktop = unsafe {
            PrivateDesktop::create(
                &format!("task-{task_id}"),
                &sid,
                StationChoice::SessionDefault,
                &[],
            )?
        };
        unsafe {
            grant_new_directory(&layout.bin, profile.sid(), FILE_GENERIC_READ | FILE_GENERIC_EXECUTE)?;
            grant_new_directory(
                &layout.work,
                profile.sid(),
                FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE,
            )?;
            let level = inspect_new_work_label(&layout.work)?;
            if level > 0x2000 {
                return Err("Task work directory integrity exceeds Medium".into());
            }
        }
        let log = layout.logs.join("task.log");
        let engine = layout.bin.join(&pins.editor.file_name);
        guard.disarm();
        Ok(Self {
            process_verification: None,
            network_preflight: None,
            resource_enforcement: None,
            completed_job_active_processes: None,
            engine,
            task_id: task_id.to_string(),
            kind,
            layout,
            budget,
            profile_name,
            identity_nonce,
            profile,
            desktop,
            sid,
            status: TaskStatus {
                state: TaskState::Prepared,
                exit_code: None,
                message: "prepared".into(),
            },
            log,
        })
    }

    pub fn sid(&self) -> &str {
        &self.sid
    }

    pub fn status(&self) -> &TaskStatus {
        &self.status
    }

    pub fn log_path(&self) -> &Path {
        &self.log
    }

    pub fn process_verification(&self) -> Option<&crate::verification::ProcessVerification> { self.process_verification.as_ref() }
    pub fn network_preflight(&self) -> Option<&crate::preflight::NetworkPreflight> { self.network_preflight.as_ref() }
    pub fn resource_enforcement(&self) -> Option<&ResourceEnforcement> { self.resource_enforcement.as_ref() }
    pub fn completed_job_active_processes(&self) -> Option<u32> { self.completed_job_active_processes }

    /// Host-only entry: the preflight binary is the caller's pinned broker,
    /// not a model-provided path. It runs before project code under the exact
    /// same package SID, capabilities, private desktop and policy recipe.
    pub fn run_with_preflight(&mut self, broker: &PinnedInput, cancel: Arc<AtomicBool>) -> Result<&TaskStatus> {
        if self.status.state != TaskState::Prepared { return Err("Task has already been run".into()); }
        let binary = self.layout.bin.join("broker-preflight.exe");
        copy_pinned(broker, &binary)?;
        let spec = LaunchSpec { executable: binary, args: Vec::new(), cwd: self.layout.work.clone(),
            redirection: Redirection::LogFile(self.layout.logs.join("preflight.json")), desktop: Some(self.desktop.name.clone()),
            appcontainer: Some(self.profile.sid()), job: Some(self.budget.job), child_process_policy: None,
            handle_list: true, environment: Some(minimal_environment(&self.layout.work, &std::env::var("SystemRoot")?)),
            timeout: Duration::from_secs(20), diagnose: false };
        match crate::preflight::run(spec, &cancel) {
            Ok(result) => self.network_preflight = Some(result),
            Err(error) => {
                self.status = TaskStatus { state: if cancel.load(std::sync::atomic::Ordering::SeqCst) { TaskState::Cancelled } else { TaskState::Failed },
                    exit_code: None, message: error.to_string() };
                return Ok(&self.status);
            }
        }
        self.run(Some(cancel))
    }

    /// Runs the task, honouring both the budget timeout and an optional
    /// cancellation flag that another thread may set at any time. Cancellation
    /// terminates the whole task job, so no task process survives.
    pub fn run(&mut self, cancel: Option<Arc<AtomicBool>>) -> Result<&TaskStatus> {
        if self.status.state != TaskState::Prepared { return Err("Task has already been run".into()); }
        let result = self.run_once(cancel);
        if let Err(error) = &result {
            self.status = TaskStatus { state: TaskState::Failed, exit_code: None, message: error.to_string() };
        }
        result?;
        Ok(&self.status)
    }

    fn run_once(&mut self, cancel: Option<Arc<AtomicBool>>) -> Result<()> {
        self.status = TaskStatus {
            state: TaskState::Running,
            exit_code: None,
            message: "running".into(),
        };
        let engine = self.engine.clone();
        let system_root = std::env::var("SystemRoot")?;
        let running = start_unless_cancelled(cancel.as_deref(), || crate::launch::start_verified(&LaunchSpec {
            executable: engine,
            args: self.kind.args(&self.layout.project, &self.layout.export_dir),
            cwd: self.layout.work.clone(),
            redirection: Redirection::LogFile(self.log.clone()),
            desktop: Some(self.desktop.name.clone()),
            appcontainer: Some(self.profile.sid()),
            job: Some(self.budget.job),
            child_process_policy: None,
            handle_list: true,
            environment: Some(minimal_environment(&self.layout.work, &system_root)),
            timeout: self.budget.timeout,
            diagnose: false,
        }))?;
        let Some(running) = running else {
            self.status = TaskStatus { state: TaskState::Cancelled, exit_code: None,
                message: "cancelled before process creation; no task process started".into() };
            return Ok(());
        };
        self.process_verification = running.verification.clone();
        let started = std::time::Instant::now();
        let mut enforcement = ResourceEnforcement::new(&self.budget.resource);
        let mut next_sample = started + self.budget.resource.sample_interval;
        let poll = Duration::from_millis(50).min(self.budget.resource.sample_interval);
        let outcome = loop {
            if let Some(exit) = running.wait(poll)? {
                break (TaskState::Succeeded, exit, "exit".to_string());
            }
            let now = std::time::Instant::now();
            if now >= next_sample {
                next_sample = now + self.budget.resource.sample_interval;
                enforcement.samples += 1;
                let work = directory_bytes(&self.layout.work, self.budget.resource.work_bytes)?;
                let log = fs::metadata(&self.log).map(|metadata| metadata.len()).unwrap_or(0);
                enforcement.max_observed_work_bytes = enforcement.max_observed_work_bytes.max(work);
                enforcement.max_observed_log_bytes = enforcement.max_observed_log_bytes.max(log);
                let breach = if work > self.budget.resource.work_bytes {
                    Some(format!(
                        "work directory bytes {work} exceed the sampled limit {}",
                        self.budget.resource.work_bytes
                    ))
                } else if log > self.budget.resource.log_bytes {
                    Some(format!(
                        "task log bytes {log} exceed the sampled limit {}",
                        self.budget.resource.log_bytes
                    ))
                } else {
                    None
                };
                if let Some(reason) = breach {
                    enforcement.enforced = true;
                    enforcement.reason = Some(reason.clone());
                    running.terminate(91)?;
                    let exit = running
                        .wait(Duration::from_secs(10))?
                        .ok_or("Resource-terminated task did not reach a terminal state")?;
                    break (TaskState::Failed, exit, reason);
                }
            }
            let cancelled = cancel
                .as_ref()
                .is_some_and(|flag| flag.load(std::sync::atomic::Ordering::SeqCst));
            if cancelled || started.elapsed() >= self.budget.timeout {
                running.terminate(if cancelled { 93 } else { 92 })?;
                let exit = running
                    .wait(Duration::from_secs(10))?
                    .ok_or("Cancelled task did not reach a terminal state")?;
                let reason = if cancelled {
                    "cancelled".to_string()
                } else {
                    format!("timeout after {}s", self.budget.timeout.as_secs())
                };
                break (TaskState::Cancelled, exit, reason);
            }
        };
        self.resource_enforcement = Some(enforcement);
        let (state, exit, reason) = outcome;
        let active = running.job().and_then(|job| job.active_processes());
        self.completed_job_active_processes = active;
        if state != TaskState::Succeeded && active != Some(0) {
            return Err(format!("Task job still holds {active:?} processes after termination").into());
        }
        self.status = TaskStatus {
            state: if state == TaskState::Succeeded && exit != 0 {
                TaskState::Failed
            } else {
                state
            },
            exit_code: Some(exit),
            message: format!("{reason} exit={} job_active_processes={active:?}", crate::hex(exit)),
        };
        Ok(())
    }

    /// Hashes every exported artifact. These files are untrusted model output;
    /// the caller must treat them as such.
    pub fn collect_artifacts(&self) -> Result<Vec<Artifact>> {
        if self.status.state != TaskState::Succeeded { return Err("Only successful tasks can hand off artifacts".into()); }
        let mut artifacts = Vec::new();
        let mut total = 0u64;
        if !self.layout.export_dir.is_dir() {
            return Ok(artifacts);
        }
        for entry in fs::read_dir(&self.layout.export_dir)? {
            let entry = entry?;
            if !ordinary(&entry.path())?.is_file() {
                return Err("Export artifact must be a regular file".into());
            }
            let path = entry.path();
            let bytes = entry.metadata()?.len();
            total = total.checked_add(bytes).ok_or("Artifact size overflow")?;
            if artifacts.len() >= 4096 || bytes > 256 * 1024 * 1024 || total > 512 * 1024 * 1024 {
                return Err("Artifact file count or byte limit exceeded".into());
            }
            artifacts.push(Artifact {
                name: entry.file_name().to_string_lossy().into_owned(),
                bytes,
                sha256: digest(&path)?,
            });
        }
        artifacts.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(artifacts)
    }

    /// Moves artifacts out of the task's writable directory into the
    /// parent-owned artifact directory, returning the verified hashes.
    pub fn hand_off_artifacts(&self) -> Result<Vec<Artifact>> {
        let artifacts = self.collect_artifacts()?;
        for artifact in &artifacts {
            let source = self.layout.export_dir.join(&artifact.name);
            let target = self.layout.artifacts.join(&artifact.name);
            fs::copy(&source, &target)?;
            let copied = digest(&target)?;
            if copied != artifact.sha256 {
                return Err(format!("Artifact {} changed during handoff", artifact.name).into());
            }
        }
        Ok(artifacts)
    }

    /// Removes the task's writable directory and deletes the profile. Logs and
    /// artifacts stay; they live outside the task's writable scope.
    pub fn finish(mut self) -> Result<i32> {
        let cleanup = self.profile.delete();
        let work_cleanup = fs::remove_dir_all(&self.layout.work);
        if cleanup < 0 { return Err(format!("Task profile cleanup failed: {cleanup:#x}").into()); }
        work_cleanup?;
        Ok(cleanup)
    }
}

/// Creates the cancellation flag a caller shares with another thread. Setting
/// it makes an in-flight [`Task::run`] terminate the task job and report
/// `Cancelled`.
pub fn cancel_flag() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

fn start_unless_cancelled<T>(cancel: Option<&AtomicBool>, start: impl FnOnce() -> Result<T>) -> Result<Option<T>> {
    if cancel.is_some_and(|flag| flag.load(std::sync::atomic::Ordering::SeqCst)) {
        return Ok(None);
    }
    start().map(Some)
}

#[cfg(test)]
mod cancellation_tests {
    use super::*;
    #[test]
    fn preexisting_cancellation_never_calls_process_creation() {
        let cancel = AtomicBool::new(true);
        let result = start_unless_cancelled::<()> (Some(&cancel), || panic!("process creation must not be reached"));
        assert!(matches!(result, Ok(None)));
    }
    #[test]
    fn uncancelled_launch_error_is_preserved() {
        let cancel = AtomicBool::new(false);
        let result = start_unless_cancelled::<()>(Some(&cancel), || Err("creation denied".into()));
        assert_eq!(result.unwrap_err().to_string(), "creation denied");
    }
}

/// Materialization bounds. These match the broker's snapshot limits so a
/// hostile project cannot exhaust the tasks volume before any job limit applies.
const MAX_SOURCE_FILES: usize = 4096;
const MAX_SOURCE_DIRS: usize = 8192;
const MAX_SOURCE_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_SOURCE_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

struct CopyBudget {
    files: usize,
    dirs: usize,
    total: u64,
    max_files: usize,
    max_dirs: usize,
    max_file_bytes: u64,
    max_total_bytes: u64,
}

impl CopyBudget {
    fn new() -> Self {
        Self {
            files: 0,
            dirs: 0,
            total: 0,
            max_files: MAX_SOURCE_FILES,
            max_dirs: MAX_SOURCE_DIRS,
            max_file_bytes: MAX_SOURCE_FILE_BYTES,
            max_total_bytes: MAX_SOURCE_TOTAL_BYTES,
        }
    }
}

fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
    copy_tree_bounded(source, destination, &mut CopyBudget::new())
}

fn copy_tree_bounded(source: &Path, destination: &Path, budget: &mut CopyBudget) -> Result<()> {
    if !ordinary(source)?.is_dir() { return Err("Project source is not a regular directory".into()); }
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = ordinary(&entry.path())?;
        if file_type.file_type().is_symlink() {
            // Model-authored projects must not smuggle reparse points into the
            // task directory; only regular files and directories are copied.
            return Err(format!(
                "Project source contains a reparse point: {}",
                entry.path().display()
            )
            .into());
        }
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            budget.dirs += 1;
            if budget.dirs > budget.max_dirs {
                return Err("Project source exceeds the materialization budget".into());
            }
            copy_tree_bounded(&entry.path(), &target, budget)?;
        } else if file_type.is_file() {
            budget.files += 1;
            budget.total = budget
                .total
                .checked_add(file_type.len())
                .ok_or("Project source size overflow")?;
            if budget.files > budget.max_files || file_type.len() > budget.max_file_bytes || budget.total > budget.max_total_bytes {
                return Err("Project source exceeds the materialization budget".into());
            }
            fs::copy(entry.path(), target)?;
        } else {
            return Err("Project source contains a non-regular file".into());
        }
    }
    Ok(())
}

/// Wall-clock milliseconds, recorded in task records for correlation.
pub fn now_unix_ms() -> Result<u128> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_cache_path_budget_counts_utf16_and_rejects_before_preparation() {
        let task_id = "im-fixedlength0000000000000000";
        let overhead = Path::new(r"D:\").join(task_id).join("work").join("Packages")
            .join(format!("craftmine.godot.task.{task_id}")).join("AC").join("Godot")
            .to_string_lossy().encode_utf16().count();
        let root = PathBuf::from(format!(r"D:\{}", "p".repeat(245 - overhead - 1)));
        assert!(validate_editor_cache_path(&root, task_id).is_ok());
        let too_long = PathBuf::from(format!("{}x", root.display()));
        assert!(validate_editor_cache_path(&too_long, task_id).unwrap_err().to_string().contains("GODOT_TASK_PATH_TOO_LONG"));
        let unicode = PathBuf::from(format!("{}\u{1f600}", root.display()));
        assert!(validate_editor_cache_path(&unicode, task_id).unwrap_err().to_string().contains("247 UTF-16"));

        // Even nonexistent roots/engine files must fail with the path reason:
        // no task directory, source copy, profile or engine may be created.
        let pins = EnginePins { editor: PinnedInput { source: PathBuf::from("missing.exe"),
            sha256: "0".repeat(64), file_name: "engine.exe".into() }, templates: vec![] };
        let error = Task::prepare(&too_long, task_id, TaskKind::Import, None, &pins, TaskBudget::default())
            .err().unwrap().to_string();
        assert!(error.starts_with("GODOT_TASK_PATH_TOO_LONG:"));
        assert!(!too_long.join(task_id).exists());
        let version_error = Task::prepare(&too_long, task_id, TaskKind::Version, None, &pins, TaskBudget::default())
            .err().unwrap().to_string();
        assert!(!version_error.contains("GODOT_TASK_PATH_TOO_LONG"), "version does not initialize an editor cache");
    }

    #[test]
    fn task_ids_are_restricted() {
        assert!(validate_task_id("build-0001_a.b").is_ok());
        assert!(validate_task_id("").is_err());
        assert!(validate_task_id("../escape").is_err());
        assert!(validate_task_id(r"a\b").is_err());
        assert!(validate_task_id("a/b").is_err());
        assert!(validate_task_id("a b").is_err());
        assert!(validate_task_id(".hidden").is_err());
        assert!(validate_task_id(&"a".repeat(97)).is_err());
    }

    #[test]
    fn task_kinds_have_fixed_argument_sets() {
        let project = Path::new(r"C:\task\work\project");
        let export = Path::new(r"C:\task\work\export");
        assert_eq!(
            TaskKind::Version.args(project, export),
            vec!["--headless", "--version"]
        );
        let args = TaskKind::ExportWeb.args(project, export);
        assert_eq!(args[3], "--export-release");
        assert_eq!(args[4], "Web");
        assert!(args[5].ends_with("index.html"));
        let windows = TaskKind::ExportWindows.args(project, export);
        assert_eq!(windows[4], "Windows Desktop");
        assert!(windows[5].ends_with("game.exe"));
        assert_eq!(windows.len(), 6);
        assert!(TaskKind::Import.args(project, export).contains(&"--import".to_string()));
    }

    #[test]
    fn pinned_input_mismatch_is_rejected() {
        let base = std::env::temp_dir().join(format!("craftmine-pin-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let source = base.join("engine.exe");
        fs::write(&source, b"not the real engine").unwrap();
        let input = PinnedInput {
            source: source.clone(),
            sha256: "00".repeat(32),
            file_name: "Godot_v4.7.2-stable_win64.exe".into(),
        };
        assert!(copy_pinned(&input, &base.join("copy.exe")).is_err());
        let good = PinnedInput {
            sha256: digest(&source).unwrap(),
            ..input
        };
        assert!(copy_pinned(&good, &base.join("copy.exe")).is_ok());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn directory_bytes_is_capped_and_ignores_missing_roots() {
        let base = std::env::temp_dir().join(format!(
            "cm-dirbytes-{}-{}",
            std::process::id(),
            now_unix_ms().unwrap()
        ));
        fs::create_dir_all(base.join("nested")).unwrap();
        fs::write(base.join("a.bin"), vec![0u8; 4096]).unwrap();
        fs::write(base.join("nested").join("b.bin"), vec![0u8; 8192]).unwrap();
        assert_eq!(directory_bytes(&base, u64::MAX).unwrap(), 12288);
        // A cap stops the walk early but never reports less than the cap.
        assert!(directory_bytes(&base, 4096).unwrap() > 4096);
        assert_eq!(directory_bytes(&base.join("missing"), 1024).unwrap(), 0);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn materialization_budget_rejects_an_oversized_source_tree() {
        let base = std::env::temp_dir().join(format!(
            "cm-copybudget-{}-{}",
            std::process::id(),
            now_unix_ms().unwrap()
        ));
        let source = base.join("source");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("one.bin"), vec![0u8; 2048]).unwrap();
        let mut tight = CopyBudget::new();
        tight.max_file_bytes = 1024;
        assert!(copy_tree_bounded(&source, &base.join("a"), &mut tight).is_err());
        let mut count = CopyBudget::new();
        count.max_files = 0;
        assert!(copy_tree_bounded(&source, &base.join("b"), &mut count).is_err());
        let mut total = CopyBudget::new();
        total.max_total_bytes = 1024;
        assert!(copy_tree_bounded(&source, &base.join("c"), &mut total).is_err());
        // Directory flooding is bounded too, not only file counts and bytes.
        let mut dirs = CopyBudget::new();
        dirs.max_dirs = 0;
        assert!(copy_tree_bounded(&source, &base.join("e"), &mut dirs).is_err());
        // The default budget accepts the same tree.
        assert!(copy_tree_bounded(&source, &base.join("d"), &mut CopyBudget::new()).is_ok());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn directory_bytes_counts_alternate_data_streams() {
        let base = std::env::temp_dir().join(format!(
            "cm-ads-{}-{}",
            std::process::id(),
            now_unix_ms().unwrap()
        ));
        fs::create_dir_all(&base).unwrap();
        let file = base.join("streams.bin");
        fs::write(&file, vec![0u8; 1024]).unwrap();
        let unnamed = fs::metadata(&file).unwrap().len();
        assert_eq!(file_total_bytes(&file, unnamed), unnamed);
        {
            use std::io::Write;
            let mut stream = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .open(format!("{}:hidden", file.display()))
                .unwrap();
            stream.write_all(&vec![7u8; 4096]).unwrap();
        }
        // A named stream must be charged to the budget, otherwise the task could
        // hide bytes outside `metadata.len()`.
        assert!(file_total_bytes(&file, unnamed) >= unnamed + 4096);
        assert!(directory_bytes(&base, u64::MAX).unwrap() >= unnamed + 4096);
        fs::remove_dir_all(&base).unwrap();
    }
}

#[cfg(test)]
mod audit_tests {
    use super::*;
    #[test]
    fn a_second_task_cannot_reuse_a_directory_or_overwrite_prior_files() {
        let root = std::env::temp_dir().join(format!("craftmine-task-audit-{}-{}", std::process::id(), now_unix_ms().unwrap()));
        fs::create_dir(&root).unwrap();
        let first = TaskLayout::create(&root, "task-one").unwrap();
        fs::write(first.project.join("stale.gd"), b"original").unwrap();
        assert!(TaskLayout::create(&root, "task-one").is_err());
        assert_eq!(fs::read(first.project.join("stale.gd")).unwrap(), b"original");
        let second = TaskLayout::create(&root, "task-two").unwrap();
        assert!(fs::read_dir(&second.project).unwrap().next().is_none());
        fs::remove_dir_all(&root).unwrap();
    }
    #[test]
    fn task_names_reject_windows_device_aliases() {
        for name in ["CON", "nul.txt", "COM1", "lpt9.log"] { assert!(validate_task_id(name).is_err()); }
        assert!(validate_task_id("godot-build-1").is_ok());
    }
}
