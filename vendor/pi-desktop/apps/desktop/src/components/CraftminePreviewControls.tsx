import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CraftminePreviewState } from "../../shared/craftmine-preview-controls";
import { api } from "../lib/api";
import { loadCraftmineLayout, setCraftmineOverlay } from "../lib/craftmine-layout";
import { creationResultError } from "../lib/creation-task-status";
import "./CraftminePreviewControls.css";

const request = (payload: Record<string, unknown>) =>
  api.pluginPanelInvoke("craftmine.world", "world.previewControl", payload) as Promise<CraftminePreviewState | null>;

/** Mounted inside the retained immersion surface even while it is closed. */
export function CraftminePreviewControls({ autoOpen = true }: { autoOpen?: boolean }) {
  const {i18n} = useTranslation();
  const chinese = (i18n.language ?? "zh-CN").startsWith("zh");
  const [preview, setPreview] = useState<CraftminePreviewState | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const generation = useRef(0);
  const seen = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (disposed) return;
      if (!locked.current) {
        const current = ++generation.current;
        try {
          const state = await request({ action: "state" });
          if (!disposed && current === generation.current) {
            setPreview(state); setError("");
            if (autoOpen && state && seen.current !== state.previewId) {
              seen.current = state.previewId;
              // Open a real overlay above the candidate; native game geometry
              // stays untouched. The player can close it with F2 to try the draft.
              if (loadCraftmineLayout(localStorage).overlay === "closed") setCraftmineOverlay("compact");
            }
          }
        } catch (failure) {
          if (!disposed && current === generation.current) setError(failure instanceof Error ? failure.message : String(failure));
        }
      }
      if (!disposed) timer = setTimeout(read, 1000);
    };
    void read();
    return () => { disposed = true; mounted.current = false; generation.current++; clearTimeout(timer); };
  }, [autoOpen]);

  const run = async (action: "apply" | "close") => {
    if (!preview || locked.current) return;
    locked.current = true; setPending(true);
    const current = ++generation.current;
    const { worldId, candidateId, buildId, previewId } = preview;
    try {
      const state = await request({ action, worldId, candidateId, buildId, previewId });
      if (mounted.current && current === generation.current) { setPreview(state); setError(""); }
    } catch (failure) {
      if (mounted.current && current === generation.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  };

  if (!preview) return null;
  return <section className="craftmine-preview-controls no-drag" aria-label="草稿预览操作" data-preview-id={preview.previewId}>
    <div className="craftmine-preview-controls-copy">
      <strong>正在试玩草稿 · 尚未采用</strong>
      <p role="status">{preview.reason}</p>
      <p>{preview.next}</p>
      <small>F2 收起窗口继续试玩，再按 F2 返回这里采用或退出预览。</small>
      {(error || preview.error) && <>
        <p role="alert">{creationResultError(error || preview.error,chinese)}</p>
        <details className="creation-result-details"><summary>{chinese ? "诊断详情" : "Diagnostic details"}</summary><pre>{error || preview.error}</pre></details>
      </>}
    </div>
    <div className="craftmine-preview-controls-actions">
      <button type="button" disabled={pending || preview.applyDisabled} onClick={() => void run("apply")}>{preview.applyLabel}</button>
      <button type="button" disabled={pending || preview.closeDisabled} onClick={() => void run("close")}>返回原世界</button>
    </div>
  </section>;
}
