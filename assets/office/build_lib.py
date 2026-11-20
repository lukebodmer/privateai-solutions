"""The office diorama behind privateai.solutions: a cut-away floor with an open
work pod, a glazed conference room, a small office, a coffee point and Neuman's
servers -- plus the dashed lines that leave every computer, rise to the ceiling
and come down into Neuman's rack.

Everything is in metres with Z up. The interior is 12.8 x 10.4 m; the building
walls are +Y (back) and -X (left), so a camera on (+X, -Y) looks into the two
cut sides. Colours are the site's Nord ladder (tailwind.config.mjs).

Run build() to wipe the file and make the whole thing; the .blend is the
deliverable, this file is how it is made.
"""

import bpy
import bmesh
import math
from mathutils import Vector, Matrix, Euler

D = math.radians

SCENE = bpy.context.scene
COLL = None
MAT = {}

# ---------------------------------------------------------------- palette
PAL = {
    'n50': '#eceff4', 'n100': '#e5e9f0', 'n200': '#d8dee9', 'n300': '#c0c8d6',
    'n400': '#9aa8bc', 'n500': '#7b88a1', 'n600': '#616e88', 'n700': '#4c566a',
    'n800': '#383f4c', 'n900': '#272c36', 'n950': '#1e232b',
    'f50': '#f0f8fa', 'f100': '#e0f0f4', 'f200': '#c5e2ea', 'f300': '#a9d3de',
    'f400': '#88c0d0', 'f500': '#6fa9bb', 'f600': '#5a95a8', 'f700': '#487a8a',
    'f800': '#3a6270',
    'teal': '#8fbcbb', 'sky': '#81a1c1', 'green': '#a3be8c',
    'amber': '#ebcb8b', 'red': '#bf616a', 'violet': '#b48ead',
}

# People are the only thing outside Nord: skin and hair are desaturated warm
# neutrals, so the room has people in it rather than mannequins in blue-grey.
SKIN = ['#f0d2b8', '#e0b18c', '#c08a63', '#8d5a3b']
HAIR = ['#2a2f38', '#4a3a2e', '#8a6a45', '#d9c7a3', '#6a7078']


ROUTES = []


def hexlin(h):
    h = h.lstrip('#')

    def ch(c):
        c = int(c, 16) / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (ch(h[0:2]), ch(h[2:4]), ch(h[4:6]), 1.0)


def make_mats():
    def mk(key, color, metallic=0.0, rough=0.5, emit=None, estr=0.0, alpha=1.0):
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = hexlin(color)
        b.inputs['Metallic'].default_value = metallic
        b.inputs['Roughness'].default_value = rough
        if 'Alpha' in b.inputs:
            b.inputs['Alpha'].default_value = alpha
        if emit is not None:
            for name in ('Emission Color', 'Emission'):
                if name in b.inputs:
                    b.inputs[name].default_value = hexlin(emit)
                    break
            if 'Emission Strength' in b.inputs:
                b.inputs['Emission Strength'].default_value = estr
        m.diffuse_color = hexlin(color)
        MAT[key] = m
        return m

    mk('wall', PAL['n50'], 0.0, 0.92)
    mk('slab', PAL['n400'], 0.0, 0.85)
    mk('tile', '#d9e0ea', 0.0, 0.30)
    mk('baseboard', PAL['n200'], 0.0, 0.6)
    mk('metal', PAL['n400'], 1.0, 0.30)
    mk('metal_dark', PAL['n700'], 0.7, 0.42)
    mk('dark', PAL['n950'], 0.35, 0.48)
    mk('rack_body', PAL['n950'], 0.45, 0.42)
    mk('rack_face', '#1a1f28', 0.30, 0.30)
    mk('rack_glass', '#26303d', 0.55, 0.10)
    mk('desktop', PAL['n50'], 0.0, 0.40)
    mk('accent', PAL['f600'], 0.0, 0.45)
    mk('fabric', PAL['n700'], 0.0, 0.92)
    mk('fabric_soft', PAL['n400'], 0.0, 0.95)
    mk('upholstery', PAL['n500'], 0.0, 0.95)
    mk('cushion', PAL['n100'], 0.0, 0.95)
    mk('rug', PAL['n300'], 0.0, 1.0)
    mk('rug_trim', PAL['f400'], 0.0, 0.9)
    mk('door', PAL['n100'], 0.0, 0.42)
    mk('frosted', PAL['f200'], 0.0, 0.35, emit=PAL['f200'], estr=0.55)
    mk('glass', PAL['f200'], 0.0, 0.06, alpha=0.26)
    mk('sky', PAL['sky'], 0.0, 0.30, emit=PAL['sky'], estr=0.22)
    mk('leaf', PAL['green'], 0.0, 0.62)
    mk('leaf_teal', PAL['teal'], 0.0, 0.62)
    mk('pot', PAL['n100'], 0.0, 0.45)
    mk('pot_frost', PAL['f500'], 0.0, 0.40)
    mk('apple', PAL['red'], 0.0, 0.55)
    mk('soil', '#6b5747', 0.0, 1.0)
    mk('paper', PAL['n50'], 0.0, 0.85)
    mk('plastic', PAL['n100'], 0.0, 0.45)
    mk('screen', '#0e141c', 0.0, 0.14, emit=PAL['f500'], estr=1.7)
    mk('screen_edge', PAL['n800'], 0.4, 0.35)
    mk('led_green', PAL['green'], 0.0, 0.4, emit=PAL['green'], estr=5.0)
    mk('led_frost', PAL['f200'], 0.0, 0.4, emit=PAL['f200'], estr=5.0)
    mk('led_amber', PAL['amber'], 0.0, 0.4, emit=PAL['amber'], estr=3.0)
    mk('neon', PAL['f100'], 0.0, 0.4, emit=PAL['f100'], estr=5.0)
    mk('neon_soft', PAL['f200'], 0.0, 0.4, emit=PAL['f300'], estr=2.2)
    mk('data_line', PAL['f400'], 0.0, 0.4, emit=PAL['f400'], estr=3.0)
    mk('data_channel', PAL['n500'], 0.0, 0.8)
    mk('note_amber', PAL['amber'], 0.0, 0.8)
    mk('note_frost', PAL['f400'], 0.0, 0.8)
    mk('note_green', PAL['green'], 0.0, 0.8)
    for i, c in enumerate(SKIN):
        mk(f'skin{i}', c, 0.0, 0.72)
    for i, c in enumerate(HAIR):
        mk(f'hair{i}', c, 0.0, 0.78)
    mk('shirt_frost', PAL['f400'], 0.0, 0.9)
    mk('shirt_teal', PAL['teal'], 0.0, 0.9)
    mk('shirt_snow', PAL['n100'], 0.0, 0.9)
    mk('shirt_slate', PAL['n700'], 0.0, 0.9)
    mk('shirt_amber', PAL['amber'], 0.0, 0.9)
    mk('shirt_deep', PAL['f700'], 0.0, 0.9)
    mk('trouser_dark', PAL['n900'], 0.0, 0.95)
    mk('trouser_slate', PAL['n800'], 0.0, 0.95)
    mk('trouser_blue', PAL['f800'], 0.0, 0.95)
    mk('shoe', PAL['n950'], 0.0, 0.6)

    # glass is alpha-blended, and must not shadow what it shows
    glass = MAT['glass']
    if hasattr(glass, 'surface_render_method'):
        glass.surface_render_method = 'BLENDED'
    else:
        glass.blend_method = 'BLEND'
    glass.use_backface_culling = False


# ---------------------------------------------------------------- objects
def link(ob):
    (COLL if COLL else SCENE.collection).objects.link(ob)
    return ob


def mesh_obj(name, bm, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    if mat:
        me.materials.append(mat)
    return link(ob)


def add_box(bm, size, loc=(0, 0, 0), rot=(0, 0, 0), matrix=None):
    hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    corners = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
               (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    mx = matrix or (Matrix.Translation(Vector(loc))
                    @ Euler(rot, 'XYZ').to_matrix().to_4x4())
    vs = [bm.verts.new(mx @ Vector(c)) for c in corners]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
              (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([vs[i] for i in f])


def box(name, size, loc, mat, bevel=0.006, seg=2, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        w = min(bevel, min(size) * 0.42)
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=w,
                        segments=seg, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
    mx = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    for v in bm.verts:
        v.co = mx @ v.co
    return mesh_obj(name, bm, mat)


def boxes(name, specs, mat):
    bm = bmesh.new()
    for spec in specs:
        add_box(bm, spec[0], spec[1], spec[2] if len(spec) > 2 else (0, 0, 0))
    return mesh_obj(name, bm, mat)


def cyl(name, r, h, loc, mat, segs=24, rot=(0, 0, 0), r2=None,
        smooth=False, bevel=0.0):
    bm = bmesh.new()
    r2 = r if r2 is None else r2
    try:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                              radius1=r, radius2=r2, depth=h)
    except TypeError:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                              diameter1=r * 2, diameter2=r2 * 2, depth=h)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=bevel,
                        segments=2, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
    mx = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    for v in bm.verts:
        v.co = mx @ v.co
    return mesh_obj(name, bm, mat, smooth=smooth)


def ball(name, r, loc, mat, scale=(1, 1, 1), sub=2, smooth=True,
         rot=(0, 0, 0)):
    bm = bmesh.new()
    try:
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    except TypeError:
        bmesh.ops.create_icosphere(bm, subdivisions=sub, diameter=r * 2)
    mx = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    for v in bm.verts:
        v.co = mx @ Vector((v.co.x * scale[0], v.co.y * scale[1],
                            v.co.z * scale[2]))
    return mesh_obj(name, bm, mat, smooth=smooth)


def tube(name, p0, p1, r0, r1, mat, segs=10, squash=(1, 1)):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    if length < 1e-6:
        return None
    bm = bmesh.new()
    try:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                              radius1=r0, radius2=r1, depth=length)
    except TypeError:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                              diameter1=r0 * 2, diameter2=r1 * 2, depth=length)
    for v in bm.verts:
        v.co = Vector((v.co.x * squash[0], v.co.y * squash[1], v.co.z))
    mx = (Matrix.Translation((p0 + p1) * 0.5)
          @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    for v in bm.verts:
        v.co = mx @ v.co
    return mesh_obj(name, bm, mat)


def bar_matrix(center, direction, length, w, h):
    x = Vector(direction).normalized()
    up = Vector((0, 0, 1))
    if abs(x.dot(up)) > 0.98:
        up = Vector((0, 1, 0))
    y = up.cross(x).normalized()
    z = x.cross(y).normalized()
    mx = Matrix((x, y, z)).transposed().to_4x4()
    mx.translation = Vector(center)
    return mx @ Matrix.Diagonal(Vector((length, w, h, 1.0)))


def bars(name, specs, mat):
    """specs: (center, direction, length, width, height)."""
    bm = bmesh.new()
    for center, direction, length, w, h in specs:
        add_box(bm, (1, 1, 1), matrix=bar_matrix(center, direction, length, w, h))
    return mesh_obj(name, bm, mat)


def text(name, body, size, loc, mat, rot=(D(90), 0, 0), extrude=0.003):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new(name, cu)
    link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def join(objs, name):
    objs = [o for o in objs if o and o.name in bpy.data.objects]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def at(parts, cx, cy, rz):
    """Bake a plan rotation/translation into freshly built local parts."""
    mx = Matrix.Translation(Vector((cx, cy, 0))) @ Matrix.Rotation(rz, 4, 'Z')
    for ob in parts:
        if ob is not None:
            ob.data.transform(mx)
    return parts


# ---------------------------------------------------------------- layout
HX, HY = 6.4, 5.2          # interior half-extents
WALL_H = 3.3
WALL_T = 0.24
OX, OY = HX + WALL_T, HY + WALL_T
TILE = 0.8
NX, NY = 16, 13

DOOR_Y0, DOOR_Y1, DOOR_H = -4.40, -3.30, 2.20

# Neuman's cabinet: front to the room, back to the left wall
NEUMAN_X, NEUMAN_Y = -5.75, 4.55
NEUMAN_RZ = D(90)
RACK_X = []
RACK_Y = 4.55
RACK_W, RACK_D, RACK_H = 0.72, 1.02, 2.02

# glazed rooms along the back wall
OFF_X0, OFF_X1, OFF_Y0 = -2.55, 1.05, 2.95
CONF_X0, CONF_X1, CONF_Y0 = 1.05, 6.20, 2.05
ROOM_H = 2.60

# the open pod: four desks round a planter, each person facing the middle
POD_CX, POD_CY, POD_R = -1.60, -1.45, 1.45

CHAIR_LIFT = 0.469
DESK_H = 0.75


# ---------------------------------------------------------------- shell
def build_room():
    parts = []

    parts.append(box('Slab', (2 * OX + 0.52, 2 * OY + 0.52, 0.26),
                     (0.0, 0.0, -0.15), MAT['slab'], bevel=0.02, seg=2))

    tiles = []
    s = TILE - 0.03
    for i in range(NX):
        for j in range(NY):
            cx = -HX + TILE * (i + 0.5)
            cy = -HY + TILE * (j + 0.5)
            tiles.append(((s, s, 0.04), (cx, cy, -0.02)))
    parts.append(boxes('Tiles', tiles, MAT['tile']))

    parts.append(box('Wall_Back', (OX * 2, WALL_T, WALL_H),
                     (0.0, HY + WALL_T / 2, WALL_H / 2), MAT['wall'],
                     bevel=0.012, seg=2))

    parts.append(box('Wall_Left_A', (WALL_T, DOOR_Y0 + OY, WALL_H),
                     (-HX - WALL_T / 2, (DOOR_Y0 - OY) / 2, WALL_H / 2),
                     MAT['wall'], bevel=0.012, seg=2))
    parts.append(box('Wall_Left_B', (WALL_T, OY - DOOR_Y1, WALL_H),
                     (-HX - WALL_T / 2, (DOOR_Y1 + OY) / 2, WALL_H / 2),
                     MAT['wall'], bevel=0.012, seg=2))
    parts.append(box('Wall_Left_Head', (WALL_T, DOOR_Y1 - DOOR_Y0, WALL_H - DOOR_H),
                     (-HX - WALL_T / 2, (DOOR_Y0 + DOOR_Y1) / 2,
                      (DOOR_H + WALL_H) / 2), MAT['wall'], bevel=0.012, seg=2))

    parts.append(box('Skirting_Back', (HX * 2, 0.05, 0.10),
                     (0.0, HY - 0.025, 0.05), MAT['baseboard'], bevel=0.006))
    parts.append(box('Skirting_Left_A', (0.05, DOOR_Y0 + HY, 0.10),
                     (-HX + 0.025, (DOOR_Y0 - HY) / 2, 0.05),
                     MAT['baseboard'], bevel=0.006))
    parts.append(box('Skirting_Left_B', (0.05, HY - DOOR_Y1, 0.10),
                     (-HX + 0.025, (DOOR_Y1 + HY) / 2, 0.05),
                     MAT['baseboard'], bevel=0.006))

    fw = 0.06
    parts.append(box('Door_Post_A', (0.18, fw, DOOR_H),
                     (-HX + 0.02, DOOR_Y0, DOOR_H / 2),
                     MAT['metal_dark'], bevel=0.008))
    parts.append(box('Door_Post_B', (0.18, fw, DOOR_H),
                     (-HX + 0.02, DOOR_Y1, DOOR_H / 2),
                     MAT['metal_dark'], bevel=0.008))
    parts.append(box('Door_Head', (0.18, DOOR_Y1 - DOOR_Y0 + fw, fw),
                     (-HX + 0.02, (DOOR_Y0 + DOOR_Y1) / 2, DOOR_H),
                     MAT['metal_dark'], bevel=0.008))

    leaf_x = -HX + 0.04
    parts.append(box('Door_Leaf', (0.05, DOOR_Y1 - DOOR_Y0 - 0.10, DOOR_H - 0.07),
                     (leaf_x, (DOOR_Y0 + DOOR_Y1) / 2,
                      (DOOR_H - 0.07) / 2 + 0.02), MAT['door'], bevel=0.006))
    parts.append(box('Door_Pane', (0.012, 0.66, 0.90),
                     (leaf_x + 0.031, (DOOR_Y0 + DOOR_Y1) / 2 + 0.06, 1.52),
                     MAT['frosted'], bevel=0.005))
    parts.append(box('Door_Pull', (0.028, 0.032, 0.38),
                     (leaf_x + 0.048, (DOOR_Y0 + DOOR_Y1) / 2 + 0.36, 1.04),
                     MAT['metal'], bevel=0.005))

    return join(parts, 'Office_Shell')


# ---------------------------------------------------------------- racks
"""One rack, so one visible amount of computer.

The cabinet is built at the origin facing -Y, then turned so its front faces
the open room rather than the end of the kitchen counter, and joined.
"""


def build_racks():
    import random
    random.seed(23)
    parts = []
    leds = {'led_green': [], 'led_frost': [], 'led_amber': []}
    x, y = 0.0, 0.0
    place = (Matrix.Translation(Vector((NEUMAN_X, NEUMAN_Y, 0)))
             @ Matrix.Rotation(NEUMAN_RZ, 4, 'Z'))

    parts.append(box('Rack_Body', (RACK_W, RACK_D, RACK_H),
                     (x, y, 0.06 + RACK_H / 2), MAT['rack_body'],
                     bevel=0.008, seg=1))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(cyl(f'Rack_Foot_{sx}{sy}', 0.034, 0.06,
                             (x + sx * 0.28, y + sy * 0.44, 0.03),
                             MAT['metal_dark'], segs=10))
    parts.append(box('Rack_Cap', (RACK_W + 0.02, RACK_D + 0.02, 0.035),
                     (x, y, 0.06 + RACK_H + 0.017), MAT['metal_dark'],
                     bevel=0.006))

    front = y - RACK_D / 2
    parts.append(box('Rack_Bezel', (RACK_W - 0.04, 0.03, RACK_H - 0.08),
                     (x, front + 0.005, 0.06 + RACK_H / 2),
                     MAT['rack_face'], bevel=0.004))
    units = []
    z = 0.30
    while z < 1.54:
        units.append(((RACK_W - 0.14, 0.022, 0.052), (x, front - 0.032, z)))
        z += 0.152
    parts.append(boxes('Rack_Units', units, MAT['rack_face']))

    z = 0.315
    while z < 1.52:
        for ox in (-0.24, -0.195, -0.15):
            key = random.choices(['led_green', 'led_frost', 'led_amber'],
                                 weights=(6, 4, 1))[0]
            leds[key].append(((0.014, 0.008, 0.009),
                              (x + ox, front - 0.048, z)))
        z += 0.152

    for sx in (-1, 1):
        parts.append(box(f'Rack_Strip_{sx}', (0.016, 0.010, 1.70),
                         (x + sx * (RACK_W / 2 - 0.055), front - 0.018,
                          1.03), MAT['neon_soft'], bevel=0.002))
    parts.append(box('Rack_Plate', (RACK_W - 0.12, 0.016, 0.38),
                     (x, front - 0.028, 1.79), MAT['dark'], bevel=0.004))

    for ob in parts:
        ob.data.transform(place)
    body = join(parts, 'Server_Racks')

    led_objs = [boxes('LEDs_' + k.split('_')[1], v, MAT[k])
                for k, v in leds.items() if v]
    for ob in led_objs:
        ob.data.transform(place)
    leds_ob = join(led_objs, 'Server_LEDs')

    word = text('Neuman_Plaque', 'neuman', 0.145,
                (x, front - 0.044, 1.79), MAT['neon'], extrude=0.003)
    word.matrix_world = place @ word.matrix_world

    # just the little work light on the wall, no mast above the cabinet
    light_parts = [
        box('Rack_Light_Housing', (RACK_W + 0.30, 0.07, 0.07),
            (NEUMAN_X, HY - 0.07, 2.72), MAT['metal_dark'], bevel=0.006),
        box('Rack_Light', (RACK_W + 0.16, 0.028, 0.028),
            (NEUMAN_X, HY - 0.115, 2.694), MAT['neon'], bevel=0.003),
    ]
    body = join([body] + light_parts, 'Server_Racks')

    # a plant under the new window on the freed back wall
    join(tall_plant('Neuman_Plant', -4.30, 4.72, h=1.15, seed=31),
         'Neuman_Plant')
    return body, leds_ob, word


# ---------------------------------------------------------------- glass
def glass_wall(name, p0, p1, h=ROOM_H, z0=0.0):
    """One glazed partition: panel, top and bottom rails, and mullions at the
    ends (plus a middle post only on a long run)."""
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    d = p1 - p0
    L = d.length
    if L < 0.05:
        return []
    ang = math.atan2(d.y, d.x)
    mid = (p0 + p1) * 0.5
    parts = [
        box(name + '_Glass', (L, 0.02, h - 0.10),
            (mid.x, mid.y, z0 + h / 2), MAT['glass'], bevel=0.0,
            rot=(0, 0, ang)),
        box(name + '_RailB', (L, 0.045, 0.05),
            (mid.x, mid.y, z0 + 0.025), MAT['metal_dark'], bevel=0.003,
            rot=(0, 0, ang)),
        box(name + '_RailT', (L, 0.045, 0.05),
            (mid.x, mid.y, z0 + h - 0.025), MAT['metal_dark'], bevel=0.003,
            rot=(0, 0, ang)),
    ]
    parts[0].visible_shadow = False
    stops = (0.0, 1.0) if L < 2.4 else (0.0, 0.5, 1.0)
    for t in stops:
        p = p0 + d * t
        parts.append(box(f'{name}_M{t:.1f}', (0.045, 0.045, h),
                         (p.x, p.y, z0 + h / 2), MAT['metal_dark'],
                         bevel=0.003))
    return parts


def solid_partition(name, p0, p1, h=ROOM_H, t=0.10):
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    d = p1 - p0
    ang = math.atan2(d.y, d.x)
    mid = (p0 + p1) * 0.5
    return [box(name, (d.length, t, h), (mid.x, mid.y, h / 2), MAT['wall'],
                bevel=0.008, seg=1, rot=(0, 0, ang))]


def window_run(name, p0, p1, z0, z1, step=1.6):
    """A window in an exterior wall: pale sky pane inside a dark frame."""
    d = Vector((p1[0] - p0[0], p1[1] - p0[1], 0))
    L = d.length
    if L < 0.3:
        return []
    ang = math.atan2(d.y, d.x)
    n = Vector((d.y, -d.x, 0)) / L          # normal, pointing into the room
    mid = Vector((p0[0], p0[1], 0)).lerp(Vector((p1[0], p1[1], 0)), 0.5)
    h = z1 - z0
    zc = (z0 + z1) * 0.5
    off = 0.025
    parts = [
        box(name + '_Pane', (L - 0.06, 0.02, h - 0.06),
            (mid.x + n.x * off, mid.y + n.y * off, zc), MAT['sky'],
            bevel=0.0, rot=(0, 0, ang)),
        box(name + '_RailB', (L, 0.05, 0.07),
            (mid.x + n.x * 0.03, mid.y + n.y * 0.03, z0), MAT['metal_dark'],
            bevel=0.003, rot=(0, 0, ang)),
        box(name + '_RailT', (L, 0.05, 0.07),
            (mid.x + n.x * 0.03, mid.y + n.y * 0.03, z1), MAT['metal_dark'],
            bevel=0.003, rot=(0, 0, ang)),
    ]
    for i, p in enumerate((p0, p1)):
        parts.append(box(f'{name}_Jamb{i}', (0.07, 0.05, h),
                         (p[0] + n.x * 0.03, p[1] + n.y * 0.03, zc),
                         MAT['metal_dark'], bevel=0.003, rot=(0, 0, ang)))
    count = max(0, int(L // step) - 1)
    for i in range(1, count + 1):
        p = Vector((p0[0], p0[1], 0)).lerp(Vector((p1[0], p1[1], 0)),
                                          i / (count + 1))
        parts.append(box(f'{name}_M{i}', (0.05, 0.05, h),
                         (p.x + n.x * 0.03, p.y + n.y * 0.03, zc),
                         MAT['metal_dark'], bevel=0.003, rot=(0, 0, ang)))
    return parts


# ---------------------------------------------------------------- furniture
def monitor(name, cx, cy, screen_w=0.58, screen_h=0.34, base_z=DESK_H):
    parts = [
        box(name + '_Foot', (0.26, 0.17, 0.014),
            (cx, cy + 0.02, base_z + 0.007), MAT['metal_dark'], bevel=0.003),
        box(name + '_Neck', (0.05, 0.04, 0.24),
            (cx, cy + 0.03, base_z + 0.12), MAT['metal_dark'], bevel=0.004),
    ]
    top = base_z + 0.16 + screen_h / 2
    parts.append(box(name + '_Panel', (screen_w + 0.06, 0.03, screen_h + 0.06),
                     (cx, cy, top), MAT['screen_edge'], bevel=0.006, seg=2))
    parts.append(box(name + '_Screen', (screen_w, 0.006, screen_h),
                     (cx, cy - 0.017, top), MAT['screen'], bevel=0.003))
    return parts, top


def chair(name, cx, cy, rz, fabric=None):
    """A low-poly task chair: five arms, a column, a box seat and back."""
    fabric = fabric or MAT['fabric']
    parts = []

    def P(x, y):
        c, s = math.cos(rz), math.sin(rz)
        return (cx + x * c - y * s, cy + x * s + y * c)

    for i in range(5):
        a = rz + i * math.tau / 5
        ax, ay = cx + math.cos(a) * 0.14, cy + math.sin(a) * 0.14
        parts.append(box(f'{name}_Arm{i}', (0.28, 0.05, 0.03), (ax, ay, 0.06),
                         MAT['metal_dark'], bevel=0.006, rot=(0, 0, a)))
        wx, wy = cx + math.cos(a) * 0.27, cy + math.sin(a) * 0.27
        parts.append(box(f'{name}_Wheel{i}', (0.05, 0.05, 0.05),
                         (wx, wy, 0.025), MAT['metal_dark'], bevel=0.006))
    parts.append(box(name + '_Column', (0.07, 0.07, 0.30), (cx, cy, 0.23),
                     MAT['metal'], bevel=0.004))
    parts.append(box(name + '_Seat', (0.46, 0.44, 0.09), (cx, cy, 0.42),
                     fabric, bevel=0.012))
    bx, by = P(0, 0.225)
    parts.append(box(name + '_Back', (0.44, 0.07, 0.42), (bx, by, 0.66),
                     fabric, bevel=0.012, rot=(D(-6), 0, rz)))
    return parts


def _faces(rz, cx, cy):
    c, s = math.cos(rz), math.sin(rz)

    def P(x, y):
        return (cx + x * c - y * s, cy + x * s + y * c)
    return P


def set_origin(ob, point):
    """Move an object's origin to a world point without moving its geometry,
    so a later animation can rotate it around the right joint."""
    point = Vector(point)
    ob.data.transform(Matrix.Translation(-point))
    ob.location = point


def pivot_arm(arm_ob, name, point, rz):
    """Parent an arm to an empty at its joint, oriented with the figure, so
    its local X rotation is the natural swing of that arm."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.04
    e.empty_display_type = 'PLAIN_AXES'
    (COLL if COLL else bpy.context.scene.collection).objects.link(e)
    m = Matrix.Translation(Vector(point)) @ Matrix.Rotation(rz, 4, 'Z')
    e.matrix_world = m
    arm_ob.parent = e
    arm_ob.matrix_parent_inverse = m.inverted()
    return e


def split_arm(name, parts, px, py, rz, local_x, local_y, z, body=None):
    """Join an arm, put its origin at the joint, and give it a pivot empty."""
    arm_ob = join(parts, name)
    c, s = math.cos(rz), math.sin(rz)
    point = (px + local_x * c - local_y * s,
             py + local_x * s + local_y * c, z)
    set_origin(arm_ob, point)
    pivot = pivot_arm(arm_ob, name + '_Pivot', point, rz)
    if body is not None:
        pivot.parent = body
        pivot.matrix_parent_inverse = body.matrix_world.inverted()
    return pivot


def split_person_arms(name, arms, px, py, rz, z, lx=0.22, ly=-0.01, body=None):
    for side, sx in (('L', 1), ('R', -1)):
        if side in arms:
            split_arm(f'{name}_Arm{side}', arms[side], px, py, rz,
                      sx * lx, ly, z, body=body)


def person(name, cx, cy, rz, skin=0, hair=0, shirt='shirt_frost',
           trousers='trouser_dark', pose='stand', hair_style='short',
           holding=None, beard=False, extras=None, arms_out=None,
           arms_sides=('L', 'R')):
    """A blocky figure facing local -Y; seated, the origin is the seat top.

    Boxes only, with two dark eyes on the front face -- the low-poly crowd
    from the reference, sized for this room. `extras`, when given, collects
    parts that should stay separate (the crossed leg on the sofa). When
    `arms_out` is a dict, the requested arms are put there instead of in the
    body, so they can be pivoted and animated (typing, reaching).
    """
    P = _faces(rz, cx, cy)
    z0 = CHAIR_LIFT if pose in ('sit', 'couch') else 0.0
    sk, ha = MAT[f'skin{skin}'], MAT[f'hair{hair}']
    sh, tr = MAT[shirt], MAT[trousers]
    parts = []

    def B(nm, size, x, y, z, mat, rot_x=0.0, collect=True):
        ob = box(nm, size, P(x, y) + (z + z0,), mat,
                 bevel=0.008, rot=(rot_x, 0, rz))
        if collect:
            parts.append(ob)
        return ob

    if pose == 'stand':
        for sx in (-1, 1):
            B(f'{name}_Shoe{sx}', (0.14, 0.26, 0.09), sx * 0.105, -0.045, 0.045,
              MAT['shoe'])
            B(f'{name}_Leg{sx}', (0.13, 0.14, 0.72), sx * 0.105, 0.0, 0.45, tr)
        B(name + '_Hips', (0.36, 0.22, 0.16), 0, 0.0, 0.86, tr)
        B(name + '_Torso', (0.38, 0.24, 0.50), 0, 0.0, 1.19, sh)
        B(name + '_Neck', (0.10, 0.10, 0.06), 0, 0.0, 1.47, sk)
        head_z = 1.62
        for sx in (-1, 1):
            side = 'L' if sx > 0 else 'R'
            split = arms_out is not None and side in arms_sides
            if split:
                arms_out[side] = [
                    B(f'{name}_Arm{sx}', (0.10, 0.12, 0.44), sx * 0.24, 0.0,
                      1.19, sh, collect=False),
                    B(f'{name}_Hand{sx}', (0.09, 0.10, 0.10), sx * 0.24, 0.0,
                      0.91, sk, collect=False)]
            else:
                B(f'{name}_Arm{sx}', (0.10, 0.12, 0.44), sx * 0.24, 0.0,
                  1.19, sh)
                B(f'{name}_Hand{sx}', (0.09, 0.10, 0.10), sx * 0.24, 0.0,
                  0.91, sk)
    else:
        B(f'{name}_ThighL', (0.13, 0.44, 0.14), -0.105, -0.20, 0.06, tr)
        B(f'{name}_ShinL', (0.13, 0.14, 0.38), -0.105, -0.42, -0.17, tr)
        B(f'{name}_ShoeL', (0.14, 0.26, 0.08), -0.105, -0.47, -0.42, MAT['shoe'])
        if pose == 'couch':
            # right leg crossed over the left knee, kept in `extras` so the
            # ankle can be bounced by a later animation
            leg = []

            def L(nm, size, x, y, z, mat, rot=(0, 0, 0)):
                leg.append(box(nm, size, P(x, y) + (z + z0,), mat, bevel=0.008,
                               rot=(rot[0], rot[1], rot[2] + rz)))

            # figure-four: that leg's ankle rests on the other knee
            L(f'{name}_ThighR', (0.13, 0.44, 0.14), 0.14, -0.19, 0.12, tr,
              (D(-8), 0, D(10)))
            L(f'{name}_ShinR', (0.30, 0.13, 0.13), 0.03, -0.39, 0.20, tr,
              (0, 0, D(-6)))
            L(f'{name}_ShoeR', (0.13, 0.22, 0.08), -0.14, -0.43, 0.16,
              MAT['shoe'], (0, 0, D(-20)))
            (extras if extras is not None else parts).extend(leg)
        else:
            B(f'{name}_ThighR', (0.13, 0.44, 0.14), 0.105, -0.20, 0.06, tr)
            B(f'{name}_ShinR', (0.13, 0.14, 0.38), 0.105, -0.42, -0.17, tr)
            B(f'{name}_ShoeR', (0.14, 0.26, 0.08), 0.105, -0.47, -0.42, MAT['shoe'])
        B(name + '_Hips', (0.36, 0.24, 0.16), 0, 0.02, 0.10, tr)
        B(name + '_Torso', (0.38, 0.24, 0.46), 0, 0.02, 0.39, sh)
        B(name + '_Neck', (0.10, 0.10, 0.06), 0, 0.02, 0.65, sk)
        head_z = 0.80
        for sx in (-1, 1):
            side = 'L' if sx > 0 else 'R'
            split = arms_out is not None and side in arms_sides
            if pose == 'couch':
                # arms resting down at his sides, not held out in front
                B(f'{name}_Arm{sx}', (0.10, 0.12, 0.30), sx * 0.24, 0.02, 0.46, sh)
                B(f'{name}_Fore{sx}', (0.09, 0.10, 0.24), sx * 0.245, 0.04,
                  0.19, sh)
                B(f'{name}_Hand{sx}', (0.09, 0.09, 0.08), sx * 0.245, 0.04,
                  0.06, sk)
            else:
                B(f'{name}_Arm{sx}', (0.10, 0.12, 0.26), sx * 0.24, 0.02, 0.49, sh)
                if split:
                    arms_out[side] = [
                        B(f'{name}_Fore{sx}', (0.09, 0.34, 0.09), sx * 0.215,
                          -0.19, 0.35, sh, collect=False),
                        B(f'{name}_Hand{sx}', (0.09, 0.09, 0.08), sx * 0.20,
                          -0.38, 0.35, sk, collect=False)]
                else:
                    B(f'{name}_Fore{sx}', (0.09, 0.34, 0.09), sx * 0.215,
                      -0.19, 0.35, sh)
                    B(f'{name}_Hand{sx}', (0.09, 0.09, 0.08), sx * 0.20,
                      -0.38, 0.35, sk)

    B(name + '_Head', (0.24, 0.22, 0.24), 0, 0.0, head_z, sk)
    for sx in (-1, 1):
        B(f'{name}_Eye{sx}', (0.035, 0.012, 0.035), sx * 0.055, -0.117,
          head_z + 0.005, MAT['dark'])
    B(name + '_HairCap', (0.26, 0.24, 0.08), 0, 0.01, head_z + 0.10, ha)
    B(name + '_HairBack', (0.26, 0.08, 0.16), 0, 0.105, head_z + 0.01, ha)
    if hair_style == 'long':
        B(name + '_HairLong', (0.26, 0.07, 0.34), 0, 0.115, head_z - 0.12, ha)
    elif hair_style == 'bun':
        B(name + '_Bun', (0.12, 0.12, 0.12), 0, 0.06, head_z + 0.18, ha)
    if beard:
        B(name + '_Beard', (0.20, 0.02, 0.07), 0, -0.117, head_z - 0.075, ha)

    if holding == 'mug':
        parts.append(cyl(name + '_Mug', 0.04, 0.10,
                         P(-0.24, -0.02) + (0.90 + z0,), MAT['pot'], segs=10))
    return parts


def plant(name, cx, cy, scale, pot_mat, leaf_mat, seed=1, z0=0.0):
    import random
    rnd = random.Random(seed)
    parts = []
    pot_h = 0.20 * scale
    pot_r = 0.115 * scale
    parts.append(cyl(name + '_Pot', pot_r, pot_h, (cx, cy, z0 + pot_h / 2),
                     pot_mat, segs=16, r2=pot_r * 1.14, bevel=0.003))
    parts.append(cyl(name + '_Soil', pot_r * 1.02, 0.02,
                     (cx, cy, z0 + pot_h - 0.004), MAT['soil'], segs=12))
    for i in range(5):
        a = rnd.uniform(0, math.tau)
        lean = rnd.uniform(0.10, 0.34) * scale
        h = rnd.uniform(0.22, 0.46) * scale
        parts.append(cyl(f'{name}_Stem{i}', 0.008 * scale, h,
                         (cx + math.cos(a) * lean * 0.5,
                          cy + math.sin(a) * lean * 0.5,
                          z0 + pot_h + h / 2), leaf_mat, segs=6,
                         rot=(math.sin(a) * 0.18, math.cos(a) * 0.18, 0)))
        parts.append(ball(f'{name}_Leaf{i}', 0.085 * scale,
                          (cx + math.cos(a) * lean, cy + math.sin(a) * lean,
                           z0 + pot_h + h), leaf_mat, sub=1,
                          scale=(1.0, 0.55, 0.22), rot=(0, 0, a)))
    return parts


def tall_plant(name, cx, cy, h=1.45, seed=9):
    import random
    rnd = random.Random(seed)
    parts = [cyl(name + '_Pot', 0.20, 0.44, (cx, cy, 0.22), MAT['pot'],
                 segs=16, r2=0.23, bevel=0.004),
             cyl(name + '_Soil', 0.20, 0.02, (cx, cy, 0.436), MAT['soil'],
                 segs=12)]
    for i in range(11):
        a = rnd.uniform(0, math.tau)
        hh = rnd.uniform(0.40, 0.98) * (h / 1.45)
        lean = rnd.uniform(0.08, 0.30)
        parts.append(cyl(f'{name}_Stem{i}', 0.009, hh,
                         (cx + math.cos(a) * lean * 0.5,
                          cy + math.sin(a) * lean * 0.5, 0.44 + hh / 2),
                         MAT['leaf'], segs=6,
                         rot=(math.sin(a) * 0.2, math.cos(a) * 0.2, 0)))
        parts.append(ball(f'{name}_Leaf{i}', 0.13,
                          (cx + math.cos(a) * lean, cy + math.sin(a) * lean,
                           0.44 + hh), MAT['leaf'], sub=1,
                          scale=(1.0, 0.6, 0.28), rot=(0, 0, a)))
    return parts


# ---------------------------------------------------------------- des units
PORTS = []


def desk_unit(name, cx, cy, rz, mug=None):
    """A workstation built at the origin facing -Y, then turned into place.

    Returns its network port -- the centre of the monitor's top edge -- with
    the parts, so the caller can join the desk into the room or pod it is in.
    """
    w, d = 1.55, 0.80
    parts = [box(name + '_Top', (w, d, 0.045), (0, 0, DESK_H),
                 MAT['desktop'], bevel=0.008, seg=1)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box(f'{name}_Leg{sx}{sy}', (0.05, 0.05, 0.73),
                             (sx * (w / 2 - 0.08), sy * (d / 2 - 0.08), 0.365),
                             MAT['metal_dark'], bevel=0.004))
    mp, mon_centre = monitor(name + '_Mon', 0, 0.22)
    parts += mp
    mon_top = mon_centre + 0.20
    parts.append(box(name + '_Port', (0.10, 0.07, 0.008),
                     (0, 0.22, mon_top + 0.004), MAT['data_line'],
                     bevel=0.002))
    # a keyboard you can actually see from across the room
    parts.append(box(name + '_Keys', (0.42, 0.15, 0.02),
                     (0, -0.03, DESK_H + 0.012), MAT['metal_dark'],
                     bevel=0.004))
    parts.append(box(name + '_KeysInset', (0.36, 0.10, 0.004),
                     (0, -0.03, DESK_H + 0.023), MAT['screen_edge'],
                     bevel=0.0))
    if mug:
        parts.append(cyl(name + '_Mug', 0.038, 0.10, (0.56, 0.06, DESK_H + 0.052),
                         MAT[mug], segs=12))
        parts.append(cyl(name + '_Coffee', 0.031, 0.008,
                         (0.56, 0.06, DESK_H + 0.104), MAT['soil'], segs=12))
    parts += chair(name + '_Chair', 0, -0.52, D(180))
    at(parts, cx, cy, rz)
    mx = Matrix.Translation(Vector((cx, cy, 0))) @ Matrix.Rotation(rz, 4, 'Z')
    port = mx @ Vector((0.0, 0.22, mon_top + 0.01))
    return port, parts


def bushy_plant(name, cx, cy, h=1.7, z0=0.56, seed=4):
    """A full indoor shrub: several stems and a spread of leaf clusters."""
    import random
    rnd = random.Random(seed)
    parts = []
    for i in range(5):
        a = i * math.tau / 5 + rnd.uniform(-0.25, 0.25)
        lean = rnd.uniform(0.12, 0.30)
        hh = rnd.uniform(0.55, 1.00) * (h / 1.7)
        parts.append(tube(name + f'_Stem{i}',
                          (cx + math.cos(a) * 0.10, cy + math.sin(a) * 0.10, z0),
                          (cx + math.cos(a) * lean, cy + math.sin(a) * lean,
                           z0 + hh), 0.018, 0.010, MAT['leaf'], segs=6))
    for i in range(26):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0.06, 0.46)
        zz = z0 + rnd.uniform(0.20, h)
        parts.append(ball(f'{name}_Leaf{i}', rnd.uniform(0.12, 0.18),
                          (cx + math.cos(a) * r, cy + math.sin(a) * r, zz),
                          MAT['leaf'] if i % 3 else MAT['leaf_teal'], sub=1,
                          scale=(1.0, 0.55, 0.30), rot=(0, 0, a)))
    for i in range(5):
        a = rnd.uniform(0, math.tau)
        parts.append(ball(f'{name}_Drape{i}', 0.13,
                          (cx + math.cos(a) * 0.62, cy + math.sin(a) * 0.62,
                           z0 + 0.06), MAT['leaf'], sub=1,
                          scale=(1.0, 0.55, 0.24), rot=(0, 0, a)))
    return parts


def build_pod():
    parts = []
    people = [
        (POD_CX, POD_CY - POD_R, 0, dict(skin=1, hair=1, shirt='shirt_frost',
                                         trousers='trouser_dark')),
        (POD_CX + POD_R, POD_CY, D(90), dict(skin=2, hair=0, shirt='shirt_teal',
                                             trousers='trouser_slate',
                                             hair_style='bun')),
        (POD_CX, POD_CY + POD_R, D(180), dict(skin=0, hair=2,
                                              shirt='shirt_slate',
                                              trousers='trouser_blue',
                                              hair_style='long')),
        (POD_CX - POD_R, POD_CY, D(-90), dict(skin=3, hair=0,
                                              shirt='shirt_amber',
                                              trousers='trouser_dark')),
    ]
    mugs = {1: 'pot_frost', 3: 'pot'}
    for i, (cx, cy, rz, who) in enumerate(people):
        port, desk_parts = desk_unit(f'Desk{i}', cx, cy, rz, mug=mugs.get(i))
        PORTS.append(port)
        parts += desk_parts
        if i == 0:
            continue          # this one is sitting on the sofa instead
        mx = Matrix.Translation(Vector((cx, cy, 0))) @ Matrix.Rotation(rz, 4, 'Z')
        pv = mx @ Vector((0, -0.52, 0))
        p_rz = rz + D(180)
        arms = {}
        who_parts = person(f'Person_Pod{i}', pv.x, pv.y, p_rz, pose='sit',
                           arms_out=arms, **who)
        body = join(who_parts, f'Person_Pod{i}')
        set_origin(body, (pv.x, pv.y, 0))
        split_person_arms(f'Person_Pod{i}', arms, pv.x, pv.y, p_rz,
                          CHAIR_LIFT + 0.36, body=body)

    parts.append(box('Pod_Planter', (1.25, 1.25, 0.55), (POD_CX, POD_CY, 0.275),
                     MAT['pot'], bevel=0.014, seg=2))
    parts.append(box('Pod_Soil', (1.05, 1.05, 0.03), (POD_CX, POD_CY, 0.545),
                     MAT['soil'], bevel=0.004))
    parts += bushy_plant('Pod_Plant', POD_CX, POD_CY, h=1.7, z0=0.56, seed=4)
    return join(parts, 'Work_Pod')


# ---------------------------------------------------------------- rooms
def build_office_room():
    parts = []
    # solid partitions left and right, glazed front with a door
    parts += solid_partition('Office_Partition_L',
                             (OFF_X0 - 0.05, OFF_Y0), (OFF_X0 - 0.05, HY))
    parts += solid_partition('Office_Partition_R',
                             (OFF_X1 + 0.05, OFF_Y0), (OFF_X1 + 0.05, HY))
    parts += glass_wall('Office_Glass_F1', (OFF_X0, OFF_Y0), (-1.55, OFF_Y0))
    parts += glass_wall('Office_Glass_F2', (-0.65, OFF_Y0), (OFF_X1, OFF_Y0))
    # windows onto the exterior wall, either side of the art
    parts += window_run('Office_Win', (-2.35, HY), (0.85, HY), 1.10, 2.45)

    # the desk tucked into the left corner, with a visitor corner to itself
    port, desk_parts = desk_unit('Office_Desk', -1.70, 4.50, 0,
                                 mug='pot_frost')
    PORTS.append(port)
    parts += desk_parts
    mx = Matrix.Translation(Vector((-1.70, 4.50, 0))) @ Matrix.Rotation(0, 4, 'Z')
    pv = mx @ Vector((0, -0.52, 0))
    office_arms = {}
    who = person('Person_Office', pv.x, pv.y, D(180), skin=2, hair=1,
                 shirt='shirt_teal', trousers='trouser_slate', pose='sit',
                 arms_out=office_arms)
    office_body = join(who, 'Person_Office')
    set_origin(office_body, (pv.x, pv.y, 0))
    split_person_arms('Person_Office', office_arms, pv.x, pv.y, D(180),
                      CHAIR_LIFT + 0.36, body=office_body)

    parts += plant('Office_Plant', -2.15, 3.55, 0.9, MAT['pot_frost'],
                   MAT['leaf'], seed=7, z0=0.0)
    parts += armchair('Office_Guest', 0.30, 3.60, D(252),
                      accent=MAT['note_amber'])
    parts += plant('Office_Guest_Plant', 0.88, 3.18, 0.55, MAT['pot'],
                   MAT['leaf_teal'], seed=9, z0=0.0)
    parts.append(box('Office_Cabinet', (0.45, 0.55, 0.72), (0.62, 4.86, 0.36),
                     MAT['baseboard'], bevel=0.006))
    parts += plant('Office_Cab_Plant', 0.62, 4.86, 0.42, MAT['pot'],
                   MAT['leaf_teal'], seed=8, z0=0.72)
    return join(parts, 'Office_Room')


def build_conference():
    parts = []
    # glass front around a door, a short glass return, then the shared wall
    parts += glass_wall('Conf_Glass_F1', (CONF_X0, CONF_Y0), (1.65, CONF_Y0))
    parts += glass_wall('Conf_Glass_F2', (2.55, CONF_Y0), (CONF_X1, CONF_Y0))
    parts += glass_wall('Conf_Glass_L', (CONF_X0, CONF_Y0), (CONF_X0, OFF_Y0))
    # one wide window across the exterior wall
    parts += window_run('Conf_Win', (1.26, HY), (6.10, HY), 1.05, 2.45)

    tx, ty = 3.90, 3.62
    parts.append(box('Conf_Table_Top', (2.60, 1.10, 0.06), (tx, ty, 0.74),
                     MAT['desktop'], bevel=0.008, seg=1))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box(f'Conf_Table_Leg{sx}{sy}', (0.06, 0.06, 0.71),
                             (tx + sx * 1.15, ty + sy * 0.42, 0.355),
                             MAT['metal_dark'], bevel=0.004))
    # four chairs, two on each side, two of them occupied
    seats = [
        (3.25, 2.92, D(180), dict(skin=1, hair=1, shirt='shirt_snow',
                                  trousers='trouser_slate')),
        (4.55, 2.92, D(180), None),
        (3.25, 4.32, 0, None),
        (4.55, 4.32, 0, dict(skin=0, hair=2, shirt='shirt_frost',
                             trousers='trouser_dark', hair_style='bun')),
    ]
    for i, (cx, cy, rz, who) in enumerate(seats):
        parts += chair(f'Conf_Chair{i}', cx, cy, rz)
        if who:
            wp = person(f'Person_Conf{i}', cx, cy, rz, pose='sit', **who)
            set_origin(join(wp, f'Person_Conf{i}'), (cx, cy, 0))

    # a plant in the corner, a laptop and two mugs left from the meeting
    parts += plant('Conf_Plant', 5.80, 4.65, 1.1, MAT['pot_frost'],
                   MAT['leaf_teal'], seed=13)
    parts.append(box('Conf_Laptop_Base', (0.34, 0.24, 0.02),
                     (4.30, 3.52, 0.78), MAT['metal_dark'], bevel=0.004))
    parts.append(box('Conf_Laptop_Lid', (0.34, 0.02, 0.22),
                     (4.30, 3.40, 0.88), MAT['metal_dark'], bevel=0.004,
                     rot=(D(18), 0, 0)))
    parts.append(box('Conf_Laptop_Screen', (0.30, 0.006, 0.18),
                     (4.30, 3.407, 0.885), MAT['screen'], bevel=0.002,
                     rot=(D(18), 0, 0)))
    parts.append(cyl('Conf_Mug0', 0.035, 0.09, (3.45, 3.35, 0.815),
                     MAT['pot'], segs=10))
    parts.append(cyl('Conf_Mug1', 0.035, 0.09, (3.95, 3.30, 0.815),
                     MAT['pot_frost'], segs=10))
    # the laptop has its own line to Neuman
    PORTS.append(Vector((4.30, 3.42, 1.00)))
    return join(parts, 'Conference')


# ---------------------------------------------------------------- coffee
def build_coffee():
    parts = []
    x0, x1 = -HX + 0.05, -HX + 0.85
    y0, y1 = 0.90, 3.85
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    parts.append(box('Coffee_Base', (x1 - x0, y1 - y0, 0.92), (cx, cy, 0.46),
                     MAT['baseboard'], bevel=0.006, seg=1))
    parts.append(box('Coffee_Top', (x1 - x0 + 0.10, y1 - y0 + 0.08, 0.06),
                     (cx + 0.05, cy, 0.95), MAT['desktop'], bevel=0.006))
    parts.append(box('Coffee_Splash', (0.03, y1 - y0, 0.42),
                     (x0 + 0.01, cy, 1.19), MAT['metal_dark'], bevel=0.003))

    # the toaster, turned so its front faces the room
    mx, my = -6.02, 1.95
    parts.append(box('Coffee_Toaster', (0.44, 0.42, 0.40), (mx, my, 1.18),
                     MAT['metal_dark'], bevel=0.02, seg=2))
    parts.append(box('Coffee_Toaster_Face', (0.01, 0.28, 0.16),
                     (mx + 0.225, my, 1.22), MAT['screen'], bevel=0.003))
    for i, sy in enumerate((-0.08, 0.08)):
        parts.append(box(f'Coffee_Toaster_Slot{i}', (0.24, 0.03, 0.012),
                         (mx, my + sy, 1.386), MAT['dark'], bevel=0.0))
    parts.append(box('Coffee_Toaster_Knob', (0.02, 0.03, 0.03),
                     (mx + 0.225, my - 0.13, 1.10), MAT['metal'],
                     bevel=0.003))

    # the coffee pot, cups and a little plant
    px, py = -5.64, 3.10
    parts.append(cyl('Coffee_Pot', 0.085, 0.22, (px, py, 1.09),
                     MAT['rack_glass'], segs=14))
    parts.append(cyl('Coffee_Pot_Fill', 0.068, 0.15, (px, py, 1.05),
                     MAT['soil'], segs=12))
    parts.append(cyl('Coffee_Pot_Lid', 0.078, 0.03, (px, py, 1.215),
                     MAT['metal'], segs=12))
    parts.append(box('Coffee_Pot_Handle', (0.035, 0.09, 0.13),
                     (px + 0.105, py, 1.10), MAT['metal'], bevel=0.006))
    for i in range(2):
        parts.append(cyl(f'Coffee_Cup{i}', 0.045, 0.075,
                         (-5.72, 2.60 + i * 0.11, 1.017), MAT['pot'], segs=10))
    parts += plant('Coffee_Plant', -6.02, 3.62, 0.6, MAT['pot'], MAT['leaf'],
                   seed=17, z0=0.98)

    # a small bowl of apples and oranges between toaster and pot
    bx, by = -6.00, 2.55
    parts.append(cyl('Fruit_Bowl', 0.09, 0.08, (bx, by, 1.02),
                     MAT['pot_frost'], segs=16, r2=0.14))
    parts.append(cyl('Fruit_Bowl_Rim', 0.14, 0.012, (bx, by, 1.062),
                     MAT['pot_frost'], segs=16, r2=0.15))
    for i, (fx, fy, r, fm) in enumerate([
            (-0.045, -0.035, 0.045, 'note_amber'),
            (0.050, -0.020, 0.042, 'apple'),
            (0.005, 0.055, 0.044, 'note_amber'),
            (-0.030, 0.010, 0.042, 'apple'),
            (0.060, 0.050, 0.040, 'note_amber')]):
        parts.append(ball(f'Fruit_{i}', r, (bx + fx, by + fy, 1.07 + r * 0.35),
                          MAT[fm], sub=1))

    # menu board on the wall, clear of the window above the sink run
    parts.append(box('Coffee_Menu', (0.03, 1.45, 0.78),
                     (-HX + 0.02, 2.10, 1.95), MAT['dark'], bevel=0.004))
    for i in range(3):
        parts.append(box(f'Coffee_MenuLine{i}', (0.012, 0.78, 0.025),
                         (-HX + 0.045, 2.00, 2.15 - i * 0.16),
                         MAT['neon_soft'], bevel=0.0))
    parts.append(box('Coffee_MenuMark', (0.012, 0.24, 0.05),
                     (-HX + 0.045, 2.35, 1.70), MAT['accent'], bevel=0.0))

    # the coffee guy, close enough to reach the pot; his free arm is split
    cpx, cpy, crz = -5.18, 3.30, D(265)
    arms = {}
    who = person('Person_Coffee', cpx, cpy, crz, skin=0, hair=1,
                 shirt='shirt_deep', trousers='trouser_dark', pose='stand',
                 holding='mug', arms_out=arms, arms_sides=('L',))
    coffee_body = join(who, 'Person_Coffee')
    set_origin(coffee_body, (cpx, cpy, 0))
    split_arm('Person_Coffee_ArmL', arms['L'], cpx, cpy, crz, 0.24, 0.0, 1.41,
              body=coffee_body)
    return join(parts, 'Coffee_Point')


# ---------------------------------------------------------------- lounge
def armchair(name, cx, cy, rz, accent=None):
    accent = accent or MAT['accent']
    parts = []

    def P(x, y):
        c, s = math.cos(rz), math.sin(rz)
        return (cx + x * c - y * s, cy + x * s + y * c)

    parts.append(box(name + '_Base', (0.78, 0.72, 0.24), (cx, cy, 0.22),
                     MAT['upholstery'], bevel=0.03, seg=2, rot=(0, 0, rz)))
    parts.append(box(name + '_Seat', (0.60, 0.58, 0.13), (cx, cy, 0.39),
                     MAT['cushion'], bevel=0.04, seg=2, rot=(0, 0, rz)))
    bx, by = P(0, 0.29)
    parts.append(box(name + '_Back', (0.68, 0.16, 0.42), (bx, by, 0.55),
                     MAT['cushion'], bevel=0.04, seg=2, rot=(D(-8), 0, rz)))
    for sx in (-1, 1):
        px, py = P(sx * 0.35, 0.02)
        parts.append(box(name + f'_Arm{sx}', (0.10, 0.70, 0.26),
                         (px, py, 0.40), MAT['upholstery'], bevel=0.03, seg=2,
                         rot=(0, 0, rz)))
    px, py = P(-0.15, 0.18)
    parts.append(box(name + '_Cushion', (0.29, 0.10, 0.29), (px, py, 0.55),
                     accent, bevel=0.035, seg=2, rot=(D(-14), 0, rz)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = P(sx * 0.32, sy * 0.29)
            parts.append(cyl(name + f'_Foot{sx}{sy}', 0.018, 0.10, (px, py, 0.05),
                             MAT['metal_dark'], segs=8))
    return parts


def sofa(name, cx, cy, rz, length=2.40):
    parts = []

    def P(x, y):
        c, s = math.cos(rz), math.sin(rz)
        return (cx + x * c - y * s, cy + x * s + y * c)

    parts.append(box(name + '_Base', (length, 0.92, 0.26), (cx, cy, 0.19),
                     MAT['upholstery'], bevel=0.03, seg=2, rot=(0, 0, rz)))
    for i in (-1, 1):
        px, py = P(i * length / 4, -0.02)
        parts.append(box(f'{name}_Seat{i}', (length / 2 - 0.12, 0.60, 0.14),
                         (px, py, 0.39), MAT['cushion'], bevel=0.03, seg=2,
                         rot=(0, 0, rz)))
    bx, by = P(0, 0.36)
    parts.append(box(name + '_Back', (length, 0.20, 0.52), (bx, by, 0.48),
                     MAT['upholstery'], bevel=0.03, seg=2,
                     rot=(D(-8), 0, rz)))
    for i in (-1, 1):
        px, py = P(i * length / 4, 0.25)
        parts.append(box(f'{name}_BCushion{i}', (length / 2 - 0.12, 0.14, 0.34),
                         (px, py, 0.51), MAT['cushion'], bevel=0.035, seg=2,
                         rot=(D(-11), 0, rz)))
    for sx in (-1, 1):
        px, py = P(sx * (length / 2 - 0.10), 0.0)
        parts.append(box(f'{name}_Arm{sx}', (0.20, 0.92, 0.44),
                         (px, py, 0.32), MAT['upholstery'], bevel=0.03, seg=2,
                         rot=(0, 0, rz)))
    px, py = P(-length / 4, 0.18)
    parts.append(box(name + '_Accent', (0.30, 0.11, 0.30), (px, py, 0.51),
                     MAT['accent'], bevel=0.03, seg=2, rot=(D(-14), 0, rz)))
    px, py = P(length / 2 - 0.10, 0.0)
    parts.append(box(name + '_Throw', (0.22, 0.56, 0.05), (px, py, 0.56),
                     MAT['note_amber'], bevel=0.012, rot=(D(4), 0, rz)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = P(sx * (length / 2 - 0.12), sy * 0.36)
            parts.append(cyl(f'{name}_Foot{sx}{sy}', 0.020, 0.12, (px, py, 0.06),
                             MAT['metal_dark'], segs=8))
    return parts


def build_lounge():
    parts = []
    rcx, rcy = 4.00, -3.05
    parts.append(box('Rug_Trim', (3.90, 3.30, 0.014), (rcx, rcy, 0.007),
                     MAT['rug_trim'], bevel=0.008))
    parts.append(box('Rug', (3.70, 3.10, 0.014), (rcx, rcy, 0.016),
                     MAT['rug'], bevel=0.008))

    # sofa facing the open edge, two chairs turned in towards it
    parts += sofa('Sofa', 4.00, -1.85, 0)
    parts += armchair('Lounge_A', 2.70, -3.55, D(155))
    parts += armchair('Lounge_B', 5.30, -3.55, D(205), accent=MAT['note_amber'])

    parts.append(cyl('Table_Top', 0.50, 0.045, (4.00, -3.05, 0.40),
                     MAT['desktop'], segs=28, bevel=0.005))
    parts.append(cyl('Table_Stem', 0.075, 0.37, (4.00, -3.05, 0.185),
                     MAT['metal_dark'], segs=12))
    parts.append(cyl('Table_Foot', 0.26, 0.025, (4.00, -3.05, 0.013),
                     MAT['metal_dark'], segs=16))
    parts.append(box('Table_Book', (0.26, 0.34, 0.04), (3.90, -2.98, 0.445),
                     MAT['fabric_soft'], bevel=0.006, rot=(0, 0, D(22))))
    parts.append(cyl('Table_Mug', 0.034, 0.09, (4.22, -3.16, 0.468),
                     MAT['pot'], segs=10))
    parts += plant('Table_Plant', 3.86, -3.22, 0.52, MAT['pot_frost'],
                   MAT['leaf'], seed=21, z0=0.423)

    # a console behind the sofa, a side table and the floor lamp
    parts.append(box('Console', (2.20, 0.35, 0.66), (4.00, -1.15, 0.33),
                     MAT['baseboard'], bevel=0.006))
    parts.append(box('Console_Top', (2.26, 0.39, 0.04), (4.00, -1.15, 0.68),
                     MAT['desktop'], bevel=0.005))
    parts.append(box('Console_Book0', (0.22, 0.26, 0.05), (3.35, -1.15, 0.725),
                     MAT['accent'], bevel=0.004, rot=(0, 0, D(8))))
    parts.append(box('Console_Book1', (0.20, 0.24, 0.045), (3.34, -1.15, 0.772),
                     MAT['fabric_soft'], bevel=0.004, rot=(0, 0, D(-6))))
    parts += plant('Console_Plant', 4.62, -1.14, 0.62, MAT['pot'], MAT['leaf'],
                   seed=23, z0=0.70)

    parts.append(box('Side_Table', (0.44, 0.44, 0.06), (2.52, -1.85, 0.48),
                     MAT['desktop'], bevel=0.006))
    parts.append(cyl('Side_Table_Stem', 0.035, 0.45, (2.52, -1.85, 0.225),
                     MAT['metal_dark'], segs=8))
    parts.append(cyl('Side_Table_Foot', 0.16, 0.025, (2.52, -1.85, 0.013),
                     MAT['metal_dark'], segs=12))
    parts.append(cyl('Side_Mug', 0.034, 0.09, (2.60, -1.78, 0.515),
                     MAT['pot_frost'], segs=10))

    parts.append(cyl('FloorLamp_Base', 0.14, 0.03, (5.85, -1.55, 0.015),
                     MAT['metal_dark'], segs=16))
    parts.append(cyl('FloorLamp_Pole', 0.013, 1.55, (5.85, -1.55, 0.79),
                     MAT['metal'], segs=10))
    parts.append(cyl('FloorLamp_Shade', 0.16, 0.22, (5.85, -1.55, 1.62),
                     MAT['pot'], segs=18, r2=0.10))
    parts.append(cyl('FloorLamp_Glow', 0.145, 0.006, (5.85, -1.55, 1.515),
                     MAT['neon_soft'], segs=18))

    parts += tall_plant('Lounge_Plant', 5.85, -4.75, h=1.35, seed=11)
    parts += tall_plant('East_Plant', 5.95, 0.55, h=1.25, seed=14)

    # one of the pod's people has moved over to the sofa
    leg_parts = []
    who = person('Person_Couch', 4.55, -1.95, 0, skin=1, hair=1,
                 shirt='shirt_frost', trousers='trouser_dark', pose='couch',
                 extras=leg_parts)
    set_origin(join(who, 'Person_Couch'), (4.55, -1.95, 0))
    leg_ob = join(leg_parts, 'Person_Couch_Leg')
    set_origin(leg_ob, (4.65, -1.93, CHAIR_LIFT + 0.10))

    # doormat at the entrance
    parts.append(box('Mat_Trim', (0.98, 1.20, 0.012), (-6.02, -3.85, 0.006),
                     MAT['accent'], bevel=0.005))
    parts.append(box('Mat', (0.86, 1.08, 0.014), (-6.02, -3.85, 0.016),
                     MAT['fabric_soft'], bevel=0.005))
    return join(parts, 'Lounge')


# ---------------------------------------------------------------- wall
def build_wall_details():
    parts = []
    # sideboard and whiteboard along the left wall
    parts.append(box('Sideboard', (0.52, 2.80, 0.78), (-HX + 0.30, -1.00, 0.39),
                     MAT['baseboard'], bevel=0.006, seg=1))
    parts.append(box('Sideboard_Top', (0.56, 2.84, 0.04), (-HX + 0.30, -1.00, 0.80),
                     MAT['desktop'], bevel=0.005))
    parts.append(box('Sideboard_Book0', (0.22, 0.30, 0.06),
                     (-HX + 0.30, -1.62, 0.85), MAT['accent'], bevel=0.004))
    parts.append(box('Sideboard_Book1', (0.20, 0.28, 0.05),
                     (-HX + 0.30, -1.60, 0.905), MAT['fabric_soft'], bevel=0.004))
    parts += plant('Side_Plant', -HX + 0.32, -0.10, 0.7, MAT['pot'],
                   MAT['leaf_teal'], seed=5, z0=0.82)

    parts.append(box('Board_Frame', (0.03, 2.30, 0.94), (-HX + 0.015, -1.05, 1.84),
                     MAT['metal_dark'], bevel=0.005))
    parts.append(box('Board_Face', (0.01, 2.20, 0.84), (-HX + 0.032, -1.05, 1.84),
                     MAT['paper'], bevel=0.003))
    for name, m, yy, zz in (('Board_Note0', MAT['note_amber'], -1.72, 2.02),
                            ('Board_Note1', MAT['note_frost'], -1.42, 2.00),
                            ('Board_Note2', MAT['note_green'], -0.42, 1.62)):
        parts.append(box(name, (0.006, 0.13, 0.13), (-HX + 0.042, yy, zz), m,
                         bevel=0.002))
    parts.append(box('Board_Line0', (0.004, 0.66, 0.016),
                     (-HX + 0.042, -1.00, 1.92), MAT['metal_dark'], bevel=0.0))
    parts.append(box('Board_Line1', (0.004, 0.42, 0.016),
                     (-HX + 0.042, -1.10, 1.83), MAT['metal_dark'], bevel=0.0))

    # clock and a window beside the entrance
    parts.append(cyl('Clock_Face', 0.15, 0.03, (-HX + 0.045, -2.66, 2.30),
                     MAT['paper'], segs=24, rot=(0, D(90), 0)))
    parts.append(cyl('Clock_Rim', 0.165, 0.02, (-HX + 0.025, -2.66, 2.30),
                     MAT['metal_dark'], segs=24, rot=(0, D(90), 0)))
    parts.append(box('Clock_HandH', (0.012, 0.075, 0.012),
                     (-HX + 0.062, -2.70, 2.32), MAT['dark'], bevel=0.0,
                     rot=(D(28), 0, 0)))
    parts.append(box('Clock_HandM', (0.010, 0.105, 0.009),
                     (-HX + 0.064, -2.66, 2.34), MAT['dark'], bevel=0.0,
                     rot=(D(-40), 0, 0)))

    # a window above the boards, one beside the door, and one by Neuman
    parts += window_run('Left_Win_Front', (-HX, -3.15), (-HX, -2.52), 1.05, 2.05)
    parts += window_run('Left_Win_High', (-HX, -3.18), (-HX, 2.88), 2.60, 3.08)
    parts += window_run('Left_Win_Server', (-HX, 3.15), (-HX, 3.92), 1.15, 2.30)
    parts += window_run('Back_Win', (-5.20, HY), (-3.10, HY), 1.10, 2.40)

    return join(parts, 'Wall_Details')


# ---------------------------------------------------------------- network
def dashes_3d(p0, p1, dash=0.14, gap=0.085):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    if L < 1e-6:
        return []
    u = d / L
    out = []
    t = 0.0
    while t < L - 0.02:
        seg = min(dash, L - t)
        out.append((p0 + u * (t + seg / 2), u, seg))
        t += dash + gap
    return out


def build_network():
    """Every port rises to the ceiling, joins a bus, and drops into Neuman.

    The pod's four desks share one ceiling bus; the private office keeps its
    own run along the back wall. Both come down onto the same rack.
    """
    bus_y = 1.15
    hero_x, drop_y = NEUMAN_X, NEUMAN_Y
    top = WALL_H - 0.25
    pod = [p for p in PORTS if p.y < 2.4]
    back = [p for p in PORTS if p.y >= 2.4]

    segs = []
    routes = []
    for port in pod:
        segs.append(((port.x, port.y, port.z), (port.x, port.y, top)))
        segs.append(((port.x, port.y, top), (port.x, bus_y, top)))
        routes.append([(port.x, port.y, port.z), (port.x, port.y, top),
                       (port.x, bus_y, top), (hero_x, bus_y, top),
                       (hero_x, drop_y, top), (hero_x, drop_y, 2.14)])
    if pod:
        x_end = max(p.x for p in pod)
        segs.append(((x_end, bus_y, top), (hero_x, bus_y, top)))
        segs.append(((hero_x, bus_y, top), (hero_x, drop_y, top)))
    # the office line and the conference laptop share one back-wall run:
    # the laptop's line runs west and joins the office riser, then both
    # continue to Neuman as a single line
    back.sort(key=lambda p: p.x)
    if back:
        lane = 4.72
        first = back[0]
        segs.append(((first.x, first.y, first.z), (first.x, first.y, top)))
        if abs(first.y - lane) > 1e-3:
            segs.append(((first.x, first.y, top), (first.x, lane, top)))
        segs.append(((first.x, lane, top), (hero_x, lane, top)))
        segs.append(((hero_x, lane, top), (hero_x, drop_y, top)))
        routes.append([(first.x, first.y, first.z), (first.x, first.y, top),
                       (first.x, lane, top), (hero_x, lane, top),
                       (hero_x, drop_y, top), (hero_x, drop_y, 2.14)])
        for port in back[1:]:
            segs.append(((port.x, port.y, port.z), (port.x, port.y, top)))
            segs.append(((port.x, port.y, top), (port.x, lane, top)))
            segs.append(((port.x, lane, top), (first.x, lane, top)))
            routes.append([(port.x, port.y, port.z), (port.x, port.y, top),
                           (port.x, lane, top), (first.x, lane, top),
                           (hero_x, lane, top), (hero_x, drop_y, top),
                           (hero_x, drop_y, 2.14)])
    # every line meets at one point and goes down as a single drop
    segs.append(((hero_x, drop_y, top), (hero_x, drop_y, 2.14)))

    dash_specs = []
    for a, b in segs:
        for center, u, length in dashes_3d(a, b):
            dash_specs.append((center, u, length, 0.05, 0.016))
    line_ob = bars('Net_Lines', dash_specs, MAT['data_line'])

    # the site's glider, inlaid where the bundle comes down
    glyph = []
    cell, gutter = 0.10, 0.02
    pitch = cell + gutter
    for gx, gy in [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)]:
        glyph.append(((cell, cell, 0.012),
                      (hero_x + (gx - 1) * pitch,
                       drop_y - (gy - 1) * pitch, 2.19)))
    glyph_ob = boxes('Neuman_Glyph', glyph, MAT['data_line'])
    global ROUTES
    ROUTES = routes
    return line_ob, glyph_ob


# ---------------------------------------------------------------- animation
def point_on_route(points, u):
    pts = [Vector(p) for p in points]
    segs = []
    total = 0.0
    for a, b in zip(pts, pts[1:]):
        L = (b - a).length
        if L > 1e-6:
            segs.append((a, b, L))
            total += L
    if not segs:
        return pts[0]
    d = max(0.0, min(1.0, u)) * total
    for a, b, L in segs:
        if d <= L:
            return a + (b - a) * (d / L)
        d -= L
    return segs[-1][1]


def build_animation():
    """Keyframe the office's idle life: typing, talking, the sofa leg, the
    coffee reach, and the light running along the lines to Neuman."""
    sc = bpy.context.scene
    fps, end = 30, 601          # 20 seconds, last frame matches the first
    sc.render.fps = fps
    sc.frame_start, sc.frame_end = 1, end

    def key_rot(name, axis, fn, step=10):
        ob = bpy.data.objects.get(name)
        if ob is None:
            print('animation target missing:', name)
            return
        ob.rotation_mode = 'XYZ'
        for f in range(1, end + 1, step):
            t = (f - 1) / fps
            ob.rotation_euler[axis] = fn(t)
            ob.keyframe_insert('rotation_euler', index=axis, frame=f)

    def sine(amp, period, phase=0.0):
        return lambda t: amp * math.sin(math.tau * t / period + phase)

    # idle: a slow shift of weight, plus a breathing lean; the conference
    # pair move more, the way people do when they are talking
    people = {
        'Person_Pod1': (0.018, 10.0, 0.4, 0.006, 5.0, 0.0),
        'Person_Pod2': (0.016, 10.0, 2.2, 0.006, 5.0, 1.1),
        'Person_Pod3': (0.018, 10.0, 4.1, 0.006, 5.0, 2.4),
        'Person_Office': (0.020, 10.0, 1.3, 0.008, 5.0, 0.6),
        'Person_Couch': (0.012, 10.0, 3.0, 0.005, 5.0, 1.7),
        'Person_Coffee': (0.010, 10.0, 0.8, 0.004, 5.0, 2.9),
        'Person_Conf0': (0.070, 5.0, 0.0, 0.030, 10.0, 0.2),
        'Person_Conf3': (0.060, 5.0, 2.5, 0.026, 10.0, 1.6),
    }
    for name, (ya, yp, yph, ta, tp, tph) in people.items():
        key_rot(name, 2, sine(ya, yp, yph), step=10)
        key_rot(name, 0, sine(ta, tp, tph), step=10)

    # typing: the forearms rock up and down, left and right out of phase
    typing = {'Person_Pod1': 0.0, 'Person_Pod2': 1.0,
              'Person_Pod3': 2.0, 'Person_Office': 2.6}
    for name, off in typing.items():
        for side, phase in (('L', 0.0), ('R', math.pi * 0.9)):
            key_rot(f'{name}_Arm{side}_Pivot', 0,
                    sine(0.09, 1.25, phase + off), step=2)

    # the crossed leg taps
    key_rot('Person_Couch_Leg', 0, sine(0.10, 1.25, 0.7), step=2)

    # the coffee arm: rest, reach to the pot, hold, come back; twice
    arm = bpy.data.objects.get('Person_Coffee_ArmL_Pivot')
    if arm:
        arm.rotation_mode = 'XYZ'
        for start in (0.0, 10.0):
            for t, ang in ((0.0, 0.0), (1.8, 0.0), (3.2, -1.15),
                           (4.4, -1.15), (5.8, 0.0), (10.0, 0.0)):
                f = int(round((start + t) * fps)) + 1
                if f > end:
                    continue
                arm.rotation_euler.x = ang
                arm.keyframe_insert('rotation_euler', index=0, frame=f)

    # light running along each route to Neuman, pulsing as it goes
    for i, route in enumerate(ROUTES):
        first = Vector(route[0])
        pulse = ball(f'Pulse_{i}', 0.05, tuple(first), MAT['neon'], sub=2)
        set_origin(pulse, first)
        phase = i / max(1, len(ROUTES))
        for f in range(1, end + 1, 4):
            t = (f - 1) / fps
            u = ((t / 10.0) + phase) % 1.0
            pulse.location = point_on_route(route, u)
            pulse.keyframe_insert('location', frame=f)
            s = 0.75 + 0.30 * math.sin(math.tau * t / 2.5 + phase * math.tau)
            pulse.scale = (s, s, s)
            pulse.keyframe_insert('scale', frame=f)


# ---------------------------------------------------------------- build
def clear_all():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                  bpy.data.cameras, bpy.data.curves, bpy.data.worlds):
        for item in list(block):
            block.remove(item)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True,
                           do_recursive=True)


def build(bg='light'):
    global COLL, PORTS, ROUTES
    clear_all()
    PORTS = []
    ROUTES = []
    SCENE = bpy.context.scene
    SCENE.unit_settings.system = 'METRIC'
    COLL = bpy.data.collections.new('Office')
    SCENE.collection.children.link(COLL)
    make_mats()

    build_room()
    build_racks()
    build_pod()
    build_office_room()
    build_conference()
    build_coffee()
    build_lounge()
    build_wall_details()
    build_network()
    build_animation()
    setup_world_and_camera(bg)
    return bpy.data.objects


# ---------------------------------------------------------------- light
def area(name, loc, size, energy, color, target=(0, 0, 1.0)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.color = hexlin(color)[:3]
    ld.shape = 'SQUARE'
    ld.size = size
    ob = bpy.data.objects.new(name, ld)
    link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob


LOOKS = {
    'light': {
        'world': ('#e9edf3', 0.12),
        'ground': True,
        'exposure': 0.72,
        'ortho': 17.8,
        'camera_z': 1.30,
        'lights': {
            'Key': ((10.0, -8.0, 12.0), 5.0, 4200, '#ffffff'),
            'Fill': ((-14.0, -10.0, 6.0), 10.0, 340, '#c5e2ea'),
            'Rim': ((-6.0, 12.0, 8.0), 6.0, 1500, '#88c0d0'),
            'Top': ((0.5, -3.0, 13.0), 8.0, 260, '#f0f8fa'),
            'Bounce': ((4.0, -13.0, 1.5), 8.0, 150, '#d8dee9'),
        },
    },
    'dark': {
        'world': ('#1e232b', 0.38),
        'ground': False,
        'exposure': 0.92,
        'ortho': 18.4,
        'camera_z': 1.28,
        'lights': {
            'Key': ((8.0, -9.0, 13.0), 6.0, 2600, '#ffffff'),
            'Fill': ((-14.0, -11.0, 6.0), 9.0, 800, '#dbe7f2'),
            'Rim': ((-7.0, 12.0, 8.0), 5.0, 4200, '#88c0d0'),
            'Top': ((0.0, -3.0, 12.0), 7.0, 420, '#c5e2ea'),
            'Bounce': ((4.0, -13.0, 1.5), 7.0, 220, '#81a1c1'),
        },
    },
}


def set_look(kind='light'):
    spec = LOOKS[kind]
    sc = bpy.context.scene
    world = sc.world
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = hexlin(spec['world'][0])
    bg.inputs[1].default_value = spec['world'][1]

    ground = bpy.data.objects.get('Ground')
    if ground:
        ground.hide_render = not spec['ground']

    for name, (loc, size, energy, color) in spec['lights'].items():
        ob = bpy.data.objects.get(name)
        if ob is None or ob.type != 'LIGHT':
            continue
        ob.location = loc
        ob.data.size = size
        ob.data.energy = energy
        ob.data.color = hexlin(color)[:3]
        ob.rotation_euler = (Vector((0, 0, 1.0)) - Vector(loc)).to_track_quat(
            '-Z', 'Y').to_euler()

    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    sc.view_settings.exposure = spec['exposure']

    cam = sc.camera
    if cam:
        cam.data.ortho_scale = spec['ortho']
        target = Vector((0.0, 0.0, spec['camera_z']))
        # true isometric: equal steps in x, y and z
        direction = Vector((1.0, -1.0, 1.0)).normalized()
        cam.location = target + direction * 38
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    return sc


def setup_world_and_camera(bg='light'):
    SCENE = bpy.context.scene
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = hexlin('#e9edf3')
    SCENE.world = world

    if bg == 'light':
        ground = box('Ground', (60, 60, 0.04), (0, 0, -0.32),
                     MAT['wall'], bevel=0.0)
        ground.data.materials.clear()
        gm = bpy.data.materials.new('ground')
        gm.use_nodes = True
        gb = gm.node_tree.nodes.get('Principled BSDF')
        gb.inputs['Base Color'].default_value = hexlin('#f3f5f8')
        gb.inputs['Roughness'].default_value = 0.95
        # a touch of self-light keeps the backdrop even across the frame
        for key in ('Emission Color', 'Emission'):
            if key in gb.inputs:
                gb.inputs[key].default_value = hexlin('#f3f5f8')
                break
        if 'Emission Strength' in gb.inputs:
            gb.inputs['Emission Strength'].default_value = 0.22
        ground.data.materials.append(gm)
        # A studio floor for renders, not furniture: hide it from the viewport
        # (the eye toggle, not the render toggle) so opening the file frames
        # the room.
        ground.hide_set(True)

    cam = bpy.data.cameras.new('Camera')
    cam.type = 'ORTHO'
    cam.ortho_scale = 18.6
    ob = bpy.data.objects.new('Camera', cam)
    link(ob)
    SCENE.camera = ob

    area('Key', (10.0, -8.0, 12.0), 5.0, 1, '#ffffff')
    area('Fill', (-14.0, -10.0, 6.0), 10.0, 1, '#c5e2ea')
    area('Rim', (-6.0, 12.0, 8.0), 6.0, 1, '#88c0d0')
    area('Top', (0.5, -3.0, 13.0), 8.0, 1, '#f0f8fa')
    area('Bounce', (4.0, -13.0, 1.5), 8.0, 1, '#d8dee9')

    SCENE.render.engine = 'BLENDER_EEVEE'
    SCENE.render.film_transparent = False
    SCENE.render.resolution_x = 2000
    SCENE.render.resolution_y = 2000
    SCENE.render.resolution_percentage = 100
    SCENE.render.image_settings.file_format = 'PNG'
    SCENE.render.image_settings.color_mode = 'RGB'
    try:
        SCENE.eevee.taa_render_samples = 128
    except Exception:
        pass
    try:
        SCENE.eevee.use_raytracing = True
        SCENE.eevee.ray_tracing_method = 'SCREEN'
        SCENE.eevee.shadow_ray_count = 2
        SCENE.eevee.shadow_step_count = 8
    except Exception as e:
        print('eevee:', e)

    set_look('dark' if bg == 'dark' else 'light')
    return ob
