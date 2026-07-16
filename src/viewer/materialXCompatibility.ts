import type { RenderableMaterial } from "../usd/types";

export function prepareMaterialXForThree(materialXText: string): string {
  return stripStandardSurfaceCoatColorForThree(materialXText);
}

export function materialXUsesExrImages(materialXText: string): boolean {
  return /<image\b[\s\S]*?<input\b(?=[^>]*\bname=(["'])file\1)(?=[^>]*\bvalue=(["'])[^"']*\.exr(?:[^"']*)\2)[^>]*\/>/i.test(materialXText);
}

export function materialShouldUseTextureFallback(material?: RenderableMaterial): boolean {
  const materialX = material?.materialX;
  if (!materialX?.data?.length || !hasFallbackTextureSlots(material)) {
    return false;
  }
  return materialXUsesExrImages(TEXT_DECODER.decode(materialX.data));
}

const TEXT_DECODER = new TextDecoder();

function hasFallbackTextureSlots(material?: RenderableMaterial): boolean {
  return !!(
    material?.diffuseTexture ||
    material?.roughnessTexture ||
    material?.metallicTexture ||
    material?.normalTexture ||
    material?.occlusionTexture ||
    material?.emissiveTexture ||
    material?.clearcoatTexture ||
    material?.clearcoatRoughnessTexture ||
    material?.opacityTexture
  );
}

function stripStandardSurfaceCoatColorForThree(materialXText: string): string {
  // Three's MaterialX standard_surface mapping multiplies coat_color into the
  // base albedo. In MaterialX/Karma, coat_color belongs to the coat lobe and
  // should not darken/tint the base color. Dropping only this input preserves
  // albedo fidelity until the upstream mapping can represent it correctly.
  return materialXText.replace(
    /(<standard_surface\b[^>]*>)([\s\S]*?)(<\/standard_surface>)/g,
    (_match, open: string, body: string, close: string) =>
      `${open}${body.replace(
        /\n?[ \t]*<input\b(?=[^>]*\bname=(["'])coat_color\1)[^>]*\/>[ \t]*/g,
        ""
      )}${close}`
  );
}
