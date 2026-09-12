# SPDX-License-Identifier: GPL-3.0-or-later
# This fixture deliberately depends on the preserved prior .blend scene.
import bpy

assert bpy.data.objects.get("Door") is not None, "Editable source was not restored"
assert bpy.data.objects.get("Roof") is not None, "Prior house geometry is missing"
paint = bpy.data.materials["WallPaint"]
paint.diffuse_color = (0.12, 0.35, 0.75, 1)
paint.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.12, 0.35, 0.75, 1)
bpy.data.objects["Roof"].scale.x = 1.2
bpy.context.scene.frame_set(1)
