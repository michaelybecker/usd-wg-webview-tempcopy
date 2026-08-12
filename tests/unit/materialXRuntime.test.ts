import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { MaterialXAssetResolver, assetPathCandidates } from "../../src/materialx/MaterialXAssetResolver";
import { getMaterialXRuntime } from "../../src/materialx/MaterialXRuntime";

describe("MaterialXAssetResolver", () => {
  it("matches package-relative, material-relative, and basename candidates", () => {
    expect(assetPathCandidates("textures/base.png", "materials").has("materials/textures/base.png")).toBe(true);
    expect(assetPathCandidates("/scene.usdz[assets/base.png]").has("assets/base.png")).toBe(true);
    expect(assetPathCandidates("/scene.usdz[assets/base.png]").has("base.png")).toBe(true);
  });

  it("returns object URLs and revokes them on cleanup", () => {
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const resolver = new MaterialXAssetResolver();

    const resolved = resolver.resolve("./textures/base.png", "materials/look.mtlx", [
      { path: "materials/textures/base.png", mimeType: "image/png", data: new Uint8Array([1]) },
    ]);

    expect(resolved?.url).toBe("blob:test");
    resolver.revokeUrls();
    expect(revokeSpy).toHaveBeenCalledWith("blob:test");
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});

describe("MaterialXRuntime", () => {
  it("initializes once and compiles ESSL from the official runtime", async () => {
    const baseUrl = pathToFileURL(`${process.cwd()}/public/materialx/1.39.5`).href;
    const first = await getMaterialXRuntime(baseUrl);
    const second = await getMaterialXRuntime(baseUrl);

    expect(second).toBe(first);

    const source = await readFile("tests/corpus/materialx-tiled/material/tiled-letter.mtlx", "utf8");

    const result = await first.compile(source, { path: "tiled-letter.mtlx", target: "essl" });

    expect(result.diagnostics).toEqual([]);
    expect(result.vertexSource).toContain("void main()");
    expect(result.fragmentSource).toContain("standard_surface");
  }, 30000);
});
