// 浏览器能直接加载的模块与样式白名单。路由 → [文件, MIME 类型]。
// 新增浏览器侧模块时必须在这里登记，否则游戏页会因缺少模块而无法启动；
// tests/static-files.test.mjs 会检查导入图是否完整。
export const STATIC_FILES = Object.freeze([
  ['/app/client.js', 'client.js', 'text/javascript'], ['/app/style.css', 'style.css', 'text/css'],
  ['/app/game.js', 'game.js', 'text/javascript'], ['/app/game.css', 'game.css', 'text/css'],
  ['/app/gameplay.mjs', 'gameplay.mjs', 'text/javascript'], ['/app/geometry.mjs', 'geometry.mjs', 'text/javascript'],
  ['/app/behavior-contracts.mjs', 'behavior-contracts.mjs', 'text/javascript'], ['/app/behavior-runner.mjs', 'behavior-runner.mjs', 'text/javascript'],
  ['/app/behavior-state.mjs', 'behavior-state.mjs', 'text/javascript'], ['/app/behavior-session.mjs', 'behavior-session.mjs', 'text/javascript'],
  ['/app/world-runtime.mjs', 'world-runtime.mjs', 'text/javascript'],
  ['/app/behavior-binding.mjs', 'behavior-binding.mjs', 'text/javascript'],
  ['/app/tween.mjs', 'tween.mjs', 'text/javascript'],
  ['/app/harness/acceptance.mjs', 'harness/acceptance.mjs', 'text/javascript'],
  ['/app/harness/trace-runner.mjs', 'harness/trace-runner.mjs', 'text/javascript'],
  ['/app/harness/extension-effects.mjs', 'harness/extension-effects.mjs', 'text/javascript'],
  ['/app/extension-runner.mjs', 'extension-runner.mjs', 'text/javascript'],
  // 渲染扩展层：Worker 沙箱、ABI 校验，以及渲染扩展自己要用到的断言与轨迹（浏览器安全）。
  ['/app/render-runner.mjs', 'render-runner.mjs', 'text/javascript'],
  ['/app/harness/render-extension.mjs', 'harness/render-extension.mjs', 'text/javascript'],
  ['/app/harness/parts.mjs', 'harness/parts.mjs', 'text/javascript'],
  ['/app/harness/assertions.mjs', 'harness/assertions.mjs', 'text/javascript'],
  ['/app/harness/trace.mjs', 'harness/trace.mjs', 'text/javascript'],
  ['/app/scene-diff.mjs', 'scene-diff.mjs', 'text/javascript'], ['/app/canonical.mjs', 'canonical.mjs', 'text/javascript'],
  ['/app/review.js', 'review.js', 'text/javascript'],
  ['/app/project-context.mjs', 'project-context.mjs', 'text/javascript'], ['/app/context-panel.js', 'context-panel.js', 'text/javascript'],
  ['/app/context.css', 'context.css', 'text/css'],
  ['/app/asset-binding.mjs', 'asset-binding.mjs', 'text/javascript'], ['/app/world-assets.mjs', 'world-assets.mjs', 'text/javascript'],
  ['/app/asset-decode.mjs', 'asset-decode.mjs', 'text/javascript'], ['/app/asset-renderer.mjs', 'asset-renderer.mjs', 'text/javascript'],
  ['/app/asset-viewer.js', 'asset-viewer.js', 'text/javascript'], ['/app/asset-viewer.css', 'asset-viewer.css', 'text/css'],
  ['/app/asset-panel.js', 'asset-panel.js', 'text/javascript'], ['/app/asset-panel.css', 'asset-panel.css', 'text/css'],
]);
