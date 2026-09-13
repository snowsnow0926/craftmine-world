import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings, CodexConnectionRequest, CodexConnectionStatus } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { Button, Input } from "../ui";

export function WorldAgentBackendRow({ settings, saveSettings }: {
  settings: AppSettings; saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [backend, setBackend] = useState(settings.worldAgentBackend ?? "pi");
  const [path, setPath] = useState(settings.codexCliPath ?? "");
  const [status, setStatus] = useState<CodexConnectionStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (sessionStorage.getItem("craftmine.openCodexConnection") === "1") {
      sessionStorage.removeItem("craftmine.openCodexConnection");
      document.getElementById("world-agent-backend")?.scrollIntoView({block: "center"});
    }
    return () => { mounted.current = false; ++revision.current; void api.codexConnection({ action: "cancel" }).catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!status?.loginPending) return;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      const current = revision.current;
      void api.codexConnection({ action: "status" }).then(next => {
        if (mounted.current && current === revision.current) setStatus(next);
      }).catch(() => { if (mounted.current) setError(t("codexConnection.codes.CODEX_CONNECTION_FAILED")); })
        .finally(() => { pending = false; });
    }, 1000);
    return () => clearInterval(timer);
  }, [status?.loginPending, t]);
  async function run(action: CodexConnectionRequest["action"]) {
    const current = ++revision.current;
    setBusy(true); setError(""); setSaved(false);
    try {
      const next = await api.codexConnection({ action, path: path.trim() });
      if (!mounted.current || current !== revision.current) return;
      setStatus(next);
      if (["pick", "detect"].includes(action) && next.path) setPath(next.path);
    } catch (error) {
      if (mounted.current && current === revision.current) setError(String((error as Error).message));
    } finally { if (mounted.current && current === revision.current) setBusy(false); }
  }
  const connected = status?.code === "ready" && status.path === path.trim();
  const locked = busy || status?.loginPending;
  return <div className="settings-row" id="world-agent-backend" data-testid="world-agent-backend">
    <div className="settings-row-copy">
      <div className="settings-row-title">{t("codexConnection.title")}</div>
      <div className="settings-row-desc">{t("codexConnection.description")}</div>
    </div>
    <div className="settings-row-control min-w-0">
      <div className="flex w-full min-w-0 flex-col gap-2">
        <select className="field-input" aria-label={t("codexConnection.title")} value={backend} disabled={!!locked}
          onChange={event => { setBackend(event.target.value as "pi" | "codex-cli"); setSaved(false); }}>
          <option value="pi">{t("codexConnection.provider")}</option>
          <option value="codex-cli">{t("codexConnection.local")}</option>
        </select>
        {backend === "codex-cli" && <>
          <ol className="settings-row-desc list-decimal pl-5" data-codex-setup-stages>
            <li>{t("codexConnection.setup.install")}</li>
            <li>{t("codexConnection.setup.connect")}</li>
            <li>{t("codexConnection.setup.save")}</li>
          </ol>
          <p className="settings-row-desc">{t("codexConnection.setup.distribution")}</p>
          <Input aria-label={t("codexConnection.path")} value={path} disabled={!!locked}
            placeholder={t("codexConnection.path")} onChange={event => {
              ++revision.current; setPath(event.target.value); setStatus(undefined); setSaved(false);
            }} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!!locked} onClick={() => void run("detect")}>{t("codexConnection.detect")}</Button>
            <Button size="sm" disabled={!!locked} onClick={() => void run("pick")}>{t("codexConnection.pick")}</Button>
            <Button size="sm" disabled={!!locked} onClick={() => void run("instructions")}>{t("codexConnection.instructions")}</Button>
          </div>
          <p className="settings-row-desc">{t("codexConnection.version")}</p>
          {!!status?.candidates?.length && <details data-codex-candidates><summary>{t("codexConnection.setup.candidates")}</summary>
            {status.candidates.map(candidate => <div key={candidate.path} className="settings-row-desc break-words">
              <p>{candidate.version ?? t("codexConnection.setup.unreadable")} · {candidate.compatible ? t("codexConnection.setup.compatible") : t("codexConnection.setup.incompatible")}</p>
              <p>{candidate.path}</p>
              {candidate.compatible && <Button size="sm" disabled={!!locked} onClick={() => {++revision.current; setPath(candidate.path); setStatus({...status, code:"detected", path:candidate.path, version:candidate.version, account:undefined});setSaved(false);}}>{t("codexConnection.setup.choose")}</Button>}
            </div>)}
          </details>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!!locked || !path.trim()} onClick={() => void run("verify")}>{t("codexConnection.verify")}</Button>
            <Button size="sm" disabled={!!locked || !path.trim() || status?.account?.type === "chatgpt"} onClick={() => void run("login")}>{t("codexConnection.login")}</Button>
            {status?.loginPending && <Button size="sm" disabled={busy} onClick={() => void run("openLogin")}>{t("codexConnection.openLogin")}</Button>}
            {(busy || status?.loginPending) && <Button size="sm" onClick={() => void run("cancel")}>{t("codexConnection.cancel")}</Button>}
          </div>
          <div role="status" aria-live="polite" className="settings-row-desc break-words">
            {busy ? t("codexConnection.codes.checking") : status ? t(`codexConnection.codes.${status.code}`, { defaultValue: status.code }) : t("codexConnection.codes.idle")}
            {status?.version && <p>{status.version}</p>}
            {status?.account && <p>{status.account.email ?? status.account.type}{status.account.plan ? ` · ${status.account.plan}` : ""}</p>}
            {connected && <p>gpt-6-astra · xhigh</p>}
          </div>
        </>}
        <Button disabled={!!locked || (backend === "codex-cli" && !connected)} onClick={() => {
          setBusy(true); setError(""); setSaved(false);
          void saveSettings({ worldAgentBackend: backend, codexCliPath: path.trim() })
            .then(() => { if (mounted.current) setSaved(true); })
            .catch(error => { if (mounted.current) setError(String(error.message ?? error)); })
            .finally(() => { if (mounted.current) setBusy(false); });
        }}>{t("codexConnection.save")}</Button>
        {saved && <p role="status">{t("codexConnection.saved")}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  </div>;
}
