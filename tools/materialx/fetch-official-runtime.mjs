#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const VERSION = "1.39.5";
const ASSET = "MaterialX_JavaScript.zip";
const SOURCE_URL = `https://github.com/AcademySoftwareFoundation/MaterialX/releases/download/v${VERSION}/${ASSET}`;
const SHA256 = "fbb0afe06064b4a5606d52dafe3b740f093de084000f11340ac0a6a88a7ecb0b";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = join(repoRoot, "public", "materialx", VERSION);
const tmpDir = join(repoRoot, ".tmp", "materialx-runtime");
const zipPath = join(tmpDir, ASSET);

await rm(tmpDir, { recursive: true, force: true });
await mkdir(tmpDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

console.log(`Downloading ${SOURCE_URL}`);
const response = await fetch(SOURCE_URL);
if (!response.ok || !response.body) {
  throw new Error(`Download failed: ${response.status} ${response.statusText}`);
}
await pipeline(response.body, createWriteStream(zipPath));

const hash = createHash("sha256");
hash.update(await readFile(zipPath));
const digest = hash.digest("hex");
if (digest !== SHA256) {
  throw new Error(`SHA-256 mismatch for ${ASSET}: expected ${SHA256}, got ${digest}`);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await unzip(zipPath, outputDir);
await writeFile(
  join(outputDir, "metadata.json"),
  JSON.stringify(
    {
      name: "MaterialX JavaScript Runtime",
      version: VERSION,
      sourceUrl: SOURCE_URL,
      archive: ASSET,
      sha256: SHA256,
      fetchedAt: new Date().toISOString(),
    },
    null,
    2
  ) + "\n"
);

console.log(`MaterialX ${VERSION} JavaScript runtime written to ${outputDir}`);

async function unzip(source, destination) {
  const executable = process.platform === "win32" ? "powershell.exe" : "unzip";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-Command", `Expand-Archive -Path '${source}' -DestinationPath '${destination}' -Force`]
    : ["-q", source, "-d", destination];

  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${executable} exited with ${code}`)));
  });
}
