param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$c=Get-Content -LiteralPath $Config -Raw|ConvertFrom-Json
$target=Get-Process -Id $c.pid
if($target.Path -ne $c.executable){throw 'EXE_IDENTITY_MISMATCH'}
if($target.StartTime.ToUniversalTime().Ticks.ToString() -ne $c.creationTicks){throw 'CREATION_IDENTITY_MISMATCH'}
$proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($c.pid)"
if($proc.ParentProcessId -ne $c.parentPid){throw 'PARENT_IDENTITY_MISMATCH'}
if((Get-FileHash -LiteralPath $c.executable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $c.exeSha256){throw 'EXE_HASH_MISMATCH'}
$marker=Get-Content -LiteralPath (Join-Path $c.profile 'headless-profile.json') -Raw|ConvertFrom-Json
if($marker.format -ne 'craftmine.headless-profile/1'){throw 'PROFILE_IDENTITY_MISMATCH'}
if(-not ([IO.Path]::GetFullPath($c.output)).StartsWith('D:\cm-fb3-20260910\test-results\desktop-native-lr-', [StringComparison]::OrdinalIgnoreCase)){throw 'OUTPUT_OWNERSHIP_MISMATCH'}
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Diagnostics; using System.Runtime.InteropServices; using System.ComponentModel;
public static class OwnedDebug {
 [StructLayout(LayoutKind.Explicit,Size=176)] struct Ev { [FieldOffset(0)]public uint Code;[FieldOffset(4)]public uint Pid;[FieldOffset(8)]public uint Tid;[FieldOffset(16)]public uint ExceptionCode;[FieldOffset(32)]public ulong Address;[FieldOffset(168)]public uint First;[FieldOffset(16)]public IntPtr File;[FieldOffset(24)]public IntPtr Process;[FieldOffset(32)]public IntPtr Thread; }
 [StructLayout(LayoutKind.Explicit,Size=512)] struct Frame { [FieldOffset(0)]public ulong PC;[FieldOffset(12)]public uint PCMode;[FieldOffset(32)]public ulong FramePointer;[FieldOffset(44)]public uint FrameMode;[FieldOffset(48)]public ulong Stack;[FieldOffset(60)]public uint StackMode; }
 [DllImport("kernel32",SetLastError=true)]static extern bool DebugActiveProcess(uint pid);
 [DllImport("kernel32",SetLastError=true)]static extern bool DebugActiveProcessStop(uint pid);
 [DllImport("kernel32",SetLastError=true)]static extern bool DebugSetProcessKillOnExit(bool kill);
 [DllImport("kernel32",SetLastError=true)]static extern bool WaitForDebugEvent(out Ev ev,uint ms);
 [DllImport("kernel32",SetLastError=true)]static extern bool ContinueDebugEvent(uint pid,uint tid,uint status);
 [DllImport("kernel32",SetLastError=true)]static extern IntPtr OpenThread(uint rights,bool inherit,uint tid);
 [DllImport("kernel32",SetLastError=true)]static extern bool GetThreadContext(IntPtr thread,IntPtr context);
 [DllImport("kernel32")]static extern bool CloseHandle(IntPtr handle);
 [DllImport("dbghelp",SetLastError=true)]static extern bool MiniDumpWriteDump(IntPtr process,uint pid,IntPtr file,uint type,IntPtr exception,IntPtr streams,IntPtr callbacks);
 [DllImport("dbghelp",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool SymInitializeW(IntPtr process,string search,bool invade);
 [DllImport("dbghelp")]static extern bool SymCleanup(IntPtr process);
 [DllImport("dbghelp",SetLastError=true)]static extern bool StackWalk64(uint machine,IntPtr process,IntPtr thread,ref Frame frame,IntPtr context,IntPtr read,IntPtr function,IntPtr module,IntPtr translate);
 [DllImport("kernel32",CharSet=CharSet.Unicode)]static extern IntPtr GetModuleHandleW(string module);
 [DllImport("kernel32",CharSet=CharSet.Ansi)]static extern IntPtr GetProcAddress(IntPtr module,string name);
 static void Log(string outDir,string line){File.AppendAllText(Path.Combine(outDir,"debugger.log"),DateTime.UtcNow.ToString("o")+" "+line+Environment.NewLine);Console.WriteLine(line);}
 static void Capture(uint pid,uint tid,string output,int number){
  using(var process=System.Diagnostics.Process.GetProcessById((int)pid)) {
   IntPtr ph=process.Handle;
   string dump=Path.Combine(output,"exception-"+number+".dmp");
   using(var file=new FileStream(dump,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.Read)){
    bool ok=MiniDumpWriteDump(ph,pid,file.SafeFileHandle.DangerousGetHandle(),0x1000,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
    Log(output,"DUMP ok="+ok+" error="+Marshal.GetLastWin32Error()+" file="+dump);
   }
   var modules=process.Modules;foreach(ProcessModule m in modules)Log(output,"MODULE "+m.ModuleName+" base=0x"+m.BaseAddress.ToInt64().ToString("x")+" size="+m.ModuleMemorySize+" file="+m.FileName);
   IntPtr th=OpenThread(0x48,false,tid);if(th==IntPtr.Zero){Log(output,"THREAD_ERROR "+Marshal.GetLastWin32Error());return;}
   IntPtr raw=Marshal.AllocHGlobal(1250);IntPtr ctx=new IntPtr((raw.ToInt64()+15)&~15L);bool symbols=false;
   try{for(int i=0;i<1232;i++)Marshal.WriteByte(ctx,i,0);Marshal.WriteInt32(ctx,48,0x10000b);if(!GetThreadContext(th,ctx)){Log(output,"CONTEXT_ERROR "+Marshal.GetLastWin32Error());return;}
    var f=new Frame{PC=(ulong)Marshal.ReadInt64(ctx,248),FramePointer=(ulong)Marshal.ReadInt64(ctx,160),Stack=(ulong)Marshal.ReadInt64(ctx,152),PCMode=3,FrameMode=3,StackMode=3};
    symbols=SymInitializeW(ph,output,true);Log(output,"SYM_INIT "+symbols);
    IntPtr mod=GetModuleHandleW("dbghelp.dll");var fn=GetProcAddress(mod,"SymFunctionTableAccess64");var mb=GetProcAddress(mod,"SymGetModuleBase64");
    for(int i=0;i<80;i++){string label="unknown";foreach(ProcessModule m in modules){ulong b=(ulong)m.BaseAddress.ToInt64();if(f.PC>=b&&f.PC<b+(ulong)m.ModuleMemorySize){label=m.ModuleName+"+0x"+(f.PC-b).ToString("x");break;}}Log(output,"FRAME "+i+" pc=0x"+f.PC.ToString("x")+" "+label);if(!StackWalk64(0x8664,ph,th,ref f,ctx,IntPtr.Zero,fn,mb,IntPtr.Zero)||f.PC==0)break;}
   }finally{if(symbols)SymCleanup(ph);Marshal.FreeHGlobal(raw);CloseHandle(th);}
  }
 }
 public static void Run(uint pid,string output){
  if(!DebugActiveProcess(pid))throw new Win32Exception(Marshal.GetLastWin32Error());
  DebugSetProcessKillOnExit(false);Log(output,"ATTACHED pid="+pid);bool initial=true,exited=false;int captures=0;var deadline=DateTime.UtcNow.AddMinutes(5);
  try{while(DateTime.UtcNow<deadline){Ev e;if(!WaitForDebugEvent(out e,500)){if(Marshal.GetLastWin32Error()==121)continue;throw new Win32Exception(Marshal.GetLastWin32Error());}uint status=0x10002;
    if(e.Code==1){Log(output,"EXCEPTION code=0x"+e.ExceptionCode.ToString("x")+" tid="+e.Tid+" address=0x"+e.Address.ToString("x")+" first="+e.First);if(e.ExceptionCode==0x80000003&&initial){initial=false;}else{status=0x80010001;if(e.ExceptionCode==0x80000003&&captures<2){try{Capture(pid,e.Tid,output,++captures);}catch(Exception err){Log(output,"CAPTURE_ERROR "+err);}}}}
    if(e.Code==3){if(e.File!=IntPtr.Zero)CloseHandle(e.File);if(e.Process!=IntPtr.Zero)CloseHandle(e.Process);if(e.Thread!=IntPtr.Zero)CloseHandle(e.Thread);}
    if(e.Code==6&&e.File!=IntPtr.Zero)CloseHandle(e.File);
    if(e.Code==5){exited=true;Log(output,"PROCESS_EXIT code="+e.ExceptionCode);}
    if(!ContinueDebugEvent(e.Pid,e.Tid,status))throw new Win32Exception(Marshal.GetLastWin32Error());if(exited)break;
   }if(!exited)throw new Exception("DEBUG_DEADLINE_EXCEEDED");
  }finally{if(!exited)Log(output,"DETACH "+DebugActiveProcessStop(pid));}
 }
}
'@
[OwnedDebug]::Run([uint32]$c.pid,[string]$c.output)
