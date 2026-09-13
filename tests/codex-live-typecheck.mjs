import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(path.resolve('vendor/pi-desktop/apps/desktop/package.json'));
const ts=require('typescript');
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  strict:true,skipLibCheck:true,noEmit:true,esModuleInterop:true,allowJs:true,checkJs:false,allowImportingTsExtensions:true,types:[]};
const program=ts.createProgram([path.resolve('scripts/lib/codex-live-main.ts')],options);
const diagnostics=ts.getPreEmitDiagnostics(program);
for(const diagnostic of diagnostics)console.error((diagnostic.file?.fileName??'')+' '+ts.flattenDiagnosticMessageText(diagnostic.messageText,'\n'));
console.log('Codex live host strict TypeScript diagnostics='+diagnostics.length);
process.exitCode=diagnostics.length?1:0;
