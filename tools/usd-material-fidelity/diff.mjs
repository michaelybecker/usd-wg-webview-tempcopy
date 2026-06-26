import path from "node:path";
import { getToolPaths, pathExists, writeJson } from "./common.mjs";
import { collectBaselineMetadata } from "./render-baseline.mjs";
import { createWebviewRenderPlan } from "./render-webview.mjs";

export async function createDiffPlan({ mode = null } = {}) {
  const paths = getToolPaths();
  const [{ cases: baselines }, { cases: renders }] = await Promise.all([
    collectBaselineMetadata({ mode }),
    createWebviewRenderPlan({ mode }),
  ]);

  const renderById = new Map(renders.map((entry) => [entry.id, entry]));
  const diffCases = [];

  for (const baseline of baselines) {
    const render = renderById.get(baseline.id);
    if (!render) {
      continue;
    }

    diffCases.push({
      id: baseline.id,
      baselinePng: baseline.baselinePng,
      baselineExists: baseline.exists,
      renderPng: render.expectedOutputPath,
      renderExists: await pathExists(render.expectedOutputPath),
      diffPng: path.join(paths.resultsRoot, `${path.basename(render.expectedOutputPath, ".png")}.diff.png`),
    });
  }

  const reportPath = path.join(paths.reportsRoot, "diff-plan.json");
  await writeJson(reportPath, {
    generatedAt: new Date().toISOString(),
    status: "planned",
    note:
      "This initial scaffold records where baseline, render, and diff images belong. " +
      "Actual pixel comparison should be added once screenshot capture is automated.",
    count: diffCases.length,
    cases: diffCases,
  });

  return { reportPath, cases: diffCases };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useAll = process.argv.includes("--all");
  const result = await createDiffPlan({ mode: useAll ? "all" : null });
  console.log(`Prepared diff plan for ${result.cases.length} case(s).`);
  console.log(result.reportPath);
}
