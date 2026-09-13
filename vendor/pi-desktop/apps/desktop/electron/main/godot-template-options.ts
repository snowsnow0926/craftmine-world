import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";

/** Read only shipped publication metadata; the renderer receives no disk paths. */
export function readPublishedWorldOptions(basesRoot: string) {
  const root = path.resolve(basesRoot, "../shared/promo-templates");
  const read = (relative: string, limit: number) => {
    if (relative.includes("\\") || relative.includes(":") || relative.split("/").some(part => !part || part === "." || part === "..")) throw Error("WORLD_TEMPLATE_INVALID");
    let target = root;
    if (fs.lstatSync(root).isSymbolicLink()) throw Error("WORLD_TEMPLATE_INVALID");
    for (const part of relative.split("/")) {
      target = path.join(target, part);
      if (fs.lstatSync(target).isSymbolicLink()) throw Error("WORLD_TEMPLATE_INVALID");
    }
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > limit) throw Error("WORLD_TEMPLATE_INVALID");
    return fs.readFileSync(target);
  };
  if (!fs.existsSync(path.join(root, "catalog.json"))) return [];
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const catalog = JSON.parse(read("catalog.json", 65536).toString());
  if (catalog.format !== "craftmine.authored-world-templates/1" || !Array.isArray(catalog.templates) || catalog.templates.length > 32) throw Error("WORLD_TEMPLATE_INVALID");
  const seen = new Set<string>();
  return catalog.templates.map((entry: any) => {
    if (!/^promo-[a-z]+$/.test(entry.id) || seen.has(entry.id) || entry.kind !== "example" || typeof entry.label !== "string") throw Error("WORLD_TEMPLATE_INVALID");
    seen.add(entry.id);
    const manifestBytes = read(entry.id + "/manifest.json", 2 * 1024 * 1024);
    if (digest(manifestBytes) !== entry.sha256) throw Error("WORLD_TEMPLATE_INVALID");
    const manifest = JSON.parse(manifestBytes.toString());
    if (manifest.format !== "craftmine.authored-world-template/1" || manifest.id !== entry.id || manifest.baseId !== "creation-sandbox" || manifest.version !== entry.version) throw Error("WORLD_TEMPLATE_INVALID");
    const preview = read(entry.id + "/" + manifest.preview.file, 2 * 1024 * 1024);
    if (preview.length !== manifest.preview.bytes || digest(preview) !== manifest.preview.sha256 || preview.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw Error("WORLD_TEMPLATE_INVALID");
    return {id: entry.id as string, label: entry.label as string, description: String(entry.description ?? ""), kind: "example", delivered: true,
      preview: "data:image/png;base64," + preview.toString("base64"), source: {id: entry.id as string, version: entry.version as string, sha256: entry.sha256 as string}, initialState: "authored-defaults"};
  });
}
