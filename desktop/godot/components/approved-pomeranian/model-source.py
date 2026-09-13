"""Mochi: a compact, friendly white Pomeranian from the supplied four views.

Actual geometry and exportable PBR materials only. Face -Y, up Z.
The packaged driver owns saving, exporting and output paths.
"""
import bpy
import bmesh
import math
import random
from mathutils import Vector, noise

random.seed(260913)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Specular IOR Level'].default_value = 0.28
    return mat


ivory = material('Coat | warm snow velvet', (0.76, 0.733, 0.688), 0.90)
fur_mats = [
    material('Fur | soft white', (0.87, 0.846, 0.803), 0.85),
    material('Fur | pearl white', (0.91, 0.890, 0.855), 0.82),
    material('Fur | cream white', (0.82, 0.798, 0.755), 0.88),
]
ear_pink = material('Ear | pale warm inner velvet', (0.62, 0.427, 0.367), 0.91)
rim_mat = material('Eye | fine warm charcoal lid', (0.027, 0.018, 0.014), 0.63)
iris_mat = material('Eye | deep warm brown', (0.009, 0.0045, 0.002), 0.38)
pupil_mat = material('Eye | quiet black pupil', (0.0015, 0.0012, 0.001), 0.34)
for mat in (iris_mat, pupil_mat):
    mat.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = 0.12
nose_mat = material('Nose | soft black leather', (0.006, 0.0045, 0.005), 0.54)
nose_mat.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = 0.16
recess_mat = material('Nose | nostril shadows', (0.0025, 0.0018, 0.002), 0.78)
lip_mat = material('Mouth | delicate closed seam', (0.087, 0.059, 0.047), 0.82)


def mesh_object(name, verts, faces, mats, ids=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for mat in mats:
        mesh.materials.append(mat)
    for i, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if ids is not None:
            poly.material_index = ids[i]
    return obj


def ellipsoid(name, center, scale, mat=ivory, segments=40, rings=28):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for uv in list(obj.data.uv_layers):
        obj.data.uv_layers.remove(uv)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def apply(obj, modifier):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def outward_normals(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def path(controls, steps=8):
    p = [Vector(c) for c in controls]
    out = []
    for i in range(len(p) - 1):
        a, b, c, d = p[max(0, i-1)], p[i], p[i+1], p[min(len(p)-1, i+2)]
        for j in range(steps):
            t = j / steps
            out.append(0.5 * (2*b + (-a+c)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t*t*t))
    out.append(p[-1])
    return out


def tube(name, points, radii, mat, sides=10):
    vertices, faces = [], []
    p = [Vector(v) for v in points]
    for i, point in enumerate(p):
        t = (p[min(len(p)-1, i+1)] - p[max(0, i-1)]).normalized()
        a = t.cross(Vector((1, 0, 0)))
        if a.length < 0.01:
            a = t.cross(Vector((0, 1, 0)))
        a.normalize()
        b = t.cross(a).normalized()
        for j in range(sides):
            angle = math.tau*j/sides
            vertices.append(point + radii[i]*(a*math.cos(angle)+b*math.sin(angle)))
        if i:
            for j in range(sides):
                faces.append(((i-1)*sides+j, (i-1)*sides+(j+1)%sides, i*sides+(j+1)%sides, i*sides+j))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple((len(p)-1)*sides+j for j in range(sides)))
    return mesh_object(name, vertices, faces, [mat])


# Silhouette first: a broad baby head, a rounded ruff, a short barrel and
# substantial short legs. The ruff is one rounded volume, never a pointed bib.
volumes = [
    ('Compact ribcage', (0, 0.24, 0.95), (0.48, 0.67, 0.51)),
    ('Round rump', (0, 0.64, 0.91), (0.47, 0.40, 0.51)),
    ('Full circular ruff', (0, -0.47, 1.28), (0.605, 0.545, 0.63)),
    ('Neck blended into head', (0, -0.53, 1.48), (0.55, 0.46, 0.46)),
    ('Large round head', (0, -0.62, 1.68), (0.565, 0.46, 0.495)),
    ('Left fluffy cheek', (-0.265, -0.67, 1.54), (0.29, 0.320, 0.30)),
    ('Right fluffy cheek', (0.265, -0.67, 1.54), (0.29, 0.320, 0.30)),
    ('Short nasal bridge', (0, -1.005, 1.690), (0.119, 0.128, 0.108)),
    ('Left short muzzle', (-0.075, -1.048, 1.613), (0.121, 0.128, 0.087)),
    ('Right short muzzle', (0.075, -1.048, 1.613), (0.121, 0.128, 0.087)),
    ('Small rounded chin', (0, -1.015, 1.553), (0.156, 0.125, 0.070)),
]
paws = []
for s in (-1, 1):
    fy = -0.47 + (-0.025 if s == 1 else 0.02)
    volumes.extend([
        ('Front shoulder', (s*0.32, -0.35, 0.76), (0.22, 0.255, 0.35)),
        ('Short plush foreleg', (s*0.325, fy, 0.41), (0.158, 0.178, 0.315)),
        ('Small front paw', (s*0.325, fy-0.067, 0.13), (0.17, 0.207, 0.12)),
        ('Round rear thigh', (s*0.31, 0.66, 0.62), (0.233, 0.265, 0.34)),
        ('Short rear leg', (s*0.335, 0.755, 0.32), (0.151, 0.174, 0.225)),
        ('Small rear paw', (s*0.335, 0.680, 0.12), (0.166, 0.19, 0.11)),
    ])
    paws.extend([(s*0.325, fy-0.067), (s*0.335, 0.680)])

pieces = [ellipsoid(label, c, r) for label, c, r in volumes]
for x, y in paws:
    for dx in (-0.073, 0, 0.073):
        pieces.append(ellipsoid('Soft toe integrated in paw', (x+dx, y-0.12, 0.10), (0.059, 0.088, 0.079), segments=20, rings=14))
bpy.ops.object.select_all(action='DESELECT')
for obj in pieces:
    obj.select_set(True)
bpy.context.view_layer.objects.active = pieces[0]
bpy.ops.object.join()
skin = bpy.context.object
skin.name = 'Mochi | continuous round head ruff body and four paws'
remesh = skin.modifiers.new('Seamless soft anatomy', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = 0.016
remesh.use_smooth_shade = True
apply(skin, remesh)
smooth = skin.modifiers.new('Soft blended volumes', 'SMOOTH')
smooth.factor = 0.75
smooth.iterations = 12
apply(skin, smooth)


def face_y(x, z):
    return -0.62 - 0.46*math.sqrt(max(0.01, 1-(x/0.565)**2-((z-1.68)/0.495)**2))


# Sculpt true recessed orbital bowls before adding shallow dark eye surfaces.
# The eye has no white, detached sphere, artificial white highlight or cornea.
eye_x, eye_z = 0.176, 1.780
eye_rx, eye_rz = 0.0615, 0.065
for v in skin.data.vertices:
    p = skin.matrix_world @ v.co
    if p.y < -0.92:
        d = min(((p.x-s*eye_x)/0.076)**2 + ((p.z-eye_z)/0.079)**2 for s in (-1, 1))
        p.y += 0.044*math.exp(-d*d*1.7)
    # Tiny physical waves soften the undercoat without thick separate locks.
    facial = p.y < -0.91 and abs(p.x) < 0.35 and 1.48 < p.z < 1.99
    amp = 0.0013 if facial else 0.006
    p += v.normal * amp * noise.noise_vector(p*23.0)[0]
    v.co = skin.matrix_world.inverted() @ p
skin.data.update()
dec = skin.modifiers.new('Adaptive smooth surface', 'DECIMATE')
dec.ratio = 0.26
apply(skin, dec)

orbital_tissue = []
for s, label in [(-1, 'L'), (1, 'R')]:
    cx = s*eye_x
    # Concentric orbital tissue rolls smoothly into the skull around aperture.
    verts, faces = [], []
    for radius, relief in [(1.0, 0.004), (1.17, -0.003), (1.45, -0.002), (1.70, 0.002)]:
        for j in range(64):
            a = math.tau*j/64
            x = cx+eye_rx*radius*math.cos(a)
            z = eye_z+eye_rz*radius*math.sin(a)*(0.91 if math.sin(a) > 0 else 1)
            verts.append((x, face_y(x, z)+relief, z))
    for k in range(3):
        for j in range(64):
            faces.append((k*64+j, (k+1)*64+j, (k+1)*64+(j+1)%64, k*64+(j+1)%64))
    orbital_tissue.append(mesh_object('Eye '+label+' | sculpted socket tissue', verts, faces, [ivory]))
    # An elliptical convex cap fills the aperture; every boundary is seated.
    verts = [(cx, face_y(cx, eye_z)-0.017, eye_z)]
    faces, ids = [], []
    for k in range(1, 10):
        r = k/9
        for j in range(64):
            a = math.tau*j/64
            x, z = cx+eye_rx*r*math.cos(a), eye_z+eye_rz*r*math.sin(a)*(0.91 if math.sin(a) > 0 else 1)
            y = face_y(x, z)+0.002-0.019*(1-r*r)
            verts.append((x, y, z))
            if k == 1:
                faces.append((0, 1+j, 1+(j+1)%64))
                ids.append(0)
            else:
                a0 = 1+(k-2)*64
                a1 = 1+(k-1)*64
                faces.append((a0+j, a1+j, a1+(j+1)%64, a0+(j+1)%64))
                ids.append(0 if r < 0.70 else (1 if r < 0.94 else 2))
    mesh_object('Eye '+label+' | shallow inset brown black eye', verts, faces, [pupil_mat, iris_mat, rim_mat], ids)
    line = []
    for j in range(65):
        a = math.tau*j/64
        x, z = cx+eye_rx*math.cos(a), eye_z+eye_rz*math.sin(a)*(0.91 if math.sin(a) > 0 else 1)
        line.append((x, face_y(x, z)-0.001, z))
    tube('Eye '+label+' | fine continuous eyelid', line, [0.0025]*len(line), rim_mat, 6)


# Small softly triangular nose deeply overlaps the fused short nasal bridge.
outline = [(-0.073, 0.020), (-0.060, 0.043), (0, 0.048), (0.060, 0.043),
           (0.073, 0.020), (0.058, -0.021), (0.026, -0.044),
           (0, -0.051), (-0.026, -0.044), (-0.058, -0.021)]
verts, faces = [], []
for y, scale in [(-1.092, 0.82), (-1.170, 1), (-1.198, 0.82)]:
    for x, z in outline:
        verts.append((x*scale, y, 1.676+z*scale))
faces.append(tuple(reversed(range(10))))
for k in range(2):
    for j in range(10):
        faces.append((k*10+j, k*10+(j+1)%10, (k+1)*10+(j+1)%10, (k+1)*10+j))
faces.append(tuple(range(20, 30)))
nose = mesh_object('Nose | rounded little black triangle attached to muzzle', verts, faces, [nose_mat])
outward_normals(nose)
sub = nose.modifiers.new('Rounded nose cartilage', 'SUBSURF')
sub.levels = 2
apply(nose, sub)
for s in (-1, 1):
    nostril = ellipsoid('Nose | small nostril', (s*0.039, -1.193, 1.681), (0.014, 0.003, 0.009), recess_mat, 20, 12)
    nostril.rotation_euler[1] = s*math.radians(-18)
tube('Muzzle | short philtrum', [(0, -1.173, 1.638), (0, -1.175, 1.613), (0, -1.164, 1.587)], [0.0038, 0.0032, 0.0028], lip_mat, 7)
for s in (-1, 1):
    p = path([(0, -1.164, 1.587), (s*0.044, -1.164, 1.570),
              (s*0.095, -1.148, 1.573), (s*0.139, -1.112, 1.591)], 6)
    tube('Muzzle | gentle closed mouth', p, [0.0032*(1-0.55*i/len(p)) for i in range(len(p))], lip_mat, 6)


# The ears are low, thick rounded triangles, most of their roots inside fluff.
ears = []
for s, label in [(-1, 'L'), (1, 'R')]:
    outline = [(-0.15, 1.976), (-0.142, 2.100), (-0.10, 2.216),
               (-0.043, 2.30), (0.007, 2.344), (0.043, 2.324),
               (0.093, 2.211), (0.132, 2.091), (0.145, 1.988)]
    verts, faces = [], []
    for depth, scale in [(-0.065, 1), (0.09, 0.95)]:
        for x, z in outline:
            verts.append((s*(0.348+x*scale), -0.65+depth+(z-2.1)*0.18, 2.02+(z-2.02)*0.79))
    verts.extend([(s*0.348, -0.73, 2.125), (s*0.348, -0.53, 2.125)])
    for j in range(9):
        faces.append((18, j, (j+1)%9))
        faces.append((19, (j+1)%9+9, j+9))
        faces.append((j, j+9, (j+1)%9+9, (j+1)%9))
    if s == -1:
        faces = [tuple(reversed(f)) for f in faces]
    ear = mesh_object('Ear '+label+' | small rounded furry triangle', verts, faces, [ivory])
    outward_normals(ear)
    sub = ear.modifiers.new('Soft ear outline', 'SUBSURF')
    sub.levels = 2
    apply(ear, sub)
    ears.append(ear)
    inner = [(s*(0.348+x), -0.738+(z-2.1)*0.18, 2.02+(z-2.02)*0.79) for x, z in [(-0.080, 2.106), (-0.046, 2.220), (0.009, 2.290), (0.055, 2.196), (0.069, 2.109)]]
    inner.append((s*0.35, -0.721, 2.138))
    f = [(5, j, (j+1)%5) for j in range(5)]
    if s == -1:
        f = [tuple(reversed(q)) for q in f]
    bowl = mesh_object('Ear '+label+' | muted recessed inner triangle', inner, f, [ear_pink])
    sub = bowl.modifiers.new('Round inner velvet', 'SUBSURF')
    sub.levels = 2
    apply(bowl, sub)


# Broad tail plume folds onto the back. Its filled curl has no torus hole.
tail_path = path([(-0.04, 0.78, 1.15), (-0.07, 0.97, 1.34),
                  (-0.13, 0.91, 1.53), (-0.18, 0.70, 1.61),
                  (-0.19, 0.47, 1.54), (-0.14, 0.39, 1.40)], 9)
tail_radii = []
for i in range(len(tail_path)):
    t = i/(len(tail_path)-1)
    tail_radii.append(0.145+0.09*math.sin(math.pi*t)**0.65-0.05*t**8)
tail = tube('Tail | soft full curl resting on back', tail_path, tail_radii, ivory, 28)
sub = tail.modifiers.new('Continuous rounded plume', 'SUBSURF')
sub.levels = 1
apply(tail, sub)
tail_fill = ellipsoid('Tail | soft inner plume volume', (-0.16, 0.73, 1.47), (0.245, 0.29, 0.255))
bpy.ops.object.select_all(action='DESELECT')
tail.select_set(True)
tail_fill.select_set(True)
bpy.context.view_layer.objects.active = tail
bpy.ops.object.join()
remesh = tail.modifiers.new('Full soft plume without a loop hole', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = 0.017
remesh.use_smooth_shade = True
apply(tail, remesh)
smooth = tail.modifiers.new('Blend plume volumes', 'SMOOTH')
smooth.factor = 0.8
smooth.iterations = 7
apply(tail, smooth)
dec = tail.modifiers.new('Plume surface density', 'DECIMATE')
dec.ratio = 0.4
apply(tail, dec)


class FineFur:
    """Very narrow tapered fibers, never wide pointed leaves or thick noodles."""
    def __init__(self):
        self.verts, self.faces, self.ids = [], [], []
        self.count = 0

    def strand(self, root, normal, flow, length, radius):
        n = Vector(normal).normalized()
        f = Vector(flow)
        f -= n*f.dot(n)
        if f.length < 0.05:
            f = n.cross(Vector((0.31, 0.83, 0.47)))
        f.normalize()
        a = n.cross(f).normalized()
        bend = random.uniform(-0.25, 0.25)
        lift = random.uniform(0.25, 0.52)
        p = Vector(root)-n*0.001
        base = len(self.verts)
        shade = random.choices([0, 1, 2], [6, 3, 1])[0]
        # Matched pairs at root and midpoint retain a truly hair-thin width
        # around the curve; no triangle spans the bend into a broad feather.
        mid = p+length*(f*0.53+n*lift*0.80+a*bend*0.28)
        self.verts.extend([p-a*radius, p+a*radius,
            mid-a*radius*0.55, mid+a*radius*0.55,
            p+length*(f+n*lift*0.90+a*bend)])
        self.faces.extend([(base, base+1, base+3, base+2), (base+2, base+3, base+4)])
        self.ids.extend([shade, shade])
        self.count += 1

    def finish(self):
        o = mesh_object('Coat | fine short soft geometry fibers', self.verts, self.faces, fur_mats, self.ids)
        o['fiber_count'] = self.count
        o['fiber_radius_model_units'] = '0.00065 to 0.00115'


fur = FineFur()


def groom(obj, count, kind):
    obj.data.calc_loop_triangles()
    tris = list(obj.data.loop_triangles)
    weights = [t.area for t in tris]
    matrix = obj.matrix_world
    normal_matrix = matrix.to_3x3()
    for tri in random.choices(tris, weights=weights, k=count):
        a, b = random.random(), random.random()
        if a+b > 1:
            a, b = 1-a, 1-b
        vs = [obj.data.vertices[i] for i in tri.vertices]
        p = matrix @ (vs[0].co*(1-a-b)+vs[1].co*a+vs[2].co*b)
        n = (normal_matrix @ (vs[0].normal*(1-a-b)+vs[1].normal*a+vs[2].normal*b)).normalized()
        if p.z < 0.06:
            continue
        length = random.uniform(0.043, 0.073)
        flow = Vector((n.x*0.45, 0.50, -0.70))
        if kind == 'skin':
            if p.z < 0.32:
                length *= 0.40
                flow = Vector((n.x*0.4, -0.7, -0.45))
            elif p.z < 0.70:
                length *= 0.70
                flow = Vector((n.x*0.3, 0.1, -1))
            elif p.y < -0.20 and p.z < 1.43:
                flow = Vector((n.x*0.9, -0.05, -0.72))
            elif p.z >= 1.43:
                flow = Vector((n.x*1.15, 0.18, 0.45 if p.z > 1.90 else -0.42))
            if p.y < -0.92 and abs(p.x) < 0.38 and 1.48 < p.z < 1.99:
                d = min(((p.x-s*eye_x)/0.076)**2+((p.z-eye_z)/0.079)**2 for s in (-1, 1))
                if d < 1.2:
                    continue
                length *= 0.40
                if abs(p.x) < 0.085 and p.z > 1.63 and p.z < 1.74:
                    continue
        elif kind == 'tail':
            nearest = min(range(len(tail_path)), key=lambda i: (p-tail_path[i]).length_squared)
            flow = tail_path[min(len(tail_path)-1, nearest+1)]-tail_path[max(0, nearest-1)]
            flow = flow.normalized()+Vector((n.x*0.4, 0.0, -0.3))
            length *= 1.55
        elif kind == 'ear':
            flow = Vector((n.x*0.2, 0.1, 1))
            length *= 0.74
        elif kind == 'orbit':
            flow = Vector((p.x, 0, 0.4))
            length *= 0.15
        fur.strand(p, n, flow, length, random.uniform(0.00065, 0.00115))


groom(skin, 15000, 'skin')
groom(tail, 2500, 'tail')
for ear in ears:
    groom(ear, 550, 'ear')
for orbit in orbital_tissue:
    groom(orbit, 180, 'orbit')
fur.finish()

# A generated tangent normal texture supplies fine undercoat detail in GLB.
# This is an original procedural microtexture, never the reference photograph.
tex_size = 256
normal_image = bpy.data.images.new('Mochi | random fine undercoat normal', width=tex_size, height=tex_size, alpha=False)
normal_image.colorspace_settings.name = 'Non-Color'
# Overlapping irregular tapered microstrands avoid periodic corduroy ridges.
heights = [0.0]*(tex_size*tex_size)
texture_rng = random.Random(71033)
for stroke in range(1650):
    x0, y0 = texture_rng.uniform(0, tex_size), texture_rng.uniform(0, tex_size)
    length = texture_rng.uniform(8, 43)
    width = texture_rng.uniform(0.45, 1.15)
    drift, curve = texture_rng.uniform(-0.14, 0.14), texture_rng.uniform(-1.4, 1.4)
    strength = texture_rng.uniform(0.16, 0.48)
    for step in range(int(length)+1):
        t = step/length
        x = x0+drift*step+curve*math.sin(t*math.pi)
        y = int(y0+step)%tex_size
        taper = max(0, math.sin(math.pi*t))**0.6
        for dx in range(-3, 4):
            ix = int(x)+dx
            weight = math.exp(-((ix+0.5-x)/width)**2*1.7)
            heights[y*tex_size+ix%tex_size] += strength*taper*weight
pixels = []
for y in range(tex_size):
    for x in range(tex_size):
        du = heights[y*tex_size+(x+1)%tex_size]-heights[y*tex_size+(x-1)%tex_size]
        dv = heights[((y+1)%tex_size)*tex_size+x]-heights[((y-1)%tex_size)*tex_size+x]
        n = Vector((-du*1.8, -dv*1.8, 1)).normalized()
        pixels.extend((0.5+n.x*0.5, 0.5+n.y*0.5, 0.5+n.z*0.5, 1))
normal_image.pixels.foreach_set(pixels)
normal_image.pack()
tex = ivory.node_tree.nodes.new('ShaderNodeTexImage')
tex.name = 'Embedded undercoat normal texture'
tex.image = normal_image
normal_node = ivory.node_tree.nodes.new('ShaderNodeNormalMap')
normal_node.inputs['Strength'].default_value = 0.38
ivory.node_tree.links.new(tex.outputs['Color'], normal_node.inputs['Color'])
ivory.node_tree.links.new(normal_node.outputs['Normal'], ivory.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH' or ivory not in list(obj.data.materials):
        continue
    uv = obj.data.uv_layers.new(name='UndercoatUV')
    matrix = obj.matrix_world
    for poly in obj.data.polygons:
        coords = []
        for loop_index in poly.loop_indices:
            p = matrix @ obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            angle = math.atan2(p.x, -(p.y+0.4))/math.tau
            coords.append([angle, p.z*2.3])
        angles = [c[0] for c in coords]
        if max(angles)-min(angles) > 0.5:
            for c in coords:
                if c[0] < 0:
                    c[0] += 1
        for loop_index, c in zip(poly.loop_indices, coords):
            uv.data[loop_index].uv = (c[0]*3, c[1])

# Compress only the lower support region, keeping the little paws substantial.
# All features and fibers share this continuous anatomical adjustment.
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        continue
    matrix = obj.matrix_world.copy()
    inverse = matrix.inverted()
    for vertex in obj.data.vertices:
        p = matrix @ vertex.co
        p.z -= 0.075*min(1, max(0, (p.z-1.3)/0.55))
        p.z -= 0.235*min(1, max(0, (p.z-0.13)/0.62))
        vertex.co = inverse @ p
    obj.data.update()

root = bpy.data.objects.new('MOCHI | cute white Pomeranian | face -Y', None)
bpy.context.collection.objects.link(root)
for obj in list(bpy.context.scene.objects):
    if obj != root:
        obj.parent = root
root.scale = (0.13, 0.13, 0.13)
root['visual_reference'] = 'Coordinator supplied pomeranian-cute-reference.png four views; no image mapped onto model.'
root['design'] = 'Compact round body, large soft head and ruff, short integrated muzzle, seated moderate eyes, closed mouth, short sturdy legs, full curled tail.'
root['geometry'] = 'Unified undercoat plus thin short mesh fibers; embedded PBR materials; no external assets.'
bpy.context.scene.unit_settings.system = 'METRIC'
print('MOCHI fine coat fibers:', fur.count)
