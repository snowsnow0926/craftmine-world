//! Read-only identity and environment reporting for the boundary.
//!
//! Reports are used both by the parent (launch conditions) and by the child
//! (what the restricted token can actually see). Nothing here mutates state.
use crate::{win, Handle, Result};
use std::path::Path;
use std::ptr::null_mut;
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    System::{
        StationsAndDesktops::{
            GetProcessWindowStation, GetThreadDesktop, GetUserObjectInformationW,
            OpenWindowStationW, UOI_FLAGS, UOI_NAME, USEROBJECTFLAGS,
        },
        Threading::*,
    },
    UI::WindowsAndMessaging::{WSF_VISIBLE, WINSTA_ALL_ACCESS},
};

pub unsafe fn sid_to_string(sid: PSID) -> Result<String> {
    if sid.is_null() || IsValidSid(sid) == 0 {
        return Ok("<invalid>".into());
    }
    let mut value = null_mut();
    win(
        ConvertSidToStringSidW(sid, &mut value),
        "ConvertSidToStringSidW",
    )?;
    let mut length = 0;
    while *value.add(length) != 0 {
        length += 1;
    }
    let result = String::from_utf16(std::slice::from_raw_parts(value, length))?;
    LocalFree(value.cast());
    Ok(result)
}

unsafe fn token_query(token: HANDLE, class: TOKEN_INFORMATION_CLASS) -> Result<Vec<usize>> {
    let mut bytes = 0;
    GetTokenInformation(token, class, null_mut(), 0, &mut bytes);
    if bytes == 0 {
        return Err(format!("Token information {class} is unavailable").into());
    }
    let mut storage = vec![0usize; (bytes as usize + 7) / 8];
    win(
        GetTokenInformation(token, class, storage.as_mut_ptr().cast(), bytes, &mut bytes),
        "GetTokenInformation",
    )?;
    Ok(storage)
}

unsafe fn integrity_rid(token: HANDLE) -> Result<u32> {
    let storage = token_query(token, TokenIntegrityLevel)?;
    let label = &*(storage.as_ptr() as *const TOKEN_MANDATORY_LABEL);
    let count = *GetSidSubAuthorityCount(label.Label.Sid);
    if count == 0 {
        return Err("Missing integrity RID".into());
    }
    Ok(*GetSidSubAuthority(label.Label.Sid, (count - 1) as u32))
}

/// One-line description of the token that will own a restricted process.
pub unsafe fn token_report(token: HANDLE, prefix: &str) -> Result<Vec<String>> {
    let mut lines = Vec::new();
    let user = token_query(token, TokenUser)?;
    let user = &*(user.as_ptr() as *const TOKEN_USER);
    lines.push(format!(
        "{prefix}token_user={}",
        sid_to_string(user.User.Sid)?
    ));
    lines.push(format!(
        "{prefix}token_integrity_rid={}",
        integrity_rid(token)?
    ));
    let mut is_container = 0u32;
    let mut length = 0;
    win(
        GetTokenInformation(
            token,
            TokenIsAppContainer,
            (&mut is_container as *mut u32).cast(),
            4,
            &mut length,
        ),
        "TokenIsAppContainer",
    )?;
    lines.push(format!("{prefix}token_is_appcontainer={is_container}"));
    let elevated = token_query(token, TokenElevation)?;
    let elevated = &*(elevated.as_ptr() as *const TOKEN_ELEVATION);
    lines.push(format!(
        "{prefix}token_is_elevated={}",
        elevated.TokenIsElevated
    ));
    let mut session = 0u32;
    win(
        GetTokenInformation(
            token,
            TokenSessionId,
            (&mut session as *mut u32).cast(),
            4,
            &mut length,
        ),
        "TokenSessionId",
    )?;
    lines.push(format!("{prefix}token_session_id={session}"));
    let groups = token_query(token, TokenGroups)?;
    let groups = &*(groups.as_ptr() as *const TOKEN_GROUPS);
    let mut logon_sid = None;
    let mut sid_count = 0;
    for index in 0..groups.GroupCount {
        let entry = &*groups.Groups.as_ptr().add(index as usize);
        if entry.Sid.is_null() || IsValidSid(entry.Sid) == 0 {
            continue;
        }
        sid_count += 1;
        let value = sid_to_string(entry.Sid)?;
        if value.starts_with("S-1-5-5-") {
            logon_sid = Some(value);
        }
    }
    lines.push(format!("{prefix}token_group_count={sid_count}"));
    lines.push(format!(
        "{prefix}token_logon_sid={}",
        logon_sid.unwrap_or_else(|| "<none>".into())
    ));
    let restricted = token_query(token, TokenRestrictedSids)?;
    let restricted = &*(restricted.as_ptr() as *const TOKEN_GROUPS);
    let mut names = Vec::new();
    for index in 0..restricted.GroupCount {
        let entry = &*restricted.Groups.as_ptr().add(index as usize);
        names.push(sid_to_string(entry.Sid)?);
    }
    lines.push(format!(
        "{prefix}token_restricted_sids=[{}]",
        names.join(",")
    ));
    Ok(lines)
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
    let end = buffer.iter().position(|c| *c == 0).unwrap_or(0);
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

/// Window station and desktop the calling process is attached to.
pub unsafe fn station_report(prefix: &str) -> Result<Vec<String>> {
    let station = GetProcessWindowStation();
    let desktop = GetThreadDesktop(GetCurrentThreadId());
    Ok(vec![
        format!("{prefix}station_name={}", object_name(station)?),
        format!("{prefix}station_visible={}", object_visible(station)?),
        format!("{prefix}desktop_name={}", object_name(desktop)?),
    ])
}

/// Full identity report for the calling process (used by the child probe).
pub unsafe fn write_current_process_report(path: &Path) -> Result<()> {
    let mut lines = Vec::new();
    lines.push(format!("pid={}", GetCurrentProcessId()));
    lines.push(format!("cwd={}", std::env::current_dir()?.display()));
    let mut token = null_mut();
    win(
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
        "OpenProcessToken",
    )?;
    let token = Handle(token);
    lines.extend(token_report(token.0, "")?);
    lines.extend(station_report("")?);
    for name in ["SystemRoot", "TEMP", "USERPROFILE", "APPDATA"] {
        lines.push(format!(
            "env_{name}={}",
            std::env::var(name).unwrap_or_else(|_| "<unset>".into())
        ));
    }
    // Read-only probes of the interactive station: reporting only, never used
    // to make a security decision here.
    let name: Vec<u16> = "WinSta0\0".encode_utf16().collect();
    let station = OpenWindowStationW(name.as_ptr(), 0, WINSTA_ALL_ACCESS as u32);
    lines.push(format!(
        "open_winsta0_all_error={:?}",
        if station.is_null() {
            std::io::Error::last_os_error().raw_os_error()
        } else {
            None
        }
    ));
    if !station.is_null() {
        lines.push(format!(
            "open_winsta0_visible={}",
            object_visible(station).unwrap_or(false)
        ));
        windows_sys::Win32::System::StationsAndDesktops::CloseWindowStation(station);    }
    lines.push("child_report=ok".into());
    std::fs::write(path, lines.join("\n") + "\n")?;
    Ok(())
}

/// SDDL string of the calling process's user SID.
pub unsafe fn current_user_sid_string() -> Result<String> {
    let mut token = null_mut();
    win(
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
        "OpenProcessToken",
    )?;
    let token = Handle(token);
    let user = token_query(token.0, TokenUser)?;
    let user = &*(user.as_ptr() as *const TOKEN_USER);
    sid_to_string(user.User.Sid)
}

/// Convenience wrapper used by binaries that report the helper's conditions.
pub fn write_parent_report(path: &Path) -> Result<()> {
    unsafe { write_current_process_report(path) }
}
