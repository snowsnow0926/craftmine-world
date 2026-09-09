//! Bounded differential diagnostics for the Windows execution boundary.
//!
//! Each variant changes exactly one launch condition and records the child's
//! exit status, whether the child reached `main` (marker file) and, when it did,
//! the child's own identity report. No real input is ever synthesized.
use craftmine_godot_sandbox_probe::{
    acl::{grant_new_directory, inspect_new_work_label},
    desktop::{PrivateDesktop, StationChoice},
    launch::{launch, minimal_environment, JobPolicy, LaunchSpec, Redirection},
    profile::AppContainerProfile,
};
use std::{env, fs, path::PathBuf, time::Duration};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Child {
    ProbeMarker,
    Cmd,
}

#[derive(Clone)]
struct Variant {
    name: &'static str,
    appcontainer: bool,
    station: StationChoice,
    use_desktop: bool,
    job: Option<JobPolicy>,
    child_process_policy: Option<u32>,
    handle_list: bool,
    minimal_env: bool,
    diagnose: bool,
    extra_desktop_sids: &'static [&'static str],
    child: Child,
}

/// Focused second pass. The first pass (evidence/matrix.log) showed that
/// AppContainer, station/desktop, job limits, handle list and environment are
/// all irrelevant to `0xC0000142`, and that the only differing variable is the
/// child-process policy attribute. This pass isolates that attribute alone.
fn variants() -> Vec<Variant> {
    let base = Variant {
        name: "baseline",
        appcontainer: true,
        station: StationChoice::SessionDefault,
        use_desktop: true,
        job: Some(JobPolicy::default()),
        child_process_policy: None,
        handle_list: true,
        minimal_env: true,
        diagnose: false,
        extra_desktop_sids: &[],
        child: Child::ProbeMarker,
    };
    let with = |name: &'static str, f: fn(&mut Variant)| {
        let mut variant = base.clone();
        variant.name = name;
        f(&mut variant);
        variant
    };
    vec![
        base.clone(),
        with("no-job", |v| v.job = None),
        with("child-policy-1-with-job", |v| v.child_process_policy = Some(1)),
        with("child-policy-1-no-job", |v| {
            v.job = None;
            v.child_process_policy = Some(1);
        }),
        with("child-policy-1-normal-token", |v| {
            v.appcontainer = false;
            v.job = None;
            v.child_process_policy = Some(1);
        }),
        with("child-policy-1-normal-token-job", |v| {
            v.appcontainer = false;
            v.child_process_policy = Some(1);
        }),
        with("child-policy-2-with-job", |v| v.child_process_policy = Some(2)),
        with("child-policy-1-cmd", |v| {
            v.child = Child::Cmd;
            v.child_process_policy = Some(1);
        }),
    ]
}

fn probe_binary() -> Result<PathBuf> {
    let path = env::current_exe()?.with_file_name("boundary-probe.exe");
    if !path.is_file() {
        return Err(format!("missing child binary {}", path.display()).into());
    }
    Ok(path)
}

/// Confirms a PID no longer exists; only used by the cancellation diagnostic.
fn process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut exit = 0;
        let queried = GetExitCodeProcess(handle, &mut exit) != 0;
        let waited = WaitForSingleObject(handle, 0) == WAIT_OBJECT_0;
        CloseHandle(handle);
        !(waited && queried && exit != STILL_ACTIVE as u32)
    }
}

fn run_variant(variant: &Variant, out_root: &PathBuf) -> Result<String> {
    let root = out_root.join(variant.name);
    fs::create_dir_all(&root)?;
    let bin = root.join("bin");
    let work = root.join("work");
    for path in [&bin, &work] {
        fs::create_dir_all(path)?;
    }
    let child = bin.join("boundary-probe.exe");
    fs::copy(probe_binary()?, &child)?;
    let marker = work.join("child-marker.txt");
    let _ = fs::remove_file(&marker);

    let mut profile = if variant.appcontainer {
        Some(AppContainerProfile::create(
            &format!("craftmine.gd1.diag.{}.{}", variant.name, std::process::id()),
            "Craftmine boundary diagnostic",
        )?)
    } else {
        None
    };
    let task_sid = unsafe {
        match &profile {
            Some(profile) => craftmine_godot_sandbox_probe::report::sid_to_string(profile.sid())?,
            None => craftmine_godot_sandbox_probe::report::current_user_sid_string()?,
        }
    };
    let desktop = if variant.use_desktop || variant.station != StationChoice::SessionDefault {
        Some(unsafe {
            PrivateDesktop::create(
                &format!("{}-{}", variant.name, std::process::id()),
                &task_sid,
                variant.station,
                variant.extra_desktop_sids,
            )?
        })
    } else {
        None
    };
    if let Some(profile) = &profile {
        unsafe {
            grant_new_directory(&bin, profile.sid(), FILE_GENERIC_READ | FILE_GENERIC_EXECUTE)?;
            grant_new_directory(
                &work,
                profile.sid(),
                FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE,
            )?;
            let level = inspect_new_work_label(&work)?;
            println!("  work_integrity_rid={level}");
        }
    }
    let system_root = env::var("SystemRoot")?;
    let environment = if variant.minimal_env {
        Some(minimal_environment(&work, &system_root))
    } else {
        None
    };
    let log = root.join("child.log");
    let (executable, args, redirection) = match variant.child {
        Child::ProbeMarker => (
            child.clone(),
            vec![
                "--child-marker".to_string(),
                marker.to_string_lossy().into_owned(),
            ],
            Redirection::LogFile(log.clone()),
        ),
        Child::Cmd => (
            PathBuf::from(format!("{system_root}\\System32\\cmd.exe")),
            vec!["/c".into(), "exit".into(), "7".into()],
            Redirection::LogFile(log.clone()),
        ),
    };
    let spec = LaunchSpec {
        executable,
        args,
        cwd: work.clone(),
        redirection,
        desktop: desktop
            .as_ref()
            .filter(|_| variant.use_desktop)
            .map(|desktop| desktop.name.clone()),
        appcontainer: profile.as_ref().map(|profile| profile.sid()),
        job: variant.job,
        child_process_policy: variant.child_process_policy,
        handle_list: variant.handle_list,
        environment,
        timeout: Duration::from_secs(15),
        diagnose: variant.diagnose,
    };
    let outcome = launch(&spec)?;
    let reached_main = marker.is_file();
    let log_bytes = fs::metadata(&log).map(|meta| meta.len()).unwrap_or(0);
    let mut summary = format!(
        "variant={} appcontainer={} desktop={:?} exit={} reached_main={} log_bytes={}",
        variant.name,
        variant.appcontainer,
        spec.desktop.is_some(),
        craftmine_godot_sandbox_probe::hex(outcome.exit_code),
        reached_main,
        log_bytes
    );
    if reached_main && variant.appcontainer {
        let report = work.join("child-report.txt");
        let report_spec = LaunchSpec {
            executable: child,
            args: vec![
                "--child-report".into(),
                report.to_string_lossy().into_owned(),
            ],
            cwd: work.clone(),
            redirection: Redirection::LogFile(root.join("child-report.log")),
            desktop: spec.desktop.clone(),
            appcontainer: spec.appcontainer,
            job: variant.job,
            child_process_policy: None,
            handle_list: true,
            environment: spec.environment.clone(),
            timeout: Duration::from_secs(15),
            diagnose: false,
        };
        match launch(&report_spec) {
            Ok(outcome) => {
                summary.push_str(&format!(" child_report_exit={}", outcome.exit_code));
                if let Ok(text) = fs::read_to_string(&report) {
                    for line in text.lines() {
                        summary.push_str(&format!("\n    {line}"));
                    }
                }
            }
            Err(error) => summary.push_str(&format!(" child_report_error={error}")),
        }
    }
    drop(desktop);
    if let Some(profile) = &mut profile {
        let cleanup = profile.delete();
        summary.push_str(&format!(
            " profile_cleanup_hresult={}",
            craftmine_godot_sandbox_probe::hex(cleanup as u32)
        ));
    }
    Ok(summary)
}

fn main() -> Result<()> {
    let args = env::args().collect::<Vec<_>>();
    let out_root = PathBuf::from(
        args.get(2)
            .cloned()
            .unwrap_or_else(|| "out/diagnostics".to_string()),
    );
    match args.get(1).map(String::as_str) {
        Some("parent") => {
            craftmine_godot_sandbox_probe::report::write_parent_report(&out_root)?;
            println!("parent_report={}", out_root.display());
        }
        Some("cancel") => {
            // A task that would run far beyond its budget must be terminated
            // with no surviving process and no job members left.
            fs::create_dir_all(&out_root)?;
            let root = out_root.join("cancel");
            let bin = root.join("bin");
            let work = root.join("work");
            for path in [&bin, &work] {
                fs::create_dir_all(path)?;
            }
            let child = bin.join("boundary-probe.exe");
            fs::copy(probe_binary()?, &child)?;
            let mut profile = AppContainerProfile::create(
                &format!("craftmine.gd1.cancel.{}", std::process::id()),
                "Craftmine cancellation diagnostic",
            )?;
            let sid = unsafe { craftmine_godot_sandbox_probe::report::sid_to_string(profile.sid())? };
            let desktop = unsafe {
                PrivateDesktop::create(
                    &format!("cancel-{}", std::process::id()),
                    &sid,
                    StationChoice::SessionDefault,
                    &[],
                )?
            };
            unsafe {
                grant_new_directory(&bin, profile.sid(), FILE_GENERIC_READ | FILE_GENERIC_EXECUTE)?;
                grant_new_directory(
                    &work,
                    profile.sid(),
                    FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE,
                )?;
            }
            let system_root = env::var("SystemRoot")?;
            let outcome = launch(&LaunchSpec {
                executable: child,
                args: vec!["--sleep".into(), "60000".into()],
                cwd: work.clone(),
                redirection: Redirection::LogFile(root.join("child.log")),
                desktop: Some(desktop.name.clone()),
                appcontainer: Some(profile.sid()),
                job: Some(JobPolicy::default()),
                child_process_policy: None,
                handle_list: true,
                environment: Some(minimal_environment(&work, &system_root)),
                timeout: Duration::from_secs(3),
                diagnose: false,
            })?;
            let alive = process_alive(outcome.pid);
            let mut lines = vec![
                format!("cancel_pid={}", outcome.pid),
                format!("cancel_timed_out={}", outcome.timed_out),
                format!("cancel_exit={}", craftmine_godot_sandbox_probe::hex(outcome.exit_code)),
                format!(
                    "cancel_job_active_processes={:?}",
                    outcome.job_active_processes
                ),
                format!("cancel_pid_alive_after={alive}"),
            ];
            if !outcome.timed_out {
                return Err("Cancellation diagnostic did not reach its timeout".into());
            }
            if alive {
                return Err("Task process survived cancellation".into());
            }
            if outcome.job_active_processes != Some(0) {
                return Err("Task job still holds processes after cancellation".into());
            }
            lines.push("cancel_no_leftover_process=passed".into());
            drop(desktop);
            let cleanup = profile.delete();
            lines.push(format!(
                "profile_cleanup_hresult={}",
                craftmine_godot_sandbox_probe::hex(cleanup as u32)
            ));
            println!("{}", lines.join("\n"));
            fs::write(out_root.join("cancel.txt"), lines.join("\n") + "\n")?;
        }
        Some("task") => {
            // Exercises the product API (`task::Task`) end to end: pinned
            // inputs, three task kinds, artifact handoff, profile cleanup.
            use craftmine_godot_sandbox_probe::task::{
                EnginePins, PinnedInput, Task, TaskBudget, TaskKind, TaskState,
            };
            fs::create_dir_all(&out_root)?;
            let engine_root = PathBuf::from(r"D:\Craftmine World\desktop\build\godot\4.7.2-stable");
            let editor = engine_root.join("editor").join("Godot_v4.7.2-stable_win64.exe");
            let templates = [
                ("version.txt", "38885c88f75abbc797a1db7559719800279a00cfb9fa8b2e2868a7f6f84bad2e"),
                ("web_nothreads_debug.zip", "08962aefef811b603541d7951ac67ef00413aad2d978855183c28adee98f626a"),
                ("web_nothreads_release.zip", "d3ee2f08cef0cf3cf6678a6355a92a8db48ccdd35cbd2e8bfd5f0e8a0b4032a0"),
                ("web_release.zip", "02f0dca13ed3d8343fa68f8f88ac80295562408d71aa67157e8b96ddebaa67a3"),
            ]
            .into_iter()
            .map(|(name, sha256)| PinnedInput {
                source: engine_root.join("templates").join(name),
                sha256: sha256.to_string(),
                file_name: name.to_string(),
            })
            .collect();
            let pins = EnginePins {
                editor: PinnedInput {
                    source: editor,
                    sha256: "ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424"
                        .into(),
                    file_name: "Godot_v4.7.2-stable_win64.exe".into(),
                },
                templates,
            };
            let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("fixtures")
                .join("web-sample");
            let mut lines = Vec::new();
            for (task_id, kind, project) in [
                ("task-version", TaskKind::Version, None),
                ("task-import", TaskKind::Import, Some(fixture.as_path())),
                ("task-export", TaskKind::ExportWeb, Some(fixture.as_path())),
            ] {
                let mut task = Task::prepare(
                    &out_root,
                    task_id,
                    kind,
                    project,
                    &pins,
                    TaskBudget::default(),
                )?;
                let status = task.run(None)?.clone();
                let mut line = format!(
                    "task={task_id} state={:?} exit={:?} message={} log={}",
                    status.state,
                    status.exit_code,
                    status.message,
                    task.log_path().display()
                );
                if status.state == TaskState::Succeeded && kind == TaskKind::ExportWeb {
                    let artifacts = task.hand_off_artifacts()?;
                    line.push_str(&format!(" artifacts={}", artifacts.len()));
                    for artifact in &artifacts {
                        line.push_str(&format!(
                            "\n    artifact={} bytes={} sha256={}",
                            artifact.name, artifact.bytes, artifact.sha256
                        ));
                    }
                }
                let cleanup = task.finish()?;
                line.push_str(&format!(
                    " profile_cleanup_hresult={}",
                    craftmine_godot_sandbox_probe::hex(cleanup as u32)
                ));
                println!("{line}");
                lines.push(line);
            }
            // Cancellation path of the product API: a 2s budget on an import
            // that takes longer must end Cancelled with an empty job.
            let mut task = Task::prepare(
                &out_root,
                "task-cancel",
                TaskKind::Import,
                Some(fixture.as_path()),
                &pins,
                TaskBudget {
                    timeout: Duration::from_secs(2),
                    ..Default::default()
                },
            )?;
            let status = task.run(None)?.clone();
            let cleanup = task.finish()?;
            let line = format!(
                "task=task-cancel state={:?} exit={:?} message={} profile_cleanup_hresult={}",
                status.state,
                status.exit_code,
                status.message,
                craftmine_godot_sandbox_probe::hex(cleanup as u32)
            );
            println!("{line}");
            lines.push(line.clone());
            if status.state != TaskState::Cancelled || !status.message.contains("job_active_processes=Some(0)") {
                return Err("Product API cancellation did not end with an empty job".into());
            }
            fs::write(out_root.join("task-api.txt"), lines.join("\n\n") + "\n")?;
        }
        Some("matrix") => {
            fs::create_dir_all(&out_root)?;
            let mut lines = Vec::new();
            for variant in variants() {
                println!("== {}", variant.name);
                let line = match run_variant(&variant, &out_root) {
                    Ok(line) => line,
                    Err(error) => format!("variant={} error={error}", variant.name),
                };
                println!("{line}");
                lines.push(line);
            }
            fs::write(out_root.join("matrix.txt"), lines.join("\n\n") + "\n")?;
            println!("matrix_report={}", out_root.join("matrix.txt").display());
        }
        Some("repeat") => {
            // Stability check: run one variant N times with unique directories.
            let name = args.get(3).cloned().unwrap_or_default();
            let count: u32 = args.get(4).and_then(|value| value.parse().ok()).unwrap_or(5);
            let variant = variants()
                .into_iter()
                .find(|variant| variant.name == name)
                .ok_or_else(|| format!("unknown variant {name}"))?;
            fs::create_dir_all(&out_root)?;
            let mut lines = Vec::new();
            for index in 0..count {
                let root = out_root.join(format!("{name}-run{index}"));
                let line = match run_variant(&variant, &root) {
                    Ok(line) => line,
                    Err(error) => format!("variant={} run={index} error={error}", variant.name),
                };
                println!("{line}");
                lines.push(line);
            }
            fs::write(out_root.join("repeat.txt"), lines.join("\n") + "\n")?;
            println!("repeat_report={}", out_root.join("repeat.txt").display());
        }
        _ => {
            return Err("usage: sandbox-diag <parent|matrix> <output-path>".into());
        }
    }
    Ok(())
}
