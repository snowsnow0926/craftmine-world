// Real threaded Web export of the first-person base.
//
// The base project itself is never modified: it is copied into a temp project
// under <root>/test-results, the shared Web shell is placed in that copy, and
// the pinned engine performs a real `--editor --import` plus
// `--export-release Web`. Hashing, engine pinning and the isolated profile all
// come from desktop/godot/toolchain.mjs; this module only authors the preset.
//
// Run alone:  node desktop/godot/bases/first-person/tests/export_web.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment, sha256} from '../../../toolchain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const baseDirectory = path.resolve(here, '..');
export const rootDirectory = path.resolve(here, '../../../../..');
const godotDirectory = path.resolve(here, '../../..');
const quote = value => JSON.stringify(value.replaceAll('\\', '/'));

/**
 * Exports the authored first-person base to Web with the shared threaded shell.
 * `out` must be an absolute temp directory; the project copy and the export
 * both live under it. Returns {output, buildId, files, ...}.
 */
export async function exportWebBase(out, {threads = true} = {}) {
  if (!path.isAbsolute(out)) throw Error('Export temp directory must be absolute');
  const environment = await createGodotProbeEnvironment(out, {web: true, threads});
  const project = path.join(out, 'project');
  const output = path.join(out, 'export');
  fs.mkdirSync(output, {recursive: true});

  fs.cpSync(baseDirectory, project, {recursive: true, filter: source => path.basename(source) !== '.godot'});
  fs.copyFileSync(path.join(godotDirectory, 'web/shell.html'), path.join(project, 'shell.html'));
  fs.writeFileSync(path.join(project, 'export_presets.cfg'), `[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=${quote(path.join(output, 'index.html'))}
[preset.0.options]
custom_template/release=${quote(environment.webTemplate)}
variant/thread_support=${threads}
variant/extensions_support=false
html/custom_html_shell="res://shell.html"
html/focus_canvas_on_start=false
html/canvas_resize_policy=2
progressive_web_app/enabled=false
`);

  await environment.run('base-web-import', ['--path', project, '--editor', '--import']);
  await environment.run('base-web-export', ['--path', project, '--export-release', 'Web', path.join(output, 'index.html')], {timeout: 240000});

  // The shared transport is not part of the .pck: it is served next to the build.
  fs.copyFileSync(path.join(godotDirectory, 'web/bridge.js'), path.join(output, 'bridge.js'));
  fs.cpSync(path.join(godotDirectory, 'licenses'), path.join(output, 'licenses'), {recursive: true});

  // A threaded build's loader really contains the pthread/worker machinery; the
  // single-threaded template contains none of it. Verified by exporting both.
  const loader = fs.readFileSync(path.join(output, 'index.js'), 'utf8');
  const threaded = loader.includes('emscripten_has_threading_support') && loader.includes('___pthread_create_js') && loader.includes('new Worker');
  if (threaded !== threads) throw Error('Exported Web template does not match the requested thread support');

  const files = [];
  for (const name of fs.readdirSync(output, {recursive: true}).sort()) {
    const file = path.join(output, name);
    if (!fs.statSync(file).isFile()) continue;
    files.push({path: name.replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: await sha256(file)});
  }
  const buildId = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const result = {
    output,
    project,
    buildId,
    threads,
    threaded,
    template: path.basename(environment.webTemplate),
    files,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    godotVersion: environment.actualVersion,
  };
  fs.writeFileSync(path.join(output, 'build.json'), JSON.stringify(result, null, 2));
  return {...result, environment};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.join(rootDirectory, 'test-results'), {recursive: true});
  const out = fs.mkdtempSync(path.join(rootDirectory, 'test-results/first-person-web-export-'));
  const build = await exportWebBase(out);
  console.log(JSON.stringify({output: build.output, buildId: build.buildId, bytes: build.bytes, files: build.files.map(file => file.path)}, null, 2));
  console.log('Evidence: ' + out);
}
