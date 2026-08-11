import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(directory, ".."),
  test: {
    environment: "node",
    include: [
      "scripts/slice-gate.test.ts",
      "scripts/diagnose-csg.test.ts",
      "scripts/validate.test.ts",
      "scripts/donor-measure.test.ts",
    ],
  },
});
