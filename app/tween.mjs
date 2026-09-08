// 平滑移动的纯数学：位置插值与进度计算，不依赖 DOM，可单测。
export const TWEEN_LIMITS = Object.freeze({ maxDuration: 5 });

export function tweenProgress(startedAt, now, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  const ratio = (now - startedAt) / duration;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return ratio >= 1 ? 1 : ratio;
}

export function easeInOut(value) {
  const t = Math.max(0, Math.min(1, value));
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

export const lerp = (from, to, t) => from + (to - from) * t;

const mixPoint = (from, to, t) => ({ x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), z: lerp(from.z, to.z, t) });

export function tweenBounds(from, to, t) {
  return { min: mixPoint(from.min, to.min, t), max: mixPoint(from.max, to.max, t) };
}

// 移动只改变位置，所以用「包围盒中心的位移」平移全部图元，尺寸保持不变。
export const boundsCenter = bounds => ({ x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 });

export function tweenDelta(from, to, t) {
  const a = boundsCenter(from), b = boundsCenter(to);
  const zero = value => (value === 0 ? 0 : value);
  return { x: zero((b.x - a.x) * t), y: zero((b.y - a.y) * t), z: zero((b.z - a.z) * t) };
}

export function sameBounds(a, b) {
  if (!a || !b) return false;
  return ['x', 'y', 'z'].every(axis => a.min[axis] === b.min[axis] && a.max[axis] === b.max[axis]);
}

export const unionBounds = parts => {
  if (!parts.length) return null;
  const axis = (fn, key) => Object.fromEntries(['x', 'y', 'z'].map(one => [one, fn(...parts.map(part => part[key][one]))]));
  return { min: axis(Math.min, 'min'), max: axis(Math.max, 'max') };
};
