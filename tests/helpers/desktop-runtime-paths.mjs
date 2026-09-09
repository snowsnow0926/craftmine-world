import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

export function desktopRuntimePaths(directory) {
  const desktop=path.resolve('vendor/pi-desktop/apps/desktop');
  if(!process.env.CRAFTMINE_PACKAGED_ROOT)return {
    desktop,plugin:path.resolve('desktop/build/craftmine.world'),
    binary:process.env.CRAFTMINE_CORE_BIN||path.resolve('vendor/pi-desktop/target/release/craftmine-core.exe'),
    hostEntry:path.join(desktop,'electron/main/plugin-host-process.mjs'),
  };
  const resources=path.join(path.resolve(process.env.CRAFTMINE_PACKAGED_ROOT),'resources');
  const require=createRequire(path.join(desktop,'package.json'));
  const builderRequire=createRequire(require.resolve('electron-builder'));
  const libRequire=createRequire(builderRequire.resolve('app-builder-lib'));
  const {extractFile}=libRequire('@electron/asar');
  const hostEntry=path.join(directory,'packaged-plugin-host.mjs');
  fs.writeFileSync(hostEntry,extractFile(path.join(resources,'app.asar'),path.join('out','main','plugin-host-process.js')));
  return {desktop,hostEntry,plugin:path.join(resources,'plugins/craftmine.world'),binary:path.join(resources,'bin/craftmine-core.exe')};
}
