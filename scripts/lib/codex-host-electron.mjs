import fs from 'node:fs';
import path from 'node:path';

// Developer-owned host runtime override. Never passed as a model tool argument.
export function hostElectron(requireElectron){
  const selected=process.env.CRAFTMINE_ELECTRON_BIN;
  if(!selected)return requireElectron('electron');
  if(!path.isAbsolute(selected)||!fs.statSync(selected).isFile())throw Error('CODEX_HOST_ELECTRON_INVALID');
  return selected;
}
