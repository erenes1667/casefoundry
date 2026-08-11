import type { IndexedMesh } from "./mesh";
import { meshBounds } from "./mesh";

/**
 * Measures an existing phone case so its fit can be reused.
 *
 * The app cannot derive a phone's camera, button and port positions from spec
 * sheets, because nobody publishes them. What it CAN do is take a case somebody
 * has already printed successfully and recover the geometry that decides fit:
 * the cavity, the wall and back thickness, and where the openings are.
 *
 * Everything here is measured from the mesh by ray casting. Nothing is assumed
 * about how the donor was modelled, so it works on any watertight case mesh
 * regardless of origin.
 */

export interface Interval {
  start: number;
  end: number;
}

export interface DonorMeasurement {
  outerWidth: number;
  outerLength: number;
  outerHeight: number;
  /** Interior pocket the phone sits in. */
  cavityWidth: number;
  cavityLength: number;
  /** Floor thickness under the phone. */
  backThickness: number;
  /** Side wall thickness, measured at mid-height on the left and right. */
  wallThickness: number;
  /** Depth from the cavity floor to the top of the wall. */
  cavityDepth: number;
  /** Vertical spans on each side wall with no material: button notches. */
  leftOpenings: Interval[];
  rightOpenings: Interval[];
  /** Horizontal spans at each end with no material: port and speaker cutouts. */
  topOpenings: Interval[];
  bottomOpenings: Interval[];
  /** How much of the back is missing, as a fraction: catches lattice backs. */
  backOpenFraction: number;
  warnings: string[];
}

/** Rays that graze a surface exactly are unreliable; nudge off exact planes. */
const EPSILON = 1e-9;

/**
 * Möller-Trumbore ray/triangle intersection.
 * Returns the distance along the ray, or null when there is no forward hit.
 */
function rayTriangle(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number | null {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;

  const px = direction[1] * e2z - direction[2] * e2y;
  const py = direction[2] * e2x - direction[0] * e2z;
  const pz = direction[0] * e2y - direction[1] * e2x;

  const determinant = e1x * px + e1y * py + e1z * pz;
  if (determinant > -EPSILON && determinant < EPSILON) return null;

  const inverse = 1 / determinant;
  const tx = origin[0] - ax;
  const ty = origin[1] - ay;
  const tz = origin[2] - az;

  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u < 0 || u > 1) return null;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;

  const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inverse;
  if (v < 0 || u + v > 1) return null;

  const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
  return distance > EPSILON ? distance : null;
}

/**
 * All distances at which a ray crosses the surface, sorted.
 *
 * For a closed mesh these alternate: enter, exit, enter, exit. So consecutive
 * pairs are spans of solid material and the gaps between pairs are air.
 */
export function rayCrossings(
  mesh: IndexedMesh,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): number[] {
  const { positions, indices } = mesh;
  const hits: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    const distance = rayTriangle(
      origin,
      direction,
      positions[a], positions[a + 1], positions[a + 2],
      positions[b], positions[b + 1], positions[b + 2],
      positions[c], positions[c + 1], positions[c + 2],
    );
    if (distance !== null) hits.push(distance);
  }
  hits.sort((first, second) => first - second);

  // Collapse near-duplicate hits from rays passing exactly along a shared edge.
  const deduped: number[] = [];
  for (const hit of hits) {
    if (!deduped.length || hit - deduped[deduped.length - 1] > 1e-6) {
      deduped.push(hit);
    }
  }
  return deduped;
}

/** Solid spans along a ray, derived from its crossings. */
function solidSpans(crossings: number[]): Interval[] {
  const spans: Interval[] = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    spans.push({ start: crossings[index], end: crossings[index + 1] });
  }
  return spans;
}

/**
 * True when there is material on the NEAR side of a ray fired inward.
 *
 * Testing "did the ray hit anything" is not enough: a ray aimed at a missing
 * wall carries on and hits the opposite wall, which reads as solid. So the test
 * is whether the first hit occurs before the ray reaches the middle of the
 * part. A first hit past the centre means the near wall is not there.
 */
function hasNearMaterial(
  mesh: IndexedMesh,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  distanceToCentre: number,
): boolean {
  const crossings = rayCrossings(mesh, origin, direction);
  if (!crossings.length) return false;
  return crossings[0] < distanceToCentre;
}

/** Median of a list, used to reject scanlines that happened to hit a cutout. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Merges adjacent open samples into contiguous intervals. */
function collectOpenIntervals(
  samples: Array<{ at: number; open: boolean }>,
  minimumLength: number,
): Interval[] {
  const intervals: Interval[] = [];
  let start: number | null = null;
  for (const sample of samples) {
    if (sample.open && start === null) start = sample.at;
    if (!sample.open && start !== null) {
      if (sample.at - start >= minimumLength) intervals.push({ start, end: sample.at });
      start = null;
    }
  }
  if (start !== null) {
    const last = samples[samples.length - 1].at;
    if (last - start >= minimumLength) intervals.push({ start, end: last });
  }
  return intervals;
}

export interface MeasureOptions {
  /** Sample spacing in mm along each wall. Smaller is slower but finer. */
  step?: number;
  /** Ignore openings shorter than this, which are usually pattern holes. */
  minimumOpeningMm?: number;
}

/**
 * Measures a donor case.
 *
 * The mesh must be watertight and oriented with the cavity opening toward +Z,
 * which is how every case in this app is modelled and how cases print.
 */
export function measureDonor(
  mesh: IndexedMesh,
  options: MeasureOptions = {},
): DonorMeasurement {
  const step = options.step ?? 1;
  const minimumOpening = options.minimumOpeningMm ?? 6;
  const warnings: string[] = [];

  const bounds = meshBounds(mesh);
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const outerWidth = bounds.size[0];
  const outerLength = bounds.size[1];
  const outerHeight = bounds.size[2];
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  // --- back thickness -------------------------------------------------
  // Fire upward from below the part at several points away from the centre,
  // where a camera opening usually sits. The first solid span is the floor.
  const backSamples: number[] = [];
  for (const fx of [-0.3, -0.15, 0.15, 0.3]) {
    for (const fy of [-0.3, -0.15, 0.15, 0.3]) {
      const spans = solidSpans(
        rayCrossings(
          mesh,
          [centreX + outerWidth * fx, centreY + outerLength * fy, minZ - 1],
          [0, 0, 1],
        ),
      );
      if (spans.length) backSamples.push(spans[0].end - spans[0].start);
    }
  }
  backSamples.sort((a, b) => a - b);
  const backThickness = backSamples.length
    ? backSamples[Math.floor(backSamples.length / 2)]
    : 0;
  if (!backSamples.length) {
    warnings.push("Could not measure the back: no solid floor found under the cavity.");
  }

  // --- cavity and wall -------------------------------------------------
  // Scan across the part just above the floor. A case reads as
  // wall | cavity | wall, so the middle gap is the pocket.
  const cavityFloorZ = minZ + backThickness;
  const cavityDepthEstimate = maxZ - cavityFloorZ;

  // Scan many lines rather than one. A single scanline through the middle can
  // land inside the button notch, where there is no second wall to measure
  // against, and silently report a cavity of zero. Taking the median across the
  // middle band ignores lines that pass through a cutout.
  // Probe at several heights as well as several lines. Button notches and port
  // openings start a little above the cavity floor, so a scan taken too high
  // finds no wall to measure against: with both ends open, no line at that
  // height crosses two end walls at all. Heights just above the floor always
  // see a complete wall ring, and pooling the valid samples ignores any line
  // that happened to pass through a cutout.
  const probeHeights = [0.25, 0.5, 0.75, Math.max(1, cavityDepthEstimate * 0.2)]
    .map((offset) => cavityFloorZ + offset)
    .filter((z) => z < maxZ - 0.5);

  const widthSamples: number[] = [];
  const wallSamples: number[] = [];
  const lengthCandidates: Array<{
    value: number;
    firstWall: number;
    lastWall: number;
  }> = [];

  for (const z of probeHeights) {
    for (let fraction = -0.35; fraction <= 0.35; fraction += 0.05) {
      const y = centreY + outerLength * fraction;
      const spans = solidSpans(rayCrossings(mesh, [minX - 1, y, z], [1, 0, 0]));
      if (spans.length >= 2) {
        const first = spans[0];
        const last = spans[spans.length - 1];
        widthSamples.push(last.start - first.end);
        wallSamples.push((first.end - first.start + (last.end - last.start)) / 2);
      }

      const x = centreX + outerWidth * fraction;
      const endSpans = solidSpans(rayCrossings(mesh, [x, minY - 1, z], [0, 1, 0]));
      if (endSpans.length >= 2) {
        const first = endSpans[0];
        const last = endSpans[endSpans.length - 1];
        lengthCandidates.push({
          value: last.start - first.end,
          firstWall: first.end - first.start,
          lastWall: last.end - last.start,
        });
      }
    }
  }

  const cavityWidth = median(widthSamples);
  const wallThickness = median(wallSamples);
  // A deep port relief can expose a short strip of backplate that looks like
  // an end wall to a scanline. Keep only candidates whose first and last solid
  // spans resemble the measured side-wall thickness. This prevents the 7 mm
  // USB-C cable notch from being mistaken for extra cavity length.
  const lengthSamples = lengthCandidates
    .filter(({ firstWall, lastWall }) => {
      if (!wallThickness) return true;
      const minimum = wallThickness * 0.7;
      const maximum = wallThickness * 2;
      return (
        firstWall >= minimum &&
        firstWall <= maximum &&
        lastWall >= minimum &&
        lastWall <= maximum
      );
    })
    .map(({ value }) => value);
  const cavityLength = median(lengthSamples);

  if (!widthSamples.length) {
    warnings.push("Could not measure cavity width: no scan line crossed two walls.");
  }
  if (!lengthSamples.length) {
    warnings.push("Could not measure cavity length: no scan line crossed two walls.");
  }

  const cavityDepth = maxZ - (minZ + backThickness);

  // --- side openings ----------------------------------------------------
  // Walk each wall and record where a ray through it finds no material.
  const sideZ = minZ + backThickness + Math.max(1, cavityDepth * 0.5);
  // Distance from each ray's start to the centreline of the part. A first hit
  // beyond this means the near wall is missing.
  const xReach = maxX + 1 - centreX;
  const yReach = maxY + 1 - centreY;

  const leftSamples: Array<{ at: number; open: boolean }> = [];
  const rightSamples: Array<{ at: number; open: boolean }> = [];
  for (let y = minY + 2; y <= maxY - 2; y += step) {
    leftSamples.push({
      at: y,
      open: !hasNearMaterial(mesh, [minX - 1, y, sideZ], [1, 0, 0], xReach),
    });
    rightSamples.push({
      at: y,
      open: !hasNearMaterial(mesh, [maxX + 1, y, sideZ], [-1, 0, 0], xReach),
    });
  }

  const endSamples: Array<{ at: number; open: boolean }> = [];
  const topSamples: Array<{ at: number; open: boolean }> = [];
  for (let x = minX + 2; x <= maxX - 2; x += step) {
    topSamples.push({
      at: x,
      open: !hasNearMaterial(mesh, [x, maxY + 1, sideZ], [0, -1, 0], yReach),
    });
    endSamples.push({
      at: x,
      open: !hasNearMaterial(mesh, [x, minY - 1, sideZ], [0, 1, 0], yReach),
    });
  }

  // --- how open is the back --------------------------------------------
  // A high fraction means a lattice or skeleton back rather than a solid one.
  let backProbes = 0;
  let backOpen = 0;
  for (let x = minX + 3; x <= maxX - 3; x += Math.max(2, step * 2)) {
    for (let y = minY + 3; y <= maxY - 3; y += Math.max(2, step * 2)) {
      backProbes += 1;
      if (!hasNearMaterial(mesh, [x, y, minZ - 1], [0, 0, 1], outerHeight / 2)) backOpen += 1;
    }
  }

  return {
    outerWidth,
    outerLength,
    outerHeight,
    cavityWidth,
    cavityLength,
    backThickness,
    wallThickness,
    cavityDepth,
    leftOpenings: collectOpenIntervals(leftSamples, minimumOpening),
    rightOpenings: collectOpenIntervals(rightSamples, minimumOpening),
    topOpenings: collectOpenIntervals(topSamples, minimumOpening),
    bottomOpenings: collectOpenIntervals(endSamples, minimumOpening),
    backOpenFraction: backProbes ? backOpen / backProbes : 0,
    warnings,
  };
}

export interface DonorFitCheck {
  usable: boolean;
  /** Implied clearance per side against the phone's published body width. */
  impliedWidthClearance: number;
  impliedLengthClearance: number;
  impliedDepthClearance: number;
  problems: string[];
}

/**
 * Cross-checks a measured donor against the phone's published body dimensions.
 *
 * This is the gate that catches a donor for the wrong handset, a model uploaded
 * at the wrong scale, or a listing whose title lies. Body width, height and
 * depth ARE published for every phone, so they are exactly the right thing to
 * validate a community model against.
 */
export function checkDonorAgainstPhone(
  measurement: DonorMeasurement,
  phone: { width: number; length: number; depth: number },
  limits: { min?: number; max?: number } = {},
): DonorFitCheck {
  const minimum = limits.min ?? 0.1;
  const maximum = limits.max ?? 1.2;
  const problems: string[] = [];

  const impliedWidthClearance = (measurement.cavityWidth - phone.width) / 2;
  const impliedLengthClearance = (measurement.cavityLength - phone.length) / 2;
  const impliedDepthClearance = measurement.cavityDepth - phone.depth;

  const check = (value: number, label: string) => {
    if (!Number.isFinite(value)) {
      problems.push(`${label} could not be measured.`);
      return;
    }
    if (value < minimum) {
      problems.push(
        `${label} is ${value.toFixed(2)} mm, tighter than the ${minimum} mm floor. ` +
          `The phone will not go in, or this donor is for a smaller handset.`,
      );
    } else if (value > maximum) {
      problems.push(
        `${label} is ${value.toFixed(2)} mm, looser than the ${maximum} mm ceiling. ` +
          `The phone will rattle, or this donor is for a larger handset.`,
      );
    }
  };

  check(impliedWidthClearance, "Width clearance");
  check(impliedLengthClearance, "Length clearance");

  if (impliedDepthClearance < -0.2) {
    problems.push(
      `The cavity is ${Math.abs(impliedDepthClearance).toFixed(2)} mm shallower than the phone is thick.`,
    );
  }

  return {
    usable: problems.length === 0,
    impliedWidthClearance,
    impliedLengthClearance,
    impliedDepthClearance,
    problems: [...problems, ...measurement.warnings],
  };
}
