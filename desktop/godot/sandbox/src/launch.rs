//! Process creation with a creation-time Windows execution boundary.
//!
//! Every restricted process in the product goes through [`start`]. The spec
//! carries only fixed, validated values; there is no "run this command" API.
use crate::{wide, win, Handle, Result};
use std::ffi::c_void;
use std::fs;
use std::io;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::Arc;
use std::time::Duration;
use windows_sys::Win32::{
    Foundation::*,
    Security::{GetTokenInformation, PSID, SECURITY_CAPABILITIES, TOKEN_QUERY, TokenIsAppContainer},
    System::{JobObjects::*, Threading::*},
};

/// Resource and child-process budget applied at creation time.
#[derive(Clone, Copy, Debug)]
pub struct JobPolicy {
    /// Maximum processes in the task job. One active process means the task
    /// cannot create children: measured as `ERROR_NOT_ENOUGH_QUOTA` (1816).
    pub active_process_limit: u32,
    /// Process memory budget. The Godot editor needs well over 512 MiB to
    /// import and export; a smaller value aborts it with `alloc_static`
    /// failures rather than a clean error, so callers must budget honestly.
    pub process_memory_bytes: usize,
}

impl Default for JobPolicy {
    fn default() -> Self {
        Self {
            active_process_limit: 1,
            process_memory_bytes: 4usize * 1024 * 1024 * 1024,
        }
    }
}

/// Where the child's standard streams go.
#[derive(Clone, Debug)]
pub enum Redirection {
    /// stdout+stderr to this log file, stdin from NUL; only these handles are
    /// inherited and no other handle is reachable by the child.
    LogFile(PathBuf),
    /// No standard handles at all (diagnostic variant only).
    None,
}

/// A fully described, validated restricted launch.
pub struct LaunchSpec {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub redirection: Redirection,
    /// `lpDesktop`; `None` leaves the token's default desktop in place.
    pub desktop: Option<Vec<u16>>,
    /// AppContainer SID, or `None` for a normal-token diagnostic launch.
    pub appcontainer: Option<PSID>,
    pub job: Option<JobPolicy>,
    /// `PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY` value, or `None` to omit it.
    ///
    /// **Must stay `None` on this platform.** Measured evidence in
    /// `evidence/child-policy-matrix.log`: whenever this attribute is present the
    /// child dies in loader initialization with `0xC0000142`, for every
    /// executable tested (native probe and `cmd.exe`), with or without
    /// AppContainer, job, desktop, handle list or minimal environment. Child
    /// containment is enforced by the job's active-process limit instead.
    /// Only the diagnostic binary ever sets this.
    pub child_process_policy: Option<u32>,
    pub handle_list: bool,
    /// `None` inherits the helper's environment.
    pub environment: Option<Vec<(String, String)>>,
    pub timeout: Duration,
    pub diagnose: bool,
}

/// Job handle that can be terminated from any thread (cancellation).
pub struct TaskJob {
    handle: HANDLE,
    policy: JobPolicy,
}
// The job handle is used with thread-safe job APIs only (terminate, query).
unsafe impl Send for TaskJob {}
unsafe impl Sync for TaskJob {}

impl Drop for TaskJob {
    fn drop(&mut self) {
        unsafe {
            // Kill-on-close: no task process survives its job.
            if !self.handle.is_null() {
                CloseHandle(self.handle);
            }
        }
    }
}

impl TaskJob {
    pub fn terminate(&self, exit_code: u32) -> Result<()> {
        unsafe {
            win(
                TerminateJobObject(self.handle, exit_code),
                "TerminateJobObject",
            )
        }
    }

    pub fn active_processes(&self) -> Option<u32> {
        unsafe {
            let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = std::mem::zeroed();
            if QueryInformationJobObject(
                self.handle,
                JobObjectBasicAccountingInformation,
                (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                std::mem::size_of_val(&accounting) as u32,
                null_mut(),
            ) != 0
            {
                Some(accounting.ActiveProcesses)
            } else {
                None
            }
        }
    }

    pub fn policy(&self) -> JobPolicy {
        self.policy
    }

    /// A signalled process handle does not prove the Job accounting has already
    /// observed zero active processes. Poll this exact owned Job after process
    /// exit. Only a measured zero qualifies; timeout returns the last nonzero
    /// measurement and a query failure remains unknown.
    pub fn completed_active_processes(&self, timeout: Duration) -> Option<u32> {
        let started = std::time::Instant::now();
        poll_completed_accounting(
            || self.active_processes(),
            || started.elapsed() >= timeout,
            || std::thread::sleep(Duration::from_millis(10)),
        )
    }
}

fn poll_completed_accounting(
    mut read: impl FnMut() -> Option<u32>,
    mut expired: impl FnMut() -> bool,
    mut yield_once: impl FnMut(),
) -> Option<u32> {
    loop {
        let measured = read();
        if measured == Some(0) || measured.is_none() || expired() { return measured; }
        yield_once();
    }
}

#[cfg(test)]
mod completion_accounting_tests {
    use super::poll_completed_accounting;
    use std::cell::Cell;
    #[test]
    fn completion_requires_a_real_zero_after_lagging_accounting() {
        let mut samples = [Some(1), Some(1), Some(0)].into_iter();
        let yields = Cell::new(0);
        assert_eq!(poll_completed_accounting(|| samples.next().unwrap(), || false,
            || yields.set(yields.get()+1)), Some(0));
        assert_eq!(yields.get(), 2);
    }
    #[test]
    fn deadline_never_turns_live_or_unknown_measurement_into_zero() {
        assert_eq!(poll_completed_accounting(|| Some(1), || true, || panic!("deadline")), Some(1));
        assert_eq!(poll_completed_accounting(|| None, || false, || panic!("unknown")), None);
        assert_eq!(poll_completed_accounting(|| Some(0), || true, || panic!("already empty")), Some(0));
    }
}

/// A restricted process that is already running.
pub struct RunningProcess {
    process: Handle,
    job: Option<Arc<TaskJob>>,
    pub pid: u32,
    pub appcontainer: bool,
    pub log: Option<PathBuf>,
    pub verification: Option<crate::verification::ProcessVerification>,
}

impl RunningProcess {
    pub fn job(&self) -> Option<Arc<TaskJob>> {
        self.job.clone()
    }

    /// Terminates the whole task job (or the single process without a job).
    pub fn terminate(&self, exit_code: u32) -> Result<()> {
        match &self.job {
            Some(job) => job.terminate(exit_code),
            None => unsafe { win(TerminateProcess(self.process.0, exit_code), "TerminateProcess") },
        }
    }

    /// Waits up to `timeout`; returns `None` when the budget was exceeded.
    pub fn wait(&self, timeout: Duration) -> Result<Option<u32>> {
        let milliseconds = timeout.as_millis().min(u32::MAX as u128) as u32;
        unsafe {
            match WaitForSingleObject(self.process.0, milliseconds) {
                WAIT_OBJECT_0 => {},
                WAIT_TIMEOUT => return Ok(None),
                WAIT_FAILED => return Err(io_error("WaitForSingleObject", io::Error::last_os_error())),
                value => return Err(format!("Unexpected process wait result {value:#x}").into()),
            }
            let mut exit = 0;
            win(
                GetExitCodeProcess(self.process.0, &mut exit),
                "GetExitCodeProcess",
            )?;
            Ok(Some(exit))
        }
    }

    pub fn is_running(&self) -> bool {
        unsafe { WaitForSingleObject(self.process.0, 0) != WAIT_OBJECT_0 }
    }
}

struct Attributes {
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
    _storage: Vec<usize>,
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.pointer);
        }
    }
}

fn quote(value: &str) -> Result<String> {
    if value.contains('"') {
        return Err("Unsupported fixed argument containing a quote".into());
    }
    Ok(format!("\"{value}\""))
}

fn environment_block(environment: &Option<Vec<(String, String)>>) -> Result<Vec<u16>> {
    let Some(pairs) = environment else {
        return Ok(Vec::new());
    };
    let mut block = Vec::<u16>::new();
    for (name, value) in pairs {
        if name.contains('=') || value.contains('\0') {
            return Err("Invalid environment entry".into());
        }
        block.extend(wide(format!("{name}={value}")));
    }
    block.push(0);
    Ok(block)
}

/// Creates the restricted process. Returns as soon as the process exists.
pub fn start(spec: &LaunchSpec) -> Result<RunningProcess> {
    start_policy(spec, false, false, false)
}

/// Fixed production candidate: inspect the actual process while suspended and
/// resume only after every required host-side policy check passes.
pub fn start_verified(spec: &LaunchSpec) -> Result<RunningProcess> {
    if spec.job.is_none_or(|job| job.process_memory_bytes != crate::verification::MEMORY_BYTES)
        || spec.child_process_policy.is_some() || spec.environment.is_none() || spec.diagnose {
        return Err("Verified launch requires the fixed policy recipe".into());
    }
    start_policy(spec, true, true, true)
}

// LPAC is a fixed diagnostic variant, not a product policy selection API.
fn start_policy(spec: &LaunchSpec, lpac: bool, registry_read: bool, verify_before_resume: bool) -> Result<RunningProcess> {
    if lpac && (spec.appcontainer.is_none() || spec.job.is_none()
        || spec.job.is_some_and(|job| job.active_process_limit != 1)
        || spec.desktop.is_none() || !spec.handle_list) {
        return Err("LPAC diagnostic requires the full task boundary".into());
    }
    let job = match &spec.job {
        Some(policy) => {
            let handle = unsafe { CreateJobObjectW(null(), null()) };
            if handle.is_null() {
                return Err("CreateJobObjectW failed".into());
            }
            let job = Arc::new(TaskJob {
                handle,
                policy: *policy,
            });
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
                | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            limits.BasicLimitInformation.ActiveProcessLimit = policy.active_process_limit;
            limits.ProcessMemoryLimit = policy.process_memory_bytes;
            unsafe {
                win(
                    SetInformationJobObject(
                        job.handle,
                        JobObjectExtendedLimitInformation,
                        (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                        std::mem::size_of_val(&limits) as u32,
                    ),
                    "SetInformationJobObject",
                )?;
            }
            Some(job)
        }
        None => None,
    };

    let (stdout, stdin) = match &spec.redirection {
        Redirection::LogFile(path) => {
            let output = fs::File::create(path)?;
            let input = fs::File::open("NUL")?;
            for handle in [output.as_raw_handle(), input.as_raw_handle()] {
                unsafe {
                    win(
                        SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT),
                        "SetHandleInformation",
                    )?;
                }
            }
            (Some(output), Some(input))
        }
        Redirection::None => (None, None),
    };
    let handles: Vec<HANDLE> = match (&stdout, &stdin) {
        (Some(output), Some(input)) => vec![output.as_raw_handle(), input.as_raw_handle()],
        _ => Vec::new(),
    };

    unsafe {
        let mut attribute_count = 0u32;
        if lpac { attribute_count += 1; }
        if spec.appcontainer.is_some() {
            attribute_count += 1;
        }
        let child_policy = spec.child_process_policy;
        if child_policy.is_some() {
            attribute_count += 1;
        }
        if job.is_some() {
            attribute_count += 1;
        }
        if spec.handle_list && !handles.is_empty() {
            attribute_count += 1;
        }

        let mut bytes = 0usize;
        InitializeProcThreadAttributeList(null_mut(), attribute_count, 0, &mut bytes);
        if bytes == 0 {
            return Err("InitializeProcThreadAttributeList sizing failed".into());
        }
        let mut storage = vec![
            0usize;
            (bytes + std::mem::size_of::<usize>() - 1)
                / std::mem::size_of::<usize>()
        ];
        let pointer = storage.as_mut_ptr().cast();
        win(
            InitializeProcThreadAttributeList(pointer, attribute_count, 0, &mut bytes),
            "InitializeProcThreadAttributeList",
        )?;
        let attributes = Attributes {
            pointer,
            _storage: storage,
        };

        let registry_capability = if registry_read { Some(RegistryReadCapability::derive()?) } else { None };
        let mut capability_entry = windows_sys::Win32::Security::SID_AND_ATTRIBUTES {
            Sid: registry_capability.as_ref().map(|capability| capability.0).unwrap_or(null_mut()),
            Attributes: 4, // SE_GROUP_ENABLED from winnt.h
        };
        let capabilities = SECURITY_CAPABILITIES {
            AppContainerSid: spec.appcontainer.unwrap_or(null_mut()),
            Capabilities: if registry_read { &mut capability_entry } else { null_mut() },
            CapabilityCount: if registry_read { 1 } else { 0 },
            Reserved: 0,
        };
        let mut updates: Vec<(usize, *const c_void, usize)> = Vec::new();
        // PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT: remove implicit
        // ALL APPLICATION PACKAGES resource access; grants no network capability.
        let opt_out = 1u32;
        if lpac {
            updates.push((PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY as usize,
                (&opt_out as *const u32).cast(), std::mem::size_of_val(&opt_out)));
        }
        if spec.appcontainer.is_some() {
            updates.push((
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                (&capabilities as *const SECURITY_CAPABILITIES).cast(),
                std::mem::size_of_val(&capabilities),
            ));
        }
        if let Some(policy) = &child_policy {
            updates.push((
                PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY as usize,
                (policy as *const u32).cast(),
                std::mem::size_of_val(policy),
            ));
        }
        if let Some(job) = &job {
            updates.push((
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                (&job.handle as *const HANDLE).cast(),
                std::mem::size_of::<HANDLE>(),
            ));
        }
        if spec.handle_list && !handles.is_empty() {
            updates.push((
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                handles.as_ptr().cast(),
                std::mem::size_of_val(handles.as_slice()),
            ));
        }
        for (attribute, value, size) in updates {
            win(
                UpdateProcThreadAttribute(
                    attributes.pointer,
                    0,
                    attribute,
                    value,
                    size,
                    null_mut(),
                    null(),
                ),
                "UpdateProcThreadAttribute",
            )?;
        }

        let mut startup: STARTUPINFOEXW = std::mem::zeroed();
        startup.StartupInfo.cb = std::mem::size_of_val(&startup) as u32;
        startup.lpAttributeList = attributes.pointer;
        if let Some(desktop) = &spec.desktop {
            startup.StartupInfo.lpDesktop = desktop.as_ptr().cast_mut();
        }
        if let (Some(output), Some(input)) = (&stdout, &stdin) {
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = input.as_raw_handle();
            startup.StartupInfo.hStdOutput = output.as_raw_handle();
            startup.StartupInfo.hStdError = output.as_raw_handle();
        }

        let mut command = quote(&spec.executable.to_string_lossy())?;
        for arg in &spec.args {
            command.push(' ');
            command.push_str(&quote(arg)?);
        }
        let application = wide(&spec.executable);
        let mut command = wide(command);
        let cwd = wide(&spec.cwd);
        let mut environment = environment_block(&spec.environment)?;
        let environment_pointer = if environment.is_empty() {
            null()
        } else {
            environment.as_mut_ptr().cast()
        };
        let mut information: PROCESS_INFORMATION = std::mem::zeroed();
        win(
            CreateProcessW(
                application.as_ptr(),
                command.as_mut_ptr(),
                null(),
                null(),
                if spec.handle_list && !handles.is_empty() {
                    1
                } else {
                    0
                },
                EXTENDED_STARTUPINFO_PRESENT
                    | CREATE_NO_WINDOW
                    | CREATE_UNICODE_ENVIRONMENT
                    | if verify_before_resume { CREATE_SUSPENDED } else { 0 }
                    | if spec.diagnose { DEBUG_ONLY_THIS_PROCESS } else { 0 },
                environment_pointer,
                cwd.as_ptr(),
                &startup.StartupInfo,
                &mut information,
            ),
            "CreateProcessW restricted task",
        )?;
        let process = Handle(information.hProcess);
        let thread = Handle(information.hThread);

        let mut appcontainer = false;
        if spec.appcontainer.is_some() {
            let mut token = null_mut();
            win(
                OpenProcessToken(process.0, TOKEN_QUERY, &mut token),
                "OpenProcessToken",
            )?;
            let token = Handle(token);
            let mut is_container = 0u32;
            let mut length = 0;
            win(
                GetTokenInformation(
                    token.0,
                    TokenIsAppContainer,
                    (&mut is_container as *mut u32).cast(),
                    4,
                    &mut length,
                ),
                "TokenIsAppContainer",
            )?;
            if is_container != 1 {
                if let Some(job) = &job {
                    let _ = job.terminate(91);
                } else {
                    TerminateProcess(process.0, 91);
                }
                return Err("Child token is not AppContainer".into());
            }
            appcontainer = true;
        }

        let verification = if verify_before_resume {
            let mut result = crate::verification::verify(process.0, job.as_ref().ok_or("Missing verified Job")?.handle,
                spec.appcontainer.ok_or("Missing verified package SID")?, registry_capability.as_ref().ok_or("Missing registry capability")?.0,
                &spec.executable, information.dwProcessId)?;
            // Persist immutable pre-resume identity for crash/termination
            // diagnosis. resumePreviousCount remains 0 in this file; only the
            // private final response can assert that ResumeThread returned 1.
            if let Redirection::LogFile(log) = &spec.redirection {
                let name = if log.file_name().and_then(|name| name.to_str()) == Some("task.log") {
                    "process-verification.json"
                } else { "native-verification.json" };
                use std::io::Write;
                let mut receipt = fs::OpenOptions::new().write(true).create_new(true).open(log.with_file_name(name))?;
                receipt.write_all(&serde_json::to_vec(&result)?)?;
                receipt.sync_all()?;
            }
            let previous = ResumeThread(thread.0);
            if previous != 1 {
                let _ = job.as_ref().unwrap().terminate(91);
                return Err(format!("Unexpected initial ResumeThread count {previous}").into());
            }
            result.resume_previous_count = previous;
            Some(result)
        } else { None };
        if spec.diagnose {
            let output = match &spec.redirection {
                Redirection::LogFile(path) => path.parent().ok_or("Missing diagnostic logs parent")?,
                Redirection::None => return Err("Native fault diagnosis requires owned logs".into()),
            };
            crate::loader::trace_fault(process.0, information.dwProcessId, output)?;
        }

        Ok(RunningProcess {
            process,
            job,
            pid: information.dwProcessId,
            appcontainer,
            verification,
            log: match &spec.redirection {
                Redirection::LogFile(path) => Some(path.clone()),
                Redirection::None => None,
            },
        })
    }
}

pub struct Outcome {
    pub pid: u32,
    pub exit_code: u32,
    pub timed_out: bool,
    pub appcontainer: bool,
    /// Active processes left in the task job when the launch returned. Must be
    /// zero after a cancel or timeout: no task process may survive.
    pub job_active_processes: Option<u32>,
}

/// Convenience wrapper: start, wait for the spec timeout, then terminate.
pub fn launch(spec: &LaunchSpec) -> Result<Outcome> {
    launch_policy(spec, false, false)
}

/// Fixed acceptance experiments only. Never used by the product Task API.
pub fn launch_lpac_diagnostic(spec: &LaunchSpec) -> Result<Outcome> {
    launch_policy(spec, true, false)
}

/// Final bounded LPAC candidate: registryRead only, no network capabilities.
/// This never changes the product Task policy.
pub fn launch_lpac_registry_diagnostic(spec: &LaunchSpec) -> Result<Outcome> {
    launch_policy(spec, true, true)
}

fn launch_policy(spec: &LaunchSpec, lpac: bool, registry_read: bool) -> Result<Outcome> {
    let running = start_policy(spec, lpac, registry_read, false)?;
    let exit = match running.wait(spec.timeout)? {
        Some(exit) => exit,
        None => {
            running.terminate(92)?;
            let exit = match running.wait(Duration::from_secs(5))? {
                Some(exit) => exit,
                None => return Err("Cancelled task did not reach a terminal state".into()),
            };
            return Ok(Outcome {
                pid: running.pid,
                exit_code: exit,
                timed_out: true,
                appcontainer: running.appcontainer,
                job_active_processes: running.job().and_then(|job| job.active_processes()),
            });
        }
    };
    Ok(Outcome {
        pid: running.pid,
        exit_code: exit,
        timed_out: false,
        appcontainer: running.appcontainer,
        job_active_processes: running.job().and_then(|job| job.active_processes()),
    })
}

struct RegistryReadCapability(PSID);
impl RegistryReadCapability {
    unsafe fn derive() -> Result<Self> {
        use windows_sys::Win32::Security::DeriveCapabilitySidsFromName;
        let mut groups: *mut PSID = null_mut(); let mut group_count = 0;
        let mut capabilities: *mut PSID = null_mut(); let mut capability_count = 0;
        win(DeriveCapabilitySidsFromName(wide("registryRead").as_ptr(), &mut groups, &mut group_count,
            &mut capabilities, &mut capability_count), "Derive registryRead capability")?;
        for index in 0..group_count { LocalFree(*groups.add(index as usize)); }
        LocalFree(groups.cast());
        if capability_count != 1 {
            for index in 0..capability_count { LocalFree(*capabilities.add(index as usize)); }
            LocalFree(capabilities.cast());
            return Err("Expected exactly one registryRead capability SID".into());
        }
        let sid = *capabilities;
        LocalFree(capabilities.cast());
        Ok(Self(sid))
    }
}
impl Drop for RegistryReadCapability {
    fn drop(&mut self) { unsafe { LocalFree(self.0); } }
}

/// Builds the minimal environment an isolated task is allowed to see.
pub fn minimal_environment(work: &Path, system_root: &str) -> Vec<(String, String)> {
    let work = work.to_string_lossy().into_owned();
    vec![
        ("APPDATA".into(), work.clone()),
        ("LOCALAPPDATA".into(), work.clone()),
        ("PATH".into(), format!("{system_root}\\System32")),
        ("SystemRoot".into(), system_root.to_string()),
        ("TEMP".into(), work.clone()),
        ("TMP".into(), work.clone()),
        ("USERPROFILE".into(), work.clone()),
        ("WINDIR".into(), system_root.to_string()),
    ]
}

/// Validates that a path stays inside an allowed root (no reparse escape).
pub fn inside(root: &Path, candidate: &Path) -> bool {
    let root = match root.canonicalize() {
        Ok(value) => value,
        Err(_) => return false,
    };
    let candidate = match candidate.canonicalize() {
        Ok(value) => value,
        Err(_) => return false,
    };
    candidate.starts_with(&root)
}

pub fn io_error(context: &str, error: io::Error) -> Box<dyn std::error::Error> {
    format!("{context}: {error}").into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_fixed_arguments_and_rejects_embedded_quotes() {
        assert_eq!(quote(r"C:\Program Files\godot.exe").unwrap(), "\"C:\\Program Files\\godot.exe\"");
        assert!(quote("a\"b").is_err());
    }

    #[test]
    fn minimal_environment_has_no_user_secrets_and_redirects_appdata() {
        let pairs = minimal_environment(Path::new(r"C:\task\work"), r"C:\Windows");
        let names = pairs.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>();
        assert!(names.contains(&"APPDATA"));
        assert!(!names.contains(&"USERNAME"));
        assert!(!names.contains(&"HOMEPATH"));
        for (name, value) in pairs {
            if name == "SystemRoot" || name == "WINDIR" {
                continue;
            }
            assert!(!value.is_empty());
        }
    }

    #[test]
    fn environment_block_rejects_separator_injection() {
        let block = environment_block(&Some(vec![("A=B".into(), "c".into())]));
        assert!(block.is_err());
        let block = environment_block(&Some(vec![("A".into(), "c".into())])).unwrap();
        assert_eq!(block.last(), Some(&0));
    }

    #[test]
    fn inside_rejects_paths_outside_the_root() {
        let base = std::env::temp_dir().join(format!("craftmine-inside-{}", std::process::id()));
        let child = base.join("child");
        fs::create_dir_all(&child).unwrap();
        assert!(inside(&base, &child));
        assert!(!inside(&child, &base));
        fs::remove_dir_all(&base).ok();
    }
}
