#![cfg(windows)]
mod desktop;
mod loader;
// Fixed, trusted prototype only. No arbitrary project or command execution API.
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::Read,
    net::TcpListener,
    os::windows::{ffi::OsStrExt, io::AsRawHandle},
    path::{Path, PathBuf},
    ptr::{null, null_mut},
    time::{SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, Isolation::*, *},
    Storage::FileSystem::*,
    System::{JobObjects::*, Threading::*},
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const PINNED_GODOT: &str =
    r"D:\Craftmine World\desktop\build\godot\4.7.2-stable\editor\Godot_v4.7.2-stable_win64.exe";
const GODOT_SHA256: &str = "ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424";
fn wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
fn win(ok: i32, label: &str) -> Result<()> {
    if ok == 0 {
        Err(format!("{label}: {}", std::io::Error::last_os_error()).into())
    } else {
        Ok(())
    }
}
struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                CloseHandle(self.0);
            }
        }
    }
}
struct Profile {
    name: Vec<u16>,
    sid: PSID,
}
impl Drop for Profile {
    fn drop(&mut self) {
        unsafe {
            let result = DeleteAppContainerProfile(self.name.as_ptr());
            eprintln!("profile_cleanup_hresult={result:#x}");
            FreeSid(self.sid);
        }
    }
}
struct Attributes {
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
    _storage: Vec<usize>,
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.pointer);
        }
    }
}
unsafe fn grant_new_directory(path: &Path, sid: PSID, rights: u32) -> Result<()> {
    // Caller supplies only directories just created by this invocation, never a workspace root.
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
unsafe fn inspect_new_work_label(path: &Path) -> Result<()> {
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
    let result = (|| -> Result<()> {
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
        println!("work_integrity_rid={level} label_modified=false");
        Ok(())
    })();
    LocalFree(sd);
    result
}
unsafe fn launch(
    profile: &Profile,
    desktop: &desktop::PrivateDesktop,
    executable: &Path,
    args: &[String],
    work: &Path,
    log: &Path,
    diagnose: bool,
) -> Result<u32> {
    let job = Handle(CreateJobObjectW(null(), null()));
    if job.0.is_null() {
        return Err("CreateJobObjectW failed".into());
    }
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
    limits.ProcessMemoryLimit = 512 * 1024 * 1024;
    win(
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&limits) as u32,
        ),
        "SetInformationJobObject",
    )?;
    let output = fs::File::create(log)?;
    let input = fs::File::open("NUL")?;
    let handles = [output.as_raw_handle(), input.as_raw_handle()];
    for handle in handles {
        win(
            SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT),
            "SetHandleInformation",
        )?;
    }
    let mut bytes = 0;
    InitializeProcThreadAttributeList(null_mut(), 4, 0, &mut bytes);
    let mut storage =
        vec![0usize; (bytes + std::mem::size_of::<usize>() - 1) / std::mem::size_of::<usize>()];
    let pointer = storage.as_mut_ptr().cast();
    win(
        InitializeProcThreadAttributeList(pointer, 4, 0, &mut bytes),
        "InitializeProcThreadAttributeList",
    )?;
    let attributes = Attributes {
        pointer,
        _storage: storage,
    };
    let capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: profile.sid,
        Capabilities: null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };
    let child_policy: u32 = 1; // PROCESS_CREATION_CHILD_PROCESS_RESTRICTED.
    for (attribute, value, size) in [
        (
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
            (&capabilities as *const SECURITY_CAPABILITIES).cast(),
            std::mem::size_of_val(&capabilities),
        ),
        (
            PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,
            (&child_policy as *const u32).cast(),
            std::mem::size_of_val(&child_policy),
        ),
        (
            PROC_THREAD_ATTRIBUTE_JOB_LIST,
            (&job.0 as *const HANDLE).cast(),
            std::mem::size_of::<HANDLE>(),
        ),
        (
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            handles.as_ptr().cast(),
            std::mem::size_of_val(&handles),
        ),
    ] {
        win(
            UpdateProcThreadAttribute(
                attributes.pointer,
                0,
                attribute as usize,
                value,
                size,
                null_mut(),
                null(),
            ),
            "UpdateProcThreadAttribute",
        )?;
    }
    let mut startup: STARTUPINFOEXW = std::mem::zeroed();
    startup.StartupInfo.cb = std::mem::size_of_val(&startup) as u32;
    startup.StartupInfo.lpDesktop = desktop.name.as_ptr().cast_mut();
    startup.lpAttributeList = attributes.pointer;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = handles[1];
    startup.StartupInfo.hStdOutput = handles[0];
    startup.StartupInfo.hStdError = handles[0];
    let quote = |value: &str| -> Result<String> {
        if value.contains('"') || value.ends_with('\\') {
            return Err("Unsupported fixed argument".into());
        }
        Ok(format!("\"{value}\""))
    };
    let mut command = quote(&executable.to_string_lossy())?;
    for arg in args {
        command.push(' ');
        command.push_str(&quote(arg)?);
    }
    let application = wide(executable);
    let mut command = wide(command);
    let cwd = wide(work);
    let mut environment = Vec::<u16>::new();
    let system_root = env::var("SystemRoot")?;
    for (name, value) in [
        ("APPDATA", work.to_string_lossy().into_owned()),
        ("LOCALAPPDATA", work.to_string_lossy().into_owned()),
        ("PATH", format!("{system_root}\\System32")),
        ("SystemRoot", system_root.clone()),
        ("TEMP", work.to_string_lossy().into_owned()),
        ("TMP", work.to_string_lossy().into_owned()),
        ("USERPROFILE", work.to_string_lossy().into_owned()),
        ("WINDIR", system_root),
    ] {
        environment.extend(wide(format!("{name}={value}")));
    }
    environment.push(0);
    let mut information: PROCESS_INFORMATION = std::mem::zeroed();
    win(
        CreateProcessW(
            application.as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT
                | CREATE_NO_WINDOW
                | CREATE_UNICODE_ENVIRONMENT
                | if diagnose { DEBUG_ONLY_THIS_PROCESS } else { 0 },
            environment.as_ptr().cast(),
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut information,
        ),
        "CreateProcessW AppContainer",
    )?;
    let process = Handle(information.hProcess);
    let _thread = Handle(information.hThread);
    let mut token = null_mut();
    win(
        OpenProcessToken(process.0, TOKEN_QUERY, &mut token),
        "OpenProcessToken",
    )?;
    let token = Handle(token);
    let mut is_container = 0u32;
    let mut length = 0;
    win(
        GetTokenInformation(
            token.0,
            TokenIsAppContainer,
            (&mut is_container as *mut u32).cast(),
            4,
            &mut length,
        ),
        "TokenIsAppContainer",
    )?;
    if is_container != 1 {
        TerminateJobObject(job.0, 91);
        return Err("Child token is not AppContainer".into());
    }
    if diagnose {
        loader::trace(process.0, information.dwProcessId)?;
    }
    if WaitForSingleObject(process.0, 15000) != WAIT_OBJECT_0 {
        TerminateJobObject(job.0, 92);
        WaitForSingleObject(process.0, 5000);
        return Err("AppContainer task exceeded 15 second limit".into());
    }
    let mut exit = 0;
    win(
        GetExitCodeProcess(process.0, &mut exit),
        "GetExitCodeProcess",
    )?;
    println!("appcontainer=true log={} exit={exit}", log.display());
    Ok(exit)
}
fn run() -> Result<()> {
    let args = env::args().collect::<Vec<_>>();
    if args.len() != 1 {
        return Err("This fixed prototype accepts no project or command arguments".into());
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let parent = manifest.join("out");
    fs::create_dir_all(&parent)?;
    let identifier = format!(
        "craftmine.gd0.probe.{}.{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis()
    );
    let root = parent.join(&identifier);
    fs::create_dir(&root)?;
    let bin = root.join("bin");
    let work = root.join("work");
    let denied = root.join("denied");
    for path in [&bin, &work, &denied] {
        fs::create_dir(path)?;
    }
    let sentinel = denied.join("synthetic-sentinel.txt");
    fs::write(&sentinel, "synthetic-private-sentinel")?;
    let mut source = fs::File::open(PINNED_GODOT)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = source.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    if hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
        != GODOT_SHA256
    {
        return Err("Pinned Godot hash mismatch".into());
    }
    let engine = bin.join("godot.exe");
    fs::copy(PINNED_GODOT, &engine)?;
    fs::write(bin.join("_sc_"), "")?;
    let probe = bin.join("boundary-probe.exe");
    fs::copy(
        env::current_exe()?.with_file_name("boundary-probe.exe"),
        &probe,
    )?;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    // Positive control: the fixed host endpoint exists and accepts a connection.
    let control = std::net::TcpStream::connect(listener.local_addr()?)?;
    let accepted = listener.accept()?;
    drop((control, accepted));
    println!("host_loopback_control=passed");
    listener.set_nonblocking(true)?;
    unsafe {
        let name = wide(&identifier);
        let mut sid = null_mut();
        let code = CreateAppContainerProfile(
            name.as_ptr(),
            name.as_ptr(),
            wide("Craftmine fixed Godot isolation probe").as_ptr(),
            null(),
            0,
            &mut sid,
        );
        if code < 0 {
            return Err(format!(
                "CreateAppContainerProfile HRESULT {code:#x}; no existing profile reused"
            )
            .into());
        }
        let profile = Profile { name, sid };
        let desktop = desktop::PrivateDesktop::create(&identifier, sid)?;
        grant_new_directory(&bin, sid, FILE_GENERIC_READ | FILE_GENERIC_EXECUTE)?;
        grant_new_directory(
            &work,
            sid,
            FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE,
        )?;
        inspect_new_work_label(&work)?;
        let native_exit = launch(
            &profile,
            &desktop,
            &probe,
            &[
                "--native-probe".into(),
                work.to_string_lossy().into_owned(),
                sentinel.to_string_lossy().into_owned(),
                listener.local_addr()?.to_string(),
            ],
            &work,
            &root.join("native-probe.log"),
            true,
        )?;
        let native_output = fs::read_to_string(root.join("native-probe.log"))?;
        println!("{native_output}");
        if native_exit != 0 || !native_output.contains("native_boundary_probe=passed") {
            return Err("Native boundary probe failed; Godot was not started".into());
        }
        if listener.accept().is_ok() {
            return Err("Host observed an unexpected loopback connection".into());
        }
        if fs::read_to_string(&sentinel)? != "synthetic-private-sentinel" {
            return Err("Synthetic sentinel changed".into());
        }
        let godot_exit = launch(
            &profile,
            &desktop,
            &engine,
            &["--headless".into(), "--version".into()],
            &work,
            &root.join("godot-version.log"),
            false,
        )?;
        let version = fs::read_to_string(root.join("godot-version.log"))?;
        println!("{version}");
        if godot_exit != 0 || !version.contains("4.7.2.stable.official.ed1daf0bf") {
            return Err("Pinned Godot version probe failed".into());
        }
        fs::write(root.join("result.txt"),"native-boundary=passed\ngodot-version=passed\nisolation=AppContainer\nnot-verified=LPAC,import,addons,export,untrusted-projects,non-loopback-network,UI-boundary\n")?;
        println!("evidence={}", root.display());
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("PROBE_ERROR: {error}");
        std::process::exit(1);
    }
}
