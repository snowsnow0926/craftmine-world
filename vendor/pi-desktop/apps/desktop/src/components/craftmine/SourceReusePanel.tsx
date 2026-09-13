import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { craftmineWorldBridge } from "../../lib/craftmine-worlds";
import { parseSourceProposals, sourceJobState, sourcePackageRequest, type SourceProposal } from "../../lib/source-reuse";

/** Reuse receipts in the existing conversation; installation stays player-owned. */
export function SourceReusePanel({worldId, running}: {worldId: string; running: boolean}) {
  const {i18n} = useTranslation(), zh = i18n.language.startsWith("zh");
  const bridge = useMemo(() => craftmineWorldBridge(), []);
  const [proposals, setProposals] = useState<SourceProposal[]>([]);
  const [jobs, setJobs] = useState<Record<string, {id: string; status: string}>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true), locked = useRef(false), epoch = useRef(0);
  useEffect(() => {alive.current = true; return () => {alive.current = false; ++epoch.current;};}, []);
  const refresh = useCallback(async () => {
    if (!bridge) return;
    const ticket = ++epoch.current;
    try {
      const next = parseSourceProposals(await sourcePackageRequest(bridge, worldId, "sourceProposals"), worldId);
      if (!alive.current || ticket !== epoch.current) return;
      setProposals(next);
      setJobs(prior => Object.fromEntries(next.flatMap(item => {
        const job = prior[item.proposalId] ?? item.job;
        return job ? [[item.proposalId, job]] : [];
      })));
      setError("");
    } catch (failure) {if (alive.current && ticket === epoch.current) setError(failure instanceof Error ? failure.message : String(failure));}
  }, [bridge, worldId]);
  useEffect(() => {
    void refresh();
    if (!running) return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [refresh, running]);
  useEffect(() => {
    if (!bridge) return;
    const pending = Object.entries(jobs).filter(([, job]) => ["queued", "claimed", "running"].includes(job.status));
    if (!pending.length) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      for (const [id, job] of pending) {
        try {
          const status = sourceJobState(await sourcePackageRequest(bridge, worldId, "sourceJob", {jobId: job.id}), worldId, job.id);
          if (!cancelled && alive.current) setJobs(prior => ({...prior, [id]: {...job, status}}));
        } catch (failure) {if (!cancelled && alive.current) {setError(String(failure)); setJobs(prior => ({...prior, [id]: {...job, status: "unknown"}}));}}
      }
    }, 1200);
    return () => {cancelled = true; window.clearTimeout(timer);};
  }, [jobs, bridge, worldId]);
  const install = async (proposal: SourceProposal) => {
    if (!bridge || locked.current || running) return;
    locked.current = true; setBusy(proposal.proposalId); setError("");
    try {
      const receipt = await sourcePackageRequest(bridge, worldId, "installSourceProposal", {proposalId: proposal.proposalId}) as {worldId?: string; applied?: boolean; job?: {id: string; status: string}};
      if (receipt.worldId !== worldId || receipt.applied !== false || !/^gjob-[a-f0-9]{64}$/.test(receipt.job?.id ?? "")) throw Error("PACKAGE_INSTALL_RECEIPT_INVALID");
      if (!alive.current) return;
      setJobs(prior => ({...prior, [proposal.proposalId]: {id: receipt.job!.id, status: receipt.job!.status}}));
      await refresh();
    } catch (failure) {if (alive.current) setError(failure instanceof Error ? failure.message : String(failure));}
    finally {locked.current = false; if (alive.current) setBusy(null);}
  };
  if (!proposals.length && !error) return null;
  const checks = () => {void bridge?.call("world.surface", {surface: {kind: "checks"}, section: "checks"}).catch(failure => setError(String(failure)));};
  const jobText = (status: string) => ({
    passed: zh ? "检查通过，可预览并应用" : "Checks passed; preview and apply",
    failed: zh ? "检查失败，源码已保留" : "Checks failed; source was kept",
    cancelled: zh ? "检查已取消" : "Checks cancelled",
    interrupted: zh ? "检查已中断" : "Checks interrupted",
    blocked: zh ? "源码已加入，检查暂不可用" : "Source added; checks unavailable",
    unknown: zh ? "暂时无法查询，请重试" : "Status unavailable; retry",
  }[status] ?? (zh ? "源码已加入，正在检查…" : "Source added; checking…"));
  return <details className="creation-target-context" data-source-reuse-world={worldId} open>
    <summary>{zh ? "素材复用" : "Asset reuse"} · {proposals.length}</summary>
    {proposals.map(proposal => <div key={proposal.proposalId} data-source-proposal={proposal.proposalId} className="source-reuse-item">
      <strong>{proposal.displayName}</strong>
      <span>{proposal.assets.map(asset => `${asset.assetId} · v${asset.version}`).join(" / ")}</span>
      {jobs[proposal.proposalId] ? <>
        <span role="status">{jobText(jobs[proposal.proposalId].status)}</span>
        <button type="button" onClick={checks}>{zh ? "查看检查与应用" : "Open checks and application"}</button>
      </> : <form onSubmit={event => {event.preventDefault(); void install(proposal);}}><button type="submit" disabled={!!busy || running}>
        {busy === proposal.proposalId ? (zh ? "正在加入源码…" : "Adding source…") : (zh ? "加入当前世界并检查" : "Add to this world and check")}
      </button></form>}
    </div>)}
    {error && <><p role="alert">{zh ? "暂时无法处理本轮素材建议。可重试，或从侧边栏打开素材库直接使用。" : "This turn's asset suggestions are unavailable. Retry, or open the asset library from the sidebar."}</p><details><summary>{zh ? "查看原因" : "Details"}</summary><p>{error}</p></details></>}
    <button type="button" disabled={!!busy} onClick={() => {setJobs({}); void refresh();}}>{zh ? "刷新复用结果" : "Refresh reuse results"}</button>
  </details>;
}
