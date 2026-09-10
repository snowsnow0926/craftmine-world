using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Owned, windowless test program. No installer, product runtime, input or focus API.
public static class CraftmineWindowlessSmoke {
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll", SetLastError=true)] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder name,uint bytes,out uint required);
  static string Name(IntPtr desktop) {
    var value=new StringBuilder(1024);uint needed;
    if(desktop==IntPtr.Zero||!GetUserObjectInformation(desktop,2,value,2048,out needed))throw new InvalidOperationException("DESKTOP_NAME_UNAVAILABLE_"+Marshal.GetLastWin32Error());
    return value.ToString();
  }
  public static string CurrentDesktopName(){return Name(GetThreadDesktop(GetCurrentThreadId()));}
  public static string InputDesktopName(){var desktop=OpenInputDesktop(0,false,1);try{return Name(desktop);}finally{if(desktop!=IntPtr.Zero)CloseDesktop(desktop);}}
  static void Record(string directory,string name,int? childPid) {
    var value=new {pid=Process.GetCurrentProcess().Id,desktop=CurrentDesktopName(),inputDesktop=InputDesktopName(),childPid=childPid,at=DateTime.UtcNow.ToString("o")};
    File.WriteAllText(Path.Combine(directory,name),new JavaScriptSerializer().Serialize(value),new UTF8Encoding(false));
  }
  public static int Main(string[] args) {
    if(args.Length!=3||!Path.IsPathRooted(args[1])||!args[1].StartsWith("D:\\",StringComparison.OrdinalIgnoreCase))return 90;
    string role=args[0],directory=args[1],mode=args[2];
    if(mode!="normal"&&mode!="timeout"&&mode!="nonzero")return 91;
    if(role=="child") {
      Record(directory,"child-start.json",null);
      Thread.Sleep(mode=="timeout"?30000:800);
      Record(directory,"child-finished.json",null);
      // Deliberate nonzero child demonstrates that active-zero is not strict0.
      return mode=="nonzero"?23:0;
    }
    if(role!="parent")return 92;
    string executable=typeof(CraftmineWindowlessSmoke).Assembly.Location;
    var start=new ProcessStartInfo(executable,"child \""+directory+"\" "+mode){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=directory};
    using(var child=Process.Start(start)) {
      Record(directory,"parent-start.json",child.Id);
      if(mode=="timeout")Thread.Sleep(30000);
      // Intentionally does not wait. The production job must wait for the child.
      Record(directory,"parent-finished.json",child.Id);
    }
    return 0;
  }
}
