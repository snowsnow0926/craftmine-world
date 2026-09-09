import fs from 'node:fs';
import {applyDraftInstall} from '../../desktop/godot/shared/draft_install.mjs';
const args=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
args.payload=args.payload.map(f=>({...f,bytes:Buffer.from(f.bytesBase64,'base64')}));
const rename=fs.renameSync;
fs.renameSync=(from,to)=>{rename(from,to);if(to.replaceAll('\\','/').endsWith('/scenes/world.tscn'))process.exit(73);};
applyDraftInstall(args);throw Error('crash checkpoint not reached');
