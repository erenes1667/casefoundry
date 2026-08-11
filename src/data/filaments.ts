import catalog from "./filaments.json";
import type { FilamentChoice } from "../lib/bambuProject";
import type { MaterialId } from "../types";

/**
 * Filament data generated from Bambu Studio's own shipped profile library by
 * scripts/build-filament-catalog.mjs. Temperatures, flow ratios and volumetric
 * limits are vendor values read verbatim; nothing here is estimated.
 */

export interface CatalogFilament extends FilamentChoice {
  vendor: string;
  flexible: boolean;
  compatiblePrinters: string[];
  design: {
    cavityClearance: number;
    wallFloor: number;
    lipHeight: number;
    provenance: string;
  };
}

interface CatalogFile {
  count: number;
  byType: Record<string, number>;
  filaments: CatalogFilament[];
}

const data = catalog as unknown as CatalogFile;

export const allFilaments: CatalogFilament[] = data.filaments;

/** Filaments the given printer and nozzle can actually run. */
export function filamentsForPrinter(printer: string): CatalogFilament[] {
  return allFilaments.filter((filament) =>
    filament.compatiblePrinters.some((entry) => entry === printer),
  );
}

export function filamentByName(name: string): CatalogFilament | undefined {
  return allFilaments.find((filament) => filament.name === name);
}

/**
 * The stock Bambu preset that best matches each of the app's material classes.
 *
 * These are exact preset names from the shipped library, so every one resolves
 * to real vendor settings. If a name ever stops resolving, defaultFilamentFor
 * returns undefined rather than substituting a similar-looking filament, since
 * a wrong temperature is worse than a missing one.
 */
const DEFAULT_PRESETS: Record<MaterialId, string> = {
  pla: "Bambu PLA Basic @BBL P2S",
  "pla-silk": "Bambu PLA Silk @BBL P2S",
  "tpu-95a": "Bambu TPU 95A @BBL P2S",
  petg: "Bambu PETG Basic @BBL P2S",
  "petg-translucent": "Bambu PETG Translucent @BBL P2S",
};

/**
 * Bambu names these inconsistently: PLA ships both a bare "@BBL P2S" preset and
 * nozzle-suffixed variants, while PETG ships only "@BBL P2S 0.4 nozzle". Trying
 * the nozzle suffix is a lookup for the SAME filament under its other name, not
 * a substitution of a different one, so it cannot produce wrong temperatures.
 */
export function defaultFilamentFor(material: MaterialId): CatalogFilament | undefined {
  const base = DEFAULT_PRESETS[material];
  return filamentByName(base) ?? filamentByName(`${base} 0.4 nozzle`);
}

/** Material families offered in the UI, each with how many presets back it. */
export function filamentFamilies(printer: string): Array<{
  type: string;
  count: number;
}> {
  const counts = new Map<string, number>();
  for (const filament of filamentsForPrinter(printer)) {
    counts.set(filament.type, (counts.get(filament.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}
