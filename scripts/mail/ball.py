"""A classic football, rendered for the emails: twelve black pentagons and
twenty white hexagons, sewn, glossy, lit like a product shot with the site's
violet behind it. Cycles, transparent background.

    python scripts/mail/ball.py public/brand/mail/ball.png [size] [samples]

Needs Blender's Python module (pip install bpy==4.2.0 on Python 3.11).
The ball is a truncated icosahedron (an icosahedron with every corner cut a
third of the way along its edges), each panel inset for its seam, then
divided finely and pushed out onto a sphere.
"""
import math
import sys

import bpy  # first: bmesh comes with it
import bmesh
from mathutils import Euler, Vector

OUT = sys.argv[1] if len(sys.argv) > 1 else 'ball.png'
SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 800
SAMPLES = int(sys.argv[3]) if len(sys.argv) > 3 else 96

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.film_transparent = True
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'


def mat(name, color, rough, coat=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = 0.12
    return m


WHITE = mat('white', (0.86, 0.86, 0.88), 0.38)
BLACK = mat('black', (0.012, 0.012, 0.016), 0.32)
SEAM = mat('seam', (0.03, 0.03, 0.035), 0.8, 0.0)

# The truncated icosahedron.
mesh = bpy.data.meshes.new('ball')
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=0, radius=1.0)
bmesh.ops.bevel(bm, geom=list(bm.verts), offset=33.3333, offset_type='PERCENT', affect='VERTICES', segments=1)
for f in bm.faces:
    f.material_index = 1 if len(f.verts) == 5 else 0
# The seams: each panel inset a little; the ring the inset leaves is the seam.
panels = list(bm.faces)
res = bmesh.ops.inset_individual(bm, faces=panels, thickness=0.018, use_even_offset=True)
seam_faces = set(res['faces'])
for f in bm.faces:
    if f in seam_faces:
        f.material_index = 2
# Fine enough to be round, then onto the sphere: panels at full radius, the
# seams sunk a touch below, so they read as grooves.
bmesh.ops.triangulate(bm, faces=list(bm.faces))
bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=7, use_grid_fill=True)
seam_verts = set()
for f in bm.faces:
    if f.material_index == 2:
        seam_verts.update(f.verts)
for v in bm.verts:
    r = 0.988 if v in seam_verts else 1.0
    v.co = v.co.normalized() * r
bm.to_mesh(mesh)
bm.free()
for p in mesh.polygons:
    p.use_smooth = True
ball = bpy.data.objects.new('ball', mesh)
scene.collection.objects.link(ball)
for m in (WHITE, BLACK, SEAM):
    mesh.materials.append(m)
# A pentagon a little up and left of centre, the way a ball is photographed.
ball.rotation_euler = Euler((math.radians(18), math.radians(-24), math.radians(8)))

# The camera, long lens, straight on.
cam_d = bpy.data.cameras.new('cam')
cam_d.lens = 85
cam = bpy.data.objects.new('cam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = (0, -6.4, 0)
cam.rotation_euler = (math.radians(90), 0, 0)


def area(name, loc, power, color, size):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy, d.color, d.size = power, color, size
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


area('key', (-3.2, -4.0, 3.4), 900, (1.0, 0.98, 0.96), 3.0)          # soft white, upper left
area('rim', (3.4, 3.0, 1.6), 1400, (0.62, 0.48, 1.0), 2.2)           # violet, behind right
area('fill', (2.6, -4.2, -1.8), 160, (0.75, 0.7, 1.0), 4.0)          # a little lift underneath
area('top', (0.0, 0.5, 5.0), 260, (1.0, 1.0, 1.0), 2.0)              # a highlight on the crown

world = bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.03, 0.14, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

scene.render.filepath = OUT
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
bpy.ops.render.render(write_still=True)
print('ball', OUT)
