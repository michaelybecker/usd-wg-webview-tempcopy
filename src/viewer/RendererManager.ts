// Renderer lifecycle: initial WebGL renderer, the one-way switch to the
// WebGPU renderer for MaterialX content (recreating OrbitControls in the
// process), resize, and output color/tone-mapping settings. Emits
// "renderer-switched" on the host element when the switch drops splats.

import type { ColorSpace, ToneMapping } from "three";
import { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { isWebGpuRenderer, type ViewportContext } from "./viewerContext";

export interface RendererSwitchHooks {
  // Detach input handlers bound to the old renderer's canvas.
  beforeSwitch: () => void;
  // Re-attach input handlers; called for both success and rollback.
  afterSwitch: () => void;
  // Dispose WebGL-only resources (the splat renderer) after a successful switch.
  onWebGpuActive: () => void;
}

export class RendererManager {
  private webGpuInit: Promise<boolean> | null = null;

  constructor(
    private readonly ctx: ViewportContext,
    private readonly hooks: RendererSwitchHooks
  ) {}

  isWebGpuRenderer(): boolean {
    return isWebGpuRenderer(this.ctx);
  }

  ensureWebGpuRenderer(): Promise<boolean> {
    if (this.isWebGpuRenderer()) {
      return Promise.resolve(true);
    }
    if (this.webGpuInit) {
      return this.webGpuInit;
    }

    this.webGpuInit = this.switchToWebGpuRenderer();
    return this.webGpuInit;
  }

  private async switchToWebGpuRenderer(): Promise<boolean> {
    const ctx = this.ctx;
    const previousRenderer = ctx.renderer;
    const previousCanvas = previousRenderer.domElement;
    try {
      this.hooks.beforeSwitch();
      ctx.controls.dispose();

      // Automation/CI escape hatch: headless Chromium cannot present WebGPU
      // canvases, so ?forceWebGL=1 runs the same renderer (and the MaterialX
      // TSL node path) on its WebGL2 backend instead.
      const forceWebGL =
        new URLSearchParams(window.location.search).get("forceWebGL") === "1";
      const renderer = new WebGPURenderer({ antialias: true, alpha: false, forceWebGL });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = previousRenderer.outputColorSpace;
      renderer.toneMapping = previousRenderer.toneMapping;
      renderer.toneMappingExposure = previousRenderer.toneMappingExposure;
      await renderer.init();

      ctx.renderer = renderer;
      previousCanvas.replaceWith(renderer.domElement);
      previousRenderer.dispose();
      ctx.controls = new OrbitControls(ctx.camera, renderer.domElement);
      ctx.controls.enableDamping = true;
      ctx.controls.dampingFactor = 0.08;
      this.hooks.onWebGpuActive();
      this.hooks.afterSwitch();
      this.resize();
      // Gaussian splats are dropped on this renderer (SparkJS is
      // WebGL-only); let the app surface the degradation explicitly.
      ctx.host.dispatchEvent(new CustomEvent("renderer-switched", {
        detail: { renderer: "webgpu", splatsUnavailable: true },
      }));
      return true;
    } catch (error) {
      console.warn("Failed to initialize WebGPU renderer for MaterialX", error);
      ctx.renderer = previousRenderer;
      ctx.controls = new OrbitControls(ctx.camera, previousCanvas);
      ctx.controls.enableDamping = true;
      ctx.controls.dampingFactor = 0.08;
      this.hooks.afterSwitch();
      return false;
    }
  }

  setOutputColorSpace(colorSpace: ColorSpace): void {
    this.ctx.renderer.outputColorSpace = colorSpace;
  }

  setToneMapping(toneMapping: ToneMapping): void {
    this.ctx.renderer.toneMapping = toneMapping;
  }

  setToneMappingExposure(exposure: number): void {
    this.ctx.renderer.toneMappingExposure = Math.min(5, Math.max(0, exposure));
  }

  resize(): void {
    const width = Math.max(this.ctx.host.clientWidth, 1);
    const height = Math.max(this.ctx.host.clientHeight, 1);
    this.ctx.camera.aspect = width / height;
    this.ctx.camera.updateProjectionMatrix();
    this.ctx.renderer.setSize(width, height, false);
  }
}
