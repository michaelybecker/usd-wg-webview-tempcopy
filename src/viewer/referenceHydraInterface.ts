// QUARANTINE: this module only serves the legacy ReferenceHydraSyncDriver
// path (native pushes geometry into Three via JS callbacks). It is deleted
// whole-file in Phase 4 of the geometry-runtime unification plan — do not
// grow it or add new callers.

import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
} from "three";
import { faceExpandAttr } from "./GeometryBuilder";

export type ReferenceHydraRPrim = {
  updatePoints: (points: Float32Array) => void;
  updateIndices: (indices: Int32Array) => void;
  setTransform: (matrix: Float32Array) => void;
};

export type ReferenceHydraRenderInterface = {
  createRPrim: (type: string, id: string) => ReferenceHydraRPrim;
};

export type ReferenceHydraViewportHooks = {
  stageRoot: Group;
  meshByPath: Map<string, Mesh>;
  pathByMesh: Map<Mesh, string>;
  resetStage: () => void;
  setExpandedVertexNormals: (
    geometry: BufferGeometry,
    points: ArrayLike<number>,
    indices: ArrayLike<number>
  ) => void;
};

export function createReferenceHydraRenderInterface(
  hooks: ReferenceHydraViewportHooks
): ReferenceHydraRenderInterface {
  hooks.resetStage();

  return {
    createRPrim: (_type: string, id: string): ReferenceHydraRPrim => {
      const existing = hooks.meshByPath.get(id);
      const mesh = existing ?? new Mesh(
        new BufferGeometry(),
        new MeshPhysicalMaterial({
          color: new Color(0xb8c4cf),
          metalness: 0.05,
          roughness: 0.55,
          side: DoubleSide,
        })
      );
      const geometry = mesh.geometry as BufferGeometry;
      if (!existing) {
        mesh.name = id.split("/").filter(Boolean).pop() || id;
        mesh.matrixAutoUpdate = false;
        hooks.stageRoot.add(mesh);
        hooks.meshByPath.set(id, mesh);
        hooks.pathByMesh.set(mesh, id);
      }

      let points = new Float32Array();
      let indices = new Int32Array();

      const updateGeometry = (): void => {
        if (!points.length || !indices.length) return;
        const positions = faceExpandAttr(points, indices, 3);
        const positionAttr = geometry.attributes.position;
        if (positionAttr && positionAttr.count * 3 === positions.length) {
          (positionAttr.array as Float32Array).set(positions);
          positionAttr.needsUpdate = true;
        } else {
          geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
        }
        hooks.setExpandedVertexNormals(geometry, points, indices);
        geometry.computeBoundingSphere();
      };

      return {
        updatePoints: (nextPoints: Float32Array): void => {
          points = new Float32Array(nextPoints);
          updateGeometry();
        },
        updateIndices: (nextIndices: Int32Array): void => {
          indices = new Int32Array(nextIndices);
          updateGeometry();
        },
        setTransform: (matrix: Float32Array): void => {
          if (matrix.length !== 16) return;
          mesh.matrix.set(...(Array.from(matrix) as Parameters<typeof mesh.matrix.set>));
          mesh.matrix.transpose();
          mesh.matrixAutoUpdate = false;
        },
      };
    },
  };
}
