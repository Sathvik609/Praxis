"""Praxis avatar: rigged, gender-neutral articulated mannequin + stage props, built from nothing in Blender.

Blender 5.2.2 LTS (bpy 5.2). Run from the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python web/blender/build_avatar.py

Writes `web/blender/praxis_avatar.blend` and `web/public/avatar/praxis_avatar.glb`.
The script is the source of truth: it factory-resets, so hand edits in the .blend are lost on
the next run and must be ported back here. Same script -> same output (no randomness).

How the body is made (look approved 23 Sep 2026): an artist's-mannequin figure, deliberately
free of sex-typed shaping. Every body segment (egg head, neck, ribcage, pelvis, upper arm,
forearm, palm, thumb, index, three-finger mitten, thigh, shin, foot) is a smooth surface of
revolution with an elliptical cross-section, and every joint (shoulder, elbow, wrist, waist,
hip, knee, ankle) is a ball in a deeper teal. Each piece is weighted 100 % to exactly one bone,
so poses never smear or collapse the surface; the joint balls hide the seams. The figure is
modelled directly in the rest pose of `web/src/avatar/rig.ts` (standing, arms relaxed at the
sides), so there is no A-pose or bone-heat step.
Coordinate contract (glTF output, identical to rig.ts): metres, Y up, the figure faces +Z,
the figure's left is +X. In Blender that is Z up, facing -Y, left on +X; the glTF exporter
converts Z-up -> Y-up (x, y, z)_blender -> (x, z, -y)_gltf.

Props and anchors: the Waiter – cup sheet and the NHPT pegboard reproduce the metric target
positions of `services/session/praxis_session/perception/board_spec.py`. Empty nodes
`anchor_dot_1..5` and `anchor_hole_1..9` mark the target centres (k = board_spec target index
+ 1) so an animation can put the hand exactly on dot k / hole k. Sheets are laid the way the
patient reads them: sheet top (y_mm = 0) away from the patient, sheet left on the patient's
left (+X).
"""

from __future__ import annotations

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
BLEND_OUT = os.path.join(HERE, "praxis_avatar.blend")
GLB_OUT = os.path.join(os.path.dirname(HERE), "public", "avatar", "praxis_avatar.glb")

BODY_TRIANGLE_BUDGET = 30000

# ---------------------------------------------------------------------------------------------
# Colours (sRGB hex -> linear, as Blender and glTF store base colours)
# ---------------------------------------------------------------------------------------------
def srgb(hex_rgb: int, alpha: float = 1.0) -> tuple[float, float, float, float]:
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (hex_rgb >> 16) & 255, (hex_rgb >> 8) & 255, hex_rgb & 255
    return (lin(r / 255), lin(g / 255), lin(b / 255), alpha)


AQUA = 0x55B296  # web/src/avatar/stage.ts AQUA: segment shell
JOINT_TEAL = 0x1F5F5B  # palette teal: ball joints
AMBER = 0xC97F14  # palette amber (pegs)
INK = 0x0B1D21  # dots, markers
PAPER = 0xF2F4F1
WOOD = 0xD8B98C
CUP = 0xC08A6E  # muted terracotta
TABLE_TOP = 0xB9C6C1
FURNITURE = 0x7F9A94

# ---------------------------------------------------------------------------------------------
# Rig: rest joint positions in Blender coordinates (x = figure's left, -y = forward, z = up).
# Numbers mirror rig.ts REST: hips 1.0 m, neck base 1.50, shoulders ±0.225 at 1.41,
# elbows ±0.25 at 1.14, wrists ±0.25 at 0.89, hand joint 0.09 m past the wrist.
# ---------------------------------------------------------------------------------------------
def V(x: float, y: float, z: float) -> Vector:
    return Vector((x, y, z))


SHOULDER = V(0.225, 0.0, 1.41)
ELBOW = V(0.25, 0.0, 1.14)
WRIST = V(0.25, 0.0, 0.89)
KNUCKLE = V(0.25, 0.0, 0.80)

# (name, head, tail, parent, deform); left-side names end in _L and are mirrored to _R.
CENTRE_BONES = [
    ("root", V(0, 0, 0), V(0, 0, 0.12), None, False),
    ("hips", V(0, 0, 1.0), V(0, 0, 1.10), "root", True),
    ("spine", V(0, 0, 1.10), V(0, 0, 1.26), "hips", True),
    ("chest", V(0, 0, 1.26), V(0, 0, 1.50), "spine", True),
    ("neck", V(0, 0, 1.50), V(0, -0.005, 1.60), "chest", True),
    ("head", V(0, -0.005, 1.60), V(0, -0.005, 1.74), "neck", True),
]
LEFT_BONES = [
    ("clavicle_L", V(0.035, -0.01, 1.455), SHOULDER, "chest", True),
    ("upper_arm_L", SHOULDER, ELBOW, "clavicle_L", True),
    ("forearm_L", ELBOW, WRIST, "upper_arm_L", True),
    ("hand_L", WRIST, KNUCKLE, "forearm_L", True),
    ("thumb_L", V(0.244, -0.030, 0.866), V(0.236, -0.068, 0.792), "hand_L", True),
    ("index_L", V(0.248, -0.030, 0.797), V(0.238, -0.034, 0.718), "hand_L", True),
    ("mitten_L", V(0.249, 0.010, 0.795), V(0.240, 0.012, 0.722), "hand_L", True),
    ("thigh_L", V(0.09, 0.0, 0.935), V(0.095, -0.005, 0.51), "hips", True),
    ("shin_L", V(0.095, -0.005, 0.51), V(0.10, 0.015, 0.085), "thigh_L", True),
    ("foot_L", V(0.10, 0.015, 0.085), V(0.105, -0.125, 0.02), "shin_L", True),
]


def mirror(v: Vector) -> Vector:
    return V(-v.x, v.y, v.z)


def all_bones():
    out = list(CENTRE_BONES)
    for name, h, t, parent, deform in LEFT_BONES:
        out.append((name, h, t, parent, deform))
    for name, h, t, parent, deform in LEFT_BONES:
        out.append((name[:-2] + "_R", mirror(h), mirror(t), parent[:-2] + "_R" if parent.endswith("_L") else parent, deform))
    return out


# ---------------------------------------------------------------------------------------------
# Surface-of-revolution helpers. A segment runs from a to b; rfun(t) gives its radius (metres)
# at t in [0, 1]; the cross-section is an ellipse, ey along `ref` (projected off the axis) and ex
# across it. Rings are cosine-spaced so the rounded ends stay smooth at a low ring count.
# ---------------------------------------------------------------------------------------------
def frame(axis: Vector, ref: Vector):
    z = axis.normalized()
    d = ref - z * ref.dot(z)
    if d.length < 1e-6:
        d = V(1, 0, 0)
    d.normalize()
    return d.cross(z).normalized(), d, z


def lathe(name, a, b, rfun, ex=1.0, ey=1.0, ref=V(0, -1, 0), seg=28, rings=20):
    a, b = Vector(a), Vector(b)
    w, d, z = frame(b - a, Vector(ref))
    length = (b - a).length
    bm = bmesh.new()
    loops, poles = [], [None, None]
    for i in range(rings + 1):
        t = (1 - math.cos(math.pi * i / rings)) / 2
        r, c = rfun(t), a + z * (length * t)
        if r < 1e-5:
            poles[0 if i == 0 else 1] = bm.verts.new(c)
            continue
        loops.append([bm.verts.new(c + w * (math.cos(2 * math.pi * k / seg) * r * ex)
                                   + d * (math.sin(2 * math.pi * k / seg) * r * ey)) for k in range(seg)])
    for r0, r1 in zip(loops, loops[1:]):
        for k in range(seg):
            bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    if poles[0]:
        for k in range(seg):
            bm.faces.new((poles[0], loops[0][(k + 1) % seg], loops[0][k]))
    if poles[1]:
        for k in range(seg):
            bm.faces.new((poles[1], loops[-1][k], loops[-1][(k + 1) % seg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return bpy.data.objects.new(name, me)


def pill(r0, r1, cap0, cap1, length, bulge=0.0, bulge_at=0.3):
    """Radius r0 -> r1 with elliptical end caps cap0 / cap1 metres long and an optional bulge."""
    c0, c1 = cap0 / length, cap1 / length

    def f(t):
        r = r0 + (r1 - r0) * t + bulge * math.exp(-(((t - bulge_at) / 0.28) ** 2))
        if t < c0:
            r *= math.sqrt(max(0.0, 1 - ((c0 - t) / c0) ** 2))
        elif t > 1 - c1:
            r *= math.sqrt(max(0.0, 1 - ((t - (1 - c1)) / c1) ** 2))
        return r
    return f


def ellipse_fn(r):
    return lambda t: r * math.sqrt(max(0.0, 1 - (2 * t - 1) ** 2))


def ball(name, c, r, sq=(1.0, 1.0, 1.0), seg=24, rings=14):
    c = Vector(c)
    return lathe(name, c - V(0, 0, r * sq[2]), c + V(0, 0, r * sq[2]), ellipse_fn(r), sq[0], sq[1], V(0, -1, 0), seg, rings)


def limb(name, p, q, r0, r1, gap0, gap1, cap0, cap1, ex=1.0, ey=1.0, ref=V(0, -1, 0), bulge=0.0, bulge_at=0.3,
         seg=28, rings=20):
    """Segment between joint centres p and q, pulled back gap0 / gap1 metres to leave room for the balls."""
    p, q = Vector(p), Vector(q)
    u = (q - p).normalized()
    a, b = p + u * gap0, q - u * gap1
    return lathe(name, a, b, pill(r0, r1, cap0, cap1, (b - a).length, bulge, bulge_at), ex, ey, ref, seg, rings)


# ---------------------------------------------------------------------------------------------
# Body: (piece, bone, "shell" | "joint")
# ---------------------------------------------------------------------------------------------
def head_fn(t):  # egg: cranium wider than the jaw
    return 0.080 * math.sqrt(max(0.0, 1 - (2 * t - 1) ** 2)) * (0.86 + 0.14 * t)


def chest_fn(t):  # ribcage tapering into the waist, square shoulder line with rounded corners
    r = 0.098 + 0.062 * math.sin(min(1.0, t / 0.70) * math.pi / 2)
    if t < 0.16:
        r *= math.sqrt(1 - ((0.16 - t) / 0.16) ** 2)
    if t > 0.84:
        r *= math.sqrt(max(0.0, 1 - ((t - 0.84) / 0.16) ** 2)) * 0.7 + 0.3
    return r


def pelvis_fn(t):  # t = 0 crotch, 1 waist; widest at the hip line, rounded underneath
    r = 0.108 + 0.026 * math.sin(min(1.0, (1 - t) / 0.5) * math.pi / 2)
    if t < 0.42:
        r *= math.sqrt(max(0.0, 1 - ((0.42 - t) / 0.42) ** 2)) * 0.65 + 0.35
    if t > 0.86:
        r *= math.sqrt(1 - ((t - 0.86) / 0.14) ** 2) * 0.55 + 0.45
    return r


def foot_fn(t):  # t = 0 heel, 1 toe
    r = 0.040 + 0.012 * math.sin(min(1.0, t / 0.7) * math.pi / 2)
    if t < 0.22:
        r *= math.sqrt(1 - ((0.22 - t) / 0.22) ** 2)
    if t > 0.80:
        r *= math.sqrt(max(0.0, 1 - ((t - 0.80) / 0.20) ** 2))
    return r


def body_pieces():
    out = []

    def add(ob, bone, kind="shell"):
        out.append((ob, bone, kind))

    add(lathe("head", V(0, -0.004, 1.578), V(0, 0.010, 1.772), head_fn, 0.93, 1.10, V(0, -1, 0), 32, 24), "head")
    add(limb("neck", V(0, 0.008, 1.46), V(0, 0.0, 1.61), 0.049, 0.044, 0, 0, 0.014, 0.014), "neck")
    add(lathe("chest", V(0, 0.004, 1.235), V(0, 0.004, 1.505), chest_fn, 1.07, 0.66, V(0, -1, 0), 36, 26), "chest")
    add(lathe("waist", V(0, 0.006, 1.160), V(0, 0.006, 1.245), ellipse_fn(0.092), 1.0, 0.72, V(0, -1, 0), 32, 14),
        "spine", "joint")
    add(lathe("pelvis", V(0, 0.008, 0.875), V(0, 0.006, 1.170), pelvis_fn, 1.0, 0.68, V(0, -1, 0), 36, 24), "hips")

    for s, S in ((1, "L"), (-1, "R")):
        def m(v, s=s):
            return V(v.x * s, v.y, v.z)
        sh, el, wr = m(SHOULDER), m(ELBOW), m(WRIST)
        add(ball(f"shoulder_{S}", sh, 0.050), f"clavicle_{S}", "joint")
        add(limb(f"upper_arm_{S}", sh, el, 0.043, 0.035, 0.036, 0.030, 0.030, 0.022, 1.0, 0.94,
                 bulge=0.004, bulge_at=0.35), f"upper_arm_{S}")
        add(ball(f"elbow_{S}", el, 0.033), f"forearm_{S}", "joint")
        add(limb(f"forearm_{S}", el, wr, 0.035, 0.025, 0.030, 0.021, 0.022, 0.016, 1.0, 0.82,
                 bulge=0.004, bulge_at=0.22), f"forearm_{S}")
        add(ball(f"wrist_{S}", wr, 0.022, (1.0, 1.15, 0.9), 20, 12), f"hand_{S}", "joint")
        # palm: wide front-to-back, thin across, facing the thigh
        add(limb(f"palm_{S}", wr + V(0, -0.004, -0.010), V(wr.x - 0.002 * s, -0.004, 0.800), 0.038, 0.045,
                 0, 0, 0.012, 0.014, 1.0, 0.46, V(1, 0, 0), seg=24, rings=14), f"hand_{S}")
        add(limb(f"thumb_{S}", m(V(0.244, -0.030, 0.860)), m(V(0.238, -0.060, 0.806)), 0.0135, 0.0110,
                 -0.004, 0, 0.010, 0.009, seg=16, rings=10), f"thumb_{S}")
        add(limb(f"index_{S}", m(V(0.248, -0.030, 0.797)), m(V(0.238, -0.034, 0.718)), 0.0112, 0.0096,
                 -0.006, 0, 0.009, 0.008, seg=16, rings=10), f"index_{S}")
        add(limb(f"mitten_{S}", m(V(0.249, 0.010, 0.795)), m(V(0.240, 0.012, 0.722)), 0.026, 0.022,
                 -0.006, 0, 0.012, 0.014, 1.0, 0.46, V(1, 0, 0), seg=20, rings=12), f"mitten_{S}")

        hip, knee, ank = m(V(0.09, 0.0, 0.935)), m(V(0.095, -0.005, 0.51)), m(V(0.10, 0.015, 0.085))
        hip_ball = hip + V(-0.004 * s, 0, -0.050)
        add(ball(f"hip_{S}", hip_ball, 0.052), f"thigh_{S}", "joint")
        add(limb(f"thigh_{S}", hip_ball, knee, 0.064, 0.045, 0.038, 0.040, 0.035, 0.028, 1.0, 1.02,
                 bulge=0.004, bulge_at=0.3), f"thigh_{S}")
        add(ball(f"knee_{S}", knee, 0.045), f"shin_{S}", "joint")
        add(limb(f"shin_{S}", knee, ank, 0.045, 0.030, 0.038, 0.030, 0.028, 0.020, bulge=0.007, bulge_at=0.28),
            f"shin_{S}")
        add(ball(f"ankle_{S}", ank, 0.030), f"foot_{S}", "joint")
        add(lathe(f"foot_{S}", m(V(0.100, 0.060, 0.036)), m(V(0.108, -0.175, 0.030)), foot_fn, 0.95, 0.60,
                  V(0, 0, 1), 28, 20), f"foot_{S}")
    return out


def build_body():
    """Join every piece into one mesh `body`; each piece is weighted 1.0 to its bone."""
    shell = material("mannequin_shell", AQUA, rough=0.30, coat=0.55, coat_rough=0.18)
    joint = material("mannequin_joint", JOINT_TEAL, rough=0.36, coat=0.45, coat_rough=0.18)
    pieces = body_pieces()
    for ob, bone, kind in pieces:
        link(ob)
        ob.data.materials.append(shell if kind == "shell" else joint)
        ob.vertex_groups.new(name=bone).add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for ob, _, _ in pieces:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = next(ob for ob, bone, _ in pieces if bone == "chest")
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name, body.data.name = "body", "body_mesh"
    return body


def build_armature():
    arm = bpy.data.armatures.new("praxis_rig_data")
    rig = link(bpy.data.objects.new("praxis_rig", arm))
    arm.display_type = "OCTAHEDRAL"
    activate(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, head, tail, parent, deform in all_bones():
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = head, tail
        eb.use_deform = deform
        eb.align_roll(V(0, -1, 0))  # bone Z axis points forward
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = (eb.parent.tail - eb.head).length < 1e-6
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return rig


def bind(body, rig):
    body.parent = rig
    mod = body.modifiers.new("armature", "ARMATURE")
    mod.object = rig

# ---------------------------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------------------------
def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def material(name, hex_rgb, rough=0.5, coat=0.0, coat_rough=0.3):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(hex_rgb)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = coat_rough
    m.diffuse_color = srgb(hex_rgb)
    return m


def apply_modifiers(ob):
    activate(ob)
    for mod in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def tri_count(ob) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------------------------------------
# Props
# ---------------------------------------------------------------------------------------------
SEAT_TOP = 0.46
TABLE_TOP_Z = 0.74
TABLE_NEAR_Y = -0.20  # near (patient) edge of the table
TABLE_DEPTH = 0.60
TABLE_WIDTH = 1.00
SHEET_THICK = 0.0006

# board_spec.py, millimetres, origin top-left, x right, y down
CUP_SHEET_MM = (297.0, 210.0)
CUP_MARKERS_MM = {0: (40.0, 40.0), 1: (257.0, 40.0), 2: (257.0, 170.0), 3: (40.0, 170.0)}
ARC_RADIUS, ARC_APEX_Y, ARC_HALF = 250.0, 105.0 - 12.5, 26.0
NHPT_PITCH_MM = 32.0
HOLE_RADIUS_MM = 5.0
DOT_RADIUS_MM = 10.0


def cup_dots_mm():
    cy = ARC_APEX_Y + ARC_RADIUS
    out = []
    for i in range(5):
        a = math.radians(-ARC_HALF + 2 * ARC_HALF * i / 4)
        out.append((148.5 + ARC_RADIUS * math.sin(a), cy - ARC_RADIUS * math.cos(a)))
    return out


def hole_grid_mm(cx=105.0, cy=148.5):
    off = [(i - 1) * NHPT_PITCH_MM for i in range(3)]
    return [(cx + dx, cy + dy) for dy in off for dx in off]


def sheet_to_world(xmm, ymm, centre_mm, centre_world: Vector) -> Vector:
    """Patient reads the sheet: +x_mm -> patient's right (-X), +y_mm -> toward the patient (+Y)."""
    return centre_world + V(-(xmm - centre_mm[0]) / 1000, (ymm - centre_mm[1]) / 1000, 0)


CUP_SHEET_CENTRE = V(0.0, TABLE_NEAR_Y - 0.03 - CUP_SHEET_MM[1] / 2000, TABLE_TOP_Z)
PEGBOARD_CENTRE = V(0.0, TABLE_NEAR_Y - 0.12, TABLE_TOP_Z)


def rounded_box(name, size, bevel, mat, segments=4):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name + "_mesh"
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    bv = ob.modifiers.new("bevel", "BEVEL")
    bv.width = bevel
    bv.segments = segments
    bv.limit_method = "NONE"
    apply_modifiers(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.materials.append(mat)
    return ob


def cylinder(name, radius, depth, mat, verts=32, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name + "_mesh"
    if bevel:
        bv = ob.modifiers.new("bevel", "BEVEL")
        bv.width = bevel
        bv.segments = 3
        bv.limit_method = "ANGLE"
        apply_modifiers(ob)
    for p in ob.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    ob.data.materials.append(mat)
    return ob


def join(parts, name):
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name + "_mesh"
    return ob


def set_origin(ob, point: Vector):
    """Move the object origin to `point` without moving the geometry."""
    offset = point - ob.location
    ob.data.transform(Matrix.Translation(-offset))
    ob.location = point


def empty(name, loc, parent):
    e = link(bpy.data.objects.new(name, None))
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.01
    e.parent = parent
    e.location = loc - parent.location  # props carry no rotation or scale
    return e


def build_chair(mat):
    seat_y = 0.10 - 0.21  # seat centre: back edge just behind the pelvis
    parts = []
    seat = rounded_box("seat", (0.46, 0.42, 0.045), 0.015, mat)
    seat.location = (0, seat_y, SEAT_TOP - 0.0225)
    parts.append(seat)
    back = rounded_box("back", (0.44, 0.035, 0.30), 0.012, mat)
    back.location = (0, seat_y + 0.21 + 0.005, SEAT_TOP + 0.26)
    back.rotation_euler = (math.radians(-6), 0, 0)
    parts.append(back)
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = cylinder("leg", 0.018, SEAT_TOP - 0.045, mat, 24, 0.004)
            leg.location = (sx * 0.195, seat_y + sy * 0.175, (SEAT_TOP - 0.045) / 2)
            parts.append(leg)
        post = cylinder("post", 0.016, 0.30, mat, 24, 0.004)
        post.location = (sx * 0.195, seat_y + 0.2, SEAT_TOP + 0.12)
        parts.append(post)
    for p in parts:
        activate(p)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    chair = join(parts, "prop_chair")
    set_origin(chair, V(0, seat_y, 0))
    return chair


def build_table(top_mat, leg_mat):
    cy = TABLE_NEAR_Y - TABLE_DEPTH / 2
    top = rounded_box("top", (TABLE_WIDTH, TABLE_DEPTH, 0.03), 0.012, top_mat)
    top.location = (0, cy, TABLE_TOP_Z - 0.015)
    parts = [top]
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = cylinder("tleg", 0.022, TABLE_TOP_Z - 0.03, leg_mat, 24, 0.004)
            leg.location = (sx * (TABLE_WIDTH / 2 - 0.06), cy + sy * (TABLE_DEPTH / 2 - 0.06), (TABLE_TOP_Z - 0.03) / 2)
            parts.append(leg)
    for p in parts:
        activate(p)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    table = join(parts, "prop_table")
    set_origin(table, V(0, cy, 0))
    return table


def build_sheet(paper, ink):
    w, h = CUP_SHEET_MM[0] / 1000, CUP_SHEET_MM[1] / 1000
    c = CUP_SHEET_CENTRE
    bpy.ops.mesh.primitive_cube_add(size=1)
    sheet = bpy.context.active_object
    sheet.scale = (w, h, SHEET_THICK)
    sheet.location = c + V(0, 0, SHEET_THICK / 2)
    bpy.ops.object.transform_apply(location=True, scale=True)
    sheet.data.materials.append(paper)
    parts = [sheet]
    top = c.z + SHEET_THICK
    for xmm, ymm in cup_dots_mm():
        d = cylinder("dot", DOT_RADIUS_MM / 1000, 0.0004, ink, 40)
        d.location = sheet_to_world(xmm, ymm, (148.5, 105.0), c) + V(0, 0, SHEET_THICK + 0.0002)
        parts.append(d)
    for mx, my in CUP_MARKERS_MM.values():
        outer = rounded_box("mk", (0.040, 0.040, 0.0004), 0.0005, ink, 1)
        outer.location = sheet_to_world(mx, my, (148.5, 105.0), c) + V(0, 0, SHEET_THICK + 0.0002)
        inner = rounded_box("mki", (0.016, 0.016, 0.0004), 0.0003, paper, 1)
        inner.location = outer.location + V(0.004, -0.004, 0.0002)
        parts += [outer, inner]
    for p in parts:
        activate(p)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob = join(parts, "prop_sheet")
    set_origin(ob, V(c.x, c.y, top))
    for k, (xmm, ymm) in enumerate(cup_dots_mm(), start=1):
        empty(f"anchor_dot_{k}", sheet_to_world(xmm, ymm, (148.5, 105.0), c) + V(0, 0, SHEET_THICK), ob)
    return ob


PEGBOARD_SIZE = (0.25, 0.13, 0.022)
HOLE_GRID_OFFSET_X = -0.055  # holes on the patient's right, dish on the left (+X) for the left hand
DISH_OFFSET_X = 0.068
PEG_RADIUS = 0.0045
PEG_LENGTH = 0.032


def build_pegboard(wood, peg_mat):
    c = PEGBOARD_CENTRE
    sx, sy, sz = PEGBOARD_SIZE
    board = rounded_box("board", (sx, sy, sz), 0.008, wood, 4)
    board.location = c + V(0, 0, sz / 2)
    activate(board)
    bpy.ops.object.transform_apply(location=True)
    grid_centre = c + V(HOLE_GRID_OFFSET_X, 0, 0)
    cutters = []
    holes_world = []
    for xmm, ymm in hole_grid_mm():
        p = sheet_to_world(xmm, ymm, (105.0, 148.5), grid_centre)
        holes_world.append(p)
        cut = cylinder("cut", HOLE_RADIUS_MM / 1000, 0.04, wood, 32)
        cut.location = p + V(0, 0, sz)
        cutters.append(cut)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0)
    dish = bpy.context.active_object
    dish.scale = (0.052, 0.052, 0.016)
    dish.location = c + V(DISH_OFFSET_X, 0, sz + 0.004)
    cutters.append(dish)
    for cut in cutters:
        activate(cut)
        bpy.ops.object.transform_apply(location=True, scale=True)
    cutter = join(cutters, "cutters")
    boolean = board.modifiers.new("holes", "BOOLEAN")
    boolean.operation = "DIFFERENCE"
    boolean.solver = "EXACT"
    boolean.object = cutter
    apply_modifiers(board)
    bpy.data.objects.remove(cutter, do_unlink=True)
    for p in board.data.polygons:
        p.use_smooth = False
    board.name = "prop_pegboard"
    board.data.name = "prop_pegboard_mesh"
    set_origin(board, V(c.x, c.y, c.z))
    top = c.z + sz
    for k, p in enumerate(holes_world, start=1):
        empty(f"anchor_hole_{k}", V(p.x, p.y, top), board)
    # nine pegs lying in the dish (deterministic layout)
    pegs = []
    dish_c = c + V(DISH_OFFSET_X, 0, 0)
    for k in range(9):
        ang = math.radians(20 + 37 * k)
        rr = 0.012 + 0.012 * ((k * 5) % 3)
        peg = cylinder(f"prop_peg_{k + 1}", PEG_RADIUS, PEG_LENGTH, peg_mat, 20, 0.0015)
        peg.rotation_euler = (math.radians(90), 0, ang + math.radians(90))
        peg.location = dish_c + V(rr * math.cos(ang), rr * math.sin(ang), sz - 0.010 + PEG_RADIUS + 0.001 * (k % 3))
        pegs.append(peg)
    return board, pegs


def build_cup(mat):
    """Tapered cup (base r 30 mm, rim r 35 mm, 90 mm tall, like layout.ts), open top, soft rim."""
    bm = bmesh.new()
    n = 48
    profile = [(0.0, 0.0), (0.027, 0.0), (0.030, 0.003), (0.035, 0.088), (0.0335, 0.090), (0.0315, 0.087), (0.0275, 0.007), (0.0, 0.007)]
    rings = []
    for r, z in profile:
        ring = [bm.verts.new((r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
        rings.append(ring)
    for a, b_ in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b_[j], b_[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("prop_cup_mesh")
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new("prop_cup", me))
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    dots = cup_dots_mm()
    ob.location = sheet_to_world(*dots[0], (148.5, 105.0), CUP_SHEET_CENTRE) + V(0, 0, SHEET_THICK)
    return ob


# ---------------------------------------------------------------------------------------------
def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    body = build_body()
    rig = build_armature()
    bind(body, rig)

    furniture = material("furniture", FURNITURE, rough=0.55)
    table_top = material("table_top", TABLE_TOP, rough=0.6)
    paper = material("paper", PAPER, rough=0.85)
    ink = material("ink", INK, rough=0.7)
    wood = material("wood", WOOD, rough=0.55)
    peg_mat = material("peg", AMBER, rough=0.45, coat=0.2)
    cup_mat = material("cup", CUP, rough=0.45, coat=0.25)
    build_chair(furniture)
    build_table(table_top, furniture)
    build_sheet(paper, ink)
    build_pegboard(wood, peg_mat)
    build_cup(cup_mat)

    activate(rig)
    tris = tri_count(body)
    assert tris < BODY_TRIANGLE_BUDGET, tris
    print(f"[praxis] body triangles: {tris}")
    os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT, compress=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.ops.export_scene.gltf(
        filepath=GLB_OUT,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_influence_nb=4,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        use_selection=False,
    )
    print(f"[praxis] wrote {BLEND_OUT} and {GLB_OUT} ({os.path.getsize(GLB_OUT)} bytes)")


if __name__ == "__main__":
    main()
