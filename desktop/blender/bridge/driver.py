# SPDX-License-Identifier: GPL-3.0-or-later
# Craftmine Blender bridge. Distributed source; Blender is a separate process.
# This driver is not a security boundary. The native broker restricts Python
# with a Windows AppContainer, private desktop and one-process kill-on-close job.
import json
import pathlib
import sys

import bpy


def main():
    manifest_path = pathlib.Path(sys.argv[sys.argv.index("--") + 1])
    job = json.loads(manifest_path.read_text(encoding="utf-8"))
    if job.get("schemaVersion") != 1:
        raise ValueError("Unsupported bridge manifest")
    source = pathlib.Path(job["inputRoot"])
    output = pathlib.Path(job["outputRoot"])
    script = (source / "script.py").read_text(encoding="utf-8")
    previous = source / "source.blend"
    if previous.is_file():
        bpy.ops.wm.open_mainfile(filepath=str(previous), load_ui=False, use_scripts=False)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    # Native preparation creates these writable paths before Blender startup.
    # Factory startup/preferences reloads can otherwise choose an unavailable
    # Windows shell profile thumbnail cache inside AppContainer.
    bpy.context.preferences.filepaths.temporary_directory = str(output.parent / "tmp")
    bpy.context.preferences.filepaths.file_preview_type = "NONE"
    # Script authors use normal bpy and can edit the previous .blend scene.
    exec(compile(script, str(source / "script.py"), "exec"), {
        "__name__": "__main__", "__file__": str(source / "script.py"), "bpy": bpy,
    })
    bpy.context.view_layer.update()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise ValueError("The model must contain mesh geometry")
    vertices = sum(len(obj.data.vertices) for obj in meshes)
    polygons = sum(len(obj.data.polygons) for obj in meshes)
    if vertices == 0 or polygons == 0:
        raise ValueError("The model contains no visible mesh faces")
    # Editable source keeps packed textures and node setup. GLB is the exchange
    # artifact; unsupported Blender effects require explicit baking by authors.
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    # A model script may have reset preferences. Background source preservation
    # needs no UI screenshot/camera thumbnail or Windows shell profile access.
    bpy.context.preferences.filepaths.file_preview_type = "NONE"
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "source.blend"), compress=False)
    result = bpy.ops.export_scene.gltf(
        filepath=str(output / "model.glb"), export_format="GLB",
        export_apply=True, export_animations=True, export_yup=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError("glTF export did not finish")
    report = {
        "schemaVersion": 1, "blenderVersion": bpy.app.version_string,
        "meshObjects": len(meshes), "vertices": vertices, "polygons": polygons,
        "materials": len(bpy.data.materials), "animations": len(bpy.data.actions),
        "sourceBinding": job["sourceBinding"],
        "coordinateSystem": "glTF right-handed Y-up metres",
        "note": "Geometry statistics describe Blender source; GLB is validated separately by the host.",
    }
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
