// Export only a verified, sealed release. Never launch an application or installer.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileHash, resourceInventory} from './prepare-runtime-resources.mjs';
import {readRelease, verifySeal, noLinks, archiveEntries} from './release-run.mjs';

export function previewLauncher(version) {
  const match = /^\d+\.\d+\.\d+-preview\.(\d+)$/.exec(version);
  if (!match) throw Error('PREVIEW_VERSION_REQUIRED');
  return [
    '@echo off', 'setlocal',
    'for /f "tokens=1 delims==" %%V in (\'set CRAFTMINE_ 2^>nul\') do set "%%V="',
    'for /f "tokens=1 delims==" %%V in (\'set PI_DESKTOP_ 2^>nul\') do set "%%V="',
    `set "CRAFTMINE_DATA_DIR=%LOCALAPPDATA%\\CraftmineWorld-FirstCreationPreview${match[1]}"`,
    'set "ELECTRON_RUN_AS_NODE="', 'set "NODE_OPTIONS="',
    'start "" "%~dp0output\\win-unpacked\\Craftmine World.exe"', '',
  ].join('\r\n');
}

const invoke = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    output += data; if (output.length > 32 * 1024 * 1024) child.kill();
  });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve(output) : reject(Error(`PREVIEW_ARCHIVE_FAILED:${code}\n${output.slice(-2000)}`)));
});

export async function verifyPortableTool(tool, sha256) {
  if (!path.isAbsolute(tool) || !/^[a-f0-9]{64}$/.test(sha256)) throw Error('PREVIEW_TOOL_PIN_REQUIRED');
  await noLinks(tool);
  if (!(await fs.stat(tool)).isFile() || await fileHash(tool) !== sha256) throw Error('PREVIEW_TOOL_PIN_MISMATCH');
}

export async function archivePreview(directory, {tool, toolSha256}) {
  await noLinks(directory); await verifyPortableTool(tool, toolSha256);
  const files = await resourceInventory(directory);
  const archive = directory + '.zip';
  // Reserve our name first; never update or overwrite someone else's archive.
  const reservation = archive + '.owner';
  await fs.writeFile(reservation, JSON.stringify({directory, createdAt: new Date().toISOString()}), {flag: 'wx'});
  try { await fs.lstat(archive); throw Error('PREVIEW_ARCHIVE_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const logs = [];
  const run = async args => { const output = await invoke(tool, args, path.dirname(directory)); logs.push({args, output}); return output; };
  await run(['a', '-tzip', '-mx=1', '-mmt=2', '-bd', archive, path.basename(directory)]);
  const entries = archiveEntries(await run(['l', '-slt', '-sccUTF-8', archive]));
  const prefix = path.basename(directory);
  if (entries.some(entry => entry.path !== prefix && !entry.path.startsWith(prefix + '/'))) throw Error('PREVIEW_ARCHIVE_ROOT_MISMATCH');
  const extraction = directory + '.verify-' + randomUUID(); await fs.mkdir(extraction);
  await run(['x', '-y', '-bd', '-o' + extraction, archive]);
  const extracted = await resourceInventory(path.join(extraction, prefix));
  if (JSON.stringify(extracted) !== JSON.stringify(files)) throw Error('PREVIEW_EXTRACTED_BYTES_MISMATCH');
  if (JSON.stringify(await resourceInventory(directory)) !== JSON.stringify(files)) throw Error('PREVIEW_FOLDER_CHANGED');
  await verifyPortableTool(tool, toolSha256);
  const result = {format: 'craftmine.portable-preview/1', directory, archive, sha256: await fileHash(archive),
    bytes: (await fs.stat(archive)).size, fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    tool: {path: tool, sha256: toolSha256}, extractedBytesVerified: true, extraction, installerExecuted: false,
    cleanWindowsVerified: false, signature: 'unsigned-local-preview'};
  await fs.writeFile(archive + '.sha256', result.sha256 + '  ' + path.basename(archive) + '\n', {flag: 'wx'});
  await fs.writeFile(archive + '.json', JSON.stringify({...result, logs}, null, 2) + '\n', {flag: 'wx'});
  return result;
}

export async function exportPreview({root, runFile, destination, tool, toolSha256}) {
  root = path.resolve(root); destination = path.resolve(destination);
  const run = await readRelease(root, runFile); await verifySeal(run);
  const assertSource = () => {
    const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', windowsHide: true}).trim();
    if (git(['rev-parse', 'HEAD']) !== run.commit || git(['status', '--porcelain', '--untracked-files=normal'])) throw Error('PREVIEW_CURRENT_CLEAN_SOURCE_REQUIRED');
  };
  assertSource();
  for (const [parent, child] of [[run.output, destination], [destination, run.output]]) {
    const relative = path.relative(parent, child);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('PREVIEW_DESTINATION_OVERLAPS_RELEASE');
  }
  const releaseDirectory = path.dirname(run.runFile);
  const evidence = JSON.parse(await fs.readFile(path.join(releaseDirectory, 'package-evidence.json'), 'utf8'));
  const files = await resourceInventory(path.join(run.output, 'win-unpacked'));
  if (evidence.format !== 'craftmine.package-evidence/2' || evidence.commit !== run.commit ||
      evidence.buildManifestSha256 !== run.buildManifestSha256 || JSON.stringify(evidence.files) !== JSON.stringify(files)) throw Error('PREVIEW_VERIFIED_PACKAGE_REQUIRED');
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'vendor/pi-desktop/apps/desktop/package.json'), 'utf8'));
  const launcher = previewLauncher(metadata.version);
  await noLinks(path.dirname(destination)); await verifyPortableTool(tool, toolSha256);
  // mkdir without recursive deliberately rejects existing destinations.
  await fs.mkdir(destination);
  await fs.cp(run.output, path.join(destination, 'output'), {recursive: true, errorOnExist: true, force: false});
  for (const filename of ['run.json', 'seal.json', 'package-evidence.json']) {
    await fs.copyFile(path.join(releaseDirectory, filename), path.join(destination, filename));
  }
  await fs.writeFile(path.join(destination, 'START-PLAYER-PREVIEW.cmd'), launcher, {flag: 'wx'});
  await fs.writeFile(path.join(destination, 'README.zh-CN.txt'),
    `Craftmine World ${metadata.version}\r\n源码提交：${run.commit}\r\n\r\n完整解压 ZIP 后，双击 START-PLAYER-PREVIEW.cmd。请勿直接从压缩包内运行。\r\n试玩存档使用独立的 FirstCreationPreview 配置目录，不会读取旧试玩存档。\r\n首次运行可直接打开示例世界；素材库支持的素材可不连接 AI 直接加入。\r\n需要 AI 创作时，在应用中连接自己的账户并选择模型。\r\n\r\n这是未签名的 Windows x64 免安装试玩目录，尚未声称通过独立干净 Windows 或新玩家测试。\r\n源码、Blender 源码和第三方许可证位于 output\\win-unpacked\\resources 下。\r\n验证证据记录原构建路径；移动目录不会改变构建身份。\r\n`, {flag: 'wx'});
  await fs.writeFile(path.join(destination, 'DELIVERY.json'), JSON.stringify({format: 'craftmine.preview-delivery/1',
    version: metadata.version, commit: run.commit, buildManifestSha256: run.buildManifestSha256,
    application: 'output/win-unpacked/Craftmine World.exe', launcher: 'START-PLAYER-PREVIEW.cmd',
    signature: 'unsigned-local-preview', cleanWindowsVerified: false, installerExecuted: false,
    sourceRunFile: run.runFile, copiedAt: new Date().toISOString()}, null, 2) + '\n', {flag: 'wx'});
  await verifySeal(run);
  assertSource();
  if (JSON.stringify(await resourceInventory(path.join(destination, 'output'))) !== JSON.stringify((await verifySeal(run)).files)) throw Error('PREVIEW_COPY_MISMATCH');
  return archivePreview(destination, {tool, toolSha256});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}, names = {'--run': 'runFile', '--destination': 'destination', '--archive-tool': 'tool', '--archive-tool-sha256': 'toolSha256'};
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!names[process.argv[i]] || !process.argv[i + 1] || options[names[process.argv[i]]]) throw Error('PREVIEW_ARGUMENT_INVALID');
    options[names[process.argv[i]]] = process.argv[i + 1];
  }
  if (Object.keys(options).length !== 4) throw Error('PREVIEW_ARGUMENTS_REQUIRED');
  console.log(JSON.stringify(await exportPreview({root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), ...options})));
}
