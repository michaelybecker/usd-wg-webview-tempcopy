import createUsdWebViewBindingsModule from "./usdWebViewBindingsModule.js";

const _wasmBuildId = "2025-05-13c"; // bump on every WASM rebuild to bust browser cache

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
      extractTransformsAtTime(path, timeCode) {
        return module.ExtractTransformsAtTime(normalizePath(path), timeCode);
      },
      openStage(path) {
        return module.OpenStage(normalizePath(path));
      },
      inspectPrimRelationships(stagePath, primPath) {
        return module.InspectPrimRelationships(normalizePath(stagePath), primPath);
      },
      getSceneGraph(path) {
        return module.GetSceneGraph(normalizePath(path));
      },
      getPrimAttributes(stagePath, primPath) {
        return module.GetPrimAttributes(normalizePath(stagePath), primPath);
      },
      setVariantSelection(stagePath, primPath, variantSetName, selection) {
        const normalized = normalizePath(stagePath);

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
