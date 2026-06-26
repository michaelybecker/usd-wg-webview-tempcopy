# USD Material Fidelity

`usd-material-fidelity` is the local bridge harness for validating that this
repo's USD ingestion path preserves `material-fidelity` MaterialX cases.

It exists here, not in `material-fidelity`, because the thing under test is our
translation boundary:

- USD wrapping
- MaterialX asset discovery
- WASM-side resource extraction
- Hydra/native geometry delivery
- viewer-side MaterialX handling

The canonical renderer-fidelity suite remains
[`material-fidelity`](https://github.com/bhouston/material-fidelity).
This harness is narrower: it checks that a case which already renders in
`threejs-new` still matches after being routed through USD and this viewer.

That distinction matters because `material-fidelity` already has automated
Three.js rendering for direct `.mtlx` inputs. The missing automation in this
repo is specifically the capture path through the full app pipeline:

- load a generated USD case
- wait for WASM/OpenUSD and Hydra/native renderables to settle
- apply the viewer-side MaterialX path
- frame the same deterministic view contract
- capture a PNG for comparison

## Design Goals

- Keep artifact bloat out of git.
- Support a curated smoke subset first.
- Scale to `--all` once the pipeline is stable.
- Reuse one or a small number of carrier scenes so the test variable is the
  material, not the staging geometry.
- Leave room to batch many materials into a shared USD stage later so repeated
  stage loads do not dominate runtime.

## Directory Layout

The harness lives under [tools/usd-material-fidelity](/home/mbecker/dev/USD/usd-wg-webview/tools/usd-material-fidelity):

- `config.samples.json` stores the local corpus and carrier-scene configuration
- `import-material-fidelity.mjs` discovers and copies selected MaterialX cases
- `usdify-case.mjs` emits per-case USD wrappers
- `render-baseline.mjs` indexes expected `threejs-new` baseline PNGs
- `render-webview.mjs` writes a capture plan for future viewport automation
- `diff.mjs` writes a comparison plan for future image diffs
- `run.mjs` orchestrates the workflow

Generated imports, wrappers, renders, and reports are gitignored.

The current wrapper model is intentionally simple: one generated USD stage per
selected MaterialX case. That is the easiest form to debug while the harness is
young. If the full corpus becomes the normal path, a better shape is likely a
shared carrier stage that hosts many bound materials so the viewer can step
through cases without reloading a stage every time.

## Why The Initial Subset Matters

The long-term target can still be "all examples," but the shortest path to a
trustworthy full-corpus run is stabilizing a small representative subset first.

That reduces ambiguity when something breaks. If 80 cases fail at once, it is
hard to tell whether the problem is:

- one bad corpus path assumption
- one broken wrapper rule
- unsupported sample categories
- missing resources
- or a real rendering mismatch

A curated subset gives fast feedback while we lock down the harness mechanics.
Once those mechanics are sound, the same runner can be widened to the full
corpus with much more confidence.
