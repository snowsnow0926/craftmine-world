import path from 'node:path';
import {materializeBase} from '../../../shared/materialize.mjs';
const args=process.argv.slice(2),values={};
for(let index=0;index<args.length;index+=2){if(!['--template','--world-id','--out'].includes(args[index])||!args[index+1])throw Error('Expected --template blank --world-id <id> --out <directory>');values[args[index]]=args[index+1];}
if(!values['--world-id']||!values['--out'])throw Error('World ID and output directory required');
materializeBase({baseId:'creation-sandbox',template:values['--template']||'blank',worldId:values['--world-id'],out:path.resolve(values['--out'])});
