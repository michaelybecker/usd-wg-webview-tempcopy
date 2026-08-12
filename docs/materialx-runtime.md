# MaterialX Runtime

This viewer uses the official ASWF MaterialX JavaScript/WASM release for the
new MaterialX runtime path.

## Vendored Version

- Version: 1.39.5
- Release asset: `MaterialX_JavaScript.zip`
- Source URL: `https://github.com/AcademySoftwareFoundation/MaterialX/releases/download/v1.39.5/MaterialX_JavaScript.zip`
- SHA-256: `fbb0afe06064b4a5606d52dafe3b740f093de084000f11340ac0a6a88a7ecb0b`
- Local path: `public/materialx/1.39.5/`

The unpacked release contains `JsMaterialXCore` and `JsMaterialXGenShader`
JavaScript/WASM modules. The viewer lazy-loads `JsMaterialXGenShader` only when
MaterialX content is present.

## Updating

Run:

```sh
npm run materialx:fetch
```

The fetch script downloads the pinned release asset, verifies the SHA-256, and
rewrites `public/materialx/1.39.5/metadata.json`.

When updating MaterialX versions:

1. Update `VERSION`, `SOURCE_URL`, and `SHA256` in
   `tools/materialx/fetch-official-runtime.mjs`.
2. Run `npm run materialx:fetch`.
3. Update this document with the new version and SHA.
4. Run `npm run test:unit`, `npm run build`, and targeted MaterialX regression
   cases before blessing visual baselines.

## Runtime

The viewer uses the official runtime by default. The adapter compiles through
the official MaterialX generator, then uses a Three physical-material host for
common `standard_surface` base-color image graphs and a generated ESSL
`ShaderMaterial` fallback for other graphs.

## Current Fidelity Notes

The official path compiles MaterialX through ASWF shader generation and hosts
the result in Three. It already preserves USD-side responsibilities: material
binding discovery, raw or synthesized `.mtlx` extraction, and texture byte
extraction remain in the OpenUSD WASM layer.

Known gaps while parity is still in progress:

- The generated ESSL fallback has only minimal lighting and IBL integration
  compared with the native MaterialX viewer; the physical-material host covers
  the common textured `standard_surface` path with the viewer's built-in
  lighting.
- WGSL generation is exposed in the runtime wrapper for future renderer work,
  but this branch does not integrate a Three WebGPU WGSL host.
- EXR MaterialX image nodes can still fall back to extracted standard texture
  slots where browser support is insufficient.
