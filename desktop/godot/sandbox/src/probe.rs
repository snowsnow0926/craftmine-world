// Fixed trusted boundary probe; never sends input, opens the real clipboard or
// touches another user's data.
use std::{
    env, fs,
    net::{SocketAddr, TcpListener, TcpStream},
    os::windows::process::CommandExt,
    path::PathBuf,
    time::Duration,
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn report(key: &str, value: impl std::fmt::Display) {
    println!("probe.{key}={value}");
}

/// Records an expected explicit denial, keeping the raw OS error code.
fn denied<T>(result: &std::io::Result<T>, expected: &[i32], key: &str) -> Result<()> {
    let code = result.as_ref().err().and_then(std::io::Error::raw_os_error);
    report(key, format!("{code:?}"));
    if !code.is_some_and(|code| expected.contains(&code)) {
        return Err(format!("{key}: expected explicit denial {expected:?}, got {code:?}").into());
    }
    Ok(())
}

fn private_ui_boundary() -> Result<()> {
    use windows_sys::Win32::{System::StationsAndDesktops::*, UI::WindowsAndMessaging::*};
    unsafe {
        let mut flags = USEROBJECTFLAGS::default();
        if GetUserObjectInformationW(
            GetProcessWindowStation(),
            UOI_FLAGS,
            (&mut flags as *mut USEROBJECTFLAGS).cast(),
            std::mem::size_of_val(&flags) as u32,
            std::ptr::null_mut(),
        ) == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let visible = flags.dwFlags & WSF_VISIBLE as u32 != 0;
        report("child_station_visible", visible);
        if visible {
            return Err("Child station is visible".into());
        }
        let name: Vec<u16> = "WinSta0\0".encode_utf16().collect();
        let station = OpenWindowStationW(
            name.as_ptr(),
            0,
            (WINSTA_ACCESSCLIPBOARD | WINSTA_READSCREEN) as u32,
        );
        if !station.is_null() {
            CloseWindowStation(station);
            return Err("Interactive station access unexpectedly granted".into());
        }
        let error = std::io::Error::last_os_error();
        report("denied_interactive_station_error", format!("{:?}", error.raw_os_error()));
        if error.raw_os_error() != Some(5) {
            return Err(error.into());
        }
    }
    Ok(())
}

fn network_probe(endpoint: SocketAddr) -> Result<()> {
    if !endpoint.ip().is_loopback() {
        return Err("The fixed host endpoint must be loopback".into());
    }
    // Host-created positive control: the same endpoint accepts the host.
    let loopback = TcpStream::connect_timeout(&endpoint, Duration::from_millis(500));
    report(
        "net_loopback_connect_error",
        format!("{:?}", loopback.as_ref().err().and_then(std::io::Error::raw_os_error)),
    );
    let bind = TcpListener::bind("127.0.0.1:0");
    report(
        "net_loopback_bind_error",
        format!("{:?}", bind.as_ref().err().and_then(std::io::Error::raw_os_error)),
    );
    // Non-loopback egress must be denied by policy, not by routing. 192.0.2.0/24
    // is TEST-NET-1, so a policy denial is distinguishable from a timeout.
    let external: SocketAddr = "192.0.2.1:80".parse()?;
    let outbound = TcpStream::connect_timeout(&external, Duration::from_secs(2));
    denied(&outbound, &[10013], "net_external_connect_error")?;
    Ok(())}

fn child_probe() -> Result<()> {
    let child = std::process::Command::new(env::current_exe()?)
        .arg("--child-marker")
        .arg("denied-child-marker.txt")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    if child.is_ok() {
        if let Ok(mut process) = child {
            let _ = process.wait();
        }
        return Err("Child process unexpectedly allowed".into());
    }
    // ERROR_ACCESS_DENIED, ERROR_ACCESS_DISABLED_BY_POLICY and
    // ERROR_NOT_ENOUGH_QUOTA (job active-process limit) are all explicit denials.
    denied(&child, &[5, 1260, 367, 1816], "child_spawn_error")?;
    Ok(())
}

fn native_probe(args: &[String]) -> Result<()> {
    if args.len() != 5 {
        return Err("Invalid fixed probe invocation".into());
    }
    let allowed = PathBuf::from(&args[2]);
    let denied_path = PathBuf::from(&args[3]);
    let endpoint: SocketAddr = args[4].parse()?;
    private_ui_boundary()?;
    let allowed_file = allowed.join("allowed.txt");
    fs::write(&allowed_file, "task-allowed")?;
    if fs::read_to_string(&allowed_file)? != "task-allowed" {
        return Err("Task directory round trip failed".into());
    }
    report("allowed_dir_write", "passed");
    let read = fs::read_to_string(&denied_path);
    denied(&read, &[5], "denied_read_error")?;
    let write = fs::OpenOptions::new().write(true).open(&denied_path);
    denied(&write, &[5], "denied_write_error")?;
    network_probe(endpoint)?;
    child_probe()?;
    report("native_boundary_probe", "passed");
    Ok(())
}

fn main() {
    let args = env::args().collect::<Vec<_>>();
    match args.get(1).map(String::as_str) {
        // Child marker: proves the restricted child reached `main`.
        Some("--child-marker") => {
            if let Some(path) = args.get(2) {
                let _ = fs::write(path, "child-marker\n");
            }
            return;
        }
        // Cancellation fixture: a child that would outlive any sane budget.
        Some("--sleep") => {
            let millis: u64 = args.get(2).and_then(|value| value.parse().ok()).unwrap_or(60_000);
            std::thread::sleep(Duration::from_millis(millis));
            return;
        }
        // Child self-report: proves what the restricted token can see.
        Some("--child-report") => {
            let path = match args.get(2) {
                Some(path) => PathBuf::from(path),
                None => {
                    eprintln!("--child-report needs an output path");
                    std::process::exit(2);
                }
            };
            let result = unsafe {
                craftmine_godot_sandbox_probe::report::write_current_process_report(&path)
            };
            if let Err(error) = result {
                eprintln!("PROBE_ERROR: {error}");
                std::process::exit(1);
            }
            return;
        }
        Some("--native-probe") => {}
        _ => {
            eprintln!("Expected fixed probe invocation");
            std::process::exit(2);
        }
    }
    if let Err(error) = native_probe(&args) {
        eprintln!("PROBE_ERROR: {error}");
        std::process::exit(1);
    }
}
