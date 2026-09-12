"""J-20 display airframe, authored from the supplied AI four-view reference.

Original meshes, no downloaded geometry or image stand-ins. Nose -Y, up +Z.
This is an exterior interpretation, not an engineering or manufacturing model.
The packaged driver exclusively owns saving, GLB export and output paths.
"""
import bpy
import bmesh
import math
from mathutils import Vector

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, color, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1)
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metallic
    return mat


skin = material('01 | neutral grey low-observable finish', (.122, .135, .147), .59, .12)
skin_light = material('02 | quiet light grey panel', (.147, .160, .171), .59, .12)
skin_dark = material('03 | restrained graphite grey panel', (.089, .105, .119), .62, .13)
skin_warm = material('04 | warm grey replacement panel', (.133, .142, .147), .61, .11)
edge_mat = material('05 | satin edge treatment', (.211, .229, .241), .54, .16)
radome = material('06 | dielectric nose grey', (.154, .169, .180), .66, .04)
seam_mat = material('07 | fine recessed panel divisions', (.007, .010, .013), .73, .03)
rubber = material('08 | canopy seal charcoal', (.016, .023, .028), .61, .1)
duct_mat = material('09 | intake interior', (.02, .029, .035), .78, .13)
black = material('10 | unlit deep recess', (.004, .006, .008), .9, .0)
metal = material('11 | brushed titanium', (.20, .191, .173), .40, .85)
metal_dark = material('12 | heat-darkened titanium', (.054, .051, .046), .47, .83)
metal_light = material('13 | nozzle petal edges', (.29, .280, .251), .37, .9)
nozzle_mats = [material('14.%d | alternating exhaust petal' % i, c, .38 + .035*i, .82)
               for i, c in enumerate([(.168, .160, .142), (.127, .136, .131), (.19, .175, .146)])]
seat_mat = material('15 | single seat upholstery', (.031, .037, .035), .92)
strap_mat = material('16 | seat harness', (.16, .163, .139), .83)
gold = material('17 | restrained canopy bronze rim', (.085, .056, .018), .35, .65)
glass = material('18 | gold smoke canopy glass', (.32, .24, .10), .15, .015)
glass_bs = glass.node_tree.nodes.get('Principled BSDF')
glass_bs.inputs['Transmission Weight'].default_value = .96
glass_bs.inputs['IOR'].default_value = 1.46
glass_bs.inputs['Coat Weight'].default_value = .10
glass_bs.inputs['Coat Roughness'].default_value = .18
glass_bs.inputs['Specular IOR Level'].default_value = .32
for paint in (skin, skin_light, skin_dark, skin_warm, edge_mat, radome):
    paint.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = .18
sensor = material('19 | dark optical window', (.018, .039, .044), .18, .57)
hud_mat = material('20 | subtle HUD combiner', (.065, .17, .141), .2, .24)
hud_mat.node_tree.nodes.get('Principled BSDF').inputs['Transmission Weight'].default_value = .4
stencil = material('21 | low visibility service stencils', (.24, .256, .267), .65, .05)
red_lens = material('22 | port navigation lens', (.21, .009, .008), .24, .3)
green_lens = material('23 | starboard navigation lens', (.006, .15, .074), .24, .3)


def mesh_object(name, verts, faces, mats, ids=None, smooth=False, group='Airframe'):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj['assembly'] = group
    for mat in mats:
        data.materials.append(mat)
    for i, face in enumerate(data.polygons):
        face.use_smooth = smooth
        if ids is not None:
            face.material_index = ids[i]
    return obj


def outward(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def apply(obj, modifier):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def bevel(obj, width=.025, segments=2):
    mod = obj.modifiers.new('Small physical edge radii', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.affect = 'EDGES'
    apply(obj, mod)
    normal = obj.modifiers.new('Area weighted corner normals', 'WEIGHTED_NORMAL')
    normal.keep_sharp = True
    normal.weight = 35
    apply(obj, normal)


def cube(name, center, scale, mat, bevel_width=.02, group='Details'):
    bpy.ops.mesh.primitive_cube_add(size=2, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj['assembly'] = group
    if bevel_width:
        bevel(obj, bevel_width)
    return obj


def tube(name, points, radius, mat, sides=6, closed=False, group='Panel lines'):
    points = [Vector(p) for p in points]
    verts, faces = [], []
    count = len(points)
    for i, point in enumerate(points):
        before = points[(i-1) % count] if closed or i else point
        after = points[(i+1) % count] if closed or i < count-1 else point
        tangent = (after-before).normalized()
        anchor = Vector((0, 0, 1)) if abs(tangent.z) < .9 else Vector((1, 0, 0))
        u = tangent.cross(anchor).normalized()
        v = tangent.cross(u).normalized()
        for j in range(sides):
            angle = 2*math.pi*j/sides
            verts.append(tuple(point + radius*(math.cos(angle)*u + math.sin(angle)*v)))
    for i in range(count if closed else count-1):
        ni = (i+1) % count
        for j in range(sides):
            faces.append((i*sides+j, i*sides+(j+1) % sides, ni*sides+(j+1) % sides, ni*sides+j))
    if not closed:
        faces += [tuple(reversed(range(sides))), tuple((count-1)*sides+j for j in range(sides))]
    obj = mesh_object(name, verts, faces, [mat], smooth=True, group=group)
    outward(obj)
    return obj


def interpolate(points, value):
    if value <= points[0][0]:
        return points[0][1:]
    for a, b in zip(points, points[1:]):
        if value <= b[0]:
            t = (value-a[0])/(b[0]-a[0])
            return tuple(a[j]*(1-t)+b[j]*t for j in range(1, len(a)))
    return points[-1][1:]


def prism(name, outline, z0, z1, mat, group='Details'):
    n = len(outline)
    verts = [(x, y, z0) for x, y in outline] + [(x, y, z1) for x, y in outline]
    faces = [tuple(reversed(range(n))), tuple(n+i for i in range(n))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    obj = mesh_object(name, verts, faces, [mat], group=group)
    outward(obj)
    return obj


# y, half width, dorsal height, chine height, belly height, engine-shoulder rise.
# The flattened fourteen-sided sections deliberately avoid a rocket-like tube.
stations = [
    (-10.7, .015, .018, .002, -.015, 0),
    (-10.15, .20, .16, -.015, -.135, 0),
    (-9.5, .39, .34, -.01, -.28, 0),
    (-8.55, .65, .54, .005, -.40, 0),
    (-7.65, .83, .685, .025, -.46, 0),
    (-6.65, 1.015, .755, .045, -.53, 0),
    (-5.35, 1.145, .75, .065, -.585, 0),
    (-4.5, 1.175, .725, .07, -.62, 0),
    (-3.4, 1.34, .70, .08, -.67, .015),
    (-2.1, 1.70, .675, .10, -.70, .025),
    (-.5, 1.91, .65, .105, -.70, .06),
    (1.3, 2.02, .64, .10, -.68, .13),
    (3.3, 2.015, .60, .09, -.655, .235),
    (5.0, 1.97, .52, .085, -.625, .31),
    (6.4, 1.895, .39, .07, -.62, .36),
    (7.5, 1.81, .25, .055, -.605, .38),
    (8.4, 1.71, .17, .035, -.56, .35),
    (8.67, 1.57, .15, .015, -.48, .30),
]


def section(y):
    w, top, chine, bottom, hump = interpolate(stations, y)
    height = top-chine
    taper = min(1, w/.65)
    right = [(0, top), (.20*w, top-.025*height+hump*.35), (.42*w, top-.08*height+hump*.88),
             (.60*w, top-.17*height+hump), (.77*w, chine+.56*height+hump*.60),
             (.91*w, chine+.23*height), (w, chine), (.945*w, bottom+.30*(chine-bottom)),
             (.64*w, bottom), (0, bottom-.015*taper)]
    return right + [(-x, z) for x, z in reversed(right[1:-1])]


def topz(x, y):
    points = section(y)[:7]
    ax = abs(x)
    for a, b in zip(points, points[1:]):
        if ax <= b[0]:
            t = max(0, (ax-a[0])/(b[0]-a[0]))
            return a[1]*(1-t)+b[1]*t
    return points[-1][1]


ys = []
for a, b in zip(stations, stations[1:]):
    steps = max(2, math.ceil((b[0]-a[0])/.27))
    ys += [a[0]+(b[0]-a[0])*i/steps for i in range(steps)]
ys.append(stations[-1][0])
ring_count = len(section(0))
verts = [(x, y, z) for y in ys for x, z in section(y)]
faces, ids = [], []
for i in range(len(ys)-1):
    for j in range(ring_count):
        faces.append((i*ring_count+j, i*ring_count+(j+1) % ring_count,
                      (i+1)*ring_count+(j+1) % ring_count, (i+1)*ring_count+j))
        ids.append(1 if (ys[i]+ys[i+1])/2 < -8.55 else 0)
faces += [tuple(reversed(range(ring_count))), tuple((len(ys)-1)*ring_count+j for j in range(ring_count))]
ids += [1, 0]
body = mesh_object('Continuous chined fuselage', verts, faces, [skin, radome], ids, True, 'Fuselage')
outward(body)
for e in body.data.edges:
    a, b = e.vertices
    if a % ring_count == b % ring_count and a % ring_count in (6, 8, 10, 12):
        e.use_edge_sharp = True
split = body.modifiers.new('Retain chine and belly hard edges', 'EDGE_SPLIT')
split.use_edge_angle = False
split.use_edge_sharp = True
apply(body, split)

# A real recessed single cockpit cavity; the glass does not sit on a solid mound.
cockpit_outline = [(-.18, -7.62), (.18, -7.62), (.43, -7.08), (.48, -6.04),
                   (.32, -5.29), (-.32, -5.29), (-.48, -6.04), (-.43, -7.08)]
cutter = prism('Temporary cockpit cutting solid', cockpit_outline, .20, 2.1, black)
cut = body.modifiers.new('Recess below canopy', 'BOOLEAN')
cut.operation = 'DIFFERENCE'
cut.solver = 'EXACT'
cut.object = cutter
apply(body, cut)
bpy.data.objects.remove(cutter, do_unlink=True)
surface_sources = {'fuselage': body}
surface_cache = {}
tub = prism('Dark single cockpit well', [(x*.99, y) for x, y in cockpit_outline], .205, .29, black, 'Cockpit')
seat = cube('Single ejection seat cushion', (0, -6.08, .55), (.29, .36, .13), seat_mat, .05, 'Cockpit')
backrest = cube('Single seat backrest', (0, -5.77, .83), (.295, .12, .36), seat_mat, .045, 'Cockpit')
backrest.rotation_euler.x = math.radians(12)
cube('Headrest', (0, -5.69, 1.19), (.19, .105, .105), rubber, .045, 'Cockpit')
for side in (-1, 1):
    tube('Shoulder harness', [(side*.115, -5.87, 1.09), (side*.15, -5.94, .86),
                             (side*.19, -6.12, .66)], .026, strap_mat, 6, group='Cockpit')
    cube('Seat side rail', (side*.335, -6.10, .55), (.036, .40, .21), metal_dark, .02, 'Cockpit')
cube('Instrument hood', (0, -7.11, .78), (.395, .29, .125), rubber, .085, 'Cockpit')
mesh_object('HUD optical combiner', [(-.16, -7.13, .88), (.16, -7.13, .88),
                                    (.16, -7.23, 1.09), (-.16, -7.23, 1.09)], [(0, 1, 2, 3)], [hud_mat], group='Cockpit')

# Smooth, low single-seat gold-smoke canopy, with one windscreen bow.
canopy_sections = [(-8.04, .016, .585, .02), (-7.78, .255, .642, .22),
                   (-7.30, .445, .688, .49), (-6.78, .568, .70, .75),
                   (-6.20, .595, .70, .795), (-5.65, .525, .692, .64),
                   (-5.15, .315, .68, .33), (-4.91, .016, .677, .025)]


def canopy_point(y, theta):
    k = min(len(canopy_sections)-2, max(0, next((i for i in range(len(canopy_sections)-1)
                  if y <= canopy_sections[i+1][0]), len(canopy_sections)-2)))
    a, b = canopy_sections[k], canopy_sections[k+1]
    previous, after = canopy_sections[max(0, k-1)], canopy_sections[min(len(canopy_sections)-1, k+2)]
    t = max(0, min(1, (y-a[0])/(b[0]-a[0])))
    values = []
    for j in range(1, 4):
        ma = (b[j]-previous[j])/(b[0]-previous[0])*(b[0]-a[0])
        mb = (after[j]-a[j])/(after[0]-a[0])*(b[0]-a[0])
        values.append((2*t**3-3*t**2+1)*a[j]+(t**3-2*t**2+t)*ma+
                      (-2*t**3+3*t**2)*b[j]+(t**3-t**2)*mb)
    width, base, rise = values
    return (width*math.cos(theta), y, base+rise*math.sin(theta)**.91)


cy = []
for a, b in zip(canopy_sections, canopy_sections[1:]):
    cy += [a[0]+(b[0]-a[0])*i/6 for i in range(6)]
cy.append(canopy_sections[-1][0])
nt = 32
cv = [canopy_point(y, math.pi*j/nt) for y in cy for j in range(nt+1)]
cf = [(i*(nt+1)+j, i*(nt+1)+j+1, (i+1)*(nt+1)+j+1, (i+1)*(nt+1)+j)
      for i in range(len(cy)-1) for j in range(nt)]
canopy = mesh_object('Gold smoke single-seat canopy', cv, cf, [glass], smooth=True, group='Canopy glass')
solid = canopy.modifiers.new('Physical glazing thickness', 'SOLIDIFY')
solid.thickness = .008
apply(canopy, solid)
outward(canopy)
rim = [canopy_point(y, 0) for y in cy] + [canopy_point(y, math.pi) for y in reversed(cy)]
tube('Continuous canopy rubber seal', rim, .035, rubber, 8, True, 'Canopy frame')
tube('Canopy bronze lip', [(x, y, z+.025) for x, y, z in rim], .012, gold, 6, True, 'Canopy frame')
bow = [canopy_point(-7.29, math.pi*i/32) for i in range(33)]
tube('Single windscreen arch', bow, .024, skin_dark, 8, group='Canopy frame')

# The intake shells have an open lip, dark inner walls and a deep closing shadow.
for side, tag in ((1, 'R'), (-1, 'L')):
    lip = [(1.105, -4.55, .40), (1.715, -4.70, .47), (2.075, -4.41, .095),
           (1.93, -4.32, -.64), (1.24, -4.48, -.705), (1.07, -4.55, -.26)]
    aft1 = [(1.02, -3.1, .52), (1.79, -3.1, .53), (2.14, -3.1, .10),
            (1.975, -3.1, -.64), (1.24, -3.1, -.69), (1.03, -3.1, -.22)]
    aft2 = [(1.02, -.85, .53), (1.77, -.85, .50), (1.96, -.85, .105),
            (1.80, -.85, -.49), (1.19, -.85, -.59), (1.015, -.85, -.19)]
    center = Vector((1.568, -4.50, -.12))
    inner = []
    for x, y, z in lip:
        inner.append((center.x+(x-center.x)*.86, y+.07, center.z+(z-center.z)*.86))
    depth = [(1.58+(x-1.568)*.68, -2.28, -.10+(z+.12)*.71) for x, y, z in inner]
    rings = [lip, aft1, aft2, inner, depth]
    iv = [(side*x, y, z) for ring in rings for x, y, z in ring]
    inf, ini = [], []
    for a, b, mid in ((0, 1, 0), (1, 2, 0), (0, 3, 1), (3, 4, 2)):
        for j in range(6):
            inf.append((a*6+j, a*6+(j+1) % 6, b*6+(j+1) % 6, b*6+j))
            ini.append(mid)
    inf.append(tuple(24+j for j in range(6)))
    ini.append(3)
    intake = mesh_object(tag+' intake lip and deep duct', iv, inf, [skin, edge_mat, duct_mat, black], ini, group=tag+' Intake')
    outward(intake)
    bevel(intake, .014, 2)
    # A modest curved DSI cheek just inside the inlet, without a flat black sticker.
    bumpv = [(side*x, y, z) for x, y, z in [(1.045, -4.91, -.22), (1.02, -4.72, .30),
             (1.105, -4.16, .32), (1.33, -3.93, .05), (1.30, -4.08, -.26), (1.075, -4.61, -.43)]]
    bump = mesh_object(tag+' inlet inner cheek', bumpv, [(0, 1, 2, 3, 4, 5)], [skin_light], group=tag+' Intake')
    thick = bump.modifiers.new('Cheek thickness', 'SOLIDIFY')
    thick.thickness = .045
    apply(bump, thick)
    bevel(bump, .035, 3)


def planform_values(span, shape):
    return interpolate(shape, span)


wing_shape = [(1.44, -1.65, 6.93, .165, .22), (2.15, -.91, 6.92, .145, .19),
              (3.15, .36, 6.70, .117, .148), (4.30, 1.82, 6.48, .091, .112),
              (5.4, 3.22, 6.26, .073, .076), (6.48, 4.60, 6.02, .062, .042)]
canard_shape = [(1.02, -5.13, -2.29, .31, .094), (1.53, -4.94, -2.23, .32, .078),
                (3.19, -2.89, -2.20, .37, .035)]


def foil_point(x, u, shape, upper=True):
    lead, trail, base, thick = planform_values(abs(x), shape)
    camber = .027*math.sin(math.pi*u)
    half = .011+thick*max(0, math.sin(math.pi*u))**.68
    return (x, lead+(trail-lead)*u, base+camber+(half if upper else -half))


def foil_z(x, y, shape=wing_shape):
    lead, trail, base, thick = planform_values(abs(x), shape)
    return foil_point(x, min(1, max(0, (y-lead)/(trail-lead))), shape)[2]


def foil(name, side, shape, group):
    spans = []
    for a, b in zip(shape, shape[1:]):
        steps = max(2, math.ceil((b[0]-a[0])/.28))
        spans += [a[0]+(b[0]-a[0])*i/steps for i in range(steps)]
    spans.append(shape[-1][0])
    us = [0, .012, .032, .07, .13, .22, .34, .48, .62, .76, .83, .91, .975, 1]
    n, m = len(spans), len(us)
    v = [foil_point(side*x, u, shape, upper) for upper in (True, False) for x in spans for u in us]
    f, ids = [], []
    for layer in range(2):
        for i in range(n-1):
            for j in range(m-1):
                k = layer*n*m+i*m+j
                f.append((k, k+1, k+m+1, k+m))
                ids.append(1 if j <= 1 or j == m-2 else 0)
    for i in range(n-1):
        for j in (0, m-1):
            a = i*m+j
            b = (i+1)*m+j
            f.append((a, b, b+n*m, a+n*m)); ids.append(1)
    for i in (0, n-1):
        for j in range(m-1):
            a = i*m+j
            f.append((a, a+1, a+1+n*m, a+n*m)); ids.append(1)
    obj = mesh_object(name, v, f, [skin, edge_mat], ids, True, group)
    outward(obj)
    surface_sources[('wing' if shape is wing_shape else 'canard', side)] = obj
    return obj


def projected_triangles(obj, axes, direction):
    key = (obj.name, axes, direction)
    if key in surface_cache:
        return surface_cache[key]
    data = obj.data
    data.calc_loop_triangles()
    result = []
    depth_axis = 3-sum(axes)
    for tri in data.loop_triangles:
        if tri.normal[depth_axis]*direction < .02:
            continue
        points = [data.vertices[i].co.copy() for i in tri.vertices]
        projected = [Vector((p[axes[0]], p[axes[1]])) for p in points]
        a, b, c = projected
        determinant = (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
        if abs(determinant) < 1e-10:
            continue
        if data.polygons[tri.polygon_index].use_smooth:
            normals = [data.corner_normals[i].vector.copy() for i in tri.loops]
        else:
            normals = [tri.normal.copy() for i in range(3)]
        bounds = (min(p.x for p in projected), max(p.x for p in projected),
                  min(p.y for p in projected), max(p.y for p in projected))
        result.append((points, projected, normals, determinant, bounds))
    surface_cache[key] = result
    return result


def clipped_polygon(subject, clip):
    for a, b in zip(clip, clip[1:]+clip[:1]):
        output = []
        if not subject:
            break
        previous = subject[-1]
        dp = (b.x-a.x)*(previous.y-a.y)-(b.y-a.y)*(previous.x-a.x)
        for current in subject:
            dc = (b.x-a.x)*(current.y-a.y)-(b.y-a.y)*(current.x-a.x)
            if (dc >= -1e-9) != (dp >= -1e-9):
                output.append(previous+(current-previous)*(dp/(dp-dc)))
            if dc >= -1e-9:
                output.append(current)
            previous, dp = current, dc
        subject = output
    return subject


def patch_on_mesh(name, polygon, source, axes, direction, mat, group, offset=.0025):
    # Clip coating polygons against the actual underlying mesh triangles. Each
    # coating vertex uses the exact skin plane and interpolated skin normals.
    # This removes floating corners and z-fighting on the compound surfaces.
    from mathutils.geometry import tessellate_polygon
    vectors = [Vector((x, y, 0)) for x, y in polygon]
    tris = tessellate_polygon([vectors])
    pv, pf, pn = [], [], []
    depth_axis = 3-sum(axes)
    source_tris = projected_triangles(source, axes, direction)
    for a, b, c in tris:
        if not isinstance(a, Vector):
            a, b, c = vectors[a], vectors[b], vectors[c]
        clip = [Vector((p.x, p.y)) for p in (a, b, c)]
        if (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x) < 0:
            clip.reverse()
        cb = (min(p.x for p in clip), max(p.x for p in clip), min(p.y for p in clip), max(p.y for p in clip))
        for points, projected, normals, det, bounds in source_tris:
            if cb[0] > bounds[1] or cb[1] < bounds[0] or cb[2] > bounds[3] or cb[3] < bounds[2]:
                continue
            subject = list(projected)
            if det < 0:
                subject.reverse()
            cut = clipped_polygon(subject, clip)
            clean = []
            for point in cut:
                if not clean or (point-clean[-1]).length > 1e-7:
                    clean.append(point)
            if len(clean) > 1 and (clean[0]-clean[-1]).length < 1e-7:
                clean.pop()
            cut = clean
            if len(cut) < 3:
                continue
            area = sum(cut[i].x*cut[(i+1) % len(cut)].y-cut[(i+1) % len(cut)].x*cut[i].y for i in range(len(cut)))
            if abs(area) < 1e-9:
                continue
            face = []
            p0, p1, p2 = projected
            for p in cut:
                wb = ((p.x-p0.x)*(p2.y-p0.y)-(p.y-p0.y)*(p2.x-p0.x))/det
                wc = ((p1.x-p0.x)*(p.y-p0.y)-(p1.y-p0.y)*(p.x-p0.x))/det
                wa = 1-wb-wc
                co = points[0]*wa+points[1]*wb+points[2]*wc
                co[depth_axis] += offset*direction
                normal = (normals[0]*wa+normals[1]*wb+normals[2]*wc).normalized()
                face.append(len(pv)); pv.append(tuple(co)); pn.append(tuple(normal))
            pf.append(tuple(face if direction > 0 else reversed(face)))
    obj = mesh_object(name, pv, pf, [mat], smooth=True, group=group)
    if pn:
        obj.data.normals_split_custom_set_from_vertices(pn)
    return obj


def surface_patch(name, polygon, zfun, mat, group='Surface panels', offset=.0025, subdivisions=4):
    if zfun is topz:
        source = surface_sources['fuselage']
    else:
        side = 1 if sum(x for x, y in polygon) > 0 else -1
        source = surface_sources[('wing' if zfun is foil_z else 'canard', side)]
    return patch_on_mesh(name, polygon, source, (0, 1), 1, mat, group, offset)


def surface_line(name, polygon, zfun=topz, width=.009, closed=False, mat=seam_mat, group='Panel lines'):
    pts = []
    count = len(polygon)
    for i in range(count if closed else count-1):
        a, b = Vector(polygon[i]), Vector(polygon[(i+1) % count])
        steps = max(1, math.ceil((b-a).length/.13))
        for j in range(steps):
            p = a+(b-a)*(j/steps)
            pts.append((p.x, p.y, zfun(p.x, p.y)+.009))
    if not closed:
        x, y = polygon[-1]
        pts.append((x, y, zfun(x, y)+.009))
    return tube(name, pts, width, mat, 4, closed, group)


for side, tag in ((1, 'R'), (-1, 'L')):
    foil(tag+' solid cambered delta wing', side, wing_shape, tag+' Main wing')
    foil(tag+' forward solid canard', side, canard_shape, tag+' Canard')
    mirror = lambda coords: [(side*x, y) for x, y in coords]
    # A few large angular panels and a separate trailing control-surface pattern.
    wing_panels = [
        ([(2.15, -.60), (2.59, -.04), (5.95, 4.69), (5.48, 4.79), (3.36, 2.03), (2.15, 1.46)], skin_dark),
        ([(2.23, 5.32), (3.02, 4.76), (3.75, 4.73), (4.08, 5.02), (5.86, 4.86),
          (6.18, 5.24), (6.15, 5.82), (4.91, 6.00), (4.54, 5.78), (3.61, 6.20), (2.23, 6.48)], skin_dark),
        ([(3.08, 1.02), (3.57, 1.68), (3.36, 2.03), (2.34, 1.52), (2.23, .30)], skin_warm),
        ([(4.0, 2.63), (4.48, 3.24), (5.00, 4.72), (4.63, 4.75)], skin_light),
    ]
    for i, (poly, mat) in enumerate(wing_panels):
        surface_patch(tag+' wing tonal panel '+str(i), mirror(poly), foil_z, mat, tag+' Wing finish',
                      offset=.0025+.0015*i, subdivisions=5)
    seam_path = [(2.12, 5.31), (2.65, 5.22), (2.92, 4.94), (3.28, 5.03), (6.16, 4.96)]
    surface_line(tag+' elevon hinge division', mirror(seam_path), foil_z, .012, group=tag+' Wing finish')
    for x in (3.24, 4.85):
        lead, trail, base, thick = planform_values(x, wing_shape)
        surface_line(tag+' elevon segmentation', mirror([(x, 5.04), (x-.10, trail-.13)]), foil_z, .01, group=tag+' Wing finish')
    # Leading edge inset follows the actual airfoil at u=.045.
    leadline = [(x, planform_values(x, wing_shape)[0]+.25) for x in (2.25, 2.8, 3.5, 4.2, 5, 5.7, 6.25)]
    surface_line(tag+' leading edge boundary', mirror(leadline), foil_z, .006, mat=skin_dark, group=tag+' Wing finish')
    cp = [(1.6, -4.73), (2.87, -3.02), (2.87, -2.40), (1.61, -2.43)]
    cz = lambda x, y: foil_z(x, y, canard_shape)
    surface_patch(tag+' canard inset panel', mirror(cp), cz, skin_dark, tag+' Canard', subdivisions=5)
    surface_line(tag+' canard trailing seam', mirror([(1.59, -2.53), (2.96, -2.43)]), cz, .008, group=tag+' Canard')
    # Small formation-light strips are flush and remain inside the wing outline.
    lightx = side*6.19
    lighty = 5.55
    surface_patch(tag+' wingtip navigation lens', [(lightx-.027, lighty-.13), (lightx+.027, lighty-.13),
                  (lightx+.027, lighty+.13), (lightx-.027, lighty+.13)], foil_z,
                  green_lens if side == 1 else red_lens, tag+' Wing finish')

# Outward-canted, airfoil-section vertical stabilizers. No aft horizontal tails.
fin_outline = [(4.78, .64), (6.87, 3.43), (8.14, 3.43), (8.63, .50)]


def fin_x(z):
    return 1.51 + .335*(z-.60)


def fin_mesh(side, tag, outline, name, group, ventral=False):
    n = len(outline)
    centroid = (sum(y for y, z in outline)/n, sum(z for y, z in outline)/n)
    v = []
    for thickness in (-1, 1):
        for y, z in outline:
            x = fin_x(z) if not ventral else 1.86-.36*z
            v.append((side*(x+thickness*.028), y, z))
        y, z = centroid
        x = fin_x(z) if not ventral else 1.86-.36*z
        v.append((side*(x+thickness*(.105 if not ventral else .06)), y, z))
    f, ids = [], []
    for layer in (0, 1):
        start = layer*(n+1)
        for i in range(n):
            f.append((start+i, start+(i+1) % n, start+n)); ids.append(0)
    for i in range(n):
        f.append((i, (i+1) % n, (i+1) % n+n+1, i+n+1)); ids.append(1)
    obj = mesh_object(tag+name, v, f, [skin, edge_mat], ids, smooth=True, group=group)
    outward(obj)
    bevel(obj, .018, 2)
    return obj


for side, tag in ((1, 'R'), (-1, 'L')):
    fin = fin_mesh(side, tag, fin_outline, ' outward canted vertical tail', tag+' Vertical tail')
    # Fin insets occupy both visible sides; mapped to their wedge surface.
    for facing in (-1, 1):
        def finpoint(y, z):
            for points, projected, normals, det, bounds in projected_triangles(fin, (1, 2), side*facing):
                a, b, c = projected
                wb = ((y-a.x)*(c.y-a.y)-(z-a.y)*(c.x-a.x))/det
                wc = ((b.x-a.x)*(z-a.y)-(b.y-a.y)*(y-a.x))/det
                if wb >= -.001 and wc >= -.001 and wb+wc <= 1.001:
                    point = points[0]*(1-wb-wc)+points[1]*wb+points[2]*wc
                    return (point.x+side*facing*.006, y, z)
            return (side*(fin_x(z)+facing*.04), y, z)
        inset = [(5.25, .85), (6.98, 3.21), (7.47, 3.21), (7.92, .84)]
        patch_on_mesh(tag+' vertical tail RAM inset '+str(facing), inset, fin, (1, 2), side*facing,
                      skin_dark, tag+' Vertical tail')
        # Fin rudder line intentionally follows the swept trailing edge.
        tube(tag+' swept rudder seam '+str(facing), [finpoint(7.61, 3.20), finpoint(8.14, .85)],
             .010, seam_mat, 4, group=tag+' Vertical tail')
    shelf = [(side*1.45, 5.66), (side*1.98, 6.16), (side*2.72, 8.54),
             (side*2.37, 8.96), (side*1.62, 8.22)]
    shelfobj = prism(tag+' aft chine shelf', shelf, -.055, .055, skin_light, tag+' Tail fairings')
    bevel(shelfobj, .025, 2)
    fin_mesh(side, tag, [(6.72, -.48), (8.32, -.38), (8.86, -1.20), (7.89, -1.20)],
             ' lower ventral fin', tag+' Tail fairings', True)

# Continuous surfaces over the dorsal engine shoulders, with quiet panel divisions.
for side, tag in ((1, 'R'), (-1, 'L')):
    mir = lambda coords: [(side*x, y) for x, y in coords]
    panels = [
        ([(.72, -4.74), (1.03, -4.51), (1.10, -3.83), (.83, -3.02), (.51, -3.50)], skin_light),
        ([(.23, -3.04), (.88, -2.95), (1.31, -1.75), (.92, -.44), (.44, -.53), (.25, -1.54)], skin_dark),
        ([(.39, .50), (.84, .45), (1.44, 1.41), (1.32, 2.72), (.57, 2.43)], skin_warm),
        ([(.72, 3.28), (1.36, 3.18), (1.55, 4.09), (1.51, 5.50), (.62, 5.85), (.46, 4.32)], skin_dark),
        ([(.18, 5.98), (.49, 5.52), (.60, 6.57), (.51, 7.91), (.20, 8.16)], skin_light),
    ]
    for i, (poly, mat) in enumerate(panels):
        surface_patch(tag+' dorsal coating panel '+str(i), mir(poly), topz, mat, 'Fuselage finish', subdivisions=7)
    for y in (-3.05, -1.1, 1.55, 3.05, 5.97, 7.40):
        w = interpolate(stations, y)[0]
        poly = [(side*x, y+dy) for x, dy in [(0.10, 0), (.41, 0), (.52, .12), (.76, .12),
                                                    (w*.76, .12), (w*.88, -.10)]]
        surface_line(tag+' transverse maintenance seam '+str(y), poly, topz, .0065, group='Fuselage finish')
    surface_line(tag+' dorsal engine access outline', mir([(.55, 3.51), (.65, 3.30), (1.21, 3.27),
                  (1.36, 3.46), (1.31, 5.71), (.73, 5.90), (.57, 5.63)]), topz, .008, True, group='Fuselage finish')
    surface_line(tag+' forward access hatch', mir([(.64, -4.34), (.89, -4.40), (1.00, -4.17),
                  (.90, -3.75), (.67, -3.70), (.59, -3.92)]), topz, .0075, True, group='Fuselage finish')
    # Recessed vents represented by individually inset-looking small solid slots.
    for i in range(7):
        y = 6.09 + i*.092
        x = side*.42
        poly = [(x-.077, y), (x+.077, y), (x+.077, y+.030), (x-.077, y+.030)]
        surface_patch(tag+' aft ventilation slot '+str(i), poly, topz, black, 'Fuselage finish', subdivisions=1)

# Radome ring follows the actual chine section, rather than a circular hoop.
nose_ring = [(x, -8.53, z) for x, z in section(-8.53)]
tube('Faceted radome joint', nose_ring, .009, seam_mat, 5, True, 'Fuselage finish')
for side in (-1, 1):
    surface_line('Forward cheek panel', [(side*.13, -9.58), (side*.37, -9.16), (side*.42, -8.72)],
                 topz, .006, group='Fuselage finish')

# Compact faceted optical fairing under the forward fuselage.
sv = [(-.23, -8.03, -.365), (.23, -8.03, -.365), (.30, -7.50, -.455), (-.30, -7.50, -.455),
      (-.14, -7.94, -.62), (.14, -7.94, -.62), (.19, -7.59, -.65), (-.19, -7.59, -.65)]
sf = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0)]
optical = mesh_object('Faceted forward optical fairing', sv, sf, [skin_dark, sensor], [1, 0, 0, 0, 1, 0], group='Small exterior details')
outward(optical)
bevel(optical, .016)

# A flush dorsal circular service cap, restrained stencils, and belly doors.
for x, y, radius in ((0, -3.69, .17), (.78, .14, .105), (-.78, .14, .105)):
    circle = [(x+radius*math.cos(2*math.pi*i/40), y+radius*math.sin(2*math.pi*i/40)) for i in range(40)]
    surface_patch('Dorsal flush service cap', circle, topz, skin_light, 'Fuselage finish', subdivisions=2)
    surface_line('Service cap perimeter', circle, topz, .007, True, group='Fuselage finish')
for side in (-1, 1):
    for y in (-4.30, -.37, 3.01):
        x = side*.77
        z = topz(x, y)
        surface_patch('Small low-visibility service tab', [(x-.044, y-.077), (x+.044, y-.077),
                       (x+.044, y+.077), (x-.044, y+.077)], topz, stencil, 'Small exterior details', subdivisions=1)
    # The closed gear-door and center-bay lines are cosmetic, with no weapons.
    bottom = lambda x, y: interpolate(stations, y)[3]-.020
    belly_poly = [(side*.24, -2.6), (side*.70, -2.35), (side*.80, 2.79),
                  (side*.47, 3.25), (side*.24, 3.02)]
    tube('Closed belly bay seam', [(x, y, bottom(x, y)) for x, y in belly_poly], .009,
         seam_mat, 4, True, 'Belly details')


def circular_shell(name, cx, cz, rings, mat, group, segments=64, inner=False):
    v = [(cx+r*math.cos(2*math.pi*j/segments), y, cz+r*math.sin(2*math.pi*j/segments))
         for y, r in rings for j in range(segments)]
    f = [(i*segments+j, i*segments+(j+1) % segments,
          (i+1)*segments+(j+1) % segments, (i+1)*segments+j)
         for i in range(len(rings)-1) for j in range(segments)]
    if not inner:
        f = [tuple(reversed(face)) for face in f]
    return mesh_object(name, v, f, [mat], smooth=True, group=group)


# Two genuinely open nozzles: collars, individual overlapping petals, inner liners,
# a recessed shadow and simple abstract turbine forms visible only from behind.
for side, tag in ((1, 'R'), (-1, 'L')):
    cx, cz = side*.985, -.052
    group = tag+' Exhaust'
    circular_shell(tag+' engine transition casing', cx, cz,
                   [(6.45, .51), (7.08, .60), (7.65, .693), (8.10, .728), (8.46, .713), (8.73, .698)], skin_dark, group)
    circular_shell(tag+' exposed titanium collar', cx, cz,
                   [(8.38, .721), (8.57, .722), (8.80, .705), (8.96, .686)], metal, group)
    for y, r in ((8.41, .724), (8.59, .722), (8.82, .704)):
        pts = [(cx+r*math.cos(2*math.pi*i/64), y, cz+r*math.sin(2*math.pi*i/64)) for i in range(64)]
        tube(tag+' circumferential nozzle band', pts, .015, metal_dark, 6, True, group)
    petals = 24
    for i in range(petals):
        center_angle = 2*math.pi*(i+.5)/petals
        halfangle = math.pi/petals*.94
        profile = [(8.83, .699), (9.06, .691), (9.57, .610), (10.10-(.026 if i % 2 else 0), .562)]
        v = []
        for y, r in profile:
            for off in (-1, 0, 1):
                angle = center_angle+halfangle*off
                r2 = r+.009*(1-abs(off))
                v.append((cx+r2*math.cos(angle), y, cz+r2*math.sin(angle)))
        f = [(row*3+j, row*3+j+1, (row+1)*3+j+1, (row+1)*3+j) for row in range(3) for j in range(2)]
        petal = mesh_object(tag+' exhaust petal %02d' % i, v, f, [nozzle_mats[i % 3]], group=group)
        thick = petal.modifiers.new('Petal wall', 'SOLIDIFY')
        thick.thickness = .021
        apply(petal, thick)
        outward(petal)
        for off in (-1, 1):
            angle = center_angle+halfangle*off
            pts = [(cx+(r+.003)*math.cos(angle), y, cz+(r+.003)*math.sin(angle)) for y, r in profile]
            tube(tag+' nozzle petal edge', pts, .0065, metal_light, 4, group=group)
    circular_shell(tag+' dark continuous inner nozzle liner', cx, cz,
                   [(10.085, .54), (9.76, .558), (9.36, .602), (8.90, .575), (8.62, .44)], metal_dark, group, inner=True)
    for i in range(36):
        theta = 2*math.pi*i/36
        pts = [(cx+r*math.cos(theta), y, cz+r*math.sin(theta)) for y, r in [(10.07, .536), (9.65, .561), (9.13, .584)]]
        tube(tag+' inner nozzle fluting', pts, .009, metal, 4, group=group)
    discv = [(cx, 8.595, cz)] + [(cx+.445*math.cos(2*math.pi*i/64), 8.595, cz+.445*math.sin(2*math.pi*i/64)) for i in range(64)]
    mesh_object(tag+' deep turbine shadow', discv, [(0, 1+i, 1+(i+1) % 64) for i in range(64)], [black], group=group)
    for i in range(16):
        a = 2*math.pi*i/16
        points = []
        for r, angle in ((.15, a), (.425, a+.17), (.415, a+.31), (.17, a+.12)):
            points.append((cx+r*math.cos(angle), 8.615, cz+r*math.sin(angle)))
        mesh_object(tag+' recessed abstract turbine blade', points, [(0, 1, 2, 3)], [metal_dark], group=group)
    circular_shell(tag+' central exhaust cone', cx, cz, [(8.605, .15), (8.84, .085), (8.96, .008)], metal_dark, group, 32)

# Consolidate semantic assemblies, applying all authored modifiers before export.
# Material slots remain conventional PBR and are carried into the GLB unchanged.
groups = {}
for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH':
        for uv in list(obj.data.uv_layers):
            obj.data.uv_layers.remove(uv)
        groups.setdefault(obj.get('assembly', 'Details'), []).append(obj)
for name, objects in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    objects[0].name = 'J20 | '+name

root = bpy.data.objects.new('J20 | single-seat display aircraft | nose -Y', None)
bpy.context.collection.objects.link(root)
root['reference'] = 'User-supplied AI four-view design reference; not a technical drawing'
root['scope'] = 'Original visual exterior asset, gear retracted; no weapons or flight systems'
root['orientation'] = 'Blender -Y forward, +Z up; metres'
for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH':
        obj.parent = root
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1.0
bpy.ops.object.select_all(action='DESELECT')
