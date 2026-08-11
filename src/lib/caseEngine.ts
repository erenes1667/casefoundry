import { architectures, materials, printProfiles } from "../data/catalog";
import type {
  CaseConfiguration,
  GeneratedCase,
  PhoneRecord,
  ValidationIssue,
  ValidationReport,
} from "../types";
import { clamp, round, slugify } from "./format";
import {
  USB_C_CABLE_CLEARANCE_MM,
  buildCase,
  caseDimensions,
  isUsbCPort,
  type CaseSpec,
} from "./caseGeometry";
import { box, csg, dispose, initCsg, solidToIndexedMesh, type Solid } from "./csg";
import { diagnoseMesh, type IndexedMesh } from "./mesh";
import {
  DEFAULT_PRINTER,
  PRINTERS,
  RECIPES,
  buildBambuProject,
  type FilamentChoice,
  type PrinterId,
  type PrintRecipe,
} from "./bambuProject";

/** Resolves a stored printer id, falling back to the default if unknown. */
export function printerFor(configuration: CaseConfiguration): PrinterId {
  const id = configuration.printerId as PrinterId;
  return id && id in PRINTERS ? id : DEFAULT_PRINTER;
}

type CasePart = GeneratedCase["parts"][number];

/**
 * Must be awaited once before any geometry call. Loads the Manifold WASM
 * module. Kept separate so the rest of the engine stays synchronous and the
 * UI does not have to thread promises through every render path.
 */
export async function ensureEngineReady(): Promise<void> {
  await initCsg();
}

/** Maps the UI configuration onto the geometry spec. */
export function specFromConfiguration(
  configuration: CaseConfiguration,
): CaseSpec {
  const material = materials[configuration.material];
  const recipe = recipeForConfiguration(configuration);
  return {
    cavityClearance: configuration.tolerance,
    wall: configuration.wall,
    backThickness: configuration.backThickness,
    lipHeight: configuration.lipHeight,
    // The lip protrudes inward by roughly its own height, which keeps the
    // chamfer under it at 45 degrees and therefore support-free.
    lipOverhang: Math.min(1.2, configuration.lipHeight),
    cameraMargin: configuration.cameraMargin,
    layerHeight: recipe.layerHeight,
    openTop: configuration.topOpening,
    openBottom: configuration.bottomOpening,
    // Only a flexible material can carry a pressable pad. tuneConfiguration
    // already forces "open" for rigid materials; this is the second guard so a
    // hand-built configuration cannot produce an unpressable rigid bump.
    buttonStyle:
      configuration.buttonStyle === "covered" && material.flexible
        ? "covered"
        : "open",
    // Rigid materials cannot flex over a continuous lip, so they keep it only
    // at the corners. TPU stretches and can take a full lip.
    cornerLipOnly: !material.flexible,
    pattern:
      configuration.pattern === "none"
        ? "none"
        : configuration.pattern === "sakura"
          ? "sakura"
          : configuration.pattern === "asanoha"
            ? "asanoha"
            : "kumiko-hex",
    patternMode:
      configuration.patternMode === "vented"
        ? "through"
        : configuration.patternMode === "sealed"
          ? "sealed"
          : "engraved",
    patternDepth: configuration.patternDepth,
    // Strokes below roughly two extrusion widths print as broken hairlines.
    patternStroke: Math.max(configuration.nozzle * 2, 0.8),
    patternScale: configuration.patternScale,
  };
}

export function recipeForConfiguration(
  configuration: CaseConfiguration,
): PrintRecipe {
  if (
    configuration.material === "petg-translucent" &&
    configuration.patternMode === "sealed"
  ) {
    return RECIPES["translucent-glass"];
  }
  return RECIPES["solid-engraved"];
}

function makeReport(
  phone: PhoneRecord,
  config: CaseConfiguration,
  mesh?: IndexedMesh,
  featureCutouts = 0,
): ValidationReport {
  const material = materials[config.material];
  const architecture = architectures[config.architecture];
  const issues: ValidationIssue[] = [];
  const add = (issue: ValidationIssue) => issues.push(issue);
  // Must mirror the clamping in caseGeometry.buildCase exactly. Reporting a
  // skin the geometry does not actually leave is worse than reporting nothing:
  // it passes the 0.55 mm floor while the real part is thinner than that.
  let minimumSkin: number;
  if (config.pattern === "none") {
    minimumSkin = config.backThickness;
  } else if (config.patternMode === "vented") {
    minimumSkin = 0;
  } else if (config.patternMode === "sealed") {
    const outerSkin = Math.max(
      0.3,
      Math.min(0.42, config.backThickness * 0.24),
    );
    const depth = Math.max(
      0.2,
      Math.min(config.patternDepth, config.backThickness - outerSkin - 0.45),
    );
    // Both faces matter: the thinner of the two is what fails first.
    minimumSkin = Math.min(outerSkin, config.backThickness - outerSkin - depth);
  } else {
    minimumSkin = config.backThickness - config.patternDepth;
  }

  if (config.wall < material.minimumWall) {
    add({
      id: "wall-thin",
      severity: "error",
      title: "Wall is below the material floor",
      detail: `${config.wall.toFixed(2)} mm is below ${material.minimumWall.toFixed(2)} mm for ${material.name}.`,
      field: "wall",
    });
  } else {
    add({
      id: "wall-safe",
      severity: "pass",
      title: "Wall thickness is printable",
      detail: `${config.wall.toFixed(2)} mm clears the ${material.name} floor.`,
      field: "wall",
    });
  }

  if (config.backThickness < material.minimumBack) {
    add({
      id: "back-thin",
      severity: "error",
      title: "Backplate is too thin",
      detail: `${config.backThickness.toFixed(2)} mm is below the ${material.minimumBack.toFixed(2)} mm safe floor.`,
      field: "backThickness",
    });
  } else {
    add({
      id: "back-safe",
      severity: "pass",
      title: "Backplate meets the material floor",
      detail: `${config.backThickness.toFixed(2)} mm nominal back thickness.`,
      field: "backThickness",
    });
  }

  if (config.pattern !== "none" && config.patternMode !== "vented" && minimumSkin < 0.55) {
    add({
      id: "skin-thin",
      severity: "error",
      title: "Pattern leaves a fragile skin",
      detail: `${Math.max(0, minimumSkin).toFixed(2)} mm remains. Keep at least 0.55 mm after artwork.`,
      field: "patternDepth",
    });
  } else if (config.pattern !== "none") {
    add({
      id: "pattern-safe",
      severity: config.patternMode === "vented" ? "warning" : "pass",
      title:
        config.patternMode === "sealed"
          ? "Artwork is sealed inside"
          : "Artwork spacing checked",
      detail:
        config.patternMode === "sealed"
          ? "The decorative inlay is buried between continuous exterior and phone-facing skins."
          : config.patternMode === "vented"
            ? "Through-vents reduce dust protection and need a clean first layer."
            : "Motifs use filled, reinforced geometry instead of loose hairline islands.",
      field: "patternMode",
    });
  }

  if (!architecture.recommended.includes(config.material)) {
    add({
      id: "architecture-material",
      severity: "error",
      title: "Architecture and material conflict",
      detail: `${architecture.name} is not intended for ${material.name}.`,
      field: "architecture",
    });
  }

  if (!material.flexible && config.buttonStyle === "covered") {
    add({
      id: "rigid-buttons",
      severity: "error",
      title: "Rigid button bridges are disabled",
      detail:
        "Use the open control-side notch. A rigid enclosure bridge can trap the phone or miss the buttons.",
      field: "buttonStyle",
    });
  } else {
    add({
      id: "button-orientation",
      severity: "pass",
      title: "Button side follows screen coordinates",
      detail:
        "screenRight stays the handset's physical right side; rear preview mirroring does not swap the cutout.",
      field: "features",
    });
  }

  if (
    !phone.features.some(
      (feature) => feature.kind === "camera" || feature.kind === "cameraIsland",
    )
  ) {
    add({
      id: "missing-camera",
      severity: "error",
      title: "Camera geometry is missing",
      detail: "Add a camera island or individual lens measurements before export.",
      field: "features",
    });
  }

  const usbCPort = phone.features.find(isUsbCPort);
  if (!usbCPort) {
    add({
      id: "missing-usb-c",
      severity: "error",
      title: "USB-C port geometry is missing",
      detail:
        "Add a measured USB-C feature before export so the cable housing cannot collide with the case.",
      field: "features",
    });
  } else {
    add({
      id: "usb-c-clearance",
      severity: "pass",
      title: "USB-C cable clearance reserved",
      detail: `${USB_C_CABLE_CLEARANCE_MM.toFixed(1)} mm minimum vertical clearance is centered on the measured port.`,
      field: "features",
    });
  }

  if (phone.validation.physicalFit !== "passed") {
    add({
      id: "fit-unverified",
      severity: "warning",
      title: "Physical fit is not yet proven",
      detail: mesh
        ? "Geometry is watertight, but nothing here proves the phone fits. " +
          "Print a corner-and-controls fit coupon before a full run."
        : "This record has no recorded physical fit test. Print a fit coupon " +
          "before a full run.",
      field: "phone",
    });
  } else {
    add({
      id: "fit-verified",
      severity: "pass",
      title: "Physical fit has been recorded",
      detail: "This phone revision includes a passed physical-fit result.",
      field: "phone",
    });
  }

  if (phone.confidence < 75) {
    add({
      id: "confidence-low",
      severity: "warning",
      title: "Phone record needs stronger evidence",
      detail: `Catalog confidence is ${phone.confidence}%. Verify feature placement before relying on a full print.`,
      field: "phone",
    });
  }

  const profile = printProfiles.find((entry) => entry.id === config.printerProfile);
  if (profile && profile.material !== config.material) {
    add({
      id: "profile-material",
      severity: "warning",
      title: "Print profile does not match material",
      detail: `${profile.name} is tuned for ${materials[profile.material].name}.`,
      field: "printerProfile",
    });
  }

  // --- geometry-derived checks -----------------------------------------
  if (mesh) {
    const diagnostics = diagnoseMesh(mesh);
    if (!diagnostics.isEdgeManifold) {
      add({
        id: "mesh-not-watertight",
        severity: "error",
        title: "Geometry is not watertight",
        detail:
          `${diagnostics.boundaryEdges} boundary and ${diagnostics.nonManifoldEdges} ` +
          `non-manifold edges. This cannot be sliced reliably and will not be exported.`,
        field: "phone",
      });
    } else {
      add({
        id: "mesh-watertight",
        severity: "pass",
        title: "Geometry is watertight",
        detail: `Closed surface, ${mesh.triangleCount.toLocaleString()} triangles.`,
        field: "phone",
      });
    }
  }

  const dimensions = caseDimensions(phone, specFromConfiguration(config));
  const volumeMm3 = mesh
    ? Math.abs(diagnoseMesh(mesh).signedVolumeMm3)
    : dimensions.outerWidth * dimensions.outerLength * config.backThickness;
  const volumeCm3 = volumeMm3 / 1000;
  const weight = volumeCm3 * material.density;
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const score = clamp(100 - errors * 24 - warnings * 7, 0, 100);

  return {
    score,
    printable: errors === 0,
    issues,
    metrics: {
      outerWidth: round(dimensions.outerWidth, 2),
      outerLength: round(dimensions.outerLength, 2),
      outerHeight: round(dimensions.totalHeight, 2),
      minimumSkin: round(Math.max(0, minimumSkin), 2),
      estimatedVolumeCm3: round(volumeCm3, 2),
      estimatedWeightG: round(weight, 1),
      estimatedMinutes: Math.max(
        28,
        Math.round(volumeCm3 * (config.material === "tpu-95a" ? 6.8 : 4.6)),
      ),
      featureCutouts,
      polygonCount: mesh?.triangleCount,
    },
  };
}

export function validateCase(
  phone: PhoneRecord,
  configuration: CaseConfiguration,
): ValidationReport {
  return makeReport(phone, configuration);
}

export function tuneConfiguration(
  phone: PhoneRecord,
  configuration: CaseConfiguration,
): CaseConfiguration {
  const material = materials[configuration.material];
  const flexible = material.flexible;
  const preferredArchitecture = flexible
    ? "tpu-bumper"
    : configuration.material === "petg-translucent"
      ? "translucent-art"
      : configuration.architecture === "tpu-bumper"
        ? "open-lip-rigid"
        : configuration.architecture;
  const architecture = architectures[preferredArchitecture].recommended.includes(
    configuration.material,
  )
    ? preferredArchitecture
    : "open-lip-rigid";
  const matchingProfile = printProfiles.find(
    (profile) =>
      profile.material === configuration.material &&
      profile.nozzle === configuration.nozzle,
  );
  return {
    ...configuration,
    phoneId: phone.id,
    architecture,
    tolerance: material.defaultTolerance,
    wall: material.recommendedWall,
    backThickness: material.recommendedBack,
    lipHeight: flexible
      ? Math.max(configuration.lipHeight, 1.1)
      : Math.min(configuration.lipHeight, 1.4),
    buttonStyle: flexible ? configuration.buttonStyle : "open",
    patternMode:
      configuration.material === "petg-translucent" && configuration.pattern !== "none"
        ? "sealed"
        : configuration.patternMode,
    patternDepth: Math.min(
      material.recommendedPatternDepth,
      Math.max(0.2, material.recommendedBack - 0.7),
    ),
    printerProfile: matchingProfile?.id ?? configuration.printerProfile,
  };
}

export function generateCase(
  phone: PhoneRecord,
  configuration: CaseConfiguration,
): GeneratedCase {
  const spec = specFromConfiguration(configuration);
  const built = buildCase(phone, spec);
  const mesh = solidToIndexedMesh(built.solid);
  built.solid.delete();

  const report = makeReport(phone, configuration, mesh, built.cutoutCount);
  const parts: CasePart[] = [
    {
      id: "shell",
      name: "Case shell",
      role: "shell",
      geometry: mesh,
      color: configuration.color,
    },
  ];

  return {
    geometry: mesh,
    parts,
    report,
    name: `${phone.brand} ${phone.model} ${configuration.pattern === "none" ? "Plain" : configuration.pattern}`,
  };
}

/**
 * A small test print carrying only the parts of the case where fit is decided:
 * the two corners, the control-side notch and the bottom port opening.
 *
 * Printing this first costs minutes instead of hours and is the only honest way
 * to confirm a phone record before committing to a full case.
 */
export function generateFitCoupon(
  phone: PhoneRecord,
  configuration: CaseConfiguration,
): GeneratedCase {
  const { Manifold } = csg();
  const config = tuneConfiguration(phone, { ...configuration, pattern: "none" });
  const spec = specFromConfiguration(config);
  const built = buildCase(phone, spec);
  const dimensions = built.dimensions;

  const masks: Solid[] = [];
  const height = dimensions.totalHeight + 2;

  const buttons = phone.features.filter((feature) => feature.kind === "button");
  for (const side of ["screenRight", "screenLeft"] as const) {
    const sideButtons = buttons.filter((button) => button.side === side);
    if (!sideButtons.length) continue;
    const lowY = Math.min(...sideButtons.map((b) => b.center.y - b.size.y / 2)) - 7;
    const highY = Math.max(...sideButtons.map((b) => b.center.y + b.size.y / 2)) + 7;
    const sign = side === "screenRight" ? 1 : -1;
    masks.push(
      box(
        [sign * (dimensions.outerWidth / 2 - 7), (lowY + highY) / 2, height / 2 - 1],
        [16, highY - lowY, height],
      ),
    );
  }

  const rear = phone.features.filter(
    (feature) =>
      feature.side === "back" &&
      (feature.kind === "camera" ||
        feature.kind === "cameraIsland" ||
        feature.kind === "flash"),
  );
  if (rear.length) {
    const lowX = Math.min(...rear.map((f) => f.center.x - f.size.x / 2)) - 7;
    const highX = Math.max(...rear.map((f) => f.center.x + f.size.x / 2)) + 7;
    const lowY = Math.min(...rear.map((f) => f.center.y - f.size.y / 2)) - 7;
    const highY = Math.max(...rear.map((f) => f.center.y + f.size.y / 2)) + 7;
    masks.push(
      box(
        [(lowX + highX) / 2, (lowY + highY) / 2, height / 2 - 1],
        [highX - lowX, highY - lowY, height],
      ),
    );
  }

  masks.push(
    box(
      [0, -dimensions.outerLength / 2 + 9, height / 2 - 1],
      [dimensions.outerWidth - 14, 18, height],
    ),
  );

  const keep = Manifold.union(masks);
  const coupon = built.solid.intersect(keep);
  const mesh = solidToIndexedMesh(coupon);
  dispose(built.solid, keep, coupon, ...masks);

  const report = makeReport(phone, config, mesh, masks.length);
  return {
    geometry: mesh,
    parts: [
      {
        id: "fit-coupon",
        name: "Fit coupon set",
        role: "shell",
        geometry: mesh,
        color: config.color,
      },
    ],
    report,
    name: `${phone.brand} ${phone.model} fit coupon set`,
  };
}

/** Binary STL. Kept for tools that cannot read a Bambu project. */
export function serializeCaseStl(generated: GeneratedCase): Uint8Array {
  const mesh = generated.geometry as IndexedMesh;
  const triangleCount = mesh.triangleCount;
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);

  const header = `CaseFoundry ${generated.name}`.slice(0, 79);
  for (let index = 0; index < header.length; index += 1) {
    view.setUint8(index, header.charCodeAt(index));
  }
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  const { positions, indices } = mesh;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = indices[triangle * 3] * 3;
    const b = indices[triangle * 3 + 1] * 3;
    const c = indices[triangle * 3 + 2] * 3;

    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    offset += 12;
    for (const corner of [a, b, c]) {
      view.setFloat32(offset, positions[corner], true);
      view.setFloat32(offset + 4, positions[corner + 1], true);
      view.setFloat32(offset + 8, positions[corner + 2], true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

/**
 * Serialises to a real Bambu Studio project.
 *
 * Requires a filament choice so the project carries genuine vendor settings.
 * Callers that have not picked one yet should use the app's default for the
 * configured material rather than letting this invent numbers.
 */
export function serializeCase3mf(
  generated: GeneratedCase,
  options: {
    filament: FilamentChoice;
    recipe: PrintRecipe;
    phone: PhoneRecord;
    date: string;
    printer?: PrinterId;
  },
): Uint8Array {
  const mesh = generated.geometry as IndexedMesh;
  const { phone } = options;
  return buildBambuProject({
    mesh,
    filament: options.filament,
    recipe: options.recipe,
    printer: options.printer,
    metadata: {
      title: generated.name,
      plateName: generated.name,
      description:
        `${phone.brand} ${phone.model}. Measurement status: ${phone.status}, ` +
        `physical fit ${phone.validation.physicalFit}, catalog confidence ${phone.confidence}%.`,
      profileDescription: `${options.recipe.name} on ${options.filament.name}`,
      date: options.date,
    },
  }).bytes;
}

export function printableFileStem(
  phone: PhoneRecord,
  config: CaseConfiguration,
): string {
  return slugify(
    `CaseFoundry-${phone.brand}-${phone.model}-${config.architecture}-${config.pattern}-${config.material}`,
  );
}

export function geometryBounds(
  geometry: unknown,
): [[number, number, number], [number, number, number]] {
  const mesh = geometry as IndexedMesh;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[index + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return [min, max];
}
