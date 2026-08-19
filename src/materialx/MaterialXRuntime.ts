import type {
  MaterialXCompileOptions,
  MaterialXCompileResult,
  MaterialXDiagnostic,
  MaterialXShaderTarget,
} from "./types";

const DEFAULT_RUNTIME_BASE_URL = "/materialx/1.39.5";
const VERSION = "1.39.5";

type MaterialXModule = Record<string, any>;
type MaterialXInitializer = (options?: Record<string, unknown>) => Promise<MaterialXModule>;

let runtimePromise: Promise<MaterialXRuntime> | null = null;

export function getMaterialXRuntime(baseUrl = DEFAULT_RUNTIME_BASE_URL): Promise<MaterialXRuntime> {
  runtimePromise ??= MaterialXRuntime.initialize(baseUrl);
  return runtimePromise;
}

export class MaterialXRuntime {
  private constructor(private readonly mx: MaterialXModule) {}

  static async initialize(baseUrl = DEFAULT_RUNTIME_BASE_URL): Promise<MaterialXRuntime> {
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    const module = await import(/* @vite-ignore */ `${normalizedBaseUrl}/JsMaterialXGenShader.js`);
    const initialize = module.default as MaterialXInitializer;
    const mx = await initialize({
      locateFile: (path: string) => {
        const located = `${normalizedBaseUrl}/${path}`;
        return located.startsWith("file:") ? decodeURIComponent(new URL(located).pathname) : located;
      },
    });
    return new MaterialXRuntime(mx);
  }

  get version(): string {
    return VERSION;
  }

  async parse(text: string, path: string, materialName?: string): Promise<{ document?: any; diagnostics: MaterialXDiagnostic[] }> {
    const doc = this.mx.createDocument();
    try {
      await this.mx.readFromXmlString(doc, text, "");
      const valid = doc.validate();
      const diagnostics: MaterialXDiagnostic[] = valid
        ? []
        : [{ severity: "warning", message: "MaterialX validation returned false.", path, materialName }];
      return { document: doc, diagnostics };
    } catch (error) {
      return {
        diagnostics: [this.diagnosticFromError(error, "Failed to parse MaterialX document.", path, materialName)],
      };
    }
  }

  async compile(text: string, options: MaterialXCompileOptions): Promise<MaterialXCompileResult> {
    const target = options.target ?? "essl";
    const diagnostics: MaterialXDiagnostic[] = [];
    const parsed = await this.parse(text, options.path, options.materialName);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.document) {
      return { target, diagnostics };
    }

    try {
      const generator = this.createShaderGenerator(target);
      const context = new this.mx.GenContext(generator);
      this.configureGenerationContext(context);
      const libraries = this.mx.loadStandardLibraries(context);
      await this.registerLightShaders(context, libraries);
      context.getOptions().fileTextureVerticalFlip = options.fileTextureVerticalFlip ?? false;
      parsed.document.importLibrary(libraries);

      const element = this.findRenderableElement(parsed.document, options.materialName);
      if (!element) {
        diagnostics.push({
          severity: "error",
          message: "No renderable MaterialX element was found.",
          path: options.path,
          materialName: options.materialName,
        });
        return { target, diagnostics };
      }

      const elementName = element.getName();
      const shader = generator.generate(elementName, element, context);
      if (target === "wgsl") {
        return {
          target,
          wgslSource: shader.getSourceCode("pixel") || shader.getSourceCode("compute"),
          uniforms: this.extractUniformDefaults(shader),
          elementName,
          diagnostics,
        };
      }
      return {
        target,
        vertexSource: shader.getSourceCode("vertex"),
        fragmentSource: shader.getSourceCode("pixel"),
        uniforms: this.extractUniformDefaults(shader),
        elementName,
        diagnostics,
      };
    } catch (error) {
      diagnostics.push(this.diagnosticFromError(error, "Failed to compile MaterialX shader.", options.path, options.materialName));
      return { target, diagnostics };
    }
  }

  private createShaderGenerator(target: MaterialXShaderTarget): any {
    switch (target) {
      case "glsl":
        return this.mx.GlslShaderGenerator.create();
      case "wgsl":
        return this.mx.WgslShaderGenerator.create();
      case "essl":
      default:
        return this.mx.EsslShaderGenerator.create();
    }
  }

  private configureGenerationContext(context: any): void {
    const options = context.getOptions();
    if (this.mx.ShaderInterfaceType?.SHADER_INTERFACE_COMPLETE !== undefined) {
      options.shaderInterfaceType = this.mx.ShaderInterfaceType.SHADER_INTERFACE_COMPLETE;
    }
    if (this.mx.HwSpecularEnvironmentMethod?.SPECULAR_ENVIRONMENT_PREFILTER !== undefined) {
      options.hwSpecularEnvironmentMethod = this.mx.HwSpecularEnvironmentMethod.SPECULAR_ENVIRONMENT_PREFILTER;
    }
    options.hwSrgbEncodeOutput = true;
    options.hwMaxActiveLightSources = 4;
  }

  private async registerLightShaders(context: any, libraries: any): Promise<void> {
    this.mx.HwShaderGenerator?.unbindLightShaders?.(context);

    const lightRig = `<?xml version="1.0"?>
<materialx version="1.39">
  <directional_light name="default_directional_light" type="lightshader" />
  <point_light name="default_point_light" type="lightshader" />
  <spot_light name="default_spot_light" type="lightshader" />
</materialx>`;
    const lightDoc = this.mx.createDocument();
    await this.mx.readFromXmlString(lightDoc, lightRig, "");

    const document = this.mx.createDocument();
    document.setDataLibrary(libraries);
    document.importLibrary(lightDoc);

    let nextLightId = 1;
    const nodes = document.getNodes?.() ?? [];
    for (const node of nodes) {
      const nodeDef = node.getNodeDef?.();
      if (!nodeDef) {
        continue;
      }
      this.mx.HwShaderGenerator?.bindLightShader?.(nodeDef, nextLightId++, context);
    }

    context.getOptions().hwMaxActiveLightSources = 4;
  }

  private findRenderableElement(document: any, materialName?: string): any | null {
    if (materialName) {
      return document.getDescendant?.(materialName) ?? document.getNode?.(materialName) ?? null;
    }
    return this.mx.findRenderableElement(document);
  }

  private extractUniformDefaults(shader: any): MaterialXCompileResult["uniforms"] {
    const uniforms = new Map<string, NonNullable<MaterialXCompileResult["uniforms"]>[number]>();
    for (const stageName of ["vertex", "pixel"]) {
      const stage = shader.getStage?.(stageName);
      const blocks = stage?.getUniformBlocks?.();
      if (!blocks) {
        continue;
      }
      for (const [blockName, block] of Object.entries(blocks)) {
        if (blockName === "LightData") {
          continue;
        }
        const variableBlock = block as { size?: () => number; get?: (index: number) => any };
        const size = variableBlock.size?.() ?? 0;
        for (let index = 0; index < size; index += 1) {
          const port = variableBlock.get?.(index);
          const name = String(port?.getVariable?.() ?? "");
          if (!name || uniforms.has(name)) {
            continue;
          }
          const value = port?.getValue?.();
          uniforms.set(name, {
            name,
            type: String(port?.getType?.()?.getName?.() ?? value?.getTypeString?.() ?? ""),
            value: value?.getValueString?.(),
          });
        }
      }
    }
    return [...uniforms.values()];
  }

  private diagnosticFromError(error: unknown, fallback: string, path: string, materialName?: string): MaterialXDiagnostic {
    let message = fallback;
    try {
      message = this.mx.getExceptionMessage(error) || message;
    } catch {
      if (error instanceof Error) {
        message = error.message;
      } else if (typeof error === "string") {
        message = error;
      }
    }
    return { severity: "error", message, path, materialName };
  }
}
