import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  validateBinaryPayload,
  validatePhone,
  validatePhoneList,
} = require("../electron/validate.cjs");

/**
 * Phone packs and imported databases are the app's untrusted input. These
 * assert that hostile or simply broken records are rejected at the main-process
 * boundary rather than reaching the geometry engine.
 */

function goodPhone(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-phone",
    brand: "Samsung",
    model: "Galaxy Test",
    confidence: 80,
    dimensions: { width: 75.9, length: 158.5, depth: 7.7, cornerRadius: 9.2 },
    features: [
      {
        id: "cam",
        name: "Wide camera",
        kind: "camera",
        side: "back",
        shape: "circle",
        center: { x: 26.8, y: 63.5, z: 8.6 },
        size: { x: 13.8, y: 13.8, z: 2.1 },
        confidence: 80,
      },
    ],
    ...overrides,
  };
}

describe("phone record validation", () => {
  it("accepts a well-formed record", () => {
    const validated = validatePhone(goodPhone());
    expect(validated.dimensions.width).toBe(75.9);
    expect(validated.features).toHaveLength(1);
  });

  it("parses numeric strings, because CSV imports carry everything as text", () => {
    const validated = validatePhone(
      goodPhone({
        dimensions: { width: "75.9", length: "158.5", depth: "7.7", cornerRadius: "9.2" },
      }),
    );
    expect(validated.dimensions.width).toBe(75.9);
  });

  for (const [label, value] of [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null],
    ["a non-numeric string", "wide"],
    ["an object", { value: 76 }],
  ] as const) {
    it(`rejects ${label} as a width`, () => {
      expect(() =>
        validatePhone(goodPhone({ dimensions: { width: value, length: 158.5, depth: 7.7, cornerRadius: 9.2 } })),
      ).toThrow();
    });
  }

  it("rejects a width far outside physical plausibility", () => {
    // A number this large is valid JSON and would produce a mesh that exhausts
    // memory during CSG.
    expect(() =>
      validatePhone(
        goodPhone({ dimensions: { width: 1e9, length: 158.5, depth: 7.7, cornerRadius: 9.2 } }),
      ),
    ).toThrow(/plausible range/i);
  });

  it("rejects a negative depth", () => {
    expect(() =>
      validatePhone(
        goodPhone({ dimensions: { width: 75.9, length: 158.5, depth: -7.7, cornerRadius: 9.2 } }),
      ),
    ).toThrow();
  });

  it("rejects a corner radius wider than the phone", () => {
    expect(() =>
      validatePhone(
        goodPhone({ dimensions: { width: 75.9, length: 158.5, depth: 7.7, cornerRadius: 38 } }),
      ),
    ).toThrow(/corner radius/i);
  });

  it("rejects an unknown feature side", () => {
    const phone = goodPhone();
    phone.features[0].side = "diagonal";
    expect(() => validatePhone(phone)).toThrow(/unknown side/i);
  });

  it("rejects a feature with non-finite geometry", () => {
    const phone = goodPhone();
    phone.features[0].center.x = Number.NaN;
    expect(() => validatePhone(phone)).toThrow(/finite/i);
  });

  it("rejects an unbounded feature list", () => {
    const phone = goodPhone({
      features: Array.from({ length: 500 }, () => goodPhone().features[0]),
    });
    expect(() => validatePhone(phone)).toThrow(/exceeds/i);
  });

  it("does not let a crafted record pollute Object.prototype", () => {
    const hostile = JSON.parse(
      '{"brand":"X","model":"Y","confidence":50,"__proto__":{"polluted":true},' +
        '"dimensions":{"width":76,"length":158,"depth":8,"cornerRadius":9},"features":[]}',
    );
    validatePhone(hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects the whole pack when any record is bad, naming the position", () => {
    const pack = [goodPhone(), goodPhone({ dimensions: { width: 0, length: 158, depth: 8, cornerRadius: 9 } })];
    expect(() => validatePhoneList(pack)).toThrow(/Record 2/);
  });

  it("rejects a pack that is not a list", () => {
    expect(() => validatePhoneList({ phones: [] })).toThrow(/list/i);
  });
});

describe("every record gets a usable id", () => {
  /**
   * A missing id is more dangerous than a malformed one. The renderer's device
   * select binds to phone.id; with undefined it becomes uncontrolled, so the
   * displayed handset and the selected handset drift apart and the user exports
   * a case built for a different phone with no error shown.
   */
  it("derives an id from brand and model when none is supplied", () => {
    const validated = validatePhone(goodPhone({ id: undefined }));
    expect(validated.id).toBe("samsung-galaxy-test");
  });

  it("derives an id when the supplied one is empty", () => {
    expect(validatePhone(goodPhone({ id: "" })).id).toBe("samsung-galaxy-test");
  });

  it("normalises a supplied id to a stable slug", () => {
    expect(validatePhone(goodPhone({ id: "Weird ID!! 123" })).id).toBe(
      "weird-id-123",
    );
  });

  it("never returns an empty or non-string id for a valid pack", () => {
    const pack = validatePhoneList([
      goodPhone({ id: undefined }),
      goodPhone({ id: "", brand: "Google", model: "Pixel 9" }),
    ]);
    for (const phone of pack) {
      expect(typeof phone.id).toBe("string");
      expect(phone.id.length).toBeGreaterThan(0);
    }
    // Distinct handsets must not collapse onto one id.
    expect(new Set(pack.map((p) => p.id)).size).toBe(pack.length);
  });

  it("rejects a record whose brand and model cannot form an id", () => {
    expect(() =>
      validatePhone(goodPhone({ id: undefined, brand: "!!!", model: "###" })),
    ).toThrow(/no usable id/i);
  });
});

describe("binary export payload validation", () => {
  it("accepts ordinary base64", () => {
    expect(validateBinaryPayload({ base64: "SGVsbG8=" })).toBe("SGVsbG8=");
  });

  it("rejects a payload that is not base64", () => {
    expect(() => validateBinaryPayload({ base64: "../../etc/passwd" })).toThrow(
      /base64/i,
    );
  });

  it("rejects an empty payload", () => {
    expect(() => validateBinaryPayload({ base64: "" })).toThrow(/no data/i);
  });

  it("rejects a payload above the size cap", () => {
    // 400 MB of base64 without allocating it as one giant string of real data.
    const oversized = "A".repeat(400 * 1024 * 1024);
    expect(() => validateBinaryPayload({ base64: oversized })).toThrow(/limit/i);
  });
});
