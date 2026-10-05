const assert = require("node:assert/strict");
const { mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

const {
  buildSmokeInput,
  inferFileType,
  normalizeProviderName,
  readSmokeConfig,
  readSmokeRunConfigs,
  runSmokeCheck,
  runSmokeChecks,
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
        OCR_SMOKE_SUMMARY_FILE: join(tempDir, "summary.json"),
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
    assert.equal(config.summaryFilePath, join(tempDir, "summary.json"));
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

test("OCR provider smoke check writes a sanitized summary artifact", async () => {
  const tempDir = join(process.cwd(), ".tmp", "ocr-provider-smoke-summary-test");
  const summaryPath = join(tempDir, "nested", "summary.json");
  const field = templateField({ key: "name", label: "Name" });
  const previousVisionApiKey = process.env.GOOGLE_VISION_API_KEY;

  try {
    process.env.GOOGLE_VISION_API_KEY = "vision-test-key";

    const summary = await runSmokeCheck(
      {
        provider: "google-vision",
        filePath: join(tempDir, "sample.png"),
        fileName: "sample.png",
        fileType: "image/png",
        fields: [field],
        layout: "table",
        rowCount: 10,
        pageStart: 1,
        pageCount: 1,
        requireRows: true,
        summaryFilePath: summaryPath,
      },
      () => ({
        extract: async () => ({
          providerName: "google-vision",
          rows: [
            {
              rowNumber: 1,
              data: { name: "Nneka Bello" },
              values: [
                {
                  field,
                  confidence: 0.9,
                  issues: [],
                },
              ],
            },
          ],
          suggestedFields: [
            {
              key: "department",
              label: "Department",
              type: "text",
              sampleValues: ["Computer Science"],
            },
          ],
        }),
      }),
    );
    const written = await readFile(summaryPath, "utf8");
    const parsed = JSON.parse(written);

    assert.equal(summary.rows.count, 1);
    assert.equal(parsed.provider, "google-vision");
    assert.equal(parsed.rows.count, 1);
    assert.deepEqual(parsed.rows.preview[0].populatedFields, ["name"]);
    assert.doesNotMatch(written, /Nneka Bello|Computer Science/);
  } finally {
    if (previousVisionApiKey === undefined) {
      delete process.env.GOOGLE_VISION_API_KEY;
    } else {
      process.env.GOOGLE_VISION_API_KEY = previousVisionApiKey;
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});

test("OCR provider smoke matrix config builds repeated provider runs", async () => {
  const tempDir = join(process.cwd(), ".tmp", "ocr-provider-smoke-matrix-config-test");
  const pdfPath = join(tempDir, "sample.pdf");
  const imagePath = join(tempDir, "sample.png");

  await mkdir(tempDir, { recursive: true });
  await writeFile(pdfPath, "%PDF-1.7\n");
  await writeFile(imagePath, "png");

  try {
    const configs = readSmokeRunConfigs(
      {
        OCR_SMOKE_RUNS_JSON: JSON.stringify([
          {
            name: "Azure table sample",
            provider: "azure",
            file: pdfPath,
            pageCount: 2,
            summaryFile: join(tempDir, "azure-summary.json"),
          },
          {
            name: "Vision image sample",
            provider: "vision",
            file: imagePath,
            fileType: "image/png",
            layout: "form",
            fields: [
              {
                label: "Name",
                key: "name",
                type: "text",
                required: true,
              },
            ],
          },
        ]),
      },
      process.cwd(),
    );

    assert.equal(configs.length, 2);
    assert.equal(configs[0].runName, "Azure table sample");
    assert.equal(configs[0].provider, "azure");
    assert.equal(configs[0].pageCount, 2);
    assert.equal(configs[0].summaryFilePath, join(tempDir, "azure-summary.json"));
    assert.equal(configs[1].runName, "Vision image sample");
    assert.equal(configs[1].provider, "google-vision");
    assert.equal(configs[1].fileType, "image/png");
    assert.equal(configs[1].layout, "form");
    assert.deepEqual(
      configs[1].fields.map((field) => ({
        key: field.key,
        type: field.type,
        required: field.required,
      })),
      [{ key: "name", type: "TEXT", required: true }],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("OCR provider smoke matrix captures redacted provider failures", async () => {
  const tempDir = join(process.cwd(), ".tmp", "ocr-provider-smoke-matrix-test");
  const summaryPath = join(tempDir, "matrix-summary.json");
  const field = templateField({ key: "name", label: "Name" });
  const previousVisionApiKey = process.env.GOOGLE_VISION_API_KEY;
  const previousHttpEndpoint = process.env.OCR_HTTP_ENDPOINT;

  try {
    process.env.GOOGLE_VISION_API_KEY = "vision-test-key";
    process.env.OCR_HTTP_ENDPOINT = "https://ocr-provider.example/extract";

    const matrixSummary = await runSmokeChecks(
      [
        {
          runName: "vision-image",
          provider: "google-vision",
          fileName: "sample.png",
          fileType: "image/png",
          fields: [field],
          layout: "table",
          rowCount: 10,
          pageStart: 1,
          pageCount: 1,
          requireRows: true,
        },
        {
          runName: "http-pdf",
          provider: "http",
          fileName: "sample.pdf",
          fileType: "application/pdf",
          fields: [field],
          layout: "table",
          rowCount: 10,
          pageStart: 1,
          pageCount: 1,
          requireRows: true,
        },
      ],
      (provider) => ({
        extract: async () => {
          if (provider === "http") {
            throw new Error(
              "HTTP OCR failed authorization: Bearer http-token api_key=http-secret",
            );
          }

          return {
            providerName: "google-vision",
            rawOcrJson: { provider: "google-vision" },
            rows: [
              {
                rowNumber: 1,
                data: { name: "Ada Okafor" },
                values: [
                  {
                    field,
                    confidence: 0.88,
                    issues: [],
                  },
                ],
                confidenceScore: 0.88,
              },
            ],
            suggestedFields: [],
          };
        },
      }),
      {
        continueOnError: true,
        summaryFilePath: summaryPath,
      },
    );
    const written = await readFile(summaryPath, "utf8");

    assert.equal(matrixSummary.ok, false);
    assert.equal(matrixSummary.runCount, 2);
    assert.equal(matrixSummary.passed, 1);
    assert.equal(matrixSummary.failed, 1);
    assert.equal(matrixSummary.runs[0].ok, true);
    assert.equal(matrixSummary.runs[1].ok, false);
    assert.equal(matrixSummary.runs[1].requestedProvider, "http");
    assert.match(matrixSummary.runs[1].error.message, /Bearer \[redacted\]/);
    assert.match(matrixSummary.runs[1].error.message, /api_key=\[redacted\]/);
    assert.doesNotMatch(written, /Ada Okafor|http-token|http-secret/);
  } finally {
    if (previousVisionApiKey === undefined) {
      delete process.env.GOOGLE_VISION_API_KEY;
    } else {
      process.env.GOOGLE_VISION_API_KEY = previousVisionApiKey;
    }

    if (previousHttpEndpoint === undefined) {
      delete process.env.OCR_HTTP_ENDPOINT;
    } else {
      process.env.OCR_HTTP_ENDPOINT = previousHttpEndpoint;
    }

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
  assert.equal(normalizeProviderName("textract"), "aws-textract");
  assert.equal(normalizeProviderName("aws"), "aws-textract");
  assert.equal(normalizeProviderName("google-document-ai"), "google");
  assert.equal(normalizeProviderName("google-cloud-vision"), "google-vision");
  assert.equal(normalizeProviderName("vision"), "google-vision");
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
  assert.throws(
    () => validateProviderEnvironment("google-vision", {}),
    /GOOGLE_VISION_API_KEY or GOOGLE_VISION_ACCESS_TOKEN/,
  );
  assert.throws(
    () =>
      validateProviderEnvironment("aws-textract", {
        AWS_TEXTRACT_REGION: "us-east-1",
        AWS_TEXTRACT_ACCESS_KEY_ID: "AKIATESTACCESS",
      }),
    /AWS_TEXTRACT_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY/,
  );
  assert.doesNotThrow(() =>
    validateProviderEnvironment("aws-textract", {
      AWS_TEXTRACT_REGION: "us-east-1",
      AWS_TEXTRACT_ACCESS_KEY_ID: "AKIATESTACCESS",
      AWS_TEXTRACT_SECRET_ACCESS_KEY: "test-secret-key",
    }),
  );
  assert.doesNotThrow(() =>
    validateProviderEnvironment("google-vision", {
      GOOGLE_VISION_API_KEY: "vision-test-key",
    }),
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
