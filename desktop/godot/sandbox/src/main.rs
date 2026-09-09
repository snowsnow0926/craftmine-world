// Fixed, trusted acceptance gate for the Windows execution boundary.
//
// This binary is not a product API and accepts no project or command
// arguments. It builds a task directory from pinned, hash-verified inputs,
// launches the fixed native boundary probe and then real Godot
// (version, headless import, Web export) inside the same boundary, and writes
// raw evidence. The product-facing API for other tasks lives in the library.
use craftmine_godot_sandbox_probe::{
    acl::{grant_new_directory, inspect_new_work_label},
    desktop::{PrivateDesktop, StationChoice},
    launch::{launch, minimal_environment, LaunchSpec, Redirection},
    profile::AppContainerProfile,
};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::Read,
    net::TcpListener,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

const ENGINE_ROOT: &str = r"D:\Craftmine World\desktop\build\godot\4.7.2-stable";
/// Station that hosts the task desktop. Measured by `sandbox-diag matrix`.
const STATION: StationChoice = StationChoice::SessionDefault;
const PINNED: &[(&str, &str)] = &[
    (
        r"editor\Godot_v4.7.2-stable_win64.exe",
        "ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424",
    ),
    (
        r"editor\Godot_v4.7.2-stable_win64_console.exe",
        "c8f0a6bc45a19b33541501e57f6f7cd972ab18453743266339d495cbbe846643",
    ),
    (
        r"templates\version.txt",
        "38885c88f75abbc797a1db7559719800279a00cfb9fa8b2e2868a7f6f84bad2e",
    ),
    (
        r"templates\web_nothreads_debug.zip",
        "08962aefef811b603541d7951ac67ef00413aad2d978855183c28adee98f626a",
    ),
    (
        r"templates\web_nothreads_release.zip",
        "d3ee2f08cef0cf3cf6678a6355a92a8db48ccdd35cbd2e8bfd5f0e8a0b4032a0",
    ),
    (
        r"templates\web_release.zip",
        "02f0dca13ed3d8343fa68f8f88ac80295562408d71aa67157e8b96ddebaa67a3",
    ),
];

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

/// Copies a pinned input only after its hash matches the recorded value.
fn copy_pinned(source_root: &Path, relative: &str, destination: &Path) -> Result<()> {
    let source = source_root.join(relative);
    let actual = digest(&source)?;
    let expected = PINNED
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(relative))
        .map(|(_, hash)| *hash)
        .ok_or_else(|| format!("Unpinned input {relative}"))?;
    if actual != expected {
        return Err(format!("Pinned input hash mismatch for {relative}").into());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&source, destination)?;
    println!("pinned_input={relative} sha256={actual}");
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Prints a bounded tail of engine output; the full log stays on disk.
fn print_bounded(label: &str, text: &str, lines: usize) {
    let collected = text.lines().collect::<Vec<_>>();
    let start = collected.len().saturating_sub(lines);
    println!("{label}_lines={} showing_tail={}", collected.len(), collected.len() - start);
    for line in &collected[start..] {
        println!("{label}| {line}");
    }
}

fn run() -> Result<()> {
    let args = env::args().collect::<Vec<_>>();
    if args.len() != 1 {
        return Err("This fixed gate accepts no project or command arguments".into());
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let parent = manifest.join("out");
    fs::create_dir_all(&parent)?;
    let identifier = format!(
        "craftmine.gd0.gate.{}.{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis()
    );
    let root = parent.join(&identifier);
    let bin = root.join("bin");
    let work = root.join("work");
    let denied = root.join("denied");
    for path in [&root, &bin, &work, &denied] {
        fs::create_dir_all(path)?;
    }
    // Sibling directory the task must not reach: never granted to the task SID.
    let sentinel = denied.join("synthetic-sentinel.txt");
    fs::write(&sentinel, "synthetic-private-sentinel")?;

    let engine_root = PathBuf::from(ENGINE_ROOT);
    for (relative, _) in PINNED {
        let name = Path::new(relative)
            .file_name()
            .ok_or("Missing pinned file name")?;
        let target = if relative.starts_with("editor") {
            bin.join(name)
        } else {
            work.join("Godot")
                .join("export_templates")
                .join("4.7.2.stable")
                .join(name)
        };
        copy_pinned(&engine_root, relative, &target)?;
    }
    // No `_sc_` marker: the sandbox redirects APPDATA to the task's writable
    // directory, so the engine keeps its editor data there instead of trying to
    // write beside the read-only engine binary.
    let probe = bin.join("boundary-probe.exe");
    fs::copy(
        env::current_exe()?.with_file_name("boundary-probe.exe"),
        &probe,
    )?;
    let project = work.join("project");
    copy_tree(&manifest.join("fixtures").join("web-sample"), &project)?;
    println!("fixture_project={}", project.display());

    let listener = TcpListener::bind("127.0.0.1:0")?;
    // Positive control: the fixed host endpoint exists and accepts a connection.
    let control = std::net::TcpStream::connect(listener.local_addr()?)?;
    let accepted = listener.accept()?;
    drop((control, accepted));
    println!("host_loopback_control=passed");
    listener.set_nonblocking(true)?;
    // Targets for the editor-time (@tool / plugin) probe. Only paths and a
    // fixed TEST-NET endpoint; no credentials or user data.
    let targets = format!(
        "[probe]\nsentinel=\"{}\"\nexternal_host=\"192.0.2.1\"\nexternal_port=80\nloopback_host=\"{}\"\nloopback_port={}\n",
        sentinel.to_string_lossy().replace('\\', "/"),
        listener.local_addr()?.ip(),
        listener.local_addr()?.port()
    );
    fs::write(project.join("probe_targets.cfg"), targets)?;

    let mut profile =
        AppContainerProfile::create(&identifier, "Craftmine fixed Godot execution gate")?;
    let sid = unsafe { craftmine_godot_sandbox_probe::report::sid_to_string(profile.sid())? };
    let desktop = unsafe { PrivateDesktop::create(&identifier, &sid, STATION, &[])? };
    unsafe {
        grant_new_directory(&bin, profile.sid(), FILE_GENERIC_READ | FILE_GENERIC_EXECUTE)?;
        grant_new_directory(
            &work,
            profile.sid(),
            FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE,
        )?;
        let level = inspect_new_work_label(&work)?;
        println!("work_integrity_rid={level} label_modified=false");
    }
    println!("task_sid={sid}");

    let system_root = env::var("SystemRoot")?;
    let environment = minimal_environment(&work, &system_root);
    let spec_for = |executable: PathBuf, args: Vec<String>, log: PathBuf| LaunchSpec {
        executable,
        args,
        cwd: work.clone(),
        redirection: Redirection::LogFile(log),
        desktop: Some(desktop.name.clone()),
        appcontainer: Some(profile.sid()),
        job: Some(Default::default()),
        child_process_policy: None,
        handle_list: true,
        environment: Some(environment.clone()),
        timeout: Duration::from_secs(120),
        diagnose: false,
    };

    // 1. Fixed native boundary probe.
    let native_log = root.join("native-probe.log");
    let native = launch(&spec_for(
        probe,
        vec![
            "--native-probe".into(),
            work.to_string_lossy().into_owned(),
            sentinel.to_string_lossy().into_owned(),
            listener.local_addr()?.to_string(),
        ],
        native_log.clone(),
    ))?;
    let native_output = fs::read_to_string(&native_log)?;
    print!("{native_output}");
    let required = [
        "probe.allowed_dir_write=passed",
        "probe.denied_read_error=Some(5)",
        "probe.denied_write_error=Some(5)",
        "probe.denied_interactive_station_error=Some(5)",
        "probe.child_station_visible=false",
        "probe.net_external_connect_error=Some(10013)",
        "probe.net_loopback_connect_error=Some(10013)",
        "probe.native_boundary_probe=passed",
    ];
    for line in required {
        if !native_output.contains(line) {
            return Err(format!("Native boundary probe missing required evidence: {line}").into());
        }
    }
    if native.exit_code != 0 {
        return Err("Native boundary probe failed; Godot was not started".into());
    }
    if listener.accept().is_ok() {
        return Err("Host observed an unexpected loopback connection".into());
    }
    if fs::read_to_string(&sentinel)? != "synthetic-private-sentinel" {
        return Err("Synthetic sentinel changed".into());
    }
    println!("native_boundary_gate=passed");

    // 2. Real Godot: version, headless import, Web export with pinned templates.
    let engine = bin.join("Godot_v4.7.2-stable_win64.exe");
    let version_log = root.join("godot-version.log");
    let version = launch(&spec_for(
        engine.clone(),
        vec!["--headless".into(), "--version".into()],
        version_log.clone(),
    ))?;
    let version_output = fs::read_to_string(&version_log)?;
    print_bounded("godot_version", &version_output, 5);
    if version.exit_code != 0 || !version_output.contains("4.7.2.stable.official.ed1daf0bf") {
        return Err("Pinned Godot version probe failed".into());
    }
    println!("godot_version=passed");

    let import_log = root.join("godot-import.log");
    let import = launch(&spec_for(
        engine.clone(),
        vec![
            "--headless".into(),
            "--path".into(),
            project.to_string_lossy().into_owned(),
            "--import".into(),
        ],
        import_log.clone(),
    ))?;
    let import_output = fs::read_to_string(&import_log)?;
    print_bounded("godot_import", &import_output, 20);
    println!("godot_import_exit={}", craftmine_godot_sandbox_probe::hex(import.exit_code));
    if import.exit_code != 0 {
        return Err(format!(
            "Godot headless import failed with exit {}",
            craftmine_godot_sandbox_probe::hex(import.exit_code)
        )
        .into());
    }
    if !project.join(".godot").is_dir() {
        return Err("Godot import produced no .godot directory".into());
    }
    // Editor-time code (@tool resource + enabled editor plugin) must be inside
    // the same boundary as the final game.
    let probe_result = fs::read_to_string(project.join("probe_result.txt"))
        .map_err(|error| format!("Editor-time probe produced no result: {error}"))?;
    println!("editor_time_probe=\n{probe_result}");
    for line in [
        "plugin_ran=true",
        "plugin_file_read=denied",
        "plugin_file_write=denied",
        "plugin_sibling_write=denied",
        "plugin_external_connect=denied",
        "plugin_spawn=denied",
        "tool_init_ran=true",
        "tool_init_file_read=denied",
    ] {
        if !probe_result.contains(line) {
            return Err(format!("Editor-time boundary evidence missing: {line}").into());
        }
    }
    println!("editor_time_boundary=passed");
    println!("godot_import=passed");

    let export_dir = work.join("export");
    fs::create_dir_all(&export_dir)?;
    let export_log = root.join("godot-export.log");
    let export = launch(&spec_for(
        engine,
        vec![
            "--headless".into(),
            "--path".into(),
            project.to_string_lossy().into_owned(),
            "--export-release".into(),
            "Web".into(),
            export_dir.join("index.html").to_string_lossy().into_owned(),
        ],
        export_log.clone(),
    ))?;
    let export_output = fs::read_to_string(&export_log)?;
    print_bounded("godot_export", &export_output, 30);
    println!("godot_export_exit={}", craftmine_godot_sandbox_probe::hex(export.exit_code));
    if export.exit_code != 0 {
        return Err(format!(
            "Godot Web export failed with exit {}",
            craftmine_godot_sandbox_probe::hex(export.exit_code)
        )
        .into());
    }
    // Artifact handoff: the parent hashes every produced file itself.
    let mut artifacts = Vec::new();
    for entry in fs::read_dir(&export_dir)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            let path = entry.path();
            let bytes = entry.metadata()?.len();
            artifacts.push(format!(
                "artifact={} bytes={bytes} sha256={}",
                entry.file_name().to_string_lossy(),
                digest(&path)?
            ));
        }
    }
    artifacts.sort();
    if artifacts.len() < 4 {
        return Err(format!("Web export produced only {} files", artifacts.len()).into());
    }
    for line in &artifacts {
        println!("{line}");
    }
    println!("godot_web_export=passed files={}", artifacts.len());

    let mut evidence = String::new();
    evidence.push_str(&format!("identifier={identifier}\n"));
    evidence.push_str(&format!("task_sid={sid}\n"));
    evidence.push_str(&format!("station={}\n", desktop.station_name));
    evidence.push_str(&format!("station_visible={}\n", desktop.station_visible));
    evidence.push_str(&format!("desktop={}\n", String::from_utf16_lossy(
        &desktop.name[..desktop.name.len().saturating_sub(1)]
    )));
    evidence.push_str(&native_output);
    evidence.push_str(&format!("godot_version_output={version_output:?}\n"));
    evidence.push_str(&format!("godot_import_output={import_output:?}\n"));
    evidence.push_str(&format!("godot_export_output={export_output:?}\n"));    evidence.push_str(&artifacts.join("\n"));
    evidence.push_str("\nnot-verified=LPAC,non-loopback-network-denied-by-policy-not-routing,untrusted-model-projects,UI-interaction\n");
    fs::write(root.join("evidence.txt"), &evidence)?;
    println!("evidence={}", root.display());

    drop(desktop);
    let cleanup = profile.delete();
    println!(
        "profile_cleanup_hresult={}",
        craftmine_godot_sandbox_probe::hex(cleanup as u32)
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("PROBE_ERROR: {error}");
        std::process::exit(1);
    }
}
