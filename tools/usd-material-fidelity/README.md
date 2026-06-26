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
- rendered PNGs
- diff images
- ad hoc reports

That keeps repository bloat low even if local or CI runs grow large.

## Configuration

Edit [config.samples.json](./config.samples.json):

- `materialFidelityRoot`: local checkout of `material-fidelity`
- `baselineRenderer`: renderer name used by `material-fidelity` for PNG baselines
- `carrierScene.asset`: local USD asset used as the geometry carrier
- `carrierScene.rootPrimPath`: root prim inside that carrier asset
- `carrierScene.bindingTargets`: prim paths under the root that should receive
  `material:binding`

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
2. generate USD wrapper stages for each case
3. index expected `threejs-new` baseline PNG locations
4. write a webview render plan
5. write a diff plan

The missing automation step is not "headless Three.js" in general.
`material-fidelity` already does that for direct `.mtlx` inputs.

The missing step here is automated capture through this repo's full USD viewer
pipeline: load the generated USD case, wait for the WASM/USD/Hydra/material
work to settle, frame it to the fidelity camera contract, then export a stable
PNG for diffing.
