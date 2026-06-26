import { collectBaselineMetadata } from "./render-baseline.mjs";
import { createDiffPlan } from "./diff.mjs";
import { createWebviewRenderPlan } from "./render-webview.mjs";
import { importMaterialFidelityCases } from "./import-material-fidelity.mjs";
import { usdifyCases } from "./usdify-case.mjs";

async function main() {
  const useAll = process.argv.includes("--all");
  const mode = useAll ? "all" : null;

  const imported = await importMaterialFidelityCases({ mode });
  const usdified = await usdifyCases({ mode });
  const baselines = await collectBaselineMetadata({ mode });
  const renderPlan = await createWebviewRenderPlan({ mode });
  const diffPlan = await createDiffPlan({ mode });

  const missingBaselines = baselines.cases.filter((entry) => !entry.exists).length;

  console.log(`usd-material-fidelity imported ${imported.cases.length} case(s).`);
  console.log(`usd-material-fidelity usdified ${usdified.cases.length} case(s).`);
  console.log(`usd-material-fidelity indexed ${baselines.cases.length} baseline image(s); missing ${missingBaselines}.`);
  console.log(`usd-material-fidelity prepared ${renderPlan.cases.length} webview render plan entries.`);
  console.log(`usd-material-fidelity prepared ${diffPlan.cases.length} diff plan entries.`);
}

await main();
