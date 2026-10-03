"""The things that float in the emails' heroes, rendered for real in Cycles
with a transparent background, lit the way the football is (scripts/mail/
ball.py): a soft white key from the upper left, the site's violet behind.

    python scripts/mail/objects.py public/brand/mail [names...] [--size 640] [--samples 64]

Names: whistle, stopwatch, cards, key, padlock, gift, envelope, board.
Each is built from primitives here, so nothing is downloaded or licensed.
"""
import math
import sys

import bpy  # first: bmesh comes with it
from mathutils import Euler, Vector

args = sys.argv[1:]
OUT = args[0] if args else '.'
names = [a for a in args[1:] if not a.startswith('--') and not a.isdigit()]
SIZE = int(args[args.index('--size') + 1]) if '--size' in args else 640
SAMPLES = int(args[args.index('--samples') + 1]) if '--samples' in args else 64


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.render.film_transparent = True
    # Standard, not AgX: these are colour-coded things (a red card, a yellow
    # one, the site's violet), and AgX's desaturation washed them pastel.
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = -0.35
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    # Never seen (the film is transparent), but metal reflects it: a lit
    # studio grey, so chrome reads as chrome, not navy.
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.40, 0.52, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    return sc


def mat(name, color, rough=0.35, metal=0.0, coat=0.4, emit=None, estr=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = 0.1
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = estr
    return m


def obj_last():
    return bpy.context.active_object


def smooth(o, bevel=0.0, seg=4):
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = seg
    bpy.ops.object.shade_smooth()
    return o


def put(o, m):
    o.data.materials.append(m)
    return o


def group(objs, rot):
    """Parent everything to an empty and turn it to its three-quarter view."""
    e = bpy.data.objects.new('g', None)
    bpy.context.scene.collection.objects.link(e)
    for o in objs:
        o.parent = e
    e.rotation_euler = Euler([math.radians(a) for a in rot])
    return e


def frame_and_light(scale):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = scale
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.location = (0, -12, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)

    def area(n, loc, p, col, size):
        d = bpy.data.lights.new(n, 'AREA')
        d.energy, d.color, d.size = p, col, size
        o = bpy.data.objects.new(n, d)
        sc.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    area('key', (-3.4, -4.2, 3.6), 1100, (1.0, 0.98, 0.96), 3.2)
    area('rim', (3.6, 3.2, 1.8), 1700, (0.62, 0.48, 1.0), 2.4)
    area('fill', (2.8, -4.4, -2.0), 200, (0.75, 0.7, 1.0), 4.0)
    area('top', (0.0, 0.6, 5.2), 320, (1.0, 1.0, 1.0), 2.2)


CHROME = lambda: mat('chrome', (0.9, 0.9, 0.95), 0.12, 1.0, 0.2)
BRASS = lambda: mat('brass', (1.0, 0.76, 0.36), 0.22, 1.0, 0.3)
VIOLET = lambda: mat('violet', (0.30, 0.20, 0.95), 0.3, 0.0, 0.7)
DARK = lambda: mat('dark', (0.015, 0.015, 0.02), 0.4, 0.0, 0.5)


def cyl(r, d, loc=(0, 0, 0), rot=(0, 0, 0), v=96):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=loc, rotation=rot, vertices=v)
    return obj_last()


def box(sx, sy, sz, loc=(0, 0, 0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = obj_last()
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    return o


def torus(R, r, loc=(0, 0, 0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=96, minor_segments=24)
    return obj_last()


def sphere(r, loc=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=64, ring_count=32)
    return obj_last()


# ------------------------------------------------------------------ objects
def whistle():
    ch, dk = CHROME(), DARK()
    body = put(smooth(cyl(0.62, 0.9, rot=(math.radians(90), 0, 0)), 0.18, 6), ch)
    mouth = put(smooth(box(1.3, 0.62, 0.36, loc=(-1.0, 0, 0.36)), 0.1), ch)
    slot = put(box(0.3, 0.64, 0.14, loc=(-0.25, 0, 0.62)), dk)
    ring = put(smooth(torus(0.3, 0.07, loc=(0.62, 0, -0.52), rot=(math.radians(90), 0, 0))), ch)
    cord = put(smooth(torus(0.55, 0.045, loc=(1.05, 0, -1.0), rot=(math.radians(80), math.radians(30), 0))), VIOLET())
    group([body, mouth, slot, ring, cord], (12, -18, 22))
    frame_and_light(3.6)


def stopwatch():
    ch = CHROME()
    face = mat('face', (0.95, 0.95, 0.97), 0.3)
    case = put(smooth(cyl(1.0, 0.32, rot=(math.radians(90), 0, 0))), ch)
    dial = put(cyl(0.86, 0.34, rot=(math.radians(90), 0, 0)), face)
    rim = put(smooth(torus(0.96, 0.07, rot=(math.radians(90), 0, 0))), ch)
    hand = put(box(0.05, 0.4, 0.72, loc=(0, -0.2, 0.28)), mat('hand', (0.9, 0.12, 0.12), 0.3))
    hub = put(cyl(0.07, 0.42, rot=(math.radians(90), 0, 0)), DARK())
    ticks = []
    for i in range(12):
        a = i * math.pi / 6
        t = put(box(0.04, 0.38, 0.14 if i % 3 else 0.22, loc=(math.sin(a) * 0.72, -0.01, math.cos(a) * 0.72), rot=(0, a, 0)), DARK())
        ticks.append(t)
    stem = put(cyl(0.12, 0.28, loc=(0, 0, 1.12)), ch)
    crown = put(smooth(cyl(0.2, 0.18, loc=(0, 0, 1.3))), ch)
    loop = put(smooth(torus(0.2, 0.05, loc=(0, 0, 1.55), rot=(math.radians(90), 0, 0))), ch)
    btn = put(smooth(cyl(0.09, 0.22, loc=(0.62, 0, 0.86), rot=(0, math.radians(-38), 0))), ch)
    group([case, dial, rim, hand, hub, stem, crown, loop, btn, *ticks], (8, -14, -10))
    frame_and_light(3.3)


def cards():
    red = mat('red', (0.85, 0.05, 0.07), 0.25, coat=0.8)
    yel = mat('yel', (1.0, 0.78, 0.05), 0.25, coat=0.8)
    a = put(smooth(box(1.3, 0.05, 1.9, loc=(-0.35, 0.2, 0), rot=(0, math.radians(-14), 0)), 0.08), yel)
    b = put(smooth(box(1.3, 0.05, 1.9, loc=(0.35, -0.2, -0.1), rot=(0, math.radians(10), 0)), 0.08), red)
    group([a, b], (8, -24, 6))
    frame_and_light(3.2)


def key():
    br = BRASS()
    bow = put(smooth(torus(0.48, 0.15, loc=(-1.1, 0, 0), rot=(math.radians(90), 0, 0))), br)
    shaft = put(smooth(cyl(0.11, 2.0, loc=(0.4, 0, 0), rot=(0, math.radians(90), 0))), br)
    collar = put(smooth(cyl(0.17, 0.12, loc=(-0.55, 0, 0), rot=(0, math.radians(90), 0))), br)
    t1 = put(smooth(box(0.16, 0.12, 0.42, loc=(1.15, 0, -0.26)), 0.03), br)
    t2 = put(smooth(box(0.16, 0.12, 0.3, loc=(0.8, 0, -0.2)), 0.03), br)
    group([bow, shaft, collar, t1, t2], (14, 0, 28))
    frame_and_light(3.5)


def padlock():
    body = put(smooth(box(1.5, 0.6, 1.2, loc=(0, 0, -0.35)), 0.14), VIOLET())
    shackle = put(smooth(torus(0.48, 0.11, loc=(0, 0, 0.25), rot=(math.radians(90), 0, 0))), CHROME())
    # Only the top half of the ring shows above the body.
    hole = put(cyl(0.12, 0.62, loc=(0, -0.02, -0.3), rot=(math.radians(90), 0, 0)), DARK())
    slot = put(box(0.08, 0.62, 0.3, loc=(0, -0.02, -0.5)), DARK())
    group([body, shackle, hole, slot], (10, -22, 8))
    frame_and_light(3.0)


def gift():
    vi, gd = VIOLET(), BRASS()
    b = put(smooth(box(1.6, 1.6, 1.3, loc=(0, 0, -0.2)), 0.05), vi)
    lid = put(smooth(box(1.72, 1.72, 0.32, loc=(0, 0, 0.55)), 0.05), vi)
    r1 = put(box(0.26, 1.76, 1.68, loc=(0, 0, 0)), gd)
    r2 = put(box(1.76, 0.26, 1.68, loc=(0, 0, 0)), gd)
    bow1 = put(smooth(torus(0.3, 0.09, loc=(-0.26, 0, 0.92), rot=(math.radians(90), math.radians(30), 0))), gd)
    bow2 = put(smooth(torus(0.3, 0.09, loc=(0.26, 0, 0.92), rot=(math.radians(90), math.radians(-30), 0))), gd)
    group([b, lid, r1, r2, bow1, bow2], (18, -6, 32))
    frame_and_light(3.4)


def envelope():
    paper = mat('paper', (0.95, 0.95, 0.98), 0.45, coat=0.2)
    body = put(smooth(box(2.2, 0.08, 1.45), 0.03), paper)
    # The flap: a triangle from the top corners down to the middle, a touch
    # in front of the body.
    me = bpy.data.meshes.new('flap')
    me.from_pydata([(-1.1, -0.06, 0.725), (1.1, -0.06, 0.725), (0, -0.09, -0.1)], [], [(0, 1, 2)])
    flap = bpy.data.objects.new('flap', me)
    bpy.context.scene.collection.objects.link(flap)
    put(flap, mat('flap', (0.84, 0.83, 0.91), 0.45))
    seal = put(smooth(cyl(0.2, 0.06, loc=(0, -0.12, -0.05), rot=(math.radians(90), 0, 0))), VIOLET())
    group([body, flap, seal], (8, -18, 10))
    frame_and_light(3.2)


def board():
    frame = put(smooth(box(2.6, 0.3, 1.5), 0.08), DARK())
    screen = put(box(2.3, 0.32, 1.22), mat('screen', (0.04, 0.04, 0.06), 0.6))
    handle = put(smooth(cyl(0.16, 1.5, loc=(0, 0, -1.4))), DARK())
    objs = [frame, screen, handle]
    for x, txt, col in ((-0.6, '4', (1.0, 0.18, 0.15)), (0.6, '9', (0.25, 0.95, 0.45))):
        bpy.ops.object.text_add(location=(x, -0.18, -0.38), rotation=(math.radians(90), 0, 0))
        t = obj_last()
        t.data.body = txt
        t.data.size = 1.05
        t.data.align_x = 'CENTER'
        t.data.extrude = 0.01
        put(t, mat('led' + txt, col, 0.5, emit=col, estr=1.6))
        objs.append(t)
    bar = put(box(0.05, 0.33, 1.0), mat('bar', (0.12, 0.12, 0.16), 0.5))
    objs.append(bar)
    group(objs, (6, -12, 8))
    frame_and_light(3.6)


BUILD = {'whistle': whistle, 'stopwatch': stopwatch, 'cards': cards, 'key': key, 'padlock': padlock, 'gift': gift, 'envelope': envelope, 'board': board}
for name in (names or list(BUILD)):
    sc = reset()
    BUILD[name]()
    sc.render.filepath = f'{OUT}/obj-{name}.png'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    bpy.ops.render.render(write_still=True)
    print('object', name)
