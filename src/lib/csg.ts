import ManifoldModule from "manifold-3d";
import type {
  CrossSection as CrossSectionType,
  Manifold as ManifoldType,
  ManifoldToplevel,
} from "manifold-3d";
import type { IndexedMesh } from "./mesh";

/**
 * Constructive solid geometry backed by Manifold.
 *
 * CaseFoundry 2026.8.0 used JSCAD's boolean engine, which emits non-watertight
 * geometry on every operation. Measured on this codebase: a plain cuboid has
 * zero boundary edges, but `cuboid MINUS cuboid` has 32, and a case shell has
 * 80. Since every case is built from booleans, every export was unslicable.
 *
 * Manifold guarantees a closed, oriented, manifold result by construction, so
 * the defect cannot recur rather than being checked for after the fact.
 */

let toplevel: ManifoldToplevel | null = null;

/** Loads the WASM module once. Must be awaited before any geometry call. */
export async function initCsg(): Promise<ManifoldToplevel> {
  if (!toplevel) {
    const loaded = await ManifoldModule();
    loaded.setup();
    toplevel = loaded;
  }
  return toplevel;
}

export function csg(): ManifoldToplevel {
  if (!toplevel) {
    throw new Error("CSG not initialised. Await initCsg() before building geometry.");
  }
  return toplevel;
}

export type Solid = ManifoldType;
export type Shape = CrossSectionType;

/**
 * Corner smoothness for rounded outlines.
 *
 * 2026.8.0 used 32 segments for a full rectangle, so each 90 degree corner got
 * roughly 8 facets and read as visibly chipped. 64 per full turn gives 16 per
 * corner, which at phone-case radii lands near 0.35 mm per facet: below what
 * a 0.4 mm nozzle can resolve, so the corner prints smooth.
 */
export const CORNER_SEGMENTS = 64;

/**
 * A rectangle with rounded corners, built by offsetting a smaller rectangle
 * outward. Offsetting keeps the corner arc a true circular fillet.
 */
export function roundedRect(
  width: number,
  length: number,
  radius: number,
  segments = CORNER_SEGMENTS,
): Shape {
  const { CrossSection } = csg();
  const safeRadius = Math.max(
    0.01,
    Math.min(radius, width / 2 - 0.01, length / 2 - 0.01),
  );
  return CrossSection.square(
    [width - safeRadius * 2, length - safeRadius * 2],
    true,
  ).offset(safeRadius, "Round", 2, segments);
}

/** Extrudes a 2D outline to a solid spanning [zBottom, zBottom + height]. */
export function extrude(shape: Shape, zBottom: number, height: number): Solid {
  return shape.extrude(Math.max(0.001, height)).translate([0, 0, zBottom]);
}

/** An axis-aligned box given its centre and size. */
export function box(
  centre: [number, number, number],
  size: [number, number, number],
): Solid {
  const { Manifold } = csg();
  return Manifold.cube(size, true).translate(centre);
}

/**
 * Builds one outline from many overlapping polygons in a single pass.
 *
 * Pattern generators produce thousands of overlapping strokes. Unioning them
 * pairwise is quadratic and slow; handing them all to Manifold at once with the
 * NonZero fill rule merges them in one operation. Every polygon must be wound
 * counter-clockwise or NonZero will punch holes instead of merging.
 */
export function mergePolygons(polygons: Array<Array<[number, number]>>): Shape {
  const { CrossSection } = csg();
  return new CrossSection(polygons, "NonZero");
}

/**
 * A thick line segment as a quad with squared ends, always wound
 * counter-clockwise.
 *
 * The winding is forced rather than left to chance. Patterns draw shared edges
 * twice from adjoining cells, once in each direction, and under the NonZero
 * fill rule two quads with OPPOSITE winding would cancel to zero and silently
 * erase every shared edge.
 *
 * As written the normal construction already yields the same cyclic order for
 * A->B and B->A, so that cancellation does not currently happen. This makes the
 * requirement explicit so a future change to the normal cannot reintroduce it
 * as a silent, hard-to-attribute hole in the artwork.
 *
 * Round caps are deliberately omitted: at the stroke widths used for kumiko
 * (roughly two extrusion widths) the cap is smaller than one printed line, so
 * it costs geometry without changing the printed result.
 */
export function strokeQuad(
  from: [number, number],
  to: [number, number],
  width: number,
): Array<[number, number]> {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  const halfWidth = width / 2;
  const nx = (-dy / length) * halfWidth;
  const ny = (dx / length) * halfWidth;

  const corners: Array<[number, number]> = [
    [from[0] + nx, from[1] + ny],
    [to[0] + nx, to[1] + ny],
    [to[0] - nx, to[1] - ny],
    [from[0] - nx, from[1] - ny],
  ];

  // Shoelace: positive area means counter-clockwise.
  let area = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const [x1, y1] = corners[index];
    const [x2, y2] = corners[(index + 1) % corners.length];
    area += x1 * y2 - x2 * y1;
  }
  return area >= 0 ? corners : corners.slice().reverse();
}

/** Converts a Manifold solid into the indexed mesh the 3MF writer consumes. */
export function solidToIndexedMesh(solid: Solid): IndexedMesh {
  const mesh = solid.getMesh();
  const stride = mesh.numProp;
  const vertexCount = mesh.vertProperties.length / stride;

  // Manifold interleaves positions with any extra vertex properties. Only the
  // first three components are the position.
  const positions = new Float64Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    positions[index * 3] = mesh.vertProperties[index * stride];
    positions[index * 3 + 1] = mesh.vertProperties[index * stride + 1];
    positions[index * 3 + 2] = mesh.vertProperties[index * stride + 2];
  }

  return {
    positions,
    indices: Uint32Array.from(mesh.triVerts),
    vertexCount,
    triangleCount: mesh.triVerts.length / 3,
  };
}

/** Frees the WASM-side memory for a batch of solids. */
export function dispose(...solids: Array<{ delete: () => void } | null | undefined>): void {
  for (const solid of solids) {
    try {
      solid?.delete();
    } catch {
      // Already released; nothing to reclaim.
    }
  }
}
