# USD Material Fidelity

`usd-material-fidelity` is a local conformance harness for this repo's unique
translation boundary:

- `material-fidelity` MaterialX cases
- copied into a local working set
- wrapped in USD
- loaded through this repo's WASM/USD/Hydra pipeline
- compared against the `threejs-new` renderer baseline

The point is not to replace `material-fidelity`. The point is to verify that
our USD path does not lose anything before the same Three.js MaterialX renderer
sees the material.

`material-fidelity` already has an automated render path for `threejs-new`.
What this repo does not have yet is the equivalent automated capture path for:

- USD-wrapped MaterialX inputs
- WASM/OpenUSD stage loading
- Hydra/native geometry delivery
- viewer-side MaterialX resource binding
- deterministic viewport capture after the app settles

This harness now provides that capture path with:

- self-contained generated USD stage packages per case
- an app automation mode that loads a case manifest through the normal file pipeline
- Playwright-driven viewport capture
- `pixelmatch` image diffs against `threejs-new`

## Current Direction

This branch currently implements the generic per-case path:

- import MaterialX cases
- package each one as its own self-contained USD stage
- load each stage through the viewer
- capture and diff the result

That path works as a general bridge harness, but it is now likely a temporary
architecture for the surface-material pass.

There is a better shared-stage artifact in the sibling `material-samples`
repository:

- `/home/mbecker/dev/mtlx/material-samples/usd/materialx_shaderball/`

That package already contains:

- one portable USD stage
- one shared shaderball geometry setup
- one authored dome light / HDR environment
- showcase and library suites
- per-suite `material` variant sets with flat `family__material` variant names

In other words, it already solves the "frontload all `.mtlx` into one stage"
problem for the shaderball surface-material corpus.

## Recommended Next Move

Retarget this harness to the shared `materialx_shaderball` stage after the
corresponding `material-samples` PR lands or otherwise stabilizes.

Why wait:

- right now that artifact still lives behind an open PR / branch
- variant names, package layout, or authored stage details may still move
- re-targeting this repo before that settles would likely create unnecessary
  churn

Once it is stable, the preferred evolution here is:

1. keep the capture/diff automation already built in this repo
2. stop treating one USD stage per material as the primary path for shaderball
   surface cases
3. enumerate `suite` + `material` variants from the shared shaderball stage
4. load that stage once and step through variant switches for screenshots

That should be both faster and more representative of the authored USD workflow
than repeated per-case stage loads.

## Scope Note

The shared shaderball stage is the likely primary path for surface materials.
It does not necessarily replace the generic per-case path for every future
MaterialX test shape.

The per-case path may still remain useful for:

- non-shaderball cases
- node/probe/UV diagnostics
- custom carrier scenes
- experiments that do not naturally fit the shared shaderball corpus

## Why A Small Subset First

This harness is designed to scale to the full `material-fidelity` corpus, but
the first committed workflow should stay on a small curated subset.

That keeps the early pipeline debuggable across several boundaries:

- sample discovery
- resource copying
- USD wrapping
- material name/reference assumptions
- carrier-scene binding
- future screenshot capture
- future image diffing

Once those mechanics are stable on representative cases, switching the runner
to `--all` becomes much safer and much easier to trust.

## Committed Footprint

Committed:

- harness scripts
- manifest/config files
- docs

Not committed:

- imported corpus copies
- generated USD wrappers
- generated stage packages
- rendered PNGs
- diff images
- ad hoc reports

That keeps repository bloat low even if local or CI runs grow large.

## Configuration

Edit [config.samples.json](./config.samples.json):

- `materialFidelityRoot`: local checkout of `material-fidelity`
- `baselineRenderer`: renderer name used by `material-fidelity` for PNG baselines
- `carrierScene.asset`: local USD asset used as the geometry carrier
- `carrierScene.packageRoot`: directory that should be copied with the carrier
  asset so its relative references still resolve inside generated packages
- `carrierScene.rootPrimPath`: root prim inside that carrier asset
- `carrierScene.bindingTargets`: prim paths under the root that should receive
  `material:binding`
- `capture.viewportWidth` / `capture.viewportHeight`: deterministic screenshot size
- `capture.timeoutMs`: browser automation timeout
- `capture.settleFrames`: extra UI frames to wait after a stage reports ready

The first pass assumes a shared carrier scene such as your USDified shaderball.

Longer term, the likely optimization is to frontload many MaterialX cases into
the same USD stage and swap bindings or material targets inside that shared
world, instead of paying a full stage-load cost per case. The current scaffold
starts with per-case wrappers because they are simpler to reason about while the
harness mechanics are still being proven out.

## Commands

From the repo root:

```sh
npm run usd-material-fidelity
```

Subset run with current config.

```sh
npm run usd-material-fidelity:all
```

Enumerates every `.mtlx` case under `material-fidelityRoot`.

## Current Output

Today the harness will:

1. discover and import selected `material-fidelity` cases
2. generate self-contained USD stage packages for each case
3. index expected `threejs-new` baseline PNG locations
4. load each case in automation mode through the real viewer
5. capture viewport PNGs with Playwright
6. diff them against the `threejs-new` baselines with `pixelmatch`

The current shape still does one stage load per case. That is acceptable for
getting the pipeline working, but it is probably not the final throughput
architecture. If full-corpus runs become normal, the next performance move is
likely batching many MaterialX bindings into a shared carrier stage so the
viewer can step through cases without paying repeated stage-load cost.
