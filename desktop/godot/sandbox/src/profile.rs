//! AppContainer profile lifecycle: always new, never reused, always deleted.
use crate::{wide, Result};
use std::ptr::{null, null_mut};
use windows_sys::Win32::Security::{FreeSid, PSID};
use windows_sys::Win32::Security::Isolation::{CreateAppContainerProfile, DeleteAppContainerProfile};

pub struct AppContainerProfile {
    name: Vec<u16>,
    sid: PSID,
    deleted: bool,
}

impl AppContainerProfile {
    /// Creates a brand-new profile. An existing profile name is never reused.
    pub fn create(identifier: &str, display: &str) -> Result<Self> {
        unsafe {
            let name = wide(identifier);
            let mut sid = null_mut();
            let code = CreateAppContainerProfile(
                name.as_ptr(),
                name.as_ptr(),
                wide(display).as_ptr(),
                null(),
                0,
                &mut sid,
            );
            if code < 0 {
                return Err(format!(
                    "CreateAppContainerProfile HRESULT {}; no existing profile reused",
                    crate::hex(code as u32)
                )
                .into());
            }
            Ok(Self {
                name,
                sid,
                deleted: false,
            })
        }
    }

    pub fn sid(&self) -> PSID {
        self.sid
    }

    pub fn name_wide(&self) -> &[u16] {
        &self.name
    }

    /// Deletes the profile explicitly so callers can record the HRESULT.
    pub fn delete(&mut self) -> i32 {
        if self.deleted {
            return 0;
        }
        let result = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
        // A failed deletion remains pending. A repeated explicit call (or Drop)
        // must retry rather than falsely return success for a leaked profile.
        self.deleted = result >= 0;
        result
    }
}

impl Drop for AppContainerProfile {
    fn drop(&mut self) {
        if !self.deleted {
            let result = self.delete();
            eprintln!("profile_cleanup_hresult={}", crate::hex(result as u32));
        }
        unsafe {
            FreeSid(self.sid);
        }
    }
}
