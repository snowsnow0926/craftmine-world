// Isolated Electron compositor fixture. No player data, input, focus or model.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {app,BaseWindow,WebContentsView}=require('electron');
const {createRequire}=require('node:module');
assert.ok(process.argv[2]&&path.isAbsolute(process.argv[2]),'absolute new output directory required');
const output=path.resolve(process.argv[2]);
assert.equal(fs.existsSync(output),false,'fixture must use a new isolated directory');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));
app.commandLine.appendSwitch('disable-gpu');
const report={format:'craftmine.electron-bound-capture-dimensions/1',electron:process.versions.electron,startedAt:new Date().toISOString(),modelCalls:0};
let owner,view;
const timer=setTimeout(()=>{report.error='FIXTURE_TIMEOUT';finish(1);},20000);
function finish(code){clearTimeout(timer);report.endedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));if(view&&!view.webContents.isDestroyed())view.webContents.close();if(owner&&!owner.isDestroyed())owner.close();app.exit(code);}
app.whenReady().then(async()=>{
 owner=new BaseWindow({width:1200,height:800,useContentSize:true,show:false,focusable:false,skipTaskbar:true});
 view=new WebContentsView({webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 view.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 owner.contentView.addChildView(view);
 view.setBounds({x:275,y:150,width:525,height:650});
 const snapshot=()=>({owner:owner.getContentBounds(),view:view.getBounds(),attached:owner.contentView.children.includes(view),contentsId:view.webContents.id,visible:owner.isVisible(),focused:owner.isFocused(),focusable:owner.isFocusable()});
 await view.webContents.loadURL('data:text/html,'+encodeURIComponent('<!doctype html><html><head><script>Object.defineProperty(Element.prototype,"requestPointerLock",{value(){throw Error("POINTER_LOCK_DISABLED")}})</script><style>html,body{margin:0;width:100%;height:100%;background:#375e32}div{position:absolute;inset:20%;background:#dfa549;border:12px solid #eee}</style></head><body><div></div></body></html>'));
 await new Promise(resolve=>setTimeout(resolve,700));
 report.before=snapshot();
 const image=await view.webContents.capturePage();
 report.source=image.getSize();report.bitmapBytes=image.toBitmap().length;
 const png=image.toPNG();report.pngBytes=png.length;fs.writeFileSync(path.join(output,'capture.png'),png);
 report.after=snapshot();assert.deepEqual(report.after,report.before);
 assert.equal(report.before.visible,false);assert.equal(report.before.focused,false);assert.equal(report.before.focusable,false);assert.equal(report.before.attached,true);
 assert.equal(report.bitmapBytes,report.source.width*report.source.height*4);
 if(process.argv.includes('--verify-helper')){
  const helper=path.resolve(__dirname,'../vendor/pi-desktop/apps/desktop/electron/main/godot-view-capture.ts');
  const compiler=createRequire(path.resolve(__dirname,'../vendor/pi-desktop/apps/desktop/package.json'))('typescript');
  const compiled=compiler.transpileModule(fs.readFileSync(helper,'utf8'),{compilerOptions:{target:compiler.ScriptTarget.ES2022,module:compiler.ModuleKind.CommonJS}}).outputText;
  const exports={};new Function('require','exports',compiled)(require,exports);
  const captured=await exports.captureBoundGodotView({capturePage:async()=>image},{worldId:'fixture-world',buildId:'fixture-build',instanceId:'fixture-instance'},525,650,()=>assert.deepEqual(snapshot(),report.before));
  assert.deepEqual([captured.sourceWidth,captured.sourceHeight],[report.source.width,report.source.height]);
  assert.deepEqual([captured.viewWidth,captured.viewHeight],[525,650]);
  fs.writeFileSync(path.join(output,'helper.png'),Buffer.from(captured.pngBase64,'base64'));delete captured.pngBase64;report.helper=captured;
 }
 report.ok=true;finish(0);
}).catch(error=>{report.error=String(error);finish(1);});
