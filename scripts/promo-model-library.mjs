#!/usr/bin/env node
// Explicit operator import of previously approved model data, never an author
// filesystem tool or a claim that this turn generated the reused geometry.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readState, acquireLock} from './lib/codex-world-session.mjs';
import {CodexWorldHost} from './lib/codex-world-host.mjs';

const root = path.resolve(import.meta.dirname, '..');
const [mode, dataArg, assetName] = process.argv.slice(2);
if (!['list', 'import'].includes(mode)) throw Error('Usage: promo-model-library.mjs list | import ABSOLUTE_DATA_DIR ASSET_NAME');
const catalog = JSON.parse(await fs.readFile(path.join(root, 'test-results/codex-promo/reusable-assets/provenance.json'), 'utf8'));
if (mode === 'list') {
  console.log(JSON.stringify(catalog, null, 2));
} else {
  if (!dataArg || !path.isAbsolute(dataArg) || !/^[a-z][a-z0-9-]{0,63}$/.test(assetName ?? '')) throw Error('INVALID_IMPORT_SELECTION');
  const asset = catalog.assets.find(item => item.name === assetName);
  if (!asset || !path.isAbsolute(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')) throw Error('UNVERIFIED_LIBRARY_ASSET');
  const bytes = await fs.readFile(asset.path);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== asset.sha256 || bytes.length !== asset.bytes || bytes.length > 4 * 1024 * 1024 ||
      bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
    throw Error('MODEL_DATA_INTEGRITY_FAILED');
  const data = path.resolve(dataArg), state = readState(data), unlock = acquireLock(data);
  const context = {projectId: state.projectId, sessionId: state.sessionId, turnId: randomUUID()};
  const host = new CodexWorldHost({state, data});
  let begun = false, completed = false;
  try {
    if (state.active) throw Error('AUTHOR_TURN_ACTIVE');
    await host.start({engines: false});
    if (!isDeepStrictEqual(await host.sourceIdentity(), state.sourceIdentity)) throw Error('SOURCE_IDENTITY_CHANGED');
    await host.begin(context, 'Import the operator-selected existing model asset: ' + assetName); begun = true;
    const worldBefore = await host.core.call('world.read', {id: state.worldId});
    const index = await host.core.call('godotProject.index', {context, worldId: state.worldId});
    const target = 'assets/library/' + assetName + '.glb';
    const content = index.content;
    if (index.worldId !== state.worldId || !content?.repoId || content.branchId !== 'main' || !/^[a-f0-9]{40,64}$/.test(content.contentOid ?? ''))
      throw Error('CONTENT_IDENTITY_REQUIRED');
    const toolCallId = 'library-' + randomUUID();
    const imported = await host.core.call('godotProject.applyFiles', {context, worldId: state.worldId,
      toolCallId, revision: index.revision, manifestHash: index.manifestHash,
      operation: {operationId: 'asset-' + createHash('sha256').update(JSON.stringify([context, toolCallId])).digest('hex'),
        worldId: state.worldId, repoId: content.repoId, branchId: content.branchId, expectedHeadOid: content.contentOid,
        expectedAppliedOid: null, expectedProgressRevision: null},
      files: [{path: target, bytesBase64: bytes.toString('base64'), expectedHash: null}]}, 60000);
    const persisted = createHash('sha256');
    let offset = 0, storedBytes = 0;
    do {
      const page = await host.core.call('godotProject.read', {context, worldId: state.worldId,
        revision: imported.revision, manifestHash: imported.manifestHash, path: target, offset, limit: 16000});
      if (page.encoding !== 'base64') throw Error('MODEL_READ_ENCODING_MISMATCH');
      const chunk = Buffer.from(page.bytesBase64, 'base64'); persisted.update(chunk); storedBytes += chunk.length;
      offset = page.nextOffset;
    } while (offset !== null);
    if (storedBytes !== bytes.length || persisted.digest('hex') !== hash) throw Error('PERSISTED_MODEL_HASH_MISMATCH');
    const worldAfter = await host.core.call('world.read', {id: state.worldId});
    if (!isDeepStrictEqual(worldBefore.world.snapshot, worldAfter.world.snapshot) ||
        !isDeepStrictEqual(worldBefore.world.build, worldAfter.world.build)) throw Error('FORMAL_WORLD_CHANGED_DURING_ASSET_IMPORT');
    const receipt = {format: 'craftmine.promo-model-reuse/1', worldId: state.worldId, source: asset,
      target, sha256: hash, bytes: bytes.length, imported, generatedThisTurn: false,
      persistedHashVerified: true, applied: false, formalWorldUnchanged: true, importedAt: new Date().toISOString()};
    const receipts = path.join(data, 'asset-imports'); await fs.mkdir(receipts, {recursive: true});
    await fs.writeFile(path.join(receipts, context.turnId + '.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
    completed = true; console.log(JSON.stringify(receipt));
  } finally {
    try {if (begun) await host.end(context, completed ? 'completed' : 'error');}
    finally {try {await host.stop();} finally {unlock();}}
  }
}
