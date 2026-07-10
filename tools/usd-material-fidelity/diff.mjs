import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { getToolPaths, pathExists, writeJson } from "./common.mjs";
import { collectBaselineMetadata } from "./render-baseline.mjs";
import { renderWebviewCases } from "./render-webview.mjs";

export async function diffWebviewCases({ mode = null, baseUrl = null, renderedCases = null } = {}) {
  const paths = getToolPaths();
  const baselinePromise = collectBaselineMetadata({ mode });
  const renderPromise = renderedCases
    ? Promise.resolve({ cases: renderedCases })
    : renderWebviewCases({ mode, baseUrl });
  const [{ cases: baselines }, { cases: renders }] = await Promise.all([
    baselinePromise,
    renderPromise,
  ]);

  const renderById = new Map(renders.map((entry) => [entry.id, entry]));
  const diffCases = [];

  for (const baseline of baselines) {
    const render = renderById.get(baseline.id);
    if (!render) {
      continue;
    }

    const diffPng = path.join(paths.resultsRoot, `${path.basename(render.expectedOutputPath, ".png")}.diff.png`);
    const diffCase = {
      id: baseline.id,
      baselinePng: baseline.baselinePng,
      baselineExists: baseline.exists,
      renderPng: render.expectedOutputPath,
      renderExists: await pathExists(render.expectedOutputPath),
      diffPng,
      mismatchPixels: null,
      mismatchRatio: null,
      width: null,
      height: null,
    };

    if (diffCase.baselineExists && diffCase.renderExists) {
      const baselineBuffer = await fs.readFile(diffCase.baselinePng);
      const renderBuffer = await fs.readFile(diffCase.renderPng);
      const baselineImage = PNG.sync.read(baselineBuffer);
      const renderImage = PNG.sync.read(renderBuffer);

      if (baselineImage.width !== renderImage.width || baselineImage.height !== renderImage.height) {
        throw new Error(
          `Image size mismatch for ${baseline.id}: baseline ${baselineImage.width}x${baselineImage.height}, ` +
          `render ${renderImage.width}x${renderImage.height}`
        );
      }

      const diffImage = new PNG({ width: baselineImage.width, height: baselineImage.height });
      const mismatchPixels = pixelmatch(
        baselineImage.data,
        renderImage.data,
        diffImage.data,
        baselineImage.width,
        baselineImage.height,
        { threshold: 0.1 }
      );
      await fs.writeFile(diffPng, PNG.sync.write(diffImage));
      diffCase.mismatchPixels = mismatchPixels;
      diffCase.mismatchRatio = mismatchPixels / (baselineImage.width * baselineImage.height);
      diffCase.width = baselineImage.width;
      diffCase.height = baselineImage.height;
    }

    diffCases.push(diffCase);
  }

  const reportPath = path.join(paths.reportsRoot, "diff-plan.json");
  await writeJson(reportPath, {
    generatedAt: new Date().toISOString(),
    status: "diffed",
    count: diffCases.length,
    cases: diffCases,
  });

  return { reportPath, cases: diffCases };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useAll = process.argv.includes("--all");
  const baseUrlArgIndex = process.argv.indexOf("--base-url");
  const baseUrl = baseUrlArgIndex >= 0 ? process.argv[baseUrlArgIndex + 1] : null;
  const result = await diffWebviewCases({ mode: useAll ? "all" : null, baseUrl });
  console.log(`Diffed ${result.cases.length} case(s).`);
  console.log(result.reportPath);
}
