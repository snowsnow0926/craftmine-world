import { useEffect, useRef, useState } from "react";
import type { CraftmineWorldBridge } from "../../lib/craftmine-worlds";

type Data = Record<string, any>;
const labels: Record<string, string> = { A: "新增", D: "删除", M: "修改", T: "类型变化" };

/** Exact, read-only Git comparison. React text nodes escape all source content. */
export function GodotVersionComparison({ bridge, worldId, viewId, targetOid }: {
  bridge: CraftmineWorldBridge | null; worldId: string; viewId: string; targetOid: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [diff, setDiff] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  async function request(channel: string, args: Data) {
    const token = ++generation.current;
    setBusy(true); setError(""); setDiff(null);
    try {
      if (!bridge) throw Error("请先打开世界");
      const value = await bridge.call(channel, { worldId, viewId, targetOid, ...args }) as Data;
      if (token !== generation.current) return;
      if (value.worldId !== worldId || value.viewId !== viewId || value.toOid !== targetOid) throw Error("GODOT_HISTORY_VIEW_STALE");
      if (channel === "godot.historyCompare") setData(value); else setDiff(value);
    } catch (failure) { if (token === generation.current) setError(String(failure)); }
    finally { if (token === generation.current) setBusy(false); }
  }
  useEffect(() => {
    setData(null); setDiff(null);
    void request("godot.historyCompare", { offset: 0 });
    return () => { generation.current++; };
  }, [bridge, worldId, viewId, targetOid]);
  return <section data-history-comparison aria-label="与正式版本对比">
    <h3>与正式版本对比</h3>
    {error && <p role="alert">{error} · 请刷新版本记录后重试。</p>}
    {busy && <p role="status">正在读取差异…</p>}
    {data && <>
      <p data-compare-range>正式 {data.fromOid.slice(0, 12)} → 所选 {data.toOid.slice(0, 12)}</p>
      <p data-compare-count>{data.total === 0 ? "内容相同，没有文件变化。" : `共 ${data.total} 个文件变化 · 当前 ${data.offset + 1}–${data.offset + data.changes.length}`}</p>
      <ul data-compare-files>{data.changes.map((file: Data) => <li key={file.path}>
        <button disabled={busy} data-compare-path={file.path} onClick={() => void request("godot.historyDiff", { path: file.path })}>
          {labels[file.status] ?? file.status} · {file.path}
        </button>
      </li>)}</ul>
      <button data-compare-previous disabled={busy || data.offset === 0} onClick={() => void request("godot.historyCompare", { offset: Math.max(0, data.offset - 32) })}>上一页变化</button>
      <button data-compare-next disabled={busy || data.nextOffset == null} onClick={() => void request("godot.historyCompare", { offset: data.nextOffset })}>下一页变化</button>
    </>}
    {diff && <div data-compare-detail>
      <p>{diff.path}</p>
      {diff.kind === "binary" ? <p data-compare-binary>二进制内容变化 · 原版本 {diff.oldBytes == null ? "不存在" : `${diff.oldBytes} 字节`} → 所选版本 {diff.newBytes == null ? "不存在" : `${diff.newBytes} 字节`}</p> : <>
        <p>新增 {diff.added} 行 · 删除 {diff.removed} 行</p>
        {diff.truncated && <p data-compare-truncated>差异过长，仅显示前 {diff.shownBytes} / {diff.totalBytes} 字节，后续内容未显示。</p>}
        <pre data-compare-patch style={{ maxHeight: 360, overflow: "auto", whiteSpace: "pre", fontFamily: "monospace" }}>{diff.patch}</pre>
      </>}
    </div>}
  </section>;
}
