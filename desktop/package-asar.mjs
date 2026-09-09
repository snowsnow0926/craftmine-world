import path from 'node:path';
import {createRequire} from 'node:module';

// pnpm exposes transitive dependencies to their actual owner, not the desktop
// package. Resolve through the same pinned builder that created this archive.
export function loadPackageAsar(desktopDirectory){
  const desktopRequire=createRequire(path.join(desktopDirectory,'package.json'));
  const builderRequire=createRequire(desktopRequire.resolve('electron-builder'));
  const libraryRequire=createRequire(builderRequire.resolve('app-builder-lib'));
  return libraryRequire('@electron/asar');
}
