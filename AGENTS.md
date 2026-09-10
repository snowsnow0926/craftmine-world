# 本项目的用户偏好

- 用户于 2026-09-08 明确要求：开发测试不得抢占鼠标。不得发送真实鼠标/键盘操作、请求 Pointer Lock、激活/置前测试窗口或操控用户正在使用的浏览器。
- 浏览器自动验证必须运行在独立的 headless 进程与独立测试数据目录中，初始化时禁用 `requestPointerLock`。通过 HTTP、页面脚本和纯逻辑测试验证功能；不要使用 Playwright 的 mouse / keyboard / click / fill 等输入模拟来验收。
- `tests/browser.mjs` 和 `tests/modules-browser.mjs` 是历史上的输入操作测试，未经用户另行明确要求不可运行。默认浏览器测试入口应保持无真实输入。
- 普通开发和验证继续推进，不因上述偏好反复请求用户确认。
- 用户于 2026-09-11 明确要求：后续并行开发使用 Codex 子 agent，不再通过 PI 派发子 agent；总控负责拆分、依赖顺序和集成验收。
