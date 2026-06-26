import path from "node:path";
import { ensureDir, getToolPaths, writeJson } from "./common.mjs";
import { usdifyCases } from "./usdify-case.mjs";

export async function createWebviewRenderPlan({ mode = null } = {}) {
  const paths = getToolPaths();
  const { cases } = await usdifyCases({ mode });
  const planPath = path.join(paths.reportsRoot, "webview-render-plan.json");

  const plan = {
    generatedAt: new Date().toISOString(),
    count: cases.length,
    status: "planned",
    note:
      "Screenshot capture is intentionally not automated in this first pass. " +
      "Hook this manifest up to a browser runner once the viewport capture path is ready.",
    cases: cases.map((entry) => ({
      id: entry.id,
      wrapperPath: entry.wrapperPath,
      expectedOutputPath: path.join(paths.resultsRoot, `${entry.slug}.png`),
    })),
  };

  await ensureDir(paths.resultsRoot);
  await writeJson(planPath, plan);
  return { planPath, cases: plan.cases };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useAll = process.argv.includes("--all");
  const result = await createWebviewRenderPlan({ mode: useAll ? "all" : null });
  console.log(`Prepared webview render plan for ${result.cases.length} case(s).`);
  console.log(result.planPath);
}
