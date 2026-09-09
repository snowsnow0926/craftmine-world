//! CP0 package format: strict JSON parsing, canonical content identity, path
//! and kind rules, legacy mapping and dependency-lock validation.
//!
//! The canonical form is the RFC 8785 subset frozen for this product: UTF-8,
//! no whitespace, object keys sorted by UTF-16 code unit sequence, arrays keep
//! order, strings escape only quote, backslash and U+0000..U+001F, and numbers
//! must be JSON integer literals within the JavaScript safe range. Float
//! literals are refused so Rust and JavaScript cannot disagree about a hash.
use super::super::digest;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const PACKAGE_FORMAT: &str = "craftmine.package/1";
pub(super) const RESOURCE_FORMAT: &str = "craftmine.resource/1";
pub(super) const LOCK_FORMAT: &str = "craftmine.assets-lock/1";
pub(super) const KINDS: &[&str] = &["base", "world", "module", "object", "scene", "raw", "data"];
pub(super) const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_PATH_BYTES: usize = 240;
const DEVICES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

// ---------------------------------------------------------------------------
// Strict JSON parsing
// ---------------------------------------------------------------------------

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            bytes: text.as_bytes(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn expect(&mut self, byte: u8) -> Result<()> {
        ensure!(self.peek() == Some(byte), "INVALID_JSON");
        self.pos += 1;
        Ok(())
    }

    fn literal(&mut self, word: &str, value: Value) -> Result<Value> {
        ensure!(
            self.bytes[self.pos..].starts_with(word.as_bytes()),
            "INVALID_JSON"
        );
        self.pos += word.len();
        Ok(value)
    }

    fn value(&mut self) -> Result<Value> {
        self.skip_whitespace();
        match self.peek().context("INVALID_JSON")? {
            b'{' => self.object(),
            b'[' => self.array(),
            b'"' => Ok(Value::String(self.string()?)),
            b't' => self.literal("true", Value::Bool(true)),
            b'f' => self.literal("false", Value::Bool(false)),
            b'n' => self.literal("null", Value::Null),
            b'-' | b'0'..=b'9' => self.number(),
            _ => anyhow::bail!("INVALID_JSON"),
        }
    }

    fn object(&mut self) -> Result<Value> {
        self.expect(b'{')?;
        let mut map = Map::new();
        self.skip_whitespace();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(Value::Object(map));
        }
        loop {
            self.skip_whitespace();
            let key = self.string()?;
            self.skip_whitespace();
            self.expect(b':')?;
            let value = self.value()?;
            ensure!(!map.contains_key(&key), "PACKAGE_DUPLICATE_KEY");
            map.insert(key, value);
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Value::Object(map));
                }
                _ => anyhow::bail!("INVALID_JSON"),
            }
        }
    }

    fn array(&mut self) -> Result<Value> {
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(Value::Array(items));
        }
        loop {
            items.push(self.value()?);
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Value::Array(items));
                }
                _ => anyhow::bail!("INVALID_JSON"),
            }
        }
    }

    fn hex4(&mut self) -> Result<u32> {
        let end = self.pos + 4;
        ensure!(end <= self.bytes.len(), "INVALID_JSON");
        let text = std::str::from_utf8(&self.bytes[self.pos..end]).context("INVALID_JSON")?;
        let value = u32::from_str_radix(text, 16).context("INVALID_JSON")?;
        self.pos = end;
        Ok(value)
    }

    fn string(&mut self) -> Result<String> {
        self.expect(b'"')?;
        let mut out = String::new();
        loop {
            let byte = self.peek().context("INVALID_JSON")?;
            match byte {
                b'"' => {
                    self.pos += 1;
                    return Ok(out);
                }
                b'\\' => {
                    self.pos += 1;
                    let escape = self.peek().context("INVALID_JSON")?;
                    self.pos += 1;
                    match escape {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{08}'),
                        b'f' => out.push('\u{0c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let first = self.hex4()?;
                            let code = if (0xD800..0xDC00).contains(&first) {
                                ensure!(self.peek() == Some(b'\\'), "INVALID_JSON");
                                self.pos += 1;
                                ensure!(self.peek() == Some(b'u'), "INVALID_JSON");
                                self.pos += 1;
                                let second = self.hex4()?;
                                ensure!((0xDC00..0xE000).contains(&second), "INVALID_JSON");
                                0x1_0000 + ((first - 0xD800) << 10) + (second - 0xDC00)
                            } else {
                                ensure!(!(0xDC00..0xE000).contains(&first), "INVALID_JSON");
                                first
                            };
                            out.push(char::from_u32(code).context("INVALID_JSON")?);
                        }
                        _ => anyhow::bail!("INVALID_JSON"),
                    }
                }
                byte if byte < 0x20 => anyhow::bail!("INVALID_JSON"),
                _ => {
                    let start = self.pos;
                    while matches!(self.peek(), Some(byte) if byte >= 0x20 && byte != b'"' && byte != b'\\')
                    {
                        self.pos += 1;
                    }
                    out.push_str(std::str::from_utf8(&self.bytes[start..self.pos])?);
                }
            }
        }
    }

    fn number(&mut self) -> Result<Value> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        let digits_start = self.pos;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        ensure!(self.pos > digits_start, "INVALID_JSON");
        ensure!(
            !(self.bytes[digits_start] == b'0' && self.pos > digits_start + 1),
            "INVALID_JSON"
        );
        ensure!(
            !matches!(self.peek(), Some(b'.' | b'e' | b'E')),
            "PACKAGE_FLOAT_NOT_CANONICAL"
        );
        let text = std::str::from_utf8(&self.bytes[start..self.pos])?;
        let value = text.parse::<i64>().context("INVALID_JSON")?;
        ensure!(
            value.abs() <= MAX_SAFE_INTEGER,
            "PACKAGE_NUMBER_OUT_OF_RANGE"
        );
        Ok(json!(value))
    }
}

/// Parses strict JSON, rejecting duplicate keys, float literals and integers
/// outside the cross-language safe range.
pub(super) fn parse(text: &str) -> Result<Value> {
    let mut parser = Parser::new(text);
    let value = parser.value()?;
    parser.skip_whitespace();
    ensure!(parser.pos == parser.bytes.len(), "INVALID_JSON");
    Ok(value)
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

fn escape(value: &str, out: &mut String) {
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            character if (character as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => out.push(character),
        }
    }
}

fn canonical_into(value: &Value, out: &mut String) -> Result<()> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(number) => {
            let integer = number.as_i64().context("PACKAGE_FLOAT_NOT_CANONICAL")?;
            ensure!(
                integer.abs() <= MAX_SAFE_INTEGER,
                "PACKAGE_NUMBER_OUT_OF_RANGE"
            );
            out.push_str(&integer.to_string());
        }
        Value::String(text) => {
            out.push('"');
            escape(text, out);
            out.push('"');
        }
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                canonical_into(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys = map.keys().collect::<Vec<_>>();
            keys.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push('"');
                escape(key, out);
                out.push_str("\":");
                canonical_into(&map[*key], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// Canonical text for a parsed value.
pub(super) fn canonical(value: &Value) -> Result<String> {
    let mut out = String::new();
    canonical_into(value, &mut out)?;
    Ok(out)
}

/// Canonical text straight from strict JSON input.
pub(super) fn canonical_json(text: &str) -> Result<String> {
    canonical(&parse(text)?)
}

/// Content identity of a resource `content` object.
pub(super) fn content_hash(value: &Value) -> Result<String> {
    Ok(digest(&canonical(value)?))
}

// ---------------------------------------------------------------------------
// Paths, kinds and legacy mapping
// ---------------------------------------------------------------------------

fn reserved_segment(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or(segment);
    DEVICES.iter().any(|device| stem.eq_ignore_ascii_case(device))
}

/// Characters whose canonical composition cannot be verified without a shared
/// Unicode normalization dependency. They are refused so Rust and JavaScript
/// agree on path identity; an author precomposes the name instead.
fn needs_normalization(character: char) -> bool {
    matches!(character as u32,
        0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
        || matches!(character, '\u{2126}' | '\u{212A}' | '\u{212B}' | '\u{FB00}'..='\u{FB06}')
}

pub(super) fn validate_path(path: &str) -> Result<()> {
    ensure!(
        !path.is_empty() && path.len() <= MAX_PATH_BYTES,
        "INVALID_PACKAGE_PATH"
    );
    ensure!(
        !path.contains(['\\', ':']) && !path.starts_with('/') && !path.ends_with('/'),
        "INVALID_PACKAGE_PATH"
    );
    for segment in path.split('/') {
        ensure!(
            !segment.is_empty() && segment != "." && segment != ".." && !reserved_segment(segment),
            "INVALID_PACKAGE_PATH"
        );
        ensure!(
            !segment.chars().any(needs_normalization),
            "PACKAGE_PATH_NEEDS_NORMALIZATION"
        );
    }
    Ok(())
}

fn fold(path: &str) -> String {
    path.to_lowercase()
}

/// Rejects exact duplicates and case-insensitive collisions.
pub(super) fn validate_entries(paths: &[String]) -> Result<Vec<String>> {
    let mut seen = BTreeSet::new();
    for path in paths {
        validate_path(path)?;
        ensure!(seen.insert(fold(path)), "PACKAGE_DUPLICATE_ENTRY");
    }
    let mut sorted = paths.to_vec();
    sorted.sort();
    Ok(sorted)
}

pub(super) fn validate_kind(kind: &str) -> Result<()> {
    ensure!(KINDS.contains(&kind), "INVALID_PACKAGE_KIND");
    Ok(())
}

/// Legacy library kinds map to a CP0 kind. `creation` is deliberately
/// ambiguous: it must be resolved by the author, never guessed from a name.
pub(super) fn legacy_kind(source: &Value) -> Result<Value> {
    let format = source["format"].as_str().context("PACKAGE_LEGACY_FORMAT_UNKNOWN")?;
    ensure!(
        matches!(
            format,
            "craftmine.module/1" | "craftmine.module/2" | "craftmine.module/3" | "craftmine.module/4"
        ),
        "PACKAGE_LEGACY_FORMAT_UNKNOWN"
    );
    let kind = source["kind"]
        .as_str()
        .context("PACKAGE_LEGACY_FORMAT_UNKNOWN")?;
    match kind {
        "object" => Ok(json!({"kind": "object"})),
        "gameplay" => Ok(json!({"kind": "module"})),
        "scene" => Ok(json!({"kind": "scene"})),
        "raw" => Ok(json!({"kind": "raw"})),
        "data" => Ok(json!({"kind": "data"})),
        "world-template" => Ok(json!({"kind": "world"})),
        "base" => Ok(json!({"kind": "base"})),
        "creation" => Ok(json!({"ambiguous": ["module", "object", "scene", "world"]})),
        _ => anyhow::bail!("PACKAGE_LEGACY_FORMAT_UNKNOWN"),
    }
}

// ---------------------------------------------------------------------------
// Dependency lock
// ---------------------------------------------------------------------------

fn reference(value: &Value) -> Result<(String, u64)> {
    let id = value["id"]
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 80
                && id
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'-' | b'_' | b'.'))
        })
        .context("INVALID_ASSET_ID")?
        .to_owned();
    let version = value["version"].as_u64().context("INVALID_VERSION")?;
    ensure!(version > 0 && version <= 100_000, "INVALID_VERSION");
    Ok((id, version))
}

fn label(id: &str, version: u64) -> String {
    format!("{id}@{version}")
}

/// The lock must contain exactly the reachable closure of the direct refs,
/// with one version per assetId and no cycle.
pub(super) fn validate_lock(lock: &Value) -> Result<()> {
    let direct = lock["direct"].as_array().context("LOCK_DIRECT_REQUIRED")?;
    let closure = lock["closure"].as_array().context("LOCK_CLOSURE_REQUIRED")?;
    let graph = lock["graph"].as_object().cloned().unwrap_or_default();

    let mut versions: BTreeMap<String, u64> = BTreeMap::new();
    let mut available = BTreeSet::new();
    for item in closure {
        let (id, version) = reference(item)?;
        match versions.get(&id) {
            Some(existing) => ensure!(*existing == version, "PACKAGE_LOCK_VERSION_CONFLICT"),
            None => {
                versions.insert(id.clone(), version);
            }
        }
        available.insert(label(&id, version));
    }

    let mut roots = Vec::new();
    for item in direct {
        let (id, version) = reference(item)?;
        let key = label(&id, version);
        ensure!(
            available.contains(&key),
            "PACKAGE_LOCK_MISSING_DEPENDENCY"
        );
        roots.push(key);
    }

    let mut reachable = BTreeSet::new();
    let mut stack: Vec<(String, Vec<String>)> = roots
        .into_iter()
        .map(|root| (root, Vec::new()))
        .collect();
    while let Some((node, path)) = stack.pop() {
        if let Some(index) = path.iter().position(|item| item == &node) {
            let mut cycle = path[index..].to_vec();
            cycle.push(node);
            anyhow::bail!("PACKAGE_DEPENDENCY_CYCLE: {}", cycle.join(" -> "));
        }
        if !reachable.insert(node.clone()) {
            continue;
        }
        let mut next = path.clone();
        next.push(node.clone());
        if let Some(edges) = graph.get(&node).and_then(Value::as_array) {
            for edge in edges {
                let edge = edge.as_str().context("LOCK_GRAPH_REQUIRED")?.to_owned();
                ensure!(available.contains(&edge), "PACKAGE_LOCK_MISSING_DEPENDENCY");
                stack.push((edge, next.clone()));
            }
        }
    }
    ensure!(
        reachable.len() == available.len(),
        "PACKAGE_LOCK_UNREACHABLE_ENTRY"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Resource manifest and package.json
// ---------------------------------------------------------------------------

fn fields(value: &Value, allowed: &[&str]) -> Result<()> {
    let object = value.as_object().context("OBJECT_REQUIRED")?;
    ensure!(
        object.keys().all(|key| allowed.contains(&key.as_str())),
        "UNKNOWN_FIELD"
    );
    Ok(())
}

fn hash_field(value: &Value, key: &str) -> Result<String> {
    let text = value[key].as_str().context("HASH_REQUIRED")?;
    ensure!(
        text.len() == 64 && text.bytes().all(|c| c.is_ascii_hexdigit()),
        "INVALID_HASH"
    );
    Ok(text.to_ascii_lowercase())
}

fn file_reference(value: &Value) -> Result<Value> {
    fields(value, &["path", "bytes", "sha256"])?;
    let path = value["path"].as_str().context("PATH_REQUIRED")?;
    validate_path(path)?;
    let bytes = value["bytes"].as_u64().context("BYTES_REQUIRED")?;
    Ok(json!({"path": path, "bytes": bytes, "sha256": hash_field(value, "sha256")?}))
}

fn asset_reference(value: &Value) -> Result<Value> {
    fields(value, &["id", "version", "sha256"])?;
    let (id, version) = reference(value)?;
    Ok(json!({"id": id, "version": version, "sha256": hash_field(value, "sha256")?}))
}

/// Validates a `craftmine.resource/1` manifest and returns the normalized form.
pub(super) fn validate_resource_manifest(value: &Value) -> Result<Value> {
    fields(value, &["format", "content", "contentHash"])?;
    ensure!(value["format"] == RESOURCE_FORMAT, "INVALID_RESOURCE_FORMAT");
    let content = &value["content"];
    fields(
        content,
        &[
            "assetId",
            "version",
            "kind",
            "files",
            "dependencies",
            "entry",
            "interfaces",
            "compatibility",
            "state",
            "licenses",
        ],
    )?;
    let (asset_id, version) = reference(&json!({
        "id": content["assetId"], "version": content["version"]
    }))?;
    let kind = content["kind"].as_str().context("INVALID_PACKAGE_KIND")?;
    validate_kind(kind)?;
    let mut files = Vec::new();
    for item in content["files"].as_array().context("FILES_REQUIRED")? {
        files.push(file_reference(item)?);
    }
    let paths = files
        .iter()
        .map(|item| item["path"].as_str().unwrap_or_default().to_owned())
        .collect::<Vec<_>>();
    validate_entries(&paths)?;
    let mut dependencies = Vec::new();
    let mut seen = BTreeSet::new();
    for item in content["dependencies"].as_array().context("DEPENDENCIES_REQUIRED")? {
        let dependency = asset_reference(item)?;
        let (id, version) = reference(&dependency)?;
        ensure!(id != asset_id, "PACKAGE_SELF_DEPENDENCY");
        ensure!(
            seen.insert((id.clone(), version)),
            "PACKAGE_DUPLICATE_DEPENDENCY"
        );
        dependencies.push(dependency);
    }
    for key in ["entry", "interfaces", "compatibility", "state", "licenses"] {
        ensure!(content[key].is_object(), "RESOURCE_SECTION_REQUIRED");
    }
    let normalized = json!({"assetId": asset_id, "version": version, "kind": kind,
        "files": files, "dependencies": dependencies, "entry": content["entry"],
        "interfaces": content["interfaces"], "compatibility": content["compatibility"],
        "state": content["state"], "licenses": content["licenses"]});
    let expected = content_hash(&normalized)?;
    ensure!(
        value["contentHash"].as_str() == Some(expected.as_str()),
        "RESOURCE_CONTENT_HASH_MISMATCH"
    );
    Ok(json!({"format": RESOURCE_FORMAT, "content": normalized, "contentHash": expected}))
}

/// Validates a `craftmine.package/1` index. `entry_paths` is the archive's
/// actual entry list, so an unlisted or missing file is refused.
pub(super) fn validate_package_json(value: &Value, entry_paths: &[String]) -> Result<Value> {
    fields(
        value,
        &["format", "root", "resources", "files", "archiveSha256", "bytes"],
    )?;
    ensure!(value["format"] == PACKAGE_FORMAT, "INVALID_PACKAGE_FORMAT");
    let root = asset_reference(&value["root"])?;
    let mut resources = Vec::new();
    let mut declared = BTreeSet::new();
    for resource in value["resources"].as_array().context("RESOURCES_REQUIRED")? {
        fields(resource, &["contentHash", "manifest", "files"])?;
        let content_hash = hash_field(resource, "contentHash")?;
        let manifest = validate_resource_manifest(&resource["manifest"])?;
        ensure!(
            manifest["contentHash"] == content_hash,
            "RESOURCE_CONTENT_HASH_MISMATCH"
        );
        let prefix = format!("resources/{content_hash}/");
        for file in resource["files"].as_array().context("FILES_REQUIRED")? {
            let file = file_reference(file)?;
            let path = file["path"].as_str().unwrap_or_default();
            ensure!(
                path.starts_with(&prefix),
                "PACKAGE_RESOURCE_PATH_MISMATCH"
            );
            declared.insert(path.to_owned());
        }
        declared.insert(format!("{prefix}manifest.json"));
        resources.push(json!({"contentHash": content_hash, "manifest": manifest,
            "files": resource["files"]}));
    }
    for item in value["files"].as_array().context("FILES_REQUIRED")? {
        let file = file_reference(item)?;
        let path = file["path"].as_str().unwrap_or_default();
        ensure!(
            declared.contains(path),
            "PACKAGE_FILE_NOT_IN_ENTRIES"
        );
    }
    let entries = entry_paths
        .iter()
        .filter(|path| path.as_str() != "package.json")
        .cloned()
        .collect::<Vec<_>>();
    let declared_all = declared.iter().cloned().collect::<Vec<_>>();
    for path in &entries {
        ensure!(
            declared_all.contains(path),
            "PACKAGE_ENTRY_NOT_LISTED: {}",
            path
        );
    }
    for path in &declared_all {
        ensure!(entries.contains(path), "PACKAGE_MISSING_FILE: {}", path);
    }
    Ok(json!({"format": PACKAGE_FORMAT, "root": root, "resources": resources,
        "files": value["files"], "entryCount": entries.len()}))
}

/// One validation entry point for import and for the installer. It writes
/// nothing: R1 registers it as `package.formatCheck` and the archive/installer
/// layers call it before any file or database row is created.
impl super::super::TaskJournal {
    pub fn package_format_check(&self, args: &Value) -> Result<Value> {
        super::super::durable::fields(
            args,
            &[
                "text", "paths", "kind", "legacy", "lock", "manifest", "package", "entries",
            ],
        )?;
        let mut result = Map::new();
        if let Some(text) = args.get("text").filter(|value| !value.is_null()) {
            let canonical = canonical_json(text.as_str().context("TEXT_REQUIRED")?)?;
            result.insert("contentHash".into(), json!(digest(&canonical)));
            result.insert("canonical".into(), json!(canonical));
        }
        if let Some(paths) = args.get("paths").filter(|value| !value.is_null()) {
            let list = paths
                .as_array()
                .context("PATHS_REQUIRED")?
                .iter()
                .map(|path| {
                    path.as_str()
                        .context("PATH_REQUIRED")
                        .map(str::to_owned)
                })
                .collect::<Result<Vec<_>>>()?;
            result.insert("entries".into(), json!(validate_entries(&list)?));
        }
        if let Some(kind) = args.get("kind").filter(|value| !value.is_null()) {
            validate_kind(kind.as_str().context("KIND_REQUIRED")?)?;
            result.insert("kind".into(), kind.clone());
        }
        if let Some(legacy) = args.get("legacy").filter(|value| !value.is_null()) {
            result.insert("legacy".into(), legacy_kind(legacy)?);
        }
        if let Some(lock) = args.get("lock").filter(|value| !value.is_null()) {
            validate_lock(lock)?;
            result.insert("lock".into(), json!("ok"));
            result.insert("lockFormat".into(), json!(LOCK_FORMAT));
        }
        if let Some(manifest) = args.get("manifest").filter(|value| !value.is_null()) {
            result.insert("manifest".into(), validate_resource_manifest(manifest)?);
        }
        if let Some(package) = args.get("package").filter(|value| !value.is_null()) {
            let entries = args["entries"]
                .as_array()
                .context("ENTRIES_REQUIRED")?
                .iter()
                .map(|entry| {
                    entry
                        .as_str()
                        .context("PATH_REQUIRED")
                        .map(str::to_owned)
                })
                .collect::<Result<Vec<_>>>()?;
            result.insert(
                "package".into(),
                validate_package_json(package, &entries)?,
            );
        }
        Ok(Value::Object(result))
    }
}

#[cfg(test)]
#[path = "package_format_tests.rs"]
mod tests;
