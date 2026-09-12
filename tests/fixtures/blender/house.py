# SPDX-License-Identifier: GPL-3.0-or-later
# Authored integration fixture, not a player-model quality evaluation.
import math
import bpy
from mathutils import Matrix


def material(name, color):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    result.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*color, 1.0)
    return result


def box(name, position, dimensions, surface):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    result = bpy.context.object
    result.name = name
    result.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    result.data.materials.append(surface)
    return result


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
wall = material("WallPaint", (0.72, 0.42, 0.22))
wood = material("DoorWood", (0.18, 0.08, 0.03))
roof = material("RoofSlate", (0.12, 0.18, 0.25))
floor = material("FloorStone", (0.4, 0.4, 0.38))
box("Floor", (0, 0, 0.15), (6, 4.4, 0.3), floor)
box("BackWall", (0, 2, 1.65), (6, 0.2, 2.7), wall)
box("LeftWall", (-2.9, 0, 1.65), (0.2, 4, 2.7), wall)
box("RightWall", (2.9, 0, 1.65), (0.2, 4, 2.7), wall)
box("FrontLeft", (-1.75, -2, 1.65), (2.5, 0.2, 2.7), wall)
box("FrontRight", (1.75, -2, 1.65), (2.5, 0.2, 2.7), wall)
box("Lintel", (0, -2, 2.65), (1, 0.2, 0.7), wall)
box("Roof", (0, 0, 3.1), (6.3, 4.6, 0.25), roof)
door = box("Door", (-0.5, -2.13, 0.3), (1, 0.12, 2), wood)
door.data.transform(Matrix.Translation((0.5, 0, 1)))
door.rotation_euler.z = 0
door.keyframe_insert(data_path="rotation_euler", frame=1)
door.rotation_euler.z = -math.pi / 2
door.keyframe_insert(data_path="rotation_euler", frame=31)
door.animation_data.action.name = "DoorOpen"
bpy.context.scene.render.fps = 30
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 31
bpy.context.scene.frame_set(1)
