"""Render one 3-D NHPT / Waiter – cup clip in headless Blender (Eevee) from a job JSON.

**Synthetic 3-D renders, not real-camera evidence.** Blender 5.2.2 LTS (bpy 5.2). Run by
`evaluation/blender/make_dataset_3d.py`; by hand:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python evaluation/blender/render_tasks.py -- job.json

The job (written by `scenario.job`) carries the camera, the light preset, the sheet texture (made
by the repo's own `perception/render.sheet_canonical`, cut to the printed page like
`tools/make_sheets.py`), the props and, frame by frame, the hand/forearm capsules, the pegs and
the cup. Everything is built here from primitives (no third-party meshes): a table, the printed
sheet, a perforated peg board with 10 mm holes over the printed rings, nine plastic pegs, a dish,
or a tapered cup with a blue tape ring and a handle, and a skin-toned hand + forearm proxy (palm
box, 15 finger/thumb segments, joint spheres, optional sleeve). Every frame is keyframed, so
Eevee's motion blur sees the real motion; then the animation is rendered to PNG.

Per frame it also ray-casts from the camera to 9 points on each ArUco marker (corners inset
0.5 mm, edge midpoints, centre) and records how many markers are fully unoccluded
(`visibility.json`), which the driver turns into the `marker_lost` ground truth.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Quaternion, Vector

MM = 0.001


def v(p) -> Vector:
    return Vector((p[0] * MM, p[1] * MM, p[2] * MM))


def srgb_to_lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# ---- scene basics ----------------------------------------------------------------------
def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def engine_name() -> str:
    items = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    for name in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        if name in items:
            return name
    raise RuntimeError(f"no Eevee engine in {items}")


def material(name: str, rgb, rough: float = 0.5, spec: float = 0.5, image: str | None = None, tint: float = 1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = rough
    key = "Specular IOR Level" if "Specular IOR Level" in bsdf.inputs else "Specular"
    bsdf.inputs[key].default_value = spec
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(image)
        tex.interpolation = "Cubic"
        mix = nt.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = 1.0
        mix.inputs["Color2"].default_value = (tint, tint, tint * 0.985, 1.0)
        nt.links.new(tex.outputs["Color"], mix.inputs["Color1"])
        nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    return m


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_obj(name: str, bm: bmesh.types.BMesh, mat=None, smooth: bool = True):
    if bm.faces:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    if mat is not None:
        ob.data.materials.append(mat)
    return link(ob)


def plane_uv(name: str, x0: float, y0: float, x1: float, y1: float, z: float, mat) -> bpy.types.Object:
    """Axis-aligned quad in world mm with UVs 0..1 (v up = world -y_sheet is +Y... see caller)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    vs = [bm.verts.new(v((x, y, z))) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    f = bm.faces.new(vs)
    for loop, (a, b) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1)), strict=True):
        loop[uv].uv = (a, b)
    return mesh_obj(name, bm, mat, smooth=False)


def cone(name: str, r0: float, r1: float, mat, segs: int = 20) -> bpy.types.Object:
    """Truncated cone from z=0 (radius r0) to z=1 (radius r1), mm radii, unit length in metres
    along Z (scaled per frame to the segment length)."""
    bm = bmesh.new()
    # no caps: smooth-shaded rim normals averaged with a cap tilt along the axis once the unit
    # length is scaled to a few cm (dark bands); the joint spheres close the ends
    bmesh.ops.create_cone(bm, cap_ends=False, segments=segs, radius1=r0 * MM, radius2=r1 * MM, depth=1.0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.5))
    return mesh_obj(name, bm, mat)


def sphere(name: str, r: float, mat, segs: int = 16) -> bpy.types.Object:
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(8, segs // 2), radius=r * MM)
    return mesh_obj(name, bm, mat)


def set_matrix(ob, M: Matrix, prev: dict) -> None:
    loc, q, sc = M.decompose()
    e = q.to_euler("XYZ", prev.get(ob.name)) if ob.name in prev else q.to_euler("XYZ")
    prev[ob.name] = e
    ob.location, ob.rotation_euler, ob.scale = loc, e, sc


def key(ob, frame: int) -> None:
    for p in ("location", "rotation_euler", "scale"):
        ob.keyframe_insert(p, frame=frame)


def segment_matrix(p0, p1, scale_xy: float = 1.0) -> Matrix:
    a, b = v(p0), v(p1)
    d = b - a
    length = max(d.length, 1e-5)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return Matrix.LocRotScale(a, q, Vector((scale_xy, scale_xy, length)))


# ---- props ------------------------------------------------------------------------------
def build_table(seed: int) -> None:
    tones = [(0.42, 0.30, 0.20), (0.55, 0.52, 0.48), (0.30, 0.22, 0.16), (0.62, 0.58, 0.52)]
    base = tones[seed % len(tones)]
    m = bpy.data.materials.new("table")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.45
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*[c * 0.8 for c in base], 1)
    ramp.color_ramp.elements[1].color = (*[min(1, c * 1.15) for c in base], 1)
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1.0, 12.0, 1.0)  # grain-like streaks
    coord = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    plane_uv("table", -900, -1200, 1100, 800, -0.6, m)


def build_sheet(job: dict) -> None:
    s = job["sheet"]
    pw, ph, ox, oy = s["page"]
    mat = material("paper", (1, 1, 1), rough=0.6, spec=0.35, image=job["sheet_png"], tint=0.9)
    # world X = x_sheet, world Y = -y_sheet; texture row 0 is the page top (y = oy)
    plane_uv("sheet", ox, -(oy + ph), ox + pw, -oy, 0.0, mat)


def build_board(job: dict) -> None:
    b = job["board"]
    t, size, hole_d = b["thickness"], b["size"], b["hole_d"]
    cx, cy, _ = b["centre"]
    mat = material("board", (0.80, 0.80, 0.77), rough=0.55, spec=0.3)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(size * MM, size * MM, t * MM), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(cx * MM, cy * MM, t / 2 * MM), verts=bm.verts)
    board = mesh_obj("board", bm, mat, smooth=False)
    cutters = []
    for k, (x, y) in enumerate(job["sheet"]["targets"]):
        bmc = bmesh.new()
        bmesh.ops.create_cone(bmc, cap_ends=True, segments=32, radius1=hole_d / 2 * MM, radius2=hole_d / 2 * MM, depth=(t + 4) * MM)
        bmesh.ops.translate(bmc, vec=(x * MM, -y * MM, t / 2 * MM), verts=bmc.verts)
        cutters.append(mesh_obj(f"cut{k}", bmc, None, smooth=False))
    coll = bpy.data.collections.new("cutters")
    for c in cutters:
        coll.objects.link(c)
    mod = board.modifiers.new("holes", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.operand_type = "COLLECTION"
    mod.collection = coll
    bpy.context.view_layer.objects.active = board
    with bpy.context.temp_override(object=board, active_object=board):
        bpy.ops.object.modifier_apply(modifier="holes")
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)


def build_pegs(job: dict) -> list:
    p = job["peg"]
    mat = material("peg", p["colour"], rough=0.32, spec=0.5)
    pegs = []
    for i in range(9):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=p["diameter"] / 2 * MM, radius2=p["diameter"] / 2 * MM, depth=p["length"] * MM)
        ob = mesh_obj(f"peg{i}", bm, mat)
        bev = ob.modifiers.new("bevel", "BEVEL")
        bev.width = 0.8 * MM
        bev.segments = 2
        pegs.append(ob)
    return pegs


def build_dish(job: dict) -> None:
    d = job["dish"]
    if not d.get("centre"):
        return
    mat = material("dish", (0.62, 0.66, 0.70), rough=0.4, spec=0.4)
    c = d["centre"]
    r = d["radius"]
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=r * MM, radius2=r * MM, depth=d["floor"] * MM)
    bmesh.ops.translate(bm, vec=(c[0] * MM, c[1] * MM, d["floor"] / 2 * MM), verts=bm.verts)
    mesh_obj("dish_floor", bm, mat)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, segments=40, radius=r * MM)
    ring = mesh_obj("dish_rim", bm, mat)
    ring.location = (c[0] * MM, c[1] * MM, 0.0)
    sol = ring.modifiers.new("wall", "SCREW")
    sol.angle = 0.0
    sol.screw_offset = 16 * MM
    sol.steps = 1
    sol.render_steps = 1
    thick = ring.modifiers.new("thick", "SOLIDIFY")
    thick.thickness = 2.5 * MM


def build_cup(job: dict):
    c = job["cup"]
    body_m = material("cup", c["colour"], rough=0.3, spec=0.5)
    band_m = material("band", c["band_colour"], rough=0.35, spec=0.45)
    root = bpy.data.objects.new("cup_root", None)
    link(root)
    rb, rt, h = c["base_d"] / 2, c["top_d"] / 2, c["height"]

    def lathe(name, profile, mat):
        bm = bmesh.new()
        verts = [bm.verts.new((r * MM, 0.0, z * MM)) for r, z in profile]
        edges = [bm.edges.new((a, b)) for a, b in zip(verts[:-1], verts[1:], strict=True)]
        bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=48, use_duplicate=False)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        ob = mesh_obj(name, bm, mat)
        ob.parent = root
        return ob

    def r_at(z):
        return rb + (rt - rb) * z / h

    lathe("cup_body", [(0.01, 0.0), (rb, 0.0), (r_at(h), h), (r_at(h) - 2.0, h), (r_at(4) - 2.0, 4.0), (0.01, 4.0)], body_m)
    band_top = c["band"]
    lathe("cup_band", [(rb + 0.6, 0.4), (r_at(band_top) + 0.6, band_top)], band_m)
    # handle: a torus in the XZ plane on the +X side of the cup (turned by the root's yaw)
    bm = bmesh.new()
    seg_major, seg_minor, R, rr = 24, 10, 24.0, 5.0
    for i in range(seg_major):
        a = 2 * math.pi * i / seg_major
        for j in range(seg_minor):
            b = 2 * math.pi * j / seg_minor
            x = (R + rr * math.cos(b)) * math.cos(a)
            z = (R + rr * math.cos(b)) * math.sin(a)
            y = rr * math.sin(b)
            bm.verts.new((x * MM, y * MM, z * MM))
    bm.verts.ensure_lookup_table()
    for i in range(seg_major):
        for j in range(seg_minor):
            a = bm.verts[i * seg_minor + j]
            b = bm.verts[((i + 1) % seg_major) * seg_minor + j]
            cc = bm.verts[((i + 1) % seg_major) * seg_minor + (j + 1) % seg_minor]
            d = bm.verts[i * seg_minor + (j + 1) % seg_minor]
            bm.faces.new((a, b, cc, d))
    handle = mesh_obj("cup_handle", bm, body_m)
    handle.parent = root
    handle.location = ((r_at(55) + 6.0) * MM, 0.0, 55 * MM)
    return root


# ---- hand ---------------------------------------------------------------------------------
def build_hand(job: dict, f0: dict) -> dict:
    skin = job["skin"]
    m = material("skin", skin, rough=0.55, spec=0.35)
    sleeve_m = material("sleeve", (0.10, 0.16, 0.30) if job["condition"]["seed"] % 2 else (0.35, 0.34, 0.33), rough=0.8, spec=0.2)
    h = f0["hand"]
    segs = []
    for k, (_, _, r0, r1) in enumerate(h["segments"]):
        segs.append(cone(f"seg{k}", r0, r1, m, segs=18))
    joints = []
    # one sphere at the start and end of every finger / thumb segment
    for k, (_, _, r0, r1) in enumerate(h["segments"]):
        joints.append(sphere(f"j{k}a", r0, m, 14))
        joints.append(sphere(f"j{k}b", r1, m, 14))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    palm = mesh_obj("palm", bm, m, smooth=True)
    bev = palm.modifiers.new("round", "BEVEL")
    bev.width = 0.16
    bev.segments = 4
    bev.affect = "EDGES"
    sub = palm.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2
    fa = h["forearm"]
    forearm = cone("forearm", fa[2], fa[3], m, segs=24)
    wrist = sphere("wrist", fa[2] + 1.0, m, 18)
    sleeve = cone("sleeve", h["sleeve"][2], h["sleeve"][3], sleeve_m, segs=24) if h["sleeve"] else None
    return {"segs": segs, "joints": joints, "palm": palm, "forearm": forearm, "wrist": wrist, "sleeve": sleeve}


def pose_hand(objs: dict, h: dict, prev: dict) -> None:
    for k, (p0, p1, _, _) in enumerate(h["segments"]):
        set_matrix(objs["segs"][k], segment_matrix(p0, p1), prev)
        for ob, p in ((objs["joints"][2 * k], p0), (objs["joints"][2 * k + 1], p1)):
            set_matrix(ob, Matrix.Translation(v(p)), prev)
    pm = h["palm"]
    f, lat, u = Vector(pm["f"]), Vector(pm["l"]), Vector(pm["u"])
    rot = Matrix((f, lat, u)).transposed()
    if rot.determinant() < 0:  # a left hand's (f, l, u) is a reflection; keep the box proper
        rot = Matrix((f, -lat, u)).transposed()
    M = Matrix.LocRotScale(v(pm["centre"]), rot.to_quaternion(), Vector([s * MM for s in pm["size"]]))
    set_matrix(objs["palm"], M, prev)
    fa = h["forearm"]
    set_matrix(objs["forearm"], segment_matrix(fa[0], fa[1]), prev)
    set_matrix(objs["wrist"], Matrix.Translation(v(fa[0])), prev)
    if objs["sleeve"] is not None and h["sleeve"]:
        s = h["sleeve"]
        set_matrix(objs["sleeve"], segment_matrix(s[0], s[1]), prev)


# ---- light / camera -------------------------------------------------------------------------
def world_colour(rgb, strength: float) -> None:
    w = bpy.data.worlds.new("world")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*rgb, 1.0)
    bg.inputs["Strength"].default_value = strength


def add_light(kind: str, name: str, loc_mm, energy: float, rgb=(1, 1, 1), size_mm: float = 100.0, aim_mm=(105, -150, 0)):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = rgb
    if kind == "AREA":
        ld.size = size_mm * MM
    if kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = size_mm * MM
    if kind == "SUN":
        ld.angle = math.radians(1.5)
    ob = bpy.data.objects.new(name, ld)
    ob.location = v(loc_mm)
    d = v(aim_mm) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return link(ob)


def lighting(job: dict) -> float:
    """Returns the film exposure (stops) that stands in for the webcam's auto-exposure."""
    preset = job["condition"]["light"]
    aim = job["camera"]["aim"]
    if preset == "daylight":
        world_colour((0.62, 0.64, 0.68), 0.15)
        add_light("AREA", "ceiling", (aim[0] + 250, aim[1] - 150, 1500), 25.0, (1.0, 0.98, 0.95), 900.0, aim)
        return 0.0
    if preset == "dim":
        world_colour((0.30, 0.30, 0.33), 0.06)
        add_light("POINT", "lamp", (aim[0] - 700, aim[1] - 300, 900), 55.0, (1.0, 0.9, 0.75), 60.0, aim)
        return -0.9
    if preset == "warm_bulb":
        world_colour((0.35, 0.27, 0.18), 0.15)
        add_light("POINT", "bulb", (aim[0] - 350, aim[1] + 200, 750), 45.0, (1.0, 0.62, 0.30), 40.0, aim)
        return 0.2
    if preset == "window":
        world_colour((0.40, 0.48, 0.62), 0.45)
        sgn = -1 if job["condition"]["seed"] % 2 else 1
        add_light("SUN", "window", (aim[0] + sgn * 1500, aim[1] - 300, 650), 3.2, (1.0, 0.97, 0.92), 0.0, aim)
        return 0.0
    raise ValueError(preset)


def camera(job: dict):
    c = job["camera"]
    cd = bpy.data.cameras.new("cam")
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = 36.0
    cd.lens = c["focal_px"] / c["size"][0] * 36.0
    cd.clip_start = 0.01
    cd.clip_end = 10.0
    ob = bpy.data.objects.new("cam", cd)
    link(ob)
    pos, aim = v(c["position"]), v(c["aim"])
    q = (aim - pos).to_track_quat("-Z", "Y")
    q = q @ Quaternion((0, 0, 1), math.radians(c["roll_deg"]))
    ob.location = pos
    ob.rotation_euler = q.to_euler()
    bpy.context.scene.camera = ob
    return ob


# ---- per-frame bookkeeping -------------------------------------------------------------------
def marker_points(job: dict) -> dict[int, list[Vector]]:
    s = job["sheet"]
    half = s["marker_size_mm"] / 2 - 0.5
    out = {}
    for k, (cx, cy) in s["markers"].items():
        pts = []
        for dx in (-half, 0.0, half):
            for dy in (-half, 0.0, half):
                pts.append(v((cx + dx, -(cy + dy), 0.05)))
        out[int(k)] = pts
    return out


def visible_markers(scene, cam, pts: dict[int, list[Vector]]) -> list[int]:
    dg = bpy.context.evaluated_depsgraph_get()
    origin = cam.matrix_world.translation
    vis = []
    for k, ps in pts.items():
        ok = True
        for p in ps:
            ndc = world_to_camera_view(scene, cam, p)
            if not (0.0 <= ndc.x <= 1.0 and 0.0 <= ndc.y <= 1.0):
                ok = False
                break
            d = p - origin
            hit, *_ = scene.ray_cast(dg, origin, d.normalized(), distance=d.length - 0.0003)
            if hit:
                ok = False
                break
        if ok:
            vis.append(k)
    return vis


def main(job_path: str) -> None:
    job = json.loads(Path(job_path).read_text())
    out = Path(job["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    reset()
    scene = bpy.context.scene
    scene.render.engine = engine_name()
    scene.render.resolution_x, scene.render.resolution_y = job["camera"]["size"]
    scene.render.resolution_percentage = 100
    fps = job["fps"]
    scene.render.fps = int(round(fps))
    scene.render.fps_base = scene.render.fps / fps
    ee = scene.eevee
    ee.taa_render_samples = int(job.get("samples", 12))
    if hasattr(ee, "use_shadows"):
        ee.use_shadows = True
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.9 if job["condition"]["light"] == "dim" else 0.5
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(out / "f_")
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"

    cond = job["condition"]
    build_table(cond["seed"])
    build_sheet(job)
    pegs, cup = [], None
    if cond["exercise"] == "nhpt":
        build_board(job)
        pegs = build_pegs(job)
        build_dish(job)
    else:
        cup = build_cup(job)
    frames = job["frames"]
    hand = build_hand(job, frames[0])
    scene.view_settings.exposure = lighting(job)
    cam = camera(job)
    mpts = marker_points(job)
    prev: dict = {}
    vis_log = []
    scene.frame_start, scene.frame_end = 0, len(frames) - 1
    for fr in frames:
        i = fr["i"]
        pose_hand(hand, fr["hand"], prev)
        for k, ob in enumerate(pegs):
            p = fr["objects"][f"peg{k}"]
            axis = Vector(p[3:6]).normalized()
            M = Matrix.LocRotScale(v(p[:3]), Vector((0, 0, 1)).rotation_difference(axis), Vector((1, 1, 1)))
            set_matrix(ob, M, prev)
        if cup is not None:
            p = fr["objects"]["cup"]
            yaw = math.radians(-60.0 if cond["side"] == "right" else -120.0)
            cup.location = v(p[:3])
            cup.rotation_euler = (0.0, 0.0, yaw)
            key(cup, i)
        for ob in pegs + hand["segs"] + hand["joints"] + [hand["palm"], hand["forearm"], hand["wrist"]] + ([hand["sleeve"]] if hand["sleeve"] else []):
            key(ob, i)
        scene.frame_set(i)
        vis = visible_markers(scene, cam, mpts)
        pin = Vector([c * MM for c in fr["hand"]["pinch"]])
        ndc = world_to_camera_view(scene, cam, pin)
        vis_log.append({"i": i, "markers": vis, "hand_in_view": bool(0 <= ndc.x <= 1 and 0 <= ndc.y <= 1 and ndc.z > 0)})
    (out / "visibility.json").write_text(json.dumps(vis_log))
    if job.get("still_only"):
        scene.frame_set(int(job["still_only"]))
        scene.render.filepath = str(out / "still.png")
        bpy.ops.render.render(write_still=True)
        return
    bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: blender -b --python render_tasks.py -- job.json")
    main(argv[0])
