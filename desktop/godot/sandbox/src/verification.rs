//! Evidence read by the broker from Windows before the initial thread resumes.
//! None of these fields is accepted from a project, page, stdout or request.
use crate::{report::sid_to_string, win, Handle, Result};
use serde::Serialize;
use std::{path::Path, ptr::null_mut};
use windows_sys::Win32::{Foundation::*, Security::*, System::{Threading::*, JobObjects::*}};

pub const POLICY_VERSION: &str = "craftmine.windows.lpac-registry.v1";
pub const MEMORY_BYTES: usize = 4usize * 1024 * 1024 * 1024;
pub const REQUIRED_JOB_FLAGS: u32 = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessVerification {
    pub verified: bool,
    pub policy_version: String,
    pub pid: u32,
    pub creation_time_filetime: String,
    pub image_path: String,
    pub app_container_sid: String,
    pub capability_sids: Vec<String>,
    pub integrity_rid: u32,
    pub is_app_container: bool,
    pub lpac_query_value: Option<u32>,
    pub lpac_query_error: Option<u32>,
    pub lpac_creation_attribute: bool,
    pub job_membership_verified: bool,
    pub job_limit_flags: u32,
    pub active_process_limit: u32,
    pub process_memory_bytes: u64,
    pub verified_before_resume: bool,
    pub resume_previous_count: u32,
}

unsafe fn token_info(token: HANDLE, class: TOKEN_INFORMATION_CLASS) -> Result<Vec<usize>> {
    let mut bytes = 0;
    GetTokenInformation(token, class, null_mut(), 0, &mut bytes);
    if bytes == 0 || bytes > 65536 { return Err(format!("Invalid token query size for {class}: {bytes}").into()); }
    let mut storage = vec![0usize; (bytes as usize + std::mem::size_of::<usize>() - 1) / std::mem::size_of::<usize>()];
    win(GetTokenInformation(token, class, storage.as_mut_ptr().cast(), bytes, &mut bytes), "Query suspended process token")?;
    Ok(storage)
}

/// Called while the only initial thread remains suspended. The supplied job
/// is the exact unnamed handle included in the creation-time JOB_LIST.
pub unsafe fn verify(process: HANDLE, job: HANDLE, expected_sid: PSID,
    expected_registry_sid: PSID, image: &Path, pid: u32) -> Result<ProcessVerification> {
    let mut token = null_mut();
    win(OpenProcessToken(process, TOKEN_QUERY, &mut token), "Open suspended process token")?;
    let token = Handle(token);
    let container_info = token_info(token.0, TokenIsAppContainer)?;
    let is_container = *(container_info.as_ptr() as *const u32);
    if is_container != 1 { return Err("Suspended process is not AppContainer".into()); }
    let package = token_info(token.0, TokenAppContainerSid)?;
    let package = &*(package.as_ptr() as *const TOKEN_APPCONTAINER_INFORMATION);
    if EqualSid(package.TokenAppContainer, expected_sid) == 0 { return Err("Suspended package SID mismatch".into()); }
    let package_sid = sid_to_string(package.TokenAppContainer)?;
    let groups = token_info(token.0, TokenCapabilities)?;
    let groups = &*(groups.as_ptr() as *const TOKEN_GROUPS);
    if groups.GroupCount != 1 || EqualSid(groups.Groups[0].Sid, expected_registry_sid) == 0 || groups.Groups[0].Attributes != 4 {
        return Err("Suspended capability set is not exactly enabled registryRead".into());
    }
    let capabilities = vec![sid_to_string(groups.Groups[0].Sid)?];
    let label = token_info(token.0, TokenIntegrityLevel)?;
    let label = &*(label.as_ptr() as *const TOKEN_MANDATORY_LABEL);
    let count = *GetSidSubAuthorityCount(label.Label.Sid);
    if count == 0 { return Err("Missing integrity label".into()); }
    let integrity = *GetSidSubAuthority(label.Label.Sid, (count - 1) as u32);
    if integrity != 0x1000 { return Err(format!("Expected Low integrity, got {integrity:#x}").into()); }
    let mut lpac_value = 0u32; let mut length = 0;
    let lpac_ok = GetTokenInformation(token.0, TokenIsLessPrivilegedAppContainer, (&mut lpac_value as *mut u32).cast(), 4, &mut length);
    let lpac_error = if lpac_ok == 0 { Some(GetLastError()) } else { None };
    if lpac_ok != 0 && lpac_value != 1 { return Err("Supported LPAC query returned false".into()); }
    if lpac_error.is_some_and(|error| error != 87) { return Err(format!("Unexpected LPAC query failure: {lpac_error:?}").into()); }
    let mut in_job = 0;
    win(IsProcessInJob(process, job, &mut in_job), "Verify exact Job membership")?;
    if in_job != 1 { return Err("Suspended process is not in the creation-time Job".into()); }
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
    win(QueryInformationJobObject(job, JobObjectExtendedLimitInformation, (&mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
        std::mem::size_of_val(&limits) as u32, null_mut()), "Verify actual Job limits")?;
    if limits.BasicLimitInformation.LimitFlags != REQUIRED_JOB_FLAGS || limits.BasicLimitInformation.ActiveProcessLimit != 1 || limits.ProcessMemoryLimit != MEMORY_BYTES {
        return Err("Actual Job limits differ from the fixed policy".into());
    }
    let mut path = vec![0u16; 32768]; let mut path_length = path.len() as u32;
    win(QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut path_length), "Verify suspended executable path")?;
    let actual_path = String::from_utf16(&path[..path_length as usize])?;
    if Path::new(&actual_path).canonicalize()? != image.canonicalize()? { return Err("Suspended process image path mismatch".into()); }
    let mut created = FILETIME::default(); let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default(); let mut user = FILETIME::default();
    win(GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user), "Read process creation time")?;
    Ok(ProcessVerification { verified: true, policy_version: POLICY_VERSION.into(), pid,
        creation_time_filetime: (((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64).to_string(),
        image_path: actual_path, app_container_sid: package_sid, capability_sids: capabilities,
        integrity_rid: integrity, is_app_container: true, lpac_query_value: if lpac_ok != 0 { Some(lpac_value) } else { None },
        lpac_query_error: lpac_error, lpac_creation_attribute: true, job_membership_verified: true,
        job_limit_flags: limits.BasicLimitInformation.LimitFlags, active_process_limit: 1,
        process_memory_bytes: limits.ProcessMemoryLimit as u64, verified_before_resume: true,
        resume_previous_count: 0 })
}
