import { GameplaySession } from '../gameplay.mjs';
import { BehaviorSession } from '../behavior-session.mjs';
import { BehaviorState } from '../behavior-state.mjs';
import { observableChange, worldSnapshot } from './acceptance.mjs';

// 轨迹录制器：在真实的引擎里按固定事件序列跑一遍，把「玩家能看见的事实」记下来。
// 判定不在这里发生——这里只负责记录，裁判在 Node 侧对记录做纯函数判断。
const bounds = parts => parts.length ? {
  min: Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, Math.min(...parts.map(part => part.min[axis]))])),
  max: Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, Math.max(...parts.map(part => part.max[axis]))])),
} : null;

export async function recordTrace({ build, scenario, requirement = null, baseline = null } = {}) {
  if (!build?.scene || !Array.isArray(scenario?.events)) throw Error('录制轨迹需要场景构建和事件序列');
  const play = new GameplaySession(build.scene.systems || [], build.scene.objects || [], scenario.gameplay || null);
  let session = null, stepEffects = [], stepCommands = [], failures = [];
  const player = { ...(scenario.player || { x: 0, y: 6, z: 0 }), grounded: true };

  const context = () => ({
    player: { position: { x: player.x, y: player.y, z: player.z }, grounded: true, health: play.player?.health ?? null },
    objects: (session?.data?.view?.objects || []).map(object => {
      const parts = session.data.view.primitives.filter(part => part.id === object.id);
      return {
        id: object.id,
        position: object.position,
        visible: object.visible !== false && play.alive(object.id),
        solid: parts.some(part => part.solid),
        health: play.state.targets[object.id]?.health ?? object.components?.health ?? 0,
      };
    }),
  });

  const snapshotFrom = (view, value, playState, effects) => {
    const panels = {};
    for (const [moduleId, module] of Object.entries(value.modules || {}))
      for (const [key, panel] of Object.entries(module?.panels || {})) panels[moduleId + ':' + key] = panel;
    const resources = {};
    for (const resource of playState.resources()) resources[resource.id] = { value: resource.value, max: resource.max };
    return worldSnapshot({
      playerHealth: playState.player?.health ?? null,
      objects: view.objects.map(object => {
        const parts = view.primitives.filter(part => part.id === object.id);
        const alive = playState.alive(object.id), visible = object.visible !== false && alive;
        const ordered = [...parts].sort((a, b) => (a.min.x - b.min.x) || (a.min.y - b.min.y) || (a.min.z - b.min.z));
        return {
          id: object.id, position: object.position, visible,
          mesh: visible && parts.length > 0,
          health: playState.state.targets[object.id]?.health ?? object.components?.health ?? 0,
          solid: parts.some(part => part.solid),
          color: ordered.length ? ordered[0].color : null,
          bounds: bounds(parts),
        };
      }),
      inventory: value.inventory || {}, items: value.items || {}, resources, panels, effects,
    });
  };
  const snapshot = () => snapshotFrom(session.data.view, session.data.value, play, stepEffects);
  // 基准面：候选实现改动之前的世界。场景类候选（种树、加高）必须和它比，否则看不到「新增了什么」。
  const baselineSnapshot = () => {
    if (!baseline) return null;
    const basePlay = new GameplaySession(baseline.scene.systems || [], baseline.scene.objects || [], scenario.gameplay || null);
    const base = new BehaviorState(baseline, null);
    return snapshotFrom(base.view, { ...base.value, inventory: scenario.inventory || {} }, basePlay, []);
  };

  // 效果落地：和游戏里 applyBehavior 的行为保持一致，只是不做动画。
  const apply = applied => {
    for (const effect of applied?.effects || []) {
      stepEffects.push(effect);
      if (effect.type === 'target.revive') {
        const target = play.state.targets[effect.id];
        if (target) target.health = target.maxHealth;
      }
      if (effect.type === 'resource.add') play.addResource(effect.id, effect.amount);
      if (effect.type === 'resource.set') play.setResource(effect.id, effect.value);
      if (effect.type === 'health.add' && play.player) play.player.health = Math.max(0, Math.min(play.player.maxHealth, play.player.health + effect.amount));
      if (effect.type === 'target.damage') {
        const target = play.state.targets[effect.id];
        if (target && target.health > 0) target.health = Math.max(0, target.health - effect.amount);
      }
    }
  };

  const makeSession = saved => new BehaviorSession(build, saved, {
    context, apply, notice: () => {}, gameplay: play.state,
    onStep: ({ result }) => { stepCommands.push(...result.commands); },
  });

  const steps = [];
  try {
    session = makeSession({ format: 'craftmine.behavior-state/3', time: 0, modules: {}, inventory: scenario.inventory || {}, items: {}, archive: [] });
    await session.start();
  } catch (error) {
    failures.push('装载失败：' + error.message);
    session?.dispose();
    throw error;
  }

  for (const [index, item] of scenario.events.entries()) {
    const label = item.label || `step-${index}`;
    if (item.move) { player.x += item.move.x || 0; player.z += item.move.z || 0; }
    stepEffects = []; stepCommands = [];
    const before = snapshot();
    let error = null;
    try {
      if (item.type === 'restore') {
        const saved = session.snapshot();
        session.dispose();
        session = makeSession(saved);
        await session.start();
      } else {
        session.data.value.time += item.dt ?? 0;
        await session.execute({ type: item.type, targetId: item.targetId ?? null, ...(item.code ? { code: item.code } : {}) }, item.dt ?? .1, true);
      }
    } catch (caught) { error = String(caught.message || caught).slice(0, 600); }
    const after = snapshot();
    steps.push({
      label, event: item.type === 'restore' ? { type: 'restore', targetId: null } : { type: item.type, targetId: item.targetId ?? null, ...(item.code ? { code: item.code } : {}) },
      player: { x: player.x, y: player.y, z: player.z },
      commands: stepCommands.slice(), effects: stepEffects.map(effect => ({ type: effect.type })),
      before, after, change: observableChange(before, after), error,
    });
  }
  const final = snapshot();
  const errors = failures.concat(steps.filter(step => step.error).map(step => `${step.label}：${step.error}`))
    .concat(session.failures.map(failure => `「${failure.name}」：${failure.message}`));
  session.dispose();
  return { requirement, build: build.hash || null, baseline: baselineSnapshot(), player: { x: scenario.player.x, y: scenario.player.y, z: scenario.player.z }, start: steps[0]?.before || final, steps, final, errors };
}
