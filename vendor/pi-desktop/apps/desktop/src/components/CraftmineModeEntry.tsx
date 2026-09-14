import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCraftmineWorlds } from "../hooks/use-craftmine-worlds";
import { craftmineLang, type CraftmineWorldStarter } from "../lib/craftmine-worlds";
import { useAppStore, beginPlayerWorldEntry, createCopiedWorldSession } from "../stores/app-store";
import { WindowControls } from "./WindowControls";
import { WorldListPanel } from "./craftmine/WorldListPanel";
import { WorldCreatePanel } from "./craftmine/WorldCreatePanel";
import { LocalWorldTemplates } from "./craftmine/LocalWorldTemplates";
import { clearRequestedWorldTemplate, requestedWorldTemplate, type LibraryReference } from "../lib/player-library";
import "../styles/craftmine-mode-entry.css";

type EntryTab = "worlds" | "examples" | "templates" | "create";

/** The existing PI world chooser; all worlds and examples come from the host. */
export function CraftmineModeEntry({ onSelect, onCancel, onManage }: {
  onSelect: (mode: "play", worldId?: string) => void;
  onCancel?: () => void;
  onManage?: () => void;
}) {
  const { i18n } = useTranslation();
  const lang = craftmineLang(i18n.language), zh = lang === "zh";
  const controller = useCraftmineWorlds(lang);
  const [initialTemplate] = useState(requestedWorldTemplate);
  const [tab, setTab] = useState<EntryTab>(initialTemplate ? "templates" : "worlds");
  useEffect(() => {clearRequestedWorldTemplate();}, []);
  const [entryError, setEntryError] = useState("");
  const [opening, setOpening] = useState(false);
  const entryLock = useRef(false);
  const preflightLock = useRef(false);
  const isRunning = useAppStore(state => state.isRunning);
  const busy = opening || controller.busy;
  const examples = (controller.capabilities?.bases ?? []).flatMap(base =>
    (base.starters ?? []).filter(starter => starter.kind === "example" && starter.initialState === "authored-defaults" && starter.source)
      .map(starter => ({ base, starter })));
  const changed = zh ? "对话或输入已改变。世界已保留，请再次打开。" : "Your conversation or input changed. The world was kept; open it again.";

  const choose = async (id: string) => {
    if (entryLock.current || controller.busy) return;
    entryLock.current = true; setOpening(true); setEntryError("");
    try {
      const complete = await beginPlayerWorldEntry();
      await controller.select(id);
      if (!await complete(id, () => onSelect("play", id))) setEntryError(changed);
    } catch (failure) { setEntryError(failure instanceof Error ? failure.message : String(failure)); }
    finally { entryLock.current = false; setOpening(false); }
  };
  // Capture the conversation before creation starts, not after a long build.
  const prepareCreation = async () => {
    if (useAppStore.getState().isRunning) throw Error(zh ? "请先等待当前创作结束。" : "Wait for the current task to finish.");
    preflightLock.current = true; setOpening(true);
    let complete: Awaited<ReturnType<typeof beginPlayerWorldEntry>>;
    try { complete = await beginPlayerWorldEntry(); }
    finally {preflightLock.current = false; setOpening(false);}
    return async (worldId: string) => {
      if (!await complete(worldId, () => {})) throw Error(changed);
      await createCopiedWorldSession(worldId, useAppStore.getState().activeSessionId);
      onSelect("play", worldId);
    };
  };
  const createExample = async (baseId: string, starter: CraftmineWorldStarter) => {
    if (entryLock.current || controller.busy || isRunning) return;
    entryLock.current = true; setOpening(true); setEntryError("");
    try {
      const ready = await prepareCreation();
      const attempt = controller.createAttempt?.input;
      await controller.create(attempt ?? { baseId, starterId: starter.id, title: `${starter.label}${zh ? " · 我的副本" : " · My copy"}`, operationId: crypto.randomUUID() }, ready);
    } catch (failure) { setEntryError(failure instanceof Error ? failure.message : String(failure)); }
    finally { entryLock.current = false; setOpening(false); }
  };
  const createTemplate = async (ref: LibraryReference, title: string) => {
    if (entryLock.current || controller.busy || isRunning) return;
    entryLock.current = true; setOpening(true); setEntryError("");
    try {
      const ready = await prepareCreation();
      await controller.create(controller.createAttempt?.input ?? {title, baseId: "creation-sandbox", starterId: "library", libraryRef: {...ref}, operationId: crypto.randomUUID()}, ready);
    } catch (failure) {setEntryError(failure instanceof Error ? failure.message : String(failure));}
    finally {entryLock.current = false; setOpening(false);}
  };
  const manage = () => {
    const state = useAppStore.getState(); state.setSettingsTab("general"); state.setPage("settings");
    (onManage ?? onCancel)?.();
    window.dispatchEvent(new CustomEvent("craftmine-world-archives-open"));
  };

  return <main className="craftmine-mode-entry" aria-labelledby="craftmine-mode-entry-title" data-mode-entry>
    <header className="craftmine-mode-entry-titlebar"><span>CRAFTMINE WORLD</span><WindowControls /></header>
    <div className="craftmine-mode-entry-content no-drag">
      <h1 id="craftmine-mode-entry-title">{zh ? "选择你的世界" : "Choose your world"}</h1>
      <div className="craftmine-world-entry-tabs" role="tablist" aria-label={zh ? "世界" : "Worlds"}>
        {(["worlds", "examples", "templates", "create"] as const).map((value, index) => <form key={value} data-world-entry-tab-form={value} onSubmit={event => {event.preventDefault(); if (busy || preflightLock.current || controller.createAttempt) return; setTab(value); setEntryError(""); controller.clearMessages();}}><button type="submit" role="tab"
          id={`world-entry-tab-${value}`} aria-selected={tab === value} aria-controls={`world-entry-${value}`}
          disabled={busy || !!controller.createAttempt} data-world-entry-tab={value}>
          {(zh ? ["我的世界", "示例世界", "我的模板", "新建世界"] : ["My worlds", "Examples", "My templates", "New world"])[index]}
        </button></form>)}
      </div>
      <section role="tabpanel" id={`world-entry-${tab}`} aria-labelledby={`world-entry-tab-${tab}`}>
        {tab === "worlds" && <WorldListPanel controller={controller} lang={lang} showCreate={false}
          onOpenWorld={() => { if (controller.activeWorldId) void choose(controller.activeWorldId); }} onSelectWorld={choose} />}
        {tab === "worlds" && controller.status === "ready" && !controller.worlds.length && <div className="craftmine-world-entry-actions">
          <button type="button" onClick={() => setTab("examples")}>{zh ? "查看示例世界" : "Explore examples"}</button>
          <button type="button" onClick={() => setTab("create")}>{zh ? "创建空白世界" : "Create a blank world"}</button>
        </div>}
        {tab === "examples" && <>
          <p className="craftmine-world-note">{zh ? "从内置示例创建个人副本，无需连接 AI 即可游玩，也可以继续修改。" : "Create a personal copy of a built-in example to play without an AI account or keep creating."}</p>
          <form className="craftmine-world-entry-actions" data-world-example-import onSubmit={event => {event.preventDefault(); if (busy || preflightLock.current || controller.createAttempt) return; setTab("templates"); setEntryError(""); controller.clearMessages();}}>
            <button type="submit" disabled={busy || !!controller.createAttempt}>{zh ? "导入演示或朋友的模板 ZIP" : "Import a demo or friend's template ZIP"}</button>
          </form>
          <div className="craftmine-example-worlds">
            {examples.map(({ base, starter }) => <article className="craftmine-example-world" key={`${base.id}:${starter.id}`} data-world-example={starter.id}>
              {starter.preview && <img src={starter.preview} alt={starter.label} loading="lazy" />}
              <h2>{starter.label}</h2><p>{starter.description}</p>
              <form onSubmit={event => { event.preventDefault(); void createExample(base.id, starter); }}>
                <button type="submit" data-world-example-create={starter.id} disabled={busy || isRunning || !base.delivered || !starter.delivered || (!!controller.createAttempt && controller.createAttempt.input.starterId !== starter.id)}>
                  {controller.createAttempt?.input.starterId === starter.id ? (busy ? (zh ? "正在准备副本…" : "Preparing your copy…") : (zh ? "重试打开副本" : "Retry opening copy")) : (zh ? "创建副本并游玩" : "Create copy and play")}
                </button>
              </form>
            </article>)}
          </div>
          {!controller.capabilities && <p role="status">{zh ? "正在读取示例…" : "Loading examples…"}</p>}
          {controller.capabilities && !examples.length && <p role="status">{zh ? "此版本尚未提供示例世界。" : "This version has no bundled examples."}</p>}
        </>}
        {tab === "create" && <WorldCreatePanel controller={controller} lang={lang} onClose={() => setTab("worlds")} onBeforeCreate={prepareCreation} />}
        {tab === "templates" && <LocalWorldTemplates bridge={controller.bridge} zh={zh} busy={busy || isRunning} locked={!!controller.createAttempt} initialRef={initialTemplate} onCreate={createTemplate}
          onRetry={controller.createAttempt?.input.libraryRef ? async () => {
            const input = controller.createAttempt?.input;
            if (input?.libraryRef) await createTemplate(input.libraryRef, input.title);
          } : undefined}/>}
      </section>
      {busy && <p role="status" data-world-entry-pending>{controller.notice || (zh ? "正在保存进度并准备世界…" : "Saving progress and preparing the world…")}</p>}
      {controller.canCancelCreate && <button type="button" data-world-entry-cancel onClick={() => void controller.cancelCreate()}>{zh ? "取消准备，保留世界" : "Cancel preparation and keep world"}</button>}
      {isRunning && tab !== "worlds" && <p role="status">{zh ? "当前创作结束后即可新建世界。" : "You can create a world when the current task finishes."}</p>}
      {(entryError || (tab !== "worlds" && controller.error)) && <p role="alert" data-world-entry-error>{entryError || controller.error}</p>}
      {tab !== "worlds" && controller.createAttempt?.worldId && <WorldListPanel controller={controller} lang={lang} showCreate={false} onOpenWorld={() => {}} />}
      <div className="craftmine-world-entry-actions">
        {onCancel && controller.activeWorld?.state === "ready" && <button type="button" disabled={busy} onClick={onCancel}>{zh ? "返回当前世界" : "Return to current world"}</button>}
        <button type="button" className="craftmine-mode-manage" disabled={busy} onClick={manage}>{zh ? "设置与存档管理" : "Settings and saves"}</button>
      </div>
    </div>
  </main>;
}
