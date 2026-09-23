# Blender avatar pipeline

`build_avatar.py` builds the Praxis avatar from nothing in headless Blender and exports
`web/public/avatar/praxis_avatar.glb`, the file the web app loads. The GLB is committed, so CI
and the web build never need Blender.

```bash
# from the repo root; Blender 5.2.2 LTS
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python web/blender/build_avatar.py
cd web && pnpm vitest run src/avatar/glb.test.ts
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

Part 2 adds animations: 8 actions plus a sidecar `praxis_avatar.meta.json`. Part 3 adds Three.js
`GLTFLoader` / `AnimationMixer` playback. Until then, the app still renders the procedural
skeleton avatar.
