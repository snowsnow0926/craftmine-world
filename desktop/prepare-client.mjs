import './build-world-plugin.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'desktop/build/craftmine.world');
const target=path.join(root,'vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world');
await fs.mkdir(target,{recursive:true});
await fs.cp(source,target,{recursive:true});
console.log('Prepared built-in world plugin: '+target);
