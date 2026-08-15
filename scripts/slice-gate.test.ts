import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import phonesJson from "../resources/seed-phones.json";
import filamentCatalog from "../src/data/filaments.json";
import {
  DEFAULT_PRINTER,
  RECIPES,
  buildBambuProject,
  type FilamentChoice,
  type PrinterId,
} from "../src/lib/bambuProject";
import { buildCase, type CaseSpec } from "../src/lib/caseGeometry";
import { initCsg, solidToIndexedMesh } from "../src/lib/csg";
import { diagnoseMesh } from "../src/lib/mesh";
import type { PhoneRecord } from "../src/types";

/**
 * The gate CaseFoundry 2026.8.0 was missing.
 *
 * 8.0 shipped reference exports that had never been sliced, and they turned out
 * to be broken. Two independent checks run on every export here: an in-process
 * watertightness diagnosis, and a real slice by the Bambu Studio CLI. A file
 * that cannot be sliced is a failed build.
 */

const BAMBU_CLI = "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio";
const hasBambu = fs.existsSync(BAMBU_CLI);

interface CatalogFilament {
  name: string;
  settingId: string | null;
  type: string;
  flexible: boolean;
  nozzleTemp: number;
  nozzleTempInitialLayer: number;
  bedTemp: number;
  bedPlate: string;
  flowRatio?: number;
  maxVolumetricSpeed?: number;
  retractionLength?: number;
  density?: number;
  costPerKg?: number;
  fanMin?: number;
  fanMax?: number;
  slowDownMinSpeed?: number;
  design: { cavityClearance: number; wallFloor: number; lipHeight: number };
}

const catalog = filamentCatalog as { filaments: CatalogFilament[] };

function filamentByName(name: string): CatalogFilament {
  const found = catalog.filaments.find((entry) => entry.name === name);
  if (!found) throw new Error(`Filament not in catalog: ${name}`);
  return found;
}

function specFor(
  filament: CatalogFilament,
  recipeId: keyof typeof RECIPES,
  overrides: Partial<CaseSpec> = {},
): CaseSpec {
  const recipe = RECIPES[recipeId];
  return {
    cavityClearance: filament.design.cavityClearance,
    wall: filament.design.wallFloor,
    backThickness: 1.6,
    lipHeight: filament.design.lipHeight,
    lipOverhang: 1.2,
    cameraMargin: 0.9,
    layerHeight: recipe.layerHeight,
    initialLayerHeight: recipe.initialLayerHeight,
    openTop: true,
    openBottom: true,
    cornerLipOnly: !filament.flexible,
    buttonStyle: "open",
    pattern: "asanoha",
    patternMode: "engraved",
    patternDepth: 0.5,
    patternStroke: 1.0,
    patternScale: 1,
    magsafe: {
      enabled: false,
      outerDiameter: 56,
      innerDiameter: 46,
      thickness: 1,
      radialClearance: 0.25,
      zClearance: 0.2,
      exteriorCover: 0.6,
      centerY: 0,
    },
    ...overrides,
  };
}

const CASES: Array<{
  phone: string;
  filament: string;
  recipe: keyof typeof RECIPES;
  printer?: PrinterId;
  spec?: Partial<CaseSpec>;
  twoMaterial?: boolean;
  variant?: string;
}> = [
  {
    phone: "Galaxy S24+",
    filament: "Bambu PETG Translucent @BBL P2S 0.4 nozzle",
    recipe: "translucent-glass",
    spec: { pattern: "asanoha", patternMode: "sealed", backThickness: 1.5 },
  },
  {
    phone: "Galaxy S23 FE",
    filament: "Bambu PETG Translucent @BBL P2S 0.4 nozzle",
    recipe: "translucent-glass",
    spec: { pattern: "asanoha", patternMode: "sealed", backThickness: 1.55 },
  },
  {
    phone: "Galaxy S23 FE",
    filament: "Bambu PETG Translucent @BBL P2S 0.4 nozzle",
    recipe: "translucent-glass",
    spec: { pattern: "asanoha", patternMode: "inlay", backThickness: 1.55 },
    twoMaterial: true,
    variant: "opaque-inlay",
  },
  {
    phone: "Galaxy S23 FE",
    filament: "Bambu PLA Silk @BBL P2S",
    recipe: "solid-engraved",
    spec: { pattern: "sakura", patternMode: "engraved" },
  },
  {
    phone: "Galaxy A52s 5G",
    filament: "Bambu PLA Matte @BBL P2S",
    recipe: "solid-engraved",
    spec: { pattern: "asanoha", patternMode: "engraved" },
  },
  {
    phone: "Galaxy S24+",
    filament: "Bambu TPU 95A @BBL P2S",
    recipe: "solid-engraved",
    spec: { pattern: "kikko", patternMode: "through", backThickness: 2.0 },
  },
  {
    phone: "Galaxy S23 FE",
    filament: "Bambu PETG Translucent @BBL P2S 0.4 nozzle",
    recipe: "translucent-glass",
    spec: {
      pattern: "asanoha",
      patternMode: "inlay",
      backThickness: 2.4,
      magsafe: {
        enabled: true,
        outerDiameter: 56,
        innerDiameter: 46,
        thickness: 1,
        radialClearance: 0.25,
        zClearance: 0.2,
        exteriorCover: 0.6,
        centerY: 0,
      },
    },
    twoMaterial: true,
    variant: "magsafe-opaque-inlay",
  },
  // Every supported printer must produce a project its own machine can slice.
  // A P2S project handed to an A1 owner is simply the wrong job.
  {
    phone: "Galaxy S24+",
    filament: "Bambu PLA Matte @BBL A1",
    recipe: "solid-engraved",
    printer: "a1-0.4",
    spec: { pattern: "asanoha", patternMode: "engraved" },
  },
  {
    phone: "Galaxy S23 FE",
    filament: "Bambu TPU 95A @BBL A1",
    recipe: "solid-engraved",
    printer: "a1-0.4",
    spec: { pattern: "none", buttonStyle: "covered" },
  },
  {
    phone: "Galaxy A52s 5G",
    filament: "Bambu PLA Basic @BBL A1",
    recipe: "solid-engraved",
    printer: "a1-mini-0.4",
    spec: { pattern: "sakura", patternMode: "engraved" },
  },
  {
    phone: "Galaxy S24+",
    filament: "Bambu PLA Basic @BBL P1S 0.4 nozzle",
    recipe: "solid-engraved",
    printer: "p1s-0.4",
    spec: { pattern: "asanoha", patternMode: "engraved" },
  },
  {
    phone: "Galaxy S24+",
    filament: "Bambu PLA Basic @BBL X1C",
    recipe: "solid-engraved",
    printer: "x1c-0.4",
    spec: { pattern: "asanoha", patternMode: "engraved" },
  },
];

const outputDirectory = path.join(process.cwd(), "release", "slice-gate");
const phones = phonesJson as PhoneRecord[];

beforeAll(async () => {
  await initCsg();
  fs.mkdirSync(outputDirectory, { recursive: true });
});

describe("export slices in Bambu Studio", () => {
  for (const testCase of CASES) {
    // Skip visibly rather than passing. A green run on a machine without Bambu
    // Studio would otherwise claim the export slices when nothing sliced it.
    it.skipIf(!hasBambu)(
      `${testCase.phone} / ${testCase.filament} / ${testCase.variant ?? testCase.printer ?? DEFAULT_PRINTER}`,
      () => {
        const phone = phones.find((entry) => entry.model === testCase.phone);
        if (!phone) throw new Error(`Missing phone: ${testCase.phone}`);

        const filament = filamentByName(testCase.filament);
        const spec = specFor(filament, testCase.recipe, testCase.spec);
        const built = buildCase(phone, spec);
        const mesh = solidToIndexedMesh(built.solid);
        const inlayMesh = built.inlay ? solidToIndexedMesh(built.inlay) : undefined;

        // --- check 1: watertight before anything is written ---
        const diagnostics = diagnoseMesh(mesh);
        expect(diagnostics.degenerateTriangles, "degenerate triangles").toBe(0);
        expect(
          diagnostics.boundaryEdges,
          "open boundary edges: mesh has holes and cannot be sliced",
        ).toBe(0);
        expect(diagnostics.nonManifoldEdges, "non-manifold edges").toBe(0);
        expect(diagnostics.isConsistentlyOriented, "winding consistency").toBe(true);

        const printer = testCase.printer ?? DEFAULT_PRINTER;
        const stem = `${phone.model.replaceAll(" ", "-")}-${filament.type}-${testCase.recipe}-${testCase.variant ?? printer}`;
        const target = path.join(outputDirectory, `${stem}.3mf`);

        const choice: FilamentChoice = { ...filament, colour: "#EBEBEB" };
        const opaque = testCase.twoMaterial
          ? filamentByName("Bambu PETG Basic @BBL P2S 0.4 nozzle")
          : undefined;
        const project = buildBambuProject({
          mesh,
          filament: choice,
          filaments: opaque
            ? [choice, { ...opaque, colour: "#202020" }]
            : undefined,
          parts: inlayMesh
            ? [
                { mesh, name: "Translucent case shell", filamentIndex: 1 },
                { mesh: inlayMesh, name: "Opaque Kumiko inlay", filamentIndex: 2 },
              ]
            : undefined,
          recipe: RECIPES[testCase.recipe],
          printer,
          pause: built.printPause,
          metadata: {
            title: `${phone.brand} ${phone.model} case`,
            plateName: stem,
            description:
              `${phone.brand} ${phone.model} case. Fit source: ${phone.status}, ` +
              `physical fit ${phone.validation.physicalFit}.`,
            profileDescription: `${RECIPES[testCase.recipe].name} on ${filament.name}`,
            date: "2026-08-09",
          },
        });
        fs.writeFileSync(target, project.bytes);

        console.log(
          `${stem.padEnd(46)} tris=${String(mesh.triangleCount).padStart(6)} ` +
            `size=${project.bounds.size.map((v) => v.toFixed(1)).join(" x ")} ` +
            `file=${(project.bytes.length / 1024).toFixed(0)}kB`,
        );

        // --- check 2: does Bambu Studio actually slice it ---
        const sliceDir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-slice-"));
        const gcode = path.join(sliceDir, `${stem}.gcode`);
        let output = "";
        try {
          output = execFileSync(
            BAMBU_CLI,
            ["--allow-newer-file", "--slice", "0", "--export-3mf", gcode, target],
            { encoding: "utf8", timeout: 600_000, stdio: "pipe" },
          );
        } catch (error) {
          const failure = error as { stdout?: string; stderr?: string };
          throw new Error(
            `Bambu Studio refused to slice ${stem}.3mf\n` +
              `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.slice(-4000),
          );
        }
        // Two messages appear even when slicing the print-verified
        // reference file, so they are Bambu CLI noise rather than defects in
        // our export: "Invalid T command (T65535)" on single-extruder jobs, and
        // "ZFiller: encounter idx from clip" from the infill generator.
        const realErrors = output
          .split("\n")
          .filter((line) => /\[error\]/i.test(line))
          .filter((line) => !/Invalid T command/i.test(line))
          .filter((line) => !/ZFiller: encounter idx from clip/i.test(line));
        expect(realErrors, `Bambu Studio reported errors for ${stem}`).toEqual([]);
        const sliced =
          testCase.twoMaterial || built.printPause
            ? unzipSync(new Uint8Array(fs.readFileSync(gcode)))
            : undefined;
        if (testCase.twoMaterial && sliced) {
          const sliceInfoBytes = sliced["Metadata/slice_info.config"];
          expect(sliceInfoBytes, "Bambu output is missing slice metadata").toBeDefined();
          const sliceInfo = strFromU8(sliceInfoBytes);
          expect(sliceInfo, "translucent slot was not used by the slicer").toContain(
            '<filament id="1"',
          );
          expect(sliceInfo, "opaque slot was not used by the slicer").toContain(
            '<filament id="2"',
          );
        }
        if (built.printPause && sliced) {
          const projectFiles = unzipSync(project.bytes);
          const customGcode = strFromU8(
            projectFiles["Metadata/custom_gcode_per_layer.xml"],
          );
          expect(customGcode).toContain('type="1"');
          expect(customGcode).toContain('gcode="M400 U1"');
          expect(customGcode).toContain(
            `top_z="${built.printPause.printZ.toFixed(5)}"`,
          );
          const gcodePath = Object.keys(sliced).find((name) => name.endsWith(".gcode"));
          expect(gcodePath, "sliced project is missing plate G-code").toBeDefined();
          expect(strFromU8(sliced[gcodePath!])).toContain("M400 U1");
        }
      },
      900_000,
    );
  }
});
