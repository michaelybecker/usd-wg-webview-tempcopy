import { describe, expect, it } from "vitest";
import { materialXUsesExrImages, prepareMaterialXForThree } from "../../src/viewer/materialXCompatibility";

describe("prepareMaterialXForThree", () => {
  it("drops standard_surface coat_color because Three tints base albedo with it", () => {
    const input = `<?xml version="1.0"?>
<materialx version="1.39">
  <standard_surface name="sr" type="surfaceshader">
    <input name="base_color" type="color3" value="1, 0, 0" />
    <input name="coat" type="float" value="0.2" />
    <input name="coat_color" type="color3" value="0.1, 0.1, 0.2" />
    <input name="coat_roughness" type="float" value="0.12" />
  </standard_surface>
</materialx>`;

    const output = prepareMaterialXForThree(input);

    expect(output).toContain('name="base_color"');
    expect(output).toContain('name="coat"');
    expect(output).toContain('name="coat_roughness"');
    expect(output).not.toContain('name="coat_color"');
  });

  it("leaves coat_color outside standard_surface untouched", () => {
    const input = `<?xml version="1.0"?>
<materialx version="1.39">
  <nodegraph name="NG">
    <constant name="coat_color" type="color3">
      <input name="value" type="color3" value="0.1, 0.1, 0.2" />
    </constant>
  </nodegraph>
</materialx>`;

    expect(prepareMaterialXForThree(input)).toBe(input);
  });
});

describe("materialXUsesExrImages", () => {
  it("detects EXR image file inputs", () => {
    const input = `<materialx>
  <image name="albedo" type="color3">
    <input name="file" type="filename" value="./textures/albedo.exr" />
  </image>
</materialx>`;

    expect(materialXUsesExrImages(input)).toBe(true);
  });

  it("ignores non-EXR image file inputs", () => {
    const input = `<materialx>
  <image name="albedo" type="color3">
    <input name="file" type="filename" value="./textures/albedo.png" />
  </image>
</materialx>`;

    expect(materialXUsesExrImages(input)).toBe(false);
  });
});
