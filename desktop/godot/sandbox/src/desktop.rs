//! Task desktop creation. Existing station ACLs are never modified.
//!
//! A standard user cannot create a window station (`CreateWindowStationW`
//! returned OS error 5 in cycle 3), so the only stations available are ones
//! that already exist in the logon session. The launcher therefore selects a
//! station and creates a *new* desktop on it, with an explicit descriptor that
//! names SYSTEM, the helper user and the task SID.
use crate::{wide, win, Handle, Result};
use std::ptr::{null, null_mut};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    System::{StationsAndDesktops::*, Threading::*},
    UI::WindowsAndMessaging::{WINSTA_CREATEDESKTOP, WINSTA_READATTRIBUTES, WSF_VISIBLE},
};

/// Which window station hosts the new task desktop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StationChoice {
    /// `CreateWindowStationW(NULL, ..)`: the logon session's system-named
    /// noninteractive station. Historic cycle-2/3 behaviour.
    SessionDefault,
    /// The station this helper process is already associated with.
    Current,
    /// An existing station opened by name with create-desktop rights.
    Named(&'static str),
}

struct Descriptor(PSECURITY_DESCRIPTOR);
impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}

unsafe fn sid_string(sid: PSID) -> Result<String> {
    let mut value = null_mut();
    win(
        ConvertSidToStringSidW(sid, &mut value),
        "ConvertSidToStringSidW",
    )?;
    let mut length = 0;
    while *value.add(length) != 0 {
        length += 1;
    }
    let result = String::from_utf16(std::slice::from_raw_parts(value, length));
    LocalFree(value.cast());
    Ok(result?)
}

unsafe fn descriptor(task_sid: &str, extra_sids: &[&str]) -> Result<Descriptor> {
    let mut token = null_mut();
    win(
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
        "Read owner token",
    )?;
    let token = Handle(token);
    let mut bytes = 0;
    GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut bytes);
    let mut storage = vec![0usize; (bytes as usize + 7) / 8];
    win(
        GetTokenInformation(
            token.0,
            TokenUser,
            storage.as_mut_ptr().cast(),
            bytes,
            &mut bytes,
        ),
        "Read owner SID",
    )?;
    let user = &*(storage.as_ptr() as *const TOKEN_USER);
    let mut aces = String::new();
    for sid in extra_sids {
        aces.push_str(&format!("(A;;GA;;;{sid})"));
    }
    // Protected ACL and low integrity label apply only to new private USER objects.
    let sddl = wide(format!(
        "D:P(A;;GA;;;SY)(A;;GA;;;{})(A;;0x000200c7;;;{task_sid}){aces}S:(ML;;NW;;;LW)",
        sid_string(user.User.Sid)?,
    ));
    let mut sd = null_mut();
    win(
        ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut sd, null_mut()),
        "Private object descriptor",
    )?;
    Ok(Descriptor(sd))
}

unsafe fn object_name(handle: HANDLE) -> Result<String> {
    let mut buffer = [0u16; 256];
    win(
        GetUserObjectInformationW(
            handle,
            UOI_NAME,
            buffer.as_mut_ptr().cast(),
            std::mem::size_of_val(&buffer) as u32,
            null_mut(),
        ),
        "Read user object name",
    )?;
    let end = buffer
        .iter()
        .position(|c| *c == 0)
        .ok_or("Missing object name terminator")?;
    Ok(String::from_utf16(&buffer[..end])?)
}

unsafe fn object_visible(handle: HANDLE) -> Result<bool> {
    let mut flags = USEROBJECTFLAGS::default();
    win(
        GetUserObjectInformationW(
            handle,
            UOI_FLAGS,
            (&mut flags as *mut USEROBJECTFLAGS).cast(),
            std::mem::size_of_val(&flags) as u32,
            null_mut(),
        ),
        "Read user object flags",
    )?;
    Ok(flags.dwFlags & WSF_VISIBLE as u32 != 0)
}

/// A task desktop created by this run, plus the station it lives on.
pub struct PrivateDesktop {
    station: HWINSTA,
    desktop: HDESK,
    original_station: HWINSTA,
    original_desktop: HDESK,
    owns_station: bool,
    /// Fully qualified `station\desktop` name handed to `CreateProcessW`.
    pub name: Vec<u16>,
    pub station_name: String,
    pub station_visible: bool,
    pub choice: StationChoice,
}

impl Drop for PrivateDesktop {
    fn drop(&mut self) {
        unsafe {
            // Association restoration affects this console helper only, never
            // the input desktop.
            let restored = SetProcessWindowStation(self.original_station) != 0
                && SetThreadDesktop(self.original_desktop) != 0;
            let desktop_closed = self.desktop.is_null() || CloseDesktop(self.desktop) != 0;
            let station_closed =
                !self.owns_station || self.station.is_null() || CloseWindowStation(self.station) != 0;
            eprintln!(
                "private_desktop_cleanup restored={restored} desktop_closed={desktop_closed} station_closed={station_closed}"
            );
        }
    }
}

impl PrivateDesktop {
    pub unsafe fn create(
        identifier: &str,
        task_sid: &str,
        choice: StationChoice,
        extra_desktop_sids: &[&str],
    ) -> Result<Self> {
        let sd = descriptor(task_sid, extra_desktop_sids)?;
        let security = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd.0,
            bInheritHandle: 0,
        };
        let mut result = Self {
            station: null_mut(),
            desktop: null_mut(),
            original_station: GetProcessWindowStation(),
            original_desktop: GetThreadDesktop(GetCurrentThreadId()),
            owns_station: false,
            name: Vec::new(),
            station_name: String::new(),
            station_visible: false,
            choice,
        };
        result.station = match choice {
            StationChoice::SessionDefault => {
                // lpSecurityDescriptor affects creation only; no ACL setter
                // touches the station.
                result.owns_station = true;
                CreateWindowStationW(
                    null(),
                    0,
                    (WINSTA_READATTRIBUTES | WINSTA_CREATEDESKTOP) as u32,
                    &security,
                )
            }
            StationChoice::Current => result.original_station,
            StationChoice::Named(name) => {
                result.owns_station = true;
                let name = wide(name);
                OpenWindowStationW(
                    name.as_ptr(),
                    0,
                    (WINSTA_READATTRIBUTES | WINSTA_CREATEDESKTOP) as u32,
                )
            }
        };
        if result.station.is_null() {
            return Err(format!(
                "Open task window station ({choice:?}): {}",
                std::io::Error::last_os_error()
            )
            .into());
        }
        result.station_name = object_name(result.station)?;
        result.station_visible = object_visible(result.station)?;
        if result.station_name.eq_ignore_ascii_case("WinSta0")
            && choice == StationChoice::SessionDefault
        {
            return Err("Refusing interactive window station".into());
        }
        // Only switch this helper's association when the task station differs.
        if result.station != result.original_station {
            win(
                SetProcessWindowStation(result.station),
                "Associate task station",
            )?;
        }
        result.desktop = CreateDesktopExW(
            wide(identifier).as_ptr(),
            null(),
            null(),
            0,
            GENERIC_ALL,
            &security,
            512,
            null(),
        );
        if result.desktop.is_null() {
            return Err(format!(
                "Create private desktop: {}",
                std::io::Error::last_os_error()
            )
            .into());
        }
        if result.station != result.original_station {
            win(
                SetProcessWindowStation(result.original_station),
                "Restore helper station",
            )?;
        }
        win(
            SetThreadDesktop(result.original_desktop),
            "Restore helper desktop",
        )?;
        result.name = wide(format!("{}\\{}", result.station_name, identifier));
        println!(
            "private_desktop_station={:?} name={} visible={} default_desktop_acl_modified=false",
            result.choice, result.station_name, result.station_visible
        );
        Ok(result)
    }
}
