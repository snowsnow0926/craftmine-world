// F task: the three authored bases must expose one versioned engine/base/asset/
// state contract, exactly one blank start each, and a catalog that matches the
// manifests byte for byte. Pure logic: no engine process is started.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  BASE_CONTRACT_FORMAT,
  ENGINE_CONTRACT,
  assertTemplateInitialState,
  baseContentHash,
  loadBaseContracts,
  validateBaseContract,
} from '../../../desktop/godot/shared/base_contract.mjs';
import { buildCatalogs } from '../../../desktop/godot/shared/tools/build-base-catalog.mjs';

const BASES_DIR = 'desktop/godot/bases';
const EXPECTED_BASES = ['first-person', 'side-view', 'top-down'];

test('every base manifest satisfies the frozen contract', () => {
  const { bases, issues } = loadBaseContracts(BASES_DIR);
  assert.deepEqual(issues, [], `contract issues:\n${issues.map((entry) => `${entry.code} ${entry.where}: ${entry.message}`).join('\n')}`);
  assert.deepEqual(bases.map((entry) => entry.contract.baseId).sort(), EXPECTED_BASES);
  for (const { contract } of bases) {
    assert.equal(contract.format, BASE_CONTRACT_FORMAT);
    assert.equal(contract.engine.version, ENGINE_CONTRACT.version);
    assert.equal(contract.engine.renderer, ENGINE_CONTRACT.renderer);
    assert.ok(contract.protocols.world, `${contract.baseId} declares a world format`);
    assert.equal(contract.state.format, contract.protocols.state);
    assert.ok(contract.state.preserved.length > 0, `${contract.baseId} lists preserved state fields`);
    assert.ok(contract.assets.manifest && fs.existsSync(path.join(BASES_DIR, contract.baseId, contract.assets.manifest)));
    assert.ok(contract.assets.license && fs.existsSync(path.join(BASES_DIR, contract.baseId, contract.assets.license)));
  }
});

test('each base ships exactly one blank start and one example', () => {
  const { bases } = loadBaseContracts(BASES_DIR);
  for (const { contract } of bases) {
    const kinds = contract.templates.map((template) => template.kind);
    assert.equal(kinds.filter((kind) => kind === 'blank-start').length, 1, `${contract.baseId} blank start`);
    assert.equal(kinds.filter((kind) => kind === 'example').length, 1, `${contract.baseId} example`);
  }
});

test('a blank start that ships rewards or completed quests is rejected', () => {
  const doctored = {
    kind: 'blank-start',
    rooms: [
      {
        id: 'start',
        targets: [{ id: 'dummy', rewardId: 'reward_1', grants: { counters: { coins: 1 } } }],
        rewards: [{ id: 'reward_1' }],
        abilities: [],
      },
    ],
  };
  const result = assertTemplateInitialState({ baseId: 'side-view', templateId: 'blank', world: doctored });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((entry) => entry.code).sort(),
    ['blank-rewards', 'blank-targets'],
  );
  const claimed = assertTemplateInitialState({
    baseId: 'top-down',
    templateId: 'blank',
    world: { initialProgress: { quests: [{ id: 'q', status: 'completed', rewarded: true }], grantedRewards: { q: true } } },
  });
  assert.equal(claimed.ok, false);
  assert.ok(claimed.issues.some((entry) => entry.code === 'blank-completed-quest'));
  assert.ok(claimed.issues.some((entry) => entry.code === 'blank-reward-ledger'));
  const clean = assertTemplateInitialState({
    baseId: 'side-view',
    templateId: 'blank',
    world: { kind: 'blank-start', rooms: [{ id: 'start', targets: [], rewards: [], abilities: [] }] },
  });
  assert.deepEqual(clean.issues, []);
});

test('the committed catalogs match the manifests and every declared file', () => {
  const { baseCatalog, componentCatalog } = buildCatalogs({ basesDir: BASES_DIR });
  const onDisk = JSON.parse(fs.readFileSync(path.join(BASES_DIR, 'base-catalog.json'), 'utf8'));
  const componentsOnDisk = JSON.parse(fs.readFileSync(path.join(BASES_DIR, 'component-catalog.json'), 'utf8'));
  assert.deepEqual(onDisk, baseCatalog, 'base-catalog.json is stale; run build-base-catalog.mjs');
  assert.deepEqual(componentsOnDisk, componentCatalog, 'component-catalog.json is stale; run build-base-catalog.mjs');
  assert.deepEqual(baseCatalog.bases.map((entry) => entry.baseId), EXPECTED_BASES);
  for (const base of baseCatalog.bases) {
    assert.match(base.contentHash, /^[0-9a-f]{64}$/);
    assert.ok(base.templates.length >= 2);
    assert.ok(base.components.length >= 5, `${base.baseId} declares reusable components`);
    for (const template of base.templates) {
      assert.ok(template.entryScene.startsWith('res://'));
      assert.equal(typeof template.initialState, 'object');
    }
  }
  for (const component of componentCatalog.components) {
    assert.ok(component.files.length > 0, `${component.id} declares files`);
    for (const file of component.files) {
      assert.ok(file.sha256, `${component.id} hashes ${file.path}`);
      assert.ok(fs.existsSync(path.join(BASES_DIR, component.baseId, file.path)), `${component.id} file exists: ${file.path}`);
    }
  }
});

test('the contract validator reports a missing state or asset contract instead of guessing', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(BASES_DIR, 'first-person', 'base_manifest.json'), 'utf8'));
  const broken = JSON.parse(JSON.stringify(manifest));
  delete broken.stateFormat;
  delete broken.contract.assets;
  const result = validateBaseContract(broken, { baseDir: path.join(BASES_DIR, 'first-person') });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === 'missing-state-contract'));
  assert.ok(result.issues.some((entry) => entry.code === 'missing-asset-manifest'));
});

test('a component file that leaves its base directory is rejected', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(BASES_DIR, 'side-view', 'manifest.json'), 'utf8'));
  const broken = JSON.parse(JSON.stringify(manifest));
  broken.components[0].files = ['../../outside.gd'];
  const result = validateBaseContract(broken);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === 'component-file-path'));
});

test('content hash covers every declared component and asset file', () => {
  const { bases } = loadBaseContracts(BASES_DIR);
  const { contract } = bases.find((entry) => entry.contract.baseId === 'side-view');
  const first = baseContentHash(path.join(BASES_DIR, 'side-view'), contract);
  const second = baseContentHash(path.join(BASES_DIR, 'side-view'), contract);
  assert.deepEqual(first, second);
  assert.ok(first.files.includes('scripts/world/target.gd'));
  assert.ok(first.files.includes('assets/ASSET_MANIFEST.json'));
});
