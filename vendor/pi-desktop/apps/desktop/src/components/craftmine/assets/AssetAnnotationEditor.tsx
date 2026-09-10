import {useEffect, useState} from "react";
import {Button, Input} from "../../ui";
import type {AssetLibraryController} from "./use-asset-library";
import type {AssetLibraryLang} from "./asset-library-model";

/** Match the core's tag count/UTF-8 byte limits without silently truncating input. */
export function parseAnnotationTags(text: string): string[] {
  const tags = text.split(/[,，;]/u).map(tag => tag.trim()).filter(Boolean);
  if (tags.length > 32 || tags.some(tag => new TextEncoder().encode(tag).length > 40 || /\p{Cc}/u.test(tag))) {
    throw new Error("INVALID_ASSET_TAGS");
  }
  return [...new Set(tags)].sort();
}

export function AssetAnnotationEditor({controller, lang}: {controller: AssetLibraryController; lang: AssetLibraryLang}) {
  const metadata = controller.selectedMetadata;
  const [text, setText] = useState(metadata?.tags.join(", ") ?? "");
  const [validation, setValidation] = useState(false);
  const tagsKey = JSON.stringify(metadata?.tags);
  useEffect(() => {setText(metadata?.tags.join(", ") ?? ""); setValidation(false);}, [tagsKey]);
  if (!metadata || metadata.assetId !== controller.selected?.version_.assetId) return null;
  const zh = lang === "zh";
  const edit = Object.hasOwn(controller.annotationEdits, metadata.assetId) ? controller.annotationEdits[metadata.assetId] : null;
  const disabled = !!edit;
  return <section className="asset-library-annotations" data-annotation-asset={metadata.assetId}>
    <form data-annotation-form="favorite" onSubmit={event => {
      event.preventDefault();
      if (!disabled) void controller.annotate({assetId: metadata.assetId, favorite: !metadata.favorite}).catch(() => {});
    }}>
      <Button type="submit" size="sm" variant="ghost" disabled={disabled} aria-pressed={metadata.favorite}>
        {metadata.favorite ? (zh ? "取消收藏" : "Remove favorite") : (zh ? "收藏" : "Favorite")}
      </Button>
    </form>
    <form data-annotation-form="tags" onSubmit={event => {
      event.preventDefault();
      if (disabled) return;
      try {
        const tags = parseAnnotationTags(text);
        setValidation(false);
        void controller.annotate({assetId: metadata.assetId, tags}).catch(() => {});
      } catch {setValidation(true);}
    }}>
      <label className="asset-library-field">
        <span className="asset-library-field-label">{zh ? "标签（逗号分隔）" : "Tags (comma separated)"}</span>
        <Input data-annotation-tags value={text} maxLength={2048} disabled={disabled}
          onChange={event => {setText(event.target.value); setValidation(false);}} />
      </label>
      <Button type="submit" size="sm" variant="ghost" disabled={disabled}>{zh ? "保存标签" : "Save tags"}</Button>
    </form>
    {validation && <p role="alert">{zh ? "最多 32 个标签；请缩短过长标签并移除控制字符。" : "Use up to 32 short tags without control characters."}</p>}
    {edit?.saving && <p role="status">{zh ? "正在保存…" : "Saving…"}</p>}
    {edit?.error && <form data-annotation-form="retry" onSubmit={event => {
      event.preventDefault();
      void controller.retryAnnotation(metadata.assetId).catch(() => {});
    }}>
      <p role="alert">{zh ? "尚未确认保存结果，请重试同一次编辑。" : "Save not confirmed. Retry the same edit."}</p>
      <Button type="submit" size="sm" variant="ghost">{zh ? "重试保存" : "Retry save"}</Button>
    </form>}
  </section>;
}
