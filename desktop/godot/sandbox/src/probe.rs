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

fn describe_io<T>(result: &std::io::Result<T>) -> String {
    format!("ok={},kind={:?},os_error={:?},detail={:?}", result.is_ok(),
        result.as_ref().err().map(|error| error.kind()),
        result.as_ref().err().and_then(std::io::Error::raw_os_error),
        result.as_ref().err().map(|error| error.to_string()))
}

/// Records an expected explicit denial, keeping the raw OS error code.
fn denied<T>(result: &std::io::Result<T>, expected: &[i32], key: &str) -> Result<()> {
    let code = result.as_ref().err().and_then(std::io::Error::raw_os_error);
    report(key, format!("{code:?}"));
    report(&format!("{key}_result"), describe_io(result));
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
    denied(&loopback, &[10013], "net_loopback_connect_error")?;
    let bind = TcpListener::bind("127.0.0.1:0");
    // Binding a local listener does not establish cross-container data access.
    report("net_loopback_bind_error", format!("{:?}", bind.as_ref().err().and_then(std::io::Error::raw_os_error)));
    report("net_loopback_bind_result", describe_io(&bind));
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

// Observation-only native matrix: no timeout or generic failure is a denial.
fn network_matrix(args: &[String]) -> Result<()> {
    if args.len() != 4 { return Err("Expected fixed IPv4 and IPv6 loopback endpoints".into()); }
    use windows_sys::Win32::{Security::*, System::Threading::*};
    unsafe {
        let mut token = std::ptr::null_mut();
        craftmine_godot_sandbox_probe::win(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token), "OpenProcessToken")?;
        let token = craftmine_godot_sandbox_probe::Handle(token);
        for (name, class) in [("is_appcontainer", TokenIsAppContainer), ("is_lpac", TokenIsLessPrivilegedAppContainer)] {
            let mut value = 0u32; let mut length = 0;
            let ok = GetTokenInformation(token.0, class, (&mut value as *mut u32).cast(), std::mem::size_of_val(&value) as u32, &mut length);
            if ok == 0 && class == TokenIsLessPrivilegedAppContainer {
                // Windows may not implement this newer information class.
                // Preserve UNKNOWN, then collect network observations; this
                // diagnostic never treats missing LPAC identity as success.
                report(name, format!("unknown(os_error={:?},returned_bytes={length})", std::io::Error::last_os_error().raw_os_error()));
            } else {
                craftmine_godot_sandbox_probe::win(ok, name)?;
                report(name, value);
            }
        }
        let mut bytes = 0;
        GetTokenInformation(token.0, TokenCapabilities, std::ptr::null_mut(), 0, &mut bytes);
        if bytes == 0 { return Err("TokenCapabilities sizing unavailable".into()); }
        let mut storage = vec![0usize; (bytes as usize + 7) / 8];
        craftmine_godot_sandbox_probe::win(GetTokenInformation(token.0, TokenCapabilities, storage.as_mut_ptr().cast(), bytes, &mut bytes), "TokenCapabilities")?;
        report("capability_count", (*(storage.as_ptr() as *const TOKEN_GROUPS)).GroupCount);
    }
    let startup = craftmine_godot_sandbox_probe::network::winsock_startup_status();
    report("winsock_startup_error", startup);
    if startup != 0 { return Err("Winsock initialization failed; network policy remains unverified".into()); }
    let mut all_denied = true;
    for (index, address) in args[2..].iter().enumerate() {
        let endpoint: SocketAddr = address.parse()?;
        if !endpoint.ip().is_loopback() { return Err("Only loopback endpoints are permitted".into()); }
        report(&format!("loopback_v{}_target", if index == 0 { 4 } else { 6 }), endpoint);
        report(&format!("loopback_v{}_event", if index == 0 { 4 } else { 6 }), craftmine_godot_sandbox_probe::network::event_connect(endpoint)?);
        let result = TcpStream::connect_timeout(&endpoint, Duration::from_secs(2));
        let code = result.as_ref().err().and_then(std::io::Error::raw_os_error);
        report(&format!("loopback_v{}_connect_result", if index == 0 { 4 } else { 6 }),
            describe_io(&result));
        report(&format!("loopback_v{}_connect_error", if index == 0 { 4 } else { 6 }), format!("{code:?}"));
        if let Ok(mut stream) = result {
            use std::io::{Read, Write};
            stream.set_read_timeout(Some(Duration::from_secs(2)))?;
            stream.set_write_timeout(Some(Duration::from_secs(2)))?;
            let mut echoed = [0u8; 8];
            let exchange = stream.write_all(b"CMGD5NET").and_then(|_| stream.read_exact(&mut echoed));
            report(&format!("loopback_v{}_echo", if index == 0 { 4 } else { 6 }),
                format!("matched={},{}", exchange.is_ok() && &echoed == b"CMGD5NET", describe_io(&exchange)));
        }
        all_denied &= code == Some(10013);
    }
    for (name, endpoint) in [("v4", "127.0.0.1:0"), ("v6", "[::1]:0")] {
        let result = TcpListener::bind(endpoint);
        let code = result.as_ref().err().and_then(std::io::Error::raw_os_error);
        report(&format!("loopback_{name}_bind_result"), describe_io(&result));
        report(&format!("loopback_{name}_bind_error"), format!("{code:?}"));
    }
    let result = TcpStream::connect_timeout(&"192.0.2.1:80".parse()?, Duration::from_secs(2));
    let code = result.as_ref().err().and_then(std::io::Error::raw_os_error);
    report("external_connect_error", format!("{code:?}"));
    all_denied &= code == Some(10013);
    report("external_connect_result", describe_io(&result));
    report("network_policy_denied", all_denied);
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
        Some("--network-matrix") => {
            if let Err(error) = network_matrix(&args) {
                eprintln!("PROBE_ERROR: {error}");
                std::process::exit(1);
            }
            return;
        }
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

#[cfg(test)]
mod policy_evidence_tests {
    use super::*;
    #[test]
    fn errors_without_os_codes_are_distinct_from_success() {
        let timeout: std::io::Result<()> = Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "connection timed out"));
        assert!(describe_io(&timeout).contains("ok=false,kind=Some(TimedOut),os_error=None"));
        assert!(describe_io(&Ok(())).contains("ok=true,kind=None,os_error=None"));
    }
    #[test]
    fn timeout_and_refusal_are_not_authorization_denials() {
        for code in [10060, 10061, 10051, 87] {
            let result: std::io::Result<()> = Err(std::io::Error::from_raw_os_error(code));
            assert!(denied(&result, &[10013], "network").is_err());
        }
        assert!(denied(&Ok(()), &[10013], "network").is_err());
        let denied_result: std::io::Result<()> = Err(std::io::Error::from_raw_os_error(10013));
        assert!(denied(&denied_result, &[10013], "network").is_ok());
    }
}
