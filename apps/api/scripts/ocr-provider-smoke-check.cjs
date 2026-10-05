const { existsSync, mkdirSync, statSync, writeFileSync } = require("node:fs");
const { basename, dirname, extname, resolve } = require("node:path");

const DEFAULT_DATE = new Date("2026-01-01T00:00:00.000Z");
const SUPPORTED_PROVIDERS = new Set([
  "aws-textract",
  "azure",
  "google",
  "google-vision",
  "http",
]);
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

  const configs = readSmokeRunConfigs();
  const summary =
    configs.length === 1
      ? await runSmokeCheck(configs[0])
      : await runSmokeChecks(configs, createProvider, {
          continueOnError: process.env.OCR_SMOKE_CONTINUE_ON_ERROR === "true",
          summaryFilePath: parseOptionalPathEnv(
            process.env.OCR_SMOKE_MATRIX_SUMMARY_FILE,
            process.cwd(),
          ),
        });

  console.log(JSON.stringify(summary, null, 2));

  if (summary.ok === false) {
    process.exitCode = 1;
  }
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

  if (config.summaryFilePath) {
    writeSmokeSummaryFile(summary, config.summaryFilePath);
  }

  return summary;
}

async function runSmokeChecks(
  configs,
  providerFactory = createProvider,
  options = {},
) {
  const runs = [];

  for (const config of configs) {
    try {
      const summary = await runSmokeCheck(config, providerFactory);

      runs.push({
        ok: true,
        runName: summary.runName,
        requestedProvider: summary.requestedProvider,
        summary,
      });
    } catch (error) {
      const failure = summarizeSmokeFailure(config, error);

      runs.push(failure);

      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  const matrixSummary = {
    ok: runs.every((run) => run.ok),
    runCount: runs.length,
    passed: runs.filter((run) => run.ok).length,
    failed: runs.filter((run) => !run.ok).length,
    runs,
  };

  if (options.summaryFilePath) {
    writeSmokeSummaryFile(matrixSummary, options.summaryFilePath);
  }

  return matrixSummary;
}

function readSmokeConfig(env = process.env, cwd = process.cwd()) {
  const provider = normalizeProviderName(
    env.OCR_SMOKE_PROVIDER || env.OCR_PROVIDER,
  );

  if (!provider || !SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(
      'Set OCR_SMOKE_PROVIDER to "azure", "google", "google-vision", "aws-textract", or "http" for a real-provider OCR smoke check.',
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
    runName: env.OCR_SMOKE_RUN_NAME?.trim() || provider,
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
    summaryFilePath: parseOptionalPathEnv(env.OCR_SMOKE_SUMMARY_FILE, cwd),
  };
}

function readSmokeRunConfigs(env = process.env, cwd = process.cwd()) {
  const runsJson = env.OCR_SMOKE_RUNS_JSON?.trim();

  if (!runsJson) {
    return [readSmokeConfig(env, cwd)];
  }

  let runs;

  try {
    runs = JSON.parse(runsJson);
  } catch {
    throw new Error("OCR_SMOKE_RUNS_JSON must be a JSON array.");
  }

  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error("OCR_SMOKE_RUNS_JSON must contain at least one run.");
  }

  return runs.map((run, index) =>
    readSmokeConfig(toSmokeRunEnv(env, run, index), cwd),
  );
}

function toSmokeRunEnv(env, run, index) {
  if (!isPlainObject(run)) {
    throw new Error(`OCR smoke run at index ${index} must be an object.`);
  }

  const nextEnv = { ...env };

  setRunEnv(nextEnv, "OCR_SMOKE_RUN_NAME", run.name ?? run.runName);
  setRunEnv(nextEnv, "OCR_SMOKE_PROVIDER", run.provider);
  setRunEnv(nextEnv, "OCR_SMOKE_FILE", run.file ?? run.filePath);
  setRunEnv(nextEnv, "OCR_SMOKE_FILE_TYPE", run.fileType);
  setRunEnv(nextEnv, "OCR_SMOKE_LAYOUT", run.layout);
  setRunEnv(nextEnv, "OCR_SMOKE_ROW_COUNT", run.rowCount);
  setRunEnv(nextEnv, "OCR_SMOKE_PAGE_START", run.pageStart);
  setRunEnv(nextEnv, "OCR_SMOKE_PAGE_COUNT", run.pageCount);
  setRunEnv(nextEnv, "OCR_SMOKE_TOTAL_PAGES", run.totalPages);
  setRunEnv(
    nextEnv,
    "OCR_SMOKE_SUMMARY_FILE",
    run.summaryFile ?? run.summaryFilePath,
  );

  if (run.requireRows !== undefined) {
    nextEnv.OCR_SMOKE_REQUIRE_ROWS = run.requireRows ? "true" : "false";
  }

  if (run.fields !== undefined) {
    nextEnv.OCR_SMOKE_FIELDS_JSON =
      typeof run.fields === "string" ? run.fields : JSON.stringify(run.fields);
  }

  return nextEnv;
}

function setRunEnv(env, key, value) {
  if (value !== undefined && value !== null) {
    env[key] = String(value);
  }
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

  if (provider === "google") {
    if (!env.GOOGLE_DOCUMENT_AI_PROJECT_ID?.trim()) {
      missing.push("GOOGLE_DOCUMENT_AI_PROJECT_ID");
    }

    if (!env.GOOGLE_DOCUMENT_AI_LOCATION?.trim()) {
      missing.push("GOOGLE_DOCUMENT_AI_LOCATION");
    }

    if (!env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID?.trim()) {
      missing.push("GOOGLE_DOCUMENT_AI_PROCESSOR_ID");
    }

    if (!env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN?.trim()) {
      missing.push("GOOGLE_DOCUMENT_AI_ACCESS_TOKEN");
    }
  }

  if (
    provider === "google-vision" &&
    !env.GOOGLE_VISION_API_KEY?.trim() &&
    !env.GOOGLE_VISION_ACCESS_TOKEN?.trim()
  ) {
    missing.push("GOOGLE_VISION_API_KEY or GOOGLE_VISION_ACCESS_TOKEN");
  }

  if (provider === "aws-textract") {
    if (
      !env.AWS_TEXTRACT_ACCESS_KEY_ID?.trim() &&
      !env.AWS_ACCESS_KEY_ID?.trim()
    ) {
      missing.push("AWS_TEXTRACT_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID");
    }

    if (
      !env.AWS_TEXTRACT_SECRET_ACCESS_KEY?.trim() &&
      !env.AWS_SECRET_ACCESS_KEY?.trim()
    ) {
      missing.push(
        "AWS_TEXTRACT_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY",
      );
    }

    if (
      !env.AWS_TEXTRACT_REGION?.trim() &&
      !env.AWS_REGION?.trim() &&
      !env.AWS_DEFAULT_REGION?.trim()
    ) {
      missing.push("AWS_TEXTRACT_REGION or AWS_REGION or AWS_DEFAULT_REGION");
    }
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
    runName: config.runName ?? null,
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

function summarizeSmokeFailure(config, error) {
  return {
    ok: false,
    runName: config.runName ?? config.provider ?? null,
    requestedProvider: config.provider ?? null,
    document: {
      fileName: config.fileName ?? null,
      fileType: config.fileType ?? null,
      layout: config.layout ?? null,
      pageStart: config.pageStart ?? null,
      pageCount: config.pageCount ?? null,
    },
    error: errorDiagnostic(error),
  };
}

function writeSmokeSummaryFile(summary, filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
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
    if (provider === "aws-textract") {
      const {
        AwsTextractOcrProvider,
      } = require("../dist/ocr/aws-textract-ocr.provider");

      return new AwsTextractOcrProvider();
    }

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

    if (provider === "google") {
      const {
        GoogleDocumentAiOcrProvider,
      } = require("../dist/ocr/google-document-ai-ocr.provider");

      return new GoogleDocumentAiOcrProvider();
    }

    if (provider === "google-vision") {
      const {
        GoogleVisionOcrProvider,
      } = require("../dist/ocr/google-vision-ocr.provider");

      return new GoogleVisionOcrProvider();
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

  if (
    normalized === "aws" ||
    normalized === "aws-textract" ||
    normalized === "textract"
  ) {
    return "aws-textract";
  }

  if (normalized === "google-document-ai") {
    return "google";
  }

  if (
    normalized === "google-vision" ||
    normalized === "google-cloud-vision" ||
    normalized === "vision"
  ) {
    return "google-vision";
  }

  if (
    normalized === "http" ||
    normalized === "azure" ||
    normalized === "google"
  ) {
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

function parseOptionalPathEnv(value, cwd) {
  if (!value?.trim()) {
    return undefined;
  }

  return resolve(cwd, value.trim());
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

function errorDiagnostic(error, depth = 0) {
  const diagnostic = {
    name: error instanceof Error ? error.name : typeof error,
    message: sanitizedErrorMessage(error),
  };
  const cause = error instanceof Error ? error.cause : undefined;

  if (cause && depth < 2) {
    diagnostic.cause = errorDiagnostic(cause, depth + 1);
  }

  return diagnostic;
}

function sanitizedErrorMessage(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown OCR smoke check error.";

  return redactSensitiveText(message.replace(/\s+/g, " ").trim()).slice(0, 600);
}

function redactSensitiveText(value) {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(
      /(ocp-apim-subscription-key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1[redacted]",
    )
    .replace(
      /((?:api[_-]?key|subscription[_-]?key|token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1[redacted]",
    )
    .replace(
      /((?:access[_-]?token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1[redacted]",
    )
    .replace(
      /((?:aws[_-]?)?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1[redacted]",
    );
}

function helpText() {
  return `
Usage:
  OCR_SMOKE_PROVIDER=aws-textract OCR_SMOKE_FILE=./samples/sheet.pdf npm run smoke:ocr
  OCR_SMOKE_PROVIDER=azure OCR_SMOKE_FILE=./samples/sheet.pdf npm run smoke:ocr
  OCR_SMOKE_PROVIDER=google OCR_SMOKE_FILE=./samples/sheet.pdf npm run smoke:ocr
  OCR_SMOKE_PROVIDER=google-vision OCR_SMOKE_FILE=./samples/sheet.png npm run smoke:ocr
  OCR_SMOKE_PROVIDER=http OCR_SMOKE_FILE=./samples/sheet.pdf npm run smoke:ocr

Environment:
  OCR_SMOKE_PROVIDER       Required: azure, google, google-vision, aws-textract, or http.
  OCR_SMOKE_FILE           Required: local PDF/image path.
  OCR_SMOKE_FILE_TYPE      Optional MIME type; inferred from extension.
  OCR_SMOKE_LAYOUT         Optional: table or form. Defaults to table.
  OCR_SMOKE_ROW_COUNT      Optional 1-25 row limit. Defaults to 10.
  OCR_SMOKE_PAGE_START     Optional PDF page start. Defaults to 1.
  OCR_SMOKE_PAGE_COUNT     Optional PDF page count. Defaults to 1.
  OCR_SMOKE_TOTAL_PAGES    Optional known PDF page count for metadata.
  OCR_SMOKE_REQUIRE_ROWS   Optional true/false; fail when no rows are returned.
  OCR_SMOKE_FIELDS_JSON    Optional JSON array of template fields.
  OCR_SMOKE_SUMMARY_FILE   Optional path for a sanitized JSON summary artifact.

Matrix mode:
  OCR_SMOKE_RUNS_JSON      Optional JSON array of smoke runs. Each run can set
                           name, provider, file, fileType, layout, rowCount,
                           pageStart, pageCount, totalPages, requireRows,
                           fields, and summaryFile.
  OCR_SMOKE_MATRIX_SUMMARY_FILE
                           Optional path for the sanitized aggregate summary.
  OCR_SMOKE_CONTINUE_ON_ERROR
                           Optional true/false; when true, all matrix runs are
                           attempted and failures are captured with redacted
                           error details.

Provider configuration:
  AWS Textract requires AWS_TEXTRACT_REGION plus AWS_TEXTRACT_ACCESS_KEY_ID and
  AWS_TEXTRACT_SECRET_ACCESS_KEY, or the standard AWS_REGION/AWS_ACCESS_KEY_ID/
  AWS_SECRET_ACCESS_KEY names. AWS_TEXTRACT_SESSION_TOKEN is optional.
  Azure requires AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.
  Google requires GOOGLE_DOCUMENT_AI_PROJECT_ID, GOOGLE_DOCUMENT_AI_LOCATION,
  GOOGLE_DOCUMENT_AI_PROCESSOR_ID, and GOOGLE_DOCUMENT_AI_ACCESS_TOKEN.
  Google Vision requires GOOGLE_VISION_API_KEY or GOOGLE_VISION_ACCESS_TOKEN.
  HTTP requires OCR_HTTP_ENDPOINT and supports OCR_HTTP_BEARER_TOKEN, OCR_HTTP_DIRECT_PDF, and OCR_HTTP_INCLUDE_FILE.

The summary intentionally omits extracted cell values so real smoke-test output
does not print attendance data. When OCR_SMOKE_SUMMARY_FILE is set, the same
sanitized summary is written to that JSON file for later comparison.
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
  readSmokeRunConfigs,
  runSmokeCheck,
  runSmokeChecks,
  summarizeExtraction,
  summarizeSmokeFailure,
  validateProviderEnvironment,
  writeSmokeSummaryFile,
};
