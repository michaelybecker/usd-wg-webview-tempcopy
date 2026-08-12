import {
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
  MeshPhysicalMaterial,
  MirroredRepeatWrapping,
  NearestFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  TextureLoader,
  UniformsUtils,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type Material,
} from "three";
import type { RenderableMaterialX } from "../usd/types";
import { MaterialXAssetResolver } from "./MaterialXAssetResolver";
import { getMaterialXRuntime } from "./MaterialXRuntime";
import type { MaterialXCompileResult } from "./types";

const WHITE_TEXTURE = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
WHITE_TEXTURE.needsUpdate = true;
const BLACK_TEXTURE = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
BLACK_TEXTURE.needsUpdate = true;

export class MaterialXMaterialAdapter {
  constructor(private readonly resolver: MaterialXAssetResolver) {}

  async createMaterial(materialX: RenderableMaterialX): Promise<Material | null> {
    if (!materialX.data?.length) {
      return null;
    }

    const text = new TextDecoder().decode(materialX.data);
    const runtime = await getMaterialXRuntime();
    const compiled = await runtime.compile(text, {
      path: materialX.path,
      materialName: materialX.materialName,
      target: "essl",
      fileTextureVerticalFlip: false,
    });
    materialX.report = compiled.diagnostics;
    if (!compiled.vertexSource || !compiled.fragmentSource) {
      return null;
    }

    const physicalMaterial = await this.createPhysicalPreviewMaterial(text, materialX);
    if (physicalMaterial) {
      physicalMaterial.userData.webviewMaterialX = true;
      physicalMaterial.userData.webviewMaterialXRuntime = "official";
      physicalMaterial.userData.webviewMaterialXHost = "three-physical";
      return physicalMaterial;
    }

    const material = new ShaderMaterial({
      glslVersion: "300 es",
      vertexShader: translateVertexShader(compiled.vertexSource),
      fragmentShader: translateFragmentShader(compiled.fragmentSource),
      uniforms: await this.createUniforms(compiled, text, materialX),
      side: DoubleSide,
    });
    material.onBeforeRender = (_renderer, _scene, camera) => {
      const viewPosition = material.uniforms.u_viewPosition?.value;
      if (viewPosition instanceof Vector3) {
        viewPosition.setFromMatrixPosition(camera.matrixWorld);
      }
    };
    material.userData.webviewMaterialX = true;
    material.userData.webviewMaterialXRuntime = "official";
    return material;
  }

  private async createUniforms(
    compiled: MaterialXCompileResult,
    text: string,
    materialX: RenderableMaterialX
  ): Promise<Record<string, { value: unknown }>> {
    const uniforms: Record<string, { value: unknown }> = {};
    const sources = `${compiled.vertexSource ?? ""}\n${compiled.fragmentSource ?? ""}`;
    for (const match of sources.matchAll(/^uniform\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)(?:\[[^\]]+\])?;/gm)) {
      const [, type, name] = match;
      if (name in uniforms || isThreeManagedUniform(name)) {
        continue;
      }
      uniforms[name] = { value: defaultUniformValue(type, name) };
    }
    for (const uniformDefault of compiled.uniforms ?? []) {
      const uniform = uniforms[uniformDefault.name];
      if (uniform && uniformDefault.value !== undefined) {
        uniform.value = parseMaterialXValue(uniformDefault.type, uniformDefault.value);
      }
    }
    if (uniforms.u_numActiveLightSources) {
      uniforms.u_numActiveLightSources.value = 1;
    }
    if (uniforms.u_lightData) {
      uniforms.u_lightData.value = defaultLightData();
    }

    for (const input of readMaterialXInputValues(text)) {
      const uniform = uniforms[input.name];
      if (uniform) {
        uniform.value = parseMaterialXValue(input.type, input.value);
      }
    }

    const loader = new TextureLoader();
    for (const image of readMaterialXImages(text)) {
      const uniform = uniforms[`${image.name}_file`];
      const resolved = this.resolver.resolve(image.file, materialX.path, materialX.resources ?? []);
      if (uniform && resolved) {
        const texture = await loader.loadAsync(resolved.url);
        applyMaterialXImageOptions(texture, image);
        texture.needsUpdate = true;
        uniform.value = texture;
      }
    }

    return UniformsUtils.clone(uniforms);
  }

  private async createPhysicalPreviewMaterial(text: string, materialX: RenderableMaterialX): Promise<MeshPhysicalMaterial | null> {
    const baseColorImage = findBaseColorImageName(text);
    if (!baseColorImage) {
      return null;
    }
    const image = readMaterialXImages(text).find((entry) => entry.name === baseColorImage);
    if (!image) {
      return null;
    }
    const resolved = this.resolver.resolve(image.file, materialX.path, materialX.resources ?? []);
    if (!resolved) {
      return null;
    }

    const texture = await new TextureLoader().loadAsync(resolved.url);
    applyMaterialXImageOptions(texture, image);
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;

    const roughness = readMaterialXInputValues(text)
      .find((input) => input.name === "specular_roughness" || input.name === "roughness");
    const material = new MeshPhysicalMaterial({
      map: texture,
      color: 0xffffff,
      roughness: roughness ? Number(roughness.value) || 0.5 : 0.5,
      metalness: 0,
      side: DoubleSide,
    });
    return material;
  }
}

function translateVertexShader(source: string): string {
  let translated = source
    .replace(/^#version 300 es\s*/m, "")
    .replace(/^uniform\s+mat4\s+u_worldMatrix;\s*$/m, "")
    .replace(/^uniform\s+mat4\s+u_viewProjectionMatrix;\s*$/m, "")
    .replace(/^uniform\s+mat4\s+u_worldInverseTransposeMatrix;\s*$/m, "")
    .replace(/^in\s+vec3\s+i_position;\s*$/m, "")
    .replace(/^in\s+vec3\s+i_normal;\s*$/m, "")
    .replace(/^in\s+vec2\s+i_texcoord_0;\s*$/m, "")
    .replace(/^in\s+vec3\s+i_texcoord_0;\s*$/m, "")
    .replace(/^in\s+vec2\s+i_texcoord_1;\s*$/m, "")
    .replace(/^in\s+vec3\s+i_texcoord_1;\s*$/m, "")
    .replace(/^in\s+vec2\s+i_texcoord_2;\s*$/m, "")
    .replace(/^in\s+vec3\s+i_texcoord_2;\s*$/m, "")
    .replace(/^in\s+vec2\s+i_texcoord_3;\s*$/m, "")
    .replace(/^in\s+vec3\s+i_texcoord_3;\s*$/m, "")
    .replace(/\bi_position\b/g, "position")
    .replace(/\bi_normal\b/g, "normal")
    .replace(/\bi_tangent\b/g, "tangent")
    .replace(/\bi_texcoord_0\b/g, "uv")
    .replace(/\bi_texcoord_1\b/g, "uv1")
    .replace(/\bi_texcoord_2\b/g, "uv2")
    .replace(/\bi_texcoord_3\b/g, "uv3")
    .replace(/\bu_worldMatrix\b/g, "modelMatrix")
    .replace(/\bu_viewProjectionMatrix\s+\*\s+hPositionWorld/g, "projectionMatrix * viewMatrix * hPositionWorld")
    .replace(/mx_matrix_mul\(u_worldInverseTransposeMatrix,\s*vec4\(normal,\s*0\.0\)\)\.xyz/g, "normalMatrix * normal");
  translated = patchUvVec3Assignments(translated, "uv");
  translated = patchUvVec3Assignments(translated, "uv1");
  translated = patchUvVec3Assignments(translated, "uv2");
  translated = patchUvVec3Assignments(translated, "uv3");
  return translated;
}

function translateFragmentShader(source: string): string {
  return source
    .replace(/^#version 300 es\s*/m, "");
}

function isThreeManagedUniform(name: string): boolean {
  return name === "u_worldMatrix" ||
    name === "u_viewProjectionMatrix" ||
    name === "u_worldInverseTransposeMatrix";
}

function defaultUniformValue(type: string, name = ""): unknown {
  switch (type) {
    case "bool":
      return false;
    case "int":
      return 0;
    case "float":
      return 0;
    case "vec2":
      return new Vector2(1, 1);
    case "vec3":
      return new Vector3(1, 1, 1);
    case "vec4":
      return new Vector4(1, 1, 1, 1);
    case "mat4":
      return new Matrix4();
    case "sampler2D":
      if (name === "u_envRadiance" || name === "u_envIrradiance") {
        return BLACK_TEXTURE;
      }
      return WHITE_TEXTURE;
    case "LightData":
      return defaultLightData();
    default:
      return 0;
  }
}

function defaultLightData(): Array<Record<string, unknown>> {
  const empty = () => ({
    type: 0,
    position: new Vector3(0, 0, 0),
    direction: new Vector3(0, 0, -1),
    color: new Vector3(0, 0, 0),
    intensity: 0,
    decay_rate: 2,
    inner_angle: 0,
    outer_angle: 0,
  });
  return [
    {
      type: 1,
      position: new Vector3(0, 0, 0),
      direction: new Vector3(0.45, -0.8, 0.55).normalize(),
      color: new Vector3(1, 0.96, 0.88),
      intensity: 3.5,
      decay_rate: 2,
      inner_angle: 0,
      outer_angle: 0,
    },
    empty(),
    empty(),
    empty(),
  ];
}

function readMaterialXInputValues(text: string): { name: string; type: string; value: string }[] {
  return [...text.matchAll(/<input\b(?=[^>]*\bname=(["'])([^"']+)\1)(?=[^>]*\btype=(["'])([^"']+)\3)(?=[^>]*\bvalue=(["'])([^"']*)\5)[^>]*\/>/gi)]
    .map((match) => ({ name: match[2], type: match[4], value: match[6] }));
}

type MaterialXImage = {
  name: string;
  file: string;
  uaddressmode?: string;
  vaddressmode?: string;
  filtertype?: string;
};

function readMaterialXImages(text: string): MaterialXImage[] {
  const images: MaterialXImage[] = [];
  for (const image of text.matchAll(/<image\b(?=[^>]*\bname=(["'])([^"']+)\1)[^>]*>([\s\S]*?)<\/image>/gi)) {
    const body = image[3];
    const file = readImageInput(body, "file");
    if (file) {
      images.push({
        name: image[2],
        file,
        uaddressmode: readImageInput(body, "uaddressmode"),
        vaddressmode: readImageInput(body, "vaddressmode"),
        filtertype: readImageInput(body, "filtertype"),
      });
    }
  }
  return images;
}

function readImageInput(imageBody: string, name: string): string | undefined {
  const input = imageBody.match(new RegExp(`<input\\b(?=[^>]*\\bname=(["'])${escapeRegExp(name)}\\1)(?=[^>]*\\bvalue=(["'])([^"']+)\\2)[^>]*\\/?>`, "i"));
  return input?.[3];
}

function applyMaterialXImageOptions(
  texture: { wrapS: number; wrapT: number; magFilter: number; minFilter: number; generateMipmaps: boolean },
  image: MaterialXImage
): void {
  texture.wrapS = addressModeToWrapping(image.uaddressmode);
  texture.wrapT = addressModeToWrapping(image.vaddressmode);
  const filter = filterTypeToFilter(image.filtertype);
  texture.magFilter = filter;
  texture.minFilter = filter;
  texture.generateMipmaps = false;
}

function addressModeToWrapping(addressMode?: string): number {
  switch (addressMode?.toLowerCase()) {
    case "clamp":
      return ClampToEdgeWrapping;
    case "mirror":
      return MirroredRepeatWrapping;
    case "periodic":
    default:
      return RepeatWrapping;
  }
}

function filterTypeToFilter(filterType?: string): number {
  return filterType?.toLowerCase() === "closest" ? NearestFilter : LinearFilter;
}

function findBaseColorImageName(text: string): string | null {
  const baseColor = text.match(/<input\b(?=[^>]*\bname=(["'])base_color\1)(?=[^>]*\bnodegraph=(["'])([^"']+)\2)(?=[^>]*\boutput=(["'])([^"']+)\4)[^>]*\/>/i);
  if (!baseColor) {
    return null;
  }
  const [, , , nodeGraphName, , outputName] = baseColor;
  const graphPattern = new RegExp(`<nodegraph\\b(?=[^>]*\\bname=(["'])${escapeRegExp(nodeGraphName)}\\1)[^>]*>([\\s\\S]*?)<\\/nodegraph>`, "i");
  const graph = text.match(graphPattern);
  if (!graph) {
    return null;
  }
  const outputPattern = new RegExp(`<output\\b(?=[^>]*\\bname=(["'])${escapeRegExp(outputName)}\\1)(?=[^>]*\\bnodename=(["'])([^"']+)\\2)[^>]*\\/?>`, "i");
  const output = graph[2].match(outputPattern);
  return output?.[3] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMaterialXValue(type: string, value: string): unknown {
  const values = value.split(",").map((entry) => Number(entry.trim()));
  switch (type) {
    case "boolean":
    case "bool":
      return value === "true" || value === "1";
    case "integer":
    case "int":
      return Number.parseInt(value, 10) || 0;
    case "float":
      return Number(value) || 0;
    case "vector2":
      return new Vector2(values[0] ?? 0, values[1] ?? 0);
    case "color3":
    case "vector3":
      return new Vector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
    case "color4":
    case "vector4":
      return new Vector4(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
    case "matrix44": {
      const matrix = new Matrix4();
      if (values.length >= 16 && values.every(Number.isFinite)) {
        matrix.set(
          values[0], values[1], values[2], values[3],
          values[4], values[5], values[6], values[7],
          values[8], values[9], values[10], values[11],
          values[12], values[13], values[14], values[15]
        );
      }
      return matrix;
    }
    case "filename":
    case "string":
      return value;
    default:
      return value;
  }
}

function patchUvVec3Assignments(shader: string, uvName: string): string {
  return shader
    .replace(new RegExp(`vec3\\(${uvName}\\.x,\\s*1\\.0 - ${uvName}\\.y,\\s*${uvName}\\.z\\)`, "g"), `vec3(${uvName}.x, 1.0 - ${uvName}.y, 0.0)`)
    .replace(new RegExp(`\\bvec3 (\\w+) = ${uvName};`, "g"), `vec3 $1 = vec3(${uvName}, 0.0)`);
}
