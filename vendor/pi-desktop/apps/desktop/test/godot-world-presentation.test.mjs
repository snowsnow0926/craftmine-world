import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register, stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const layers = await import('../electron/main/main-window-layers.ts');
const immersion = await import('../shared/craftmine-immersion.ts');
const {createImmersionPauseController} = await import('../electron/main/immersion-pause-controller.ts');
const source = stripTypeScriptTypes(await readFile(new URL('../electron/main/godot-world-view-host.ts', import.meta.url), 'utf8'), {mode: 'transform'})
  .replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, '').replace(/^export /gm, '');
const Host = vm.runInNewContext(source + '\nGodotWorldViewHost', {
  ...layers, ...immersion, createImmersionPauseController, WORLD_CHROME_HEIGHT: 76,
});

function fixture() {
  const moves = [], focus = [];
  const view = name => ({name, webContents: {
    isDestroyed: () => false, isFocused: () => false, focus: () => focus.push(name), send() {},
  }, setBounds(bounds) { this.bounds = bounds; }});
  const renderer = view('renderer'), plugin = view('plugin');
  const window = {isDestroyed: () => false, isFocused: () => false, contentView: {
    children: [renderer, plugin],
    addChildView(child, index = this.children.length) {
      moves.push(child.name);
      const previous = this.children.indexOf(child);
      if (previous >= 0) this.children.splice(previous, 1);
      this.children.splice(index, 0, child);
    },
    removeChildView(child) { this.children = this.children.filter(entry => entry !== child); },
  }};
  layers.registerMainLayers(window, renderer, {headless: true});
  const host = new Host({window: () => window});
  host.visible = true;
  host.bounds = {x: 0, y: 0, width: 1280, height: 720};
  const state = {active: true, overlay: 'closed', overlayBounds: null};
  host.immersion = state;
  layers.setMainImmersion(window, state);
  const instance = name => ({alive: true, view: view(name)});
  const order = () => window.contentView.children.map(child => child.name);
  return {host, window, renderer, plugin, moves, focus, instance, order};
}

test('cold restored play promotes an already attached world above opaque plugin chrome', () => {
  const f = fixture(), ready = f.instance('ready');
  f.host.pending = ready;
  f.host.attachStagingView(ready);
  assert.deepEqual(f.order(), ['ready', 'renderer', 'plugin']);
  assert.notEqual(layers.mainInputContents(f.window), ready.view.webContents);
  // Same handoff as start(): the restored view is already attached before it
  // becomes current. No pause-menu or hide/show operation repairs the order.
  f.host.pending = null;
  f.host.current = ready;
  f.host.applyBounds();
  assert.deepEqual(f.order(), ['renderer', 'plugin', 'ready']);
  assert.equal(layers.mainInputContents(f.window), ready.view.webContents);
  assert.deepEqual(JSON.parse(JSON.stringify(ready.view.bounds)), {x: 0, y: 0, width: 1280, height: 720});
  f.moves.length = 0;
  for (let i = 0; i < 10; i++) f.host.applyBounds();
  assert.deepEqual(f.moves, [], 'unchanged bounds ownership must not reorder native children');
  assert.deepEqual(f.focus, []);
});

test('candidate staging remains behind the current world until preview owns presentation', () => {
  const f = fixture(), current = f.instance('current'), candidate = f.instance('candidate');
  f.host.current = current;
  f.host.applyBounds();
  f.host.pending = candidate;
  f.host.stagedRequest = {};
  f.host.applyBounds();
  assert.deepEqual(f.order(), ['candidate', 'renderer', 'plugin', 'current']);
  assert.equal(layers.mainInputContents(f.window), current.view.webContents);
  f.host.setCandidateVisible(true);
  assert.deepEqual(f.order(), ['renderer', 'plugin', 'candidate']);
  assert.equal(layers.mainInputContents(f.window), candidate.view.webContents);
  // The final committed promotion keeps the exact preview view; it must stay
  // above the plugin without a detach/reload or user pause-menu round trip.
  f.host.current = candidate;
  f.host.pending = null;
  f.host.stagedRequest = null;
  f.host.candidateVisible = false;
  f.host.applyBounds();
  assert.deepEqual(f.order(), ['renderer', 'plugin', 'candidate']);
  assert.deepEqual(f.focus, []);
});

test('startup promotion preserves trusted overlay priority and does not churn on layout reports', () => {
  const f = fixture(), ready = f.instance('ready');
  const blocked = {active: true, overlay: 'closed', blocked: true, overlayBounds: null};
  f.host.immersion = blocked;
  layers.setMainImmersion(f.window, blocked);
  f.host.pending = ready;
  f.host.attachStagingView(ready);
  f.host.pending = null;
  f.host.current = ready;
  f.host.applyBounds();
  assert.deepEqual(f.order(), ['plugin', 'ready', 'renderer']);
  assert.equal(layers.mainInputContents(f.window), f.renderer.webContents);
  f.moves.length = 0;
  for (let i = 0; i < 10; i++) f.host.applyBounds();
  assert.deepEqual(f.moves, []);
  assert.deepEqual(f.focus, []);
});
