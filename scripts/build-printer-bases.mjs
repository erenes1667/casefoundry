#!/usr/bin/env node
/**
 * Builds a base Bambu project config for each supported printer, by harvesting
 * REAL project files that Bambu Studio itself wrote.
 *
 * CaseFoundry shipped exactly one base project, lifted from a print-verified
 * P2S file, so every export was a P2S job no matter which printer the user
 * owns. Handing that to an A1 owner is simply the wrong job: different bed,
 * different kinematics, different start and end gcode.
 *
 * An earlier version of this script tried to COMPOSE a base by overlaying
 * Bambu's machine and process profiles onto the P2S project. It failed twice,
 * and the failures were instructive:
 *
 *   "process not compatible with printer"          leftover P2S extruder variants
 *   "could not found extruder_type ...
 *    filament_index 2, extruder index 1"           filament slot count corrupted
 *
 * The cause is that filament-scoped arrays are sized SLOTS x VARIANTS, and
 * neither dimension is readable from a single file. Measured across real
 * projects on this machine:
 *
 *   P2S       1 slot  x 2 variants -> nozzle_temperature length 2
 *   A1        4 slots x 1 variant  -> nozzle_temperature length 4
 *   A1 mini   2 slots x 1 variant  -> nozzle_temperature length 2
 *   H2D      10 slots x 4 variants -> nozzle_temperature length 20
 *
 * Guessing at that model is exactly how the corrupted exports happened. So this
 * takes the approach the rest of the app takes to phone fit: start from
 * something real that already worked, and adapt it. Each base is a genuine
 * project Bambu Studio produced for that printer, trimmed to a single filament
 * slot because a phone case is a single-material print.
 *
 * Every base is slice-verified by scripts/slice-gate.test.ts. Nothing here is
 * trusted because it looks right.
 *
 * Usage: node scripts/build-printer-bases.mjs \
 *   --a1 /path/to/a1-project.3mf \
 *   --a1-mini /path/to/a1-mini-project.3mf \
 *   --p1s /path/to/p1s-project.3mf \
 *   --x1c /path/to/x1c-project.3mf
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";

const args = process.argv.slice(2);
const argValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
};

/**
 * Source projects, one per printer. Each must be a real .3mf that Bambu Studio
 * wrote and that contains Metadata/project_settings.config.
 */
const TARGETS = [
  {
    slug: "p2s-0.4",
    model: "Bambu Lab P2S",
    // The print-verified translucent-glass case, already proven to slice.
    source: "src/data/bambu-p2s-04-base.json",
    raw: true,
  },
  {
    slug: "a1-0.4",
    model: "Bambu Lab A1",
    source: argValue("--a1"),
  },
  {
    slug: "a1-mini-0.4",
    model: "Bambu Lab A1 mini",
    source: argValue("--a1-mini"),
  },
  {
    slug: "p1s-0.4",
    model: "Bambu Lab P1S",
    source: argValue("--p1s"),
  },
  {
    slug: "x1c-0.4",
    model: "Bambu Lab X1 Carbon",
    source: argValue("--x1c"),
  },
];

/**
 * Filament-scoped keys, selected by name and never by array length.
 *
 * Length is not a safe signal: machine_max_speed_x is ["500","200"], a genuine
 * normal/travel pair that must keep both entries on every printer. Reshaping it
 * would silently corrupt the machine motion limits.
 */
const FILAMENT_SCOPED_PREFIXES = ["filament_"];
const FILAMENT_SCOPED_EXACT = new Set([
  "nozzle_temperature",
  "nozzle_temperature_initial_layer",
  "slow_down_min_speed",
  "long_retractions_when_ec",
  "retraction_distances_when_ec",
  "override_process_overhang_speed",
  "volumetric_speed_coefficients",
  "additional_cooling_fan_speed",
  "close_fan_the_first_x_layers",
  "fan_max_speed",
  "fan_min_speed",
  "overhang_fan_speed",
  "overhang_fan_threshold",
  "eng_plate_temp",
  "eng_plate_temp_initial_layer",
  "cool_plate_temp",
  "cool_plate_temp_initial_layer",
  "hot_plate_temp",
  "hot_plate_temp_initial_layer",
  "textured_plate_temp",
  "textured_plate_temp_initial_layer",
  "supertack_plate_temp",
  "supertack_plate_temp_initial_layer",
]);

function isFilamentScoped(key) {
  return (
    FILAMENT_SCOPED_EXACT.has(key) ||
    FILAMENT_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function variantCount(config) {
  const list = config.printer_extruder_variant;
  return Array.isArray(list) && list.length ? list.length : 1;
}

/**
 * Trims every filament-scoped array down to one filament slot, keeping the
 * per-variant entries that belong to that slot.
 *
 * An array whose length matches neither shape is left untouched: an unfamiliar
 * shape is a reason to stop, not to reshape on a guess.
 */
function trimToSingleSlot(config) {
  const variants = variantCount(config);
  const slots = Math.max(
    1,
    Array.isArray(config.filament_settings_id)
      ? config.filament_settings_id.length
      : 1,
  );

  let trimmed = 0;
  let skipped = 0;
  for (const [key, value] of Object.entries(config)) {
    if (!Array.isArray(value) || !isFilamentScoped(key)) continue;
    if (value.length === slots && slots > 1) {
      config[key] = value.slice(0, 1);
      trimmed += 1;
    } else if (value.length === slots * variants && slots > 1) {
      config[key] = value.slice(0, variants);
      trimmed += 1;
    } else if (value.length !== 1 && value.length !== variants) {
      skipped += 1;
    }
  }
  // A single-material print needs no prime tower, and leaving one enabled from
  // a multi-colour source project puts it on the plate where the case sits:
  // "gcode path conflicts found between WipeTower and <object>".
  if (config.enable_prime_tower !== undefined) config.enable_prime_tower = "0";

  return { slots, variants, trimmed, skipped };
}

function readProjectConfig(path) {
  const bytes = readFileSync(path);
  const entries = unzipSync(new Uint8Array(bytes), {
    filter: (file) => file.name === "Metadata/project_settings.config",
  });
  const raw = entries["Metadata/project_settings.config"];
  if (!raw) throw new Error(`no project_settings.config in ${path}`);
  return JSON.parse(strFromU8(raw));
}

/** Falls back to Spotlight if a source path has moved. */
function locate(target) {
  if (!target.source) return null;
  if (existsSync(target.source)) return target.source;
  try {
    const name = target.source.split("/").pop();
    const found = execFileSync("mdfind", [`kMDItemFSName == '${name}'`], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    if (found[0]) return found[0];
  } catch {
    // Spotlight unavailable; fall through to the explicit skip below.
  }
  return null;
}

const summary = [];
for (const target of TARGETS) {
  let config;
  if (target.raw) {
    config = JSON.parse(readFileSync(target.source, "utf8"));
  } else {
    const path = locate(target);
    if (!path) {
      console.warn(
        `skip ${target.model}: source project not found. Any existing base is ` +
          `left in place rather than replaced by a guess.`,
      );
      continue;
    }
    config = readProjectConfig(path);
    if (config.printer_model !== target.model) {
      console.warn(
        `skip ${target.model}: ${path} is a ${config.printer_model} project.`,
      );
      continue;
    }
  }

  const shape = trimToSingleSlot(config);
  writeFileSync(
    `src/data/bambu-base-${target.slug}.json`,
    `${JSON.stringify(config, null, 1)}\n`,
  );
  summary.push({ ...target, ...shape, keys: Object.keys(config).length });
}

for (const entry of summary) {
  console.log(
    `${entry.slug.padEnd(12)} ${entry.model.padEnd(20)} ` +
      `slots=${entry.slots}->1 variants=${entry.variants} ` +
      `trimmed=${entry.trimmed} unknownShape=${entry.skipped} keys=${entry.keys}`,
  );
}
console.log(`\nWrote ${summary.length} printer bases.`);
