import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import seedPhones from "../resources/seed-phones.json";

const require = createRequire(import.meta.url);
const { SCHEMA_VERSION, migrateCatalog } = require("../electron/migrate.cjs") as {
  SCHEMA_VERSION: number;
  migrateCatalog: (
    input: Record<string, unknown>,
    seeds: typeof seedPhones,
  ) => {
    data: any;
    changed: boolean;
    actions: Array<{ action: string; summary: string }>;
  };
};

function oldDatabase(cornerRadius = 9) {
  const phone = structuredClone(
    seedPhones.find((entry) => entry.id === "samsung-galaxy-s23-fe-sm-s711")!,
  );
  phone.revision = 4;
  phone.dimensions.cornerRadius = cornerRadius;
  phone.updatedAt = "2026-08-08T00:00:00.000Z";
  return {
    schemaVersion: 1,
    phones: [phone],
    projects: [{ id: "keep-me", name: "Existing project" }],
    audit: [],
  };
}

describe("catalog migrations", () => {
  it("updates the bundled S23 FE fit correction and preserves projects", () => {
    const result = migrateCatalog(oldDatabase(), seedPhones);
    const phone = result.data.phones[0];

    expect(result.changed).toBe(true);
    expect(result.data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(phone.revision).toBe(5);
    expect(phone.dimensions.cornerRadius).toBe(11);
    expect(result.data.projects).toEqual([{ id: "keep-me", name: "Existing project" }]);
    expect(result.actions.some((entry) => entry.action === "s23fe_fit_geometry_updated")).toBe(true);
  });

  it("does not overwrite a user-edited corner radius", () => {
    const result = migrateCatalog(oldDatabase(10.5), seedPhones);
    expect(result.data.phones[0].dimensions.cornerRadius).toBe(10.5);
    expect(result.actions.some((entry) => entry.action === "s23fe_fit_geometry_updated")).toBe(false);
  });

  it("is idempotent after schema migration", () => {
    const once = migrateCatalog(oldDatabase(), seedPhones);
    const twice = migrateCatalog(once.data, seedPhones);
    expect(twice.changed).toBe(false);
    expect(twice.data).toEqual(once.data);
  });
});
