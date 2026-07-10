import fs from "node:fs/promises";
import path from "node:path";
import { getToolPaths, pathExists, readConfig, writeJson } from "./common.mjs";
import { importMaterialFidelityCases } from "./import-material-fidelity.mjs";

export async function collectBaselineMetadata({ mode = null } = {}) {
  const config = await readConfig();
  const paths = getToolPaths();
  const { cases } = await importMaterialFidelityCases({ mode });

  const baselineCases = [];
  for (const caseInfo of cases) {
    const baselinePng = path.join(caseInfo.caseDir, `${config.baselineRenderer}.png`);
    baselineCases.push({
      id: caseInfo.id,
      baselineRenderer: config.baselineRenderer,
      baselinePng,
      exists: await pathExists(baselinePng),
    });
  }

  const reportPath = path.join(paths.reportsRoot, "baseline-manifest.json");
  await writeJson(reportPath, {
    generatedAt: new Date().toISOString(),
    baselineRenderer: config.baselineRenderer,
    count: baselineCases.length,
    cases: baselineCases,
  });

  return { reportPath, cases: baselineCases };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useAll = process.argv.includes("--all");
  const result = await collectBaselineMetadata({ mode: useAll ? "all" : null });
  const missing = result.cases.filter((entry) => !entry.exists).length;
  console.log(`Indexed ${result.cases.length} baseline image(s); missing ${missing}.`);
  console.log(result.reportPath);
}
