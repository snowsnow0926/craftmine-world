// Child-only trusted boundary probe: no profile-management DLL imports.
use std::{
    env, fs,
    net::{SocketAddr, TcpStream},
    os::windows::process::CommandExt,
    path::PathBuf,
    time::Duration,
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const CREATE_NO_WINDOW: u32 = 0x08000000;
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
    let allowed_file = allowed.join("allowed.txt");
    fs::write(&allowed_file, "task-allowed")?;
    assert_eq!(fs::read_to_string(&allowed_file)?, "task-allowed");
    let read = fs::read_to_string(&denied);
    println!(
        "denied_read_error={:?}",
        read.as_ref().err().map(std::io::Error::raw_os_error)
    );
    if read.is_ok() {
        return Err("Synthetic denied file was readable".into());
    }
    let write = fs::OpenOptions::new().write(true).open(&denied);
    println!(
        "denied_write_error={:?}",
        write.as_ref().err().map(std::io::Error::raw_os_error)
    );
    if write.is_ok() {
        return Err("Synthetic denied file was writable".into());
    }
    let network = TcpStream::connect_timeout(&endpoint, Duration::from_millis(500));
    println!(
        "denied_network_error={:?}",
        network.as_ref().err().map(std::io::Error::raw_os_error)
    );
    if network.is_ok() {
        return Err("Synthetic loopback connection was permitted".into());
    }
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
