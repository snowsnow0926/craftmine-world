/**
 * User-visible copy for the world navigation, kept in one place so the
 * components stay logic-only and both locales stay reviewable side by side.
 */
import type { CraftmineLang } from "./craftmine-worlds";

type Copy = Record<CraftmineLang, string>;

export const CRAFTMINE_WORLD_TEXT = {
  worldsTitle: { zh: "世界", en: "Worlds" },
  createCancelling: { zh: "正在取消准备并返回…", en: "Cancelling preparation and returning…" },
  createCancelled: { zh: "已取消准备，世界和创作内容已保留。", en: "Preparation cancelled. Your world and work are retained." },
  createCancelUnconfirmed: { zh: "尚未确认新世界的状态，请重试这次创建后再取消。", en: "The new world has not been confirmed. Retry this creation before cancelling." },
  deleteWorld: { zh: "删除", en: "Delete" },
  recentlyDeleted: { zh: "最近删除", en: "Recently deleted" },
  restoreWorld: { zh: "恢复", en: "Restore" },
  removeHint: { zh: "从列表删除，原文件暂保留，可在“最近删除”恢复。", en: "Remove from the list. Files are retained and can be restored from Recently deleted." },
  worldRemoved: { zh: "已删除，可在“最近删除”恢复。原文件暂保留。", en: "Deleted. Original files are retained; restore from Recently deleted." },
  worldRestored: { zh: "已恢复到世界列表。可查看详情或重新初始化。", en: "Restored to the world list. Review details or retry initialization." },
  removeBusy: { zh: "世界仍在准备或处理创作，请等待完成后再删除。", en: "Wait for world preparation or creation work to finish before deleting." },
  removeFailedOnly: { zh: "世界状态已变化，只有准备失败或已取消的世界可以在这里删除。", en: "The world state changed. Only failed or cancelled preparations can be deleted here." },
  newWorld: { zh: "新建世界", en: "New world" },
  loading: { zh: "正在读取世界…", en: "Loading worlds…" },
  refresh: { zh: "刷新", en: "Refresh" },
  retry: { zh: "重试", en: "Retry" },
  openWorld: { zh: "打开世界", en: "Open world" },
  closeWorld: { zh: "收起世界面板", en: "Close world panel" },
  unavailable: {
    zh: "世界列表接口尚未接入，这里不会用本地数据代替。",
    en: "The host world-list channel is not wired yet; no local data is substituted.",
  },
  unavailableHint: {
    zh: "需要渲染进程可调用 world.list 与 world.create。",
    en: "Requires a renderer call into world.list and world.create.",
  },
  empty: { zh: "还没有世界，先新建一个。", en: "No worlds yet — create one." },
  emptyHint: { zh: "新建后会自动打开并绑定当前会话。", en: "A new world opens and binds to this session." },
  active: { zh: "当前", en: "Active" },
  taskHere: { zh: "任务在这里", en: "Task is here" },
  taskStays: {
    zh: "进行中的任务仍属于原世界，结果不会写入新选中的世界。",
    en: "A running task keeps its own world; results are not written to the newly selected world.",
  },
  busy: { zh: "正在切换世界，请稍候。", en: "Switching worlds — please wait." },
  unsupported: {
    zh: "主机尚未提供安全切换（需要先冻结并保存当前世界）。",
    en: "The host cannot switch safely yet (it must freeze and save the current world first).",
  },
  createTitle: { zh: "新建世界", en: "New world" },
  createBase: { zh: "底座", en: "Base" },
  createBaseNone: {
    zh: "主机尚未报告可选底座；当前只会创建已交付的世界。",
    en: "The host reports no selectable base; only delivered worlds are created.",
  },
  createStarter: { zh: "起点", en: "Start" },
  createStarterBlank: { zh: "空白", en: "Blank" },
  createName: { zh: "名称", en: "Name" },
  createNamePlaceholder: { zh: "例如：林间小屋", en: "For example: Forest cabin" },
  createSubmit: { zh: "创建", en: "Create" },
  createCancel: { zh: "取消", en: "Cancel" },
  creating: { zh: "正在创建…", en: "Creating…" },
  planned: { zh: "规划中", en: "Planned" },
  createBaseMissing: {
    zh: "没有已交付的底座，暂时无法新建。",
    en: "No delivered base is available, so a new world cannot be created yet.",
  },
  createInitializing: {
    zh: "世界已登记，正在完成初始化；完成后才能进入游玩。",
    en: "The world is registered and still initializing; it becomes playable when that finishes.",
  },
  createPending: {
    zh: "初始化仍在进行，可稍后手动刷新。",
    en: "Initialization is still running; refresh later to check again.",
  },
  createRetry: { zh: "重试初始化", en: "Retry initialization" },
  createChooseBase: { zh: "改用其他底座", en: "Choose another base" },
  createDiscard: { zh: "丢弃草稿", en: "Discard draft" },
  createDetails: { zh: "查看详情", en: "Details" },
  creationFailed: { zh: "初始化失败", en: "Initialization failed" },
  creationNotPlayable: {
    zh: "该世界尚未初始化完成，不能进入游玩。",
    en: "This world has not finished initializing and cannot be played yet.",
  },
  creationStage: { zh: "当前步骤", en: "Current step" },
  layoutReset: { zh: "恢复默认布局", en: "Reset layout" },
  assetsTitle: { zh: "素材与作品库", en: "Asset library" },
  assetsClose: { zh: "关闭", en: "Close" },
  auxTitle: { zh: "辅助工作区", en: "Auxiliary workspaces" },
  auxOpen: { zh: "打开世界面板", en: "Open the world panel" },
  sessionTitle: { zh: "会话", en: "Session" },
  sessionBound: { zh: "当前世界绑定会话", en: "Session bound to this world" },
  switchFailed: { zh: "切换失败，仍停留在原世界。", en: "Switch failed; still in the previous world." },
} satisfies Record<string, Copy>;

export type CraftmineWorldText = typeof CRAFTMINE_WORLD_TEXT;
