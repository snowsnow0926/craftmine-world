//! Read-only network isolation diagnostics. Never changes firewall rules or
//! AppContainer loopback exemptions, even when current policy is insufficient.
use crate::Result;
use std::ptr::null_mut;
use windows_sys::Win32::{Security::{EqualSid, PSID, SID_AND_ATTRIBUTES},
    System::Memory::{GetProcessHeap, HeapFree}};

#[link(name = "FirewallAPI", kind = "raw-dylib")]
extern "system" {
    fn NetworkIsolationGetAppContainerConfig(count: *mut u32, sids: *mut *mut SID_AND_ATTRIBUTES) -> u32;
}

/// Returns the exemption count and whether the exact task package SID matches.
/// Other applications' names/SIDs are deliberately not included in evidence.
/// The API allocates each SID and the array on the process heap (MSDN contract).
pub unsafe fn loopback_exemption(task_sid: PSID) -> Result<(u32, bool)> {
    let mut count = 0;
    let mut sids = null_mut();
    let result = NetworkIsolationGetAppContainerConfig(&mut count, &mut sids);
    if result != 0 { return Err(format!("NetworkIsolationGetAppContainerConfig: {result}").into()); }
    let mut matches = false;
    if !sids.is_null() {
        let heap = GetProcessHeap();
        for index in 0..count {
            let entry = &*sids.add(index as usize);
            matches |= !task_sid.is_null() && EqualSid(entry.Sid, task_sid) != 0;
            HeapFree(heap, 0, entry.Sid);
        }
        HeapFree(heap, 0, sids.cast());
    }
    Ok((count, matches))
}

/// Checks initialization without Rust's panic on WSAStartup failure.
pub fn winsock_startup_status() -> i32 {
    use windows_sys::Win32::Networking::WinSock::*;
    unsafe {
        let mut data = WSADATA::default();
        let code = WSAStartup(0x202, &mut data);
        if code == 0 { WSACleanup(); }
        code
    }
}

/// Captures FD_CONNECT's own error code, independently of Rust's
/// connect_timeout abstraction. The bounded wait returning timeout is UNKNOWN.
pub fn event_connect(endpoint: std::net::SocketAddr) -> Result<String> {
    use windows_sys::Win32::Networking::WinSock::*;
    unsafe {
        let mut data = WSADATA::default();
        let startup = WSAStartup(0x202, &mut data);
        if startup != 0 { return Ok(format!("unknown(startup_error={startup})")); }
        struct Cleanup;
        impl Drop for Cleanup { fn drop(&mut self) { unsafe { WSACleanup(); } } }
        let _cleanup = Cleanup;
        let socket = socket(if endpoint.is_ipv4() { AF_INET } else { AF_INET6 } as i32, SOCK_STREAM, IPPROTO_TCP);
        if socket == INVALID_SOCKET { return Ok(format!("unknown(socket_error={})", WSAGetLastError())); }
        struct Socket(SOCKET);
        impl Drop for Socket { fn drop(&mut self) { unsafe { closesocket(self.0); } } }
        let socket = Socket(socket);
        let event = WSACreateEvent();
        if event == WSA_INVALID_EVENT { return Err(format!("WSACreateEvent: {}", WSAGetLastError()).into()); }
        struct Event(WSAEVENT);
        impl Drop for Event { fn drop(&mut self) { unsafe { WSACloseEvent(self.0); } } }
        let event = Event(event);
        if WSAEventSelect(socket.0, event.0, FD_CONNECT as i32) != 0 {
            return Err(format!("WSAEventSelect: {}", WSAGetLastError()).into());
        }
        let result = match endpoint {
            std::net::SocketAddr::V4(address) => {
                let address = SOCKADDR_IN { sin_family: AF_INET, sin_port: address.port().to_be(),
                    sin_addr: IN_ADDR { S_un: IN_ADDR_0 { S_addr: u32::from_ne_bytes(address.ip().octets()) } }, sin_zero: [0; 8] };
                connect(socket.0, (&address as *const SOCKADDR_IN).cast(), std::mem::size_of_val(&address) as i32)
            },
            std::net::SocketAddr::V6(address) => {
                let address = SOCKADDR_IN6 { sin6_family: AF_INET6, sin6_port: address.port().to_be(), sin6_flowinfo: 0,
                    sin6_addr: IN6_ADDR { u: IN6_ADDR_0 { Byte: address.ip().octets() } }, Anonymous: SOCKADDR_IN6_0 { sin6_scope_id: address.scope_id() } };
                connect(socket.0, (&address as *const SOCKADDR_IN6).cast(), std::mem::size_of_val(&address) as i32)
            }
        };
        if result == 0 { return Ok("connected(immediate)".into()); }
        let initial_error = WSAGetLastError();
        if initial_error != WSAEWOULDBLOCK {
            return Ok(format!("completed(connect_error={initial_error})"));
        }
        let event_handle = event.0 as windows_sys::Win32::Foundation::HANDLE;
        let wait = WSAWaitForMultipleEvents(1, &event_handle, 1, 2000, 0);
        if wait == WSA_WAIT_TIMEOUT { return Ok("unknown(fd_connect_timeout)".into()); }
        if wait != WSA_WAIT_EVENT_0 as u32 { return Ok(format!("unknown(event_wait={wait},error={})", WSAGetLastError())); }
        let mut events = WSANETWORKEVENTS::default();
        if WSAEnumNetworkEvents(socket.0, event.0, &mut events) != 0 {
            return Ok(format!("unknown(enum_error={})", WSAGetLastError()));
        }
        if events.lNetworkEvents & FD_CONNECT as i32 == 0 { return Ok("unknown(no_fd_connect)".into()); }
        Ok(format!("completed(fd_connect_error={})", events.iErrorCode[FD_CONNECT_BIT as usize]))
    }
}
