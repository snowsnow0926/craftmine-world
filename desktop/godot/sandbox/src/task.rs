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
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct TaskBudget {
    pub timeout: Duration,
    pub job: JobPolicy,
}

impl Default for TaskBudget {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(600),
            job: JobPolicy::default(),
        }
    }
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

/// One managed build task.
pub struct Task {
    pub task_id: String,
    pub kind: TaskKind,
    pub layout: TaskLayout,
    pub budget: TaskBudget,
    profile: AppContainerProfile,
    desktop: PrivateDesktop,
    sid: String,
    status: TaskStatus,
    log: PathBuf,
    engine: PathBuf,
    process_verification: Option<crate::verification::ProcessVerification>,
    network_preflight: Option<crate::preflight::NetworkPreflight>,
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
        let layout = TaskLayout::create(tasks_root, task_id)?;
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
        let profile = AppContainerProfile::create(
            &format!("craftmine.godot.task.{task_id}"),
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
        Ok(Self {
            process_verification: None,
            network_preflight: None,
            engine,
            task_id: task_id.to_string(),
            kind,
            layout,
            budget,
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
        let outcome = loop {
            if let Some(exit) = running.wait(Duration::from_millis(200))? {
                break (TaskState::Succeeded, exit, "exit".to_string());
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
        let (state, exit, reason) = outcome;
        let active = running.job().and_then(|job| job.active_processes());
        if state == TaskState::Cancelled && active != Some(0) {
            return Err(format!("Task job still holds {active:?} processes after cancellation").into());
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

fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
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
            copy_tree(&entry.path(), &target)?;
        } else if file_type.is_file() {
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
