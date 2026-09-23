# Blender avatar pipeline

`build_avatar.py` builds the Praxis avatar from nothing in headless Blender. `animate.py` then keys
its eight animations. Together they export `web/public/avatar/praxis_avatar.glb`, the file the web
app loads, and the sidecar `praxis_avatar.meta.json`. The GLB is committed, so CI
and the web build never need Blender.

```bash
# from the repo root; Blender 5.2.2 LTS
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python web/blender/build_avatar.py
cd web && pnpm vitest run src/avatar/glb.test.ts src/avatar/glbAnim.test.ts
```

The script is the source of truth. It factory-resets and is deterministic. The `.blend` it also
writes (`web/blender/praxis_avatar.blend`) is a git-ignored convenience for inspecting the result;
port any hand edits back into the script.

## What it builds

- **Mannequin (look approved 23 Sep 2026).** A gender-neutral articulated figure in the style of
  an artist's mannequin: smooth aqua (`#55B296`) segments and deep-teal (`#1F5F5B`) ball joints at
  the shoulder, elbow, wrist, waist, hip, knee and ankle, with an egg-shaped, featureless head.
  Hands are simplified to a thumb, an index finger and a three-finger mitten, enough to show
  pinch and grip. About 28k triangles.
- **Rig.** `root → hips → spine → chest → neck → head`, `clavicle → upper_arm → forearm → hand →
  thumb | index | mitten`, `thigh → shin → foot`, with `_L` / `_R` suffixes. Bone names contain no
  dots, so they survive Three.js `GLTFLoader` name sanitising. Rest joint positions are the same
  as `web/src/avatar/rig.ts`.
- **Skinning.** Each segment is weighted 1.0 to exactly one bone. Poses therefore never smear the
  surface, and the joint balls cover the seams.
- **Props.** Chair, table, the Waiter – cup target sheet, cup, and the NHPT pegboard with 9 pegs.
  The cup sheet and pegboard reproduce `board_spec.py` in millimetres. Empty nodes
  `anchor_dot_1..5` and `anchor_hole_1..9` mark the target centres for the animation step.

## Animations (`animate.py`)

Each action is one glTF animation. Every object it moves carries an NLA track with the action's
name, and the exporter runs in `NLA_TRACKS` mode, so the cup and the pegs travel inside their
action's clip.

| Action | Source | Pose | Camera |
|---|---|---|---|
| `idle` | procedural breathing sway, 8 s loop | standing | front |
| `pendulum` | `clips/rehab/pendulum.json` (procedural) | standing, leaning 35° | side |
| `flexion` | `clips/rehab/flexion.json` (IntelliRehabDS) | standing | side |
| `abduction` | `clips/rehab/abduction.json` (UI-PRMD) | standing | front |
| `external_rotation`, `internal_rotation` | `clips/rehab/*.json` (UI-PRMD) | standing | side |
| `waiter_cup` | scripted: cup carried dot 1 → 5 → 1 | seated at the table | front |
| `nhpt` | scripted: nine pegs, dish → holes 1–9 | seated at the table | front |

**Real-motion clips.** Each clip's joint angles (rig.ts frame, Euler XYZ) are replayed as
armature-space rotations. The posed skeleton therefore has the same world bone directions as
`rig.ts` forward kinematics.

**Table tasks.** These are authored as targets. An analytic two-bone IK puts the grip point on
`anchor_dot_k`, or the pinch point on `anchor_hole_k`. The cup and pegs are then baked to follow
the hand while they are carried.

**Sidecar.** `praxis_avatar.meta.json` lists, for each action:

- duration, and whether it loops
- camera
- visible props
- whether the figure is seated
- one repetition's time span (what the app's rep pacing maps 0..1 onto)
- captions with their times
- dot and hole targets with their times

**Checks.** `glbAnim.test.ts` reads and poses the GLB with its own glTF reader (`src/test/glb.ts`)
and checks that:

- the recorded directions are reproduced (< 1.5° at every key)
- the cup lands on the dot each step names, and each peg sits in its hole (< 3 mm)
- every action loops without a jump
- the sidecar agrees with the GLB

## Coordinates

The glTF output matches `rig.ts`: metres, Y up, the figure faces +Z, and the figure's left is +X.
Inside Blender that is Z up, facing −Y, with the left on +X.

## Tests

`web/src/avatar/glb.test.ts` parses the committed GLB without Blender. It checks:

- bones and the skin
- prop and anchor nodes
- the size and triangle budgets
- the body's bounding box
- both ceramic materials
- the rest-pose coordinate contract
- the board_spec geometry of the dots and holes

## Not yet

Three.js `GLTFLoader` / `AnimationMixer` playback in the app. Until then, the app still renders the
procedural skeleton avatar.
