import {useEffect, useRef, useState} from "react";
import {APP_VERSION} from "@pi-desktop/shared";
import {libraryRecord, libraryReference, parsePlayerWorldTemplate, publicationMessage, type LibraryCall, type LibraryReference, type WorldTemplate} from "../../lib/player-library";

type LocalWorldTemplatesProps = {
  bridge: LibraryCall | null; zh: boolean; busy: boolean; initialRef?: LibraryReference | null;
  locked?: boolean;
  onCreate: (ref: LibraryReference, title: string) => Promise<void>;
  onRetry?: () => Promise<void>;
};

export function LocalWorldTemplates(props: LocalWorldTemplatesProps) {
  const [binding, setBinding] = useState({bridge: props.bridge, generation: 0});
  if (binding.bridge !== props.bridge) {
    setBinding({bridge: props.bridge, generation: binding.generation + 1});
    return null;
  }
  // Each connection owns its selection, pending replies and operation locks.
  // Returning to a former bridge still creates a new generation.
  return <BoundWorldTemplates key={binding.generation} {...props}/>;
}

function BoundWorldTemplates({bridge, zh, busy, locked = false, initialRef, onCreate, onRetry}: LocalWorldTemplatesProps) {
  const [items, setItems] = useState<Array<LibraryReference & {displayName: string}>>([]);
  const [selected, setSelected] = useState<WorldTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const alive = useRef(true), epoch = useRef(0), actionLock = useRef(false), importId = useRef<string | null>(null);
  useEffect(() => {alive.current = true; return () => {alive.current = false; ++epoch.current;};}, []);
  const load = async (offset = 0, search = query) => {
    if (!bridge || actionLock.current || locked) return;
    const ticket = ++epoch.current; setLoading(true); setError("");
    try {
      const result = libraryRecord(await bridge.call("worldTemplate.list", {query: search, offset, limit: 24}));
      if (!alive.current || ticket !== epoch.current) return;
      if (!Array.isArray(result.items)) throw Error("WORLD_TEMPLATE_INVALID");
      const incoming = result.items.map(row => ({...libraryReference(row), displayName: String(libraryRecord(row).displayName ?? "")}));
      setItems(prior => offset ? [...prior, ...incoming.filter(row => !prior.some(old => old.assetId === row.assetId && old.version === row.version))] : incoming);
      setSearchedQuery(search);
      setNextOffset(Number.isSafeInteger(result.nextOffset) ? result.nextOffset as number : null);
    } catch (failure) {if (alive.current && ticket === epoch.current) setError(publicationMessage(failure, zh));}
    finally {if (alive.current && ticket === epoch.current) setLoading(false);}
  };
  const read = async (ref: LibraryReference) => {
    if (!bridge || actionLock.current || busy || locked) return;
    const ticket = ++epoch.current; setLoading(true); setError("");
    try {const next = parsePlayerWorldTemplate(await bridge.call("worldTemplate.read", {ref: libraryReference(ref)})); if (alive.current && ticket === epoch.current) {setSelected(next); setTitle(`${next.displayName}${zh ? " · 我的副本" : " · My copy"}`.slice(0, 80));}}
    catch (failure) {if (alive.current && ticket === epoch.current) setError(publicationMessage(failure, zh));}
    finally {if (alive.current && ticket === epoch.current) setLoading(false);}
  };
  useEffect(() => {if (initialRef) void read(initialRef); else void load();}, [bridge]);
  const run = async (work: () => Promise<void>, retry = false) => {
    if (!bridge || busy || (locked && !retry) || actionLock.current) return;
    actionLock.current = true; setActionBusy(true); setError(""); setNotice("");
    try {await work();} catch (failure) {if (alive.current) setError(publicationMessage(failure, zh));}
    finally {actionLock.current = false; if (alive.current) setActionBusy(false);}
  };
  const importTemplate = async () => {
    let imported = false;
    await run(async () => {
      if (!bridge || locked) return;
      importId.current ??= crypto.randomUUID();
      const raw = await bridge.call("worldTemplate.import", {operationId: importId.current});
      if (libraryRecord(raw).status === "cancelled") {importId.current = null; return;}
      const template = parsePlayerWorldTemplate(raw); importId.current = null;
      if (alive.current) {imported = true; setQuery(""); setSelected(template); setTitle(`${template.displayName}${zh ? " · 我的副本" : " · My copy"}`.slice(0, 80)); setNotice(zh ? "模板已导入，可以创建独立世界。" : "Template imported. You can create an independent world.");}
    });
    if (imported && alive.current) await load(0, "");
  };
  return <section className="local-world-templates" data-local-world-templates>
    <p className="asset-library-note" data-template-import-help>{zh ? "演示包的 examples 文件夹或朋友分享的世界 ZIP，可从这里导入。导入后需创建独立世界，起点包含模板保存的游玩进度。" : "Import a world ZIP from the demo package’s examples folder or a friend. Then create an independent world, starting with the template’s saved play progress."}</p>
    <form className="library-publish-actions" data-template-search onSubmit={event => {event.preventDefault(); void load();}}>
      <input aria-label={zh ? "搜索我的模板" : "Search my templates"} value={query} onChange={event => setQuery(event.target.value)} disabled={busy || actionBusy || locked}/>
      <button type="submit" disabled={busy || actionBusy || loading || locked}>{zh ? "搜索" : "Search"}</button>
    </form>
    <form data-template-import onSubmit={event => {event.preventDefault(); void importTemplate();}}><button type="submit" disabled={!bridge || busy || actionBusy || locked}>{importId.current ? (zh ? "重试导入模板" : "Retry importing template") : (zh ? "导入世界模板 ZIP" : "Import world template ZIP")}</button></form>
    <div className="local-world-template-content">
      <div className="local-world-template-list">
        {items.map(item => <form key={`${item.assetId}:${item.version}`} data-local-template={item.assetId} data-template-version={item.version} onSubmit={event => {event.preventDefault(); void read(item);}}><button type="submit" disabled={busy || actionBusy || loading || locked} aria-pressed={selected?.ref.assetId === item.assetId && selected.ref.version === item.version}>{item.displayName} · v{item.version}</button></form>)}
        {!loading && !error && !items.length && (searchedQuery.trim() || !selected) && <p data-template-empty>{searchedQuery.trim() ? (zh ? "没有匹配的模板，请换个关键词或清空搜索。" : "No matching templates. Try another search or clear it.") : (zh ? "还没有世界模板。导入 ZIP，或在素材库保存当前世界。" : "No world templates yet. Import a ZIP or save your current world from the asset library.")}</p>}
        {nextOffset !== null && <button type="button" disabled={busy || actionBusy || loading || locked} onClick={() => void load(nextOffset, searchedQuery)}>{zh ? "加载更多" : "Load more"}</button>}
      </div>
      {selected && <article className="local-world-template-detail" data-local-template-selected={selected.ref.assetId}>
        <details data-template-compatibility><summary>{zh?"分享版本与兼容性":"Share version and compatibility"}</summary>
          <p>Craftmine World {APP_VERSION}</p>
          <p>{selected.ref.assetId} · v{selected.ref.version}</p><p>{selected.baseId} · {selected.baseVersion}</p>
          <p>SHA256: {selected.archiveSha256??selected.ref.contentHash}</p>
          <p>{zh?"请发送此版本的模板 ZIP 和相同版本的应用。导入成功仅表示文件有效；创建副本时仍需构建检查和首次加载。未采用草稿不包含在内。":"Send this template ZIP and the same app version. Successful import validates the archive; creating a copy still requires a build check and first load. Unapplied drafts are excluded."}</p>
        </details>
        {selected.preview && <img src={selected.preview} alt={selected.displayName}/>}
        <h2>{selected.displayName} · v{selected.ref.version}</h2><p>{selected.description}</p>
        <p className="asset-library-note">{zh ? "新世界从作者保存的起点开始，包括当时的位置、探索和互动状态。原世界保持独立。" : "The new world starts from the author's saved position, exploration and interactions. The original stays independent."}</p>
        <form data-local-template-create onSubmit={event => {event.preventDefault(); void run(() => locked && onRetry ? onRetry() : onCreate(selected.ref, title.trim()), !!(locked && onRetry));}}>
          <label>{zh ? "新世界名称" : "New world name"}<input data-template-world-title value={title} maxLength={80} required disabled={busy || actionBusy || locked} onChange={event => setTitle(event.target.value)}/></label>
          <button type="submit" disabled={!bridge || busy || actionBusy || (locked && !onRetry) || !title.trim()}>{locked && onRetry ? (zh ? "重试准备并进入" : "Retry preparation and enter") : (zh ? "创建独立世界" : "Create independent world")}</button>
        </form>
        <form data-template-export onSubmit={event => {event.preventDefault(); if (locked) return; void run(async () => {const result = libraryRecord(await bridge?.call("worldTemplate.export", {ref: selected.ref})); if (result.status === "completed" && alive.current) setNotice(zh ? "已导出世界模板 ZIP。" : "World template ZIP exported.");});}}><button type="submit" disabled={!bridge || busy || actionBusy || locked}>{zh ? "导出此版本" : "Export this version"}</button></form>
      </article>}
    </div>
    {(loading || actionBusy) && <p role="status">{zh ? "正在处理模板…" : "Working with the template…"}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p className="asset-library-error" role="alert">{error}</p>}
  </section>;
}
