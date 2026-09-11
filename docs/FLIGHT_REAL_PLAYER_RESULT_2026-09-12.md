# 普通玩家歼20生成结果（2026-09-12）

输入：「继续完成刚才的歼20，我要能实际驾驶它飞起来。」使用玩家实际选中的模型和 max 思考，普通任务累计 token 不限，没有额外评测调用次数或整轮时限。受测冻结成品为 `32cd879d`，包括把整次 120 秒硬截止改为无进展超时的修复。

本轮 8 次真实模型调用，模型自行生成脚本和场景挂载、完成新检查，正常结束。正规预览、采用、保存冷重开均通过，作品确已进入原世界。采用及后续观察追加模型调用为 0，没有手改模型生成源码。

![保存重开后的飞机原型](D:/cm-promo-flight-clarified-0912/test-results/desktop-native-complete-BKI6gF/exploration-13c363b5-6db6-4c98-b2e9-589bd4757983/view-1.png)

当前只能确认停放的低细节飞机原型，不能宣称歼20外观或实际驾驶达标。模型使用大量 BoxMesh，几何造型粗糙；亮青色地面也影响观感。

生成的 `vehicles/j20_fighter.gd` 在登机时主动设置 `Input.mouse_mode = MOUSE_MODE_CAPTURED`，仅排除原生 headless；后台 Web 成品仍会进入捕获分支。遵守用户不得请求 Pointer Lock 的要求，本轮没有触发登机。现有后台动作只覆盖玩家行走、观察及单帧互动，没有车辆油门/俯仰的完整控制证据，故驾驶保持未验收。不能用直接写位置或调用作品私有函数冒充驾驶成功。

原始证据：

- [普通玩家任务](D:/cm-promo-flight-clarified-0912/test-results/desktop-native-complete-BKI6gF/player-202ce5e8-c99a-4f77-8846-b8ba317e23fb.json)
- [采用与保存冷重开](D:/cm-promo-flight-clarified-0912/test-results/desktop-native-complete-BKI6gF/adoption-be5415ab-a61b-4da5-9958-97a5d59b3ba8/report.json)
- [零模型原始视角观察](D:/cm-promo-flight-clarified-0912/test-results/desktop-native-complete-BKI6gF/exploration-13c363b5-6db6-4c98-b2e9-589bd4757983/report.json)

独立成品退出审计中 violations、pageErrors、shutdownFailures 均为空，固定包和原报告完整性通过。旧 16384 输出容量诊断和旧 120 秒中断证据保留，不再用于判断真实玩家创作能力。

最新六组画廊：[打开实机截图](D:/Craftmine-Promo-Preview-20260912-player/index.html)。其中宠物、城市、飞机为本次普通玩家流程，树、雨、静态怪物为明确标注的旧诊断，不能统称六组真实玩家验收通过。
