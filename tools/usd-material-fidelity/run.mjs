import { collectBaselineMetadata } from "./render-baseline.mjs";
import { diffWebviewCases } from "./diff.mjs";
import { renderWebviewCases } from "./render-webview.mjs";
import { importMaterialFidelityCases } from "./import-material-fidelity.mjs";
import { usdifyCases } from "./usdify-case.mjs";

async function main() {
  const useAll = process.argv.includes("--all");
  const mode = useAll ? "all" : null;
  const baseUrlArgIndex = process.argv.indexOf("--base-url");
  const baseUrl = baseUrlArgIndex >= 0 ? process.argv[baseUrlArgIndex + 1] : null;

  const imported = await importMaterialFidelityCases({ mode });
  const usdified = await usdifyCases({ mode });
  const baselines = await collectBaselineMetadata({ mode });
  const renderPlan = await renderWebviewCases({ mode, baseUrl });
  const diffPlan = await diffWebviewCases({ mode, baseUrl, renderedCases: renderPlan.cases });

  const missingBaselines = baselines.cases.filter((entry) => !entry.exists).length;

  console.log(`usd-material-fidelity imported ${imported.cases.length} case(s).`);
  console.log(`usd-material-fidelity usdified ${usdified.cases.length} case(s).`);
  console.log(`usd-material-fidelity indexed ${baselines.cases.length} baseline image(s); missing ${missingBaselines}.`);
  console.log(`usd-material-fidelity rendered ${renderPlan.cases.length} webview case(s).`);
  console.log(`usd-material-fidelity diffed ${diffPlan.cases.length} case(s).`);
}

await main();
