import { describe, expect, it } from "vitest";
import { isUsdFile, pickLikelyRootFile } from "../../src/usd/fileIntake";

function makeFile(relativePath: string): File {
  const name = relativePath.split("/").pop() ?? relativePath;
  const file = new File(["#usda 1.0"], name);
  if (relativePath.includes("/")) {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: relativePath,
    });
  }
  return file;
}

describe("isUsdFile", () => {
  it("accepts the four USD extensions case-insensitively", () => {
    for (const name of ["a.usd", "a.usda", "a.usdc", "a.usdz", "a.USD", "a.USDA"]) {
      expect(isUsdFile(makeFile(name)), name).toBe(true);
    }
  });

  it("rejects non-USD files", () => {
    for (const name of ["a.mtlx", "a.png", "a.zip", "a.usdx", "a"]) {
      expect(isUsdFile(makeFile(name)), name).toBe(false);
    }
  });

  it("treats an extensionless file named after an extension as USD (current quirk)", () => {
    // split(".").pop() on "usd" returns the whole name, which is in the
    // extension set. Characterizes today's behavior.
    expect(isUsdFile(makeFile("usd"))).toBe(true);
  });
});

describe("pickLikelyRootFile", () => {
  it("returns undefined for an empty list", () => {
    expect(pickLikelyRootFile([])).toBeUndefined();
  });

  it("falls back to the first file when nothing is a USD file", () => {
    const files = [makeFile("texture.png"), makeFile("material.mtlx")];
    expect(pickLikelyRootFile(files)).toBe(files[0]);
  });

  it("picks the single shallowest USD file", () => {
    const files = [
      makeFile("asset/payloads/part.usdc"),
      makeFile("asset/asset_top.usda"),
      makeFile("asset/textures/diffuse.png"),
    ];
    expect(pickLikelyRootFile(files)).toBe(files[1]);
  });

  it("prefers the file whose basename matches its parent folder", () => {
    const files = [
      makeFile("kitchen_set/other.usd"),
      makeFile("kitchen_set/kitchen_set.usd"),
    ];
    expect(pickLikelyRootFile(files)).toBe(files[1]);
  });

  it("prefers root-keyword names over other candidates", () => {
    const files = [
      makeFile("pkg/zebra.usd"),
      makeFile("pkg/scene.usd"),
      makeFile("pkg/apple.usd"),
    ];
    expect(pickLikelyRootFile(files)).toBe(files[1]);
  });

  it("ranks generic .usd above .usda above .usdc above .usdz", () => {
    const files = [
      makeFile("pkg/b.usdz"),
      makeFile("pkg/c.usdc"),
      makeFile("pkg/d.usda"),
      makeFile("pkg/e.usd"),
    ];
    expect(pickLikelyRootFile(files)).toBe(files[3]);
  });

  it("breaks remaining ties alphabetically by path", () => {
    const files = [makeFile("pkg/beta.usd"), makeFile("pkg/alpha.usd")];
    expect(pickLikelyRootFile(files)).toBe(files[1]);
  });

  it("ignores deeper USD files even when they carry root keywords", () => {
    const files = [
      makeFile("asset/deep/root.usd"),
      makeFile("asset/leaf.usdc"),
    ];
    expect(pickLikelyRootFile(files)).toBe(files[1]);
  });
});
