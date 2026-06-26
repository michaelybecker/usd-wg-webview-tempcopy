import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { ensureDir, getToolPaths, readConfig, toPosixPath, writeJson } from "./common.mjs";
import { usdifyCases } from "./usdify-case.mjs";

export async function renderWebviewCases({ mode = null, baseUrl = null } = {}) {
  const paths = getToolPaths();
  const config = await readConfig();
  const { cases } = await usdifyCases({ mode });
  const planPath = path.join(paths.reportsRoot, "webview-render-plan.json");
  await ensureDir(paths.resultsRoot);

  const actualBaseUrl = baseUrl ?? "http://127.0.0.1:8000";
  const server = baseUrl ? null : startViteServer();
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-webgpu"],
  });

  const page = await browser.newPage({
    viewport: {
      width: config.capture.viewportWidth,
      height: config.capture.viewportHeight,
    },
    deviceScaleFactor: 1,
  });

  const renderedCases = [];
  let serverStarted = false;

  try {
    if (server) {
      await waitForHttpReady(actualBaseUrl, config.capture.timeoutMs);
      serverStarted = true;
    }

    const appUrl = new URL("/", actualBaseUrl);

    for (const entry of cases) {
      const manifestUrl = `/@fs/${toPosixPath(entry.captureManifestPath)}`;
      const caseUrl = new URL(appUrl);
      caseUrl.searchParams.set("automation", "1");
      caseUrl.searchParams.set("automationManifest", manifestUrl);
      caseUrl.searchParams.set("settleFrames", String(config.capture.settleFrames));

      await page.goto(caseUrl.toString(), {
        waitUntil: "networkidle",
        timeout: config.capture.timeoutMs,
      });

      const result = await page.evaluate(async ({ timeoutMs }) => {
        const api = window.__USD_WEBVIEW_AUTOMATION__;
        if (!api) {
          throw new Error("USD Web View automation API is unavailable.");
        }
        await api.waitForReady(timeoutMs);
        return api.getState();
      }, { timeoutMs: config.capture.timeoutMs });

      const outputPath = path.join(paths.resultsRoot, `${entry.slug}.png`);
      await page.locator(".viewport canvas").last().screenshot({ path: outputPath });

      renderedCases.push({
        id: entry.id,
        manifestPath: entry.captureManifestPath,
        manifestUrl,
        wrapperPath: entry.wrapperPath,
        expectedOutputPath: outputPath,
        captureState: result,
      });
    }
  } finally {
    await browser.close();
    if (server) {
      server.kill("SIGTERM");
      if (!serverStarted) {
        server.kill("SIGKILL");
      }
    }
  }

  const plan = {
    generatedAt: new Date().toISOString(),
    count: renderedCases.length,
    status: "rendered",
    baseUrl: actualBaseUrl,
    cases: renderedCases,
  };

  await writeJson(planPath, plan);
  return { planPath, cases: plan.cases };
}

function startViteServer() {
  return spawn("npm", ["run", "dev"], {
    stdio: "ignore",
    shell: true,
  });
}

async function waitForHttpReady(baseUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Vite server at ${baseUrl}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useAll = process.argv.includes("--all");
  const baseUrlArgIndex = process.argv.indexOf("--base-url");
  const baseUrl = baseUrlArgIndex >= 0 ? process.argv[baseUrlArgIndex + 1] : null;
  const result = await renderWebviewCases({ mode: useAll ? "all" : null, baseUrl });
  console.log(`Rendered ${result.cases.length} webview case(s).`);
  console.log(result.planPath);
}
