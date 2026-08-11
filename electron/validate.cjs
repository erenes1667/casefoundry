/**
 * Validation for everything crossing into the main process.
 *
 * Phone records are the app's untrusted input: they arrive from user-supplied
 * JSON and CSV "phone packs" and from imported database files, then flow
 * straight into geometry generation. Without a check here, a malformed pack can
 * reach the CSG engine with NaN, negative or absurd dimensions, which either
 * crashes the renderer or silently produces a case that cannot fit anything.
 *
 * Everything is validated by range, not just by type. A width of 1e9 is a valid
 * number and a catastrophic mesh.
 */

/** Plausible physical limits for a handheld phone, in millimetres. */
const LIMITS = {
  width: { min: 30, max: 140 },
  length: { min: 60, max: 260 },
  depth: { min: 3, max: 30 },
  cornerRadius: { min: 0, max: 40 },
  /** Features are positioned relative to the phone centre. */
  featureCoordinate: { min: -200, max: 200 },
  featureSize: { min: 0, max: 200 },
};

const FEATURE_KINDS = new Set([
  "camera",
  "cameraIsland",
  "flash",
  "button",
  "port",
  "speaker",
  "microphone",
  "simTray",
  "sPen",
  "coil",
  "antenna",
  "other",
]);

const FEATURE_SIDES = new Set([
  "back",
  "screen",
  "screenLeft",
  "screenRight",
  "top",
  "bottom",
]);

const FEATURE_SHAPES = new Set(["circle", "slot", "rect", "roundedRect"]);

const MAX_FEATURES = 64;
const MAX_STRING = 200;
const MAX_PHONES_PER_IMPORT = 5000;

class ValidationError extends Error {}

/**
 * Normalises an identifier to a stable, filesystem- and DOM-safe slug.
 * Mirrors the main process's safeId so both paths agree on the same id.
 */
function slugId(value) {
  const normalised = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  if (!normalised) {
    throw new ValidationError("Phone record has no usable id, brand or model");
  }
  return normalised;
}

function requireString(value, field, { maxLength = MAX_STRING, allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be text`);
  }
  if (!allowEmpty && !value.trim()) {
    throw new ValidationError(`${field} cannot be empty`);
  }
  if (value.length > maxLength) {
    throw new ValidationError(`${field} is longer than ${maxLength} characters`);
  }
  return value;
}

function requireNumber(value, field, range) {
  // Accept numeric strings because CSV imports carry everything as text, but
  // reject anything that is not a real finite number once converted.
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  if (range && (parsed < range.min || parsed > range.max)) {
    throw new ValidationError(
      `${field} is ${parsed}, outside the plausible range ${range.min} to ${range.max}`,
    );
  }
  return parsed;
}

function validateVec3(value, field, range) {
  if (!value || typeof value !== "object") {
    throw new ValidationError(`${field} must be an object with x, y and z`);
  }
  return {
    x: requireNumber(value.x, `${field}.x`, range),
    y: requireNumber(value.y, `${field}.y`, range),
    z: requireNumber(value.z, `${field}.z`, range),
  };
}

function validateFeature(input, index) {
  if (!input || typeof input !== "object") {
    throw new ValidationError(`feature ${index} is not an object`);
  }
  const label = `feature ${index} (${String(input.name ?? input.id ?? "unnamed").slice(0, 40)})`;

  if (!FEATURE_KINDS.has(input.kind)) {
    throw new ValidationError(`${label} has unknown kind "${input.kind}"`);
  }
  if (!FEATURE_SIDES.has(input.side)) {
    throw new ValidationError(`${label} has unknown side "${input.side}"`);
  }
  if (!FEATURE_SHAPES.has(input.shape)) {
    throw new ValidationError(`${label} has unknown shape "${input.shape}"`);
  }

  const size = validateVec3(input.size, `${label}.size`, LIMITS.featureSize);
  if (size.x === 0 && size.y === 0) {
    throw new ValidationError(`${label} has zero width and length`);
  }

  return {
    id: requireString(input.id ?? `feature-${index}`, `${label}.id`),
    name: requireString(input.name ?? "Unnamed feature", `${label}.name`),
    kind: input.kind,
    side: input.side,
    shape: input.shape,
    center: validateVec3(input.center, `${label}.center`, LIMITS.featureCoordinate),
    size,
    confidence: requireNumber(input.confidence ?? 0, `${label}.confidence`, {
      min: 0,
      max: 100,
    }),
    ...(typeof input.notes === "string"
      ? { notes: input.notes.slice(0, 2000) }
      : {}),
  };
}

/**
 * Validates one phone record and returns a normalised copy.
 *
 * Unknown extra properties are preserved so future fields survive a round trip,
 * but every field the geometry engine reads is checked here.
 */
function validatePhone(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Phone record must be an object");
  }

  const brand = requireString(input.brand, "brand");
  const model = requireString(input.model, "model");
  // id is what every lookup and selection path keys on, so it must always
  // exist. Rejecting a bad id is not enough: a MISSING id is the dangerous
  // case, because the renderer's device <select> then gets value={undefined},
  // becomes uncontrolled, and shows one handset selected while the real
  // selection stays on another. The user exports a case for the wrong phone
  // with no error. Guaranteeing it here means no caller can forget.
  const id = slugId(
    input.id === undefined || input.id === null || input.id === ""
      ? `${brand}-${model}`
      : requireString(input.id, `${brand} ${model} id`, { maxLength: 120 }),
  );

  if (!input.dimensions || typeof input.dimensions !== "object") {
    throw new ValidationError(`${brand} ${model}: dimensions are missing`);
  }

  const dimensions = {
    width: requireNumber(input.dimensions.width, `${brand} ${model} width`, LIMITS.width),
    length: requireNumber(
      input.dimensions.length,
      `${brand} ${model} length`,
      LIMITS.length,
    ),
    depth: requireNumber(input.dimensions.depth, `${brand} ${model} depth`, LIMITS.depth),
    cornerRadius: requireNumber(
      input.dimensions.cornerRadius,
      `${brand} ${model} cornerRadius`,
      LIMITS.cornerRadius,
    ),
  };

  // A corner radius larger than half the short edge cannot be built.
  if (dimensions.cornerRadius > dimensions.width / 2) {
    throw new ValidationError(
      `${brand} ${model}: corner radius ${dimensions.cornerRadius} exceeds half the width`,
    );
  }

  const rawFeatures = input.features ?? [];
  if (!Array.isArray(rawFeatures)) {
    throw new ValidationError(`${brand} ${model}: features must be a list`);
  }
  if (rawFeatures.length > MAX_FEATURES) {
    throw new ValidationError(
      `${brand} ${model}: ${rawFeatures.length} features exceeds the ${MAX_FEATURES} limit`,
    );
  }

  return {
    ...input,
    id,
    brand,
    model,
    dimensions,
    features: rawFeatures.map(validateFeature),
    confidence: requireNumber(input.confidence ?? 0, `${brand} ${model} confidence`, {
      min: 0,
      max: 100,
    }),
    // Every field the renderer later iterates must be normalised here. A
    // database import previously carried modelNumbers through untouched, so a
    // non-array value crashed the renderer on the next render.
    modelNumbers: Array.isArray(input.modelNumbers)
      ? input.modelNumbers
          .filter((value) => typeof value === "string")
          .slice(0, 32)
      : [],
    sources: Array.isArray(input.sources) ? input.sources.slice(0, 64) : [],
    tags: Array.isArray(input.tags)
      ? input.tags.filter((tag) => typeof tag === "string").slice(0, 32)
      : [],
    validation:
      input.validation && typeof input.validation === "object"
        ? input.validation
        : { geometry: "not-run", slice: "not-run", physicalFit: "not-tested" },
  };
}

function validatePhoneList(input) {
  if (!Array.isArray(input)) {
    throw new ValidationError("Phone pack must contain a list of records");
  }
  if (input.length > MAX_PHONES_PER_IMPORT) {
    throw new ValidationError(
      `Phone pack has ${input.length} records, above the ${MAX_PHONES_PER_IMPORT} limit`,
    );
  }
  return input.map((phone, index) => {
    try {
      return validatePhone(phone);
    } catch (error) {
      throw new ValidationError(`Record ${index + 1}: ${error.message}`);
    }
  });
}

/** Caps a base64 payload so a runaway export cannot exhaust memory or disk. */
const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

function validateBinaryPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("Save request is malformed");
  }
  const base64 = payload.base64;
  if (typeof base64 !== "string" || !base64.length) {
    throw new ValidationError("Save request carries no data");
  }
  if (!/^[A-Za-z0-9+/=\r\n]*$/.test(base64)) {
    throw new ValidationError("Save request data is not valid base64");
  }
  // 4 base64 characters encode 3 bytes.
  if ((base64.length * 3) / 4 > MAX_EXPORT_BYTES) {
    throw new ValidationError("Export exceeds the 256 MB limit");
  }
  return base64;
}

module.exports = {
  LIMITS,
  ValidationError,
  validateBinaryPayload,
  validatePhone,
  validatePhoneList,
};
