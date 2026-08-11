import { describe, expect, it } from "vitest";
import seedPhones from "../../resources/seed-phones.json";
import type { PhoneRecord } from "../types";
import { parsePhonePack, phonePackCsv } from "./catalogImport";

const phones = seedPhones as PhoneRecord[];

describe("phone pack import", () => {
  it("round-trips feature-level JSON through the scalable CSV format", () => {
    const csv = phonePackCsv(phones.slice(0, 2));
    const parsed = parsePhonePack(csv, "phones.csv");
    expect(parsed).toHaveLength(2);
    expect(parsed[0].features.length).toBe(phones[0].features.length);
    expect(parsed[0].sources[0].grade).toBe("A");
    expect(parsed[1].dimensions.width).toBe(phones[1].dimensions.width);
  });

  it("rejects incomplete body dimensions", () => {
    const pack = JSON.stringify([{ brand: "Example", model: "Broken", dimensions: { width: 0, length: 150, depth: 8 } }]);
    expect(() => parsePhonePack(pack)).toThrow(/incomplete body dimensions/i);
  });
});
