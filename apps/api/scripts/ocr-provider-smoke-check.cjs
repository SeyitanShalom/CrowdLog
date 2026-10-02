const { existsSync, statSync } = require("node:fs");
const { basename, extname, resolve } = require("node:path");

const DEFAULT_DATE = new Date("2026-01-01T00:00:00.000Z");
const SUPPORTED_PROVIDERS = new Set(["azure", "http"]);
const PRISMA_FIELD_TYPES = new Set([
  "TEXT",
  "EMAIL",
  "PHONE",
  "NUMBER",
  "SIGNATURE",
  "DATE",
  "SELECT",
  "MULTI_SELECT",
]);
const FIELD_TYPE_ALIASES = {
  text: "TEXT",
  email: "EMAIL",
  phone: "PHONE",
  number: "NUMBER",
  signature: "SIGNATURE",
  date: "DATE",
  select: "SELECT",
  multi_select: "MULTI_SELECT",
  "multi-select": "MULTI_SELECT",
};

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(helpText());
    return;
  }

  const config = readSmokeConfig();
  const summary = await runSmokeCheck(config);

  console.log(JSON.stringify(summary, null, 2));
}

async function runSmokeCheck(config, providerFactory = createProvider) {
  validateProviderEnvironment(config.provider, process.env);

  const provider = providerFactory(config.provider);
  const input = buildSmokeInput(config);
  const result = await provider.extract(input);
  const summary = summarizeExtraction(result, input.template.fields, config);

  if (config.requireRows && result.rows.length === 0) {
    throw new Error(
      "OCR smoke check completed but returned no rows. Remove OCR_SMOKE_REQUIRE_ROWS or inspect provider/template mapping.",
    );
  }

  return summary;
}

function readSmokeConfig(env = process.env, cwd = process.cwd()) {
  const provider = normalizeProviderName(
    env.OCR_SMOKE_PROVIDER || env.OCR_PROVIDER,
  );

  if (!provider || !SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(
      'Set OCR_SMOKE_PROVIDER to "azure" or "http" for a real-provider OCR smoke check.',
    );
  }

  const configuredFilePath = env.OCR_SMOKE_FILE?.trim();

  if (!configuredFilePath) {
    throw new Error(
      "Set OCR_SMOKE_FILE to a local sample PDF or image path before running the OCR smoke check.",
    );
  }

  const filePath = resolve(cwd, configuredFilePath);

  if (!existsSync(filePath)) {
    throw new Error(`OCR_SMOKE_FILE does not exist: ${filePath}`);
  }

  if (!statSync(filePath).isFile()) {
    throw new Error(`OCR_SMOKE_FILE must point to a file: ${filePath}`);
  }

  return {
    provider,
    filePath,
    fileName: basename(filePath),
    fileType: env.OCR_SMOKE_FILE_TYPE?.trim() || inferFileType(filePath),
    fields: parseFields(env.OCR_SMOKE_FIELDS_JSON),
    layout: parseLayout(env.OCR_SMOKE_LAYOUT),
    rowCount: parseIntegerEnv(env.OCR_SMOKE_ROW_COUNT, {
      fallback: 10,
      min: 1,
      max: 25,
      name: "OCR_SMOKE_ROW_COUNT",
    }),
    pageStart: parseIntegerEnv(env.OCR_SMOKE_PAGE_START, {
      fallback: 1,
      min: 1,
      max: 500,
      name: "OCR_SMOKE_PAGE_START",
    }),
    pageCount: parseIntegerEnv(env.OCR_SMOKE_PAGE_COUNT, {
      fallback: 1,
      min: 1,
      max: 20,
      name: "OCR_SMOKE_PAGE_COUNT",
    }),
    totalPages: parseOptionalIntegerEnv(env.OCR_SMOKE_TOTAL_PAGES, {
      min: 1,
      max: 500,
      name: "OCR_SMOKE_TOTAL_PAGES",
    }),
    requireRows: env.OCR_SMOKE_REQUIRE_ROWS === "true",
  };
}

function validateProviderEnvironment(provider, env = process.env) {
  const missing = [];

  if (provider === "azure") {
    if (!env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim()) {
      missing.push("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
    }

    if (!env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim()) {
      missing.push("AZURE_DOCUMENT_INTELLIGENCE_KEY");
    }
  }

  if (provider === "http" && !env.OCR_HTTP_ENDPOINT?.trim()) {
    missing.push("OCR_HTTP_ENDPOINT");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s) for ${provider} OCR smoke check: ${missing.join(
        ", ",
      )}.`,
    );
  }
}

function buildSmokeInput(config) {
  return {
    document: {
      id: "ocr-smoke-document",
      eventId: "ocr-smoke-event",
      fileName: config.fileName,
      fileType: config.fileType,
      fileUrl: `smoke://${config.fileName}`,
      filePath: config.filePath,
    },
    template: {
      id: "ocr-smoke-template",
      name: "OCR smoke template",
      fields: config.fields,
    },
    options: {
      rowCount: config.rowCount,
      layout: config.layout,
      pageStart: config.pageStart,
      pageCount: config.pageCount,
      ...(config.totalPages ? { totalPages: config.totalPages } : {}),
    },
  };
}

function summarizeExtraction(result, fields, config = {}) {
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const suggestedFields = Array.isArray(result.suggestedFields)
    ? result.suggestedFields
    : [];

  return {
    ok: true,
    provider: result.providerName,
    requestedProvider: config.provider ?? null,
    document: {
      fileName: config.fileName ?? null,
      fileType: config.fileType ?? null,
      layout: config.layout ?? null,
      pageStart: config.pageStart ?? null,
      pageCount: config.pageCount ?? null,
    },
    rows: {
      count: rows.length,
      averageConfidence: average(
        rows
          .map((row) => confidenceNumber(row.confidenceScore))
          .filter((value) => value !== null),
      ),
      preview: rows.slice(0, 3).map((row) => summarizeRow(row, fields)),
    },
    fields: fields.map((field) => summarizeField(field, rows)),
    suggestedFields: suggestedFields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      confidence: confidenceNumber(field.confidence),
      sampleCount: Array.isArray(field.sampleValues)
        ? field.sampleValues.length
        : 0,
    })),
    rawOcrProvider:
      result.rawOcrJson &&
      typeof result.rawOcrJson === "object" &&
      !Array.isArray(result.rawOcrJson) &&
      typeof result.rawOcrJson.provider === "string"
        ? result.rawOcrJson.provider
        : null,
  };
}

function summarizeRow(row, fields) {
  const data = isPlainObject(row.data) ? row.data : {};
  const values = Array.isArray(row.values) ? row.values : [];

  return {
    rowNumber: positiveInteger(row.rowNumber),
    sourcePage: positiveInteger(row.sourcePage),
    confidenceScore: confidenceNumber(row.confidenceScore),
    populatedFields: fields
      .filter((field) => hasExtractedValue(data[field.key]))
      .map((field) => field.key),
    issueCount: values.reduce(
      (total, value) =>
        total + (Array.isArray(value.issues) ? value.issues.length : 0),
      0,
    ),
  };
}

function summarizeField(field, rows) {
  const cells = rows.flatMap((row) =>
    Array.isArray(row.values)
      ? row.values.filter((value) => value?.field?.key === field.key)
      : [],
  );

  return {
    key: field.key,
    label: field.label,
    type: field.type,
    populatedRows: rows.filter(
      (row) => isPlainObject(row.data) && hasExtractedValue(row.data[field.key]),
    ).length,
    averageConfidence: average(
      cells
        .map((cell) => confidenceNumber(cell.confidence))
        .filter((value) => value !== null),
    ),
    issueCount: cells.reduce(
      (total, cell) =>
        total + (Array.isArray(cell.issues) ? cell.issues.length : 0),
      0,
    ),
  };
}

function createProvider(provider) {
  try {
    if (provider === "azure") {
      const {
        AzureDocumentIntelligenceOcrProvider,
      } = require("../dist/ocr/azure-document-intelligence-ocr.provider");

      return new AzureDocumentIntelligenceOcrProvider();
    }

    if (provider === "http") {
      const { HttpOcrProvider } = require("../dist/ocr/http-ocr.provider");

      return new HttpOcrProvider();
    }
  } catch (error) {
    throw new Error(
      "Could not load built OCR provider files. Run npm run build before running the smoke check.",
      { cause: error },
    );
  }

  throw new Error(`Unsupported OCR smoke provider: ${provider}`);
}

function parseFields(value) {
  if (!value?.trim()) {
    return defaultFields();
  }

  let parsed;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("OCR_SMOKE_FIELDS_JSON must be a JSON array.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("OCR_SMOKE_FIELDS_JSON must contain at least one field.");
  }

  return parsed.map((field, index) => toTemplateField(field, index));
}

function defaultFields() {
  return [
    {
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
      aliases: ["Full Name", "Student Name", "Participant Name"],
    },
    {
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: false,
      aliases: ["Email Address"],
    },
    {
      label: "Phone",
      key: "phone",
      type: "PHONE",
      required: false,
      aliases: ["Phone Number", "Mobile"],
    },
    {
      label: "Signature",
      key: "signature",
      type: "SIGNATURE",
      required: false,
      aliases: ["Signed"],
    },
  ].map(toTemplateField);
}

function toTemplateField(field, index) {
  if (!isPlainObject(field)) {
    throw new Error(`OCR smoke field at index ${index} must be an object.`);
  }

  const label = stringValue(field.label);
  const key = stringValue(field.key) || (label ? fieldKeyFromLabel(label) : "");
  const type = normalizeFieldType(field.type);

  if (!label || !key || !type) {
    throw new Error(
      `OCR smoke field at index ${index} needs a label, key, and supported type.`,
    );
  }

  return {
    id: stringValue(field.id) || `ocr_smoke_field_${index + 1}`,
    templateId: "ocr-smoke-template",
    label,
    key,
    type,
    required: Boolean(field.required),
    sortOrder:
      typeof field.sortOrder === "number" && Number.isFinite(field.sortOrder)
        ? field.sortOrder
        : index + 1,
    aliases: stringArray(field.aliases),
    options: stringArray(field.options),
    createdAt: DEFAULT_DATE,
    updatedAt: DEFAULT_DATE,
  };
}

function normalizeProviderName(value) {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "azure-document-intelligence") {
    return "azure";
  }

  if (normalized === "http" || normalized === "azure") {
    return normalized;
  }

  return null;
}

function normalizeFieldType(value) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "text";
  const alias = FIELD_TYPE_ALIASES[raw.toLowerCase()];
  const candidate = alias || raw.toUpperCase();

  return PRISMA_FIELD_TYPES.has(candidate) ? candidate : null;
}

function parseLayout(value) {
  if (!value?.trim()) {
    return "table";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "table" || normalized === "form") {
    return normalized;
  }

  throw new Error('OCR_SMOKE_LAYOUT must be "table" or "form".');
}

function parseIntegerEnv(value, { fallback, min, max, name }) {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }

  return parsed;
}

function parseOptionalIntegerEnv(value, options) {
  if (!value?.trim()) {
    return undefined;
  }

  return parseIntegerEnv(value, { ...options, fallback: undefined });
}

function inferFileType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function fieldKeyFromLabel(label) {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function average(values) {
  if (values.length === 0) {
    return null;
  }

  return Number(
    (values.reduce((total, value) => total + value, 0) / values.length).toFixed(
      2,
    ),
  );
}

function hasExtractedValue(value) {
  return value !== undefined && value !== null && value !== "" && value !== false;
}

function confidenceNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(Math.max(0, Math.min(1, value)).toFixed(2))
    : null;
}

function positiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function helpText() {
  return `
Usage:
  OCR_SMOKE_PROVIDER=azure OCR_SMOKE_FILE=./samples/sheet.pdf npm run smoke:ocr
  OCR_SMOKE_PROVIDER=http OCR_SMOKE_FILE=./samples/sheet.pdf npm run smoke:ocr

Environment:
  OCR_SMOKE_PROVIDER       Required: azure or http.
  OCR_SMOKE_FILE           Required: local PDF/image path.
  OCR_SMOKE_FILE_TYPE      Optional MIME type; inferred from extension.
  OCR_SMOKE_LAYOUT         Optional: table or form. Defaults to table.
  OCR_SMOKE_ROW_COUNT      Optional 1-25 row limit. Defaults to 10.
  OCR_SMOKE_PAGE_START     Optional PDF page start. Defaults to 1.
  OCR_SMOKE_PAGE_COUNT     Optional PDF page count. Defaults to 1.
  OCR_SMOKE_TOTAL_PAGES    Optional known PDF page count for metadata.
  OCR_SMOKE_REQUIRE_ROWS   Optional true/false; fail when no rows are returned.
  OCR_SMOKE_FIELDS_JSON    Optional JSON array of template fields.

Provider configuration:
  Azure requires AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.
  HTTP requires OCR_HTTP_ENDPOINT and supports OCR_HTTP_BEARER_TOKEN, OCR_HTTP_DIRECT_PDF, and OCR_HTTP_INCLUDE_FILE.

The summary intentionally omits extracted cell values so real smoke-test output
does not print attendance data.
`.trim();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSmokeInput,
  inferFileType,
  normalizeProviderName,
  parseFields,
  readSmokeConfig,
  runSmokeCheck,
  summarizeExtraction,
  validateProviderEnvironment,
};
