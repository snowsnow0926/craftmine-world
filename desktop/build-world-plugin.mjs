import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {compileScene, INITIAL_SNAPSHOT} from '../app/scene.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root,'plugins/craftmine-world');
const output = path.join(root,'desktop/build/craftmine.world');
const require = createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const {build} = require('esbuild');
await fs.mkdir(path.join(output,'views'), {recursive:true});
for (const file of ['manifest.json','main.cjs','core-client.cjs','world-tools.cjs','verification-jobs.cjs','review-jobs.cjs','applications.cjs','host-requests.cjs','context-review.cjs','workbench-service.cjs']) await fs.copyFile(path.join(source,file),path.join(output,file));
await fs.rm(path.join(output,'main.js'), {force:true});
await build({entryPoints:[path.join(source,'domain-adapter.mjs')],outfile:path.join(output,'domain.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',
  alias:{'@babel/parser':require.resolve('@babel/parser')},
  plugins:[{name:'desktop-static-syntax',setup(builder){builder.onResolve({filter:/behavior-syntax\.mjs$/},()=>({path:path.join(source,'behavior-syntax.mjs')}));}}]});
await fs.copyFile(require.resolve('@babel/parser/package.json').replace(/package\.json$/,'LICENSE'),path.join(output,'BABEL_PARSER_LICENSE.txt'));
for (const file of ['game.html','game.js','game.css','runtime.js']) await fs.rm(path.join(output,'views',file),{force:true});
const scene = {format:'craftmine.scene/3',title:'新世界',night:false,objects:[],systems:[],behaviors:[]};
const compiled = compileScene(scene);
const bootstrap = {build:{...compiled,id:'v-'+compiled.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]};
const compiledGame = await build({entryPoints:[path.join(root,'app/game.js')],write:false,bundle:true,platform:'browser',format:'iife',target:'chrome130'});
const escapeScript = text => text.replace(/\r\n?/g,'\n').replace(/<\/script/gi,'<\\/script');
const runtimeCode = escapeScript(await fs.readFile(path.join(root,'world-workshop-3d/src/voxel-runtime.js'),'utf8'));
const gameCode = escapeScript(compiledGame.outputFiles[0].text);
const inputGuardBuild=await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/shared/craftmine-headless-input.ts')],write:false,bundle:true,platform:'browser',format:'iife',globalName:'CraftmineHeadlessGuard',footer:{js:'CraftmineHeadlessGuard.installHeadlessInputGuard();'},target:'chrome130'});
const inputGuard=escapeScript(inputGuardBuild.outputFiles[0].text);
const hashes = [runtimeCode,gameCode,inputGuard].map(text=>"'sha256-"+createHash('sha256').update(text).digest('base64')+"'").join(' ');
const policy = `default-src 'none'; script-src 'self' blob: ${hashes}; worker-src blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self'; connect-src 'none'; base-uri 'none'`;
const styles = await fs.readFile(path.join(root,'app/game.css'),'utf8');
const game = (await fs.readFile(path.join(root,'app/game.html'),'utf8'))
  .replace('<meta charset="utf-8">',`<meta charset="utf-8"><meta name="craftmine-nonce" content="__CRAFTMINE_NONCE__"><meta http-equiv="Content-Security-Policy" content="${policy}">`)
  .replace('<link rel="stylesheet" href="/app/game.css">',`<style>${styles}</style>`)
  .replace('<script src="/runtime.js" defer></script>','')
  .replace('<script type="module" src="/app/game.js"></script>','')
  .replace('</body>',`__CRAFTMINE_INPUT_GUARD__<script>${runtimeCode}</script><script>${gameCode}</script></body>`);
const view = (await fs.readFile(path.join(source,'world.html'),'utf8')).replace(/content="default-src [^"]+"/,`content="${policy}"`);
await fs.writeFile(path.join(output,'views/world.html'),view);
await fs.writeFile(path.join(output,'views/verify.html'),`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>body{margin:0}iframe{border:0;width:100vw;height:100vh;display:block}</style></head><body><script>${inputGuard}</script><script src="verify.js"></script></body></html>`);
await build({entryPoints:[path.join(source,'verify-view.mjs')],outfile:path.join(output,'views/verify.js'),bundle:true,platform:'browser',format:'iife',target:'chrome130',define:{CRAFTMINE_GAME_DOCUMENT:JSON.stringify(game),CRAFTMINE_INPUT_GUARD:JSON.stringify('<script>'+inputGuard+'</script>')}});
await build({entryPoints:[path.join(source,'view.mjs')],outfile:path.join(output,'views/view.js'),bundle:true,platform:'browser',format:'iife',target:'chrome130',define:{CRAFTMINE_BOOT_WORLD:JSON.stringify(bootstrap),CRAFTMINE_GAME_DOCUMENT:JSON.stringify(game),CRAFTMINE_INPUT_GUARD:JSON.stringify('<script>'+inputGuard+'</script>')}});
console.log(output);
