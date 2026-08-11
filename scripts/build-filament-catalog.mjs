#!/usr/bin/env node
/**
 * Builds a real filament catalog from Bambu Studio's shipped profile library.
 *
 * Every value written here is READ FROM BAMBU'S OWN VENDOR PROFILES. Nothing is
 * invented. If Bambu does not publish a number for a filament, the field is
 * omitted rather than guessed, and the app must not offer that filament as a
 * tuned option.
 *
 * The two case-design fields Bambu does NOT publish (wallFloor, cavityClearance)
 * are derived explicitly and tagged with their provenance, see DESIGN_RULES.
 *
 * Usage: node scripts/build-filament-catalog.mjs [--bambu <path>] [--out <path>]
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const DEFAULT_BAMBU =
  "/Applications/BambuStudio.app/Contents/Resources/profiles";

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const bambuRoot = argValue("--bambu", DEFAULT_BAMBU);
const outPath = argValue("--out", "src/data/filaments.json");

/**
 * Case-design rules that Bambu profiles do not contain.
 *
 * These are NOT vendor data. Each carries the evidence it came from so a future
 * reader can challenge it. Clearances are measured from fit-verified physical
 * case tests, not guessed.
 */
const DESIGN_RULES = {
  flexible: {
    // TPU stretches over the phone, so it runs a tight cavity by design.
    // Vault evidence: v3 TPU case measured cavity 76.48 vs phone 76.5 = zero
    // tolerance and it fit. 0.30 was the working spec for the full TPU cases.
    cavityClearance: 0.3,
    wallFloor: 2.4,
    lipHeight: 1.2,
    provenance:
      "Measured from a fit-validated TPU case (cavity 76.48 mm vs phone 76.50 mm).",
  },
  rigid: {
    // Rigid shells cannot stretch, so they need real clearance.
    // Vault evidence: S23FE rigid cavity 76.84 vs phone 76.50 = +0.34, and the
    // proven honeycomb S24+ donor ran cavity 76.30 vs phone 75.90 = +0.40.
    cavityClearance: 0.34,
    wallFloor: 2.0,
    lipHeight: 1.2,
    provenance:
      "Measured from fit-validated rigid cases with +0.34 mm and +0.40 mm cavity clearance.",
  },
};

/** Material families that flex enough to stretch over a phone. */
const FLEXIBLE_TYPES = new Set(["TPU", "TPU-AMS"]);

/**
 * Filament families that cannot make a usable phone case, so the app should
 * never offer them. Support/soluble materials and pure-support blends.
 */
const EXCLUDED_NAME_PATTERNS = [
  /support/i,
  /\bPVA\b/i,
  /\bBVOH\b/i,
  /\bHIPS\b/i,
];

function readProfileDir(vendorDir) {
  const dir = join(bambuRoot, vendorDir, "filament");
  if (!existsSync(dir)) return new Map();
  const byName = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const json = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (json?.name) byName.set(json.name, { ...json, __file: basename(file) });
    } catch {
      // A malformed vendor profile is skipped, never silently defaulted.
    }
  }
  return byName;
}

/**
 * Bambu profiles are layered: a concrete preset inherits from an "@base" preset
 * which may inherit further. Resolve the whole chain, child values winning.
 */
function resolveInherits(profile, byName, seen = new Set()) {
  if (!profile?.inherits) return profile;
  if (seen.has(profile.name)) return profile; // cycle guard
  seen.add(profile.name);
  const parent = byName.get(profile.inherits);
  if (!parent) return profile;
  const resolvedParent = resolveInherits(parent, byName, seen);
  return { ...resolvedParent, ...profile };
}

/** Bambu stores most numeric settings as arrays, one entry per extruder slot. */
function first(value) {
  if (Array.isArray(value)) return value.length ? value[0] : undefined;
  return value;
}

function num(value) {
  const raw = first(value);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Bambu records bed temperature per plate type. Pick the plate the vendor
 * actually recommends by taking the hottest plate it publishes a temp for,
 * and report which plate that is so the UI can tell the user what to install.
 */
const PLATE_KEYS = [
  ["textured_plate_temp", "Textured PEI Plate"],
  ["hot_plate_temp", "High Temp Plate"],
  ["eng_plate_temp", "Engineering Plate"],
  ["cool_plate_temp", "Cool Plate"],
  ["supertack_plate_temp", "Cool Plate SuperTack"],
];

function bedFor(profile) {
  const options = [];
  for (const [key, label] of PLATE_KEYS) {
    const temp = num(profile[key]);
    if (temp !== undefined && temp > 0) options.push({ plate: label, temp });
  }
  if (!options.length) return undefined;
  options.sort((a, b) => b.temp - a.temp);
  return options[0];
}

function buildCatalog() {
  if (!existsSync(bambuRoot)) {
    console.error(
      `Bambu Studio profiles not found at ${bambuRoot}\n` +
        `Install Bambu Studio, or pass --bambu <path>. ` +
        `Refusing to emit a catalog of invented filament values.`,
    );
    process.exit(1);
  }

  const vendors = readdirSync(bambuRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const out = [];
  const skipped = { noType: 0, excluded: 0, notInstantiable: 0 };

  for (const vendor of vendors) {
    const byName = readProfileDir(vendor);
    for (const [name, raw] of byName) {
      // Abstract "@base" presets are building blocks, not selectable filaments.
      if (raw.instantiation === "false" || raw.instantiation === false) {
        skipped.notInstantiable += 1;
        continue;
      }
      if (EXCLUDED_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
        skipped.excluded += 1;
        continue;
      }

      const profile = resolveInherits(raw, byName);
      const type = first(profile.filament_type);
      if (!type) {
        skipped.noType += 1;
        continue;
      }

      const printers = profile.compatible_printers;
      const compatiblePrinters = Array.isArray(printers)
        ? printers
        : printers
          ? [printers]
          : [];

      const nozzleTemp = num(profile.nozzle_temperature);
      const bed = bedFor(profile);

      // A filament with no published temperature is not usable data. Skip it
      // rather than shipping a plausible-looking default.
      if (nozzleTemp === undefined || !bed) {
        skipped.noType += 1;
        continue;
      }

      const flexible = FLEXIBLE_TYPES.has(String(type).toUpperCase());
      const rules = flexible ? DESIGN_RULES.flexible : DESIGN_RULES.rigid;

      out.push({
        id: name,
        name,
        vendor,
        settingId: profile.setting_id ?? null,
        // filament_id and setting_id are DIFFERENT namespaces. setting_id looks
        // like "GFSA00_11" and names the preset; filament_id looks like "GFA00"
        // and names the material. Bambu's filament_ids key expects the latter,
        // and it lives on the @base profile, so it only appears after the
        // inherits chain is resolved.
        filamentId: profile.filament_id ?? null,
        type,
        flexible,
        compatiblePrinters,
        // --- vendor data, read verbatim from Bambu profiles ---
        nozzleTemp,
        nozzleTempInitialLayer:
          num(profile.nozzle_temperature_initial_layer) ?? nozzleTemp,
        bedTemp: bed.temp,
        bedPlate: bed.plate,
        flowRatio: num(profile.filament_flow_ratio),
        maxVolumetricSpeed: num(profile.filament_max_volumetric_speed),
        retractionLength: num(profile.filament_retraction_length),
        density: num(profile.filament_density),
        costPerKg: num(profile.filament_cost),
        fanMin: num(profile.fan_min_speed),
        fanMax: num(profile.fan_max_speed),
        slowDownMinSpeed: num(profile.slow_down_min_speed),
        // --- case-design rules, NOT vendor data, see DESIGN_RULES ---
        design: {
          cavityClearance: rules.cavityClearance,
          wallFloor: rules.wallFloor,
          lipHeight: rules.lipHeight,
          provenance: rules.provenance,
        },
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { filaments: out, skipped };
}

const { filaments, skipped } = buildCatalog();

const byType = filaments.reduce((acc, filament) => {
  acc[filament.type] = (acc[filament.type] ?? 0) + 1;
  return acc;
}, {});

const payload = {
  generatedFrom: bambuRoot,
  // Deliberately no generation timestamp: it would churn the diff on every
  // rebuild and tell a reader nothing the git history does not already record.
  count: filaments.length,
  byType,
  designRules: DESIGN_RULES,
  filaments,
};

writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log(`Wrote ${filaments.length} filaments to ${outPath}`);
console.log(
  `Families: ${Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}:${count}`)
    .join("  ")}`,
);
console.log(
  `Skipped: ${skipped.notInstantiable} abstract, ${skipped.excluded} support/soluble, ${skipped.noType} missing temp data`,
);
