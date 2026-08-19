import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  Box3,
  Matrix3,
  Vector2,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const DEFAULT_GLB = "/home/mbecker/dev/mtlx/material-samples/viewer/ShaderBall.glb";
const DEFAULT_USD = "/home/mbecker/dev/mtlx/material-samples/usd/materialx_shaderball/ShaderBall.usdc";
const DEFAULT_USDCAT = "/home/mbecker/USD/bin/usdcat";

const MESH_NAMES = ["Preview_Mesh", "Calibration_Mesh"];

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    glb: DEFAULT_GLB,
    usd: DEFAULT_USD,
    usdcat: DEFAULT_USDCAT,
    out: path.resolve("tools/usd-material-fidelity/reports/shaderball-streams.json"),
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--glb") result.glb = args[++i];
    else if (arg === "--usd") result.usd = args[++i];
    else if (arg === "--usdcat") result.usdcat = args[++i];
    else if (arg === "--out") result.out = args[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function loadUsda({ usd, usdcat }) {
  if (usd.endsWith(".usda")) {
    return fs.readFileSync(usd, "utf8");
  }
  try {
    return execFileSync(usdcat, [usd], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.startsWith("#usda")) {
      return error.stdout;
    }
    throw error;
  }
}

function findBalanced(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("Unbalanced array in USDA");
}

function extractArrayPayload(section, declaration) {
  const escaped = declaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+");
  const match = new RegExp(escaped).exec(section);
  if (!match) return null;
  const open = section.indexOf("[", match.index + match[0].length);
  if (open < 0) return null;
  const close = findBalanced(section, open);
  return section.slice(open + 1, close);
}

function parseNumbers(payload) {
  if (payload == null) return null;
  return Array.from(payload.matchAll(/-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/g), (m) => Number(m[0]));
}

function parseFloatTuples(section, declaration, width) {
  const values = parseNumbers(extractArrayPayload(section, declaration));
  if (!values) return null;
  if (values.length % width !== 0) {
    throw new Error(`${declaration} has ${values.length} scalar values, which is not divisible by ${width}`);
  }
  return new Float32Array(values);
}

function tupleCount(array, width) {
  return array ? array.length / width : 0;
}

function parseIntArray(section, declaration) {
  const values = parseNumbers(extractArrayPayload(section, declaration));
  return values ? Int32Array.from(values) : null;
}

function meshBlock(text, name) {
  const xformStart = text.indexOf(`def Xform "${name}"`);
  if (xformStart < 0) throw new Error(`Missing Xform ${name}`);
  const meshStart = text.indexOf(`def Mesh "${name}"`, xformStart);
  if (meshStart < 0) throw new Error(`Missing Mesh ${name}`);

  const nextXform = text.indexOf("\n    def Xform ", xformStart + 1);
  const nextScope = text.indexOf("\n    def Scope ", xformStart + 1);
  const candidates = [nextXform, nextScope].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : text.length;
  return text.slice(xformStart, end);
}

function parseVec3Assignment(block, name, fallback) {
  const match = block.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} = \\(([^)]+)\\)`));
  if (!match) return fallback;
  return match[1].split(",").map((part) => Number(part.trim()));
}

function parseUsdMeshes(usda) {
  const meshes = new Map();
  for (const name of MESH_NAMES) {
    const block = meshBlock(usda, name);
    meshes.set(name, {
      name,
      scale: parseVec3Assignment(block, "xformOp:scale", [1, 1, 1]),
      translate: parseVec3Assignment(block, "xformOp:translate", [0, 0, 0]),
      points: parseFloatTuples(block, "point3f[] points", 3),
      normals: parseFloatTuples(block, "normal3f[] normals", 3),
      st: parseFloatTuples(block, "texCoord2f[] primvars:st", 2),
      faceVertexIndices: parseIntArray(block, "int[] faceVertexIndices"),
      stIndices: parseIntArray(block, "int[] primvars:st:indices"),
      doubleSided: block.match(/uniform bool doubleSided = (\d)/)?.[1] === "1",
      normalInterpolation: block.slice(block.indexOf("normal3f[] normals"), block.indexOf("point3f[] points")).match(/interpolation = "([^"]+)"/)?.[1] ?? null,
      stInterpolation: block.slice(block.indexOf("texCoord2f[] primvars:st"), block.indexOf("int[] primvars:st:indices")).match(/interpolation = "([^"]+)"/)?.[1] ?? null,
    });
  }
  return meshes;
}

async function parseGlbMeshes(glbPath) {
  const buffer = fs.readFileSync(glbPath);
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      "",
      resolve,
      reject,
    );
  });
  gltf.scene.updateMatrixWorld(true);

  const meshes = new Map();
  gltf.scene.traverse((object) => {
    if (!object.isMesh || !MESH_NAMES.includes(object.name)) return;
    const geometry = object.geometry;
    meshes.set(object.name, {
      name: object.name,
      object,
      geometry,
      index: geometry.index?.array ?? null,
      position: geometry.getAttribute("position"),
      normal: geometry.getAttribute("normal"),
      uv: geometry.getAttribute("uv"),
      tangent: geometry.getAttribute("tangent"),
    });
  });
  return meshes;
}

function usdPointToGlbWorld(mesh, index, transformMode) {
  const i = index * 3;
  const sx = mesh.scale[0];
  const sy = mesh.scale[1];
  const sz = mesh.scale[2];
  const tx = mesh.translate[0];
  const ty = mesh.translate[1];
  const tz = mesh.translate[2];
  const px = mesh.points[i];
  const py = mesh.points[i + 1];
  const pz = mesh.points[i + 2];
  const x = transformMode === "scaleThenTranslate" ? px * sx + tx : (px + tx) * sx;
  const y = transformMode === "scaleThenTranslate" ? py * sy + ty : (py + ty) * sy;
  const z = transformMode === "scaleThenTranslate" ? pz * sz + tz : (pz + tz) * sz;
  return new Vector3(x, z, -y);
}

function usdNormalToGlbWorld(mesh, corner) {
  const i = corner * 3;
  return new Vector3(mesh.normals[i], mesh.normals[i + 2], -mesh.normals[i + 1]).normalize();
}

function glbPositionWorld(mesh, vertexIndex) {
  const p = new Vector3().fromBufferAttribute(mesh.position, vertexIndex);
  return p.applyMatrix4(mesh.object.matrixWorld);
}

function glbNormalWorld(mesh, vertexIndex, normalMatrix) {
  const n = new Vector3().fromBufferAttribute(mesh.normal, vertexIndex);
  return n.applyMatrix3(normalMatrix).normalize();
}

function glbUv(mesh, vertexIndex) {
  return new Vector2().fromBufferAttribute(mesh.uv, vertexIndex);
}

function accumulateDelta(stats, delta) {
  stats.count += 1;
  stats.max = Math.max(stats.max, delta);
  stats.sum += delta;
  stats.sumSq += delta * delta;
}

function finishStats(stats) {
  if (!stats.count) return { count: 0, max: null, mean: null, rms: null };
  return {
    count: stats.count,
    max: stats.max,
    mean: stats.sum / stats.count,
    rms: Math.sqrt(stats.sumSq / stats.count),
  };
}

function newStats() {
  return { count: 0, max: 0, sum: 0, sumSq: 0 };
}

function compareMesh(glbMesh, usdMesh) {
  const normalMatrix = new Matrix3().getNormalMatrix(glbMesh.object.matrixWorld);
  const positionScaleThenTranslateStats = newStats();
  const positionTranslateThenScaleStats = newStats();
  const normalStats = newStats();
  const uvStats = newStats();
  const uvFlipVStats = newStats();

  const cornerCount = glbMesh.index?.length ?? 0;
  for (let corner = 0; corner < cornerCount; corner += 1) {
    const vertexIndex = glbMesh.index[corner];
    const usdPointIndex = usdMesh.faceVertexIndices[corner];
    const usdUvIndex = usdMesh.stIndices?.[corner] ?? usdPointIndex;

    const glbWorld = glbPositionWorld(glbMesh, vertexIndex);
    accumulateDelta(
      positionScaleThenTranslateStats,
      glbWorld.distanceTo(usdPointToGlbWorld(usdMesh, usdPointIndex, "scaleThenTranslate")),
    );
    accumulateDelta(
      positionTranslateThenScaleStats,
      glbWorld.distanceTo(usdPointToGlbWorld(usdMesh, usdPointIndex, "translateThenScale")),
    );
    accumulateDelta(normalStats, glbNormalWorld(glbMesh, vertexIndex, normalMatrix).distanceTo(usdNormalToGlbWorld(usdMesh, corner)));

    const gUv = glbUv(glbMesh, vertexIndex);
    const uvi = usdUvIndex * 2;
    const uUv = new Vector2(usdMesh.st[uvi], usdMesh.st[uvi + 1]);
    accumulateDelta(uvStats, gUv.distanceTo(uUv));
    accumulateDelta(uvFlipVStats, gUv.distanceTo(new Vector2(uUv.x, 1 - uUv.y)));
  }

  const glbBox = new Box3().setFromObject(glbMesh.object);
  const center = new Vector3();
  const size = new Vector3();
  glbBox.getCenter(center);
  glbBox.getSize(size);

  return {
    counts: {
      glb: {
        indices: glbMesh.index?.length ?? 0,
        positions: glbMesh.position.count,
        normals: glbMesh.normal.count,
        uvs: glbMesh.uv.count,
        tangents: glbMesh.tangent?.count ?? 0,
      },
      usd: {
        faceVertexIndices: usdMesh.faceVertexIndices?.length ?? 0,
        points: tupleCount(usdMesh.points, 3),
        normals: tupleCount(usdMesh.normals, 3),
        st: tupleCount(usdMesh.st, 2),
        stIndices: usdMesh.stIndices?.length ?? 0,
      },
    },
    usdMetadata: {
      doubleSided: usdMesh.doubleSided,
      normalInterpolation: usdMesh.normalInterpolation,
      stInterpolation: usdMesh.stInterpolation,
      scale: usdMesh.scale,
      translateZUp: usdMesh.translate,
    },
    glbWorldBounds: {
      center: center.toArray(),
      size: size.toArray(),
    },
    deltas: {
      positionWorldScaleThenTranslate: finishStats(positionScaleThenTranslateStats),
      positionWorldTranslateThenScale: finishStats(positionTranslateThenScaleStats),
      normalWorld: finishStats(normalStats),
      uv: finishStats(uvStats),
      uvWithUsdVFlipped: finishStats(uvFlipVStats),
    },
    tangents: {
      glbAuthored: Boolean(glbMesh.tangent),
      usdAuthored: false,
      note: "USD file does not author tangents; current runtime must compute or synthesize the tangent basis.",
    },
  };
}

async function main() {
  const args = parseArgs();
  const usda = loadUsda(args);
  const usdMeshes = parseUsdMeshes(usda);
  const glbMeshes = await parseGlbMeshes(args.glb);

  const meshes = {};
  for (const name of MESH_NAMES) {
    meshes[name] = compareMesh(glbMeshes.get(name), usdMeshes.get(name));
  }

  const report = {
    glb: args.glb,
    usd: args.usd,
    assumptions: [
      "USD is Z-up and is converted to GLB/Three Y-up using (x, z, -y).",
      "USD mesh Xform scale/translate is applied before axis conversion.",
      "USD normals are compared as face-varying corner normals against GLB indexed vertex normals expanded by GLB indices.",
    ],
    meshes,
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Wrote ${args.out}`);
  for (const [name, mesh] of Object.entries(meshes)) {
    console.log(name);
    console.log(`  counts GLB ${JSON.stringify(mesh.counts.glb)} USD ${JSON.stringify(mesh.counts.usd)}`);
    console.log(`  position scale->translate max ${mesh.deltas.positionWorldScaleThenTranslate.max} mean ${mesh.deltas.positionWorldScaleThenTranslate.mean}`);
    console.log(`  position translate->scale max ${mesh.deltas.positionWorldTranslateThenScale.max} mean ${mesh.deltas.positionWorldTranslateThenScale.mean}`);
    console.log(`  normal   max ${mesh.deltas.normalWorld.max} mean ${mesh.deltas.normalWorld.mean}`);
    console.log(`  uv       max ${mesh.deltas.uv.max} mean ${mesh.deltas.uv.mean}`);
    console.log(`  uv flipV max ${mesh.deltas.uvWithUsdVFlipped.max} mean ${mesh.deltas.uvWithUsdVFlipped.mean}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
