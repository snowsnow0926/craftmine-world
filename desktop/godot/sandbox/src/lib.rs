//! Reusable Windows execution boundary for managed Godot build processes.
//!
//! This library is the only place in the product that creates a restricted
//! process. It never accepts an arbitrary command line: callers describe a task
//! with [`launch::LaunchSpec`], and every spec is validated before creation.
#![cfg(windows)]
pub mod acl;
pub mod desktop;
pub mod launch;
pub mod loader;
pub mod network;
pub mod profile;
pub mod report;
pub mod task;
pub mod verification;
pub mod preflight;
pub mod broker;
pub mod recovery;

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// NUL-terminated UTF-16 copy for Win32 W APIs.
pub fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

/// Convert a Win32 failure into an error that keeps the OS error code.
pub fn win(ok: i32, label: &str) -> Result<()> {
    if ok == 0 {
        Err(format!("{label}: {}", std::io::Error::last_os_error()).into())
    } else {
        Ok(())
    }
}

/// Owned Win32 handle with deterministic close.
pub struct Handle(pub HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                CloseHandle(self.0);
            }
        }
    }
}

/// Hex formatting used by every evidence line so logs stay greppable.
pub fn hex(value: u32) -> String {
    format!("{value:#x}")
}
