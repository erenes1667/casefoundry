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
  pattern: "none" | "asanoha" | "sakura" | "kumiko-hex";
  patternMode: "engraved" | "through" | "sealed";
  patternDepth: number;
  patternStroke: number;
  patternScale: number;
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

/** Five-petal blossoms on a staggered grid. */
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
        const tip: [number, number] = [
          cx + Math.cos(angle) * 5.2 * scale,
          cy + Math.sin(angle) * 5.2 * scale,
        ];
        const leftAngle = angle - Math.PI / 5;
        const rightAngle = angle + Math.PI / 5;
        const left: [number, number] = [
          cx + Math.cos(leftAngle) * 2.6 * scale,
          cy + Math.sin(leftAngle) * 2.6 * scale,
        ];
        const right: [number, number] = [
          cx + Math.cos(rightAngle) * 2.6 * scale,
          cy + Math.sin(rightAngle) * 2.6 * scale,
        ];
        polygons.push(strokeQuad(left, tip, stroke));
        polygons.push(strokeQuad(tip, right, stroke));
        polygons.push(strokeQuad(right, left, stroke));
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
  const radius = 11 * spec.patternScale;

  let polygons: Array<Array<[number, number]>>;
  if (spec.pattern === "asanoha") {
    polygons = asanohaPolygons(width, length, radius, spec.patternStroke);
  } else if (spec.pattern === "sakura") {
    polygons = sakuraPolygons(width, length, spec.patternScale, spec.patternStroke);
  } else {
    polygons = hexPolygons(width, length, radius, spec.patternStroke);
  }
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
  dimensions: CaseDimensions;
  cutoutCount: number;
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
      const outerSkin = Math.max(0.3, Math.min(0.42, spec.backThickness * 0.24));
      const depth = Math.max(
        0.2,
        Math.min(spec.patternDepth, spec.backThickness - outerSkin - 0.45),
      );
      const cut = extrude(artwork, outerSkin, depth);
      const next = shell.subtract(cut);
      dispose(shell, cut);
      shell = next;
    }
    artwork.delete();
  }

  return { solid: shell, dimensions, cutoutCount: cutouts.length };
}
