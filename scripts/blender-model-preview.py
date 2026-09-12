# Fixed trusted GLB preview renderer. Does not execute authored modeling scripts.
import bpy
import sys
import math
from mathutils import Vector

model, output, view = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=model)
scene = bpy.context.scene
meshes = [obj for obj in scene.objects if obj.type == "MESH"]
if not meshes:
    raise RuntimeError("No mesh geometry to render")
corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
lower = Vector(tuple(min(point[i] for point in corners) for i in range(3)))
upper = Vector(tuple(max(point[i] for point in corners) for i in range(3)))
center = (lower + upper) / 2
size = max(upper - lower)
for obj in list(scene.objects):
    if obj.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(obj, do_unlink=True)
directions = {"hero": Vector((1.1, -1.5, 0.9)), "front": Vector((0, -1.8, 0.32)),
              "side": Vector((1.8, 0, 0.3)), "back": Vector((-1.2, 1.5, 0.7)), "top": Vector((0, -0.001, 2))}
bpy.ops.object.camera_add(location=center + directions[view].normalized() * size * 2.8)
camera = bpy.context.object
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = size * 1.32
camera.data.clip_end = size * 100
scene.camera = camera
bpy.ops.mesh.primitive_plane_add(size=size * 200, location=(center.x, center.y, lower.z - size * 0.014))
floor = bpy.context.object
mat = bpy.data.materials.new('PreviewBackdrop')
mat.diffuse_color = (0.095, 0.14, 0.18, 1)
mat.use_nodes = True
mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.095, 0.14, 0.18, 1)
mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = 0.85
floor.data.materials.append(mat)
for label, direction, energy in [('Key', (-1.5, -2, 3), 1000), ('Fill', (2, -0.5, 1.5), 650), ('Rim', (0.5, 2, 2.6), 1300)]:
    location = center + Vector(direction) * size
    bpy.ops.object.light_add(type='AREA', location=location)
    light = bpy.context.object
    light.name = label
    light.data.energy = energy * size * size
    light.data.shape = 'DISK'
    light.data.size = size * 1.8
    light.rotation_euler = (center - location).to_track_quat('-Z', 'Y').to_euler()
scene.world = bpy.data.worlds.new('PreviewWorld')
scene.world.use_nodes = True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (0.2, 0.25, 0.32, 1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value = 0.4
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1280
scene.render.resolution_y = 1280
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = output
scene.view_settings.view_transform = 'AgX'
scene.render.film_transparent = False
bpy.ops.render.render(write_still=True)
