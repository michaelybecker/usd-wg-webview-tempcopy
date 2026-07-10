// Default light rig, room environment, and HDRI environment handling.

import {
  AmbientLight,
  Color,
  EquirectangularReflectionMapping,
  HemisphereLight,
  LinearSRGBColorSpace,
  PMREMGenerator,
  type Scene,
  Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import type { RenderableTexture } from "../usd/types";

export class LightingRig {
  private readonly exrLoader = new EXRLoader();
  private readonly hdrLoader = new HDRLoader();
  private readonly ambientLight: AmbientLight;
  private readonly hemisphereLight: HemisphereLight;
  private readonly defaultEnvironmentTarget: WebGLRenderTarget;
  private readonly defaultAmbientIntensity = 0.22;
  private readonly defaultHemisphereIntensity = 1.25;
  private readonly defaultEnvironmentIntensity = 0.7;
  private hdriTexture: Texture | null = null;
  private hdriMapVisible = true;
  private hdriIntensity = 1;

  constructor(
    private readonly scene: Scene,
    private readonly defaultBackground: Color,
    renderer: WebGLRenderer
  ) {
    const pmremGenerator = new PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    this.defaultEnvironmentTarget = pmremGenerator.fromScene(roomEnvironment);
    pmremGenerator.dispose();

    this.ambientLight = new AmbientLight(0xffffff, this.defaultAmbientIntensity);
    this.scene.add(this.ambientLight);

    this.hemisphereLight = new HemisphereLight(0xfff7ec, 0x6b737c, this.defaultHemisphereIntensity);
    this.scene.add(this.hemisphereLight);
    this.applyDefaultEnvironment();
  }

  dispose(): void {
    this.disposeHdriTexture();
    this.defaultEnvironmentTarget.dispose();
  }

  async loadHdriMap(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      const texture = await this.loadHdriTexture(file.name, url);
      this.applyHdriTexture(texture, file.name);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadHdriAsset(asset: RenderableTexture, label?: string): Promise<void> {
    const bytes = new Uint8Array(asset.data.byteLength);
    bytes.set(asset.data);
    const url = URL.createObjectURL(
      new Blob([bytes.buffer], { type: asset.mimeType || "application/octet-stream" })
    );
    try {
      const texture = await this.loadHdriTexture(asset.path, url);
      this.applyHdriTexture(texture, label ?? asset.path);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  useDefaultLighting(): void {
    this.disposeHdriTexture();
    this.scene.background = this.defaultBackground;
    this.applyDefaultEnvironment();
    this.setDefaultLightRigEnabled(true);
  }

  setHdriMapVisible(visible: boolean): void {
    this.hdriMapVisible = visible;
    if (!this.hdriTexture) {
      return;
    }
    this.scene.background = visible ? this.hdriTexture : this.defaultBackground;
  }

  setHdriIntensity(intensity: number): void {
    this.hdriIntensity = Math.min(5, Math.max(0, intensity));
    if (this.hdriTexture) {
      this.applyHdriIntensity();
    }
  }

  hasHdriMap(): boolean {
    return this.hdriTexture !== null;
  }

  private loadHdriTexture(name: string, url: string): Promise<Texture> {
    if (name.toLowerCase().endsWith(".exr")) {
      return this.exrLoader.loadAsync(url);
    }
    return this.hdrLoader.loadAsync(url);
  }

  private applyHdriTexture(texture: Texture, name: string): void {
    texture.name = name;
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = LinearSRGBColorSpace;
    texture.needsUpdate = true;

    this.disposeHdriTexture();
    this.hdriTexture = texture;
    this.scene.environment = texture;
    this.scene.background = this.hdriMapVisible ? texture : this.defaultBackground;
    this.applyHdriIntensity();
    this.setDefaultLightRigEnabled(false);
  }

  private setDefaultLightRigEnabled(enabled: boolean): void {
    this.ambientLight.intensity = enabled ? this.defaultAmbientIntensity : 0;
    this.hemisphereLight.intensity = enabled ? this.defaultHemisphereIntensity : 0;
  }

  private applyDefaultEnvironment(): void {
    this.scene.environment = this.defaultEnvironmentTarget.texture;
    this.scene.environmentIntensity = this.defaultEnvironmentIntensity;
    this.scene.backgroundIntensity = 1;
  }

  private applyHdriIntensity(): void {
    this.scene.environmentIntensity = this.hdriIntensity;
    this.scene.backgroundIntensity = this.hdriIntensity;
  }

  private disposeHdriTexture(): void {
    if (!this.hdriTexture) {
      return;
    }
    if (this.scene.environment === this.hdriTexture) {
      this.scene.environment = null;
    }
    if (this.scene.background === this.hdriTexture) {
      this.scene.background = this.defaultBackground;
    }
    this.hdriTexture.dispose();
    this.hdriTexture = null;
  }
}
