import {
  booleans,
  extrusions,
  geometries,
  primitives,
  transforms,
} from "@jscad/modeling";
import type { Geom3 } from "@jscad/modeling/src/geometries/geom3";
import { it } from "vitest";
import { diagnoseMesh, type IndexedMesh } from "../src/lib/mesh";

/**
 * Records WHY the geometry engine was replaced, as a runnable measurement.
 *
 * CaseFoundry 2026.8.0 built every case with JSCAD booleans. This shows that
 * JSCAD primitives are watertight but the result of any boolean is not, which
 * is why every 8.0 export had holes and could not be sliced. Production code no
 * longer depends on JSCAD; this file keeps the evidence reproducible.
 *
 * Run: npx vitest run --config scripts/vitest.export.config.ts scripts/diagnose-csg.test.ts
 */

/**
 * Welds JSCAD's independent polygons into an indexed mesh. Kept local to this
 * test so the shipped app carries no JSCAD dependency.
 */
function jscadToIndexedMesh(geometry: Geom3): IndexedMesh {
  const polygons = geometries.geom3.toPolygons(geometry);
  const positions: number[] = [];
  const indices: number[] = [];
  const lookup = new Map<string, number>();
  const epsilon = 1e-5;

  const vertexIndex = (point: number[]): number => {
    const key = [0, 1, 2]
      .map((axis) => Math.round(point[axis] / epsilon))
      .join(",");
    const existing = lookup.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(point[0], point[1], point[2]);
    lookup.set(key, index);
    return index;
  };

  for (const polygon of polygons) {
    const corners = polygon.vertices;
    if (corners.length < 3) continue;
    const first = vertexIndex(corners[0]);
    for (let offset = 1; offset + 1 < corners.length; offset += 1) {
      const second = vertexIndex(corners[offset]);
      const third = vertexIndex(corners[offset + 1]);
      if (first === second || second === third || third === first) continue;
      indices.push(first, second, third);
    }
  }

  return {
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

it("shows JSCAD booleans produce non-watertight geometry", () => {
  const report = (label: string, geometry: Geom3) => {
    const mesh = jscadToIndexedMesh(geometry);
    const diagnostics = diagnoseMesh(mesh);
    console.log(
      `${label.padEnd(46)} tris=${String(mesh.triangleCount).padStart(6)} ` +
        `boundary=${String(diagnostics.boundaryEdges).padStart(5)} ` +
        `nonManifold=${String(diagnostics.nonManifoldEdges).padStart(4)}`,
    );
  };

  report("cuboid (no CSG)", primitives.cuboid({ size: [10, 20, 3] }));
  report(
    "extruded roundedRectangle (no CSG)",
    extrusions.extrudeLinear(
      { height: 10 },
      primitives.roundedRectangle({ size: [76, 158], roundRadius: 9, segments: 32 }),
    ),
  );
  report(
    "cuboid MINUS cuboid",
    booleans.subtract(
      primitives.cuboid({ size: [20, 20, 20] }),
      primitives.cuboid({ size: [10, 10, 30] }),
    ),
  );

  const outer = extrusions.extrudeLinear(
    { height: 10 },
    primitives.roundedRectangle({ size: [80, 162], roundRadius: 11, segments: 32 }),
  );
  const cavity = transforms.translate(
    [0, 0, 1.5],
    extrusions.extrudeLinear(
      { height: 10 },
      primitives.roundedRectangle({ size: [76, 158], roundRadius: 9, segments: 32 }),
    ),
  );
  report("rounded shell (outer MINUS cavity)", booleans.subtract(outer, cavity));

  const cylinders = Array.from({ length: 12 }, (_, index) =>
    transforms.translate(
      [index * 2 - 12, 0, 0],
      primitives.cylinder({ radius: 1.5, height: 4, segments: 16 }),
    ),
  );
  report("union of 12 cylinders", booleans.union(...cylinders));
}, 300_000);
