# 模型入口衔接预制恢复报告（2026-09-12）

新增显式报告链解析，只改测试驱动，不改产品源码或历史报告。当前真实成功入口为 `D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/reopen-verified-27e54cac-d45a-450a-82fb-e3720759b252/report.json`，format 为 craftmine.prefab-reopen-verification/1。

解析沿其 originalReport/sourceReport 到原 craftmine.prefab-check-recovery/1，再到顶层 resume 报告、最初 demo 报告和原安装 intent；profile 由这条明确关系定位为 VO4Pki/profile，不能把嵌套报告目录当新 profile。所有世界、源码版本/哈希、检查任务、候选、采用 build、保存、独立冷重开实例、组件身份及干净退出审计都需一致。原恢复报告因冷重开的 WORLD_BUSY 保持 ok:false；只有后续真实成功冷重开证据补足时才允许进入普通会话，不修改任何旧字段，也不只看一个 ok:true。

输入前保存并重新核验六份文件 proof：成功冷重开、原恢复、原 resume、最初 demo、原 wall intent、headless marker。它们是本次只读采样的文件哈希，用于发现后续变更，不冒充原运行时就已签名的证明。驱动 live 阶段还会在创建会话之前，用实际 godotObserve 核对已采用 build，并经现有 worldNavigation/godot.historyLoad 核对 main 源码 revision 6 与 manifestHash。只在这些身份成立后走原有普通 sessionCreate/playerSetup/playerPrompt。

新 player 报告和问答/权限文件仍写 VO4Pki 根目录，保留 sourceProofs 与 sourceRecovery；原有采用/探索入口可以按同目录继续定位真实 profile，不需要伪造原报告。旧普通 session 报告与直接成功 demo 的入口保持兼容。

本轮已对真实成功报告执行 prepare-only：定位原 profile 正确，原句为“再放一棵橡树在左边，和已有的树错开。”，配置为真实 DeepSeek v4.1-flash-expires-on-0910/max、输出 384000；0 模型、0 成品启动，未读密钥。实际运行仍等总控新冻结包。

8 项离线回归通过：六文件链与变更检测、不能仅翻转失败 ok 字段、错世界/错 profile/源码变化/脏审计拒绝、检查失败/新增虚假组件拒绝、普通报告兼容，以及既有正常 sessionCreate 三项。语法检查通过。不宣称模型已使用素材库或新增橡树成功。
