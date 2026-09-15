// Export only a verified, sealed release. Never launch an application or installer.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {fileHash, resourceInventory, safeResourcePath} from './prepare-runtime-resources.mjs';
import {readRelease, verifySeal, noLinks, archiveEntries} from './release-run.mjs';

const ROOT_PLAYER_GUIDE = '00-开始试玩.txt';

export function previewLauncher(version) {
  const match = /^\d+\.\d+\.\d+-preview\.(\d+)$/.exec(version);
  if (!match) throw Error('PREVIEW_VERSION_REQUIRED');
  return [
    '@echo off', 'setlocal DisableDelayedExpansion',
    'for /f "tokens=1 delims==" %%V in (\'set CRAFTMINE_ 2^>nul\') do set "%%V="',
    'for /f "tokens=1 delims==" %%V in (\'set PI_DESKTOP_ 2^>nul\') do set "%%V="',
    `set "CRAFTMINE_DATA_DIR=%LOCALAPPDATA%\\CraftmineWorld-FirstCreationPreview${match[1]}"`,
    'set "ELECTRON_RUN_AS_NODE="', 'set "NODE_OPTIONS="',
    'start "" "%~dp0output\\win-unpacked\\Craftmine World.exe"', '',
  ].join('\r\n');
}

export function newPlayerLauncher() {
  return ['@echo off', 'setlocal DisableDelayedExpansion',
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-NEW-PLAYER.ps1"',
    'if errorlevel 1 pause', ''].join('\r\n');
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

// Trusted build inputs only. The renderer has no route to this exporter.
export async function readPreviewExtras(filename) {
  if (!path.isAbsolute(filename)) throw Error('PREVIEW_EXTRAS_ABSOLUTE_MANIFEST_REQUIRED');
  await noLinks(filename);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.size > 65536) throw Error('PREVIEW_EXTRAS_MANIFEST_BOUND');
  const source = await fs.readFile(filename);
  if (source.length > 65536) throw Error('PREVIEW_EXTRAS_MANIFEST_BOUND');
  const manifest = JSON.parse(source.toString('utf8'));
  if (!manifest || Array.isArray(manifest) || Object.keys(manifest).sort().join(',') !== 'entries,format' ||
      manifest.format !== 'craftmine.preview-extras/1' || !Array.isArray(manifest.entries) ||
      manifest.entries.length < 1 || manifest.entries.length > 16) throw Error('PREVIEW_EXTRAS_MANIFEST_INVALID');
  const names = new Set(); let total = 0;
  for (const entry of manifest.entries) {
    if (!entry || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'bytes,file,name,sha256' ||
        typeof entry.name !== 'string' || (!/^(examples|docs)\/.+/.test(entry.name) && entry.name !== ROOT_PLAYER_GUIDE) || /[<>"|?*]/.test(entry.name) ||
        typeof entry.file !== 'string' || !path.isAbsolute(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 64 * 1024 * 1024) throw Error('PREVIEW_EXTRAS_ENTRY_INVALID');
    safeResourcePath(entry.name);
    const key = entry.name.toLowerCase();
    if (names.has(key) || [...names].some(other => key.startsWith(other + '/') || other.startsWith(key + '/'))) throw Error('PREVIEW_EXTRAS_DUPLICATE_NAME');
    names.add(key); total += entry.bytes;
    if (total > 256 * 1024 * 1024) throw Error('PREVIEW_EXTRAS_TOTAL_BOUND');
    await noLinks(entry.file);
    const info = await fs.lstat(entry.file);
    if (!info.isFile() || info.size !== entry.bytes || await fileHash(entry.file) !== entry.sha256) throw Error('PREVIEW_EXTRAS_PIN_MISMATCH');
  }
  return {entries: manifest.entries, sourceManifestSha256: createHash('sha256').update(source).digest('hex')};
}

export async function copyPreviewExtras(destination, extras) {
  if (!extras) return null;
  const entries = [];
  for (const entry of extras.entries) {
    const target = path.join(destination, entry.name);
    await fs.mkdir(path.dirname(target), {recursive: true}); await noLinks(path.dirname(target)); await noLinks(entry.file);
    await fs.copyFile(entry.file, target, constants.COPYFILE_EXCL);
    const info = await fs.lstat(target);
    if (!info.isFile() || info.size !== entry.bytes || await fileHash(target) !== entry.sha256 || await fileHash(entry.file) !== entry.sha256) throw Error('PREVIEW_EXTRAS_CHANGED_DURING_COPY');
    entries.push({name: entry.name, bytes: entry.bytes, sha256: entry.sha256});
  }
  const proof = {format: 'craftmine.preview-extras-proof/1', sourceManifestSha256: extras.sourceManifestSha256, entries};
  await fs.writeFile(path.join(destination, 'EXTRAS.json'), JSON.stringify(proof, null, 2) + '\n', {flag: 'wx'});
  return proof;
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

export async function exportPreview({root, runFile, destination, tool, toolSha256, extrasManifest}) {
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
  const extras = extrasManifest ? await readPreviewExtras(extrasManifest) : null;
  await noLinks(path.dirname(destination)); await verifyPortableTool(tool, toolSha256);
  // mkdir without recursive deliberately rejects existing destinations.
  await fs.mkdir(destination);
  await fs.cp(run.output, path.join(destination, 'output'), {recursive: true, errorOnExist: true, force: false});
  for (const filename of ['run.json', 'seal.json', 'package-evidence.json']) {
    await fs.copyFile(path.join(releaseDirectory, filename), path.join(destination, filename));
  }
  await fs.writeFile(path.join(destination, 'START-PLAYER-PREVIEW.cmd'), launcher, {flag: 'wx'});
  await fs.writeFile(path.join(destination, 'START-NEW-PLAYER.cmd'), newPlayerLauncher(), {flag: 'wx'});
  await fs.copyFile(path.join(root, 'desktop/new-player-launcher.ps1'), path.join(destination, 'START-NEW-PLAYER.ps1'), constants.COPYFILE_EXCL);
  await fs.writeFile(path.join(destination, 'CONTINUE-PREVIEW27.cmd'), previewLauncher('0.14.4-preview.27'), {flag: 'wx'});
  await fs.writeFile(path.join(destination, 'README.zh-CN.txt'),
    `Craftmine World ${metadata.version}\r\n源码提交：${run.commit}\r\n\r\n完整解压 ZIP 后运行，请勿直接从压缩包内运行。\r\n\r\n【正常试玩／继续本版本】双击 START-PLAYER-PREVIEW.cmd。\r\n使用本版本独立的 FirstCreationPreview 资料目录，再次打开会保留账号配置和世界。\r\n【模拟全新玩家】双击 START-NEW-PLAYER.cmd。\r\n每次创建一份全新的空资料，不带入旧账号、密钥、世界或设置，也不删除旧资料。\r\n资料保存在 %LOCALAPPDATA%\\CraftmineWorld-NewPlayers\\player-唯一编号。\r\n本包 NEW-PLAYER-SESSIONS 内会生成 CONTINUE-唯一编号.cmd；以后双击它，\r\n才能继续刚才那位新玩家。不要再次点 START-NEW-PLAYER 来继续存档。\r\n启动时会显示完整资料目录和对应继续入口。新玩家仍可从 examples 导入七份世界模板。\r\n【继续 preview.27 的旧世界】双击 CONTINUE-PREVIEW27.cmd。\r\n它使用原 FirstCreationPreview27 资料目录，不复制或重置资料。\r\n不要同时打开多个应用实例操作同一份资料。\r\n\r\n需要 AI 创作时，在应用中连接自己的账户并选择模型。\r\n这是未签名的 Windows x64 免安装试玩目录，尚未声称通过独立干净 Windows 测试。\r\n源码、Blender 源码和第三方许可证位于 output\\win-unpacked\\resources 下。\r\n验证证据记录原构建路径；移动目录不会改变构建身份。\r\n`, {flag: 'wx'});
  const extrasProof = await copyPreviewExtras(destination, extras);
  await fs.writeFile(path.join(destination, 'DELIVERY.json'), JSON.stringify({format: 'craftmine.preview-delivery/1',
    version: metadata.version, commit: run.commit, buildManifestSha256: run.buildManifestSha256,
    application: 'output/win-unpacked/Craftmine World.exe', launcher: 'START-PLAYER-PREVIEW.cmd',
    newPlayerLauncher: 'START-NEW-PLAYER.cmd', newPlayerResumeDirectory: 'NEW-PLAYER-SESSIONS',
    previousPlayerLauncher: 'CONTINUE-PREVIEW27.cmd',
    signature: 'unsigned-local-preview', cleanWindowsVerified: false, installerExecuted: false,
    sourceRunFile: run.runFile, copiedAt: new Date().toISOString(), ...(extrasProof ? {extras: extrasProof} : {})}, null, 2) + '\n', {flag: 'wx'});
  await verifySeal(run);
  assertSource();
  if (JSON.stringify(await resourceInventory(path.join(destination, 'output'))) !== JSON.stringify((await verifySeal(run)).files)) throw Error('PREVIEW_COPY_MISMATCH');
  return archivePreview(destination, {tool, toolSha256});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}, names = {'--run': 'runFile', '--destination': 'destination', '--archive-tool': 'tool', '--archive-tool-sha256': 'toolSha256', '--extras-manifest': 'extrasManifest'};
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!names[process.argv[i]] || !process.argv[i + 1] || options[names[process.argv[i]]]) throw Error('PREVIEW_ARGUMENT_INVALID');
    options[names[process.argv[i]]] = process.argv[i + 1];
  }
  if (['runFile', 'destination', 'tool', 'toolSha256'].some(name => !options[name])) throw Error('PREVIEW_ARGUMENTS_REQUIRED');
  console.log(JSON.stringify(await exportPreview({root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), ...options})));
}
