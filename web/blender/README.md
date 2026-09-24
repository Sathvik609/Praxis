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
  Hands have a thumb and four separate fingers, each with three jointed segments. There are a few
  millimetres between neighbouring fingers, so they curl, pinch and grip without touching. About 28k triangles.
- **Rig.** `root → hips → spine → chest → neck → head`, `clavicle → upper_arm → forearm → hand →
  thumb | index | middle | ring | little` (each `<digit>`, `<digit>_2`, `<digit>_3`), `thigh → shin → foot`, with `_L` / `_R` suffixes. Bone names contain no
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

**90° ceiling.** No clip lifts the upper arm above 90° (torso-relative). Recorded reps that go higher are scaled in their own plane so they peak at 90°, the same rule as `capElevation` in `rehabClips.ts`. The sidecar records `ceiling_deg` and `scaled_from_deg`.

**Hands.** Shapes are solved once, in the hand's own frame:

- `relaxed`: a resting curl for the standing clips
- `open`: the hand opens while reaching for a peg
- `near`: pads just apart, for the final approach and the release
- `pinch`: the thumb pad meets the index pad either side of the peg (the index curl and the thumb angles are solved together), and the other three fingers tuck
- `cup`: the fingers and thumb wrap the cup

For the peg the hand is rolled 45° (thumb and index side lowest) with a straight wrist, and the middle, ring and little fingers tuck in a cascade. That posture came from a search for the one in which nothing but the fingertip pads comes near the board or the dish. The pads meet the peg on its upper half, and the loose pegs sit in the middle of the dish.

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
- the pads pinch each peg pad to pad (< 2.5 mm)
- no part of the hand enters the board or the dish at any frame; only the fingertip pads may press up to 6 mm
- the fingers wrap the cup without passing through its wall
- no two digits of either hand touch at any frame of any action
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

## In the app

`web/src/avatar/glbAsset.ts` loads the GLB and the sidecar once per page, and each avatar panel
plays its action with Three.js `GLTFLoader` / `AnimationMixer` (`glbStage.ts`, `GlbScene.tsx`). The
procedural figure takes over if WebGL is unavailable or the GLB fails to load.
