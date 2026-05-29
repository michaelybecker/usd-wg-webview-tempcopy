const _wasmBuildId = "point-instancer-2026-05-28a"; // bump on every WASM rebuild to bust browser cache
const _wrapperBuildId = "point-instancer-2026-05-28a";

function normalizePath(path) {
  return `/${String(path).replace(/^\/+/, "")}`;
}

function dirname(path) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function basename(path) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return normalized.slice(index + 1);
}

function ensureDirectory(module, path) {
  const normalized = normalizePath(path);
  if (normalized === "/") {
    return;
  }

  let current = "";
  for (const part of normalized.split("/").filter(Boolean)) {
    current += `/${part}`;
    if (!module.FS_analyzePath(current).exists) {
      module.FS_createPath(dirname(current), basename(current), true, true);
    }
  }
}

window.UsdWebViewBindings = {
  async createRuntime(options = {}) {
    const { default: createUsdWebViewBindingsModule } =
      await import(`./usdWebViewBindingsModule.js?v=${_wasmBuildId}`);
    const module = await createUsdWebViewBindingsModule({
      locateFile(path) {
        const base = options.locateFile?.(path) ?? path;
        return path.endsWith(".wasm") ? `${base}?v=${_wasmBuildId}` : base;
      },
    });

    module.InitializeRuntime();

    // Stores the original immutable bytes for each file, keyed by normalized path.
    const _originalLayerData = new Map();
    // Tracks current variant selections per stage.
    // Key: normalized stage path → Map of "primPath::vsName" → selection string.
    const _variantSelections = new Map();

    // Replace the value of `string vsName = "..."` inside the variants = { }
    // metadata block of the named prim. Uses the prim's last path component as
    // an anchor so same-named variant sets on different prims don't collide.
    function _replaceVariantInText(text, primPath, vsName, selection) {
      const primName = primPath.split("/").filter(Boolean).pop();
      if (!primName) return text;

      // Find the prim definition header: "PrimName" (
      // We search from the start so the first match in the hierarchy wins,
      // which is correct since prim names are unique within their parent scope.
      const headerIdx = text.indexOf(`"${primName}" (`);
      if (headerIdx < 0) return text;

      // Find the opening ( of the metadata block
      const metaOpen = text.indexOf("(", headerIdx);
      if (metaOpen < 0) return text;

      // Find the closing ) of the metadata block (scan for balanced parens)
      let depth = 1;
      let metaClose = metaOpen + 1;
      while (metaClose < text.length && depth > 0) {
        if (text[metaClose] === "(") depth++;
        else if (text[metaClose] === ")") depth--;
        metaClose++;
      }

      // Find variants = { within the metadata block
      const variantsOpen = text.indexOf("variants = {", metaOpen);
      if (variantsOpen < 0 || variantsOpen >= metaClose) return text;

      const variantsClose = text.indexOf("}", variantsOpen);
      if (variantsClose < 0 || variantsClose >= metaClose) return text;

      // Replace the specific variant selection only inside that block
      const findKey = `string ${vsName} = "`;
      const keyIdx = text.indexOf(findKey, variantsOpen);
      if (keyIdx < 0 || keyIdx >= variantsClose) return text;

      const valStart = keyIdx + findKey.length;
      const valEnd = text.indexOf('"', valStart);
      if (valEnd < 0 || valEnd >= variantsClose) return text;

      return text.slice(0, valStart) + selection + text.slice(valEnd);
    }

    function writeToVfs(filePath, data) {
      ensureDirectory(module, dirname(filePath));
      if (module.FS_analyzePath(filePath).exists) {
        module.FS_unlink(filePath);
      }
      module.FS_createDataFile(
        dirname(filePath),
        basename(filePath),
        data,
        true,
        true,
        true
      );
    }

    return {
      ready: Promise.resolve(),
      createDataFile(path, data) {
        const filePath = normalizePath(path);
        if (!_originalLayerData.has(filePath)) {
          _originalLayerData.set(filePath, data.slice());
        }
        writeToVfs(filePath, data);
      },
      extractRenderables(path) {
        return module.ExtractRenderables(normalizePath(path));
      },
      extractRenderablesWithMaterials(path) {
        return module.ExtractRenderablesWithMaterials(normalizePath(path));
      },
      extractRenderablesWithMaterialsUnderRoot(path, primPath) {
        if (!module.ExtractRenderablesWithMaterialsUnderRoot) {
          return module.ExtractRenderablesWithMaterials(normalizePath(path));
        }
        return module.ExtractRenderablesWithMaterialsUnderRoot(normalizePath(path), primPath);
      },
      extractRenderablesAtTime(path, timeCode) {
        return module.ExtractRenderablesAtTime(normalizePath(path), timeCode);
      },
      extractHydraRenderablesAtTime(path, timeCode) {
        return module.ExtractHydraRenderablesAtTime(normalizePath(path), timeCode);
      },
      extractHydraRenderableSnapshotAtTime(path, timeCode) {
        if (!module.ExtractHydraRenderableSnapshotAtTime) {
          return null;
        }
        return module.ExtractHydraRenderableSnapshotAtTime(normalizePath(path), timeCode);
      },
      extractHydraRenderableSubtreeAtTime(path, primPath, timeCode) {
        if (!module.ExtractHydraRenderableSubtreeAtTime) {
          return null;
        }
        return module.ExtractHydraRenderableSubtreeAtTime(normalizePath(path), primPath, timeCode);
      },
      createHydraSyncDriver(path) {
        if (!module.CreateHydraSyncDriver) {
          return null;
        }
        const handle = module.CreateHydraSyncDriver(normalizePath(path));
        if (!handle) {
          return null;
        }
        return {
          SetTime(timeCode) {
            module.SetHydraSyncDriverTime(handle, timeCode);
          },
          Draw() {
            return module.DrawHydraSyncDriver(handle);
          },
          GetStartTimeCode() {
            return module.GetHydraSyncDriverStartTimeCode(handle);
          },
          GetEndTimeCode() {
            return module.GetHydraSyncDriverEndTimeCode(handle);
          },
          GetTimeCodesPerSecond() {
            return module.GetHydraSyncDriverTimeCodesPerSecond(handle);
          },
          delete() {
            module.DeleteHydraSyncDriver(handle);
          },
        };
      },
      createReferenceHydraDriver(path, renderInterface) {
        if (!module.CreateReferenceHydraDriver) {
          console.warn("[USD WebView] CreateReferenceHydraDriver is not available");
          return null;
        }
        const handle = module.CreateReferenceHydraDriver(
          normalizePath(path),
          renderInterface
        );
        if (!handle) {
          console.warn("[USD WebView] reference hydra driver returned null handle");
          return null;
        }
        return {
          SetTime(timeCode) {
            module.SetReferenceHydraDriverTime(handle, timeCode);
          },
          Draw() {
            module.DrawReferenceHydraDriver(handle);
          },
          GetStartTimeCode() {
            return module.GetReferenceHydraDriverStartTimeCode(handle);
          },
          GetEndTimeCode() {
            return module.GetReferenceHydraDriverEndTimeCode(handle);
          },
          GetTimeCodesPerSecond() {
            return module.GetReferenceHydraDriverTimeCodesPerSecond(handle);
          },
          delete() {
            module.DeleteReferenceHydraDriver(handle);
          },
        };
      },
      extractGaussianSplats(path) {
        return module.ExtractGaussianSplats(normalizePath(path));
      },
      extractTransformsAtTime(path, timeCode) {
        return module.ExtractTransformsAtTime(normalizePath(path), timeCode);
      },
      openStage(path, loadAllPayloads = true) {
        return module.OpenStage(normalizePath(path), loadAllPayloads);
      },
      inspectPrimRelationships(stagePath, primPath) {
        return module.InspectPrimRelationships(normalizePath(stagePath), primPath);
      },
      getSkelDebugInfo(stagePath, primPath, timeA = 0, timeB = 60) {
        return module.GetSkelDebugInfo(normalizePath(stagePath), primPath, timeA, timeB);
      },
      getSceneGraph(path) {
        return module.GetSceneGraph(normalizePath(path));
      },
      getPrimAttributes(stagePath, primPath) {
        return module.GetPrimAttributes(normalizePath(stagePath), primPath);
      },
      setPayloadLoaded(stagePath, primPath, loaded) {
        return module.SetPayloadLoaded(normalizePath(stagePath), primPath, loaded);
      },
      setAllPayloadsLoaded(stagePath, loaded) {
        return module.SetAllPayloadsLoaded(normalizePath(stagePath), loaded);
      },
      setVariantSelection(stagePath, primPath, variantSetName, selection) {
        const normalized = normalizePath(stagePath);

        if (module.SetVariantSelection) {
          const changed = module.SetVariantSelection(
            normalized,
            primPath,
            variantSetName,
            selection
          );
          if (changed) {
            return true;
          }
          console.warn(
            `[USD WebView] native variant selection failed for ${primPath} ${variantSetName}=${selection}; falling back to root-layer edit`
          );
        }

        if (!_variantSelections.has(normalized)) {
          _variantSelections.set(normalized, new Map());
        }
        _variantSelections.get(normalized).set(`${primPath}::${variantSetName}`, { primPath, variantSetName, selection });

        const originalBytes = _originalLayerData.get(normalized);
        if (!originalBytes) return false;

        let text = new TextDecoder().decode(originalBytes);

        for (const { primPath: pp, variantSetName: vsName, selection: sel } of _variantSelections.get(normalized).values()) {
          text = _replaceVariantInText(text, pp, vsName, sel);
        }

        writeToVfs(normalized, new TextEncoder().encode(text));
        return module.ReopenStage(normalized);
      },
    };
  },
};
