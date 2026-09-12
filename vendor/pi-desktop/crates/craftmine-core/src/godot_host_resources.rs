//! Host-owned files that are fixed into every build copy.
//!
//! The Web export preset and the host shell/bridge belong to the product, not to
//! the model-authored project. They are hashed into the build identity so a
//! project cannot silently replace the host bridge, and a build cannot be
//! replayed against a different host contract.
use serde_json::{json, Value};

use super::digest;

const EXPORT_PRESET: &str = "[preset.0]\nname=\"Web\"\nplatform=\"Web\"\nrunnable=true\nexport_filter=\"all_resources\"\ninclude_filter=\"*.json,*.txt\"\nexclude_filter=\"\"\nscript_export_mode=0\n[preset.0.options]\ncustom_template/release=\"\"\nvariant/thread_support=true\nvariant/extensions_support=false\nhtml/custom_html_shell=\"res://craftmine_host_shell.html\"\nhtml/focus_canvas_on_start=false\nhtml/canvas_resize_policy=2\nprogressive_web_app/enabled=false\n";

/// `(relative path, exact bytes)` for every host-owned file in a build copy.
pub(super) fn files() -> Vec<(&'static str, String)> {
    vec![
        ("export_presets.cfg", EXPORT_PRESET.into()),
        (
            "craftmine_host_shell.html",
            include_str!("../../../../../desktop/godot/web/shell.html").replace("\r\n", "\n"),
        ),
        (
            "craftmine_host_bridge.js",
            include_str!("../../../../../desktop/godot/web/bridge.js").replace("\r\n", "\n"),
        ),
    ]
}

/// Stable hash of the host contract, part of every build identity.
pub(super) fn hash() -> String {
    let files: Vec<Value> = files()
        .into_iter()
        .map(|(path, text)| json!({"path":path,"bytes":text.len(),"sha256":digest(&text)}))
        .collect();
    digest(
        &serde_json::to_string(
            &json!({"format":"craftmine.godot-host-resources/1","files":files,"creationProbeHash":super::godot_creation_probe::hash(),"creationControllerProfile":super::godot_creation_probe::CONTROLLER_PROFILE,"creationControllerProbeHash":super::godot_creation_probe::controller_hash(),"creationCollisionProbeHash":super::godot_creation_probe::collision_hash()}),
        )
        .unwrap(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_preserves_authored_rule_bytes_and_creation_documents() {
        let preset = files().into_iter().find(|(path, _)| *path == "export_presets.cfg").unwrap().1;
        assert!(preset.contains("script_export_mode=0\n"));
        assert!(preset.contains("include_filter=\"*.json,*.txt\"\n"));
        assert!(!preset.contains("script_export_mode=2"));
        assert_eq!(hash().len(), 64);
        assert_ne!(digest(&preset), digest(&preset.replace("script_export_mode=0", "script_export_mode=2")));
    }
}
