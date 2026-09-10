import { useEffect, useRef, useState } from "react";
import type { CraftmineWorldBridge } from "../../lib/craftmine-worlds";
import { GodotVersionComparison } from "./GodotVersionComparison";

type Data = Record<string, any>;
const short = (value: unknown) => typeof value === "string" ? value.slice(0, 12) : "未应用";
const terminal = new Set(["passed", "failed", "cancelled", "interrupted", "blocked"]);

/** Content branches are source choices; only the existing candidate UI applies them. */
export function GodotHistoryPanel({ bridge, worldId, onOpenChecks }: {
  bridge: CraftmineWorldBridge | null; worldId: string | null; onOpenChecks: () => void;
}) {
  const [branchId, setBranchId] = useState("main");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [fromOid, setFromOid] = useState("");
  const [source, setSource] = useState<Data | null>(null);
  const [text, setText] = useState("");
  const [job, setJob] = useState<Data | null>(null);
  const [compareOid, setCompareOid] = useState<string | null>(null);
  const epoch = useRef(0);
  const call = async (channel: string, args: Data = {}) => {
    if (!bridge || !worldId) throw Error("请先打开世界");
    return await bridge.call(channel, { worldId, ...args }) as Data;
  };
  async function load(branch: string, skip = 0, offset = 0) {
    const token = ++epoch.current;
    setBusy(true); setError(""); setSource(null); setCompareOid(null);
    try {
      const result = await call("godot.historyLoad", { branchId: branch, skip, offset });
      if (token !== epoch.current) return;
      setData(result); setBranchId(branch); setFromOid(result.headOid);
    } catch (failure) { if (token === epoch.current) setError(String(failure)); }
    finally { if (token === epoch.current) setBusy(false); }
  }
  useEffect(() => {
    setData(null); setBranchId("main"); setSource(null); setJob(null); setName("");
    void load("main");
    return () => { epoch.current++; };
  }, [worldId, bridge]);
  useEffect(() => {
    if (!job?.jobId || terminal.has(job.status)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void call("godot.historyJob", { jobId: job.jobId }).then(result => {
        if (!cancelled) setJob(result);
      }).catch(failure => { if (!cancelled) { setError(String(failure)); setJob(null); } });
    }, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job, worldId, bridge]);
  async function action(work: () => Promise<void>) {
    const token = epoch.current; setBusy(true); setError("");
    try { await work(); } catch (failure) { if (token === epoch.current) setError(String(failure)); }
    finally { if (token === epoch.current) setBusy(false); }
  }
  const identity = data ? { branchId, revision: data.index.revision, manifestHash: data.index.manifestHash } : {};
  const style = { width: "100%", minWidth: 0, overflowWrap: "anywhere" as const };
  return <section data-godot-history="true" style={{ padding: 12, overflow: "auto", minWidth: 0 }}>
    <p>创作分支只改变待检查源码。游玩版本须在检查通过后预览并确认应用。</p>
    {error && <p role="alert" data-history-error>{error}</p>}
    <button disabled={busy || !worldId} onClick={() => void load(branchId)}>刷新</button>
    {data && <>
      <p data-history-applied>正式游玩版本：{short(data.appliedOid)}</p>
      <label>创作分支 <select data-history-branch disabled={busy} value={branchId} onChange={event => { setData(null); setJob(null); void load(event.target.value); }}>
        {data.branches.map((branch: Data) => <option key={branch.branchId} value={branch.branchId}>{branch.branchId}</option>)}
      </select></label>
      <p data-history-source>当前源码：{short(data.headOid)} · 修订 {data.index.revision} · {data.headOid === data.appliedOid ? "与正式内容相同" : "待检查 / 待应用"}</p>
      <fieldset disabled={busy}>
        <legend>从所选版本新建分支</legend>
        <input data-history-name aria-label="新分支名称" value={name} placeholder="my-idea" onChange={event => setName(event.target.value)} style={style}/>
        <select data-history-from aria-label="起始版本" value={fromOid} onChange={event => setFromOid(event.target.value)} style={style}>
          <option value={data.headOid}>当前分支 · {short(data.headOid)}</option>
          {(data.history.records ?? []).filter((record: Data) => record.oid !== data.headOid).map((record: Data) => <option key={record.oid} value={record.oid}>{short(record.oid)} · {record.subject}</option>)}
        </select>
        <button data-history-create disabled={!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name)} onClick={() => void action(async () => {
          const token = epoch.current;
          await call("godot.historyCreateBranch", { branchId: name, fromOid });
          if (token === epoch.current) { setName(""); setJob(null); await load(name); }
        })}>新建并切换创作分支</button>
      </fieldset>
      <h3>版本记录</h3>
      {!data.appliedOid && <p>尚无正式版本，应用首个版本后可对比。</p>}
      <button data-history-compare-head disabled={busy || !data.appliedOid} onClick={() => setCompareOid(data.headOid)}>当前分支与正式版本对比</button>
      <ul data-history-records>{(data.history.records ?? []).map((record: Data) => <li key={record.oid} style={style}>{short(record.oid)} · {record.subject} {record.oid === data.appliedOid ? "（正式）" : ""} <button data-history-compare={record.oid} disabled={busy || !data.appliedOid} onClick={() => setCompareOid(record.oid)}>与正式版本对比</button></li>)}</ul>
      <button disabled={busy || !data.history.skip} onClick={() => void load(branchId, Math.max(0, data.history.skip - 20), data.index.offset ?? 0)}>上一页版本</button>
      <button disabled={busy || data.history.nextSkip == null} onClick={() => void load(branchId, data.history.nextSkip, data.index.offset ?? 0)}>下一页版本</button>
      {compareOid && worldId && <GodotVersionComparison key={`${worldId}:${data.viewId}:${compareOid}`} bridge={bridge} worldId={worldId} viewId={data.viewId} targetOid={compareOid}/>}
      <h3>分支源码</h3>
      <ul data-history-files>{(data.index.files ?? []).map((file: Data) => <li key={file.path} style={style}><button disabled={busy} onClick={() => void action(async () => {
        const token = epoch.current;
        const result = await call("godot.historyReadSource", { ...identity, path: file.path });
        if (token === epoch.current) { setSource(result); setText(result.text ?? ""); }
      })}>{file.path}</button></li>)}</ul>
      <button disabled={busy || !data.index.offset} onClick={() => void load(branchId, data.history.skip, Math.max(0, data.index.offset - 32))}>上一页文件</button>
      <button disabled={busy || data.index.nextOffset == null} onClick={() => void load(branchId, data.history.skip, data.index.nextOffset)}>下一页文件</button>
      {source && <div><p>{source.path}</p>{source.encoding === "base64" ? <p>二进制资源 · {source.bytes} 字节</p> : <>
        {source.nextOffset != null && <p>文件较长，此处仅展示开头，编辑已禁用。</p>}
        <textarea data-history-text aria-label="源码" style={{ ...style, height: 180, fontFamily: "monospace" }} readOnly={busy || source.nextOffset != null} value={text} onChange={event => setText(event.target.value)}/>
        <button data-history-save disabled={busy || source.nextOffset != null || text === source.text} onClick={() => void action(async () => {
          const token = epoch.current;
          await call("godot.historySaveSource", { ...identity, path: source.path, expectedHash: source.sha256, text });
          if (token === epoch.current) { setJob(null); await load(branchId); }
        })}>保存分支源码</button>
      </>}</div>}
      <button data-history-check disabled={busy || !!(job && !terminal.has(job.status))} onClick={() => void action(async () => {
        const token = epoch.current; const result = await call("godot.historyCheck", identity);
        if (token === epoch.current) setJob(result);
      })}>检查当前分支</button>
      {job && <p data-history-job>{job.branchId ?? branchId} · {job.status} {job.stage ?? ""} {job.blockedReason ?? job.interruptReason ?? ""}</p>}
      <button data-history-candidates onClick={onOpenChecks}>打开检查记录与候选预览</button>
    </>}
  </section>;
}
