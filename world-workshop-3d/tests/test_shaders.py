"""Validate shipped GLSL ES programs using Mesa EGL. Not a browser WebGL test."""
import ctypes as C,ctypes.util,os,re,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
os.environ.setdefault('EGL_PLATFORM','surfaceless')
os.environ.setdefault('LIBGL_ALWAYS_SOFTWARE','1')
E=C.CDLL(ctypes.util.find_library('EGL'));G=None
E.eglGetProcAddress.restype=C.c_void_p;E.eglGetProcAddress.argtypes=[C.c_char_p]
def sig(lib,name,ret,args):
 if lib is None:
  address=E.eglGetProcAddress(name.encode())
  if not address:raise RuntimeError('Missing GL symbol '+name)
  return C.CFUNCTYPE(ret,*args)(address)
 f=getattr(lib,name);f.restype=ret;f.argtypes=args;return f
ptr=C.c_void_p;I=C.c_int;U=C.c_uint
get=sig(E,'eglGetDisplay',ptr,[ptr]);d=get(None)
init=sig(E,'eglInitialize',I,[ptr,C.POINTER(I),C.POINTER(I)]);major=I();minor=I()
if not init(d,C.byref(major),C.byref(minor)): raise RuntimeError('EGL unavailable; shader validation skipped')
sig(E,'eglBindAPI',I,[U])(0x30A0)
attrs=(I*13)(0x3024,8,0x3023,8,0x3022,8,0x3033,1,0x3040,4,0x3021,8,0x3038)
config=ptr();num=I();sig(E,'eglChooseConfig',I,[ptr,C.POINTER(I),C.POINTER(ptr),I,C.POINTER(I)])(d,attrs,C.byref(config),1,C.byref(num))
ctxattrs=(I*3)(0x3098,2,0x3038)
ctx=sig(E,'eglCreateContext',ptr,[ptr,ptr,ptr,C.POINTER(I)])(d,config,None,ctxattrs)
pattrs=(I*5)(0x3057,16,0x3056,16,0x3038)
surf=sig(E,'eglCreatePbufferSurface',ptr,[ptr,ptr,C.POINTER(I)])(d,config,pattrs)
if not sig(E,'eglMakeCurrent',I,[ptr,ptr,ptr,ptr])(d,surf,surf,ctx):raise RuntimeError('EGL makeCurrent failed')
create=sig(G,'glCreateShader',U,[U]);source=sig(G,'glShaderSource',None,[U,I,C.POINTER(C.c_char_p),C.POINTER(I)]);compile=sig(G,'glCompileShader',None,[U]);getiv=sig(G,'glGetShaderiv',None,[U,U,C.POINTER(I)]);getlog=sig(G,'glGetShaderInfoLog',None,[U,I,C.POINTER(I),C.c_char_p]);createp=sig(G,'glCreateProgram',U,[]);attach=sig(G,'glAttachShader',None,[U,U]);link=sig(G,'glLinkProgram',None,[U]);piv=sig(G,'glGetProgramiv',None,[U,U,C.POINTER(I)])
src=(ROOT/'src/voxel-runtime.js').read_text();programs={}
for a,b in [('VS','FS'),('SKYVS','SKYFS'),('LINEVS','LINEFS')]:
 shaders=[]
 for name,kind in [(a,0x8B31),(b,0x8B30)]:
  text=re.search(r'const '+name+r'=`(.*?)`;',src,re.S).group(1).encode();sh=create(kind);s=C.c_char_p(text);source(sh,1,C.byref(s),None);compile(sh);ok=I();getiv(sh,0x8B81,C.byref(ok));log=C.create_string_buffer(8192);getlog(sh,8192,None,log)
  if not ok.value:raise RuntimeError(name+': '+log.value.decode())
  shaders.append(sh)
 p=createp()
 for sh in shaders:attach(p,sh)
 link(p);ok=I();piv(p,0x8B82,C.byref(ok))
 if not ok.value:raise RuntimeError('Link failed for '+a+'/'+b)
 programs[a+'/'+b]='compiled and linked'
print(programs,flush=True)
version=sig(G,'glGetString',C.c_char_p,[U])(0x1F02).decode()
report={'backend':version,'programs':programs,'note':'Native EGL GLSL compilation/link validation only; does not certify browser WebGL rendering.'}
(ROOT/'shader-test-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
sig(E,'eglTerminate',I,[ptr])(d)
