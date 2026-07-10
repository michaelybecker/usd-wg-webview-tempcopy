import fs from "node:fs/promises";
import path from "node:path";
import {
  copyDirRecursive,
  ensureDir,
  getToolPaths,
  listFilesRecursive,
  materialNameForCase,
  pathExists,
  readConfig,
  toPosixPath,
  writeJson,
} from "./common.mjs";
import { importMaterialFidelityCases } from "./import-material-fidelity.mjs";

export async function usdifyCases({ mode = null } = {}) {
  const config = await readConfig();
  validateCarrierSceneConfig(config);

  const { cases } = await importMaterialFidelityCases({ mode });
  const paths = getToolPaths();
  const usdified = [];

  for (const caseInfo of cases) {
    const caseRoot = path.join(paths.generatedRoot, "usdified", caseInfo.slug);
    const packageRoot = path.join(caseRoot, "package");
    const sourceDir = path.join(packageRoot, "material");
    const carrierRoot = path.join(packageRoot, "carrier");
    const wrapperPath = path.join(packageRoot, "scene.usda");
    const manifestPath = path.join(caseRoot, "capture-manifest.json");
    await fs.rm(caseRoot, { recursive: true, force: true });
    await ensureDir(packageRoot);

    await copyDirRecursive(caseInfo.importedDir, sourceDir);
    const carrierPackageRoot = config.carrierScene.packageRoot || path.dirname(config.carrierScene.asset);
    await copyDirRecursive(carrierPackageRoot, carrierRoot);

    const relativeCarrierAsset = path.relative(carrierPackageRoot, config.carrierScene.asset);
    const relativeCarrierPath = toPosixPath(path.join("carrier", relativeCarrierAsset));
    const relativeMaterialPath = toPosixPath(path.join("material", path.basename(caseInfo.importedMtlxPath)));
    const materialName = materialNameForCase(caseInfo);

    const wrapperText = createUsdWrapper({
      carrierAsset: relativeCarrierPath,
      carrierRootPrimPath: config.carrierScene.rootPrimPath,
      bindingTargets: config.carrierScene.bindingTargets,
      materialPath: relativeMaterialPath,
      materialName,
    });

    await fs.writeFile(wrapperPath, wrapperText, "utf8");

    const packageFiles = await listFilesRecursive(packageRoot);
    await writeJson(manifestPath, {
      caseId: caseInfo.id,
      slug: caseInfo.slug,
      rootFile: "scene.usda",
      packageRoot,
      files: packageFiles.map((filePath) => ({
        path: toPosixPath(path.relative(packageRoot, filePath)),
        absolutePath: filePath,
      })),
    });

    usdified.push({
      id: caseInfo.id,
      slug: caseInfo.slug,
      materialName,
      sourceDir,
      packageRoot,
      wrapperPath,
      importedMtlxPath: path.join(sourceDir, path.basename(caseInfo.importedMtlxPath)),
      captureManifestPath: manifestPath,
    });
  }

  const manifestPath = path.join(paths.generatedRoot, "usdified", "manifest.json");
  await writeJson(manifestPath, {
    generatedAt: new Date().toISOString(),
    count: usdified.length,
    carrierScene: config.carrierScene,
    cases: usdified,
  });

  return { manifestPath, cases: usdified };
}

function validateCarrierSceneConfig(config) {
  if (!config.carrierScene?.asset) {
    throw new Error(
      "carrierScene.asset is empty in tools/usd-material-fidelity/config.samples.json.\n" +
      "Point it at the USD carrier scene you want to bind test materials onto."
    );
  }

  if (!config.carrierScene.bindingTargets?.length) {
    throw new Error(
      "carrierScene.bindingTargets is empty in tools/usd-material-fidelity/config.samples.json.\n" +
      "Add one or more prim paths under the carrier root that should receive material:binding."
    );
  }
}

function createUsdWrapper({ carrierAsset, carrierRootPrimPath, bindingTargets, materialPath, materialName }) {
  const materialPrimPath = `${carrierRootPrimPath}/Materials/${materialName}`;
  const bindingOvers = bindingTargets
    .map((targetPath) => {
      const segments = targetPath.split("/").filter(Boolean);
      const indentedLines = [];

      for (let index = 0; index < segments.length; index += 1) {
        const depth = index + 1;
        const indent = "    ".repeat(depth);
        const keyword = "over";
        const line = `${indent}${keyword} "${segments[index]}"${index === segments.length - 1 ? "\n" : " {\n"}`;
        indentedLines.push(line);
      }

      const finalIndent = "    ".repeat(segments.length + 1);
      indentedLines.push(`${finalIndent}rel material:binding = <${materialPrimPath}>\n`);

      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const indent = "    ".repeat(index + 1);
        indentedLines.push(`${indent}}\n`);
      }

      return indentedLines.join("");
    })
    .join("");

  return `#usda 1.0
(
    defaultPrim = "World"
)

over "World" (
    references = @${carrierAsset}@<${carrierRootPrimPath}>
)
{
    def Scope "Materials"
    {
        def Material "${materialName}" (
            references = @${materialPath}@
        )
        {
        }
    }
${bindingOvers}}
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useAll = process.argv.includes("--all");
  const config = await readConfig();
  if (config.carrierScene?.asset && !(await pathExists(config.carrierScene.asset))) {
    throw new Error(`carrierScene asset not found: ${config.carrierScene.asset}`);
  }
  const result = await usdifyCases({ mode: useAll ? "all" : null });
  console.log(`USDified ${result.cases.length} material-fidelity case(s).`);
  console.log(result.manifestPath);
}
