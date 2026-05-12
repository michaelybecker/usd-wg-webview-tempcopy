import createUsdWebViewBindingsModule from "./usdWebViewBindingsModule.js";

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
        return options.locateFile?.(path) ?? path;
      },
    });

    module.InitializeRuntime();

    return {
      ready: Promise.resolve(),
      createDataFile(path, data) {
        const filePath = normalizePath(path);
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
    };
  },
};
