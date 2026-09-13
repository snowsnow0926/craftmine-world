import {app, type NativeImage} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {configureHeadlessAcceptance} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless';
import {GodotBuildVerifier} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';

configureHeadlessAcceptance();
const directory=process.env.CRAFTMINE_HEADLESS_ROOT!;
app.setPath('userData',process.env.CRAFTMINE_DATA_DIR!);
// Default desktop graphics, still offscreen/hidden/non-focusable and guarded.
const verifier=new GodotBuildVerifier();
let active:Promise<void>|null=null,lastFrame:NativeImage|null=null;
app.on('window-all-closed',()=>{});
app.on('web-contents-created',(_event,contents)=>contents.on('paint',(_event,_rect,frame)=>{if(active&&!frame.isEmpty())lastFrame=frame;}));
async function close(){verifier.cancelAll();await active;app.quit();}
process.on('message',(message:any)=>{
  if(message?.kind!=='creation-progress-check')return;
  if(message.method==='close'){void close();return;}
  if(message.method==='cancel'){verifier.cancelAll();return;}
  if(message.method!=='check'||active||!['saved','outside','collision'].includes(message.label))return;
  lastFrame=null;
  active=(async()=>{
    try {
      const evidence=await verifier.check(message.descriptor);
      let capture=null;
      const frame=lastFrame as NativeImage|null;
      if(frame){const png=frame.toPNG(),file=path.join(directory,message.label+'.png');fs.writeFileSync(file,png);
        capture={file,sha256:createHash('sha256').update(png).digest('hex'),...frame.getSize(),source:'actual isolated candidate frame'};}
      const value={evidence,capture,graphics:{hardwareAcceleration:app.isHardwareAccelerationEnabled(),angle:app.commandLine.getSwitchValue('use-angle')||'platform-default',features:app.getGPUFeatureStatus()}};
      fs.writeFileSync(path.join(directory,message.label+'.json'),JSON.stringify(value,null,2));
      process.send?.({kind:'creation-progress-result',id:message.id,value});
    } catch(error){process.send?.({kind:'creation-progress-result',id:message.id,error:String(error)});}
  })().finally(()=>{active=null;});
});
process.on('disconnect',()=>void close());
void app.whenReady().then(()=>process.send?.({kind:'creation-progress-ready'}));
