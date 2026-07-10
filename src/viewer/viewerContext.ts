// Shared mutable state for the viewer modules. The renderer and controls are
// replaced wholesale on the WebGL→WebGPU switch, so modules must always read
// them through this context rather than capturing them at construction time.

import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface ViewportContext {
  readonly host: HTMLElement;
  readonly camera: PerspectiveCamera;
  readonly scene: Scene;
  readonly stageRoot: Group;
  renderer: WebGLRenderer | WebGPURenderer;
  controls: OrbitControls;
}

export function isWebGpuRenderer(ctx: ViewportContext): boolean {
  return "isWebGPURenderer" in ctx.renderer;
}
