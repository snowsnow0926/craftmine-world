// Bounded diagnostics for the one child created by this fixed probe; never attach.
use super::{win, Result};
use std::time::{Duration, Instant};
use windows_sys::Win32::{Foundation::*, Storage::FileSystem::*, System::Diagnostics::Debug::*};

// This path is used only by the independently pinned diagnostic broker. It
// never attaches to a discovered process and never changes the child policy.
pub unsafe fn trace_fault(process: HANDLE, pid: u32, output: &std::path::Path, work: &std::path::Path, timeout:Duration) -> Result<()> {
    use std::collections::BTreeMap;
    let deadline = Instant::now() + timeout.min(Duration::from_secs(120));
    let resource = crate::task::ResourceBudget::default();
    let mut next_sample = Instant::now();
    let mut modules = BTreeMap::<u64, String>::new();
    let mut initial_breakpoint = true;
    let mut captures = 0u32;
    let mut count = 0u32;
    // Debug-event process/thread handles are closed by ContinueDebugEvent on
    // their exit event. Only hFile is debugger-owned; do not double-close.
    let mut threads = BTreeMap::<u32, HANDLE>::new();
    while Instant::now() < deadline && count < 8192 {
        if Instant::now() >= next_sample {
            next_sample = Instant::now() + resource.sample_interval;
            let bytes = crate::task::directory_bytes(work, resource.work_bytes)?;
            let log_bytes = std::fs::metadata(output.join("task.log")).map(|m|m.len()).unwrap_or(0);
            if bytes > resource.work_bytes || log_bytes > resource.log_bytes { return Err("Diagnostic resource sample exceeded fixed broker budget".into()); }
        }
        let mut event: DEBUG_EVENT = std::mem::zeroed();
        if WaitForDebugEventEx(&mut event, 50) == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(121) { continue; }
            return Err(error.into());
        }
        count += 1;
        if event.dwProcessId != pid { return Err("Unexpected diagnostic child identity".into()); }
        let mut status = DBG_CONTINUE;
        let mut exited = false;
        match event.dwDebugEventCode {
            CREATE_PROCESS_DEBUG_EVENT => {
                let info = event.u.CreateProcessInfo;
                modules.insert(info.lpBaseOfImage as u64, fault_image(info.hFile));
                threads.insert(event.dwThreadId, info.hThread);
            },
            CREATE_THREAD_DEBUG_EVENT => { threads.insert(event.dwThreadId, event.u.CreateThread.hThread); },
            EXIT_THREAD_DEBUG_EVENT => { threads.remove(&event.dwThreadId); },
            LOAD_DLL_DEBUG_EVENT => {
                let info = event.u.LoadDll;
                modules.insert(info.lpBaseOfDll as u64, fault_image(info.hFile));
            },
            UNLOAD_DLL_DEBUG_EVENT => { modules.remove(&(event.u.UnloadDll.lpBaseOfDll as u64)); },
            EXCEPTION_DEBUG_EVENT => {
                let info = event.u.Exception;
                let code = info.ExceptionRecord.ExceptionCode as u32;
                let record = serde_json::json!({"kind":"exception","pid":pid,"threadId":event.dwThreadId,
                    "code":format!("{code:#x}"),"firstChance":info.dwFirstChance,
                    "address":format!("{:p}",info.ExceptionRecord.ExceptionAddress),
                    "parameters":&info.ExceptionRecord.ExceptionInformation[..(info.ExceptionRecord.NumberParameters as usize).min(15)]});
                fault_log(output, &record)?;
                status = diagnostic_exception_status(code, &mut initial_breakpoint);
                if status == DBG_EXCEPTION_NOT_HANDLED {
                    if matches!(code, 0xc0000005 | 0x80000003) && captures < 2 {
                        captures += 1;
                        let captured = match threads.get(&event.dwThreadId) {
                            Some(thread) => capture_fault(process,pid,event.dwThreadId,*thread,info,output,captures,&modules),
                            None => Err("Exception thread handle unavailable".into()),
                        };
                        if let Err(error) = captured { fault_log(output,&serde_json::json!({"kind":"capture-error","error":error.to_string()}))?; }
                    }
                }
            },
            EXIT_PROCESS_DEBUG_EVENT => {
                fault_log(output,&serde_json::json!({"kind":"exit","pid":pid,"code":event.u.ExitProcess.dwExitCode}))?;
                exited = true;
            },
            _ => {},
        }
        win(ContinueDebugEvent(event.dwProcessId,event.dwThreadId,status),"Continue owned diagnostic event")?;
        if exited { return Ok(()); }
    }
    Err("Owned native diagnostic event budget exceeded".into())
}

fn diagnostic_exception_status(code:u32, initial:&mut bool) -> i32 {
    if code == 0x80000003 && *initial { *initial=false; DBG_CONTINUE } else { DBG_EXCEPTION_NOT_HANDLED }
}
#[cfg(test)]
mod fault_policy_tests {
    use super::*;
    #[test]
    fn only_one_loader_breakpoint_is_consumed() {
        let mut initial=true;
        assert_eq!(diagnostic_exception_status(0xc0000005,&mut initial),DBG_EXCEPTION_NOT_HANDLED);
        assert!(initial);
        assert_eq!(diagnostic_exception_status(0x80000003,&mut initial),DBG_CONTINUE);
        assert_eq!(diagnostic_exception_status(0x80000003,&mut initial),DBG_EXCEPTION_NOT_HANDLED);
        assert_eq!(diagnostic_exception_status(0xc0000005,&mut initial),DBG_EXCEPTION_NOT_HANDLED);
    }
}

unsafe fn fault_image(file: HANDLE) -> String {
    if file.is_null() || file == INVALID_HANDLE_VALUE { return "unknown".into(); }
    let mut name = [0u16; 32768];
    let length = GetFinalPathNameByHandleW(file,name.as_mut_ptr(),name.len() as u32,0) as usize;
    let value = if length > 0 && length < name.len() { String::from_utf16_lossy(&name[..length]) } else { "unknown".into() };
    CloseHandle(file);value
}
fn fault_log(output: &std::path::Path, record: &serde_json::Value) -> Result<()> {
    use std::io::Write;
    let mut file=std::fs::OpenOptions::new().create(true).append(true).open(output.join("native-fault.jsonl"))?;
    writeln!(file,"{}",serde_json::to_string(record)?)?;file.sync_all()?;Ok(())
}
#[repr(align(16))]
struct AlignedContext(CONTEXT);
unsafe fn capture_fault(process: HANDLE,pid:u32,tid:u32,thread:HANDLE,info:EXCEPTION_DEBUG_INFO,output:&std::path::Path,number:u32,modules:&std::collections::BTreeMap<u64,String>) -> Result<()> {
    use std::os::windows::io::AsRawHandle;
    let mut context=AlignedContext(std::mem::zeroed());context.0.ContextFlags=CONTEXT_FULL_AMD64;
    win(GetThreadContext(thread,&mut context.0),"Get exception thread context")?;
    let mut exception=info.ExceptionRecord;exception.ExceptionRecord=std::ptr::null_mut();
    let mut pointers=EXCEPTION_POINTERS{ExceptionRecord:&mut exception,ContextRecord:&mut context.0};
    let exception_info=MINIDUMP_EXCEPTION_INFORMATION{ThreadId:tid,ExceptionPointers:&mut pointers,ClientPointers:0};
    let file=std::fs::OpenOptions::new().write(true).create_new(true).open(output.join(format!("native-fault-{number}.dmp")))?;
    let ok=MiniDumpWriteDump(process,pid,file.as_raw_handle(),MiniDumpWithThreadInfo,&exception_info,std::ptr::null(),std::ptr::null());
    fault_log(output,&serde_json::json!({"kind":"dump","number":number,"ok":ok!=0,"error":if ok==0{std::io::Error::last_os_error().to_string()}else{String::new()},"bytes":file.metadata()?.len()}))?;
    let search=output.join("symbols");std::fs::create_dir_all(&search)?;
    let symbols=SymInitializeW(process,super::wide(&search).as_ptr(),1)!=0;
    let mut frame=STACKFRAME64::default();frame.AddrPC.Offset=context.0.Rip;frame.AddrPC.Mode=AddrModeFlat;
    frame.AddrStack.Offset=context.0.Rsp;frame.AddrStack.Mode=AddrModeFlat;frame.AddrFrame.Offset=context.0.Rbp;frame.AddrFrame.Mode=AddrModeFlat;
    for index in 0..80 {
        let address=frame.AddrPC.Offset;let base=SymGetModuleBase64(process,address);
        let mut package=SYMBOL_INFO_PACKAGE::default();package.si.SizeOfStruct=std::mem::size_of::<SYMBOL_INFO>() as u32;package.si.MaxNameLen=2000;
        let mut displacement=0u64;let found=SymFromAddr(process,address,&mut displacement,&mut package.si)!=0;
        let name=if found { String::from_utf8_lossy(std::slice::from_raw_parts(package.si.Name.as_ptr().cast(),package.si.NameLen as usize)).into_owned() } else { String::new() };
        fault_log(output,&serde_json::json!({"kind":"frame","number":number,"index":index,"threadId":tid,"address":format!("{address:#x}"),"moduleBase":format!("{base:#x}"),"module":modules.get(&base),"offset":format!("{:#x}",address.saturating_sub(base)),"symbol":name,"symbolDisplacement":displacement}))?;
        if StackWalk64(0x8664,process,thread,&mut frame,(&mut context.0 as *mut CONTEXT).cast(),None,Some(SymFunctionTableAccess64),Some(SymGetModuleBase64),None)==0 || frame.AddrPC.Offset==0 { break; }
    }
    if symbols { SymCleanup(process); }
    Ok(())
}

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
