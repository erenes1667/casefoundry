export type VerificationStatus =
  | "production-ready"
  | "fit-validated"
  | "reference-derived"
  | "measured"
  | "sourced"
  | "compatibility-candidate"
  | "provisional";

export type FeatureKind =
  | "camera"
  | "cameraIsland"
  | "flash"
  | "button"
  | "port"
  | "speaker"
  | "microphone"
  | "simTray"
  | "sPen"
  | "coil"
  | "antenna"
  | "other";

export type FeatureSide =
  | "back"
  | "screen"
  | "screenLeft"
  | "screenRight"
  | "top"
  | "bottom";

export type FeatureShape = "circle" | "slot" | "rect" | "roundedRect";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PhoneFeature {
  id: string;
  name: string;
  kind: FeatureKind;
  side: FeatureSide;
  shape: FeatureShape;
  center: Vec3;
  size: Vec3;
  confidence: number;
  notes?: string;
}

export interface MeasurementSource {
  id: string;
  title: string;
  kind:
    | "manufacturer"
    | "licensed-cad"
    | "physical-measurement"
    | "calibrated-scan"
    | "reference-mesh"
    | "community"
    | "inference";
  url?: string;
  grade: "A" | "B" | "C" | "D";
}

export interface PhoneRecord {
  id: string;
  brand: string;
  model: string;
  variant: string;
  modelNumbers: string[];
  chassisFamily: string;
  releaseYear: number;
  revision: number;
  status: VerificationStatus;
  confidence: number;
  dimensions: {
    width: number;
    length: number;
    depth: number;
    cornerRadius: number;
  };
  features: PhoneFeature[];
  sources: MeasurementSource[];
  validation: {
    geometry: "passed" | "failed" | "not-run";
    slice: "passed" | "failed" | "not-run";
    physicalFit: "passed" | "failed" | "not-tested";
    lastChecked?: string;
  };
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type MaterialId =
  | "pla"
  | "pla-silk"
  | "tpu-95a"
  | "petg"
  | "petg-translucent";

export type ArchitectureId =
  | "open-lip-rigid"
  | "tpu-bumper"
  | "hybrid-backplate"
  | "translucent-art";

/**
 * Only patterns the geometry engine can actually build.
 *
 * "circuit" and "topography" were offered in the UI but silently fell through
 * to a plain hexagonal lattice, so the exported file did not match the artwork
 * the user picked or the name in its own filename. Removed rather than left
 * as a lie; re-add each one WITH its generator.
 */
export type PatternId = "none" | "asanoha" | "sakura";

export type PatternMode = "engraved" | "sealed" | "vented";

export interface CaseConfiguration {
  phoneId: string;
  architecture: ArchitectureId;
  material: MaterialId;
  pattern: PatternId;
  patternMode: PatternMode;
  tolerance: number;
  wall: number;
  backThickness: number;
  lipHeight: number;
  cameraMargin: number;
  patternDepth: number;
  patternScale: number;
  buttonStyle: "open" | "covered";
  topOpening: boolean;
  bottomOpening: boolean;
  printerProfile: string;
  /** Which Bambu printer the exported project targets. */
  printerId: string;
  nozzle: number;
  color: string;
}

export interface CaseProject {
  id: string;
  name: string;
  phoneId: string;
  configuration: CaseConfiguration;
  validation: ValidationReport;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationIssue {
  id: string;
  severity: "pass" | "warning" | "error";
  title: string;
  detail: string;
  field?: keyof CaseConfiguration | "phone" | "features";
}

export interface ValidationReport {
  score: number;
  printable: boolean;
  issues: ValidationIssue[];
  metrics: {
    outerWidth: number;
    outerLength: number;
    outerHeight: number;
    minimumSkin: number;
    estimatedVolumeCm3: number;
    estimatedWeightG: number;
    estimatedMinutes: number;
    featureCutouts: number;
    polygonCount?: number;
  };
}

export interface GeneratedCase {
  geometry: unknown;
  parts: Array<{
    id: string;
    name: string;
    role: "shell" | "inlay" | "button";
    geometry: unknown;
    color: string;
  }>;
  report: ValidationReport;
  name: string;
}

export interface PrintProfile {
  id: string;
  name: string;
  printer: string;
  nozzle: number;
  material: MaterialId;
  layerHeight: number;
  firstLayer: number;
  nozzleTemperature: number;
  bedTemperature: number;
  walls: number;
  topBottom: number;
  infill: number;
  firstLayerSpeed: number;
  outerWallSpeed: number;
  fan: string;
  notes: string;
}

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  dataDirectory: string;
  databaseFile: string;
}

export interface SaveResult {
  canceled: boolean;
  path?: string;
  bytes?: number;
}
