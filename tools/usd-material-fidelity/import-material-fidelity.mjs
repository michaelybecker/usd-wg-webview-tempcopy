import path from "node:path";
import { copyDirRecursive, ensureDir, findMaterialXCases, getToolPaths, normalizeCaseId, pathExists, readConfig, slugifyCaseId, writeJson } from "./common.mjs";

export async function importMaterialFidelityCases({ mode = null } = {}) {
  const paths = getToolPaths();
  const config = await readConfig();

  if (!(await pathExists(config.materialFidelityRoot))) {
    throw new Error(
      `material-fidelity root not found: ${config.materialFidelityRoot}\n` +
      `Set tools/usd-material-fidelity/config.samples.json -> materialFidelityRoot to your local checkout.`
    );
  }

  const allCases = await findMaterialXCases(config.materialFidelityRoot);
  const selectedCases = selectCases(allCases, config, mode);
  const imported = [];

  for (const caseInfo of selectedCases) {
    const slug = slugifyCaseId(caseInfo.id);
    const targetDir = path.join(paths.generatedRoot, "imports", slug);
    await ensureDir(targetDir);
    await copyDirRecursive(caseInfo.caseDir, targetDir);

    const targetMtlxPath = path.join(targetDir, caseInfo.fileName);
    imported.push({
      ...caseInfo,
      importedDir: targetDir,
      importedMtlxPath: targetMtlxPath,
      slug,
    });
  }

  const manifestPath = path.join(paths.generatedRoot, "imports", "manifest.json");
  await writeJson(manifestPath, {
    generatedAt: new Date().toISOString(),
    sourceRoot: config.materialFidelityRoot,
    selectionMode: mode ?? config.selection?.mode ?? "subset",
    count: imported.length,
    cases: imported.map((entry) => ({
      id: entry.id,
      slug: entry.slug,
      importedDir: entry.importedDir,
      importedMtlxPath: entry.importedMtlxPath,
      relativeDir: entry.relativeDir,
      fileName: entry.fileName,
    })),
  });

  return { manifestPath, cases: imported };
}

function selectCases(allCases, config, modeOverride) {
  const mode = modeOverride ?? config.selection?.mode ?? "subset";
  if (mode === "all") {
    return allCases;
  }

  const wantedIds = new Set((config.selection?.cases ?? []).map((entry) => normalizeCaseId(entry)));
  const selected = allCases.filter((entry) => wantedIds.has(entry.id));
  const missing = [...wantedIds].filter((id) => !selected.some((entry) => entry.id === id));

  if (missing.length) {
    throw new Error(
      `Configured material-fidelity cases were not found:\n${missing.map((entry) => `- ${entry}`).join("\n")}`
    );
  }

  return selected;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useAll = process.argv.includes("--all");
  const result = await importMaterialFidelityCases({ mode: useAll ? "all" : null });
  console.log(`Imported ${result.cases.length} material-fidelity case(s).`);
  console.log(result.manifestPath);
}
