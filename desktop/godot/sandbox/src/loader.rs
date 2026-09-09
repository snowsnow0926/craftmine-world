// Bounded diagnostics for the one child created by this fixed probe; never attach.
use super::{win, Result};
use std::time::{Duration, Instant};
use windows_sys::Win32::{Foundation::*, Storage::FileSystem::*, System::Diagnostics::Debug::*};

unsafe fn image_name(file: HANDLE) {
    if file.is_null() || file == INVALID_HANDLE_VALUE {
        return;
    }
    let mut name = [0u16; 2048];
    let length = GetFinalPathNameByHandleW(file, name.as_mut_ptr(), name.len() as u32, 0) as usize;
    if length > 0 && length < name.len() {
        println!(
            "loader_image={:?}",
            String::from_utf16_lossy(&name[..length])
        );
    }
    CloseHandle(file);
}

pub unsafe fn trace(process: HANDLE, pid: u32) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut count = 0;
    loop {
        if Instant::now() >= deadline || count >= 2048 {
            return Err("Loader trace exceeded fixed bounds".into());
        }
        let mut event: DEBUG_EVENT = std::mem::zeroed();
        if WaitForDebugEventEx(&mut event, 1000) == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(121) {
                continue;
            }
            return Err(error.into());
        }
        count += 1;
        if event.dwProcessId != pid {
            return Err("Unexpected debug process identity".into());
        }
        let mut status = DBG_CONTINUE;
        let mut exited = false;
        match event.dwDebugEventCode {
            CREATE_PROCESS_DEBUG_EVENT => image_name(event.u.CreateProcessInfo.hFile),
            LOAD_DLL_DEBUG_EVENT => image_name(event.u.LoadDll.hFile),
            EXCEPTION_DEBUG_EVENT => {
                let info = event.u.Exception;
                let code = info.ExceptionRecord.ExceptionCode as u32;
                println!(
                    "loader_exception={code:#x} first_chance={} address={:?}",
                    info.dwFirstChance, info.ExceptionRecord.ExceptionAddress
                );
                // Only consume the debugger's initial breakpoint; preserve actual faults.
                if code != 0x80000003 {
                    status = DBG_EXCEPTION_NOT_HANDLED;
                }
            }
            OUTPUT_DEBUG_STRING_EVENT => {
                let info = event.u.DebugString;
                let width = if info.fUnicode != 0 { 2 } else { 1 };
                let length = (info.nDebugStringLength as usize * width).min(8192);
                let mut data = vec![0u8; length];
                let mut read = 0;
                if ReadProcessMemory(
                    process,
                    info.lpDebugStringData.cast(),
                    data.as_mut_ptr().cast(),
                    length,
                    &mut read,
                ) != 0
                {
                    data.truncate(read);
                    let value = if width == 2 {
                        String::from_utf16_lossy(
                            &data
                                .chunks_exact(2)
                                .map(|v| u16::from_le_bytes([v[0], v[1]]))
                                .collect::<Vec<_>>(),
                        )
                    } else {
                        String::from_utf8_lossy(&data).into_owned()
                    };
                    println!("loader_debug={value:?}");
                } else {
                    println!(
                        "loader_debug_read_error={}",
                        std::io::Error::last_os_error()
                    );
                }
            }
            EXIT_PROCESS_DEBUG_EVENT => {
                println!("loader_exit={:#x}", event.u.ExitProcess.dwExitCode);
                exited = true;
            }
            _ => {}
        }
        win(
            ContinueDebugEvent(event.dwProcessId, event.dwThreadId, status),
            "Continue fixed child debug event",
        )?;
        if exited {
            return Ok(());
        }
    }
}
