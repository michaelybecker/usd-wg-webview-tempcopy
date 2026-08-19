import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFidelityCacheRoot, pathExists, writeJson } from "./common.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(TOOL_ROOT, "sources.json");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = JSON.parse(await fs.readFile(SOURCES_PATH, "utf8"));
  const source = sources.materialSamples;
  const cacheRoot = path.resolve(args.cacheRoot ?? getFidelityCacheRoot());
  const sourceRoot = path.join(cacheRoot, source.sourceDirectory);
  const packageRoot = path.join(cacheRoot, source.portableShaderballDirectory);

  await fs.mkdir(cacheRoot, { recursive: true });
  await ensurePinnedCheckout(source, sourceRoot);
  await buildPortableShaderball(sourceRoot, packageRoot);
  await writeJson(path.join(cacheRoot, "setup.json"), {
    generatedAt: new Date().toISOString(),
    materialSamples: {
      repository: source.repository,
      commit: source.commit,
      sourceRoot,
    },
    shaderballPackageRoot: packageRoot,
  });

  console.log(`Material samples: ${sourceRoot}`);
  console.log(`Portable shaderball: ${packageRoot}`);
  console.log("Run: npm run usd-material-fidelity:shaderball:all");
}

function parseArgs(args) {
  const parsed = { cacheRoot: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cache-root") {
      parsed.cacheRoot = args[++index];
      if (!parsed.cacheRoot) {
        throw new Error("--cache-root requires a directory.");
      }
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node tools/usd-material-fidelity/setup.mjs [--cache-root <directory>]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function ensurePinnedCheckout(source, sourceRoot) {
  const gitDirectory = path.join(sourceRoot, ".git");
  if (!(await pathExists(gitDirectory))) {
    if (await pathExists(sourceRoot)) {
      throw new Error(`Source directory exists but is not a git checkout: ${sourceRoot}`);
    }
    await run("git", ["clone", "--no-checkout", source.repository, sourceRoot]);
  }

  if (process.platform === "win32") {
    await run("git", ["-C", sourceRoot, "config", "core.longpaths", "true"]);
  }

  const remote = (await run("git", ["-C", sourceRoot, "remote", "get-url", "origin"], { capture: true })).trim();
  if (remote !== source.repository) {
    throw new Error(`Unexpected material-samples origin at ${sourceRoot}: ${remote}`);
  }

  await run("git", ["-C", sourceRoot, "fetch", "--depth", "1", "origin", source.commit]);
  await run("git", ["-C", sourceRoot, "checkout", "--detach", source.commit]);
}

async function buildPortableShaderball(sourceRoot, packageRoot) {
  const script = path.join(sourceRoot, "usd", "build_usd_shaderball.py");
  const args = [script, "--texture-mode", "portable", "--output-root", packageRoot];
  const commands = process.env.PYTHON
    ? [[process.env.PYTHON, args]]
    : process.platform === "win32"
      ? [["py", ["-3", ...args]], ["python", args]]
      : [["python3", args], ["python", args]];

  let lastError;
  for (const [command, commandArgs] of commands) {
    try {
      await run(command, commandArgs);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        if (!capture) {
          process.stdout.write(stdout);
          process.stdout.write(stderr);
        }
        resolve(capture ? stdout : "");
      } else {
        reject(new Error(`${command} exited with code ${code}.\n${stderr || stdout}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
