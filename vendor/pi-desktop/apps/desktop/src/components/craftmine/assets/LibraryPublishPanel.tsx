import {useEffect, useRef, useState} from "react";
import {Button, Input, Select} from "../../ui";
import {libraryRecord, libraryReference, parsePublicationSource, publicationMetadata, publicationMessage, publicationPackageCall, type LibraryCall, type LibraryReference, type PublishKind, type SourceSelection} from "../../../lib/player-library";

type Attempt = {kind: PublishKind; worldId: string; operationId: string; args: Record<string, unknown>};
const retained = new Map<string, Attempt>();

/** Player-owned local publication in the existing asset sheet. */
export function LibraryPublishPanel({bridge, worldId, worldName, kind, zh, onSaved}: {
  bridge: LibraryCall | null; worldId: string; worldName?: string; kind: PublishKind; zh: boolean;
  onSaved: (ref: LibraryReference) => void;
}) {
  const cacheKey = `${worldId}:${kind}`;
  const [attempt, setAttempt] = useState<Attempt | null>(() => retained.get(cacheKey) ?? null);
  const [source, setSource] = useState<SourceSelection | null>(null);
  const [ownAssets, setOwnAssets] = useState<Array<LibraryReference & {displayName: string}>>([]);
  const [updateId, setUpdateId] = useState("");
  const [nodePath, setNodePath] = useState(String(attempt?.args.nodePath ?? ""));
  const [name, setName] = useState(String(attempt?.args.displayName ?? (kind === "world" ? worldName ?? "" : "")));
  const [description, setDescription] = useState(String(attempt?.args.description ?? attempt?.args.notes ?? ""));
  const [tags, setTags] = useState(Array.isArray(attempt?.args.tags) ? attempt.args.tags.join(", ") : "");
  const [aliases, setAliases] = useState(Array.isArray(attempt?.args.aliases) ? attempt.args.aliases.join(", ") : "");
  const [checkpoint, setCheckpoint] = useState(attempt?.args.initialState === "saved-progress");
  const [includePreview, setIncludePreview] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ref: LibraryReference; preview: boolean} | null>(null);
  const alive = useRef(true), generation = useRef(0), locked = useRef(false), cancelled = useRef(false);
  const latestAttempt = useRef(attempt); latestAttempt.current = attempt;
  useEffect(() => {alive.current = true; return () => {alive.current = false; ++generation.current; cancelled.current = true;};}, []);
  const load = async () => {
    if (!bridge || locked.current) return;
    const ticket = ++generation.current; setLoading(true); setError("");
    try {
      const [rawSource, rawAssets] = await Promise.all([
        kind === "component" ? publicationPackageCall(bridge, worldId, "sourceList") : null,
        bridge.call("asset.search", {ownerWorldId: worldId, scope: "local-library", query: kind === "world" ? "player.world." : "player.component.", mediaKind: "package", latestOnly: true, offset: 0, limit: 50}),
      ]);
      if (!alive.current || ticket !== generation.current) return;
      if (rawSource) setSource(parsePublicationSource(rawSource, worldId));
      const rows = libraryRecord(rawAssets).items;
      if (!Array.isArray(rows)) throw Error("ASSET_SEARCH_INVALID");
      setOwnAssets(rows.map(row => ({...libraryReference(row), displayName: String(libraryRecord(row).displayName ?? "")})));
    } catch (failure) {if (alive.current && ticket === generation.current) setError(publicationMessage(failure, zh));}
    finally {if (alive.current && ticket === generation.current) setLoading(false);}
  };
  useEffect(() => {void load();}, [bridge, worldId, kind]);
  const finish = (raw: unknown) => {
    const value = libraryRecord(raw), candidate = value.assetRef ?? value.ref;
    const ref = libraryReference(candidate);
    const expected = latestAttempt.current;
    if (expected && (ref.assetId !== expected.args.assetId || ref.version !== expected.args.version)) throw Error("PUBLICATION_RECEIPT_INVALID");
    retained.delete(cacheKey);
    if (alive.current) {setAttempt(null); latestAttempt.current = null; setResult({ref, preview: typeof value.preview === "string" || value.previewStatus === "source-world-view"}); setPhase(zh ? "已保存到本机素材库" : "Saved to your local library"); setError("");}
  };
  const status = async (current: Attempt) => {
    if (!bridge) return null;
    return libraryRecord(kind === "world"
      ? await bridge.call("worldTemplate.status", {operationId: current.operationId})
      : await publicationPackageCall(bridge, worldId, "publishSourceStatus", {operationId: current.operationId}));
  };
  const submit = async () => {
    if (!bridge || locked.current) return;
    setError(""); cancelled.current = false; locked.current = true; setBusy(true); setResult(null);
    try {
      let current = latestAttempt.current;
      if (!current) {
        const metadata = publicationMetadata(kind, name, description, tags, aliases);
        const existing = ownAssets.find(asset => asset.assetId === updateId);
        if (updateId && !existing) throw Error("INVALID_ASSET_REFERENCE");
        const assetId = existing?.assetId ?? `player.${kind === "world" ? "world" : "component"}.${crypto.randomUUID().replaceAll("-", "")}`;
        const version = existing ? existing.version + 1 : 1;
        const operationId = crypto.randomUUID();
        let args: Record<string, unknown>;
        if (kind === "world") {
          if (!checkpoint) throw Error(zh ? "请选择是否使用当前已保存进度作为新世界起点。" : "Choose the saved progress as the starting state first.");
          setPhase(zh ? "正在保存世界进度…" : "Saving world progress…");
          await bridge.call("godot.runtimeSave", {worldId, freeze: false});
          if (cancelled.current || !alive.current) return;
          const description = libraryRecord(await bridge.call("worldTemplate.describe", {worldId}));
          if (cancelled.current || !alive.current) return;
          const expectedSource = description.expectedSource ?? description.source;
          if (libraryRecord(expectedSource).worldId !== worldId) throw Error("WORLD_TEMPLATE_SOURCE_MISMATCH");
          args = {worldId, operationId, assetId, version, displayName: metadata.displayName, description: metadata.description, tags: [...new Set([...metadata.tags, ...metadata.aliases])], initialState: "saved-progress", expectedSource, includePreview};
        } else {
          if (!source || !source.items.some(item => item.nodePath === nodePath && item.supported)) throw Error(zh ? "请选择一个可独立保存的对象。" : "Select an independently reusable object.");
          args = {worldId, operationId, revision: source.revision, manifestHash: source.manifestHash, nodePath, assetId, version, displayName: metadata.displayName, notes: metadata.description, tags: metadata.tags, aliases: metadata.aliases, includePreview};
        }
        current = {kind, worldId, operationId, args};
        retained.set(cacheKey, current); latestAttempt.current = current; setAttempt(current);
      }
      if (cancelled.current || !alive.current) return;
      setPhase(zh ? "正在整理内容并写入素材库…" : "Collecting content and saving to the library…");
      const response = kind === "world" ? await bridge.call("worldTemplate.save", current.args) : await publicationPackageCall(bridge, worldId, "publishSource", current.args);
      if (libraryRecord(response).status === "cancelled") {retained.delete(cacheKey); latestAttempt.current = null; if (alive.current) {setAttempt(null); setPhase(zh ? "已取消保存" : "Publication cancelled");} return;}
      if (alive.current) finish(response);
    } catch (failure) {
      let recovered = false;
      if (latestAttempt.current) {
        try {const value = await status(latestAttempt.current); if (value && ["saved", "completed"].includes(String(value.status))) {finish(value.result ?? value); recovered = true;}} catch { /* Retry keeps the exact original operation. */ }
      }
      if (!recovered && alive.current) setError(publicationMessage(failure, zh));
    } finally {locked.current = false; if (alive.current) {setBusy(false); if (cancelled.current && !latestAttempt.current) setPhase(zh ? "准备已取消" : "Preparation cancelled");}}
  };
  const cancel = async () => {
    if (!bridge) return;
    cancelled.current = true;
    const current = latestAttempt.current;
    if (!current) return;
    setPhase(zh ? "正在确认取消结果…" : "Confirming cancellation…");
    try {
      const raw = kind === "world" ? await bridge.call("worldTemplate.cancel", {operationId: current.operationId}) : await publicationPackageCall(bridge, worldId, "cancelPublishSource", {operationId: current.operationId});
      const value = libraryRecord(raw);
      if (["saved", "completed"].includes(String(value.status))) {finish(value.result ?? value); return;}
      const confirmed = value.status === "cancelled" ? value : await status(current);
      if (confirmed?.status !== "cancelled") throw Error(zh ? "尚未确认取消，原操作已保留，请重试。" : "Cancellation is unconfirmed. The original operation is retained; retry.");
      retained.delete(cacheKey); latestAttempt.current = null;
      if (alive.current) {setAttempt(null); setPhase(zh ? "已取消保存" : "Publication cancelled"); setError("");}
    } catch (failure) {if (alive.current) setError(publicationMessage(failure, zh));}
  };
  const disabled = busy || !!attempt;
  const selectedAsset = ownAssets.find(asset => asset.assetId === updateId);
  return <section className="library-publish" data-library-publish={kind} data-publication-world={worldId}>
    <p className="asset-library-note">{kind === "world" ? (zh ? "保存当前已应用的世界，并用它创建新的独立世界。" : "Save the applied world as a template for independent worlds.") : (zh ? "保存对象的外观、行为和必要依赖，之后可在其他世界复用。" : "Save an object's appearance, behavior and dependencies for use in other worlds.")}</p>
    {result ? <div role="status" className="asset-library-note" data-publication-result={result.ref.assetId}>
      <p>{phase} · v{result.ref.version}</p>
      {!result.preview && <p>{zh ? "当前没有可用预览。" : "No preview is available yet."}</p>}
      <Button size="sm" onClick={() => onSaved(result.ref)}>{zh ? "查看已保存素材" : "View saved asset"}</Button>
      <Button size="sm" variant="ghost" onClick={() => {setResult(null); setPhase(""); void load();}}>{zh ? "继续保存其他内容" : "Save more content"}</Button>
    </div> : <form data-library-publish-form onSubmit={event => {event.preventDefault(); void submit();}}>
      <fieldset disabled={disabled || loading}>
        {kind === "component" && <label className="asset-library-field"><span>{zh ? "选择对象" : "Object"}</span><Select data-publication-object value={nodePath} onChange={event => {setNodePath(event.target.value); if (!name) setName(source?.items.find(item => item.nodePath === event.target.value)?.name ?? "");}}>
          <option value="">{zh ? "选择一个对象" : "Choose an object"}</option>
          {source?.items.map(item => <option key={item.nodePath} value={item.nodePath} disabled={!item.supported}>{item.name}{!item.supported ? (zh ? "（暂不能独立保存）" : " (not independently reusable)") : ""}</option>)}
        </Select></label>}
        {kind === "component" && source && !source.items.some(item => item.supported) && <p role="status">{zh ? "当前源码没有可独立导出的对象；动态生成的对象需要先整理为组件。" : "No independent source object is available. Dynamically generated objects need a component first."}</p>}
        <label className="asset-library-field"><span>{zh ? "保存方式" : "Save as"}</span><Select data-publication-version-target value={updateId} onChange={event => {setUpdateId(event.target.value); const row = ownAssets.find(asset => asset.assetId === event.target.value); if (row) setName(row.displayName);}}>
          <option value="">{zh ? "新素材 · v1" : "New asset · v1"}</option>
          {ownAssets.map(asset => <option key={asset.assetId} value={asset.assetId}>{asset.displayName} · v{asset.version + 1}</option>)}
        </Select></label>
        {selectedAsset && <p>{zh ? "旧版本保留，新版本不会替换已安装的实例。" : "Earlier versions and installed instances are preserved."}</p>}
        <label className="asset-library-field"><span>{zh ? "名称" : "Name"}</span><Input data-publication-name value={name} onChange={event => setName(event.target.value)} required maxLength={200}/></label>
        <label className="asset-library-field"><span>{zh ? "用途与功能说明" : "Purpose and capabilities"}</span><textarea data-publication-description value={description} onChange={event => setDescription(event.target.value)} maxLength={3000}/></label>
        <label className="asset-library-field"><span>{zh ? "标签（逗号分隔）" : "Tags (comma separated)"}</span><Input data-publication-tags value={tags} onChange={event => setTags(event.target.value)}/></label>
        <label className="asset-library-field"><span>{zh ? "别名（用于 AI 检索）" : "Aliases for AI search"}</span><Input data-publication-aliases value={aliases} onChange={event => setAliases(event.target.value)}/></label>
        <label className="library-publish-check"><input type="checkbox" checked={includePreview} onChange={event => setIncludePreview(event.target.checked)}/><span>{zh ? "使用当前世界视角作为预览" : "Use the current world view as a preview"}</span></label>
        {kind === "world" && <label className="library-publish-check"><input data-publication-checkpoint type="checkbox" checked={checkpoint} onChange={event => setCheckpoint(event.target.checked)}/><span>{zh ? "将当前已保存进度作为新世界起点（包括位置、探索和互动状态）" : "Use saved progress as the new world's starting state, including position, exploration and interactions"}</span></label>}
      </fieldset>
      {attempt && <p className="asset-library-note">{String(attempt.args.displayName)} · v{String(attempt.args.version)} — {zh ? "重试会继续同一次保存，不会创建重复版本。" : "Retry continues the same save without creating a duplicate version."}</p>}
      <div className="library-publish-actions"><Button type="submit" size="sm" disabled={!bridge || busy || loading}>{busy ? (zh ? "正在保存…" : "Saving…") : attempt ? (zh ? "重试本次保存" : "Retry this save") : (zh ? "保存到素材库" : "Save to library")}</Button>
        {(busy || attempt) && <Button type="button" size="sm" variant="ghost" onClick={() => void cancel()}>{zh ? "取消本次保存" : "Cancel this save"}</Button>}
        {!busy && !attempt && <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>{zh ? "重新读取" : "Reload"}</Button>}
      </div>
    </form>}
    {loading && <p role="status">{zh ? "正在读取可保存内容…" : "Loading reusable content…"}</p>}
    {phase && !result && <p role="status">{phase}</p>}
    {error && <p className="asset-library-error" role="alert">{error}</p>}
  </section>;
}
