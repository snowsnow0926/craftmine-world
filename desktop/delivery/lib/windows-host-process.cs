using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Only the runner's fixed installer/uninstaller. Never switches the input desktop.
public static class CraftmineHostProcess {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
    public int cb; public string reserved, desktop, title;
    public int x,y,xSize,ySize,xChars,yChars,fill,flags; public short show,reserved2;
    public IntPtr reservedPtr,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {
    public long userTime,jobTime; public uint flags; public UIntPtr min,max; public uint active;
    public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT {
    public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
  }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING {
    public long user,kernel,periodUser,periodKernel; public uint pageFaults,total,active,terminated;
  }
  [StructLayout(LayoutKind.Sequential)] struct FILE_INFO {
    public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME created,access,written;
    public uint serial,sizeHigh,sizeLow,links,indexHigh,indexLow;
  }
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateDesktop(string name,IntPtr device,IntPtr mode,uint flags,uint access,IntPtr security);
  [DllImport("user32.dll",SetLastError=true)] static extern bool CloseDesktop(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string file,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO si,out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref EXTENDED_LIMIT value,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int info,out ACCOUNTING value,uint size,IntPtr length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr file,out FILE_INFO info);
  static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static uint Links(string file) {
    using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read)) {
      FILE_INFO info; Check(GetFileInformationByHandle(stream.SafeFileHandle.DangerousGetHandle(),out info)); return info.links;
    }
  }
  public sealed class Result { public uint ExitCode; public uint Pid; public long DurationMs; public string Desktop; public bool AllOwnedProcessesExited; }
  public static Result Run(string file,string arguments,string cwd,int timeoutSeconds) {
    if(timeoutSeconds<1||timeoutSeconds>900) throw new ArgumentException("TIMEOUT_INVALID");
    string desktopName="CraftmineInstallAcceptance-"+Guid.NewGuid().ToString("N");
    IntPtr desk=IntPtr.Zero,job=IntPtr.Zero; PROCESS_INFORMATION pi=new PROCESS_INFORMATION(); bool assigned=false;
    var clock=Stopwatch.StartNew();
    try {
      desk=CreateDesktop(desktopName,IntPtr.Zero,IntPtr.Zero,0,0x01FF,IntPtr.Zero); Check(desk!=IntPtr.Zero);
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
      var limits=new EXTENDED_LIMIT(); limits.basic.flags=0x2000; // kill only owned descendants on failure/timeout
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
      var si=new STARTUPINFO();si.cb=Marshal.SizeOf(typeof(STARTUPINFO));si.desktop="WinSta0\\"+desktopName;si.flags=1;si.show=0;
      Check(CreateProcess(file,new StringBuilder("\""+file+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,false,0x08000404,IntPtr.Zero,cwd,ref si,out pi));
      Check(AssignProcessToJobObject(job,pi.process));assigned=true;Check(ResumeThread(pi.thread)!=0xFFFFFFFF);
      while(true) {
        ACCOUNTING accounting;Check(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero));
        if(accounting.active==0)break;
        if(clock.ElapsedMilliseconds>timeoutSeconds*1000L)throw new TimeoutException("INSTALLER_OWNED_JOB_TIMEOUT: partial installation retained for inspection");
        Thread.Sleep(50);
      }
      uint exit;Check(GetExitCodeProcess(pi.process,out exit));
      return new Result {ExitCode=exit,Pid=pi.pid,DurationMs=clock.ElapsedMilliseconds,Desktop=desktopName,AllOwnedProcessesExited=true};
    } finally {
      if(pi.process!=IntPtr.Zero&&!assigned)TerminateProcess(pi.process,125); // suspended, never executed
      if(job!=IntPtr.Zero)CloseHandle(job);
      if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);
      if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);
      if(desk!=IntPtr.Zero)CloseDesktop(desk);
    }
  }
}
