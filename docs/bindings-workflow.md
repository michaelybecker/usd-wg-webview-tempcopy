# USD Web View Bindings Workflow

USD Web View owns its JavaScript bindings. The existing USD viewers are useful as prior art, but USD Web View should not vendor their generated files or architecture.

## Current Baseline

The latest local OpenUSD WASM build is:

```sh
cd /Users/michaelbecker/dev/USD/OpenUSD
source ../emsdk/emsdk_env.sh
python3 build_scripts/build_usd.py --build-target wasm ../USD_WASM_Build
```

That build currently provides OpenUSD WASM static libraries in:

```text
/Users/michaelbecker/dev/USD/USD_WASM_Build/lib
```

## Binding Rebuild Loop

Use this loop every time you add or change JS-exposed OpenUSD APIs.

1. Edit binding C++ in `native/usd-webview-bindings/main.cpp`.
2. Rebuild the WASM OpenUSD install:

```sh
cd /Users/michaelbecker/dev/USD/OpenUSD
source ../emsdk/emsdk_env.sh
python3 build_scripts/build_usd.py --build-target wasm --force USD ../USD_WASM_Build
```

3. Build USD Web View's binding target against the WASM install:

```sh
cd /Users/michaelbecker/dev/USD/usd-wg-webview
source ../emsdk/emsdk_env.sh
emcmake cmake -S native/usd-webview-bindings -B build/usd-webview-bindings \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH=/Users/michaelbecker/dev/USD/USD_WASM_Build \
  -DCMAKE_INSTALL_PREFIX=/Users/michaelbecker/dev/USD/usd-wg-webview/public/usd-webview-bindings
cmake --build build/usd-webview-bindings --target install
```

4. Restart the Vite dev server if it does not pick up the generated files.
5. Load `http://127.0.0.1:5173` and verify the runtime panel reports `ready`.

## Entrypoint Contract

Generated files should install under:

```text
public/usd-webview-bindings/
```

The browser-facing entrypoint is:

```text
public/usd-webview-bindings/usdWebViewBindings.js
```

It registers:

```js
window.UsdWebViewBindings = {
  createRuntime(options) {
    return {
      ready,
      createDataFile(path, data),
      openStage(path),
      extractRenderables(path)
    };
  }
};
```

This adapter boundary lets the TypeScript app evolve separately from the exact Emscripten output shape.

## Near-Term Binding Surface

The first meaningful inspection APIs should expose:

- stage open/reload from in-memory files and URLs
- root layer, session layer, used layers, muted layers
- prim tree traversal with type names, active/loaded/defined/abstract flags
- composition arcs: references, payloads, inherits, specializes, variants
- property listing with authored value metadata and time samples
- material binding relationships and shader networks
- change notices for live update workflows

Rendering-specific bindings can come after the inspection core:

- Hydra scene index access
- mesh extraction for Three.js fallback rendering (already implemented)
- MaterialX document/shader discovery
- Gaussian splat payload discovery and streaming hooks
- path tracer scene export or direct render backend integration

## Long-Term Roadmap

USD Web View is being built toward:

- **LIVERPS inspection support** — full layer, instance, composition arc, and property browsing
- **Gaussian Splat rendering** — native support for GSplat payloads alongside mesh rendering
- **Composition graph visualization** — interactive graph of composition arcs
- **Multi-render-delegate architecture** — pluggable renderers (Three.js, Hydra, custom)
