//! Fixed native IPv4/IPv6 comparison. No arbitrary project/command arguments.
//! Fresh task profiles only; no global network state is modified.
use craftmine_godot_sandbox_probe::{Result, acl::grant_new_directory,
    desktop::{PrivateDesktop, StationChoice}, profile::AppContainerProfile,
    launch::{launch, launch_lpac_diagnostic, launch_lpac_registry_diagnostic, minimal_environment, LaunchSpec, Redirection}};
use std::{env, fs, net::{TcpListener, TcpStream}, path::PathBuf, time::{Duration, SystemTime, UNIX_EPOCH}};
use std::{io::{Read, Write}, sync::{Arc, atomic::{AtomicBool, AtomicUsize, Ordering}}};
use windows_sys::Win32::Storage::FileSystem::{DELETE, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_GENERIC_EXECUTE};

fn main() -> Result<()> {
    if env::args().len() != 1 { return Err("No arguments accepted".into()); }
    let identifier = format!("craftmine.gd5.net.{}.{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis());
    let parent = PathBuf::from(r"D:\Craftmine World\test-results\godot-cycle05-sandbox-network");
    fs::create_dir_all(&parent)?;
    let root = parent.join(&identifier); fs::create_dir(&root)?;
    println!("evidence_root={}", root.display());
    let v4 = TcpListener::bind("127.0.0.1:0")?;
    let v6 = TcpListener::bind("[::1]:0")?;
    for listener in [&v4, &v6] {
        let control = TcpStream::connect(listener.local_addr()?)?;
        let accepted = listener.accept()?;
        drop((control, accepted)); listener.set_nonblocking(true)?;
    }
    println!("host_positive_controls=v4,v6");
    let addresses = [v4.local_addr()?, v6.local_addr()?];
    println!("host_targets=v4:{},v6:{}", addresses[0], addresses[1]);
    let stop = Arc::new(AtomicBool::new(false));
    let counters = [Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0))];
    let echoed = [Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0))];
    let mut servers = Vec::new();
    for (index, listener) in [v4, v6].into_iter().enumerate() {
        let stop = stop.clone(); let count = counters[index].clone(); let echo = echoed[index].clone();
        servers.push(std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        count.fetch_add(1, Ordering::SeqCst);
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                        let mut bytes = [0u8; 8];
                        if stream.read_exact(&mut bytes).is_ok() && &bytes == b"CMGD5NET" && stream.write_all(&bytes).is_ok() {
                            echo.fetch_add(1, Ordering::SeqCst);
                        }
                    },
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(10)),
                    Err(_) => break,
                }
            }
        }));
    }
    for endpoint in addresses {
        let mut stream = TcpStream::connect_timeout(&endpoint, Duration::from_secs(2))?;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        stream.write_all(b"CMGD5NET")?;
        let mut bytes = [0u8; 8]; stream.read_exact(&mut bytes)?;
        if &bytes != b"CMGD5NET" { return Err("Host echo positive control mismatch".into()); }
        println!("host_echo_control={endpoint} passed=true");
    }
    for (name, lpac, registry_read) in [("appcontainer", false, false), ("lpac", true, false), ("lpac-registry", true, true)] {
        let previous = [counters[0].load(Ordering::SeqCst), counters[1].load(Ordering::SeqCst)];
        let previous_echo = [echoed[0].load(Ordering::SeqCst), echoed[1].load(Ordering::SeqCst)];
        let variant = root.join(name); fs::create_dir(&variant)?;
        let bin = variant.join("bin"); let work = variant.join("work");
        fs::create_dir(&bin)?; fs::create_dir(&work)?;
        let probe = bin.join("boundary-probe.exe");
        fs::copy(env::current_exe()?.with_file_name("boundary-probe.exe"), &probe)?;
        let mut profile = AppContainerProfile::create(&format!("{identifier}.{name}"), "Craftmine fixed network comparison")?;
        let sid = unsafe { craftmine_godot_sandbox_probe::report::sid_to_string(profile.sid())? };
        let (count, exempt) = unsafe { craftmine_godot_sandbox_probe::network::loopback_exemption(profile.sid())? };
        println!("variant={name} exemptions={count} exact_task_exempt={exempt}");
        let desktop = unsafe { PrivateDesktop::create(&format!("{identifier}.{name}"), &sid, StationChoice::SessionDefault, &[])? };
        unsafe {
            grant_new_directory(&bin, profile.sid(), FILE_GENERIC_READ | FILE_GENERIC_EXECUTE)?;
            grant_new_directory(&work, profile.sid(), FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE)?;
        }
        let log = variant.join("child.log");
        let spec = LaunchSpec { executable: probe, args: vec!["--network-matrix".into(), addresses[0].to_string(), addresses[1].to_string()],
            cwd: work.clone(), redirection: Redirection::LogFile(log.clone()), desktop: Some(desktop.name.clone()),
            appcontainer: Some(profile.sid()), job: Some(Default::default()), child_process_policy: None,
            handle_list: true, environment: Some(minimal_environment(&work, &env::var("SystemRoot")?)),
            timeout: Duration::from_secs(20), diagnose: false };
        let result = if registry_read { launch_lpac_registry_diagnostic(&spec) } else if lpac { launch_lpac_diagnostic(&spec) } else { launch(&spec) };
        match result {
            Ok(result) => println!("variant={name} exit={} timeout={} active={:?}", result.exit_code, result.timed_out, result.job_active_processes),
            Err(error) => println!("variant={name} launch_error={error}"),
        }
        if let Ok(output) = fs::read_to_string(&log) { print!("{output}"); }
        std::thread::sleep(Duration::from_millis(100));
        for (index, family) in [4, 6].into_iter().enumerate() {
            println!("variant={name} host_accepted_v{family}={} host_echo_v{family}={}",
                counters[index].load(Ordering::SeqCst) - previous[index], echoed[index].load(Ordering::SeqCst) - previous_echo[index]);
        }
        drop(desktop);
        println!("variant={name} cleanup_hresult={}", profile.delete());
    }
    stop.store(true, Ordering::SeqCst);
    for server in servers { let _ = server.join(); }
    println!("diagnostic_complete=true product_execution_enabled=false");
    Ok(())
}
