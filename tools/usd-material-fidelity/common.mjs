import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TOOL_ROOT = path.resolve("tools/usd-material-fidelity");
const GENERATED_ROOT = path.join(TOOL_ROOT, "generated");
const RESULTS_ROOT = path.join(TOOL_ROOT, "results");
const REPORTS_ROOT = path.join(TOOL_ROOT, "reports");
const CONFIG_FILE = "config.samples.json";
const LOCAL_CONFIG_FILE = "config.local.json";

export function getFidelityCacheRoot() {
  if (process.env.USD_MATERIAL_FIDELITY_CACHE) {
    return path.resolve(process.env.USD_MATERIAL_FIDELITY_CACHE);
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "usd-wg-webview", "material-fidelity");
  }
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "usd-wg-webview", "material-fidelity");
}

export function getToolPaths() {
  return {
    toolRoot: TOOL_ROOT,
    generatedRoot: GENERATED_ROOT,
    resultsRoot: RESULTS_ROOT,
    reportsRoot: REPORTS_ROOT,
    configPath: path.join(TOOL_ROOT, CONFIG_FILE),
    localConfigPath: path.join(TOOL_ROOT, LOCAL_CONFIG_FILE),
  };
}

export async function readConfig(configPath = getToolPaths().configPath) {
  const raw = await fs.readFile(configPath, "utf8");
  let config = JSON.parse(raw);
  const defaultConfigPath = getToolPaths().configPath;

  if (path.resolve(configPath) === path.resolve(defaultConfigPath)) {
    const localConfigPath = getToolPaths().localConfigPath;
    if (await pathExists(localConfigPath)) {
      const localRaw = await fs.readFile(localConfigPath, "utf8");
      config = mergeConfig(config, JSON.parse(localRaw));
    }
  }
  const rootDir = path.dirname(configPath);
  const materialFidelityRoot = config.materialFidelityRoot
    ? path.resolve(rootDir, config.materialFidelityRoot)
    : "";
  const shaderball = config.shaderball ?? {};
  const cacheRoot = getFidelityCacheRoot();
  const materialSamplesRoot = process.env.USD_MATERIAL_SAMPLES_ROOT
    ? path.resolve(process.env.USD_MATERIAL_SAMPLES_ROOT)
    : path.join(cacheRoot, "material-samples");
  const referenceRenderer = config.referenceRenderer ?? config.baselineRenderer ?? "threejs-new";

  return {
    ...config,
    materialFidelityRoot,
    referenceRoot: config.referenceRoot
      ? path.resolve(rootDir, config.referenceRoot)
      : path.join(materialSamplesRoot, "materials"),
    referenceRenderer,
    referenceRenderers: config.referenceRenderers ?? [referenceRenderer],
    capture: {
      viewportWidth: config.capture?.viewportWidth ?? 1024,
      viewportHeight: config.capture?.viewportHeight ?? 1024,
      timeoutMs: config.capture?.timeoutMs ?? 60000,
      settleFrames: config.capture?.settleFrames ?? 6,
    },
    shaderball: {
      ...shaderball,
      packageRoot: shaderball.packageRoot
        ? path.resolve(rootDir, shaderball.packageRoot)
        : path.join(cacheRoot, "portable-materialx_shaderball"),
      rootFile: shaderball.rootFile ?? "shaderball.usda",
      rootPrimPath: shaderball.rootPrimPath ?? "/materialx_shaderball",
      suites: shaderball.suites ?? ["showcase", "library", "nodes"],
      selection: shaderball.selection ?? config.selection ?? { mode: "subset", cases: [] },
      capture: shaderball.capture ?? {},
    },
    carrierScene: {
      ...config.carrierScene,
      asset: config.carrierScene?.asset
        ? path.resolve(rootDir, config.carrierScene.asset)
        : "",
      packageRoot: config.carrierScene?.packageRoot
        ? path.resolve(rootDir, config.carrierScene.packageRoot)
        : "",
    },
  };
}

function mergeConfig(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in base ? mergeConfig(base[key], value) : value;
  }
  return merged;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function slugifyCaseId(caseId) {
  return caseId.replace(/[\\/]/g, "__");
}

export function normalizeCaseId(caseId) {
  return caseId.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export async function findMaterialXCases(rootDir) {
  const results = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".mtlx")) {
        continue;
      }

      const relativePath = path.relative(rootDir, fullPath);
      const caseId = normalizeCaseId(relativePath.slice(0, -".mtlx".length));
      results.push({
        id: caseId,
        mtlxPath: fullPath,
        caseDir: path.dirname(fullPath),
        relativeDir: normalizeCaseId(path.dirname(relativePath)),
        fileName: path.basename(fullPath),
      });
    }
  }

  await walk(rootDir);
  return results;
}

export async function copyDirRecursive(sourceDir, targetDir) {
  await ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(sourcePath, targetPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}

export async function listFilesRecursive(rootDir) {
  const results = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return results;
}

export async function writeJson(targetPath, value) {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function materialNameForCase(caseInfo) {
  return path.basename(caseInfo.id);
}

export function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}
