export type RuntimeState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

export type RuntimeStatus = {
  state: RuntimeState;
  source: string;
  detail: string;
};

export type StageSummary = {
  rootFile: string;
  rootLayerIdentifier?: string;
  primCount?: number;
  layerCount?: number;
  timeCodesPerSecond?: number;
  startTimeCode?: number;
  endTimeCode?: number;
  upAxis?: string;
  error?: string;
};

export type RenderableMesh = {
  path: string;
  name: string;
  points: number[];
  indices: number[];
  uvs?: number[];
  matrix: number[];
  color?: number[];
  material?: RenderableMaterial;
};

export type RenderableMaterial = {
  path?: string;
  shaderId?: string;
  // Scalars
  diffuseColor?: number[];
  roughness?: number;
  metallic?: number;
  opacity?: number;
  emissiveColor?: number[];
  clearcoat?: number;
  clearcoatRoughness?: number;
  ior?: number;
  // Textures
  diffuseTexture?: RenderableTexture;
  roughnessTexture?: RenderableTexture;
  metallicTexture?: RenderableTexture;
  normalTexture?: RenderableTexture;
  occlusionTexture?: RenderableTexture;
  emissiveTexture?: RenderableTexture;
  clearcoatTexture?: RenderableTexture;
  clearcoatRoughnessTexture?: RenderableTexture;
  opacityTexture?: RenderableTexture;
};

export type RenderableTexture = {
  path: string;
  mimeType: string;
  data: Uint8Array;
};

export type StageLoadRequest = {
  files: File[];
  rootFile?: File;
};

export type StageLoadResult = {
  summary: StageSummary | null;
  renderables?: RenderableMesh[];
};

export type PrimTransform = {
  path: string;
  matrix: number[];
};

export type SceneGraphPrim = {
  path: string;
  name: string;
  typeName: string;
  depth: number;
  isActive: boolean;
  hasChildren: boolean;
};

export type PrimAttribute = {
  name: string;
  typeName: string;
  isAuthored: boolean;
  value?: string;
};

export type UsdWebViewBindings = {
  ready?: Promise<unknown>;
  createDataFile?: (path: string, data: Uint8Array) => void;
  extractRenderables?: (path: string) => RenderableMesh[];
  extractTransformsAtTime?: (path: string, timeCode: number) => PrimTransform[];
  openStage?: (path: string) => Promise<StageSummary> | StageSummary;
  inspectPrimRelationships?: (stagePath: string, primPath: string) => unknown;
  getSceneGraph?: (stagePath: string) => SceneGraphPrim[];
  getPrimAttributes?: (stagePath: string, primPath: string) => PrimAttribute[];
};

export type UsdWebViewFactory = (options: {
  locateFile: (path: string) => string;
}) => Promise<UsdWebViewBindings> | UsdWebViewBindings;

declare global {
  interface Window {
    UsdWebViewBindings?: {
      createRuntime: UsdWebViewFactory;
    };
  }
}
