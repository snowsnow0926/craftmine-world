// Fixed trusted boundary probe; never sends input or opens the real clipboard.
use std::{
    env, fs,
    net::{SocketAddr, TcpStream},
    os::windows::process::CommandExt,
    path::PathBuf,
    time::Duration,
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const CREATE_NO_WINDOW: u32 = 0x08000000;
fn denied_error<T>(result: &std::io::Result<T>, expected: &[i32], label: &str) -> Result<()> {
    let code = result.as_ref().err().and_then(std::io::Error::raw_os_error);
    println!("{label}_error={code:?}");
    if !code.is_some_and(|code| expected.contains(&code)) {
        return Err(format!("{label}: expected explicit access denial, got {code:?}").into());
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
        if flags.dwFlags & WSF_VISIBLE as u32 != 0 {
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
        println!(
            "denied_interactive_station_error={:?}",
            error.raw_os_error()
        );
        if error.raw_os_error() != Some(5) {
            return Err(error.into());
        }
        println!("child_station_visible=false");
    }
    Ok(())
}
fn native_probe(args: &[String]) -> Result<()> {
    if args.len() != 5 {
        return Err("Invalid fixed probe invocation".into());
    }
    let allowed = PathBuf::from(&args[2]);
    let denied = PathBuf::from(&args[3]);
    let endpoint: SocketAddr = args[4].parse()?;
    if !endpoint.ip().is_loopback() {
        return Err("Only a synthetic loopback endpoint is allowed".into());
    }
    private_ui_boundary()?;
    let allowed_file = allowed.join("allowed.txt");
    fs::write(&allowed_file, "task-allowed")?;
    assert_eq!(fs::read_to_string(&allowed_file)?, "task-allowed");
    let read = fs::read_to_string(&denied);
    println!(
        "denied_read_error={:?}",
        read.as_ref().err().map(std::io::Error::raw_os_error)
    );
    denied_error(&read, &[5], "denied_read")?;
    let write = fs::OpenOptions::new().write(true).open(&denied);
    println!(
        "denied_write_error={:?}",
        write.as_ref().err().map(std::io::Error::raw_os_error)
    );
    denied_error(&write, &[5], "denied_write")?;
    let network = TcpStream::connect_timeout(&endpoint, Duration::from_millis(500));
    println!(
        "denied_network_error={:?}",
        network.as_ref().err().map(std::io::Error::raw_os_error)
    );
    denied_error(&network, &[10013], "denied_network")?;
    let child = std::process::Command::new(env::current_exe()?)
        .arg("--child-marker")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    println!(
        "denied_child_error={:?}",
        child.as_ref().err().map(std::io::Error::raw_os_error)
    );
    if let Ok(mut process) = child {
        let _ = process.wait();
        return Err("Child process unexpectedly allowed".into());
    }
    denied_error(&child, &[5, 1260, 367], "denied_child")?;
    println!("native_boundary_probe=passed");
    Ok(())
}
fn main() {
    let args = env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) == Some("--child-marker") {
        return;
    }
    if args.get(1).map(String::as_str) != Some("--native-probe") {
        eprintln!("Expected fixed probe invocation");
        std::process::exit(2);
    }
    if let Err(error) = native_probe(&args) {
        eprintln!("PROBE_ERROR: {error}");
        std::process::exit(1);
    }
}
