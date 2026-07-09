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

That capture path is now scaffolded in this repo with generated case manifests,
an automation mode in the app, Playwright-driven viewport screenshots, and
`pixelmatch` diffs.

## Design Goals

- Keep artifact bloat out of git.
- Support a curated smoke subset first.
- Scale to `--all` once the pipeline is stable.
- Reuse one or a small number of carrier scenes so the test variable is the
  material, not the staging geometry.
- Leave room to batch many materials into a shared USD stage later so repeated
  stage loads do not dominate runtime.

## Current Branch State

This branch currently implements a generic per-case packaging and capture path:

- discover MaterialX cases
- generate one self-contained USD package per case
- load each package through the real viewer pipeline
- capture PNGs
- diff them against `threejs-new`

That remains a valid general mechanism, but it is no longer the most likely
long-term shape for the shaderball surface-material corpus.

In `/home/mbecker/dev/mtlx/material-samples`, there is now a stronger candidate
artifact for that job:

- `usd/materialx_shaderball/`

That package already provides:

- one portable shaderball stage
- an authored dome light / HDR setup
- a root `suite` variant set
- per-suite `material` variant sets
- flat `family__material` material variants across showcase and library sets

For shaderball surface materials, that is probably the better thing to drive in
this viewer: load one stage and step variants, rather than generate and reload
one stage per material.

## Recommended Retarget

Wait for the `material-samples` PR that introduces or stabilizes
`usd/materialx_shaderball/` to land before re-targeting this harness.

That is the cleaner sequence because:

- the shared-stage artifact is still behind an active PR / branch
- package structure and authored variant layout may still change
- switching this harness early would likely cause avoidable churn

Once that upstream artifact is stable, the likely next refactor here is:

1. keep the existing automation/capture/diff infrastructure
2. replace the shaderball surface-material primary path with shared-stage
   variant driving
3. keep the generic per-case packaging path as a fallback for non-shaderball or
   non-surface cases

## Directory Layout

The harness lives under [tools/usd-material-fidelity](/home/mbecker/dev/USD/usd-wg-webview/tools/usd-material-fidelity):

- `config.samples.json` stores the local corpus and carrier-scene configuration
- `import-material-fidelity.mjs` discovers and copies selected MaterialX cases
- `usdify-case.mjs` emits per-case USD wrappers
- `render-baseline.mjs` indexes expected `threejs-new` baseline PNGs
- `render-webview.mjs` launches the viewer in automation mode and captures PNGs
- `diff.mjs` compares captured PNGs against `threejs-new` baselines
- `run.mjs` orchestrates the workflow

Generated imports, wrappers, renders, and reports are gitignored.

The current wrapper model is intentionally simple: one generated USD stage per
selected MaterialX case. That is the easiest form to debug while the harness is
young. If the full corpus becomes the normal path, a better shape is likely a
shared carrier stage that hosts many bound materials so the viewer can step
through cases without reloading a stage every time.

Each generated case is packaged as a self-contained local stage bundle so the
automation path can reconstruct the same file-drop package that the viewer
expects, rather than relying on cross-directory filesystem references.

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
