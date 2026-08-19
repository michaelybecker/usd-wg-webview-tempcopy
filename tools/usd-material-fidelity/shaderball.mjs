import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import {
  copyDirRecursive,
  ensureDir,
  getToolPaths,
  listFilesRecursive,
  pathExists,
  readConfig,
  slugifyCaseId,
  toPosixPath,
  writeJson,
} from "./common.mjs";

function gpuBrowserArgs() {
  return [
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--enable-webgpu",
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
  ];
}

export async function enumerateShaderballCases({ mode = null, caseIds = [] } = {}) {
  const config = await readConfig();
  const paths = getToolPaths();
  await validateShaderballSources(config);
  const materialsLayerPath = path.join(
    config.shaderball.packageRoot,
    "layers",
    "materials.usda"
  );
  const text = await fs.readFile(materialsLayerPath, "utf8");
  const variantsBySuite = parseShaderballMaterialVariants(text);
  const selectedSuites = new Set(config.shaderball.suites);
  const cases = [];

  for (const [suite, variants] of variantsBySuite) {
    if (!selectedSuites.has(suite)) {
      continue;
    }

    for (const variant of variants) {
      const mapped = mapShaderballVariantToReference(suite, variant);
      if (!mapped) {
        continue;
      }

      const reference = await resolveReferencePng(
        config.referenceRoot,
        mapped.referenceRelativeDir,
        config.referenceRenderers
      );
      const id = mapped.id;
      cases.push({
        id,
        suite,
        materialVariant: variant,
        suitePrimPath: `${config.shaderball.rootPrimPath}/${suite}`,
        referenceRelativeDir: mapped.referenceRelativeDir,
        baselineRenderer: reference.renderer,
        referenceRenderer: reference.renderer,
        referenceRenderers: config.referenceRenderers,
        referenceCandidates: reference.candidates,
        baselinePng: reference.png,
        referencePng: reference.png,
        baselineExists: reference.exists,
        referenceExists: reference.exists,
        slug: slugifyCaseId(id),
      });
    }
  }

  const selectedCases = selectShaderballCases(cases, {
    mode,
    selection: config.shaderball.selection,
    caseIds,
  });
  const reportPath = path.join(paths.reportsRoot, "shaderball-cases.json");
  await writeJson(reportPath, {
    generatedAt: new Date().toISOString(),
    packageRoot: config.shaderball.packageRoot,
    rootFile: config.shaderball.rootFile,
    rootPrimPath: config.shaderball.rootPrimPath,
    referenceRoot: config.referenceRoot,
    referenceRenderer: config.referenceRenderer,
    referenceRenderers: config.referenceRenderers,
    count: selectedCases.length,
    totalCount: cases.length,
    cases: selectedCases,
  });

  return { reportPath, cases: selectedCases, allCases: cases };
}

async function validateShaderballSources(config) {
  const expected = [
    [config.shaderball.packageRoot, "portable shaderball package"],
    [config.referenceRoot, "material-samples references"],
  ];
  for (const [targetPath, label] of expected) {
    if (!(await pathExists(targetPath))) {
      throw new Error(
        `Missing ${label}: ${targetPath}\n` +
        "Run `npm run usd-material-fidelity:setup`, or configure config.local.json."
      );
    }
  }
}

export async function writeShaderballCaptureManifest() {
  const config = await readConfig();
  const paths = getToolPaths();
  const stagedPackageRoot = path.join(paths.generatedRoot, "shaderball", "package");
  await fs.rm(stagedPackageRoot, { recursive: true, force: true });
  await copyDirRecursive(config.shaderball.packageRoot, stagedPackageRoot);

  const files = await listFilesRecursive(stagedPackageRoot);
  const manifestPath = path.join(paths.generatedRoot, "shaderball", "capture-manifest.json");
  await writeJson(manifestPath, {
    caseId: "materialx_shaderball",
    rootFile: config.shaderball.rootFile,
    files: files.map((filePath) => ({
      path: toPosixPath(path.relative(stagedPackageRoot, filePath)),
      absolutePath: filePath,
    })),
  });
  return manifestPath;
}

export async function renderShaderballCases({
  mode = null,
  baseUrl = null,
  caseIds = [],
  materialXDebugOutput = "none",
} = {}) {
  const config = await readConfig();
  const paths = getToolPaths();
  const [{ cases }, manifestPath] = await Promise.all([
    enumerateShaderballCases({ mode, caseIds }),
    writeShaderballCaptureManifest(),
  ]);
  const resultsRoot = path.join(paths.resultsRoot, shaderballResultsSubdir(materialXDebugOutput));
  await fs.rm(resultsRoot, { recursive: true, force: true });
  await ensureDir(resultsRoot);

  const actualBaseUrl = baseUrl ?? "http://127.0.0.1:8000";
  const server = baseUrl ? null : startViteServer();
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: gpuBrowserArgs(),
  }).catch(() => chromium.launch({
    headless: true,
    args: gpuBrowserArgs(),
  }));

  const page = await browser.newPage({
    viewport: {
      width: config.capture.viewportWidth,
      height: config.capture.viewportHeight,
    },
    deviceScaleFactor: 1,
  });

  const renderedCases = [];
  const pageMessages = [];
  page.on("console", (message) => {
    pageMessages.push({
      type: message.type(),
      text: message.text(),
    });
  });
  page.on("pageerror", (error) => {
    pageMessages.push({
      type: "pageerror",
      text: error?.stack || error?.message || String(error),
    });
  });
  let serverStarted = false;

  try {
    if (server) {
      await waitForHttpReady(actualBaseUrl, config.capture.timeoutMs);
      serverStarted = true;
    }

    const appUrl = new URL("/", actualBaseUrl);
    const manifestUrl = `/@fs/${toPosixPath(manifestPath)}`;
    appUrl.searchParams.set("automation", "1");
    appUrl.searchParams.set("manualRender", "1");
    appUrl.searchParams.set("automationManifest", manifestUrl);
    appUrl.searchParams.set("settleFrames", String(config.capture.settleFrames));
    await page.goto(appUrl.toString(), {
      waitUntil: "networkidle",
      timeout: config.capture.timeoutMs,
    });
    await forceSquareAutomationViewport(page, config.capture.viewportWidth);
    await page.waitForFunction(
      () => Boolean(window.__USD_WEBVIEW_AUTOMATION__),
      { timeout: config.capture.timeoutMs }
    );
    await page.evaluate(async ({ timeoutMs }) => {
      const api = window.__USD_WEBVIEW_AUTOMATION__;
      if (!api) {
        throw new Error("USD Web View automation API is unavailable.");
      }
      await api.waitForReady(timeoutMs);
    }, { timeoutMs: config.capture.timeoutMs });
    const captureOptions = {
      ...config.shaderball.capture,
      materialXDebugOutput,
    };

    await page.evaluate(async ({ captureOptions }) => {
      const api = window.__USD_WEBVIEW_AUTOMATION__;
      if (api.configureReferenceCapture) {
        await api.configureReferenceCapture(captureOptions);
      }
    }, { captureOptions });

    const captureStartedAt = Date.now();
    for (const [index, entry] of cases.entries()) {
      if (index === 0 || (index + 1) % 25 === 0 || index + 1 === cases.length) {
        const elapsedSeconds = Math.round((Date.now() - captureStartedAt) / 1000);
        console.log(`[shaderball] capture ${index + 1}/${cases.length} (${elapsedSeconds}s): ${entry.id}`);
      }
      const captureState = await page.evaluate(async ({ rootPrimPath, suite, suitePrimPath, materialVariant, captureOptions, timeoutMs }) => {
        const api = window.__USD_WEBVIEW_AUTOMATION__;
        await api.setVariantSelection(rootPrimPath, "suite", suite);
        await api.setVariantSelection(suitePrimPath, "material", materialVariant);
        if (api.configureReferenceCapture) {
          await api.configureReferenceCapture(captureOptions);
        }
        await api.settle();
        return api.getState();
      }, {
        rootPrimPath: config.shaderball.rootPrimPath,
        suite: entry.suite,
        suitePrimPath: entry.suitePrimPath,
        materialVariant: entry.materialVariant,
        captureOptions,
        timeoutMs: config.capture.timeoutMs,
      });
      const debugMaterialInfo = await page.evaluate(() => {
        const api = window.__USD_WEBVIEW_AUTOMATION__;
        return api.getViewportDebugMaterialInfo ? api.getViewportDebugMaterialInfo() : [];
      });
      await page.evaluate(async () => {
        const api = window.__USD_WEBVIEW_AUTOMATION__;
        if (api.renderForCapture) {
          await api.renderForCapture(3);
        }
      });

      const outputPath = path.join(resultsRoot, `${entry.slug}.png`);
      await screenshotViewportCanvas(page, outputPath);
      renderedCases.push({
        ...entry,
        manifestPath,
        manifestUrl,
        expectedOutputPath: outputPath,
        captureState,
        debugMaterialInfo,
        pageMessages: [...pageMessages],
      });
    }
  } finally {
    await browser.close();
    if (server) {
      stopViteServer(server);
      if (!serverStarted) {
        stopViteServer(server, true);
      }
    }
  }

  const planPath = path.join(paths.reportsRoot, "shaderball-render-plan.json");
  await writeJson(planPath, {
    generatedAt: new Date().toISOString(),
    status: "rendered",
    baseUrl: actualBaseUrl,
    materialXDebugOutput,
    resultsRoot,
    count: renderedCases.length,
    cases: renderedCases,
  });

  return { planPath, cases: renderedCases };
}

export async function diffShaderballCases({
  mode = null,
  baseUrl = null,
  renderedCases = null,
  caseIds = [],
  materialXDebugOutput = "none",
} = {}) {
  const paths = getToolPaths();
  const { cases: enumeratedCases } = await enumerateShaderballCases({ mode, caseIds });
  const renders = renderedCases ?? (await renderShaderballCases({
    mode,
    baseUrl,
    caseIds,
    materialXDebugOutput,
  })).cases;
  const renderById = new Map(renders.map((entry) => [entry.id, entry]));
  const diffRoot = renders[0]
    ? path.dirname(renders[0].expectedOutputPath)
    : path.join(paths.resultsRoot, shaderballResultsSubdir(materialXDebugOutput));
  const diffCases = [];

  for (const baseline of enumeratedCases) {
    const render = renderById.get(baseline.id);
    if (!render) {
      continue;
    }

    const diffPng = path.join(diffRoot, `${render.slug}.diff.png`);
    const diffCase = {
      id: baseline.id,
      suite: baseline.suite,
      materialVariant: baseline.materialVariant,
      baselineRenderer: baseline.baselineRenderer,
      referenceRenderer: baseline.referenceRenderer,
      referenceCandidates: baseline.referenceCandidates,
      baselinePng: baseline.baselinePng,
      baselineExists: baseline.baselineExists,
      renderPng: render.expectedOutputPath,
      renderExists: await pathExists(render.expectedOutputPath),
      diffPng,
      mismatchPixels: null,
      mismatchRatio: null,
      width: null,
      height: null,
    };

    if (diffCase.baselineExists && diffCase.renderExists) {
      const baselineImage = PNG.sync.read(await fs.readFile(diffCase.baselinePng));
      const renderImage = PNG.sync.read(await fs.readFile(diffCase.renderPng));

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

  const reportPath = path.join(paths.reportsRoot, "shaderball-diff-plan.json");
  await writeJson(reportPath, {
    generatedAt: new Date().toISOString(),
    status: "diffed",
    materialXDebugOutput,
    resultsRoot: diffRoot,
    count: diffCases.length,
    cases: diffCases,
  });

  return { reportPath, cases: diffCases };
}

function parseShaderballMaterialVariants(text) {
  const suiteMatches = [...text.matchAll(/^        "([^"]+)" \{/gm)];
  const variantsBySuite = new Map();

  for (const [index, match] of suiteMatches.entries()) {
    const suite = match[1];
    const start = match.index;
    const end = suiteMatches[index + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    const variants = [...block.matchAll(/^                    "([^"]+)" \{/gm)]
      .map((variantMatch) => variantMatch[1]);
    variantsBySuite.set(suite, variants);
  }

  return variantsBySuite;
}

function mapShaderballVariantToReference(suite, variant) {
  if (suite === "nodes") {
    return {
      id: `nodes/${variant}`,
      referenceRelativeDir: `nodes/${variant}`,
    };
  }

  const separator = variant.indexOf("__");
  if (separator < 0) {
    return null;
  }

  const family = variant.slice(0, separator);
  const material = variant.slice(separator + 2);
  if (suite === "library") {
    return {
      id: `library/${family}/${material}`,
      referenceRelativeDir: `surfaces/${family}/${material}`,
    };
  }
  if (suite === "showcase") {
    return {
      id: `showcase/${family}/${material}`,
      referenceRelativeDir: `showcase/${family}/${material}`,
    };
  }
  return null;
}

async function resolveReferencePng(referenceRoot, referenceRelativeDir, referenceRenderers) {
  const candidates = [];
  let selected = null;

  for (const renderer of referenceRenderers) {
    const png = path.join(referenceRoot, referenceRelativeDir, `${renderer}.png`);
    const exists = await pathExists(png);
    const candidate = { renderer, png, exists };
    candidates.push(candidate);
    if (!selected && exists) {
      selected = candidate;
    }
  }

  if (selected) {
    return {
      renderer: selected.renderer,
      png: selected.png,
      exists: true,
      candidates,
    };
  }

  const fallbackRenderer = referenceRenderers[0] ?? null;
  return {
    renderer: fallbackRenderer,
    png: fallbackRenderer
      ? path.join(referenceRoot, referenceRelativeDir, `${fallbackRenderer}.png`)
      : null,
    exists: false,
    candidates,
  };
}

function selectShaderballCases(cases, { mode, selection, caseIds = [] }) {
  const requestedCaseIds = new Set(caseIds);
  if (requestedCaseIds.size > 0) {
    return cases.filter((entry) => requestedCaseIds.has(entry.id));
  }

  if (mode === "all" || selection?.mode === "all") {
    return cases;
  }

  const requested = new Set(selection?.cases ?? []);
  if (requested.size === 0) {
    return cases;
  }

  return cases.filter((entry) => requested.has(entry.id));
}

function shaderballResultsSubdir(materialXDebugOutput) {
  return materialXDebugOutput === "none"
    ? "shaderball"
    : `shaderball-${materialXDebugOutput}`;
}

function startViteServer() {
  const command = process.platform === "win32" ? process.execPath : "npm";
  const args = process.platform === "win32"
    ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), "run", "dev"]
    : ["run", "dev"];
  return spawn(command, args, {
    stdio: "ignore",
    shell: false,
  });
}

function stopViteServer(server, force = false) {
  if (!server || server.exitCode !== null || server.killed) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  server.kill(force ? "SIGKILL" : "SIGTERM");
}

async function forceSquareAutomationViewport(page, size) {
  await page.addStyleTag({
    content: `
      :root.automation-mode body {
        overflow: hidden !important;
      }
      :root.automation-mode .shell,
      :root.automation-mode .viewport {
        width: ${size}px !important;
        height: ${size}px !important;
        min-height: ${size}px !important;
        max-height: ${size}px !important;
      }
    `,
  });
}

async function screenshotViewportCanvas(page, outputPath) {
  const box = await page.locator(".viewport canvas").last().boundingBox();
  if (!box) {
    throw new Error("Viewport canvas is unavailable for capture.");
  }
  await page.screenshot({
    path: outputPath,
    clip: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    },
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

async function main() {
  const useAll = process.argv.includes("--all");
  const enumerateOnly = process.argv.includes("--enumerate-only");
  const baseUrlArgIndex = process.argv.indexOf("--base-url");
  const baseUrl = baseUrlArgIndex >= 0 ? process.argv[baseUrlArgIndex + 1] : null;
  const caseIds = readCaseIds(process.argv);
  const materialXDebugOutput = readMaterialXDebugOutput(process.argv);
  const mode = useAll ? "all" : null;

  if (enumerateOnly) {
    const result = await enumerateShaderballCases({ mode, caseIds });
    const missing = result.cases.filter((entry) => !entry.baselineExists).length;
    console.log(`Enumerated ${result.cases.length} shaderball case(s); missing ${missing} baseline image(s).`);
    console.log(result.reportPath);
    return;
  }

  const renderPlan = await renderShaderballCases({
    mode,
    baseUrl,
    caseIds,
    materialXDebugOutput,
  });
  const diffPlan = await diffShaderballCases({
    mode,
    baseUrl,
    renderedCases: renderPlan.cases,
    caseIds,
    materialXDebugOutput,
  });
  const missing = diffPlan.cases.filter((entry) => !entry.baselineExists).length;
  console.log(`Rendered ${renderPlan.cases.length} shaderball case(s).`);
  console.log(`Diffed ${diffPlan.cases.length} shaderball case(s); missing ${missing} baseline image(s).`);
  console.log(diffPlan.reportPath);
}

function readMaterialXDebugOutput(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--materialx-debug-output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--materialx-debug-output requires a value");
      }
      return parseMaterialXDebugOutput(value);
    }
    if (arg.startsWith("--materialx-debug-output=")) {
      return parseMaterialXDebugOutput(arg.slice("--materialx-debug-output=".length));
    }
  }
  return "none";
}

function parseMaterialXDebugOutput(value) {
  if (value === "none" || value === "graphColor") {
    return value;
  }
  throw new Error(`Unsupported MaterialX debug output "${value}". Expected "none" or "graphColor".`);
}

function readCaseIds(argv) {
  const caseIds = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--case requires a case id");
      }
      caseIds.push(value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, ""));
      index += 1;
    } else if (arg.startsWith("--case=")) {
      caseIds.push(arg.slice("--case=".length).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, ""));
    }
  }
  return caseIds;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
