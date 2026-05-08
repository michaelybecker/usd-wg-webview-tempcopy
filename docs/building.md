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

emcmake cmake -S native/usd-webview-bindings -B build/usd-webview-bindings \
  -DCMAKE_BUILD_TYPE=Release \
  -Dpxr_DIR=/path/to/USD_WASM_Build \
  -DTBB_DIR=/path/to/USD_WASM_Build/lib/cmake/TBB \
  -DUSD_WEBVIEW_OPENUSD_SOURCE_DIR=/path/to/OpenUSD \
  -DCMAKE_INSTALL_PREFIX=$(pwd)/public/usd-webview-bindings

cmake --build build/usd-webview-bindings --target install -- -j$(sysctl -n hw.logicalcpu)
```

`USD_WEBVIEW_OPENUSD_SOURCE_DIR` points at the OpenUSD **source** checkout. It is needed for private headers (e.g. `pxr/usd/sdf/usdzResolver.h`) that the WASM install does not include.

This installs three files into `public/usd-webview-bindings/`:

| File | Description |
|---|---|
| `usdWebViewBindings.js` | Browser-facing entrypoint, registers `window.UsdWebViewBindings` |
| `usdWebViewBindingsModule.js` | Emscripten-generated JS glue |
| `usdWebViewBindingsModule.wasm` | Compiled OpenUSD WASM binary (~10 MB) |

## 3. Run the frontend

```sh
npm install
npm run dev
```

Open the URL printed by Vite. The runtime panel should report **ready** once the WASM module loads.

## Rebuilding after C++ changes

Re-run the `cmake --build` and install step from section 2. The `emcmake cmake` configure step only needs to be re-run when CMake variables change.

```sh
source /path/to/emsdk/emsdk_env.sh
cmake --build build/usd-webview-bindings --target install -- -j$(sysctl -n hw.logicalcpu)
```

## Rebuilding after JS wrapper changes

The JS wrapper (`native/usd-webview-bindings/usdWebViewBindings.js`) is copied into `public/` during the install step. After editing it, re-run just the install:

```sh
cmake --install build/usd-webview-bindings
```

The Vite dev server picks up changes in `public/` automatically.
