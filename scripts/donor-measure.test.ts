import { beforeAll, describe, expect, it } from "vitest";
import phonesJson from "../resources/seed-phones.json";
import { defaultConfiguration } from "../src/data/catalog";
import { generateCase, ensureEngineReady, tuneConfiguration } from "../src/lib/caseEngine";
import {
  checkDonorAgainstPhone,
  measureDonor,
  rayCrossings,
} from "../src/lib/donorMeasure";
import { diagnoseMesh, type IndexedMesh } from "../src/lib/mesh";
import type { PhoneRecord } from "../src/types";

/**
 * Round-trip proof for donor measurement.
 *
 * A case is generated for a phone whose dimensions we know exactly, then
 * measured as if it were an unknown donor downloaded from MakerWorld. If the
 * measurement is correct it must recover the numbers that went in. This is the
 * only way to test the measurement code without hand-labelled donor files.
 */

const phones = phonesJson as PhoneRecord[];

beforeAll(async () => {
  await ensureEngineReady();
});

describe("measuring a case recovers what built it", () => {
  for (const phone of phones) {
    it(`${phone.model}`, () => {
      const config = tuneConfiguration(phone, {
        ...defaultConfiguration(phone.id),
        // A plain back keeps the measurement about fit, not artwork.
        pattern: "none",
      });
      const built = generateCase(phone, config);
      const measurement = measureDonor(built.geometry as IndexedMesh, { step: 2 });

      // Cavity should come back as the phone plus clearance on each side.
      const expectedCavityWidth = phone.dimensions.width + config.tolerance * 2;
      const expectedCavityLength = phone.dimensions.length + config.tolerance * 2;

      expect(measurement.cavityWidth).toBeCloseTo(expectedCavityWidth, 1);
      expect(measurement.cavityLength).toBeCloseTo(expectedCavityLength, 1);
      expect(measurement.backThickness).toBeCloseTo(config.backThickness, 1);
      expect(measurement.wallThickness).toBeCloseTo(config.wall, 1);

      // And the implied clearance must match what the configuration asked for.
      const check = checkDonorAgainstPhone(measurement, phone.dimensions);
      expect(check.impliedWidthClearance).toBeCloseTo(config.tolerance, 1);
      expect(check.impliedLengthClearance).toBeCloseTo(config.tolerance, 1);

      console.log(
        `${phone.model.padEnd(16)} cavity=${measurement.cavityWidth.toFixed(2)} x ` +
          `${measurement.cavityLength.toFixed(2)} back=${measurement.backThickness.toFixed(2)} ` +
          `wall=${measurement.wallThickness.toFixed(2)} ` +
          `clearance=${check.impliedWidthClearance.toFixed(2)} ` +
          `openings L=${measurement.leftOpenings.length} R=${measurement.rightOpenings.length} ` +
          `T=${measurement.topOpenings.length} B=${measurement.bottomOpenings.length}`,
      );
    }, 120_000);
  }
});

describe("openings are found on the correct side", () => {
  it("puts the notch on the side the phone record says the buttons are", () => {
    const phone = phones.find((entry) => entry.model === "Galaxy S24+")!;
    const config = tuneConfiguration(phone, {
      ...defaultConfiguration(phone.id),
      pattern: "none",
      topOpening: false,
      bottomOpening: false,
    });
    const built = generateCase(phone, config);
    const measurement = measureDonor(built.geometry as IndexedMesh, { step: 1 });

    const buttons = phone.features.filter(
      (feature) => feature.kind === "button" && feature.side === "screenRight",
    );
    expect(buttons.length).toBeGreaterThan(0);

    // screenRight is +X, so the opening must show up on the right wall only.
    expect(measurement.rightOpenings.length).toBeGreaterThan(0);
    expect(measurement.leftOpenings.length).toBe(0);

    // And it must span the buttons it was cut for.
    const lowest = Math.min(...buttons.map((b) => b.center.y - b.size.y / 2));
    const highest = Math.max(...buttons.map((b) => b.center.y + b.size.y / 2));
    const covering = measurement.rightOpenings.some(
      (opening) => opening.start <= lowest + 1 && opening.end >= highest - 1,
    );
    expect(covering, "no right-side opening spans the button block").toBe(true);
  }, 120_000);
});

describe("donor fit gate", () => {
  const measurement = {
    outerWidth: 80,
    outerLength: 163,
    outerHeight: 11,
    cavityWidth: 76.6,
    cavityLength: 159.2,
    backThickness: 1.6,
    wallThickness: 2,
    cavityDepth: 8.4,
    leftOpenings: [],
    rightOpenings: [],
    topOpenings: [],
    bottomOpenings: [],
    backOpenFraction: 0,
    warnings: [],
  };

  it("accepts a donor whose cavity matches the phone", () => {
    const check = checkDonorAgainstPhone(measurement, {
      width: 75.9,
      length: 158.5,
      depth: 7.7,
    });
    expect(check.usable).toBe(true);
  });

  it("rejects a donor built for a noticeably larger handset", () => {
    const check = checkDonorAgainstPhone(measurement, {
      width: 70,
      length: 150,
      depth: 7.7,
    });
    expect(check.usable).toBe(false);
    expect(check.problems.join(" ")).toMatch(/looser/i);
  });

  it("rejects a donor that is too tight to accept the phone", () => {
    const check = checkDonorAgainstPhone(measurement, {
      width: 76.6,
      length: 159.2,
      depth: 7.7,
    });
    expect(check.usable).toBe(false);
    expect(check.problems.join(" ")).toMatch(/tighter/i);
  });

  it("rejects a donor whose cavity is shallower than the phone", () => {
    const check = checkDonorAgainstPhone(
      { ...measurement, cavityDepth: 6 },
      { width: 75.9, length: 158.5, depth: 7.7 },
    );
    expect(check.usable).toBe(false);
    expect(check.problems.join(" ")).toMatch(/shallower/i);
  });
});

describe("reported geometry bugs", () => {
  const phone = phones.find((entry) => entry.model === "Galaxy S24+")!;

  function build(overrides: Record<string, unknown>) {
    const config = tuneConfiguration(phone, {
      ...defaultConfiguration(phone.id),
      pattern: "none",
      ...overrides,
    } as never);
    return generateCase(phone, config);
  }

  /**
   * "the side button closure doesn't even work".
   *
   * buttonStyle never reached the geometry, so the toggle did nothing at all.
   * A covered case must ADD material (a pressable pad) where an open one CUTS
   * a notch, so covered must enclose more volume than open.
   */
  it("covered buttons add a pad instead of doing nothing", () => {
    const open = build({ material: "tpu-95a", buttonStyle: "open" });
    const covered = build({ material: "tpu-95a", buttonStyle: "covered" });

    const openVolume = Math.abs(
      diagnoseMesh(open.geometry as IndexedMesh).signedVolumeMm3,
    );
    const coveredVolume = Math.abs(
      diagnoseMesh(covered.geometry as IndexedMesh).signedVolumeMm3,
    );
    expect(
      coveredVolume,
      "covered buttons produced the same geometry as open, so the toggle is inert",
    ).toBeGreaterThan(openVolume);
  });

  /**
   * "when I try to close the top and bottom it looks shitty".
   *
   * Every port was cut as a plain box regardless of its declared shape, so a
   * round microphone became a square hole and the USB-C slot a sharp rectangle.
   * A rounded opening narrows towards its top and bottom edges; a rectangular
   * one has the same width all the way up. Measuring that difference is a
   * direct test of the shape, not of the triangle count.
   */
  it("closed-end port openings are rounded, not rectangles", () => {
    const closed = build({ topOpening: false, bottomOpening: false });
    const mesh = closed.geometry as IndexedMesh;

    const port = phone.features.find(
      (feature) => feature.side === "bottom" && feature.kind === "port",
    )!;
    const config = tuneConfiguration(phone, {
      ...defaultConfiguration(phone.id),
      pattern: "none",
      topOpening: false,
      bottomOpening: false,
    });
    const centreZ = config.backThickness + port.center.z;

    // Width of the opening at its middle and near its top edge.
    const widthAt = (z: number) => {
      const crossings = rayCrossings(
        mesh,
        [-60, -phone.dimensions.length / 2 - config.wall / 2, z],
        [1, 0, 0],
      );
      // Gaps between solid spans along this scan line, largest wins.
      let widest = 0;
      for (let index = 1; index + 1 < crossings.length; index += 2) {
        widest = Math.max(widest, crossings[index + 1] - crossings[index]);
      }
      return widest;
    };

    const middle = widthAt(centreZ);
    const nearEdge = widthAt(centreZ + port.size.z / 2 - 0.15);

    expect(middle, "no opening found at the port").toBeGreaterThan(1);
    expect(
      nearEdge,
      "opening is the same width at its edge as at its middle, so it is a rectangle",
    ).toBeLessThan(middle - 0.3);
  });
});
