declare module "three/examples/jsm/loaders/MaterialXLoader.js" {
  import { Loader, LoadingManager, Material } from "three";

  export type MaterialXLoaderOptions = {
    materialName?: string;
    issuePolicy?: "warn" | "error-core" | "error-all";
    onWarning?: (warning: unknown) => void;
    archiveResolver?: (uri: string) => string | null;
    path?: string;
    uvSpace?: "bottom-left" | "top-left";
  };

  export type MaterialXLoaderResult = {
    materials: Record<string, Material>;
    report?: unknown;
  };

  export class MaterialXLoader extends Loader<MaterialXLoaderResult> {
    constructor(manager?: LoadingManager);
    dispose(): this;
    parseBuffer(
      data: ArrayBuffer | Uint8Array | string,
      url?: string,
      options?: MaterialXLoaderOptions
    ): MaterialXLoaderResult;
    parse(text: string, options?: MaterialXLoaderOptions): MaterialXLoaderResult;
  }
}
