//! Scoped file permissions for task directories and integrity inspection.
//!
//! Only directories created by the current task are ever modified. Existing
//! workspace, desktop and system ACLs are never touched.
use crate::{wide, win, Result};
use std::path::Path;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::{
    Authorization::*, IsValidSid, PSID, TOKEN_MANDATORY_LABEL, TokenIntegrityLevel, *,
};
/// Grants `rights` to `sid` on a directory this process just created.
///
/// The caller must pass a newly created task directory, never a workspace root.
pub unsafe fn grant_new_directory(path: &Path, sid: PSID, rights: u32) -> Result<()> {
    let name = wide(path);
    let mut old_acl = null_mut();
    let mut descriptor = null_mut();
    let code = GetNamedSecurityInfoW(
        name.as_ptr(),
        SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION,
        null_mut(),
        null_mut(),
        &mut old_acl,
        null_mut(),
        &mut descriptor,
    );
    if code != 0 {
        return Err(format!("Read new directory ACL: {code}").into());
    }
    let access = EXPLICIT_ACCESS_W {
        grfAccessPermissions: rights,
        grfAccessMode: GRANT_ACCESS,
        grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.cast(),
        },
    };
    let mut acl = null_mut();
    let code = SetEntriesInAclW(1, &access, old_acl, &mut acl);
    LocalFree(descriptor);
    if code != 0 {
        return Err(format!("Compose new directory ACL: {code}").into());
    }
    let code = SetNamedSecurityInfoW(
        name.as_ptr(),
        SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION,
        null_mut(),
        null_mut(),
        acl,
        null(),
    );
    LocalFree(acl.cast());
    if code != 0 {
        return Err(format!("Grant task SID on new directory: {code}").into());
    }
    Ok(())
}

/// Reads (never writes) the integrity label of a newly created work directory.
///
/// Microsoft's AppContainer model allows package-authorized access at Medium or
/// lower integrity, so anything above Medium is rejected instead of relabelled.
pub unsafe fn inspect_new_work_label(path: &Path) -> Result<u32> {
    let mut sacl = null_mut();
    let mut sd = null_mut();
    let code = GetNamedSecurityInfoW(
        wide(path).as_ptr(),
        SE_FILE_OBJECT,
        LABEL_SECURITY_INFORMATION,
        null_mut(),
        null_mut(),
        null_mut(),
        &mut sacl,
        &mut sd,
    );
    if code != 0 {
        return Err(format!("Read new work integrity label: {code}").into());
    }
    let result = (|| -> Result<u32> {
        let mut level = 0x2000u32; // Unlabelled objects default to Medium integrity.
        if !sacl.is_null() {
            for i in 0..(*sacl).AceCount as u32 {
                let mut ace = null_mut();
                win(GetAce(sacl, i, &mut ace), "Read integrity ACE")?;
                let header = &*(ace as *const ACE_HEADER);
                if header.AceType == 0x11 {
                    let label = &*(ace as *const SYSTEM_MANDATORY_LABEL_ACE);
                    let sid = (&label.SidStart as *const u32).cast_mut().cast();
                    if IsValidSid(sid) == 0 {
                        return Err("Invalid integrity SID".into());
                    }
                    let count = *GetSidSubAuthorityCount(sid);
                    if count == 0 {
                        return Err("Missing integrity RID".into());
                    }
                    level = *GetSidSubAuthority(sid, (count - 1) as u32);
                    if level > 0x2000 {
                        return Err("Work integrity exceeds Medium".into());
                    }
                }
            }
        }
        Ok(level)
    })();
    LocalFree(sd);
    result
}

/// Reads the integrity RID of a token (used for parent/child reporting).
pub unsafe fn token_integrity_rid(token: windows_sys::Win32::Foundation::HANDLE) -> Result<u32> {
    let mut bytes = 0;
    windows_sys::Win32::Security::GetTokenInformation(
        token,
        TokenIntegrityLevel,
        null_mut(),
        0,
        &mut bytes,
    );
    if bytes == 0 {
        return Err("Read token integrity size failed".into());
    }
    let mut storage = vec![0usize; (bytes as usize + 7) / 8];
    win(
        windows_sys::Win32::Security::GetTokenInformation(
            token,
            TokenIntegrityLevel,
            storage.as_mut_ptr().cast(),
            bytes,
            &mut bytes,
        ),
        "Read token integrity",
    )?;
    let label = &*(storage.as_ptr() as *const TOKEN_MANDATORY_LABEL);
    if IsValidSid(label.Label.Sid) == 0 {
        return Err("Invalid token integrity SID".into());
    }
    let count = *GetSidSubAuthorityCount(label.Label.Sid);
    if count == 0 {
        return Err("Missing token integrity RID".into());
    }
    Ok(*GetSidSubAuthority(label.Label.Sid, (count - 1) as u32))
}
