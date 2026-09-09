import {createRequire} from 'node:module';
import path from 'node:path';
const current=process.cwd().replaceAll('\\','/');
const dependencyRoot=path.resolve(process.env.CRAFTMINE_TYPECHECK_DEPENDENCY_ROOT||current).replaceAll('\\','/');
const require=createRequire(dependencyRoot+'/vendor/pi-desktop/apps/desktop/package.json');
const ts=require('typescript');
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,strict:true,skipLibCheck:true,noEmit:true,esModuleInterop:true,types:[],typeRoots:[dependencyRoot+'/vendor/pi-desktop/apps/desktop/node_modules/@types']};
const host=ts.createCompilerHost(options);
// Read installed dependency/type declarations without changing another checkout.
host.resolveModuleNames=(names,containing)=>names.map(name=>ts.resolveModuleName(name,containing,options,ts.sys).resolvedModule ?? ts.resolveModuleName(name,containing.replace(current,dependencyRoot),options,ts.sys).resolvedModule);
const program=ts.createProgram(['main/godot-world-view-host.ts','main/godot-runtime-adapter.ts','main/godot-panel-coordinator.ts','main/godot-candidate-coordinator.ts','preload/godot-world.ts'].map(file=>current+'/vendor/pi-desktop/apps/desktop/electron/'+file),options,host);
const diagnostics=ts.getPreEmitDiagnostics(program);
for(const item of diagnostics){const loc=item.file&&item.start!==undefined?item.file.getLineAndCharacterOfPosition(item.start):null;console.log((item.file?.fileName||'')+(loc?':'+(loc.line+1)+':'+(loc.character+1):'')+' '+ts.flattenDiagnosticMessageText(item.messageText,'\n'));}
console.log('Godot host strict TypeScript diagnostics='+diagnostics.length);process.exitCode=diagnostics.length?1:0;
