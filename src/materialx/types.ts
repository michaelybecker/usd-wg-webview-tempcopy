import type { RenderableTexture } from "../usd/types";

export type MaterialXDiagnosticSeverity = "info" | "warning" | "error";

export type MaterialXDiagnostic = {
  severity: MaterialXDiagnosticSeverity;
  message: string;
  path?: string;
  materialName?: string;
};

export type MaterialXShaderTarget = "essl" | "glsl" | "wgsl";

export type MaterialXCompileOptions = {
  path: string;
  materialName?: string;
  target?: MaterialXShaderTarget;
  fileTextureVerticalFlip?: boolean;
};

export type MaterialXCompileResult = {
  target: MaterialXShaderTarget;
  vertexSource?: string;
  fragmentSource?: string;
  wgslSource?: string;
  uniforms?: MaterialXUniformDefault[];
  elementName?: string;
  diagnostics: MaterialXDiagnostic[];
};

export type MaterialXUniformDefault = {
  name: string;
  type: string;
  value?: string;
};

export type MaterialXResolvedResource = RenderableTexture & {
  url: string;
};
