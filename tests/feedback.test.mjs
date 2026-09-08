import test from 'node:test';
import assert from 'node:assert/strict';
import { compileScene } from '../app/scene.mjs';
import { BehaviorState } from '../app/behavior-state.mjs';
import { AUDIO_SOUNDS, MESSAGE_TONES, validateBehaviorResult } from '../app/behavior-contracts.mjs';
import { capabilitiesCatalog, capabilitiesText } from '../app/harness/capabilities.mjs';
import { behaviorFrame, behaviorScene, doorBehavior } from './behavior-fixtures.mjs';

const run = (command, definition = doorBehavior()) => validateBehaviorResult({ state: {}, commands: [command] }, definition, behaviorFrame());
const audioDefinition = () => ({ ...doorBehavior(), permissions: ['hud.message', 'audio.play'] });
const apply = commands => {
  const build = compileScene({ ...behaviorScene(), behaviors: [audioDefinition()] });
  const state = new BehaviorState(build, null);
  return state.apply(build.behaviors[0], { state: {}, commands }, behaviorFrame());
};

test('飘字支持色调和停留时长，非法值被拒绝', () => {
  for (const tone of MESSAGE_TONES) assert.doesNotThrow(() => run({ type: 'hud.message', text: '提示', tone }));
  assert.doesNotThrow(() => run({ type: 'hud.message', text: '提示', duration: 1000 }));
  assert.doesNotThrow(() => run({ type: 'hud.message', text: '提示', duration: 10000 }));
  assert.doesNotThrow(() => run({ type: 'hud.message', text: '提示' }));
  assert.throws(() => run({ type: 'hud.message', text: '提示', tone: 'danger' }), /色调/);
  assert.throws(() => run({ type: 'hud.message', text: '提示', duration: 999 }), /飘字时长/);
  assert.throws(() => run({ type: 'hud.message', text: '提示', duration: 10001 }), /飘字时长/);
  assert.throws(() => run({ type: 'hud.message', text: '提示', duration: 1500.5 }), /飘字时长/);
  assert.throws(() => run({ type: 'hud.message', text: '提示', size: 2 }), /字段/);
});

test('音效表扩充到十四个内置音，音量限制在 0 到 1', () => {
  assert.deepEqual(AUDIO_SOUNDS, ['shoot', 'hit', 'open', 'pickup', 'error', 'jump', 'land', 'step', 'explode', 'heal', 'hurt', 'unlock', 'deny', 'win']);
  for (const sound of AUDIO_SOUNDS) assert.doesNotThrow(() => run({ type: 'audio.play', sound }, audioDefinition()));
  assert.doesNotThrow(() => run({ type: 'audio.play', sound: 'win', volume: 0 }, audioDefinition()));
  assert.doesNotThrow(() => run({ type: 'audio.play', sound: 'win', volume: 1 }, audioDefinition()));
  assert.throws(() => run({ type: 'audio.play', sound: 'scream' }, audioDefinition()), /音效名称/);
  assert.throws(() => run({ type: 'audio.play', sound: 'win', volume: 1.2 }, audioDefinition()), /音量/);
  assert.throws(() => run({ type: 'audio.play', sound: 'win', volume: -0.1 }, audioDefinition()), /音量/);
  assert.throws(() => run({ type: 'audio.play', sound: 'win', pitch: 2 }, audioDefinition()), /字段/);
});

test('色调、时长和音量随效果传给运行时', () => {
  const applied = apply([
    { type: 'hud.message', text: '门开了', tone: 'success', duration: 2000 },
    { type: 'audio.play', sound: 'explode', volume: 0.5 },
  ]);
  assert.deepEqual(applied.effects, [
    { type: 'hud.message', text: '门开了', tone: 'success', duration: 2000 },
    { type: 'audio.play', sound: 'explode', volume: 0.5 },
  ]);
  assert.deepEqual(applied.changed, []);
  assert.deepEqual(apply([{ type: 'hud.message', text: '普通提示' }]).effects, [{ type: 'hud.message', text: '普通提示' }]);
});

test('能力目录从契约派生音效和色调列表，不会和实现漂移', () => {
  const catalog = capabilitiesCatalog();
  const audio = catalog.commands.find(command => command.type === 'audio.play');
  const message = catalog.commands.find(command => command.type === 'hud.message');
  for (const sound of AUDIO_SOUNDS) assert.ok(audio.fields.find(field => field.name === 'sound').description.includes(sound));
  for (const tone of MESSAGE_TONES) assert.ok(message.fields.find(field => field.name === 'tone').description.includes(tone));
  const text = capabilitiesText();
  assert.ok(text.includes('explode'));
  assert.ok(text.includes('warn'));
});
