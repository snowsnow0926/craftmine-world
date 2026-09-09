//! Current-user Windows DPAPI protection for the existing AES envelope key.
//! No LOCAL_MACHINE flag, UI prompt, copied plaintext key or fallback downgrade.
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::{rng, Rng};
use std::{fs, os::windows::ffi::OsStrExt, path::Path, ptr};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

const PREFIX: &[u8] = b"CRAFTMINE-DPAPI-KEY/1\n";
const ENTROPY: &[u8] = b"craftmine.world:host-secret-key:1";

fn crypt(bytes: &[u8], protect: bool) -> Result<Vec<u8>> {
    if bytes.len() > 65536 {
        return Err(anyhow!("SECRET_KEY_TOO_LARGE"));
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: ENTROPY.len() as u32,
        pbData: ENTROPY.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    // Windows allocates output with LocalAlloc. Every successful path copies
    // the bounded bytes and releases that allocation with LocalFree.
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &input,
                ptr::null(),
                &entropy,
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                &entropy,
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err(anyhow!("SECRET_DPAPI_UNAVAILABLE"));
    }
    if output.pbData.is_null() || output.cbData > 65536 {
        if !output.pbData.is_null() {
            unsafe {
                LocalFree(output.pbData.cast());
            }
        }
        return Err(anyhow!("SECRET_DPAPI_INVALID_RESULT"));
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(result)
}

pub(super) fn replace_file(source: &Path, target: &Path) -> Result<()> {
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(anyhow!("SECRET_ATOMIC_REPLACE_FAILED"));
    }
    Ok(())
}

pub(super) fn load_or_create_key(dir: &Path) -> Result<[u8; 32]> {
    load_with(dir, |bytes| crypt(bytes, true), |bytes| crypt(bytes, false))
}

fn load_with(
    dir: &Path,
    protect: impl Fn(&[u8]) -> Result<Vec<u8>>,
    unprotect: impl Fn(&[u8]) -> Result<Vec<u8>>,
) -> Result<[u8; 32]> {
    let path = dir.join(".machine-key");
    let old = if path.exists() {
        if fs::metadata(&path)?.len() > 65536 {
            return Err(anyhow!("SECRET_KEY_TOO_LARGE"));
        }
        Some(fs::read(&path)?)
    } else {
        if fs::read_dir(dir)?.any(|entry| {
            entry
                .ok()
                .is_some_and(|entry| entry.path().extension().is_some_and(|ext| ext == "bin"))
        }) {
            return Err(anyhow!("SECRET_KEY_MISSING_FOR_EXISTING_CIPHERTEXT"));
        }
        None
    };
    if let Some(bytes) = &old {
        if let Some(encoded) = bytes.strip_prefix(PREFIX) {
            let decrypted = unprotect(&B64.decode(encoded)?)?;
            return decrypted
                .try_into()
                .map_err(|_| anyhow!("SECRET_KEY_INVALID_LENGTH"));
        }
        if bytes.len() != 32 {
            return Err(anyhow!("SECRET_KEY_UNKNOWN_FORMAT"));
        }
    }
    let mut key = [0u8; 32];
    if let Some(bytes) = old {
        key.copy_from_slice(&bytes);
    } else {
        rng().fill_bytes(&mut key);
    }
    let protected = protect(&key)?;
    if unprotect(&protected)?.as_slice() != key {
        return Err(anyhow!("SECRET_MIGRATION_VERIFY_FAILED"));
    }
    let mut envelope = PREFIX.to_vec();
    envelope.extend_from_slice(B64.encode(&protected).as_bytes());
    super::atomic_write(&path, &envelope)?;
    // No additional plaintext copy is retained. Atomic replacement keeps the
    // previous valid envelope if verification or replacement fails.
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_current_user_dpapi_round_trip_and_restart() {
        let dir = tempfile::tempdir().unwrap();
        let key = load_or_create_key(dir.path()).unwrap();
        let bytes = fs::read(dir.path().join(".machine-key")).unwrap();
        assert!(bytes.starts_with(PREFIX));
        assert!(!bytes.windows(32).any(|window| window == key));
        assert_eq!(load_or_create_key(dir.path()).unwrap(), key);
    }
    #[test]
    fn protection_failure_keeps_legacy_key_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let key = [13u8; 32];
        fs::write(dir.path().join(".machine-key"), key).unwrap();
        assert!(load_with(
            dir.path(),
            |_| Err(anyhow!("SIMULATED_PROTECT_FAILURE")),
            |b| Ok(b.to_vec())
        )
        .is_err());
        assert_eq!(fs::read(dir.path().join(".machine-key")).unwrap(), key);
    }
    #[test]
    fn migration_verification_failure_never_overwrites_legacy_key() {
        let dir = tempfile::tempdir().unwrap();
        let key = [17u8; 32];
        fs::write(dir.path().join(".machine-key"), key).unwrap();
        assert!(load_with(dir.path(), |b| Ok(b.to_vec()), |_| Ok(vec![0; 32])).is_err());
        assert_eq!(fs::read(dir.path().join(".machine-key")).unwrap(), key);
    }
    #[test]
    fn simulated_other_user_failure_preserves_protected_envelope() {
        let dir = tempfile::tempdir().unwrap();
        load_or_create_key(dir.path()).unwrap();
        let before = fs::read(dir.path().join(".machine-key")).unwrap();
        assert!(load_with(
            dir.path(),
            |b| Ok(b.to_vec()),
            |_| Err(anyhow!("SIMULATED_OTHER_USER"))
        )
        .is_err());
        assert_eq!(fs::read(dir.path().join(".machine-key")).unwrap(), before);
    }
    #[test]
    fn corrupt_envelope_is_unavailable_without_overwrite_or_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = dir.path().join("secrets");
        fs::create_dir(&secrets).unwrap();
        fs::write(
            secrets.join(".machine-key"),
            b"CRAFTMINE-DPAPI-KEY/1\ninvalid",
        )
        .unwrap();
        let store = super::super::SecretStore::open(dir.path()).unwrap();
        assert_eq!(store.status(), "unavailable");
        assert!(store.set("fixture", "synthetic").is_err());
        assert_eq!(
            fs::read(secrets.join(".machine-key")).unwrap(),
            b"CRAFTMINE-DPAPI-KEY/1\ninvalid"
        );
    }

    #[test]
    fn missing_key_never_replaces_existing_ciphertext_with_a_new_key() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = dir.path().join("secrets");
        fs::create_dir(&secrets).unwrap();
        fs::write(secrets.join("existing.bin"), b"old ciphertext").unwrap();
        let store = super::super::SecretStore::open(dir.path()).unwrap();
        assert_eq!(store.status(), "unavailable");
        assert!(!secrets.join(".machine-key").exists());
        assert_eq!(
            fs::read(secrets.join("existing.bin")).unwrap(),
            b"old ciphertext"
        );
    }
}
