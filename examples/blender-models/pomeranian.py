"""Snowcap: a standing white Pomeranian, authored entirely as real geometry.

Blender coordinates: face -Y, up +Z. No images, external assets, hair systems,
lights, cameras, floor, or output operations. The packaged driver owns exports.
The coat uses groomed, curved, solid locks over a unified anatomical undercoat.
"""

import bpy
import math
import random
from mathutils import Vector


random.seed(1381)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, color, roughness, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return mat


coat = [
    material('Snow | soft ivory undercoat', (0.66, 0.655, 0.63), 0.88),
    material('Snow | pearl guard hair', (0.80, 0.798, 0.77), 0.78),
    material('Snow | chalk white silk', (0.89, 0.885, 0.86), 0.72),
    material('Snow | cool white fibers', (0.75, 0.775, 0.80), 0.80),
    material('Snow | warm white shadow', (0.64, 0.625, 0.595), 0.85),
]
ear_mat = material('Ear | warm translucent ivory', (0.48, 0.275, 0.23), 0.86)
lid_mat = material('Eyes | charcoal eyelid', (0.018, 0.014, 0.012), 0.52)
eye_mat = material('Eyes | deep espresso glass', (0.0035, 0.0022, 0.0015), 0.20)
pupil_mat = material('Eyes | black pupil', (0.0015, 0.0018, 0.0022), 0.16)
nose_mat = material('Nose | satin black leather', (0.003, 0.004, 0.005), 0.39)
nostril_mat = material('Nose | nostril recess', (0.001, 0.001, 0.0014), 0.8)
mouth_mat = material('Mouth | deep warm cavity', (0.055, 0.018, 0.020), 0.8)
lip_mat = material('Mouth | fine dark lip', (0.072, 0.042, 0.035), 0.68)
tongue_mat = material('Mouth | muted rose tongue', (0.60, 0.22, 0.245), 0.53)
tongue_line = material('Mouth | tongue crease', (0.37, 0.10, 0.12), 0.65)
claw_mat = material('Paws | translucent pale horn', (0.46, 0.42, 0.36), 0.5)


def mesh_object(name, vertices, faces, materials, ids=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for mat in materials:
        mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    if ids:
        for poly, index in zip(mesh.polygons, ids):
            poly.material_index = index
    return obj


def ellipsoid(name, center, radius, mat, segments=28, rings=18):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = radius
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for layer in list(obj.data.uv_layers):
        obj.data.uv_layers.remove(layer)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def apply_modifier(obj, mod):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def tube(name, points, radii, mat, sides=8):
    vertices, faces = [], []
    points = [Vector(p) for p in points]
    for i, point in enumerate(points):
        tangent = (points[min(i + 1, len(points) - 1)] - points[max(0, i - 1)]).normalized()
        axis = tangent.cross(Vector((1, 0, 0)))
        if axis.length < 0.01:
            axis = tangent.cross(Vector((0, 1, 0)))
        axis.normalize()
        other = tangent.cross(axis).normalized()
        for j in range(sides):
            angle = math.tau * j / sides
            vertices.append(point + radii[i] * (math.cos(angle) * axis + math.sin(angle) * other))
        if i:
            for j in range(sides):
                faces.append(((i - 1) * sides + j, (i - 1) * sides + (j + 1) % sides,
                              i * sides + (j + 1) % sides, i * sides + j))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple((len(points) - 1) * sides + j for j in range(sides)))
    return mesh_object(name, vertices, faces, [mat])


def smooth_path(controls, per_span=6):
    points = [Vector(p) for p in controls]
    result = []
    for i in range(len(points) - 1):
        a, b = points[max(0, i - 1)], points[i]
        c, d = points[i + 1], points[min(i + 2, len(points) - 1)]
        for j in range(per_span):
            t = j / per_span
            result.append(0.5 * ((2 * b) + (-a + c) * t +
                          (2 * a - 5 * b + 4 * c - d) * t * t +
                          (-a + 3 * b - 3 * c + d) * t * t * t))
    result.append(points[-1])
    return result


# Muscular volumes are fused before the coat is laid down, so shoulders, neck,
# hocks and muzzle have actual continuous transitions rather than floating parts.
anatomy_specs = [
    ('Ribcage', (0, 0.22, 1.13), (0.43, 0.69, 0.455)),
    ('Haunch', (0, 0.70, 1.09), (0.395, 0.37, 0.44)),
    ('Breast', (0, -0.30, 1.14), (0.48, 0.46, 0.54)),
    ('Rising neck', (0, -0.46, 1.55), (0.46, 0.385, 0.49)),
    ('Fox skull', (0, -0.755, 1.985), (0.400, 0.34, 0.335)),
    ('Left cheek', (-0.24, -0.815, 1.885), (0.22, 0.24, 0.20)),
    ('Right cheek', (0.24, -0.815, 1.885), (0.22, 0.24, 0.20)),
    ('Nasal bridge', (0, -1.075, 1.969), (0.15, 0.23, 0.115)),
    ('Left muzzle pad', (-0.077, -1.157, 1.88), (0.105, 0.131, 0.080)),
    ('Right muzzle pad', (0.077, -1.157, 1.88), (0.105, 0.131, 0.080)),
    ('Chin', (0, -1.067, 1.761), (0.135, 0.17, 0.064)),
]
legs = []
for side in [-1, 1]:
    x = side * 0.285
    forward = -0.045 if side == 1 else 0.035
    anatomy_specs.extend([
        ('Fore shoulder', (x, -0.31, 0.98), (0.18, 0.205, 0.32)),
        ('Foreleg', (x, -0.435 + forward, 0.56), (0.102, 0.113, 0.335)),
        ('Fore wrist', (x, -0.475 + forward, 0.235), (0.099, 0.115, 0.16)),
        ('Front paw', (x, -0.545 + forward, 0.122), (0.135, 0.193, 0.114)),
        ('Rear thigh', (side * 0.30, 0.68, 0.81), (0.197, 0.23, 0.34)),
        ('Rear hock', (side * 0.31, 0.845, 0.40), (0.094, 0.115, 0.20)),
        ('Rear pastern', (side * 0.31, 0.794, 0.21), (0.092, 0.096, 0.14)),
        ('Rear paw', (side * 0.31, 0.708, 0.113), (0.133, 0.178, 0.103)),
    ])
    legs.extend([(x, -0.545 + forward, True), (side * 0.31, 0.708, False)])

parts = [ellipsoid(name, center, radius, coat[0], 24, 16) for name, center, radius in anatomy_specs]
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
skin = bpy.context.object
skin.name = 'Snowcap | unified anatomical undercoat'
remesh = skin.modifiers.new('Continuous anatomy', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = 0.029
remesh.use_smooth_shade = True
apply_modifier(skin, remesh)
smooth = skin.modifiers.new('Relax muscular transitions', 'SMOOTH')
smooth.factor = 0.76
smooth.iterations = 5
apply_modifier(skin, smooth)
decimate = skin.modifiers.new('Adaptive undercoat surface', 'DECIMATE')
decimate.ratio = 0.30
apply_modifier(skin, decimate)
for poly in skin.data.polygons:
    poly.use_smooth = True


class Groom:
    """Tapered elliptical locks with a curved spine and a round, slender tip."""

    def __init__(self, name):
        self.name = name
        self.vertices = []
        self.faces = []
        self.ids = []
        self.count = 0

    def lock(self, root, normal, flow, length, width, shade=None, fine=False):
        n = Vector(normal).normalized()
        f = Vector(flow)
        f = f - n * f.dot(n)
        if f.length < 0.01:
            f = n.cross(Vector((0.13, 0.93, 0.34)))
        f.normalize()
        sideways = n.cross(f).normalized()
        # Curvature keeps the outer third close to the coat: no radial spikes.
        bend = random.uniform(-0.20, 0.20)
        lift = random.uniform(0.20, 0.33) if not fine else random.uniform(0.24, 0.38)
        root = Vector(root) - n * width * 0.28
        sides = 3 if fine else 4
        steps = [0.0, 0.45, 0.80] if fine else [0.0, 0.36, 0.76]
        profiles = [0.65, 0.67, 0.30] if fine else [0.85, 0.72, 0.23]
        start = len(self.vertices)
        shade = random.choices([0, 1, 2, 3, 4], [5, 36, 43, 12, 4])[0] if shade is None else shade
        for i, t in enumerate(steps):
            center = root + length * (f * (t * 0.96) + n * (lift * math.sin(t * math.pi * 0.72)) + sideways * bend * t * t)
            for j in range(sides):
                angle = math.tau * j / sides + math.pi / 4
                offset = profiles[i] * width * (sideways * math.cos(angle) + n * math.sin(angle) * 0.48)
                self.vertices.append(center + offset)
            if i:
                for j in range(sides):
                    self.faces.append((start + (i - 1) * sides + j,
                                       start + (i - 1) * sides + (j + 1) % sides,
                                       start + i * sides + (j + 1) % sides,
                                       start + i * sides + j))
                    self.ids.append(shade)
        tip = root + length * (f * 0.99 + n * lift * 0.72 + sideways * bend)
        self.vertices.append(tip)
        self.faces.append(tuple(reversed([start + j for j in range(sides)])))
        self.ids.append(shade)
        for j in range(sides):
            self.faces.append((start + (len(steps) - 1) * sides + j,
                               start + (len(steps) - 1) * sides + (j + 1) % sides,
                               len(self.vertices) - 1))
            self.ids.append(shade)
        self.count += 1

    def finish(self):
        obj = mesh_object(self.name, self.vertices, self.faces, coat, self.ids)
        obj['solid_fur_locks'] = self.count
        return obj


def ellipsoid_coat(groom, center, radius, count, length, width, kind, fine=False):
    c, r = Vector(center), Vector(radius)
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(count):
        z = 1 - 2 * (i + 0.5) / count
        phi = i * golden + random.uniform(-0.13, 0.13)
        a = math.sqrt(1 - z * z)
        unit = Vector((a * math.cos(phi), a * math.sin(phi), z))
        p = c + Vector((r.x * unit.x, r.y * unit.y, r.z * unit.z))
        n = Vector((unit.x / r.x, unit.y / r.y, unit.z / r.z)).normalized()
        scale = random.uniform(0.74, 1.24)
        flow = Vector((n.x * 0.25, 0.63, -0.74))
        if kind == 'body':
            if p.y < -0.31 or p.z < 0.79:
                continue
            flow = Vector((n.x * 0.26, 0.72, -0.68))
        elif kind == 'mane':
            if n.y > 0.62 or p.z < 0.72:
                continue
            flow = Vector((n.x * 0.63, -0.17, -0.98))
            scale *= 1.10 if p.z < 1.61 else 0.80
        elif kind == 'head':
            if n.y > 0.63 and p.z < 2.02:
                continue
            eye_distance = min(((p.x - sx * 0.181) / 0.083) ** 2 + ((p.z - 2.063) / 0.096) ** 2 for sx in [-1, 1])
            if p.y < -0.95 and eye_distance < 1.0:
                continue
            if p.y < -0.95 and abs(p.x) < 0.16 and p.z < 2.02:
                continue
            flow = Vector((n.x * 1.5, -0.10, -0.65 if p.z < 2.10 else 0.45))
            if p.y < -0.94 and abs(p.x) < 0.29:
                scale *= 0.36
            if p.z > 2.24:
                scale *= 0.68
        elif kind == 'leg':
            flow = Vector((n.x * 0.25, 0.25, -1))
            if p.z < 0.16:
                continue
        elif kind == 'paw':
            if n.z < 0.02:
                continue
            flow = Vector((n.x * 0.38, -1, -0.32))
        groom.lock(p, n, flow, length * scale, width * random.uniform(0.74, 1.18) * (0.65 if kind == 'head' and scale < 0.6 else 1), fine=fine)


main = Groom('Coat | overlapping flowing guard locks')
silk = Groom('Coat | fine silhouette fibers')


def groom_continuous_surface(groom, count, fine=False, back_of_head=False):
    """Area-uniform roots on the actual fused skin eliminate bare intersections."""
    skin.data.calc_loop_triangles()
    triangles = list(skin.data.loop_triangles)
    if back_of_head:
        triangles = [tri for tri in triangles if
                     (skin.matrix_world @ tri.center).z > 1.83 and
                     (skin.matrix_world @ tri.center).y > -0.78]
    weights = [tri.area for tri in triangles]
    for tri in random.choices(triangles, weights=weights, k=count):
        a, b = random.random(), random.random()
        if a + b > 1:
            a, b = 1 - a, 1 - b
        v0, v1, v2 = [skin.data.vertices[index] for index in tri.vertices]
        p = skin.matrix_world @ (v0.co * (1 - a - b) + v1.co * a + v2.co * b)
        n = (skin.matrix_world.to_3x3() @ (v0.normal * (1 - a - b) + v1.normal * a + v2.normal * b)).normalized()
        if p.z < 0.055 or (p.z < 0.14 and n.z < 0):
            continue
        length, width = 0.17, 0.0095
        flow = Vector((n.x * 0.32, 0.66, -0.74))
        if p.z < 0.28:
            length, width = 0.046, 0.0039
            flow = Vector((n.x * 0.35, -0.75, -0.35))
        elif p.z < 0.74:
            length, width = 0.092, 0.006
            flow = Vector((n.x * 0.22, 0.15, -1))
        elif p.y < -0.23 and p.z < 1.80:
            length, width = 0.15, 0.0105
            flow = Vector((n.x * 0.90, -0.20, -0.82))
        elif p.z > 1.77 and p.y < -0.45:
            length, width = 0.105, 0.0065
            flow = Vector((n.x * 1.25, 0.1, -0.55 if p.z < 2.12 else 0.32))
            if p.y < -0.95:
                eye_distance = min(((p.x - sx * 0.183) / 0.074) ** 2 + ((p.z - 2.065) / 0.075) ** 2 for sx in [-1, 1])
                if eye_distance < 1:
                    continue
                if abs(p.x) < 0.31:
                    length, width = 0.031, 0.0034
                if p.z < 1.82 and abs(p.x) < 0.14:
                    continue
                if p.y < -1.21 and p.z > 1.93:
                    continue
        if p.y < -0.89 and p.z > 1.65:
            length, width = min(length, 0.032), 0.0032
            if p.z < 1.82 and abs(p.x) < 0.155:
                continue
            if p.z < 1.93:
                flow = Vector((n.x * 1.2, 0.1, -0.32))
        if fine:
            width *= 0.19
            length *= 1.17
        groom.lock(p + n * 0.002, n, flow, length * random.uniform(0.75, 1.22), width * random.uniform(0.78, 1.17), fine=fine)


groom_continuous_surface(main, 5500)
groom_continuous_surface(silk, 1100, True)
groom_continuous_surface(main, 210, back_of_head=True)


# Small triangular upright ears, with a sculpted rim and recessed inner shell.
for side, label in [(-1, 'L'), (1, 'R')]:
    outline = [(-0.139, 2.178), (-0.125, 2.323), (-0.069, 2.469),
               (0.006, 2.578), (0.042, 2.560), (0.097, 2.410),
               (0.146, 2.234), (0.135, 2.182)]
    vertices = []
    for yoff in [-0.028, 0.077]:
        for x, z in outline:
            vertices.append((side * (0.264 + x), -0.768 + yoff + (z - 2.18) * 0.14, z))
    vertices.append((side * 0.279, -0.736, 2.352))
    faces = [((j + 1) % 8, j, 16) for j in range(8)]
    faces.append(tuple(range(8, 16)))
    for j in range(8):
        faces.append((j, (j + 1) % 8, (j + 1) % 8 + 8, j + 8))
    if side == -1:
        faces = [tuple(reversed(face)) for face in faces]
    ear = mesh_object('Ear ' + label + ' | tapered outer pinna', vertices, faces, [coat[1]])
    bevel = ear.modifiers.new('Soft ear perimeter', 'BEVEL')
    bevel.width = 0.029
    bevel.segments = 3
    apply_modifier(ear, bevel)
    ear.data.calc_loop_triangles()
    back_faces = [tri for tri in ear.data.loop_triangles if tri.normal.y > 0.25]
    for tri in random.choices(back_faces, weights=[tri.area for tri in back_faces], k=100):
        a, b = random.random(), random.random()
        if a + b > 1:
            a, b = 1 - a, 1 - b
        v0, v1, v2 = [ear.data.vertices[index] for index in tri.vertices]
        p = v0.co * (1 - a - b) + v1.co * a + v2.co * b
        n = (v0.normal * (1 - a - b) + v1.normal * a + v2.normal * b).normalized()
        main.lock(p + n * 0.002, n, (side * 0.17, 0.06, 1), random.uniform(0.028, 0.052), 0.0032, shade=2)
    # The inner bowl is made of nested triangular sections, with a true recess.
    inner_outline = [(-0.077, 2.259), (-0.045, 2.40), (0.014, 2.51), (0.065, 2.371), (0.085, 2.267)]
    verts = [(side * (0.264 + x), -0.801 + (z - 2.18) * 0.14, z) for x, z in inner_outline]
    verts.append((side * 0.28, -0.742, 2.352))
    bowl = mesh_object('Ear ' + label + ' | recessed warm inner bowl', verts, [(i, (i + 1) % 5, 5) for i in range(5)], [ear_mat])
    sub = bowl.modifiers.new('Round bowl', 'SUBSURF')
    sub.levels = 2
    apply_modifier(bowl, sub)
    for i in range(120):
        t = random.random()
        edge = random.choice([0, 1])
        z = 2.205 + t * 0.35
        spread = (1 - t) * 0.125 + 0.004
        x = 0.269 + (spread if edge else -spread)
        p = Vector((side * x, -0.792 + (z - 2.18) * 0.14 + random.uniform(-0.015, 0.045), z))
        main.lock(p, (side * (0.65 if edge else -0.65), -0.75, 0.20), (side * 0.1, 0.04, 1), random.uniform(0.044, 0.080), 0.0055, shade=2)
    for i in range(52):
        t = random.random()
        x = side * (0.264 + random.uniform(-0.084, 0.084) * (1 - t))
        z = 2.215 + t * 0.20
        silk.lock((x, -0.81, z), (0, -1, 0), (side * 0.28, 0, 1), random.uniform(0.05, 0.12), 0.002, shade=1, fine=True)


# Almond eyes have a dark sculpted rim, a brown-black globe and a glossy pupil.
for side, label in [(-1, 'L'), (1, 'R')]:
    eye = ellipsoid('Eye ' + label + ' | socket rim', (side * 0.183, -1.023, 2.065), (0.072, 0.032, 0.068), lid_mat, 28, 18)
    eye.rotation_euler[1] = side * math.radians(-10)
    eyeball = ellipsoid('Eye ' + label + ' | polished dark globe', (side * 0.183, -1.046, 2.065), (0.061, 0.027, 0.057), eye_mat, 32, 20)
    eyeball.rotation_euler[2] = side * math.radians(-13)
    ellipsoid('Eye ' + label + ' | forward pupil', (side * 0.178, -1.069, 2.067), (0.044, 0.007, 0.043), pupil_mat, 24, 16)
    for i in range(35):
        angle = math.pi * (i / 34)
        x = side * 0.183 + 0.073 * math.cos(angle)
        z = 2.064 + 0.071 * math.sin(angle)
        main.lock((x, -1.039, z), (0, -1, 0.15), (side * 0.55, 0, 0.8), random.uniform(0.025, 0.045), 0.0032, shade=1)


# A compressed, softly triangular dog nose; the short tapered muzzle remains
# visibly distinct from both the skull and the little lower jaw.
nose_vertices = []
nose_outline = [(-0.092, 1.984), (-0.082, 2.018), (-0.035, 2.032),
                (0.035, 2.032), (0.082, 2.018), (0.092, 1.984),
                (0.052, 1.943), (0, 1.929), (-0.052, 1.943)]
for y, scale in [(-1.262, 0.81), (-1.321, 1.0), (-1.348, 0.72)]:
    for x, z in nose_outline:
        nose_vertices.append((x * scale, y, 1.985 + (z - 1.985) * scale))
faces = [tuple(reversed(range(9)))]
for ring in range(2):
    for j in range(9):
        faces.append((ring * 9 + j, ring * 9 + (j + 1) % 9, (ring + 1) * 9 + (j + 1) % 9, (ring + 1) * 9 + j))
faces.append(tuple(range(18, 27)))
faces = [tuple(reversed(face)) for face in faces]
nose = mesh_object('Nose | rounded triangular leather', nose_vertices, faces, [nose_mat])
sub = nose.modifiers.new('Nose soft cartilage', 'SUBSURF')
sub.levels = 2
apply_modifier(nose, sub)
for side in [-1, 1]:
    nostril = ellipsoid('Nose | recessed nostril', (side * 0.052, -1.344, 1.987), (0.020, 0.005, 0.012), nostril_mat, 16, 10)
    nostril.rotation_euler[1] = side * math.radians(-22)
tube('Nose | philtrum', [(0, -1.291, 1.939), (0, -1.294, 1.912), (0, -1.288, 1.880)], [0.006, 0.004, 0.0025], nose_mat, 6)

ellipsoid('Smile | recessed mouth opening', (0, -1.172, 1.796), (0.135, 0.043, 0.066), mouth_mat, 28, 18)
for side in [-1, 1]:
    controls = [(0, -1.278, 1.850), (side * 0.057, -1.265, 1.826),
                (side * 0.119, -1.224, 1.833), (side * 0.156, -1.163, 1.866)]
    points = smooth_path(controls, 4)
    tube('Smile | curved lip line', points, [0.0065 - i / len(points) * 0.0025 for i in range(len(points))], lip_mat, 6)
tongue = ellipsoid('Smile | little rounded tongue', (0.013, -1.219, 1.766), (0.058, 0.045, 0.054), tongue_mat, 24, 16)
tongue.rotation_euler[0] = math.radians(-17)
tube('Smile | tongue central groove', [(0.013, -1.261, 1.791), (0.013, -1.265, 1.768), (0.013, -1.257, 1.75)], [0.0014, 0.0015, 0.0005], tongue_line, 5)

# Short directional muzzle hairs and subtle follicle pores, with no long cat
# whiskers. Fine strands stay away from the mouth opening and glossy nose.
for side in [-1, 1]:
    for i in range(80):
        a = random.uniform(-0.25, math.pi * 0.9)
        x = side * (0.075 + random.uniform(0.01, 0.085) * math.sin(a))
        z = 1.885 + random.uniform(-0.015, 0.043)
        y = -1.263 + abs(x) * 0.17
        main.lock((x, y, z), (side * 0.1, -1, 0.15), (side * 1.0, 0.05, -0.28), random.uniform(0.024, 0.053), 0.0030, shade=2)
    for dx, dz in [(0.092, 1.902), (0.12, 1.892), (0.11, 1.866)]:
        ellipsoid('Muzzle | tiny whisker follicle', (side * dx, -1.264 + dx * 0.15, dz), (0.003, 0.0014, 0.0024), coat[4], 8, 6)


# Discrete toes and small claws nest into the fused paws. All four feet stand
# on the same plane, with a slightly advanced right forepaw.
for x, y, front in legs:
    for toe in [-1, 0, 1]:
        ellipsoid('Paw | rounded toe', (x + toe * 0.068, y - 0.104, 0.09), (0.044, 0.080, 0.057), coat[1], 16, 10)
        ellipsoid('Paw | small horn claw', (x + toe * 0.068, y - 0.169, 0.074), (0.015, 0.030, 0.013), claw_mat, 12, 8)


# An asymmetric high-set tail curls forward over the spine. Its coat follows
# the entire curl, making a feathered plume with a tapered tip rather than a ring.
tail_points = smooth_path([(-0.035, 0.79, 1.36), (-0.025, 0.98, 1.56),
                           (-0.030, 0.95, 1.80), (-0.075, 0.76, 1.94),
                           (-0.080, 0.48, 1.89), (-0.030, 0.30, 1.72),
                           (0.030, 0.38, 1.60)], 7)
tail_radii = [0.085 + 0.105 * math.sin(math.pi * i / (len(tail_points) - 1)) for i in range(len(tail_points))]
tail_radii[-4:] = [0.085, 0.066, 0.047, 0.025]
tube('Tail | continuous curled core', tail_points, tail_radii, coat[0], 12)
for i in range(900):
    u = random.uniform(0.03, 0.99) * (len(tail_points) - 1)
    j = min(int(u), len(tail_points) - 2)
    t = u - j
    c = tail_points[j].lerp(tail_points[j + 1], t)
    tangent = (tail_points[min(j + 2, len(tail_points) - 1)] - tail_points[max(0, j - 1)]).normalized()
    axis = Vector((1, 0, 0))
    other = tangent.cross(axis).normalized()
    angle = i * math.pi * (3 - math.sqrt(5))
    n = (axis * math.cos(angle) + other * math.sin(angle)).normalized()
    radius = tail_radii[j] * (1 - t) + tail_radii[j + 1] * t
    root = c + n * radius
    length = random.uniform(0.16, 0.25) * (0.6 + 0.4 * math.sin(math.pi * u / (len(tail_points) - 1)))
    flow = tangent * 0.88 + Vector((n.x * 0.7, 0, -0.27))
    main.lock(root, n, flow, length, random.uniform(0.007, 0.012), shade=random.choice([1, 2, 2, 3]))
    if i % 2 == 0:
        silk.lock(root + n * 0.010, n, flow, length * 1.12, 0.0015, shade=2, fine=True)

main.finish()
silk.finish()

# Coordinated anatomical adjustment: shorter lower legs and a less elevated
# neck preserve all feature registrations while producing a compact spitz pose.
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        continue
    matrix = obj.matrix_world.copy()
    inverse = matrix.inverted()
    for vertex in obj.data.vertices:
        p = matrix @ vertex.co
        z = p.z
        if z > 2.18:
            p.z = 2.18 + (z - 2.18) * 0.78
        p.z -= 0.21 * min(1, max(0, z / 0.85))
        p.z -= 0.12 * min(1, max(0, (z - 1.45) / 0.50))
        if p.y > -0.10:
            p.y = -0.10 + (p.y + 0.10) * 0.90
        if z > 1.72:
            p.x *= 1.07
        vertex.co = inverse @ p
    obj.data.update()

root = bpy.data.objects.new('SNOWCAP | white Pomeranian | face -Y', None)
bpy.context.collection.objects.link(root)
for obj in list(bpy.context.scene.objects):
    if obj != root:
        obj.parent = root
root['description'] = 'Standing white Pomeranian with solid groomed double coat, short fox muzzle and high curled plume.'
root['authored_geometry'] = 'Continuous remeshed anatomy; curved solid tapered fur locks; no textures or external assets.'
root['pose'] = 'Four planted paws, right forepaw slightly advanced, alert ears and a small open smile.'
root.scale = (0.13, 0.13, 0.13)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1.0
print('SNOWCAP groom locks:', main.count, '| fine fibers:', silk.count)
