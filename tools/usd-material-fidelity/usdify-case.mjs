import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, getToolPaths, materialNameForCase, pathExists, readConfig, writeJson } from "./common.mjs";
import { importMaterialFidelityCases } from "./import-material-fidelity.mjs";

export async function usdifyCases({ mode = null } = {}) {
  const config = await readConfig();
  validateCarrierSceneConfig(config);

  const { cases } = await importMaterialFidelityCases({ mode });
  const paths = getToolPaths();
  const usdified = [];

  for (const caseInfo of cases) {
    const caseRoot = path.join(paths.generatedRoot, "usdified", caseInfo.slug);
    await ensureDir(caseRoot);

    const sourceDir = caseInfo.importedDir;
    const wrapperPath = path.join(caseRoot, "scene.usda");
    const relativeCarrierPath = toPosixPath(path.relative(caseRoot, config.carrierScene.asset));
    const relativeMaterialPath = toPosixPath(path.relative(caseRoot, caseInfo.importedMtlxPath));
    const materialName = materialNameForCase(caseInfo);

    const wrapperText = createUsdWrapper({
      carrierAsset: relativeCarrierPath,
      carrierRootPrimPath: config.carrierScene.rootPrimPath,
      bindingTargets: config.carrierScene.bindingTargets,
      materialPath: relativeMaterialPath,
      materialName,
    });

    await fs.writeFile(wrapperPath, wrapperText, "utf8");

    usdified.push({
      id: caseInfo.id,
      slug: caseInfo.slug,
      materialName,
      sourceDir,
      wrapperPath,
      importedMtlxPath: caseInfo.importedMtlxPath,
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

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
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
