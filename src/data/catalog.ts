import type {
  ArchitectureId,
  CaseConfiguration,
  MagSafeInsertConfiguration,
  MaterialId,
  PatternId,
  PrintProfile,
} from "../types";

export const DEFAULT_MAGSAFE_INSERT: MagSafeInsertConfiguration = {
  enabled: false,
  outerDiameter: 56,
  innerDiameter: 46,
  thickness: 1,
  radialClearance: 0.25,
  zClearance: 0.2,
  exteriorCover: 0.6,
  centerY: 0,
};

export const materials: Record<
  MaterialId,
  {
    name: string;
    short: string;
    density: number;
    minimumWall: number;
    minimumBack: number;
    recommendedWall: number;
    recommendedBack: number;
    recommendedPatternDepth: number;
    defaultTolerance: number;
    flexible: boolean;
    translucent: boolean;
    color: string;
  }
> = {
  pla: {
    name: "PLA Solid",
    short: "Rigid, crisp detail",
    density: 1.24,
    minimumWall: 1.6,
    minimumBack: 1.6,
    recommendedWall: 1.8,
    recommendedBack: 1.8,
    recommendedPatternDepth: 0.35,
    defaultTolerance: 0.34,
    flexible: false,
    translucent: false,
    color: "#e6ff8d",
  },
  "pla-silk": {
    name: "PLA Silk",
    short: "Glossy, lower layer bond",
    density: 1.24,
    minimumWall: 1.8,
    minimumBack: 1.8,
    recommendedWall: 2.0,
    recommendedBack: 1.9,
    recommendedPatternDepth: 0.32,
    defaultTolerance: 0.34,
    flexible: false,
    translucent: false,
    color: "#f7b6ff",
  },
  "tpu-95a": {
    name: "TPU 95A",
    short: "Flexible protective shell",
    density: 1.21,
    minimumWall: 1.5,
    minimumBack: 1.4,
    recommendedWall: 1.7,
    recommendedBack: 1.6,
    recommendedPatternDepth: 0.4,
    defaultTolerance: 0.3,
    flexible: true,
    translucent: false,
    color: "#6ce3c4",
  },
  petg: {
    name: "PETG Basic",
    short: "Tough, lightly flexible",
    density: 1.27,
    minimumWall: 1.6,
    minimumBack: 1.5,
    recommendedWall: 1.8,
    recommendedBack: 1.7,
    recommendedPatternDepth: 0.38,
    defaultTolerance: 0.34,
    flexible: false,
    translucent: false,
    color: "#ffb27d",
  },
  "petg-translucent": {
    name: "PETG Translucent",
    short: "Clear-depth artwork",
    density: 1.27,
    minimumWall: 1.6,
    minimumBack: 1.25,
    recommendedWall: 1.7,
    // 0.55 mm exterior skin + 0.40 mm optical channel + 0.60 mm phone-side
    // skin. The old 1.35 mm default contradicted the 0.55 mm skin gate.
    recommendedBack: 1.55,
    recommendedPatternDepth: 0.4,
    defaultTolerance: 0.34,
    flexible: false,
    translucent: true,
    color: "#7dd9ff",
  },
};

export const architectures: Record<
  ArchitectureId,
  { name: string; description: string; recommended: MaterialId[] }
> = {
  "open-lip-rigid": {
    name: "Open-lip rigid",
    description: "Open controls and corner relief for rigid materials.",
    recommended: ["pla", "pla-silk", "petg"],
  },
  "tpu-bumper": {
    name: "Protective TPU bumper",
    description: "Flexible retention lip with optional covered buttons.",
    recommended: ["tpu-95a"],
  },
  "hybrid-backplate": {
    name: "Hybrid backplate",
    description: "A printable rigid shell prepared for a decorative plate.",
    recommended: ["petg", "tpu-95a"],
  },
  "translucent-art": {
    name: "Translucent art shell",
    description: "Thinner optical panel with safely buried pattern channels.",
    recommended: ["petg-translucent"],
  },
};

export const patterns: Record<
  PatternId,
  { name: string; family: string; description: string; risk: string }
> = {
  none: {
    name: "Plain atelier",
    family: "Minimal",
    description: "Clean backplate with no decorative subtraction.",
    risk: "Lowest",
  },
  asanoha: {
    name: "Asanoha Kumiko",
    family: "Japanese geometry",
    description: "Balanced hemp-leaf lattice with a central hexagonal seal.",
    risk: "Managed",
  },
  sakura: {
    name: "Reinforced Sakura",
    family: "Botanical",
    description: "Five-petal blossoms with reinforced centers and safe spacing.",
    risk: "Managed",
  },
  kikko: {
    name: "Kikkō Tortoiseshell",
    family: "Japanese geometry",
    description: "Quiet hexagonal cells with a strong, evenly supported rhythm.",
    risk: "Lowest",
  },
  shippo: {
    name: "Shippō Circles",
    family: "Japanese geometry",
    description: "Overlapping circles form continuous four-petal medallions.",
    risk: "Managed",
  },
  seigaiha: {
    name: "Seigaiha Waves",
    family: "Japanese geometry",
    description: "Layered wave crests stagger cleanly across the backplate.",
    risk: "Managed",
  },
  goma: {
    name: "Goma Sesame",
    family: "Kumiko",
    description: "Layered sesame-star lattice with a strong diagonal rhythm.",
    risk: "Managed",
  },
  shokko: {
    name: "Shokko Linked Squares",
    family: "Kumiko",
    description: "Orthogonal linked frames based on the classic Shokko grid.",
    risk: "Lowest",
  },
  "saya-gata": {
    name: "Saya-gata Fretwork",
    family: "Kumiko",
    description: "Continuous interlocking angular meanders with reinforced turns.",
    risk: "Managed",
  },
  "izutsu-wari-bishi": {
    name: "Izutsu-wari-bishi",
    family: "Kumiko",
    description: "Well-frame diamonds with a smaller split diamond inside.",
    risk: "Managed",
  },
  "wari-bishi": {
    name: "Wari-bishi",
    family: "Kumiko",
    description: "Split diamonds repeated as a clean diagonal lattice.",
    risk: "Managed",
  },
  "sanjyu-bishi": {
    name: "Sanjyu-bishi",
    family: "Kumiko",
    description: "Three nested diamonds create a richer woven field.",
    risk: "Managed",
  },
  "senbon-koushi": {
    name: "Senbon-koushi",
    family: "Kumiko",
    description: "Fine vertical lattice reinforced by repeating horizontal bands.",
    risk: "Managed",
  },
};

export const printProfiles: PrintProfile[] = [
  {
    id: "p2s-pla-016",
    name: "P2S • PLA dependable",
    printer: "Bambu Lab P2S",
    nozzle: 0.4,
    material: "pla",
    layerHeight: 0.16,
    firstLayer: 0.2,
    nozzleTemperature: 220,
    bedTemperature: 55,
    walls: 3,
    topBottom: 4,
    infill: 20,
    firstLayerSpeed: 20,
    outerWallSpeed: 60,
    fan: "0% for 2 layers, then 80–100%",
    notes: "Smooth PEI with a thin release layer. Open chamber for PLA.",
  },
  {
    id: "p2s-pla-silk-016",
    name: "P2S • PLA Silk detail",
    printer: "Bambu Lab P2S",
    nozzle: 0.4,
    material: "pla-silk",
    layerHeight: 0.16,
    firstLayer: 0.2,
    nozzleTemperature: 225,
    bedTemperature: 55,
    walls: 4,
    topBottom: 5,
    infill: 20,
    firstLayerSpeed: 18,
    outerWallSpeed: 45,
    fan: "0% for 2 layers, then 70–90%",
    notes: "Slower walls and thicker structural sections compensate for silk additives.",
  },
  {
    id: "p2s-petg-016",
    name: "P2S • PETG Basic case",
    printer: "Bambu Lab P2S",
    nozzle: 0.4,
    material: "petg",
    layerHeight: 0.16,
    firstLayer: 0.2,
    nozzleTemperature: 255,
    bedTemperature: 70,
    walls: 4,
    topBottom: 5,
    infill: 25,
    firstLayerSpeed: 18,
    outerWallSpeed: 45,
    fan: "20–50%, bridges 80%",
    notes: "Dry filament and use a release layer on Smooth PEI.",
  },
  {
    id: "p2s-petg-clear-012",
    name: "P2S • PETG translucent optical",
    printer: "Bambu Lab P2S",
    nozzle: 0.4,
    material: "petg-translucent",
    layerHeight: 0.12,
    firstLayer: 0.2,
    nozzleTemperature: 260,
    bedTemperature: 70,
    walls: 1,
    topBottom: 0,
    infill: 100,
    firstLayerSpeed: 15,
    outerWallSpeed: 18,
    fan: "0–20%, bridges 50%",
    notes: "Aligned solid infill and slow, hot extrusion improve optical continuity.",
  },
  {
    id: "p2s-tpu-020",
    name: "P2S • TPU 95A shell",
    printer: "Bambu Lab P2S",
    nozzle: 0.4,
    material: "tpu-95a",
    layerHeight: 0.2,
    firstLayer: 0.2,
    nozzleTemperature: 230,
    bedTemperature: 40,
    walls: 4,
    topBottom: 5,
    infill: 18,
    firstLayerSpeed: 15,
    outerWallSpeed: 30,
    fan: "40–70%",
    notes: "External spool recommended. Keep volumetric speed conservative.",
  },
];

export function defaultConfiguration(phoneId: string): CaseConfiguration {
  return {
    phoneId,
    architecture: "open-lip-rigid",
    material: "pla",
    pattern: "asanoha",
    patternMode: "engraved",
    tolerance: 0.34,
    wall: 1.8,
    backThickness: 1.8,
    lipHeight: 1.2,
    cameraMargin: 1.8,
    patternDepth: 0.35,
    patternScale: 1,
    magsafe: { ...DEFAULT_MAGSAFE_INSERT },
    buttonStyle: "open",
    topOpening: true,
    bottomOpening: true,
    printerProfile: "p2s-pla-016",
    printerId: "p2s-0.4",
    nozzle: 0.4,
    color: "#d9ff72",
  };
}
