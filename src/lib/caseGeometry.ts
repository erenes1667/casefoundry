import {
  CORNER_SEGMENTS,
  box,
  csg,
  dispose,
  extrude,
  mergePolygons,
  roundedRect,
  strokeQuad,
  type Shape,
  type Solid,
} from "./csg";
import type { PhoneFeature, PhoneRecord } from "../types";

/** Minimum vertical opening for a molded USB-C cable housing, in mm. */
export const USB_C_CABLE_CLEARANCE_MM = 7;

/** Minimum continuous material on either face of buried artwork, in mm. */
export const MIN_PATTERN_SKIN_MM = 0.55;

/** Smallest buried channel that remains intentional after slicing, in mm. */
export const MIN_SEALED_PATTERN_DEPTH_MM = 0.2;

/** Minimum plastic between an embedded ring and the phone cavity, in mm. */
export const MIN_MAGSAFE_INNER_COVER_MM = 0.55;

/**
 * Resolves the actual buried-artwork layers used by both geometry and QA.
 * Sharing this calculation prevents the preview, export, and warning panel
 * from disagreeing about how much continuous material remains.
 */
export function sealedPatternLayers(
  backThickness: number,
  requestedDepth: number,
): { outerSkin: number; depth: number; innerSkin: number } {
  const outerSkin = MIN_PATTERN_SKIN_MM;
  const maximumDepth = backThickness - MIN_PATTERN_SKIN_MM * 2;
  const depth = Math.max(
    MIN_SEALED_PATTERN_DEPTH_MM,
    Math.min(requestedDepth, maximumDepth),
  );
  return {
    outerSkin,
    depth,
    innerSkin: backThickness - outerSkin - depth,
  };
}

/** Recognises the common labels used for USB-C ports in imported phone packs. */
export function isUsbCPort(feature: PhoneFeature): boolean {
  if (
    feature.kind !== "port" ||
    (feature.side !== "top" && feature.side !== "bottom")
  ) {
    return false;
  }
  const label = `${feature.name} ${feature.notes ?? ""}`;
  return /\b(?:usb(?:[\s-]+type)?|type)[\s-]*c\b/i.test(label);
}

/**
 * Case geometry, rebuilt on Manifold.
 *
 * Coordinate system matches the app's stored convention:
 *   +X = the handset's screen-right edge
 *   +Y = the top of the handset
 *   +Z = up out of the screen
 * The case is modelled cavity-up, which is also how it prints: back on the
 * plate, opening toward the nozzle.
 */

export interface CaseSpec {
  /** Gap between phone body and cavity wall, per side, in mm. */
  cavityClearance: number;
  /** Side wall thickness in mm. */
  wall: number;
  /** Thickness of the closed back in mm. */
  backThickness: number;
  /** How far the lip wraps over the screen face in mm. */
  lipHeight: number;
  /** How far the lip protrudes inward over the screen in mm. */
  lipOverhang: number;
  /** Clearance added around camera openings, per side, in mm. */
  cameraMargin: number;
  /** Layer height, used to step the chamfer so it prints support-free. */
  layerHeight: number;
  /** First layer height, used to align insert cavities to real print layers. */
  initialLayerHeight: number;
  openTop: boolean;
  openBottom: boolean;
  /**
   * "open" cuts a notch through the side wall. "covered" keeps the wall intact
   * and raises a pressable pad over each button, which only works in a flexible
   * material. This never reached the geometry before, so the UI toggle did
   * nothing at all.
   */
  buttonStyle: "open" | "covered";
  /** Leave the lip only at the four corners, as rigid cases need. */
  cornerLipOnly: boolean;
  pattern:
    | "none"
    | "asanoha"
    | "sakura"
    | "kikko"
    | "shippo"
    | "seigaiha"
    | "goma"
    | "shokko"
    | "saya-gata"
    | "izutsu-wari-bishi"
    | "wari-bishi"
    | "sanjyu-bishi"
    | "senbon-koushi";
  patternMode: "engraved" | "through" | "sealed" | "inlay";
  patternDepth: number;
  patternStroke: number;
  patternScale: number;
  magsafe: {
    enabled: boolean;
    outerDiameter: number;
    innerDiameter: number;
    thickness: number;
    radialClearance: number;
    zClearance: number;
    exteriorCover: number;
    centerY: number;
  };
}

export interface ResolvedMagSafeInsert {
  outerDiameter: number;
  innerDiameter: number;
  centerY: number;
  cavityBottom: number;
  cavityTop: number;
  cavityHeight: number;
  pausePrintZ: number;
  requiredBackThickness: number;
}

/** Rounds a Z height upward to a boundary the configured slicer can produce. */
function nextLayerBoundary(
  requestedZ: number,
  initialLayerHeight: number,
  layerHeight: number,
): number {
  const first = Math.max(0.01, initialLayerHeight);
  const layer = Math.max(0.01, layerHeight);
  if (requestedZ <= first) return first;
  const steps = Math.ceil((requestedZ - first - 1e-8) / layer);
  return Number((first + steps * layer).toFixed(5));
}

/**
 * Resolves the actual insert pocket and pause height used by geometry and QA.
 * The cavity starts and ends on print-layer boundaries, so the pause cannot
 * land halfway through the layer that is supposed to seal the insert.
 */
export function resolveMagSafeInsert(
  spec: CaseSpec,
): ResolvedMagSafeInsert | null {
  if (!spec.magsafe.enabled) return null;
  const radialClearance = Math.max(0, spec.magsafe.radialClearance);
  const outerDiameter = Math.max(10, spec.magsafe.outerDiameter + radialClearance * 2);
  const innerDiameter = Math.max(
    1,
    Math.min(
      spec.magsafe.innerDiameter - radialClearance * 2,
      outerDiameter - Math.max(1, spec.patternStroke),
    ),
  );
  const cavityBottom = nextLayerBoundary(
    Math.max(0.01, spec.magsafe.exteriorCover),
    spec.initialLayerHeight,
    spec.layerHeight,
  );
  const cavityTop = nextLayerBoundary(
    cavityBottom + Math.max(0.1, spec.magsafe.thickness) + Math.max(0, spec.magsafe.zClearance),
    spec.initialLayerHeight,
    spec.layerHeight,
  );
  return {
    outerDiameter,
    innerDiameter,
    centerY: spec.magsafe.centerY,
    cavityBottom,
    cavityTop,
    cavityHeight: cavityTop - cavityBottom,
    // Bambu stores the top Z of the first layer printed after the pause.
    pausePrintZ: Number((cavityTop + spec.layerHeight).toFixed(5)),
    requiredBackThickness: nextLayerBoundary(
      cavityTop + MIN_MAGSAFE_INNER_COVER_MM,
      spec.initialLayerHeight,
      spec.layerHeight,
    ),
  };
}

/** Annular 2D pocket for the magnetic ring, optionally expanded as a keepout. */
function magSafeRingShape(spec: CaseSpec, extra = 0): Shape | null {
  const insert = resolveMagSafeInsert(spec);
  if (!insert) return null;
  const outerDiameter = insert.outerDiameter + extra * 2;
  const innerDiameter = Math.max(1, insert.innerDiameter - extra * 2);
  const outer = roundedRect(outerDiameter, outerDiameter, outerDiameter / 2);
  const inner = roundedRect(innerDiameter, innerDiameter, innerDiameter / 2);
  const ring = outer.subtract(inner).translate([0, insert.centerY]);
  outer.delete();
  inner.delete();
  return ring;
}

export interface CaseDimensions {
  innerWidth: number;
  innerLength: number;
  innerRadius: number;
  outerWidth: number;
  outerLength: number;
  outerRadius: number;
  /** Z of the phone's screen face, i.e. where the lip starts. */
  phoneTop: number;
  /** Z of the very top of the case wall. */
  totalHeight: number;
}

export function caseDimensions(phone: PhoneRecord, spec: CaseSpec): CaseDimensions {
  const innerWidth = phone.dimensions.width + spec.cavityClearance * 2;
  const innerLength = phone.dimensions.length + spec.cavityClearance * 2;
  const innerRadius = phone.dimensions.cornerRadius + spec.cavityClearance;
  const phoneTop =
    spec.backThickness + phone.dimensions.depth + spec.cavityClearance;
  return {
    innerWidth,
    innerLength,
    innerRadius,
    outerWidth: innerWidth + spec.wall * 2,
    outerLength: innerLength + spec.wall * 2,
    outerRadius: innerRadius + spec.wall,
    phoneTop,
    totalHeight: phoneTop + spec.lipHeight,
  };
}

/**
 * Builds the cavity with a chamfered entry under the lip.
 *
 * The lip overhangs inward over the screen. A square transition would be a
 * horizontal ceiling printed over open air, which is exactly the geometry that
 * forced tree supports in the older profiles and left scarring on the lip.
 * Stepping the transition at one layer per step produces a 45 degree ramp; at
 * or under 45 degrees each layer is supported by the one below it, so no
 * support material is needed. Stepping at layer height is not an approximation
 * in print terms because the slicer discretises to layers anyway.
 */
function cavityWithChamfer(
  dimensions: CaseDimensions,
  spec: CaseSpec,
): Solid {
  const { Manifold } = csg();
  const parts: Solid[] = [];

  const fullShape = roundedRect(
    dimensions.innerWidth,
    dimensions.innerLength,
    dimensions.innerRadius,
  );

  // Chamfer occupies the top of the pocket, immediately below the screen face.
  const chamferHeight = Math.min(spec.lipOverhang, spec.lipHeight);
  const pocketHeight = Math.max(
    0.01,
    dimensions.phoneTop - spec.backThickness - chamferHeight,
  );

  parts.push(extrude(fullShape, spec.backThickness, pocketHeight));

  // Ramp: full opening at the bottom, narrowed by lipOverhang at the top.
  const steps = Math.max(1, Math.ceil(chamferHeight / spec.layerHeight));
  const stepHeight = chamferHeight / steps;
  const chamferBase = spec.backThickness + pocketHeight;
  for (let step = 0; step < steps; step += 1) {
    const inset = (spec.lipOverhang * step) / steps;
    const stepShape = fullShape.offset(-inset, "Miter", 2, CORNER_SEGMENTS);
    parts.push(extrude(stepShape, chamferBase + step * stepHeight, stepHeight * 1.02));
    stepShape.delete();
  }

  // Above the screen face the opening stays at its narrowest, forming the lip.
  const lipShape = fullShape.offset(-spec.lipOverhang, "Miter", 2, CORNER_SEGMENTS);
  parts.push(
    extrude(lipShape, dimensions.phoneTop, spec.lipHeight + 1),
  );
  lipShape.delete();
  fullShape.delete();

  const cavity = Manifold.union(parts);
  dispose(...parts);
  return cavity;
}

/** Rear openings for camera islands, individual lenses and the flash. */
function cameraShapes(phone: PhoneRecord, margin: number): Shape[] {
  const islands = phone.features.filter(
    (feature) => feature.side === "back" && feature.kind === "cameraIsland",
  );
  const source = islands.length
    ? islands
    : phone.features.filter(
        (feature) =>
          feature.side === "back" &&
          (feature.kind === "camera" || feature.kind === "flash"),
      );

  return source.map((feature) => {
    const extra = feature.kind === "flash" ? margin * 0.62 : margin;
    const width = feature.size.x + extra * 2;
    const length = feature.size.y + extra * 2;
    const radius =
      feature.shape === "circle"
        ? Math.max(width, length) / 2
        : Math.min(3.2, width / 3, length / 3);
    return roundedRect(width, length, radius).translate([
      feature.center.x,
      feature.center.y,
    ]);
  });
}

/**
 * One open notch spanning every button on a side.
 *
 * Rigid materials cannot flex, so a bridge over the buttons either blocks the
 * press or traps the phone. Rigid cases therefore keep this side open.
 */
function buttonNotch(
  features: PhoneFeature[],
  side: "screenRight" | "screenLeft",
  dimensions: CaseDimensions,
  spec: CaseSpec,
): Solid | null {
  const buttons = features.filter(
    (feature) => feature.kind === "button" && feature.side === side,
  );
  if (!buttons.length) return null;

  const padding = 3.2;
  const lowY = Math.min(...buttons.map((b) => b.center.y - b.size.y / 2)) - padding;
  const highY = Math.max(...buttons.map((b) => b.center.y + b.size.y / 2)) + padding;

  // Start the notch just above the back so the shell keeps a continuous floor.
  const lowZ = spec.backThickness + 0.8;
  const height = dimensions.totalHeight - lowZ + 2;
  const sign = side === "screenRight" ? 1 : -1;

  return box(
    [
      (sign * dimensions.outerWidth) / 2,
      (lowY + highY) / 2,
      lowZ + height / 2,
    ],
    [spec.wall * 4, highY - lowY, height],
  );
}

/**
 * Raised pads over the buttons, for flexible materials.
 *
 * The wall stays continuous and a bump sits proud of it, so the user presses
 * the bump and the TPU transmits it to the button underneath. A relief groove
 * around the pad lets it hinge instead of fighting the whole wall.
 *
 * This is only offered for flexible materials. A rigid pad cannot deflect, so
 * it would either do nothing or wedge the button permanently down.
 */
function coveredButtonPads(
  features: PhoneFeature[],
  dimensions: CaseDimensions,
  spec: CaseSpec,
): { add: Solid[]; cut: Solid[] } {
  const add: Solid[] = [];
  const cut: Solid[] = [];

  for (const feature of features) {
    if (feature.kind !== "button") continue;
    if (feature.side !== "screenLeft" && feature.side !== "screenRight") continue;
    const sign = feature.side === "screenRight" ? 1 : -1;

    const padHeight = Math.max(2.4, feature.size.z + 1.2);
    const padLength = feature.size.y + 1.6;
    const proud = 0.9;
    const centreZ = spec.backThickness + feature.center.z;

    // The pad straddles the wall so it fuses to it rather than floating.
    const padShape = roundedRect(proud * 2 + spec.wall, padLength, 0.8);
    add.push(
      extrude(padShape, centreZ - padHeight / 2, padHeight).translate([
        sign * (dimensions.outerWidth / 2 + proud - spec.wall / 2),
        feature.center.y,
        0,
      ]),
    );
    padShape.delete();

    // Relief groove: a shallow slot just outside the pad on each end, so the
    // pad can hinge. Cut, not added, hence the separate list.
    for (const end of [-1, 1]) {
      cut.push(
        box(
          [
            sign * (dimensions.outerWidth / 2),
            feature.center.y + end * (padLength / 2 + 0.9),
            centreZ,
          ],
          [spec.wall * 1.2, 1.0, padHeight + 1.6],
        ),
      );
    }
  }
  return { add, cut };
}

/**
 * A port, speaker or microphone opening cut through an end wall, following the
 * shape the phone record declares.
 *
 * Previously every one of these was a plain box, so a 2.2 mm round microphone
 * became a square hole and a USB-C slot became a sharp rectangle. Sharp
 * rectangular holes look cheap and are stress risers at the corners; real cases
 * use rounded slots.
 *
 * The profile is built in plan and then rotated so its extrusion axis runs
 * along Y, through the end wall.
 */
function endFeatureCutout(
  feature: PhoneFeature,
  dimensions: CaseDimensions,
  spec: CaseSpec,
): Solid {
  const margin = 0.8;
  const width = feature.size.x + margin * 2;
  const height = Math.max(
    2.4,
    feature.size.z + margin * 2,
    isUsbCPort(feature) ? USB_C_CABLE_CLEARANCE_MM : 0,
  );

  let profile: Shape;
  if (isUsbCPort(feature)) {
    // A stadium reaches the requested height only on its centreline and
    // quickly tapers toward the ends. That clears the metal plug but can still
    // pinch a wider molded cable housing. Keep modestly rounded corners while
    // preserving the 7 mm envelope across the usable connector width.
    profile = roundedRect(width, height, Math.min(1.2, height / 3));
  } else if (feature.shape === "circle") {
    const diameter = Math.max(width, height);
    profile = roundedRect(diameter, diameter, diameter / 2);
  } else if (feature.shape === "slot") {
    // Stadium: fully rounded ends, which is the real shape of a USB-C or
    // speaker cutout.
    profile = roundedRect(width, height, Math.min(width, height) / 2);
  } else {
    profile = roundedRect(width, height, Math.min(1.2, height / 3));
  }

  const depth = spec.wall * 4;
  const sign = feature.side === "top" ? 1 : -1;

  // extrude runs along +Z; rotating -90 degrees about X points it along +Y.
  const solid = extrude(profile, 0, depth)
    .rotate([-90, 0, 0])
    .translate([
      feature.center.x,
      (sign * dimensions.outerLength) / 2 - depth / 2,
      spec.backThickness + feature.center.z,
    ]);
  profile.delete();
  return solid;
}

function endOpening(
  side: "top" | "bottom",
  dimensions: CaseDimensions,
  spec: CaseSpec,
): Solid {
  const sign = side === "top" ? 1 : -1;
  const lowZ = spec.backThickness + 0.8;
  const height = dimensions.totalHeight - lowZ + 2;
  return box(
    [
      0,
      (sign * dimensions.outerLength) / 2,
      lowZ + height / 2,
    ],
    [Math.max(18, dimensions.innerWidth - 20), spec.wall * 4, height],
  );
}

/**
 * Asanoha (hemp leaf), constructed the way the traditional pattern is drawn.
 *
 * Each hexagonal cell splits into six equilateral triangles by spokes from the
 * centre to the six corners, and each of those triangles then carries three
 * lines from its own centroid to its corners. 2026.8.0 instead drew six radial
 * arms with an arbitrary branch on each, on a grid whose row pitch did not
 * match its column pitch, so the cells did not tessellate and the result was
 * not asanoha.
 */
export function asanohaPolygons(
  width: number,
  length: number,
  radius: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const segment = (from: [number, number], to: [number, number]) => {
    polygons.push(strokeQuad(from, to, stroke));
  };

  // Hexagon centres on a triangular lattice. Horizontal pitch is the hexagon
  // width (sqrt(3) * R), vertical pitch is 1.5 * R, with alternate rows offset
  // by half a pitch. These ratios are what make the cells tile without gaps.
  const pitchX = Math.sqrt(3) * radius;
  const pitchY = 1.5 * radius;
  const columns = Math.ceil(width / pitchX) + 2;
  const rows = Math.ceil(length / pitchY) + 2;

  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      const cx = column * pitchX + (row % 2 === 0 ? 0 : pitchX / 2);
      const cy = row * pitchY;

      // Pointy-top hexagon corners.
      const corners: Array<[number, number]> = [];
      for (let index = 0; index < 6; index += 1) {
        const angle = (Math.PI / 3) * index + Math.PI / 6;
        corners.push([
          cx + Math.cos(angle) * radius,
          cy + Math.sin(angle) * radius,
        ]);
      }

      for (let index = 0; index < 6; index += 1) {
        const current = corners[index];
        const next = corners[(index + 1) % 6];

        // Hexagon edge. Each is drawn twice across neighbouring cells, which is
        // harmless: NonZero merging collapses the duplicates.
        segment(current, next);
        // Spoke from the cell centre, splitting the hexagon into 6 triangles.
        segment([cx, cy], current);

        // The asanoha detail: centroid of each triangle joined to its corners.
        const centroid: [number, number] = [
          (cx + current[0] + next[0]) / 3,
          (cy + current[1] + next[1]) / 3,
        ];
        segment(centroid, [cx, cy]);
        segment(centroid, current);
        segment(centroid, next);
      }
    }
  }
  return polygons;
}

/** Five-petal blossoms on a staggered grid, drawn as notched petal outlines. */
function sakuraPolygons(
  width: number,
  length: number,
  scale: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const pitchX = 19 * scale;
  const pitchY = 18 * scale;
  const columns = Math.ceil(width / pitchX) + 2;
  const rows = Math.ceil(length / pitchY) + 2;

  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      const cx = column * pitchX + (row % 2 === 0 ? 0 : pitchX / 2);
      const cy = row * pitchY;
      for (let petal = 0; petal < 5; petal += 1) {
        const angle = (Math.PI * 2 * petal) / 5 - Math.PI / 2;
        const point = (offset: number, radius: number): [number, number] => [
          cx + Math.cos(angle + offset) * radius * scale,
          cy + Math.sin(angle + offset) * radius * scale,
        ];
        const points = [
          point(-0.63, 1.45),
          point(-0.5, 3.55),
          point(-0.2, 5.35),
          point(0, 4.72),
          point(0.2, 5.35),
          point(0.5, 3.55),
          point(0.63, 1.45),
        ];
        for (let index = 0; index < points.length - 1; index += 1) {
          polygons.push(strokeQuad(points[index], points[index + 1], stroke));
        }
      }
    }
  }
  return polygons;
}

/** Plain hexagonal lattice, the honeycomb look from the proven reference case. */
function hexPolygons(
  width: number,
  length: number,
  radius: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const pitchX = Math.sqrt(3) * radius;
  const pitchY = 1.5 * radius;
  const columns = Math.ceil(width / pitchX) + 2;
  const rows = Math.ceil(length / pitchY) + 2;

  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      const cx = column * pitchX + (row % 2 === 0 ? 0 : pitchX / 2);
      const cy = row * pitchY;
      for (let index = 0; index < 6; index += 1) {
        const a = (Math.PI / 3) * index + Math.PI / 6;
        const b = (Math.PI / 3) * (index + 1) + Math.PI / 6;
        polygons.push(
          strokeQuad(
            [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius],
            [cx + Math.cos(b) * radius, cy + Math.sin(b) * radius],
            stroke,
          ),
        );
      }
    }
  }
  return polygons;
}

/** Shippō, equal circles overlapping into continuous four-petal medallions. */
function shippoPolygons(
  width: number,
  length: number,
  scale: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const radius = 8.5 * scale;
  const pitch = radius * Math.SQRT2;
  const columns = Math.ceil(width / pitch) + 2;
  const rows = Math.ceil(length / pitch) + 2;
  const segments = 24;
  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      const cx = column * pitch;
      const cy = row * pitch;
      for (let index = 0; index < segments; index += 1) {
        const a = (Math.PI * 2 * index) / segments;
        const b = (Math.PI * 2 * (index + 1)) / segments;
        polygons.push(
          strokeQuad(
            [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius],
            [cx + Math.cos(b) * radius, cy + Math.sin(b) * radius],
            stroke,
          ),
        );
      }
    }
  }
  return polygons;
}

/** Seigaiha, three nested wave crests repeated on staggered rows. */
function seigaihaPolygons(
  width: number,
  length: number,
  scale: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const radius = 10 * scale;
  const pitchX = radius * 2;
  const pitchY = radius * 0.86;
  const columns = Math.ceil(width / pitchX) + 2;
  const rows = Math.ceil(length / pitchY) + 2;
  const segments = 16;
  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      const cx = column * pitchX + (row % 2 === 0 ? 0 : radius);
      const cy = row * pitchY;
      for (const arcRadius of [radius, radius * 0.68, radius * 0.36]) {
        for (let index = 0; index < segments; index += 1) {
          const a = Math.PI + (Math.PI * index) / segments;
          const b = Math.PI + (Math.PI * (index + 1)) / segments;
          polygons.push(
            strokeQuad(
              [cx + Math.cos(a) * arcRadius, cy + Math.sin(a) * arcRadius],
              [cx + Math.cos(b) * arcRadius, cy + Math.sin(b) * arcRadius],
              stroke,
            ),
          );
        }
      }
    }
  }
  return polygons;
}

function addPolyline(
  polygons: Array<Array<[number, number]>>,
  points: Array<[number, number]>,
  stroke: number,
): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    polygons.push(strokeQuad(points[index], points[index + 1], stroke));
  }
}

/** Goma, layered sesame-star strokes repeated on a triangular lattice. */
function gomaPolygons(
  width: number,
  length: number,
  scale: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const pitchX = 18 * scale;
  const pitchY = 15.6 * scale;
  const columns = Math.ceil(width / pitchX) + 2;
  const rows = Math.ceil(length / pitchY) + 2;
  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      const cx = column * pitchX + (row % 2 === 0 ? 0 : pitchX / 2);
      const cy = row * pitchY;
      for (const angle of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
        const dx = Math.cos(angle) * 8.8 * scale;
        const dy = Math.sin(angle) * 8.8 * scale;
        const px = -Math.sin(angle) * 1.9 * scale;
        const py = Math.cos(angle) * 1.9 * scale;
        for (const offset of [-1, 0, 1]) {
          polygons.push(
            strokeQuad(
              [cx - dx + px * offset, cy - dy + py * offset],
              [cx + dx + px * offset, cy + dy + py * offset],
              stroke,
            ),
          );
        }
      }
    }
  }
  return polygons;
}

/** Shokko, linked square frames with straight supported connectors. */
function shokkoPolygons(
  width: number,
  length: number,
  scale: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const pitch = 18 * scale;
  const half = 4.8 * scale;
  const columns = Math.ceil(width / pitch) + 2;
  const rows = Math.ceil(length / pitch) + 2;
  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      const cx = column * pitch;
      const cy = row * pitch;
      addPolyline(
        polygons,
        [
          [cx - half, cy - half],
          [cx + half, cy - half],
          [cx + half, cy + half],
          [cx - half, cy + half],
          [cx - half, cy - half],
        ],
        stroke,
      );
      polygons.push(strokeQuad([cx + half, cy], [cx + pitch - half, cy], stroke));
      polygons.push(strokeQuad([cx, cy + half], [cx, cy + pitch - half], stroke));
    }
  }
  return polygons;
}

/** Saya-gata, a continuous angular fret built from interlocking right turns. */
function sayaGataPolygons(
  width: number,
  length: number,
  scale: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const pitch = 16 * scale;
  const half = pitch / 2;
  const quarter = pitch / 4;
  const columns = Math.ceil(width / pitch) + 2;
  const rows = Math.ceil(length / pitch) + 2;
  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      const cx = column * pitch;
      const cy = row * pitch;
      addPolyline(
        polygons,
        [
          [cx - half, cy - quarter],
          [cx, cy - quarter],
          [cx, cy + quarter],
          [cx + half, cy + quarter],
        ],
        stroke,
      );
      addPolyline(
        polygons,
        [
          [cx - quarter, cy - half],
          [cx - quarter, cy],
          [cx + quarter, cy],
          [cx + quarter, cy + half],
        ],
        stroke,
      );
    }
  }
  return polygons;
}

function diamondPolygons(
  width: number,
  length: number,
  scale: number,
  stroke: number,
  rings: number[],
  split: boolean,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const pitchX = 23 * scale;
  const pitchY = 15 * scale;
  const columns = Math.ceil(width / pitchX) + 2;
  const rows = Math.ceil(length / pitchY) + 2;
  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      const cx = column * pitchX + (row % 2 === 0 ? 0 : pitchX / 2);
      const cy = row * pitchY;
      for (const ring of rings) {
        const rx = 11.5 * scale * ring;
        const ry = 7.5 * scale * ring;
        addPolyline(
          polygons,
          [
            [cx, cy - ry],
            [cx + rx, cy],
            [cx, cy + ry],
            [cx - rx, cy],
            [cx, cy - ry],
          ],
          stroke,
        );
      }
      if (split) {
        polygons.push(
          strokeQuad(
            [cx - 11.5 * scale, cy],
            [cx + 11.5 * scale, cy],
            stroke,
          ),
        );
        polygons.push(
          strokeQuad(
            [cx, cy - 7.5 * scale],
            [cx, cy + 7.5 * scale],
            stroke,
          ),
        );
      }
    }
  }
  return polygons;
}

/** Senbon-koushi, fine vertical bars tied together with triple horizontal bands. */
function senbonKoushiPolygons(
  width: number,
  length: number,
  scale: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  const verticalPitch = 4.8 * scale;
  const bandPitch = 22 * scale;
  const columns = Math.ceil(width / verticalPitch) + 2;
  const rows = Math.ceil(length / bandPitch) + 2;
  for (let column = -columns; column <= columns; column += 1) {
    const x = column * verticalPitch;
    polygons.push(strokeQuad([x, -length], [x, length], stroke));
  }
  for (let row = -rows; row <= rows; row += 1) {
    const y = row * bandPitch;
    for (const offset of [-2.6, 0, 2.6]) {
      polygons.push(
        strokeQuad(
          [-width, y + offset * scale],
          [width, y + offset * scale],
          stroke,
        ),
      );
    }
  }
  return polygons;
}

function polygonsForPattern(
  pattern: CaseSpec["pattern"],
  width: number,
  length: number,
  scale: number,
  stroke: number,
): Array<Array<[number, number]>> {
  const radius = 11 * scale;
  if (pattern === "asanoha") return asanohaPolygons(width, length, radius, stroke);
  if (pattern === "sakura") return sakuraPolygons(width, length, scale, stroke);
  if (pattern === "kikko") return hexPolygons(width, length, radius, stroke);
  if (pattern === "shippo") return shippoPolygons(width, length, scale, stroke);
  if (pattern === "seigaiha") return seigaihaPolygons(width, length, scale, stroke);
  if (pattern === "goma") return gomaPolygons(width, length, scale, stroke);
  if (pattern === "shokko") return shokkoPolygons(width, length, scale, stroke);
  if (pattern === "saya-gata") return sayaGataPolygons(width, length, scale, stroke);
  if (pattern === "izutsu-wari-bishi") {
    return diamondPolygons(width, length, scale, stroke, [1, 0.58], true);
  }
  if (pattern === "wari-bishi") {
    return diamondPolygons(width, length, scale, stroke, [1], true);
  }
  if (pattern === "sanjyu-bishi") {
    return diamondPolygons(width, length, scale, stroke, [1, 0.7, 0.4], false);
  }
  if (pattern === "senbon-koushi") {
    return senbonKoushiPolygons(width, length, scale, stroke);
  }
  return [];
}

/**
 * Builds the artwork outline, clipped to the safe area of the back and kept
 * clear of the camera opening.
 */
export function patternShape(
  phone: PhoneRecord,
  dimensions: CaseDimensions,
  spec: CaseSpec,
): Shape | null {
  if (spec.pattern === "none") return null;

  const width = dimensions.outerWidth;
  const length = dimensions.outerLength;
  const polygons = polygonsForPattern(
    spec.pattern,
    width,
    length,
    spec.patternScale,
    spec.patternStroke,
  );
  if (!polygons.length) return null;

  const raw = mergePolygons(polygons);

  // Keep artwork off the corner radius and away from the walls, where it would
  // undercut the shell.
  const safeArea = roundedRect(
    dimensions.outerWidth - spec.wall * 2 - 4,
    dimensions.outerLength - spec.wall * 2 - 4,
    Math.max(2, dimensions.outerRadius - spec.wall - 2),
  );
  let clipped = raw.intersect(safeArea);
  raw.delete();

  // A simple annular subtraction makes MagSafe artwork look accidentally cut
  // away. Compose it deliberately instead: remove the complete ring zone from
  // the repeating field, then place one enlarged matching motif inside it.
  const insert = resolveMagSafeInsert(spec);
  if (insert) {
    const gap = Math.max(1.2, spec.patternStroke * 1.5);
    const outerGapBase = roundedRect(
      insert.outerDiameter + gap * 2,
      insert.outerDiameter + gap * 2,
      insert.outerDiameter / 2 + gap,
    );
    const outerGap = outerGapBase.translate([0, insert.centerY]);
    outerGapBase.delete();
    const background = clipped.subtract(outerGap);
    clipped.delete();
    outerGap.delete();
    clipped = background;

    const centreDiameter = Math.max(2, insert.innerDiameter - gap * 2);
    const emblemPolygons = polygonsForPattern(
      spec.pattern,
      centreDiameter,
      centreDiameter,
      spec.patternScale * 2.15,
      spec.patternStroke,
    );
    if (emblemPolygons.length) {
      const emblemAtOrigin = mergePolygons(emblemPolygons);
      const emblemRaw = emblemAtOrigin.translate([0, insert.centerY]);
      emblemAtOrigin.delete();
      const centreMaskBase = roundedRect(
        centreDiameter,
        centreDiameter,
        centreDiameter / 2,
      );
      const centreMask = centreMaskBase.translate([0, insert.centerY]);
      centreMaskBase.delete();
      const maskedEmblem = emblemRaw.intersect(centreMask);
      const safeEmblem = maskedEmblem.intersect(safeArea);
      const combined = clipped.add(safeEmblem);
      clipped.delete();
      emblemRaw.delete();
      centreMask.delete();
      maskedEmblem.delete();
      safeEmblem.delete();
      clipped = combined;
    }
  }
  safeArea.delete();

  const keepouts = cameraShapes(phone, spec.cameraMargin + 3.4);
  for (const keepout of keepouts) {
    const next = clipped.subtract(keepout);
    clipped.delete();
    keepout.delete();
    clipped = next;
  }
  return clipped;
}

export interface BuiltCase {
  solid: Solid;
  /** Separate opaque artwork volume for a two-filament assembled 3MF. */
  inlay?: Solid;
  dimensions: CaseDimensions;
  cutoutCount: number;
  printPause?: {
    printZ: number;
    message: string;
  };
}

export function buildCase(phone: PhoneRecord, spec: CaseSpec): BuiltCase {
  const { Manifold } = csg();
  const dimensions = caseDimensions(phone, spec);

  const outerShape = roundedRect(
    dimensions.outerWidth,
    dimensions.outerLength,
    dimensions.outerRadius,
  );
  const outer = extrude(outerShape, 0, dimensions.totalHeight);
  outerShape.delete();

  const cavity = cavityWithChamfer(dimensions, spec);
  let shell = outer.subtract(cavity);
  dispose(outer, cavity);

  // Rigid shells keep the lip only at the corners, so the phone can flex in and
  // out. A continuous rigid lip has to be forced over the screen face.
  if (spec.cornerLipOnly) {
    const cornerWidth = 22;
    const cornerLength = 24;
    const keeps: Solid[] = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        keeps.push(
          box(
            [
              sx * (dimensions.outerWidth / 2 - cornerWidth / 2),
              sy * (dimensions.outerLength / 2 - cornerLength / 2),
              dimensions.phoneTop + spec.lipHeight / 2 + 0.5,
            ],
            [cornerWidth, cornerLength, spec.lipHeight + 2],
          ),
        );
      }
    }
    // Everything above the screen face that is not in a corner gets removed.
    const aboveScreen = box(
      [0, 0, dimensions.phoneTop + spec.lipHeight / 2 + 0.5],
      [dimensions.outerWidth + 4, dimensions.outerLength + 4, spec.lipHeight + 2],
    );
    const keptCorners = Manifold.union(keeps);
    const removal = aboveScreen.subtract(keptCorners);
    const trimmed = shell.subtract(removal);
    dispose(shell, aboveScreen, keptCorners, removal, ...keeps);
    shell = trimmed;
  }

  // --- openings ---------------------------------------------------------
  const cutouts: Solid[] = [];

  for (const shape of cameraShapes(phone, spec.cameraMargin)) {
    cutouts.push(extrude(shape, -1, spec.backThickness + 2));
    shape.delete();
  }

  const magsafeInsert = resolveMagSafeInsert(spec);
  const magsafeRing = magSafeRingShape(spec);
  if (magsafeInsert && magsafeRing) {
    cutouts.push(
      extrude(
        magsafeRing,
        magsafeInsert.cavityBottom,
        magsafeInsert.cavityHeight,
      ),
    );
    magsafeRing.delete();
  }

  const padded =
    spec.buttonStyle === "covered"
      ? coveredButtonPads(phone.features, dimensions, spec)
      : null;
  if (padded) {
    // Covered: the wall stays whole, only the relief grooves are removed.
    cutouts.push(...padded.cut);
  } else {
    const right = buttonNotch(phone.features, "screenRight", dimensions, spec);
    if (right) cutouts.push(right);
    const left = buttonNotch(phone.features, "screenLeft", dimensions, spec);
    if (left) cutouts.push(left);
  }

  if (spec.openTop) cutouts.push(endOpening("top", dimensions, spec));
  if (spec.openBottom) cutouts.push(endOpening("bottom", dimensions, spec));

  // Ports and speakers that are not already covered by a full-width opening.
  // USB-C is always cut explicitly, even through an open end. The broad end
  // opening starts above the backplate, while a molded cable housing needs the
  // full 7 mm approach envelope centered on the socket and can otherwise push
  // against the lower edge of the case.
  for (const feature of phone.features) {
    const isEnd = feature.side === "top" || feature.side === "bottom";
    if (!isEnd) continue;
    const endIsOpen =
      (feature.side === "top" && spec.openTop) ||
      (feature.side === "bottom" && spec.openBottom);
    if (endIsOpen && !isUsbCPort(feature)) continue;
    cutouts.push(endFeatureCutout(feature, dimensions, spec));
  }

  if (cutouts.length) {
    const union = Manifold.union(cutouts);
    const next = shell.subtract(union);
    dispose(shell, union, ...cutouts);
    shell = next;
  }

  // Pads are unioned AFTER the cuts so a relief groove cannot eat the pad.
  if (padded && padded.add.length) {
    const pads = Manifold.union(padded.add);
    const withPads = shell.add(pads);
    dispose(shell, pads, ...padded.add);
    shell = withPads;
  }

  // --- artwork ----------------------------------------------------------
  let inlay: Solid | undefined;
  const artwork = patternShape(phone, dimensions, spec);
  if (artwork) {
    if (spec.patternMode === "through") {
      const cut = extrude(artwork, -1, spec.backThickness + 2);
      const next = shell.subtract(cut);
      dispose(shell, cut);
      shell = next;
    } else if (spec.patternMode === "engraved") {
      const cut = extrude(artwork, -0.05, spec.patternDepth + 0.05);
      const next = shell.subtract(cut);
      dispose(shell, cut);
      shell = next;
    } else {
      // Sealed: the lattice becomes a void buried behind a continuous outer
      // skin, so the exterior stays smooth and the pattern reads through
      // translucent filament. Skins are kept above the printable floor at both
      // faces so neither side becomes a single fragile layer.
      const { outerSkin, depth } = sealedPatternLayers(
        spec.backThickness,
        spec.patternDepth,
      );
      const cut = extrude(artwork, outerSkin, depth);
      const next = shell.subtract(cut);
      dispose(shell);
      shell = next;
      if (spec.patternMode === "inlay") inlay = cut;
      else cut.delete();
    }
    artwork.delete();
  }

  return {
    solid: shell,
    inlay,
    dimensions,
    cutoutCount: cutouts.length,
    printPause: magsafeInsert
      ? {
          printZ: magsafeInsert.pausePrintZ,
          message: "Insert MagSafe ring with correct polarity, press it fully flush, then resume.",
        }
      : undefined,
  };
}
