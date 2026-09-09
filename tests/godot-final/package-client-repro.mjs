// Diagnose product installation with a COPY of a closed, native client fixture.
// No model calls or game-state assignment. The source fixture remains untouched.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {createHostRequests} from '../../desktop/build/craftmine.world/host-requests.cjs';
import {createPackageInstallBinding,createPackageTurnLifecycle} from '../../plugins/craftmine-world/package-turn-lifecycle.cjs';
import {createManagedPackageInstaller} from '../../plugins/craftmine-world/reuse-service.mjs';
const root=path.resolve(import.meta.dirname,'../..'),source=path.resolve(process.argv[2]);
if(!source.startsWith(path.join(root,'test-results','desktop-native-complete-')))throw Error('Private client evidence required');
const out=await fs.mkdtemp(path.join(root,'test-results/package-client-repro-')),data=path.join(out,'core');
await fs.cp(path.join(source,'profile/plugins/data/craftmine.world'),data,{recursive:true});
const core=new CoreClient(path.join(root,'vendor/pi-desktop/target/release/craftmine-core.exe'),data);
const call=(m,p)=>core.call(m,p,120000);
let turns,install;
try {
 await core.start();const worlds=await call('world.list',{}),world=worlds.find(w=>w.title==='Reuse target');
 if(!world)throw Error('Actual failed reuse target required');
 const router=createHostRequests(core,{});turns=createPackageTurnLifecycle({call});
 install=createManagedPackageInstaller({call,stagingRoot:path.join(out,'staging'),turns,
  bind:createPackageInstallBinding({call,begin:p=>router('turn.begin',p),selected:async()=>world.id,finish:turns.finish}),
  enqueue:()=>({enqueued:false,reason:'Diagnostic core has no executor'})});
 const result=await install({worldId:world.id,operationId:randomUUID(),archiveBase64:(await fs.readFile(path.join(source,'component.zip'))).toString('base64')});
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(error);await fs.writeFile(path.join(out,'error.txt'),String(error.stack??error));process.exitCode=1;}
finally{await install?.drain();await turns?.stop();await core.stop();console.log(out);}
