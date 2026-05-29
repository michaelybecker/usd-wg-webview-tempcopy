# Material And Geometry Strategy

## Summary

The current viewer no longer treats MaterialX as a separate geometry system.
The chessboard work established that MaterialX can run on the native/Hydra mesh
path, but it also exposed where geometry delivery and authored material
extraction are still split across different code paths.

Today the repo is in a mixed state:

- Hydra/native renderables are the default displayed geometry path.
- Legacy extraction still provides authored material payloads and some fallback
  renderable APIs.
- MaterialX now works on the live native path, with one important viewer-side
  correction: MaterialX meshes flip UV `V` before texture sampling.

The next refactor should not be about “making MaterialX special.” It should be
about reducing the number of competing mesh authorities while preserving the
authored material information we still rely on.

## Current State

### Displayed Geometry

The viewer currently prefers Hydra/native renderables for the actual displayed
mesh geometry.

On stage load, the runtime first asks Hydra for renderables and only falls back
to legacy extraction if Hydra returns nothing. That means the live viewport mesh
is normally coming from the native/Hydra path, not from `_ExtractMeshPayload(...)`.

### Legacy Extraction

`_ExtractMeshPayload(...)` still matters, but it is no longer the primary mesh
authority for the viewport.

It is still used by the legacy `ExtractRenderables*` APIs to provide:

- triangulated points and indices
- UVs from `primvars:st`
- material subset grouping
- authored USD material payloads
- fallback color/material data

This legacy path remains useful because it is deterministic, authored-stage
oriented, and already carries a lot of material packaging behavior that Hydra
renderables do not fully replace yet.

### MaterialX

MaterialX is now functioning on the native/Hydra mesh path.

The chessboard debugging established two separate requirements:

1. Hydra/native renderables needed working UV delivery on the displayed mesh.
2. After UV delivery was repaired, MaterialX still required a final geometry UV
   `V` flip in the viewer to align MaterialX sampling with Three.js.

The current working MaterialX rule in this repo is:

- keep the MaterialX loader in bottom-left mode
- flip the final geometry UV `V` coordinate for MaterialX meshes before
  MaterialX textures sample the mesh

### Non-MaterialX Materials

Non-MaterialX materials still rely more heavily on the legacy extraction side
for authored material payloads, even when the visible geometry was built from
Hydra.

So the current architecture is effectively:

- Hydra/native owns most live mesh geometry
- legacy extraction still supplies a lot of the authored material packaging

That is better than having MaterialX on a totally separate path, but it is not
yet a fully unified material/geometry architecture.

## What We Learned

### MaterialX Was Not The Original Geometry Problem

The original chessboard failure was not “MaterialX cannot work in this viewer.”

The first real blocker was missing UV delivery on the live native mesh.
MaterialX only made that gap obvious because it needed texture sampling on the
actual displayed geometry.

### MaterialX Still Has A Viewer-Side UV Convention Difference

Once UV delivery was restored, the remaining visible mapping error was not
another native extraction bug. It was a MaterialX/Three UV convention mismatch
on the final geometry, solved by flipping `V` in the viewer for MaterialX
meshes.

### The Repo Still Has Two Important Authorities

The viewer is closer to a unified native path than before, but today it still
has two important authorities:

- Hydra/native for displayed geometry
- legacy extraction for authored material packaging and fallback renderables

That split is the real architectural issue now.

## What The Next Refactor Should Do

The next refactor target should be:

- Hydra/native becomes the single geometry authority for normal viewport
  rendering across MaterialX and non-MaterialX assets.
- Authored material extraction remains available, but it attaches to Hydra
  geometry instead of competing as a second mesh source.

Concretely, the next pass should focus on:

1. Make the “Hydra geometry + authored material payload” pattern explicit for
   all materials, not just the MaterialX line that forced us to debug it.
2. Audit which material features still depend on legacy mesh packaging details
   such as subset grouping, UV assumptions, or fallback topology data.
3. Move those missing pieces onto the Hydra-driven renderable contract where
   possible.
4. Keep `_ExtractMeshPayload(...)` as a fallback/debug/authored-stage tool until
   Hydra-side parity is complete, rather than deleting it prematurely.

The target is not “remove legacy extraction everywhere immediately.” The target
is “stop letting legacy extraction act like a second viewport mesh authority.”

## Practical Rule For Work In This Repo

When working on materials from this point forward:

- do not branch architecture by shading model if the real issue is geometry or
  data delivery
- prefer improving the Hydra-driven runtime contract over creating more special
  cases
- keep legacy extraction available for authored-stage reads, fallback, and
  debugging until the native contract fully covers the same needs

That is the state of the repo today, and that is the next sensible refactor
direction.
