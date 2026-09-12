// P3 regression: the private acceptance capture must return a real frame.
//
// The real dog run (desktop-native-p8-C9K8vT) failed the capture assertion with
// `0 !== 1280`: `headlessCapture` slept for a fixed 350ms and returned whatever
// `capturePage()` produced, and an offscreen compositor that has not painted yet
// answers with an empty image. This exercises the real host class with a
// scripted compositor and pins the replacement contract:
//
//   * an empty frame, and a right-sized but unpainted buffer, are never accepted;
//     the read is retried until a real frame of the requested size arrives, and
//     the retry waits on the compositor's own `paint` signal;
//   * a frame that never arrives fails with GODOT_CAPTURE_EMPTY_FRAME at the
//     bounded deadline, and a mid-capture instance change or a destroyed view
//     fails explicitly: never a bad image, never a silent success;
//   * every exit path releases the paint listener and its timer, and restores
//     captureBounds, syncHolds, the game view bounds and the owner window size.
//
// No Electron runtime, no window, no input: the host drives fakes, and the fakes
// throw if the capture ever tries to show, focus or activate anything or to send
// an input event.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {NO_IMMERSION} from '../../../vendor/pi-desktop/apps/desktop/shared/craftmine-immersion.ts';
import {createImmersionPauseController} from '../../../vendor/pi-desktop/apps/desktop/electron/main/immersion-pause-controller.ts';
import {PRIVATE_PLAY_OPS} from '../../../vendor/pi-desktop/apps/desktop/electron/main/headless-play-action.ts';

const source = await readFile(new URL('../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts', import.meta.url), 'utf8');
const compiled = stripTypeScriptTypes(source, {mode: 'transform'})
  .replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, '')
  .replace(/^export /gm, '');

const WIDTH = 1280, HEIGHT = 720;
const ORIGINAL_VIEW = {x: 11, y: 22, width: 320, height: 240};
const ORIGINAL_CONTENT = [1400, 900];
const ORIGINAL_MINIMUM = [900, 600];

/** A NativeImage stand-in; `tag` proves which frame was accepted. */
function image(width, height, {painted = true, tag = 'frame'} = {}) {
  const bytes = Buffer.alloc(width * height * 4);
  if (painted) {
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      bytes[offset] = (pixel * 37) % 251;
      bytes[offset + 1] = (pixel * 91) % 253;
      bytes[offset + 2] = (pixel * 13) % 249;
      bytes[offset + 3] = 255;
    }
  }
  return {tag, getSize: () => ({width, height}), toBitmap: () => bytes, toPNG: () => Buffer.from(`${tag}:${width}x${height}`)};
}

function fixture({captureReadyMs = 400, frames = [], failContentSizeAt = null, fullscreen = false} = {}) {
  const events = [], hooks = {onCapture: null, onRequest: null};
  const contents = new EventEmitter();
  const queued = [...frames];
  const hanging = [];
  let ownerDestroyed = false, viewDestroyed = false, invalidations = 0, reads = 0, sizeCalls = 0, painting = false;
  let viewBounds = {...ORIGINAL_VIEW};
  let contentSize = [...ORIGINAL_CONTENT], minimumSize = [...ORIGINAL_MINIMUM];

  const refuse = name => () => { throw new Error(`the capture must not call ${name}`); };
  Object.assign(contents, {
    isOffscreen: () => true,
    isDestroyed: () => viewDestroyed,
    isPainting: () => painting,
    getBackgroundThrottling: () => false,
    invalidate: () => { invalidations += 1; },
    sendInputEvent: refuse('sendInputEvent'),
    focus: refuse('focus'),
    setWindowOpenHandler: () => ({action: 'deny'}),
    loadURL: async () => {},
    send: () => {},
    isFocused: () => false,
    capturePage: () => {
      reads += 1;
      if (hooks.onCapture) hooks.onCapture({reads, invalidations, contents});
      const next = queued.shift();
      // `hang` is a read that never settles: the loop must still reach its
      // deadline, and the late result must never be accepted or hold a resource.
      if (next === 'hang') return new Promise(resolve => { hanging.push(resolve); });
      return Promise.resolve(next ?? image(WIDTH, HEIGHT, {tag: 'frame-final'}));
    },
  });

  const owner = {
    isDestroyed: () => ownerDestroyed,
    isVisible: () => false,
    isFocusable: () => false,
    isFocused: () => false,
    isFullScreen: () => fullscreen,
    setFullScreen: value => { fullscreen=value; events.push(`fullscreen:${value}`); },
    show: refuse('show'),
    showInactive: refuse('showInactive'),
    focus: refuse('focus'),
    restore: refuse('restore'),
    moveTop: refuse('moveTop'),
    setAlwaysOnTop: refuse('setAlwaysOnTop'),
    flashFrame: refuse('flashFrame'),
    webContents: {isOffscreen: () => true, sendInputEvent: refuse('sendInputEvent'), focus: refuse('focus')},
    getContentSize: () => [...contentSize],
    setContentSize: (width, height) => {
      sizeCalls += 1;
      if (fullscreen) return; // Windows keeps the fullscreen compositor size.
      // `failContentSizeAt` targets one call, so the restore path can be the one
      // that fails without the capture itself failing first.
      if (sizeCalls === failContentSizeAt) throw new Error('the window refused to resize');
      contentSize = [width, height];
    },
    getMinimumSize: () => [...minimumSize],
    setMinimumSize: (width, height) => { minimumSize = [width, height]; },
    contentView: {
      children: [],
      addChildView(view) { if (!this.children.includes(view)) this.children.push(view); },
      removeChildView(view) { const at = this.children.indexOf(view); if (at >= 0) this.children.splice(at, 1); },
    },
  };

  const identity = {worldId: 'world-dog', buildId: 'build-a', instanceId: 'instance-a'};
  const view = {
    getBounds: () => ({...viewBounds}),
    setBounds: bounds => { viewBounds = {...bounds}; },
    webContents: contents,
  };
  // A displayed game view: the capture observes whether it is still attached.
  owner.contentView.addChildView(view);
  const instance = {
    ...identity, alive: true, protocol: 'craftmine.godot-runtime/2', view,
    runtime: {...identity, url: 'http://127.0.0.1/x',
      request: async (op, args) => {
        events.push(`request:${op}`);
        if (hooks.onRequest) hooks.onRequest({op, args});
        return {result: {baseId: 'top-down', payload: {surfaceSize: [WIDTH, HEIGHT], args}}};
      },
      snapshot: async () => ({result: {state: {coins: 1}}})},
  };

  const context = {module: {exports: {}}, Error, setTimeout, clearTimeout, setInterval, clearInterval, console,NO_IMMERSION,createImmersionPauseController,PRIVATE_PLAY_OPS,
    process: {env: {CRAFTMINE_HEADLESS_TEST: '1'}},
    join: (...parts) => parts.join('/'), resolve: value => value, sep: '/', realpath: async value => value,
    WORLD_CHROME_HEIGHT: 76, GODOT_WORLD_MESSAGE_CHANNEL: 'message', GODOT_WORLD_DETACH_CHANNEL: 'detach',
    GODOT_WORLD_FULLSCREEN_EXIT_CHANNEL: 'fullscreen', godotWorldScopeArgument: () => '--scope', isHeadlessAcceptance: () => true,
    createWorldRuntime: async () => instance.runtime,
    syncMainInputFocus: () => {}, raiseMainOverlay: () => {}};
  vm.runInNewContext(`${compiled}\nmodule.exports={GodotWorldViewHost};`, context);
  const host = new context.module.exports.GodotWorldViewHost({window: () => owner, allowedRoots: () => ['/tmp'], captureReadyMs});
  host.current = instance;

  return {
    host, instance, contents, owner, events, hooks,
    frame: tag => image(WIDTH, HEIGHT, {tag}),
    destroyOwner: () => { ownerDestroyed = true; },
    destroyView: () => { viewDestroyed = true; },
    setPainting: value => { painting = value; },
    emitPaint: painted => contents.emit('paint', {}, {}, painted),
    /** Resolves a read that was deliberately left hanging; that result is late. */
    releaseHang: (tag = 'late') => { const resolve = hanging.shift(); if (resolve) resolve(image(WIDTH, HEIGHT, {tag})); },
    hangingReads: () => hanging.length,
    switchInstance: () => {
      const other = {...identity, instanceId: 'instance-b', alive: true, view};
      host.current = other;
      return other;
    },
    state: () => ({viewBounds: {...viewBounds}, contentSize: [...contentSize], minimumSize: [...minimumSize],
      captureBounds: host.captureBounds, syncHolds: host.syncHolds, paintListeners: contents.listenerCount('paint'),
      invalidations, reads}),
  };
}

function assertRestored(f, label) {
  const state = f.state();
  assert.equal(state.captureBounds, null, label + ': capture lock');
  assert.equal(state.syncHolds, 0, label + ': sync hold');
  assert.equal(state.paintListeners, 0, label + ': paint listener');
  if (!f.owner.isDestroyed()) {
    assert.deepEqual(state.contentSize, ORIGINAL_CONTENT, label + ': owner size');
    assert.deepEqual(state.minimumSize, ORIGINAL_MINIMUM, label + ': minimum size');
  }
  if (!f.contents.isDestroyed()) assert.deepEqual(state.viewBounds, ORIGINAL_VIEW, label + ': view bounds');
}

test('an empty capture is retried until a real frame arrives, then everything is restored', async () => {
  const f = fixture({frames: [image(0, 0, {tag: 'empty-1'}), image(0, 0, {tag: 'empty-2'}), image(WIDTH, HEIGHT, {tag: 'real'})]});
  const capture = await f.host.headlessCapture(WIDTH, HEIGHT);
  assert.equal(capture.width, WIDTH);
  assert.equal(capture.height, HEIGHT);
  assert.equal(capture.pixelStats.bytes, WIDTH * HEIGHT * 4);
  assert.ok(capture.pixelStats.sampledColors > 1, `sampledColors=${capture.pixelStats.sampledColors}`);
  assert.equal(Buffer.from(capture.pngBase64, 'base64').toString('utf8'), `real:${WIDTH}x${HEIGHT}`, 'only the real frame may be returned');
  assert.deepEqual(capture.viewportObservation?.payload?.surfaceSize, [WIDTH, HEIGHT]);
  assert.equal(f.state().invalidations, 3, 'every attempt re-reads the compositor');
  assertRestored(f, 'empty-then-real');
});

test('a detached view is temporarily attached to its hidden owner and detached after capture', async () => {
  const f = fixture({frames: [image(WIDTH, HEIGHT)]});
  f.owner.contentView.removeChildView(f.instance.view);
  f.hooks.onCapture = () => assert.ok(f.owner.contentView.children.includes(f.instance.view));
  await f.host.headlessCapture(WIDTH, HEIGHT);
  assert.equal(f.owner.contentView.children.includes(f.instance.view), false);
  assertRestored(f, 'detached');
});

test('a right-sized but unpainted buffer is never accepted', async () => {
  const f = fixture({frames: [image(WIDTH, HEIGHT, {painted: false, tag: 'unpainted-1'}), image(WIDTH, HEIGHT, {painted: false, tag: 'unpainted-2'}), image(WIDTH, HEIGHT, {tag: 'painted'})]});
  const capture = await f.host.headlessCapture(WIDTH, HEIGHT);
  assert.equal(Buffer.from(capture.pngBase64, 'base64').toString('utf8'), `painted:${WIDTH}x${HEIGHT}`, 'an unpainted buffer must never be returned');
  assert.equal(f.state().invalidations, 3);
  assertRestored(f, 'unpainted-then-painted');
});

test('a frame that never arrives fails at the deadline instead of returning a size', async () => {
  const f = fixture({captureReadyMs: 250, frames: [image(0, 0), image(0, 0), image(0, 0), image(0, 0), image(0, 0), image(0, 0)]});
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), error => {
    assert.match(String(error.message), /^GODOT_CAPTURE_EMPTY_FRAME:/);
    assert.match(String(error.message), /no painted 1280x720 frame from instance instance-a/);
    assert.match(String(error.message), /attempts/);
    assert.match(String(error.message), /image 0x0/);
    return true;
  });
  assert.ok(f.state().reads >= 2, 'the deadline path must have retried before failing');
  assertRestored(f, 'deadline');
});

test('the retry waits on the compositor paint signal', async () => {
  // The budget is large on purpose: if the retry were driven by a fixed sleep the
  const f = fixture({captureReadyMs: 2000, frames: [image(0, 0, {tag: 'empty'}), image(WIDTH, HEIGHT, {tag: 'real'})]});
  const capture = f.host.headlessCapture(WIDTH, HEIGHT);
  let sawPaintListener = 0;
  const started = Date.now();
  while (Date.now() - started < 1000 && f.state().reads < 2) {
    if (f.contents.listenerCount('paint') === 1) { sawPaintListener = 1; f.contents.emit('paint'); break; }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(sawPaintListener, 1, 'the retry must wait on the compositor paint signal');
  const result = await capture;
  assert.equal(result.width, WIDTH);
  assert.equal(Buffer.from(result.pngBase64, 'base64').toString('utf8'), `real:${WIDTH}x${HEIGHT}`);
  assertRestored(f, 'paint-driven');
});

test('a mid-capture instance change fails explicitly, never with a foreign frame', async () => {
  const f = fixture({frames: [image(0, 0), image(WIDTH, HEIGHT, {tag: 'foreign'})]});
  f.hooks.onCapture = ({reads}) => { if (reads === 2) f.switchInstance(); };
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_WORLD_CHANGED/);
  assertRestored(f, 'instance-switch');
});

test('a destroyed view fails explicitly instead of returning an empty image', async () => {
  const f = fixture({frames: [image(0, 0), image(WIDTH, HEIGHT, {tag: 'after-destroy'})]});
  f.hooks.onCapture = ({reads}) => { if (reads === 2) f.destroyView(); };
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_CAPTURE_VIEW_GONE/);
  assertRestored(f, 'view-destroyed');
});

test('an owner window destroyed mid-capture still releases every hold', async () => {
  const f = fixture({frames: [image(0, 0), image(WIDTH, HEIGHT, {tag: 'survives'})]});
  f.hooks.onCapture = ({reads}) => { if (reads === 2) f.destroyOwner(); };
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_CAPTURE_OWNER_NOT_ISOLATED/);
  const state = f.state();
  assert.equal(state.captureBounds, null);
  assert.equal(state.syncHolds, 0);
  assert.equal(state.paintListeners, 0);
  assert.deepEqual(state.viewBounds, ORIGINAL_VIEW, 'the view bounds are restored even without the owner');
});

test('a second capture cannot steal the view, and the first still restores', async () => {
  const f = fixture({frames: [image(0, 0), image(WIDTH, HEIGHT, {tag: 'first'})]});
  const first = f.host.headlessCapture(WIDTH, HEIGHT);
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_CAPTURE_ALREADY_RUNNING/);
  const capture = await first;
  assert.equal(Buffer.from(capture.pngBase64, 'base64').toString('utf8'), `first:${WIDTH}x${HEIGHT}`);
  assertRestored(f, 'concurrent');
});

test('a capture is refused when the owner window is visible, focusable or gone', async () => {
  const f = fixture({frames: [image(WIDTH, HEIGHT)]});
  f.owner.isVisible = () => true;
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_CAPTURE_OWNER_NOT_ISOLATED/);
  f.owner.isVisible = () => false;
  f.owner.isFocusable = () => true;
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_CAPTURE_OWNER_NOT_ISOLATED/);
  f.owner.isFocusable = () => false;
  f.destroyOwner();
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_CAPTURE_OWNER_NOT_ISOLATED/);
  assert.equal(f.state().reads, 0, 'a refused capture must not touch the compositor');
});

test('a capture is refused outside headless acceptance, offscreen state or a live instance', async () => {
  const f = fixture({frames: [image(WIDTH, HEIGHT)]});
  f.contents.isOffscreen = () => false;
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_HEADLESS_CAPTURE_REFUSED/);
  f.contents.isOffscreen = () => true;
  await assert.rejects(f.host.headlessCapture(100, 100), /GODOT_HEADLESS_CAPTURE_REFUSED/);
  f.instance.alive = false;
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_CAPTURE_RUNTIME_NOT_RUNNING/);
});

/** Waits until the readiness loop is waiting on its paint listener. */
async function waitForPaintWait(f, budgetMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    if (f.contents.listenerCount('paint') === 1) return true;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  return false;
}

test('a read that never settles is bounded by the same deadline and its late result is dropped', async () => {
  const late = [];
  const collect = reason => late.push(String(reason && reason.message ? reason.message : reason));
  process.on('unhandledRejection', collect);
  try {
    const f = fixture({captureReadyMs: 250, frames: ['hang']});
    const started = Date.now();
    await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), error => {
      assert.match(String(error.message), /^GODOT_CAPTURE_EMPTY_FRAME:/, 'a hanging read must still fail at the deadline');
      assert.match(String(error.message), /capture read timed out at the deadline/);
      assert.match(String(error.message), /after 1 attempts/);
      return true;
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `the hanging read must be bounded, took ${elapsed}ms`);
    assert.equal(f.state().reads, 1, 'a hanging read is not re-read');
    assert.equal(f.hangingReads(), 1);
    // The read resolves only after the deadline: it must be dropped, never
    // accepted, and must not reclaim any resource.
    f.releaseHang('late-frame');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(late, [], `a late read must not raise an unhandled rejection: ${JSON.stringify(late)}`);
    assert.equal(f.state().reads, 1, 'a late read must not trigger another attempt');
    assertRestored(f, 'hanging-read');
  } finally {
    process.off('unhandledRejection', collect);
  }
});

test('a paint that already covers the viewport is accepted without a second read', async () => {
  const f = fixture({captureReadyMs: 2000, frames: [image(0, 0, {tag: 'empty'})]});
  const capture = f.host.headlessCapture(WIDTH, HEIGHT);
  assert.equal(await waitForPaintWait(f), true, 'the loop must wait on the paint signal');
  f.emitPaint(image(WIDTH, HEIGHT, {tag: 'paint-frame'}));
  const result = await capture;
  assert.equal(Buffer.from(result.pngBase64, 'base64').toString('utf8'), `paint-frame:${WIDTH}x${HEIGHT}`,
    'the compositor paint image is real frame evidence');
  assert.equal(result.width, WIDTH);
  assert.equal(result.height, HEIGHT);
  assert.equal(f.state().reads, 1, 'an accepted paint image needs no further read');
  assertRestored(f, 'paint-frame');
});

test('a partial paint image is not evidence and the read is retried', async () => {
  const f = fixture({captureReadyMs: 2000, frames: [image(0, 0, {tag: 'empty'}), image(WIDTH, HEIGHT, {tag: 'read-frame'})]});
  const capture = f.host.headlessCapture(WIDTH, HEIGHT);
  assert.equal(await waitForPaintWait(f), true);
  // A dirty-area image (not the whole viewport) must be ignored, never returned.
  f.emitPaint(image(64, 64, {tag: 'dirty-area'}));
  const result = await capture;
  assert.equal(Buffer.from(result.pngBase64, 'base64').toString('utf8'), `read-frame:${WIDTH}x${HEIGHT}`);
  assert.equal(f.state().reads, 2, 'a partial paint image forces another read');
  assertRestored(f, 'partial-paint');
});

test('the deadline failure carries the paintable state and the attempt count', async () => {
  const f = fixture({captureReadyMs: 250, frames: [image(0, 0), image(0, 0), image(0, 0), image(0, 0)]});
  f.setPainting(false);
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), error => {
    const message = String(error.message);
    assert.match(message, /^GODOT_CAPTURE_EMPTY_FRAME:/);
    // The absence of a frame is diagnosed, not assumed: the view's paintability,
    // its attachment and the capture's own size claims are in the failure.
    assert.match(message, /painting=false throttled=false offscreen=true/);
    assert.match(message, /attached=true/);
    assert.match(message, /view 1280x720/);
    assert.match(message, /capture image 0x0/);
    assert.match(message, /after [3-9] attempts/);
    return true;
  });
  assertRestored(f, 'deadline-diagnostics');
});

test('a restore failure is reported and never blocks the release', async () => {
  const f = fixture({failContentSizeAt: 2, frames: [image(WIDTH, HEIGHT, {tag: 'ok'})]});
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), error => {
    assert.match(String(error.message), /^GODOT_CAPTURE_RESTORE_FAILED:/);
    assert.match(String(error.message), /owner size: the window refused to resize/);
    return true;
  });
  const state = f.state();
  assert.equal(state.captureBounds, null, 'the capture lock is still released');
  assert.equal(state.syncHolds, 0, 'the sync hold is still released');
  assert.equal(state.paintListeners, 0, 'the paint listener is still released');
  assert.deepEqual(state.viewBounds, ORIGINAL_VIEW, 'the view bounds are still restored');
});

test('an instance change while the viewport observation is in flight is never returned', async () => {
  const f = fixture({captureReadyMs: 2000, frames: [image(WIDTH, HEIGHT, {tag: 'frame-of-a'})]});
  f.hooks.onRequest = ({op}) => { if (op === 'observe-envelope') f.switchInstance(); };
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_WORLD_CHANGED/);
  assertRestored(f, 'observe-switch');
});

test('an owner that becomes visible mid-capture fails instead of accepting a frame', async () => {
  const f = fixture({captureReadyMs: 2000, frames: [image(0, 0, {tag: 'empty'}), image(WIDTH, HEIGHT, {tag: 'never-returned'})]});
  f.hooks.onCapture = ({reads}) => { if (reads === 1) f.owner.isVisible = () => true; };
  await assert.rejects(f.host.headlessCapture(WIDTH, HEIGHT), /GODOT_CAPTURE_OWNER_NOT_ISOLATED/);
  assert.equal(f.state().reads, 1, 'a violated owner isolation must not keep reading');
  assertRestored(f, 'owner-visible');
});

test('fullscreen hidden capture uses the requested compositor size and restores fullscreen', async () => {
  const f=fixture({fullscreen:true});
  f.contents.capturePage=async()=>image(...f.state().contentSize,{tag:'actual-compositor'});
  const captured=await f.host.headlessCapture(WIDTH,HEIGHT);
  assert.equal(captured.width,WIDTH);assert.equal(captured.height,HEIGHT);assert.equal(f.owner.isFullScreen(),true);
  assert.deepEqual(f.events.filter(event=>event.startsWith('fullscreen:')),['fullscreen:false','fullscreen:true']);
  assertRestored(f,'fullscreen-success');
});
test('fullscreen is restored even when the hidden owner cannot be resized', async () => {
  const f=fixture({fullscreen:true,failContentSizeAt:1});
  await assert.rejects(f.host.headlessCapture(WIDTH,HEIGHT),/window refused to resize/);
  assert.equal(f.owner.isFullScreen(),true);assertRestored(f,'fullscreen-failure');
});
