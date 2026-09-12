import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import "./CraftminePauseMenu.css";

/** Trusted renderer surface; the immersion host pauses the world beneath it. */
export function CraftminePauseMenu({ onResume, onWorkbench, onSettings, runtimeError }: {
  onResume: () => void;
  onWorkbench: () => void;
  onSettings: () => void;
  runtimeError?: string;
}) {
  const { i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const [error, setError] = useState("");
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onResume();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onResume]);
  return <div className="craftmine-pause-backdrop" data-craftmine-pause>
    <section className="craftmine-pause-menu no-drag" role="dialog" aria-modal="true" aria-labelledby="craftmine-pause-title">
      <h1 id="craftmine-pause-title">{chinese ? "已暂停" : "Paused"}</h1>
      <button type="button" data-pause-action="resume" onClick={onResume}>{chinese ? "继续游玩" : "Resume"}</button>
      <button type="button" data-pause-action="workbench" onClick={onWorkbench}>{chinese ? "回到工作台" : "Back to workbench"}</button>
      <button type="button" data-pause-action="settings" onClick={onSettings}>{chinese ? "设置" : "Settings"}</button>
      <button type="button" data-pause-action="exit" onClick={() => {
        void api.nativeMenuAction("quit").catch(failure => setError(failure instanceof Error ? failure.message : String(failure)));
      }}>{chinese ? "保存并退出" : "Save and exit"}</button>
      {(error || runtimeError) && <p role="alert">{error || runtimeError}</p>}
      <small>{chinese ? "Esc 继续游玩" : "Esc to resume"}</small>
    </section>
  </div>;
}
