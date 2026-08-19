# USD Material Fidelity

`usd-material-fidelity` is an opt-in local conformance harness for this repo's
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

This branch keeps the generic per-case path:

- import MaterialX cases
- package each one as its own self-contained USD stage
- load each stage through the viewer
- capture and diff the result

That path works as a general bridge harness, but it is no longer the primary
architecture for the shaderball sample corpus.

The primary path is the shared-stage artifact in the canonical
[`material-samples`](https://github.com/michaelybecker/material-samples)
repository:

- `usd/materialx_shaderball/`

That package already contains:

- one portable USD stage
- one shared shaderball geometry setup
- one authored dome light / HDR environment
- showcase, library, and nodes suites
- per-suite `material` variant sets
- `family__material` variant names for showcase/library materials
- direct node-case variant names for the nodes suite

In other words, it already solves the "frontload all `.mtlx` into one stage"
problem for the full shaderball corpus. The local shaderball runner enumerates
those variants from `layers/materials.usda`, loads the stage once through the
normal automation manifest flow, switches variants, captures PNGs, and diffs
against the source sample PNGs in `material-samples/materials`.

## Scope Note

The shared shaderball stage is the primary path for canonical shaderball
materials. It does not necessarily replace the generic per-case path for every
future MaterialX test shape.

The per-case path may still remain useful for:

- non-shaderball cases
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

The shaderball path needs only the pinned canonical `material-samples` checkout. The
generic per-case path additionally uses `material-fidelity`. Neither checkout
is a project dependency, neither is cloned by install scripts, and neither is
needed to build, run, or test the viewer normally.

## Current Shaderball Test Status

The latest complete baseline was captured on 2026-08-19 with native Windows
Chrome/WebGPU, a 512 x 512 capture, and `threejs-new` images from
`material-samples` as references.

| Metric | Result |
| --- | ---: |
| Cases rendered and diffed | 826 |
| At or below 0.01 mismatch | 727 |
| At or below 0.05 mismatch | 769 |
| At or below 0.10 mismatch | 776 |
| Above 0.10 mismatch | 50 |
| Mean mismatch | 0.016852 |
| Median mismatch | 0.000473 |
| 90th percentile | 0.014748 |
| 95th percentile | 0.199787 |
| Maximum mismatch | 0.276394 |

The remaining 50 are renderer-semantic differences rather than stage framing
or resource lookup failures. They cluster in surface optics and opacity,
tangent/binormal and normal-map framing, and procedural math nodes. Examples
include artistic IOR, thin-film, texture opacity, noise/fractal/range, and a
small group of material-specific cases. The raw local artifacts are ignored by
git:

- `tools/usd-material-fidelity/results/shaderball/`: captures and `.diff.png`
  files (1,652 PNGs for the complete run).
- `tools/usd-material-fidelity/reports/shaderball-diff-plan.json`: one entry
  per case with mismatch metrics and selected reference image.
- `tools/usd-material-fidelity/reports/shaderball-outliers-over-0.1.json`: the
  50 cases above the review threshold.

Treat `threejs-new` as the baseline for this harness. It exercises the same
Three.js MaterialX direction as the viewer; other source renderer images are
fallback diagnostics, not parity targets.

## Operating Model

This suite is deliberately outside the normal developer and CI path.

- No `postinstall`, standard unit test, build, or ordinary PR check invokes it.
- Do not commit source corpus checkouts, generated portable packages, PNGs, or
  reports.
- Configure external checkouts in `config.samples.json` or a local override;
  run the shaderball suite only when working on MaterialX, USD material
  ingestion, or the WebGPU renderer.
- Pin an external corpus revision in a small source manifest when the workflow
  is automated. A setup command may populate a user cache from that manifest,
  but it must be explicit and must never run implicitly during installation.

This keeps the repository responsible for the test harness, not for hosting a
second MaterialX sample repository or a baseline-image archive.

## Setup

The default shaderball source is the canonical `material-samples` repository,
pinned to an immutable commit in [sources.json](./sources.json). Run this
explicit bootstrap command once to clone it into a user cache and generate the
portable package there:

```sh
npm run usd-material-fidelity:setup
```

The default cache is `$XDG_CACHE_HOME/usd-wg-webview/material-fidelity` on
Linux/macOS and `%LOCALAPPDATA%\\usd-wg-webview\\material-fidelity` on Windows.
Override it with `USD_MATERIAL_FIDELITY_CACHE` or `-- --cache-root <directory>`.
The setup command is never invoked by install, build, unit tests, or a normal
fidelity command.

## Configuration

Keep [config.samples.json](./config.samples.json) portable. Create the ignored
`config.local.json` alongside it for local paths, for example:

```json
{
  "referenceRoot": "/path/to/material-samples/materials",
  "shaderball": {
    "packageRoot": "/path/to/portable-materialx_shaderball"
  }
}
```

`config.local.json` deep-merges into the tracked sample configuration whenever
the harness runs. Set these fields there for external source checkouts:

- `materialFidelityRoot`: local checkout of `material-fidelity`
- `baselineRenderer`: renderer name used by `material-fidelity` for PNG baselines
- `referenceRoot`: source `material-samples/materials` checkout used for
  shaderball PNG references
- `referenceRenderer`: legacy single-renderer default, used when
  `referenceRenderers` is omitted
- `referenceRenderers`: canonical-first fallback order for shaderball PNG
  references. This branch uses `threejs-new` first because the viewer renders
  MaterialX through Three's upstream MaterialX loader path.
- `shaderball.packageRoot`: generated portable shaderball package
- `shaderball.rootFile`: root USD file inside the shaderball package
- `shaderball.rootPrimPath`: root prim with the `suite` variant set
- `shaderball.suites`: suites to enumerate, normally `showcase`, `library`,
  and `nodes`
- `shaderball.selection`: subset/all selection for the shared-stage shaderball
  runner
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

## Commands

From the repo root:

```sh
npm run usd-material-fidelity:setup
```

Fetches the pinned shaderball source into the user cache and generates its
portable package. This is required only once per cache/source revision.

```sh
npm run usd-material-fidelity
```

Subset run with current config.

```sh
npm run usd-material-fidelity:all
```

Enumerates every `.mtlx` case under `material-fidelityRoot`.

```sh
npm run usd-material-fidelity:shaderball
```

Loads the canonical `materialx_shaderball` USD package once, captures the
configured shaderball subset, and diffs against the first available
`material-samples` PNG in `referenceRenderers` priority order.

```sh
npm run usd-material-fidelity:shaderball:all
```

Runs the same shaderball workflow across every enumerated suite/material
variant. The current pinned canonical package contains 826 materials: 29
showcase, 274 library, and 523 nodes.

This command clears the prior `results/shaderball/` directory before writing a
new run, so its PNGs always belong to one capture pass. It does not delete
reports from unrelated workflows.

```sh
node tools/usd-material-fidelity/shaderball.mjs --enumerate-only
```

Writes the shaderball case manifest without rendering.

## Current Output

The generic per-case harness will:

1. discover and import selected `material-fidelity` cases
2. generate self-contained USD stage packages for each case
3. index expected `threejs-new` baseline PNG locations
4. load each case in automation mode through the real viewer
5. capture viewport PNGs with Playwright
6. diff them against the `threejs-new` baselines with `pixelmatch`

The shaderball harness avoids that repeated load cost for canonical shaderball
coverage by stepping suite/material variants inside the shared USD stage.
Each shaderball report records the selected reference renderer and the full
candidate list for every case, so fallback use is visible instead of implicit.
