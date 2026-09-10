//! Per-task TCP/UDP evidence from a trusted fixed native executable. The host
//! verifies this executable's suspended process before running it; no project
//! is loaded, and the evidence is consumed before any Godot code is resumed.
use crate::{launch::{start_verified, LaunchSpec}, verification::ProcessVerification, Result};
use serde::{Deserialize, Serialize};
use std::{fs, io::{Read, Write}, net::{SocketAddr, TcpListener, TcpStream, UdpSocket},
    sync::{Arc, atomic::{AtomicBool, AtomicUsize, Ordering}}, time::Duration};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct NetworkCheck { pub name: String, pub ok: bool, pub raw_os_error: Option<i32>, pub error_kind: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct NativeObservation { pub winsock_startup: i32, pub checks: Vec<NetworkCheck> }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct NetworkPreflight {
    pub verified: bool,
    /// Measured while the completed native child's Job handle is still owned.
    pub job_active_processes: Option<u32>,
    pub policy_version: String,
    pub host_positive_controls: Vec<String>,
    pub host_received_counts: Vec<usize>,
    pub exact_task_exempt: bool,
    pub process_verification: ProcessVerification,
    pub observation: NativeObservation,
}

fn check<T>(name: &str, result: std::io::Result<T>) -> NetworkCheck {
    NetworkCheck { name: name.into(), ok: result.is_ok(), raw_os_error: result.as_ref().err().and_then(std::io::Error::raw_os_error),
        error_kind: result.err().map(|error| format!("{:?}", error.kind())) }
}

/// Called only by the broker's fixed internal child mode. Endpoints are host
/// generated loopback listeners, never a request-provided remote destination.
pub fn observe(endpoints: &[String]) -> Result<NativeObservation> {
    if endpoints.len() != 4 { return Err("Four fixed loopback endpoints are required".into()); }
    let endpoints = endpoints.iter().map(|address| address.parse::<SocketAddr>()).collect::<std::result::Result<Vec<_>, _>>()?;
    if endpoints.iter().any(|address| !address.ip().is_loopback() || address.port() == 0) { return Err("Preflight endpoints must be loopback".into()); }
    let startup = crate::network::winsock_startup_status();
    let mut checks = Vec::new();
    if startup == 0 {
        for (name, endpoint) in [("tcp4", endpoints[0]), ("tcp6", endpoints[1]), ("tcpExternal", "192.0.2.1:80".parse()?)] {
            checks.push(check(name, TcpStream::connect_timeout(&endpoint, Duration::from_secs(2))));
        }
        for (name, endpoint) in [("udp4", endpoints[2]), ("udp6", endpoints[3]), ("udpExternal", "192.0.2.1:80".parse()?)] {
            let result = UdpSocket::bind(if endpoint.is_ipv4() { "127.0.0.1:0" } else { "[::1]:0" })
                .and_then(|socket| socket.send_to(b"CMGD6NET", endpoint));
            checks.push(check(name, result));
        }
    }
    Ok(NativeObservation { winsock_startup: startup, checks })
}

struct Controls {
    addresses: Vec<SocketAddr>, stop: Arc<AtomicBool>, counts: Vec<Arc<AtomicUsize>>,
    threads: Vec<std::thread::JoinHandle<()>>,
}
impl Drop for Controls {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        for thread in self.threads.drain(..) { let _ = thread.join(); }
    }
}
impl Controls {
    fn create() -> Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let mut control = Self { addresses: Vec::new(), stop: stop.clone(), counts: Vec::new(), threads: Vec::new() };
        for address in ["127.0.0.1:0", "[::1]:0"] {
            let listener = TcpListener::bind(address)?; listener.set_nonblocking(true)?;
            control.addresses.push(listener.local_addr()?);
            let count = Arc::new(AtomicUsize::new(0)); control.counts.push(count.clone()); let stop = stop.clone();
            control.threads.push(std::thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    if let Ok((mut stream, _)) = listener.accept() {
                        count.fetch_add(1, Ordering::SeqCst);
                        let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                        let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
                        let mut bytes = [0; 8];
                        if stream.read_exact(&mut bytes).is_ok() && &bytes == b"CMGD6NET" { let _ = stream.write_all(&bytes); }
                    } else { std::thread::sleep(Duration::from_millis(5)); }
                }
            }));
        }
        for address in ["127.0.0.1:0", "[::1]:0"] {
            let socket = UdpSocket::bind(address)?; socket.set_nonblocking(true)?;
            control.addresses.push(socket.local_addr()?);
            let count = Arc::new(AtomicUsize::new(0)); control.counts.push(count.clone()); let stop = stop.clone();
            control.threads.push(std::thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    let mut bytes = [0; 8];
                    if let Ok((length, address)) = socket.recv_from(&mut bytes) {
                        count.fetch_add(1, Ordering::SeqCst);
                        if length == 8 && &bytes == b"CMGD6NET" { let _ = socket.send_to(&bytes, address); }
                    } else { std::thread::sleep(Duration::from_millis(5)); }
                }
            }));
        }
        for (index, endpoint) in control.addresses.iter().enumerate() {
            let mut bytes = [0; 8];
            if index < 2 {
                let mut socket = TcpStream::connect_timeout(endpoint, Duration::from_secs(2))?;
                socket.set_read_timeout(Some(Duration::from_secs(2)))?; socket.set_write_timeout(Some(Duration::from_secs(2)))?;
                socket.write_all(b"CMGD6NET")?; socket.read_exact(&mut bytes)?;
            } else {
                let socket = UdpSocket::bind(if endpoint.is_ipv4() { "127.0.0.1:0" } else { "[::1]:0" })?;
                socket.set_read_timeout(Some(Duration::from_secs(2)))?;
                socket.send_to(b"CMGD6NET", endpoint)?;
                let (length, source) = socket.recv_from(&mut bytes)?;
                if length != 8 || source != *endpoint { return Err("UDP positive control mismatch".into()); }
            }
            if &bytes != b"CMGD6NET" { return Err("Network positive control mismatch".into()); }
        }
        Ok(control)
    }
}

pub fn run(mut spec: LaunchSpec, cancel: &AtomicBool) -> Result<NetworkPreflight> {
    let controls = Controls::create()?;
    let previous = controls.counts.iter().map(|count| count.load(Ordering::SeqCst)).collect::<Vec<_>>();
    spec.args = std::iter::once("--native-preflight".into()).chain(controls.addresses.iter().map(ToString::to_string)).collect();
    let (_, exempt) = unsafe { crate::network::loopback_exemption(spec.appcontainer.ok_or("Missing task SID")?)? };
    if exempt { return Err("Task package has a loopback exemption".into()); }
    if cancel.load(Ordering::SeqCst) { return Err("Cancelled before native preflight".into()); }
    let running = start_verified(&spec)?;
    let verified = running.verification.clone().ok_or("Missing native process verification")?;
    let started = std::time::Instant::now();
    let code = loop {
        if let Some(exit) = running.wait(Duration::from_millis(50))? { break exit; }
        if cancel.load(Ordering::SeqCst) || started.elapsed() >= Duration::from_secs(20) {
            running.terminate(93)?; let _ = running.wait(Duration::from_secs(5))?;
            return Err("Native preflight cancelled or timed out; policy remains unknown".into());
        }
    };
    if code != 0 { return Err(format!("Native preflight exited {code}").into()); }
    let job_active_processes = running.job().and_then(|job| job.completed_active_processes(Duration::from_secs(2)));
    let path = running.log.as_ref().ok_or("Missing native preflight log")?;
    if fs::metadata(path)?.len() > 65536 { return Err("Native observation exceeds limit".into()); }
    let observation: NativeObservation = serde_json::from_slice(&fs::read(path)?)?;
    let expected = ["tcp4", "tcp6", "tcpExternal", "udp4", "udp6", "udpExternal"];
    if observation.winsock_startup != 0 || observation.checks.len() != expected.len() ||
        observation.checks.iter().zip(expected).any(|(check, name)| check.name != name || check.ok || check.raw_os_error != Some(10013) || check.error_kind.as_deref() != Some("PermissionDenied")) {
        return Err(format!("Native network policy remains unverified: {}", serde_json::to_string(&observation)?).into());
    }
    std::thread::sleep(Duration::from_millis(50));
    let received = controls.counts.iter().zip(previous).map(|(count, previous)| count.load(Ordering::SeqCst) - previous).collect::<Vec<_>>();
    if received.iter().any(|count| *count != 0) { return Err("Host received restricted network traffic".into()); }
    Ok(NetworkPreflight { verified: true, job_active_processes, policy_version: crate::verification::POLICY_VERSION.into(),
        host_positive_controls: vec!["tcp4Echo".into(), "tcp6Echo".into(), "udp4Echo".into(), "udp6Echo".into()], host_received_counts: received,
        exact_task_exempt: false, process_verification: verified, observation })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_preflight_keeps_timeout_distinct_from_success_and_denial() {
        let timeout = check::<()>("tcp4", Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "fixed timeout")));
        assert!(!timeout.ok);
        assert_eq!(timeout.raw_os_error, None);
        assert_eq!(timeout.error_kind.as_deref(), Some("TimedOut"));
        let denied = check::<()>("tcp4", Err(std::io::Error::from_raw_os_error(10013)));
        assert!(!denied.ok);
        assert_eq!(denied.raw_os_error, Some(10013));
        assert_eq!(denied.error_kind.as_deref(), Some("PermissionDenied"));
        let success = check("tcp4", Ok(()));
        assert!(success.ok);
        assert_eq!(success.raw_os_error, None);
        assert_eq!(success.error_kind, None);
    }

    #[test]
    fn native_observation_rejects_a_forged_verification_field() {
        assert!(serde_json::from_str::<NativeObservation>(r#"{"winsockStartup":0,"checks":[],"verified":true}"#).is_err());
    }
}
