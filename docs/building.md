Note:
This document assumes a prebuilt OpenUSD WASM SDK exists.
For details on recreating the OpenUSD + MaterialX WASM toolchain from scratch, see [wasm-sdk.md](wasm-sdk.md).

# Building USD Web View

## Prerequisites

- [Emscripten SDK (emsdk)](https://emscripten.org/docs/getting_started/downloads.html)
- An OpenUSD WASM build (see below)
- A native OpenUSD source checkout (needed for private headers not installed by the WASM SDK)
- CMake 3.20+
- Node.js + npm

## 1. Build OpenUSD for WASM

Clone OpenUSD and build targeting WASM using the provided build script:

```sh
cd /path/to/OpenUSD
source /path/to/emsdk/emsdk_env.sh
python3 build_scripts/build_usd.py --build-target wasm /path/to/USD_WASM_Build
```

This produces static libraries and CMake config files under `/path/to/USD_WASM_Build`.

## 2. Build the WASM bindings

From the repository root:

```sh
source /path/to/emsdk/emsdk_env.sh

# On this machine cmake lives in Homebrew, not in the emsdk environment.
# Use the absolute path if `cmake` is not already on PATH.
export CMAKE_BIN=/opt/homebrew/bin/cmake

emcmake $CMAKE_BIN -S native/usd-webview-bindings -B build/usd-webview-bindings \
  -DCMAKE_BUILD_TYPE=Release \
  -Dpxr_DIR=/path/to/USD_WASM_Build \
  -DTBB_DIR=/path/to/USD_WASM_Build/lib/cmake/TBB \
  -DUSD_WEBVIEW_OPENUSD_SOURCE_DIR=/path/to/OpenUSD \
  -DCMAKE_INSTALL_PREFIX=$(pwd)/public/usd-webview-bindings

$CMAKE_BIN --build build/usd-webview-bindings --target install -- -j$(sysctl -n hw.logicalcpu)
```

`USD_WEBVIEW_OPENUSD_SOURCE_DIR` points at the OpenUSD **source** checkout. It is needed for private headers (e.g. `pxr/usd/sdf/usdzResolver.h`) that the WASM install does not include.

This installs the generated module artifacts into `public/usd-webview-bindings/`:

| File                            | Description                           |
| ------------------------------- | ------------------------------------- |
| `usdWebViewBindingsModule.js`   | Emscripten-generated JS glue          |
| `usdWebViewBindingsModule.wasm` | Compiled OpenUSD WASM binary (~10 MB) |

The browser-facing wrapper is currently maintained separately at:

```text
public/usd-webview-bindings/usdWebViewBindings.js
```

## 3. Run the frontend

```sh
npm install
npm run dev
```

Open the URL printed by Vite. The runtime panel should report **ready** once the WASM module loads.

The repo includes a checked-in `.npmrc` so plain `npm install` works with the
forked Three.js MaterialX tarball. No extra npm flags should be needed on a
fresh clone.

## Rebuilding after C++ changes

Re-run the `cmake --build` and install step from section 2. The `emcmake cmake` configure step only needs to be re-run when CMake variables change.

```sh
source /path/to/emsdk/emsdk_env.sh
export CMAKE_BIN=/opt/homebrew/bin/cmake
$CMAKE_BIN --build build/usd-webview-bindings --target install -- -j$(sysctl -n hw.logicalcpu)
```

Then bump the browser cache-bust ids before reloading the app. This is required
after every native rebuild, or the browser can keep serving an older wrapper or
WASM binary and make a native fix look like it failed.

## Rebuilding after JS wrapper changes

The browser-facing wrapper currently lives directly in:

```text
public/usd-webview-bindings/usdWebViewBindings.js
```

Editing that file does not require a native rebuild. The Vite dev server picks
up changes in `public/` automatically.

## Binding Version Bumps

After every native bindings rebuild, bump the cache-bust ids so the browser
loads the new wrapper and WASM instead of a cached build.

Current places to update:

- `public/usd-webview-bindings/usdWebViewBindings.js`
  - `_wasmBuildId`
  - `_wrapperBuildId`
- `src/usd/UsdWebViewRuntime.ts`
  - `RUNTIME_ENTRYPOINT`

Recommended rebuild loop on this machine:

```sh
source /Users/michaelbecker/dev/USD/emsdk/emsdk_env.sh
export CMAKE_BIN=/opt/homebrew/bin/cmake
$CMAKE_BIN --build build/usd-webview-bindings --target install -- -j$(sysctl -n hw.logicalcpu)
```

Then immediately bump the binding ids above before reloading the app.

## MaterialX Note

Current MaterialX behavior in this repo assumes:

- the viewer keeps the MaterialX loader in bottom-left mode
- MaterialX meshes flip UV `V` on the final geometry before sampling

If MaterialX output suddenly regresses after a viewer refactor, verify the
MaterialX `Flip V` path in `ThreeViewport.ts` before chasing native UV
extraction again.
