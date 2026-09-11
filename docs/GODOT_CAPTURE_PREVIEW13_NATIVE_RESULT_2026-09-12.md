# preview.13 截图与最新游玩进度实测

受测成品固定为 `12f31f17f815`：`D:/cm-promo-loop-0912/desktop/build/releases/12f31f17f815-01ef3d4c-4e8f-47d3-b65b-9e1780c381fe/output/win-unpacked`。未修改成品或模型作品，全部为独立隐藏、不可聚焦测试进程，0 模型、0 真实键鼠、0 Pointer Lock。未访问 qQcut9 或用户档案。

## 工作台截图通过

复用本 agent 的 SUkBPG 独立档案，正常进入 create 工作台。真实 view 为 `(275,150,525,650)`；`captureView` 返回 source/output 为 1200×800，resized=false。前后 world/build/instance、挂接与全部窗口/view bounds 不变。已实际查看 PNG，仅含游戏画面，没有工作台聊天/旁栏。

- 报告：`D:/cm-capture-product-acceptance-0912/test-results/desktop-native-complete-SUkBPG/workbench-capture-d32e9117-2703-4e8f-aec1-1fc9e04e824e/report.json`
- 图片：同目录 `create.png`，SHA-256 `7dd8c867c21b20235dd5665a19f46a9bce079b46196f9cc3f55c8c522299c098`。
- `ok:true`、`integrityVerified:true`、退出 code=0，violations/pageErrors/shutdownFailures 均为空。旧报告、marker 与冻结包完整性验证通过。

## 候选接续未手动保存进度通过

全新 yhgkIx 档案先正常创建空白世界，导入内置环境包并完成检查。正式截图前正常 freeze 保存；环境候选打开前再正常 resume，通过既有有限控制器 look/walk/wait 移动，没有修改坐标/源码，没有手动保存这次移动。`godotExplore` 所有步骤 capture=false，不走旧截图方法。

最终在同 world `world-4c1dd6617c37`、同已通过检查的候选继续验证，没有重新安装或建世界。旧正式存档位置为 `(-1.52453470230103,0.899999976158142,3.77159428596497)`；本次实际移动后位置为 `(-3.04906845092773,0.899999976158142,1.54318869113922)`，yaw=0.6、pitch=-0.2。等待控制器自然停止后两次真实 snapshot 完全一致；打开前数据库仍是旧位置。

正常 `candidatePreview` 返回 preview，说明生产协调器完成既有 prepare/restore/confirm。只读本档案 tasks.sqlite（不读取 token 列），验证：

- application `0cbf638d-5d70-4bd8-bd2e-6447eec05e50` 的 `input.snapshot.body.player` 精确等于本次新位置；
- `previousWorld.snapshot`、`input.previousSnapshot` 和预览后的正式存档完整 snapshot 均精确等于打开前已稳定的真实 snapshot；
- 正式 build 未被候选采用替换；候选仍为原 `gcan-d84e9c5a7165ae53cd64581501a804c14a2f0dc69d569e7ef54598cc85bd53fc`，build `gbd-bfeac441255cbcc9afe2002b1e8f75d68bfd8424e97625a158dd1e8e48c049f5`；
- 正式/候选截图保持各自身份和布局；正式在候选期间、错误 candidateId、已关闭候选均拒绝，未改变视图。

最终 8 项断言通过，正常关闭候选并退出，三类审计为空、冻结包/marker/原失败报告完整性通过。没有把正式 host 的 paused 字段当成候选引擎暂停状态。

- 最终报告：`D:/cm-capture-product-acceptance-0912/test-results/desktop-native-complete-yhgkIx/preview-progress-fa9b9f9e-dc22-48ea-a7a6-942b26045e64/report.json`
- 正式图片：同目录 `formal.png`，SHA-256 `4b46885f83d0ab862e80bb49f4b8ab4c043fd1819b3a6b4a3b045ad2fa51d8f9`。
- 候选图片：同目录 `candidate.png`，SHA-256 `6dc28665ce31eb25c50dc5226e1757d80d8ea51ff20056a48f2782fb14249e35`。已实际查看，真实环境草地出现在候选中。正式图在移动前拍摄、候选图在移动后拍摄，不声称是完全同位置的视觉对照。

## 保留的失败和测试修正

首次报告 `D:/cm-capture-product-acceptance-0912/test-results/desktop-native-complete-yhgkIx/report.json` 保留 `ok:false`。候选其实已正常打开，新检查点也正确，但脚本将不同物理时刻的 player 逐字相等：12 帧 wait 后仍有减速，z 又变化约 1.1 厘米。真实控制器以 `move_toward` 逐帧减速，walk 结束仅清输入轴，不能把结束调用当作速度立即为零。修正为普通 wait 120 帧，再间隔 12 帧取得两个真实 snapshot，要求完全稳定后才比较；没有加误差放行身份或进度断言。

同档案续验的第一次启动报告 `preview-progress-795a9431-da87-4c09-810b-336980b64d2a/report.json` 也保留失败：driver 等到 play 布局后即保存，尚未等实际 Godot 世界重建就绪，返回 `GODOT_WORLD_CHANGED`。当次 0 新安装、0 探索、0 预览，正常退出。补回精确 world/build 实例与 host ready 等待后，才完成上述最终成功；没有吞身份错误、改旧报告或另建试验世界。

驱动支持仅对本类完整、已退出且候选检查通过的失败报告 `--continue-report <绝对路径>`，复用原 profile、原候选与同一冻结包，独立新报告保存，原报告做 SHA 证明。默认仅 prepare，不启动产品；实际运行必须显式 `--run`。
