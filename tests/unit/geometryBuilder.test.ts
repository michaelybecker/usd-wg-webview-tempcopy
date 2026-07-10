import { Float32BufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import {
  applyMaterialXUvOptions,
  buildIndexedVertexNormals,
  faceExpandAttr,
  geometryFingerprint,
  getRenderableMaterialKey,
  getUniqueSubsetMaterials,
  normalWeldKey,
  renderableHasMaterialX,
} from "../../src/viewer/GeometryBuilder";
import type { RenderableMesh } from "../../src/usd/types";

function mesh(overrides: Partial<RenderableMesh> = {}): RenderableMesh {
  return {
    path: "/World/Mesh",
    name: "Mesh",
    points: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
    matrix: [],
    ...overrides,
  };
}

const mtlx = { path: "m.mtlx", mimeType: "application/xml", data: new Uint8Array([1]) };

describe("faceExpandAttr", () => {
  it("copies stride-sized runs per index", () => {
    const data = [10, 11, 20, 21, 30, 31];
    const out = faceExpandAttr(data, [2, 0, 1], 2);
    expect([...out]).toEqual([30, 31, 10, 11, 20, 21]);
  });

  it("repeats shared vertices per face corner", () => {
    const out = faceExpandAttr([1, 2, 3, 4, 5, 6], [0, 1, 0], 3);
    expect([...out]).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3]);
  });
});

describe("normalWeldKey", () => {
  it("welds positions within 1e-5", () => {
    expect(normalWeldKey(0.100001, 0, 0)).toBe(normalWeldKey(0.1000005, 0, 0));
    expect(normalWeldKey(0.1001, 0, 0)).not.toBe(normalWeldKey(0.1, 0, 0));
  });
});

describe("buildIndexedVertexNormals", () => {
  it("produces the face normal for a single triangle", () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const normals = buildIndexedVertexNormals(points, [0, 1, 2]);
    for (let i = 0; i < 3; i++) {
      expect(normals[i * 3 + 0]).toBeCloseTo(0);
      expect(normals[i * 3 + 1]).toBeCloseTo(0);
      expect(normals[i * 3 + 2]).toBeCloseTo(1);
    }
  });

  it("averages normals across position-welded duplicate vertices", () => {
    // Two triangles sharing an edge, folded 90 degrees, with duplicated
    // vertices at the shared edge (different indices, same positions).
    const points = [
      0, 0, 0, 1, 0, 0, 0, 1, 0, // tri A in XY plane (+Z normal)
      0, 0, 0, 1, 0, 0, 0, 0, -1, // tri B: rotated so its normal differs
    ];
    const normals = buildIndexedVertexNormals(points, [0, 1, 2, 4, 3, 5]);
    // Vertices 0 and 3 share a position, so they get the same welded normal.
    expect(normals[0]).toBeCloseTo(normals[9]);
    expect(normals[1]).toBeCloseTo(normals[10]);
    expect(normals[2]).toBeCloseTo(normals[11]);
  });
});

describe("geometryFingerprint", () => {
  it("is stable for identical input", () => {
    const points = Array.from({ length: 30 }, (_, i) => i * 0.5);
    expect(geometryFingerprint(points)).toBe(geometryFingerprint([...points]));
  });

  it("changes when a sampled point changes", () => {
    const points = Array.from({ length: 30 }, (_, i) => i * 0.5);
    const moved = [...points];
    moved[0] += 1;
    expect(geometryFingerprint(moved)).not.toBe(geometryFingerprint(points));
  });

  it("documents the 8-point false negative: interior-only changes can go undetected", () => {
    // 100 floats; the 8 samples hit indices 0,14,28,42,56,70,84,99.
    const points = Array.from({ length: 100 }, (_, i) => i);
    const moved = [...points];
    moved[1] += 100; // between sample points
    expect(geometryFingerprint(moved)).toBe(geometryFingerprint(points));
  });
});

describe("renderableHasMaterialX / material keys", () => {
  it("detects MaterialX on the direct material and on subsets", () => {
    expect(renderableHasMaterialX(mesh())).toBe(false);
    expect(renderableHasMaterialX(mesh({ material: { materialX: mtlx } }))).toBe(true);
    expect(
      renderableHasMaterialX(
        mesh({
          materialSubsets: [
            { path: "/s", name: "s", start: 0, count: 3, material: { materialX: mtlx } },
          ],
        })
      )
    ).toBe(true);
  });

  it("keys MaterialX materials on flip state, path and material name", () => {
    const renderable = mesh({ material: { materialX: { ...mtlx, materialName: "M" } } });
    expect(getRenderableMaterialKey(renderable, true)).toBe("mtlx:flipv:m.mtlx:M");
    expect(getRenderableMaterialKey(renderable, false)).toBe("mtlx:noflipv:m.mtlx:M");
  });

  it("keys plain materials on path with default fallback", () => {
    expect(getRenderableMaterialKey(mesh(), true)).toBe("default");
    expect(getRenderableMaterialKey(mesh({ material: { path: "/M" } }), true)).toBe("/M");
  });

  it("dedupes subset materials by path and joins subset keys", () => {
    const renderable = mesh({
      materialSubsets: [
        { path: "/a", name: "a", start: 0, count: 3, material: { path: "/M1" } },
        { path: "/b", name: "b", start: 3, count: 3, material: { path: "/M1" } },
        { path: "/c", name: "c", start: 6, count: 3, material: { path: "/M2" } },
      ],
    });
    expect(getUniqueSubsetMaterials(renderable)).toHaveLength(2);
    expect(getRenderableMaterialKey(renderable, true)).toBe("/M1|/M2");
  });
});

describe("applyMaterialXUvOptions", () => {
  it("flips V only for MaterialX renderables with flip enabled", () => {
    const make = () => new Float32BufferAttribute(new Float32Array([0, 0.25, 1, 0.75]), 2);

    const flipped = make();
    applyMaterialXUvOptions(flipped, mesh({ material: { materialX: mtlx } }), true);
    expect(flipped.getY(0)).toBeCloseTo(0.75);
    expect(flipped.getY(1)).toBeCloseTo(0.25);

    const noMtlx = make();
    applyMaterialXUvOptions(noMtlx, mesh(), true);
    expect(noMtlx.getY(0)).toBeCloseTo(0.25);

    const flipOff = make();
    applyMaterialXUvOptions(flipOff, mesh({ material: { materialX: mtlx } }), false);
    expect(flipOff.getY(0)).toBeCloseTo(0.25);
  });
});
