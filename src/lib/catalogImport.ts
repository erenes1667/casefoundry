import type { PhoneRecord, VerificationStatus } from "../types";
import { clamp, slugify } from "./format";

const statuses = new Set<VerificationStatus>([
  "production-ready",
  "fit-validated",
  "reference-derived",
  "measured",
  "sourced",
  "compatibility-candidate",
  "provisional",
]);

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedPhone(input: Partial<PhoneRecord>, index: number): PhoneRecord {
  const now = new Date().toISOString();
  if (!input.brand || !input.model) {
    throw new Error(`Record ${index + 1} is missing brand or model`);
  }
  const dimensions = input.dimensions ?? {
    width: 0,
    length: 0,
    depth: 0,
    cornerRadius: 0,
  };
  if (
    numberValue(dimensions.width) <= 0 ||
    numberValue(dimensions.length) <= 0 ||
    numberValue(dimensions.depth) <= 0
  ) {
    throw new Error(`Record ${index + 1} has incomplete body dimensions`);
  }
  const status = statuses.has(input.status as VerificationStatus)
    ? (input.status as VerificationStatus)
    : "provisional";
  return {
    id: input.id || slugify(`${input.brand}-${input.model}-${input.variant || index}`),
    brand: String(input.brand).trim(),
    model: String(input.model).trim(),
    variant: String(input.variant || "Unspecified variant").trim(),
    modelNumbers: Array.isArray(input.modelNumbers) ? input.modelNumbers.map(String) : [],
    chassisFamily: String(input.chassisFamily || slugify(`${input.brand}-${input.model}`)),
    releaseYear: Math.round(numberValue(input.releaseYear, new Date().getFullYear())),
    revision: Math.max(1, Math.round(numberValue(input.revision, 1))),
    status,
    confidence: clamp(numberValue(input.confidence, 25), 0, 100),
    dimensions: {
      width: numberValue(dimensions.width),
      length: numberValue(dimensions.length),
      depth: numberValue(dimensions.depth),
      cornerRadius: Math.max(0.6, numberValue(dimensions.cornerRadius, 8)),
    },
    features: Array.isArray(input.features) ? input.features : [],
    sources: Array.isArray(input.sources) ? input.sources : [],
    validation: input.validation ?? {
      geometry: "not-run",
      slice: "not-run",
      physicalFit: "not-tested",
    },
    tags: Array.isArray(input.tags) ? input.tags.map(String) : ["imported"],
    notes: String(input.notes || "Imported record. Feature placement must be verified before production use."),
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function parseCsv(text: string): PhoneRecord[] {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one record");
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const cell = (row: string[], key: string) => row[headers.indexOf(key)] || "";
  return rows.slice(1).map((row, index) => {
    const modelNumbers = cell(row, "modelnumbers")
      .split(/[|;]/)
      .map((value) => value.trim())
      .filter(Boolean);
    let features = [];
    let sources = [];
    try {
      features = cell(row, "featuresjson") ? JSON.parse(cell(row, "featuresjson")) : [];
      sources = cell(row, "sourcesjson") ? JSON.parse(cell(row, "sourcesjson")) : [];
    } catch {
      throw new Error(`CSV row ${index + 2} contains invalid feature/source JSON`);
    }
    return normalizedPhone(
      {
        id: cell(row, "id"),
        brand: cell(row, "brand"),
        model: cell(row, "model"),
        variant: cell(row, "variant"),
        modelNumbers,
        chassisFamily: cell(row, "chassisfamily"),
        releaseYear: numberValue(cell(row, "releaseyear")),
        revision: numberValue(cell(row, "revision"), 1),
        status: cell(row, "status") as VerificationStatus,
        confidence: numberValue(cell(row, "confidence"), 25),
        dimensions: {
          width: numberValue(cell(row, "width")),
          length: numberValue(cell(row, "length")),
          depth: numberValue(cell(row, "depth")),
          cornerRadius: numberValue(cell(row, "cornerradius"), 8),
        },
        features,
        sources,
        tags: cell(row, "tags").split(/[|;]/).filter(Boolean),
        notes: cell(row, "notes"),
      },
      index,
    );
  });
}

export function parsePhonePack(text: string, filename = "phone-pack.json"): PhoneRecord[] {
  if (filename.toLowerCase().endsWith(".csv")) return parseCsv(text);
  const parsed = JSON.parse(text) as PhoneRecord[] | { phones?: PhoneRecord[] };
  const records = Array.isArray(parsed) ? parsed : parsed.phones;
  if (!Array.isArray(records)) throw new Error("JSON pack must be an array or contain a phones array");
  return records.map((record, index) => normalizedPhone(record, index));
}

function quoteCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function phonePackCsv(phones: PhoneRecord[]): string {
  const headers = [
    "id",
    "brand",
    "model",
    "variant",
    "modelNumbers",
    "chassisFamily",
    "releaseYear",
    "revision",
    "status",
    "confidence",
    "width",
    "length",
    "depth",
    "cornerRadius",
    "tags",
    "featuresJson",
    "sourcesJson",
    "notes",
  ];
  const rows = phones.map((phone) => [
    phone.id,
    phone.brand,
    phone.model,
    phone.variant,
    phone.modelNumbers.join("|"),
    phone.chassisFamily,
    phone.releaseYear,
    phone.revision,
    phone.status,
    phone.confidence,
    phone.dimensions.width,
    phone.dimensions.length,
    phone.dimensions.depth,
    phone.dimensions.cornerRadius,
    phone.tags.join("|"),
    JSON.stringify(phone.features),
    JSON.stringify(phone.sources),
    phone.notes,
  ]);
  return [headers, ...rows].map((row) => row.map(quoteCsv).join(",")).join("\n") + "\n";
}
