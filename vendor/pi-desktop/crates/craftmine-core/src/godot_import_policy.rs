//! Narrow, cache-free import policy for ordinary static GLB source assets.
use anyhow::{ensure, Context, Result};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn is_sidecar(path: &str) -> bool { path.ends_with(".glb.import") }

pub(super) fn validate_text(text: &str) -> Result<()> {
    ensure!(text.len() <= 2048, "INVALID_GLB_IMPORT_POLICY");
    let mut section = "";
    let mut sections = BTreeSet::new();
    let mut values = BTreeMap::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if line.starts_with('[') {
            ensure!(matches!(line, "[remap]" | "[params]") && sections.insert(line), "INVALID_GLB_IMPORT_POLICY");
            section = line;
            continue;
        }
        let (key, value) = line.split_once('=').context("INVALID_GLB_IMPORT_POLICY")?;
        let key = key.trim(); let value = value.trim();
        ensure!(matches!((section, key, value),
            ("[remap]", "importer", "\"scene\"") |
            ("[remap]", "type", "\"PackedScene\"") |
            ("[remap]", "importer_version", "1") |
            ("[params]", "meshes/generate_lods", "false")), "INVALID_GLB_IMPORT_POLICY");
        ensure!(values.insert((section, key), value).is_none(), "INVALID_GLB_IMPORT_POLICY");
    }
    for required in [("[remap]", "importer"), ("[remap]", "type"), ("[params]", "meshes/generate_lods")] {
        ensure!(values.contains_key(&required), "INVALID_GLB_IMPORT_POLICY");
    }
    Ok(())
}

pub(super) fn validate_glb(bytes: &[u8]) -> Result<()> {
    ensure!(bytes.len() >= 20 && &bytes[..4] == b"glTF", "GLB_IMPORT_MODEL_INVALID");
    let word = |offset: usize| u32::from_le_bytes(bytes[offset..offset+4].try_into().unwrap()) as usize;
    ensure!(word(4) == 2 && word(8) == bytes.len(), "GLB_IMPORT_MODEL_INVALID");
    let mut offset = 12; let mut json_seen = false; let mut bin_seen = false;
    while offset < bytes.len() {
        ensure!(offset + 8 <= bytes.len(), "GLB_IMPORT_MODEL_INVALID");
        let length = word(offset); let kind = word(offset + 4);
        let end = offset.checked_add(8).and_then(|n| n.checked_add(length)).context("GLB_IMPORT_MODEL_INVALID")?;
        ensure!(length % 4 == 0 && end <= bytes.len(), "GLB_IMPORT_MODEL_INVALID");
        match kind {
            0x4e4f534a => {
                ensure!(offset == 12 && !json_seen, "GLB_IMPORT_MODEL_INVALID");
                let value: serde_json::Value = serde_json::from_slice(&bytes[offset+8..end]).context("GLB_IMPORT_MODEL_INVALID")?;
                ensure!(value["asset"]["version"] == "2.0", "GLB_IMPORT_MODEL_INVALID"); json_seen = true;
            }
            0x004e4942 => { ensure!(json_seen && !bin_seen, "GLB_IMPORT_MODEL_INVALID"); bin_seen = true; }
            _ => anyhow::bail!("GLB_IMPORT_MODEL_INVALID"),
        }
        offset = end;
    }
    ensure!(json_seen, "GLB_IMPORT_MODEL_INVALID");
    Ok(())
}
