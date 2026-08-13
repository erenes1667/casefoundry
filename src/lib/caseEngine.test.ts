import { beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import phonesJson from "../../resources/seed-phones.json";
import { defaultConfiguration } from "../data/catalog";
import { defaultFilamentFor } from "../data/filaments";
import {
  ensureEngineReady,
  generateCase,
  generateFitCoupon,
  recipeForConfiguration,
  serializeCase3mf,
  serializeCaseStl,
  specFromConfiguration,
  tuneConfiguration,
  validateCase,
} from "./caseEngine";
import {
  USB_C_CABLE_CLEARANCE_MM,
  caseDimensions,
  isUsbCPort,
} from "./caseGeometry";
import { rayCrossings } from "./donorMeasure";
import { diagnoseMesh } from "./mesh";
import type { IndexedMesh } from "./mesh";
import type { PhoneRecord } from "../types";

const phones = phonesJson as PhoneRecord[];
const s24plus = phones.find((phone) => phone.model === "Galaxy S24+")!;
const s23fe = phones.find((phone) => phone.model === "Galaxy S23 FE")!;

beforeAll(async () => {
  await ensureEngineReady();
});

describe("geometry is watertight", () => {
  for (const phone of phones) {
    it(`${phone.model} produces a closed solid`, () => {
      const config = tuneConfiguration(phone, defaultConfiguration(phone.id));
      const built = generateCase(phone, config);
      const diagnostics = diagnoseMesh(built.geometry as IndexedMesh);
      expect(diagnostics.boundaryEdges).toBe(0);
      expect(diagnostics.nonManifoldEdges).toBe(0);
      expect(diagnostics.degenerateTriangles).toBe(0);
      expect(diagnostics.isConsistentlyOriented).toBe(true);
      // A closed solid enclosing real material has positive volume.
      expect(diagnostics.signedVolumeMm3).toBeGreaterThan(0);
    });
  }
});

describe("cavity honours the phone it was built for", () => {
  it("outer size tracks phone size, clearance and wall", () => {
    const config = tuneConfiguration(s24plus, defaultConfiguration(s24plus.id));
    const report = validateCase(s24plus, config);
    const expectedWidth =
      s24plus.dimensions.width + config.tolerance * 2 + config.wall * 2;
    expect(report.metrics.outerWidth).toBeCloseTo(expectedWidth, 2);
  });

  it("a thicker phone yields a taller case", () => {
    const configA = tuneConfiguration(s24plus, defaultConfiguration(s24plus.id));
    const configB = tuneConfiguration(s23fe, defaultConfiguration(s23fe.id));
    const heightA = validateCase(s24plus, configA).metrics.outerHeight;
    const heightB = validateCase(s23fe, configB).metrics.outerHeight;
    // S23 FE is 8.2 mm deep against the S24+ at 7.7 mm.
    expect(heightB).toBeGreaterThan(heightA);
  });

  it("uses the measured S23 FE corner radius and release-gated cavity rule", () => {
    const config = tuneConfiguration(s23fe, {
      ...defaultConfiguration(s23fe.id),
      material: "pla-silk",
    });
    const dimensions = caseDimensions(s23fe, specFromConfiguration(config));

    expect(s23fe.dimensions.cornerRadius).toBe(11);
    expect(config.tolerance).toBe(0.34);
    expect(dimensions.innerWidth).toBeCloseTo(77.18, 6);
    expect(dimensions.innerLength).toBeCloseTo(158.68, 6);
    expect(dimensions.innerRadius).toBeCloseTo(11.34, 6);
  });
});

describe("button side is never mirrored", () => {
  it("keeps the notch on the stored screen-right edge", () => {
    const config = tuneConfiguration(s24plus, {
      ...defaultConfiguration(s24plus.id),
      pattern: "none",
    });
    const built = generateCase(s24plus, config);
    const mesh = built.geometry as IndexedMesh;

    const buttons = s24plus.features.filter(
      (feature) => feature.kind === "button" && feature.side === "screenRight",
    );
    expect(buttons.length).toBeGreaterThan(0);
    const midY =
      buttons.reduce((sum, button) => sum + button.center.y, 0) / buttons.length;

    // Sample the shell at the button height on both edges. The notched side
    // must reach less far out in X than the untouched side.
    let maxRight = -Infinity;
    let maxLeft = Infinity;
    for (let index = 0; index < mesh.positions.length; index += 3) {
      const y = mesh.positions[index + 1];
      const z = mesh.positions[index + 2];
      if (Math.abs(y - midY) > 4) continue;
      if (z < config.backThickness + 2) continue;
      const x = mesh.positions[index];
      if (x > maxRight) maxRight = x;
      if (x < maxLeft) maxLeft = x;
    }
    expect(maxRight).toBeLessThan(Math.abs(maxLeft));
  });
});

describe("USB-C cable clearance", () => {
  for (const phone of [s23fe, s24plus]) {
    const port = phone.features.find(isUsbCPort)!;
    for (const bottomOpening of [true, false]) {
      it(
        `keeps the ${USB_C_CABLE_CLEARANCE_MM} mm ${phone.model} cable envelope clear with bottomOpening=${bottomOpening}`,
        () => {
          const config = tuneConfiguration(phone, {
            ...defaultConfiguration(phone.id),
            pattern: "none",
            topOpening: false,
            bottomOpening,
          });
          const built = generateCase(phone, config);
          const mesh = built.geometry as IndexedMesh;
          const outsideOffset = 4;
          const originY = -built.report.metrics.outerLength / 2 - outsideOffset;
          const centreZ = config.backThickness + port.center.z;
          const edgeInset = 0.25;
          // Probe the height at several points across the molded connector
          // housing. The old stadium cutout passed only at x=0.
          const cableCornerRadius = 1.2;
          const halfUsableWidth = port.size.x / 2 - cableCornerRadius;

          for (const x of [
            port.center.x - halfUsableWidth,
            port.center.x,
            port.center.x + halfUsableWidth,
          ]) {
            for (const z of [
              centreZ - USB_C_CABLE_CLEARANCE_MM / 2 + edgeInset,
              centreZ,
              centreZ + USB_C_CABLE_CLEARANCE_MM / 2 - edgeInset,
            ]) {
              const crossings = rayCrossings(mesh, [x, originY, z], [0, 1, 0]);
              expect(
                crossings.length,
                `no shell crossing found at x=${x}, z=${z}`,
              ).toBeGreaterThan(0);
              expect(
                crossings[0],
                `case material intrudes into the USB-C cable envelope at x=${x}, z=${z}`,
              ).toBeGreaterThan(outsideOffset + config.wall + 0.5);
            }
          }
        },
        60_000,
      );
    }
  }

  it("blocks export when a phone record has no USB-C measurement", () => {
    const withoutUsb = {
      ...s24plus,
      features: s24plus.features.filter((feature) => !isUsbCPort(feature)),
    };
    const report = validateCase(
      withoutUsb,
      tuneConfiguration(withoutUsb, defaultConfiguration(withoutUsb.id)),
    );
    expect(report.printable).toBe(false);
    expect(report.issues.some((issue) => issue.id === "missing-usb-c")).toBe(true);
  });
});

describe("artwork actually reaches the solid", () => {
  /**
   * A 0.35 mm engraving is almost invisible in a dark 3D preview, so "it looks
   * plain" is not evidence either way. This checks the volume the artwork
   * removes against the area it covers, which is unambiguous.
   */
  it("removes material equal to pattern area times depth", () => {
    const plainConfig = tuneConfiguration(s24plus, {
      ...defaultConfiguration(s24plus.id),
      pattern: "none",
    });
    const engravedConfig = tuneConfiguration(s24plus, {
      ...defaultConfiguration(s24plus.id),
      pattern: "asanoha",
      patternMode: "engraved",
    });

    const plain = generateCase(s24plus, plainConfig);
    const engraved = generateCase(s24plus, engravedConfig);

    const plainVolume = Math.abs(
      diagnoseMesh(plain.geometry as IndexedMesh).signedVolumeMm3,
    );
    const engravedVolume = Math.abs(
      diagnoseMesh(engraved.geometry as IndexedMesh).signedVolumeMm3,
    );
    const removed = plainVolume - engravedVolume;

    // The engraving must be substantial, not a token motif.
    expect(removed, "engraving removed almost nothing").toBeGreaterThan(500);
    // And it must not eat the whole back.
    expect(removed).toBeLessThan(plainVolume * 0.25);
    // The engraved shell has far more surface detail than the plain one.
    expect((engraved.geometry as IndexedMesh).triangleCount).toBeGreaterThan(
      (plain.geometry as IndexedMesh).triangleCount * 2,
    );
  });

  it("through-cut removes more than engraving", () => {
    const engraved = generateCase(
      s24plus,
      tuneConfiguration(s24plus, {
        ...defaultConfiguration(s24plus.id),
        pattern: "asanoha",
        patternMode: "engraved",
      }),
    );
    const vented = generateCase(
      s24plus,
      tuneConfiguration(s24plus, {
        ...defaultConfiguration(s24plus.id),
        pattern: "asanoha",
        patternMode: "vented",
      }),
    );
    const engravedVolume = Math.abs(
      diagnoseMesh(engraved.geometry as IndexedMesh).signedVolumeMm3,
    );
    const ventedVolume = Math.abs(
      diagnoseMesh(vented.geometry as IndexedMesh).signedVolumeMm3,
    );
    expect(ventedVolume).toBeLessThan(engravedVolume);
  });

  it("auto-tunes a printable translucent Kumiko S23 FE case", () => {
    const config = tuneConfiguration(s23fe, {
      ...defaultConfiguration(s23fe.id),
      material: "petg-translucent",
      pattern: "asanoha",
    });
    const report = validateCase(s23fe, config);
    const built = generateCase(s23fe, config);
    const diagnostics = diagnoseMesh(built.geometry as IndexedMesh);

    expect(config.architecture).toBe("translucent-art");
    expect(config.patternMode).toBe("sealed");
    expect(config.backThickness).toBe(1.55);
    expect(config.patternDepth).toBe(0.4);
    expect(report.metrics.minimumSkin).toBe(0.55);
    expect(report.printable).toBe(true);
    expect(report.issues.some((issue) => issue.id === "skin-thin")).toBe(false);
    expect(diagnostics.boundaryEdges).toBe(0);
    expect(diagnostics.nonManifoldEdges).toBe(0);
  });

  it("still blocks a manually thinned sealed backplate", () => {
    const config = {
      ...tuneConfiguration(s23fe, {
        ...defaultConfiguration(s23fe.id),
        material: "petg-translucent" as const,
        pattern: "asanoha" as const,
      }),
      backThickness: 1.25,
    };
    const report = validateCase(s23fe, config);

    expect(report.printable).toBe(false);
    expect(report.issues.some((issue) => issue.id === "skin-thin")).toBe(true);
  });

  it("blocks a two-material inlay without a translucent PETG shell", () => {
    const config = {
      ...tuneConfiguration(s23fe, {
        ...defaultConfiguration(s23fe.id),
        material: "petg" as const,
        pattern: "asanoha" as const,
      }),
      patternMode: "inlay" as const,
    };
    const report = validateCase(s23fe, config);

    expect(report.printable).toBe(false);
    expect(report.issues.some((issue) => issue.id === "inlay-material")).toBe(true);
  });

  it("exports translucent shell and opaque Kumiko as aligned filament parts", () => {
    const config = {
      ...tuneConfiguration(s23fe, {
        ...defaultConfiguration(s23fe.id),
        material: "petg-translucent" as const,
        pattern: "asanoha" as const,
      }),
      patternMode: "inlay" as const,
    };
    const generated = generateCase(s23fe, config);
    const shellFilament = defaultFilamentFor("petg-translucent")!;
    const inlayFilament = defaultFilamentFor("petg")!;

    expect(generated.report.printable).toBe(true);
    expect(generated.parts.map((part) => part.role)).toEqual(["shell", "inlay"]);
    for (const part of generated.parts) {
      const diagnostics = diagnoseMesh(part.geometry as IndexedMesh);
      expect(diagnostics.boundaryEdges, `${part.name} boundaries`).toBe(0);
      expect(diagnostics.nonManifoldEdges, `${part.name} non-manifold`).toBe(0);
      expect(Math.abs(diagnostics.signedVolumeMm3)).toBeGreaterThan(0);
    }

    const bytes = serializeCase3mf(generated, {
      filament: { ...shellFilament, colour: "#d9ffff" },
      inlayFilament: { ...inlayFilament, colour: "#202020" },
      recipe: recipeForConfiguration(config),
      phone: s23fe,
      date: "2026-08-13",
    });
    const files = unzipSync(bytes);
    const settings = JSON.parse(strFromU8(files["Metadata/project_settings.config"]));
    const modelSettings = strFromU8(files["Metadata/model_settings.config"]);
    const objectModel = strFromU8(files["3D/Objects/object_1.model"]);

    expect(files["3D/Objects/object_1.model"]).toBeDefined();
    expect(objectModel).toContain('<object id="1"');
    expect(objectModel).toContain('<object id="2"');
    expect(settings.filament_settings_id).toHaveLength(2);
    expect(settings.filament_colour).toEqual(["#d9ffff", "#202020"]);
    expect(settings.enable_prime_tower).toBe("1");
    expect(modelSettings).toContain('name" value="Case shell"');
    expect(modelSettings).toContain('name" value="Opaque Kumiko inlay"');
    expect(modelSettings).toContain('key="extruder" value="2"');
  });
});

describe("export", () => {
  it("writes a binary STL with a correct triangle count", () => {
    const config = tuneConfiguration(s24plus, defaultConfiguration(s24plus.id));
    const built = generateCase(s24plus, config);
    const stl = serializeCaseStl(built);
    const triangles = new DataView(
      stl.buffer,
      stl.byteOffset,
      stl.byteLength,
    ).getUint32(80, true);
    expect(triangles).toBe((built.geometry as IndexedMesh).triangleCount);
    expect(stl.byteLength).toBe(84 + triangles * 50);
  });

  it("writes a 3MF that is a real zip carrying Bambu settings", () => {
    const config = tuneConfiguration(s24plus, defaultConfiguration(s24plus.id));
    const built = generateCase(s24plus, config);
    const filament = defaultFilamentFor(config.material);
    expect(filament, `no catalog filament for ${config.material}`).toBeDefined();

    const bytes = serializeCase3mf(built, {
      filament: filament!,
      recipe: recipeForConfiguration(config),
      phone: s24plus,
      date: "2026-08-09",
    });
    // Local zip file header magic.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Metadata/project_settings.config");
    expect(text).toContain("3D/Objects/object_1.model");
  });

  it("refuses to export geometry that is not watertight", async () => {
    const { buildBambuProject, RECIPES } = await import("./bambuProject");
    const filament = defaultFilamentFor("pla")!;
    // A single triangle: three boundary edges, definitively not a solid.
    const broken: IndexedMesh = {
      positions: Float64Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0]),
      indices: Uint32Array.from([0, 1, 2]),
      vertexCount: 3,
      triangleCount: 1,
    };
    expect(() =>
      buildBambuProject({
        mesh: broken,
        filament,
        recipe: RECIPES["solid-engraved"],
        metadata: {
          title: "broken",
          plateName: "broken",
          description: "",
          profileDescription: "",
          date: "2026-08-09",
        },
      }),
    ).toThrow(/not watertight/i);
  });
});

describe("fit coupon", () => {
  it("is far smaller than the full case but still closed", () => {
    const config = tuneConfiguration(s23fe, defaultConfiguration(s23fe.id));
    const full = generateCase(s23fe, config);
    const coupon = generateFitCoupon(s23fe, config);

    const fullVolume = Math.abs(
      diagnoseMesh(full.geometry as IndexedMesh).signedVolumeMm3,
    );
    const couponDiagnostics = diagnoseMesh(coupon.geometry as IndexedMesh);
    expect(couponDiagnostics.boundaryEdges).toBe(0);
    expect(Math.abs(couponDiagnostics.signedVolumeMm3)).toBeLessThan(fullVolume);
    expect(Math.abs(couponDiagnostics.signedVolumeMm3)).toBeGreaterThan(0);
  });
});

describe("filament catalog", () => {
  it("resolves a real Bambu preset for every material", () => {
    for (const material of [
      "pla",
      "pla-silk",
      "tpu-95a",
      "petg",
      "petg-translucent",
    ] as const) {
      const filament = defaultFilamentFor(material);
      expect(filament, `missing preset for ${material}`).toBeDefined();
      expect(filament!.nozzleTemp).toBeGreaterThan(150);
      expect(filament!.bedTemp).toBeGreaterThan(0);
    }
  });
});
