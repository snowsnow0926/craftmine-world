// Actual Electron-independent helpers shared by controlled host VM tests.
export * from '../../vendor/pi-desktop/apps/desktop/shared/craftmine-immersion.ts';
export {createImmersionPauseController} from '../../vendor/pi-desktop/apps/desktop/electron/main/immersion-pause-controller.ts';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
// Bootstrap tests run the real input helper with a controlled DOM observer.
// Observer scheduling/iframe behavior has its own pure-helper acceptance.
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/shared/craftmine-immersion.ts',import.meta.url),'utf8'),{mode:'transform'})
  .replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
export const preloadImmersionTools={attachImmersionInput:vm.runInNewContext(source+'\nattachImmersionInput',{
  MutationObserver:class {observe(){} disconnect(){}},
})};
