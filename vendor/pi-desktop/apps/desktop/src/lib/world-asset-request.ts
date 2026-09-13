import type { AssetVersion } from "../components/craftmine/assets/asset-library-model";
import type { ComposerDraftSnapshot } from "./composer-smart-stop";

/** The exact catalog version is a reference, never executable source or a path. */
export function worldAssetPrompt(asset: Pick<AssetVersion, "assetId" | "version" | "contentHash" | "displayName" | "mediaKind">, modify: boolean, chinese: boolean): string {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(asset.assetId) || !Number.isSafeInteger(asset.version) || asset.version < 1 || !/^[a-f0-9]{64}$/.test(asset.contentHash)) throw Error("INVALID_ASSET_REFERENCE");
  const ref = JSON.stringify({assetId: asset.assetId, version: asset.version, contentHash: asset.contentHash});
  const name = JSON.stringify(asset.displayName);
  if (chinese) return `请读取素材库中的 ${name}，固定版本引用：${ref}。${modify ? "先和我确认希望修改的外观或功能，再复用并修改一个独立副本，加入当前世界。" : "检查它的实际功能、依赖与当前世界兼容性，将独立副本加入当前世界。"}保留原世界和素材原件，明确说明复用来源、检查及应用结果。${asset.mediaKind === "model" ? "这是模型素材；需要交互玩法时请补齐对应行为。" : ""}`;
  return `Read library asset ${name} at this exact reference: ${ref}. ${modify ? "Ask which appearance or behavior I want changed, then modify an independent copy and add it to this world." : "Check its actual capabilities, dependencies and compatibility, then add an independent copy to this world."} Preserve existing content and the library original. Report provenance, checks and application status.${asset.mediaKind === "model" ? " This is a model; add behavior when interaction is requested." : ""}`;
}

export function appendWorldAssetRequest(draft: ComposerDraftSnapshot | undefined, text: string): ComposerDraftSnapshot {
  return {text: draft?.text ? `${draft.text}\n\n${text}` : text, fileReferences: draft?.fileReferences.map(file => ({...file})) ?? []};
}
