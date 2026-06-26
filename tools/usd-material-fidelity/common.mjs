import fs from "node:fs/promises";
import path from "node:path";

const TOOL_ROOT = path.resolve("tools/usd-material-fidelity");
const GENERATED_ROOT = path.join(TOOL_ROOT, "generated");
const RESULTS_ROOT = path.join(TOOL_ROOT, "results");
const REPORTS_ROOT = path.join(TOOL_ROOT, "reports");

export function getToolPaths() {
  return {
    toolRoot: TOOL_ROOT,
    generatedRoot: GENERATED_ROOT,
    resultsRoot: RESULTS_ROOT,
    reportsRoot: REPORTS_ROOT,
    configPath: path.join(TOOL_ROOT, "config.samples.json"),
  };
}

export async function readConfig(configPath = getToolPaths().configPath) {
  const raw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(raw);
  const rootDir = path.dirname(configPath);

  return {
    ...config,
    materialFidelityRoot: path.resolve(rootDir, config.materialFidelityRoot),
    carrierScene: {
      ...config.carrierScene,
      asset: config.carrierScene?.asset
        ? path.resolve(rootDir, config.carrierScene.asset)
        : "",
    },
  };
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

export async function writeJson(targetPath, value) {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function materialNameForCase(caseInfo) {
  return path.basename(caseInfo.id);
}
