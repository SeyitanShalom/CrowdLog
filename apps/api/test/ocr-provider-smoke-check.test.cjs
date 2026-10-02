const assert = require("node:assert/strict");
const { mkdir, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

const {
  buildSmokeInput,
  inferFileType,
  normalizeProviderName,
  readSmokeConfig,
  summarizeExtraction,
  validateProviderEnvironment,
} = require("../scripts/ocr-provider-smoke-check.cjs");

test("OCR provider smoke config builds a provider extraction input", async () => {
  const tempDir = join(process.cwd(), ".tmp", "ocr-provider-smoke-check-test");
  const filePath = join(tempDir, "sample.pdf");

  await mkdir(tempDir, { recursive: true });
  await writeFile(filePath, "%PDF-1.7\n");

  try {
    const config = readSmokeConfig(
      {
        OCR_SMOKE_PROVIDER: "azure-document-intelligence",
        OCR_SMOKE_FILE: filePath,
        OCR_SMOKE_LAYOUT: "form",
        OCR_SMOKE_ROW_COUNT: "7",
        OCR_SMOKE_PAGE_START: "2",
        OCR_SMOKE_PAGE_COUNT: "3",
        OCR_SMOKE_TOTAL_PAGES: "9",
        OCR_SMOKE_REQUIRE_ROWS: "true",
        OCR_SMOKE_FIELDS_JSON: JSON.stringify([
          {
            label: "Full Name",
            key: "name",
            type: "text",
            required: true,
            aliases: ["Student Name"],
          },
          {
            label: "Attendance Options",
            key: "attendance_options",
            type: "multi-select",
            options: ["Present", "Paid"],
          },
        ]),
      },
      process.cwd(),
    );
    const input = buildSmokeInput(config);

    assert.equal(config.provider, "azure");
    assert.equal(config.requireRows, true);
    assert.equal(input.document.fileName, "sample.pdf");
    assert.equal(input.document.fileType, "application/pdf");
    assert.equal(input.document.filePath, filePath);
    assert.deepEqual(input.options, {
      rowCount: 7,
      layout: "form",
      pageStart: 2,
      pageCount: 3,
      totalPages: 9,
    });
    assert.deepEqual(
      input.template.fields.map((field) => ({
        label: field.label,
        key: field.key,
        type: field.type,
        required: field.required,
        aliases: field.aliases,
        options: field.options,
      })),
      [
        {
          label: "Full Name",
          key: "name",
          type: "TEXT",
          required: true,
          aliases: ["Student Name"],
          options: [],
        },
        {
          label: "Attendance Options",
          key: "attendance_options",
          type: "MULTI_SELECT",
          required: false,
          aliases: [],
          options: ["Present", "Paid"],
        },
      ],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("OCR provider smoke summary omits extracted cell values", () => {
  const fields = [
    templateField({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
    }),
    templateField({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
    }),
  ];
  const summary = summarizeExtraction(
    {
      providerName: "http-ocr",
      rawOcrJson: { provider: "http-ocr", traceId: "trace_1" },
      rows: [
        {
          rowNumber: 1,
          sourcePage: 2,
          confidenceScore: 0.84,
          data: {
            name: "Ada Okafor",
            email: "ada@example.com",
          },
          values: [
            {
              field: fields[0],
              confidence: 0.92,
              issues: [],
            },
            {
              field: fields[1],
              confidence: 0.76,
              issues: ["Expected a valid email."],
            },
          ],
        },
      ],
      suggestedFields: [
        {
          key: "company",
          label: "Company",
          type: "text",
          confidence: 0.72,
          sampleValues: ["Apex Digital Lab"],
        },
      ],
    },
    fields,
    {
      provider: "http",
      fileName: "sample.pdf",
      fileType: "application/pdf",
      layout: "table",
      pageStart: 2,
      pageCount: 1,
    },
  );
  const serialized = JSON.stringify(summary);

  assert.equal(summary.rows.count, 1);
  assert.deepEqual(summary.rows.preview[0].populatedFields, ["name", "email"]);
  assert.equal(summary.rows.preview[0].issueCount, 1);
  assert.equal(summary.fields[1].issueCount, 1);
  assert.equal(summary.suggestedFields[0].sampleCount, 1);
  assert.equal(summary.rawOcrProvider, "http-ocr");
  assert.doesNotMatch(serialized, /Ada Okafor|ada@example.com|Apex Digital Lab/);
});

test("OCR provider smoke helper validates provider setup by variable name only", () => {
  assert.equal(normalizeProviderName("azure-document-intelligence"), "azure");
  assert.equal(normalizeProviderName("google-document-ai"), "google");
  assert.equal(normalizeProviderName("http"), "http");
  assert.equal(inferFileType("sheet.webp"), "image/webp");

  assert.throws(
    () =>
      validateProviderEnvironment("azure", {
        AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://example.test",
      }),
    /AZURE_DOCUMENT_INTELLIGENCE_KEY/,
  );
  assert.throws(
    () => validateProviderEnvironment("http", {}),
    /OCR_HTTP_ENDPOINT/,
  );
  assert.throws(
    () =>
      validateProviderEnvironment("google", {
        GOOGLE_DOCUMENT_AI_PROJECT_ID: "crowdlog-project",
        GOOGLE_DOCUMENT_AI_LOCATION: "us",
        GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "processor_1",
      }),
    /GOOGLE_DOCUMENT_AI_ACCESS_TOKEN/,
  );
});

function templateField(overrides) {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id: "field_test",
    templateId: "template_1",
    label: "Test Field",
    key: "test_field",
    type: "TEXT",
    required: false,
    sortOrder: 1,
    aliases: [],
    options: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
