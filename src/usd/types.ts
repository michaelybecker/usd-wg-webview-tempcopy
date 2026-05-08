export type RuntimeState = "idle" | "loading" | "ready" | "unavailable" | "error";

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
  diffuseColor?: number[];
  roughness?: number;
  metallic?: number;
  opacity?: number;
  diffuseTexture?: RenderableTexture;
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

export type UsdWebViewBindings = {
  ready?: Promise<unknown>;
  createDataFile?: (path: string, data: Uint8Array) => void;
  extractRenderables?: (path: string) => RenderableMesh[];
  openStage?: (path: string) => Promise<StageSummary> | StageSummary;
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
