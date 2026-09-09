/**
 * Craftmine World asset library - static Godot package check (pure Node ESM).
 *
 * Scope (AL2 "package static check"):
 *  - Read an in-memory package (`Map<string, Uint8Array>` or
 *    `Record<string, Uint8Array>`) whose keys are `/`-separated relative paths.
 *  - Parse `.tscn` / `.tres` text for `[ext_resource]`, `[sub_resource]`,
 *    `[node]`, `[resource]` sections and `ExtResource("id")` /
 *    `SubResource("id")` usages.
 *  - Parse `.gd` text for `preload("res://...")`, `load("res://...")` and
 *    `extends "res://..."`.
 *  - Report `res://` targets missing from the package, unresolved resource ids,
 *    reference cycles between scenes/resources and unsafe package paths.
 *
 * This module never executes GDScript and never starts the Godot engine. Every
 * result carries `executed:false`; a real script/plugin preview belongs to the
 * trusted executor path (B/C), not to this static reference checker.
 *
 * Constraints: no DOM, no network, no third-party dependencies, no engine.
 */

const CODE_TOO_LARGE = 'PACKAGE_TOO_LARGE';
const CODE_INPUT = 'PACKAGE_INPUT_INVALID';

const RESOURCE_PREFIX = 'res://';
const SCENE_EXTENSION = '.tscn';
const RESOURCE_EXTENSION = '.tres';
const SCRIPT_EXTENSION = '.gd';

/** Windows device names that can never be used as a file or directory name. */
const RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const SECTION_KIND = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ATTRIBUTE = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,\]]+))/g;
const USAGE = /\b(Ext|Sub)Resource\s*\(\s*(?:"([^"]*)"|'([^']*)')\s*\)/g;
const PRELOAD = /\bpreload\s*\(\s*(['"])(res:\/\/[^'"]*)\1/g;
const LOAD = /\bload\s*\(\s*(['"])(res:\/\/[^'"]*)\1/g;
const EXTENDS = /\bextends\s+(['"])(res:\/\/[^'"]*)\1/g;

/** Safety cap for elementary cycle enumeration; well above any real package. */
const CYCLE_LIMIT = 4096;

const decoder = new TextDecoder('utf-8');

/** Error type used for every package static-check failure. */
export class AssetPreviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AssetPreviewError';
    this.code = code;
  }
}

/** Hard limits applied before any content is parsed. */
export const PACKAGE_LIMITS = Object.freeze({
  files: 4096,
  fileBytes: 4 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  refs: 20000,
});

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function fail(code, message) {
  throw new AssetPreviewError(code, message);
}

function tooLarge(message) {
  fail(CODE_TOO_LARGE, message);
}

function extensionOf(path) {
  const at = path.lastIndexOf('.');
  return at < 0 ? '' : path.slice(at).toLowerCase();
}

function isScenePath(path) {
  return extensionOf(path) === SCENE_EXTENSION;
}

function isResourcePath(path) {
  return extensionOf(path) === RESOURCE_EXTENSION;
}

function isScriptPath(path) {
  return extensionOf(path) === SCRIPT_EXTENSION;
}

/** Accept only the two documented package shapes; anything else is a bug. */
function toEntries(files) {
  if (files instanceof Map) return [...files.entries()];
  if (files && typeof files === 'object' && !Array.isArray(files) && !(files instanceof Uint8Array)) {
    return Object.entries(files);
  }
  return fail(CODE_INPUT, 'files must be a Map or a plain object of Uint8Array values');
}

/* ------------------------------------------------------------------ */
/* path safety                                                         */
/* ------------------------------------------------------------------ */

/**
 * Normalize a package-relative path and flag the unsafe shapes.
 * `..` is rejected even when it stays inside the package, because package keys
 * must be self-contained relative paths.
 */
function normalizePackagePath(raw) {
  const flags = { absolute: false, hasParent: false, empty: false, separator: false };
  let text = raw;
  if (text.includes('\\')) {
    flags.separator = true;
    text = text.split('\\').join('/');
  }
  if (text.startsWith('/') || /^[A-Za-z]:/.test(text)) flags.absolute = true;
  const segments = [];
  for (const segment of text.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      flags.hasParent = true;
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = segments.join('/');
  if (!normalized) flags.empty = true;
  return { normalized, segments, ...flags };
}

/** Return the first Windows-reserved path segment (without its extension). */
function reservedNameOf(segments) {
  for (const segment of segments) {
    const stem = segment.split('.')[0];
    if (RESERVED_NAME.test(stem)) return stem;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* text parsing                                                        */
/* ------------------------------------------------------------------ */

function parseAttributes(text) {
  const attrs = {};
  ATTRIBUTE.lastIndex = 0;
  let match;
  while ((match = ATTRIBUTE.exec(text)) !== null) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4];
  }
  return attrs;
}

function matchSection(line) {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed[0] !== '[' || trimmed[trimmed.length - 1] !== ']') return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return null;
  const spaceAt = inner.search(/\s/);
  const kind = spaceAt < 0 ? inner : inner.slice(0, spaceAt);
  if (!SECTION_KIND.test(kind)) return null;
  return { kind, attrs: parseAttributes(spaceAt < 0 ? '' : inner.slice(spaceAt)) };
}

function collectUsages(line, lineNumber, out) {
  USAGE.lastIndex = 0;
  let match;
  while ((match = USAGE.exec(line)) !== null) {
    out.push({
      line: lineNumber,
      kind: match[1] === 'Ext' ? 'ext_resource' : 'sub_resource',
      id: match[2] ?? match[3],
    });
  }
}

/**
 * Parse one `.tscn` / `.tres` text body. Declarations are collected in a first
 * pass so `ExtResource("id")` / `SubResource("id")` usages are order-independent.
 */
function parseResourceText(text) {
  const lines = text.split(/\r?\n/);
  const extResources = [];
  const extResourceIds = new Set();
  const subResourceIds = new Set();
  const usages = [];
  const nodes = [];
  let resourceHeader = false;

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index];
    const section = matchSection(line);
    if (section) {
      const { kind, attrs } = section;
      if (kind === 'ext_resource') {
        const record = {
          line: lineNumber,
          type: attrs.type ?? null,
          id: attrs.id ?? null,
          target: attrs.path ?? null,
        };
        extResources.push(record);
        if (record.id !== null) extResourceIds.add(record.id);
      } else if (kind === 'sub_resource') {
        if (attrs.id !== undefined) subResourceIds.add(attrs.id);
      } else if (kind === 'node') {
        nodes.push({
          line: lineNumber,
          name: attrs.name ?? null,
          parent: attrs.parent ?? null,
          type: attrs.type ?? null,
        });
      } else if (kind === 'resource') {
        resourceHeader = true;
      }
    }
    // `instance=ExtResource("id")` lives on the `[node ...]` line itself.
    collectUsages(line, lineNumber, usages);
  }

  return { extResources, extResourceIds, subResourceIds, usages, nodes, resourceHeader };
}

/** Remove a GDScript `#` comment while respecting string literals. */
function stripScriptComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote !== null) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#') {
      return line.slice(0, index);
    }
  }
  return line;
}

function collectScriptMatches(pattern, text, lineNumber, kind, out) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    out.push({ line: lineNumber, kind, target: match[2] });
  }
}

/** Parse `preload` / `load` / `extends` res:// references from `.gd` text. */
function parseScriptText(text) {
  const lines = text.split(/\r?\n/);
  const refs = [];
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const code = stripScriptComment(lines[index]);
    collectScriptMatches(PRELOAD, code, lineNumber, 'preload', refs);
    collectScriptMatches(LOAD, code, lineNumber, 'load', refs);
    collectScriptMatches(EXTENDS, code, lineNumber, 'extends', refs);
  }
  return refs;
}

/* ------------------------------------------------------------------ */
/* cycles                                                              */
/* ------------------------------------------------------------------ */

/** Resolve a node's full scene path; absolute `/root/...` parents are skipped. */
function nodePathOf(node) {
  if (!node.name) return null;
  if (node.parent === null || node.parent === undefined || node.parent === '' || node.parent === '.') {
    return node.name;
  }
  if (node.parent.startsWith('/')) return null;
  return `${node.parent.replace(/\/+$/, '')}/${node.name}`;
}

/**
 * Enumerate elementary cycles over the scene/resource reference graph.
 * Each cycle starts at its lexicographically smallest path, so the array is a
 * canonical rotation of the loop (e.g. `a.tscn -> b.tscn -> a.tscn` becomes
 * `['a.tscn','b.tscn']`).
 */
function findCycles(nodes, adjacency) {
  const order = new Map(nodes.map((node, index) => [node, index]));
  const cycles = [];
  const seen = new Set();

  const visit = (start, current, path, onPath) => {
    if (cycles.length >= CYCLE_LIMIT) return;
    for (const next of adjacency.get(current) ?? []) {
      const nextIndex = order.get(next);
      // Only nodes at or after `start` participate, which makes `start` the
      // minimum of every cycle reported here and dedupes rotations.
      if (nextIndex === undefined || nextIndex < order.get(start)) continue;
      if (next === start) {
        const key = path.join('\u0000');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...path]);
        }
        continue;
      }
      if (onPath.has(next)) continue;
      path.push(next);
      onPath.add(next);
      visit(start, next, path, onPath);
      onPath.delete(next);
      path.pop();
    }
  };

  for (const start of nodes) visit(start, start, [start], new Set([start]));
  cycles.sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000')));
  return cycles;
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/** Classify a package by the extensions it contains. */
export function packageKind(files) {
  let entries;
  try {
    entries = toEntries(files);
  } catch {
    return 'unknown';
  }
  let scene = false;
  let script = false;
  let resource = false;
  for (const [key] of entries) {
    if (typeof key !== 'string') continue;
    if (isScenePath(key)) scene = true;
    else if (isScriptPath(key)) script = true;
    else if (isResourcePath(key)) resource = true;
  }
  const kinds = Number(scene) + Number(script) + Number(resource);
  if (kinds === 0) return 'unknown';
  if (kinds > 1) return 'mixed';
  return scene ? 'scene' : script ? 'script' : 'resource';
}

/**
 * Statically check a Godot package for reference integrity.
 *
 * @param {Map<string, Uint8Array>|Record<string, Uint8Array>} files
 * @returns {{ok:boolean, kind:'scene'|'script'|'resource'|'mixed'|'unknown',
 *            executed:false, files:number, bytes:number, scenes:string[],
 *            scripts:string[], extResources:Array<object>,
 *            missing:Array<object>, cycles:string[][], issues:Array<object>}}
 */
export function checkGodotPackage(files) {
  const entries = toEntries(files);
  if (entries.length > PACKAGE_LIMITS.files) {
    tooLarge(`package file count ${entries.length} exceeds limit ${PACKAGE_LIMITS.files}`);
  }

  const issues = [];
  const records = [];
  let totalBytes = 0;

  for (const [rawKey, value] of entries) {
    if (typeof rawKey !== 'string') {
      issues.push({ code: 'invalid-path', path: String(rawKey), message: 'package path must be a string' });
      continue;
    }
    const path = normalizePackagePath(rawKey);
    const valid = value instanceof Uint8Array;
    const bytes = valid ? value.byteLength : 0;
    if (bytes > PACKAGE_LIMITS.fileBytes) {
      tooLarge(`file ${rawKey} is ${bytes} bytes, over the ${PACKAGE_LIMITS.fileBytes} byte per-file limit`);
    }
    totalBytes += bytes;
    records.push({
      raw: rawKey,
      normalized: path.normalized,
      value,
      bytes,
      extension: extensionOf(path.normalized),
    });

    if (path.hasParent) {
      issues.push({ code: 'path-traversal', path: rawKey, normalized: path.normalized, message: `path ${rawKey} contains a '..' segment` });
    }
    if (path.absolute) {
      issues.push({ code: 'absolute-path', path: rawKey, message: `path ${rawKey} is absolute` });
    }
    if (path.separator) {
      issues.push({ code: 'invalid-separator', path: rawKey, message: `path ${rawKey} uses a backslash separator; package keys use '/'` });
    }
    if (path.empty) {
      issues.push({ code: 'empty-path', path: rawKey, message: `path ${rawKey} is empty after normalization` });
    }
    const reserved = reservedNameOf(path.segments);
    if (reserved !== null) {
      issues.push({ code: 'reserved-name', path: rawKey, name: reserved, message: `path ${rawKey} uses the reserved Windows name ${reserved}` });
    }
    if (!valid) {
      issues.push({ code: 'invalid-file', path: rawKey, message: `file ${rawKey} is not a Uint8Array` });
    }
  }

  if (totalBytes > PACKAGE_LIMITS.totalBytes) {
    tooLarge(`package total size ${totalBytes} exceeds limit ${PACKAGE_LIMITS.totalBytes}`);
  }

  // Duplicate normalized paths and case-only collisions.
  const firstByNormalized = new Map();
  const byLower = new Map();
  for (const record of records) {
    const previous = firstByNormalized.get(record.normalized);
    if (previous) {
      issues.push({
        code: 'duplicate-path',
        path: record.raw,
        other: previous.raw,
        normalized: record.normalized,
        message: `path ${record.raw} duplicates ${previous.raw} after normalization`,
      });
    } else {
      firstByNormalized.set(record.normalized, record);
    }
    const lower = record.normalized.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, []);
    byLower.get(lower).push(record);
  }
  for (const group of byLower.values()) {
    const distinct = new Map();
    for (const record of group) if (!distinct.has(record.normalized)) distinct.set(record.normalized, record);
    if (distinct.size < 2) continue;
    const list = [...distinct.values()];
    for (const record of list) {
      const other = list.find((candidate) => candidate !== record);
      issues.push({
        code: 'case-collision',
        path: record.raw,
        other: other.raw,
        normalized: record.normalized,
        message: `path ${record.raw} collides by case with ${other.raw}`,
      });
    }
  }

  const fileSet = new Set(records.filter((record) => record.normalized).map((record) => record.normalized));

  const scenes = [];
  const scripts = [];
  const extResources = [];
  const missing = [];
  const adjacency = new Map();
  let referenceCount = 0;
  let hasScene = false;
  let hasScript = false;
  let hasResource = false;

  const resToPackagePath = (target) => normalizePackagePath(target.slice(RESOURCE_PREFIX.length)).normalized;
  const addEdge = (from, to) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };

  for (const record of records) {
    if (!record.normalized) continue;
    const isScene = record.extension === SCENE_EXTENSION;
    const isResource = record.extension === RESOURCE_EXTENSION;
    const isScript = record.extension === SCRIPT_EXTENSION;
    if (isScene) {
      hasScene = true;
      scenes.push(record.normalized);
    }
    if (isResource) hasResource = true;
    if (isScript) {
      hasScript = true;
      scripts.push(record.normalized);
    }
    if (!(record.value instanceof Uint8Array)) continue;
    const text = decoder.decode(record.value);

    if (isScene || isResource) {
      const parsed = parseResourceText(text);
      referenceCount += parsed.extResources.length + parsed.usages.length;
      if (referenceCount > PACKAGE_LIMITS.refs) {
        tooLarge(`package reference count ${referenceCount} exceeds limit ${PACKAGE_LIMITS.refs}`);
      }
      for (const ext of parsed.extResources) {
        let targetPath = null;
        if (typeof ext.target === 'string' && ext.target.startsWith(RESOURCE_PREFIX)) {
          targetPath = resToPackagePath(ext.target);
        }
        const resolvable = targetPath !== null;
        const resolved = resolvable ? fileSet.has(targetPath) : true;
        extResources.push({
          path: record.normalized,
          line: ext.line,
          type: ext.type,
          id: ext.id,
          target: ext.target,
          resolved,
        });
        if (resolvable && !resolved) {
          missing.push({
            code: 'missing-resource',
            path: record.normalized,
            line: ext.line,
            target: ext.target,
            kind: 'ext_resource',
          });
        }
        if (resolvable && resolved && (isScenePath(targetPath) || isResourcePath(targetPath))) {
          addEdge(record.normalized, targetPath);
        }
      }
      for (const usage of parsed.usages) {
        const declared = usage.kind === 'ext_resource' ? parsed.extResourceIds : parsed.subResourceIds;
        if (!declared.has(usage.id)) {
          issues.push({
            code: usage.kind === 'ext_resource' ? 'unresolved-ext-resource' : 'unresolved-sub-resource',
            path: record.normalized,
            line: usage.line,
            id: usage.id,
            message: `${usage.kind} id ${usage.id} is referenced but never declared in ${record.normalized}`,
          });
        }
      }
      const nodePaths = new Map();
      for (const node of parsed.nodes) {
        const nodePath = nodePathOf(node);
        if (nodePath === null) continue;
        if (nodePaths.has(nodePath)) {
          issues.push({
            code: 'duplicate-node',
            path: record.normalized,
            line: node.line,
            node: nodePath,
            message: `node path ${nodePath} is declared more than once in ${record.normalized}`,
          });
        } else {
          nodePaths.set(nodePath, node);
        }
      }
    } else if (isScript) {
      const refs = parseScriptText(text);
      referenceCount += refs.length;
      if (referenceCount > PACKAGE_LIMITS.refs) {
        tooLarge(`package reference count ${referenceCount} exceeds limit ${PACKAGE_LIMITS.refs}`);
      }
      for (const ref of refs) {
        const targetPath = resToPackagePath(ref.target);
        if (!fileSet.has(targetPath)) {
          missing.push({
            code: 'missing-resource',
            path: record.normalized,
            line: ref.line,
            target: ref.target,
            kind: ref.kind,
          });
        }
      }
    }
  }

  const nodes = [...new Set([...scenes, ...records.filter((r) => r.extension === RESOURCE_EXTENSION && r.normalized).map((r) => r.normalized)])].sort();
  const cycles = findCycles(nodes, adjacency);

  scenes.sort();
  scripts.sort();
  extResources.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || String(left.id).localeCompare(String(right.id)));
  missing.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || String(left.target).localeCompare(String(right.target)));
  issues.sort((left, right) => String(left.path).localeCompare(String(right.path)) || left.code.localeCompare(right.code) || (left.line ?? 0) - (right.line ?? 0));

  const kindCount = Number(hasScene) + Number(hasScript) + Number(hasResource);
  const kind = kindCount === 0 ? 'unknown' : kindCount > 1 ? 'mixed' : hasScene ? 'scene' : hasScript ? 'script' : 'resource';

  return {
    ok: issues.length === 0 && missing.length === 0,
    kind,
    executed: false,
    files: entries.length,
    bytes: totalBytes,
    scenes,
    scripts,
    extResources,
    missing,
    cycles,
    issues,
  };
}
