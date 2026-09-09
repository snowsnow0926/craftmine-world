# 第 2 轮保留的失败与观察

- `export-preset-missing-filters.log`：初始导出预设缺少 include/exclude filter，真正的 Godot 导入报告错误；补齐后正常导出。
- `moved-dependency-links.json`：权限模式改变后，将本轮工作树移入可写工作区；pnpm 绝对依赖链接失效。离线重建依赖后继续，没有修改旧工作树。
- `single-thread-exit.json`：最终版验收建立前的单线程尝试；运行、物理、保存场景通过，但最终日志门槛失败。包含测试 CSP 的字体/临时图片错误和 Godot 的 WorkerThreadPool Group 退出错误。CSP 已修复，同版本多线程模板通过最终检查；没有忽略单线程错误。
- `threaded-missing-corp.json`：多线程跨源页面缺少资源策略，iframe 载入失败、origin 为 null；补齐 COOP/COEP/CORP 与 iframe 权限后启动。
- `threaded-before-draw-readiness.*`：32 项逻辑检查曾通过，但人工看图发现返回创作后的旧绘制帧覆盖导航。因此这份报告不作为最终画面验收。最终版本等待实际画布/视口更新并检查导航空白区域的合成像素。
- `pixel-sample-hit-text.json`：等待绘制后截图已正确，最初单点取样命中了“项目”文字而误报。改在无文字/控件的导航区域进行 30 点采样；最终证据为上层 `web-preview.json`。
- `appcontainer.json`：两次固定 Rust 子进程均在 main 前以 0xC0000142 退出。已确认 AppContainer token，临时 profile 清理成功；文件/网络/子进程拒绝测试和 Godot 都尚未执行。不能把编译通过当作隔离通过。

这些记录是测试时的原始 JSON/日志或明确标注的原型汇总。旧报告内的绝对路径对应当时目录；工作树移动及后续合并不改写历史原始内容。未复制引擎二进制、浏览器配置或模型凭据。
