// Creates only a task desktop; existing station ACLs are never modified.
use super::{wide, win, Handle, Result};
use std::ptr::{null, null_mut};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    System::{StationsAndDesktops::*, Threading::*},
    UI::WindowsAndMessaging::{WINSTA_CREATEDESKTOP, WINSTA_READATTRIBUTES, WSF_VISIBLE},
};

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

unsafe fn descriptor(task_sid: PSID) -> Result<Descriptor> {
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
    // Protected ACL and low integrity label apply only to new private USER objects.
    let sddl = wide(format!(
        "D:P(A;;GA;;;SY)(A;;GA;;;{})(A;;0x000200c7;;;{})S:(ML;;NW;;;LW)",
        sid_string(user.User.Sid)?,
        sid_string(task_sid)?
    ));
    let mut sd = null_mut();
    win(
        ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut sd, null_mut()),
        "Private object descriptor",
    )?;
    Ok(Descriptor(sd))
}

pub struct PrivateDesktop {
    station: HWINSTA,
    desktop: HDESK,
    original_station: HWINSTA,
    original_desktop: HDESK,
    pub name: Vec<u16>,
}
impl Drop for PrivateDesktop {
    fn drop(&mut self) {
        unsafe {
            // Association restoration affects this console helper only, never the input desktop.
            let restored = SetProcessWindowStation(self.original_station) != 0
                && SetThreadDesktop(self.original_desktop) != 0;
            let desktop_closed = self.desktop.is_null() || CloseDesktop(self.desktop) != 0;
            let station_closed = self.station.is_null() || CloseWindowStation(self.station) != 0;
            eprintln!("private_desktop_cleanup restored={restored} desktop_closed={desktop_closed} station_closed={station_closed}");
        }
    }
}
impl PrivateDesktop {
    pub unsafe fn create(identifier: &str, task_sid: PSID) -> Result<Self> {
        let sd = descriptor(task_sid)?;
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
            name: Vec::new(),
        };
        // Standard-user fallback used by Chromium: open the logon session's
        // noninteractive station with only the rights needed for a new desktop.
        // lpSecurityDescriptor affects creation only; no ACL setter touches the station.
        result.station = CreateWindowStationW(
            null(),
            0,
            (WINSTA_READATTRIBUTES | WINSTA_CREATEDESKTOP) as u32,
            &security,
        );
        if result.station.is_null() {
            return Err(format!(
                "Create private station: {}",
                std::io::Error::last_os_error()
            )
            .into());
        }
        // Fail closed before creating a desktop if Windows returns a visible station.
        let mut flags = USEROBJECTFLAGS::default();
        win(
            GetUserObjectInformationW(
                result.station,
                UOI_FLAGS,
                (&mut flags as *mut USEROBJECTFLAGS).cast(),
                std::mem::size_of_val(&flags) as u32,
                null_mut(),
            ),
            "Read station visibility",
        )?;
        if flags.dwFlags & WSF_VISIBLE as u32 != 0 {
            return Err("Refusing visible station".into());
        }
        let mut station_name = [0u16; 256];
        win(
            GetUserObjectInformationW(
                result.station,
                UOI_NAME,
                station_name.as_mut_ptr().cast(),
                std::mem::size_of_val(&station_name) as u32,
                null_mut(),
            ),
            "Read new station name",
        )?;
        let end = station_name
            .iter()
            .position(|c| *c == 0)
            .ok_or("Missing station terminator")?;
        let name = String::from_utf16(&station_name[..end])?;
        if name.eq_ignore_ascii_case("WinSta0") {
            return Err("Refusing interactive window station".into());
        }
        result.name = wide(format!("{name}\\{identifier}"));
        win(
            SetProcessWindowStation(result.station),
            "Associate private station",
        )?;
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
        let mut flags = USEROBJECTFLAGS::default();
        win(
            GetUserObjectInformationW(
                result.station,
                UOI_FLAGS,
                (&mut flags as *mut USEROBJECTFLAGS).cast(),
                std::mem::size_of_val(&flags) as u32,
                null_mut(),
            ),
            "Read private station flags",
        )?;
        if flags.dwFlags & WSF_VISIBLE as u32 != 0 {
            return Err("Private station unexpectedly visible".into());
        }
        win(
            SetProcessWindowStation(result.original_station),
            "Restore helper station",
        )?;
        win(
            SetThreadDesktop(result.original_desktop),
            "Restore helper desktop",
        )?;
        println!("private_station_visible=false default_desktop_acl_modified=false");
        Ok(result)
    }
}
