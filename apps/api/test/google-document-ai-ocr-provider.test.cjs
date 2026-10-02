const assert = require("node:assert/strict");
const { mkdir, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

const {
  GoogleDocumentAiOcrProvider,
} = require("../dist/ocr/google-document-ai-ocr.provider");
const { ConfiguredOcrProvider } = require("../dist/ocr/configured-ocr.provider");

const now = new Date("2026-10-01T00:00:00.000Z");

function mockFn(implementation) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return implementation?.(...args);
  };

  fn.calls = calls;
  return fn;
}

function field(overrides) {
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

function extractionInput({ filePath, fields }) {
  return {
    document: {
      id: "document_1",
      eventId: "event_1",
      fileName: "attendance-sheet.pdf",
      fileType: "application/pdf",
      fileUrl: "/uploads/attendance-sheet.pdf",
      filePath,
    },
    template: {
      id: "template_1",
      name: "Attendance",
      fields,
    },
    options: {
      rowCount: 10,
      layout: "table",
      pageStart: 2,
      pageCount: 2,
      totalPages: 4,
    },
  };
}

test("Google Document AI OCR provider posts the document and maps table rows", async () => {
  const previousEnv = snapshotGoogleEnv();
  const previousFetch = global.fetch;
  const tempDir = join(process.cwd(), ".tmp", "google-document-ai-ocr-provider-test");
  const filePath = join(tempDir, "attendance-sheet.pdf");
  const calls = [];
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
    }),
    field({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: true,
      sortOrder: 2,
      aliases: ["Email Address"],
    }),
  ];

  await mkdir(tempDir, { recursive: true });
  await writeFile(filePath, "%PDF-1.7\n");

  process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID = "crowdlog-project";
  process.env.GOOGLE_DOCUMENT_AI_LOCATION = "us";
  process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = "processor_1";
  process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN = "google-test-token";
  process.env.GOOGLE_DOCUMENT_AI_FIELD_MASK =
    "text,pages.tables,pages.formFields,entities";
  delete process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION;
  delete process.env.GOOGLE_DOCUMENT_AI_ENDPOINT;
  delete process.env.GOOGLE_DOCUMENT_AI_SKIP_HUMAN_REVIEW;

  global.fetch = async (...args) => {
    calls.push(args);

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          document: {
            text:
              "Full Name\nEmail Address\nCompany\nAda Okafor\nAda at Example dot Com\nApex Digital Lab\n",
            pages: [
              {
                pageNumber: 2,
                tables: [
                  {
                    headerRows: [
                      {
                        cells: [
                          tableCell("Full Name", 0.96, 0.02, 0.02, 0.26, 0.06),
                          tableCell(
                            "Email Address",
                            0.94,
                            0.28,
                            0.02,
                            0.55,
                            0.06,
                          ),
                          tableCell("Company", 0.9, 0.58, 0.02, 0.84, 0.06),
                        ],
                      },
                    ],
                    bodyRows: [
                      {
                        cells: [
                          tableCell("Ada Okafor", 0.93, 0.02, 0.08, 0.26, 0.12),
                          tableCell(
                            "Ada at Example dot Com",
                            0.88,
                            0.28,
                            0.08,
                            0.55,
                            0.12,
                          ),
                          tableCell(
                            "Apex Digital Lab",
                            0.9,
                            0.58,
                            0.08,
                            0.84,
                            0.12,
                          ),
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
    };
  };

  try {
    const result = await new GoogleDocumentAiOcrProvider().extract(
      extractionInput({ filePath, fields }),
    );

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0][0],
      "https://us-documentai.googleapis.com/v1/projects/crowdlog-project/locations/us/processors/processor_1:process",
    );
    assert.equal(calls[0][1].method, "POST");
    assert.deepEqual(calls[0][1].headers, {
      Authorization: "Bearer google-test-token",
      "Content-Type": "application/json; charset=utf-8",
    });

    const payload = JSON.parse(calls[0][1].body);

    assert.equal(payload.skipHumanReview, true);
    assert.equal(payload.rawDocument.mimeType, "application/pdf");
    assert.equal(payload.rawDocument.content, Buffer.from("%PDF-1.7\n").toString("base64"));
    assert.equal(payload.fieldMask, "text,pages.tables,pages.formFields,entities");
    assert.deepEqual(payload.processOptions, {
      individualPageSelector: {
        pages: [2, 3],
      },
    });

    assert.equal(result.providerName, "google-document-ai");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].sourcePage, 2);
    assert.deepEqual(result.rows[0].data, {
      name: "Ada Okafor",
      email: "ada@example.com",
    });
    assert.equal(result.rows[0].values[0].boundingBox.pageNumber, 2);
    assert.equal(result.rows[0].values[0].boundingBox.normalized, true);
    assert.equal(result.rows[0].values[1].normalizedValue, "ada@example.com");
    assert.equal(result.suggestedFields.length, 1);
    assert.equal(result.suggestedFields[0].key, "company");
    assert.deepEqual(result.suggestedFields[0].sampleValues, [
      "Apex Digital Lab",
    ]);
    assert.equal(result.rawOcrJson.provider, "google-document-ai");
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Google Document AI OCR provider maps form fields when form layout is requested", async () => {
  const previousEnv = snapshotGoogleEnv();
  const previousFetch = global.fetch;
  const tempDir = join(
    process.cwd(),
    ".tmp",
    "google-document-ai-ocr-form-provider-test",
  );
  const filePath = join(tempDir, "attendance-form.png");
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
    }),
    field({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: true,
      sortOrder: 2,
      aliases: ["Email Address"],
    }),
  ];
  const input = extractionInput({ filePath, fields });

  input.document.fileName = "attendance-form.png";
  input.document.fileType = "image/png";
  input.document.fileUrl = "/uploads/attendance-form.png";
  input.options.layout = "form";

  await mkdir(tempDir, { recursive: true });
  await writeFile(filePath, "image-bytes");

  process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID = "crowdlog-project";
  process.env.GOOGLE_DOCUMENT_AI_LOCATION = "eu";
  process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = "processor_2";
  process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN = "google-test-token";

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        document: {
          text: "Full Name Ada Okafor Email Address Ada at Example dot Com",
          pages: [
            {
              pageNumber: 1,
              formFields: [
                formField("Full Name", "Ada Okafor", 0.91),
                formField("Email Address", "Ada at Example dot Com", 0.86),
              ],
            },
          ],
        },
      }),
  });

  try {
    const result = await new GoogleDocumentAiOcrProvider().extract(input);

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].sourcePage, 1);
    assert.deepEqual(result.rows[0].data, {
      name: "Ada Okafor",
      email: "ada@example.com",
    });
    assert.equal(result.rows[0].values[1].normalizedValue, "ada@example.com");
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("configured OCR provider uses explicit google mode", async () => {
  const previousEnv = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
  };
  const calls = [];
  const provider = new ConfiguredOcrProvider(
    providerThatShouldNotRun("mock"),
    providerThatShouldNotRun("windows"),
    providerThatShouldNotRun("http"),
    providerThatShouldNotRun("azure"),
    {
      extract: async (input) => {
        calls.push(input);

        return {
          providerName: "google-test",
          rawOcrJson: { provider: "google-test" },
          rows: [],
          suggestedFields: [],
        };
      },
    },
  );

  process.env.OCR_PROVIDER = "google";

  try {
    const result = await provider.extract(
      extractionInput({ filePath: undefined, fields: [] }),
    );

    assert.equal(result.providerName, "google-test");
    assert.equal(calls.length, 1);
  } finally {
    restoreEnv(previousEnv);
  }
});

test("configured OCR provider reports native PDF support when auto mode can use Google", () => {
  const previousEnv = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    GOOGLE_DOCUMENT_AI_PROJECT_ID: process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID,
    GOOGLE_DOCUMENT_AI_LOCATION: process.env.GOOGLE_DOCUMENT_AI_LOCATION,
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
    GOOGLE_DOCUMENT_AI_ACCESS_TOKEN: process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN,
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    AZURE_DOCUMENT_INTELLIGENCE_KEY:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
  };
  const googleProvider = {
    canReadPdfDirectly: mockFn((input) => {
      assert.equal(input.document.fileType, "application/pdf");

      return true;
    }),
    extract: async () => {
      throw new Error("google provider should not be called");
    },
  };
  const provider = new ConfiguredOcrProvider(
    providerThatShouldNotRun("mock"),
    providerThatShouldNotRun("windows"),
    {
      canReadPdfDirectly: () => false,
      extract: async () => {
        throw new Error("http provider should not be called");
      },
    },
    undefined,
    googleProvider,
  );
  const input = extractionInput({ filePath: "C:/uploads/attendance.pdf", fields: [] });

  process.env.OCR_PROVIDER = "auto";
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID = "crowdlog-project";
  process.env.GOOGLE_DOCUMENT_AI_LOCATION = "us";
  process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = "processor_1";
  process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN = "google-test-token";

  try {
    assert.equal(provider.canReadPdfDirectly(input), true);
    assert.equal(googleProvider.canReadPdfDirectly.calls.length, 1);
  } finally {
    restoreEnv(previousEnv);
  }
});

function tableCell(content, confidence, left, top, right, bottom) {
  return {
    layout: {
      textAnchor: {
        content,
      },
      confidence,
      boundingPoly: {
        normalizedVertices: [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
      },
    },
  };
}

function formField(label, value, confidence) {
  return {
    fieldName: {
      layout: {
        textAnchor: { content: label },
        confidence: 0.94,
      },
    },
    fieldValue: {
      layout: {
        textAnchor: { content: value },
        confidence,
        boundingPoly: {
          normalizedVertices: [
            { x: 0.2, y: 0.1 },
            { x: 0.6, y: 0.1 },
            { x: 0.6, y: 0.14 },
            { x: 0.2, y: 0.14 },
          ],
        },
      },
    },
  };
}

function providerThatShouldNotRun(name) {
  return {
    name,
    extract: async () => {
      throw new Error(`${name} provider should not be called`);
    },
  };
}

function snapshotGoogleEnv() {
  return {
    GOOGLE_DOCUMENT_AI_PROJECT_ID: process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID,
    GOOGLE_DOCUMENT_AI_LOCATION: process.env.GOOGLE_DOCUMENT_AI_LOCATION,
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
    GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION:
      process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION,
    GOOGLE_DOCUMENT_AI_ACCESS_TOKEN: process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN,
    GOOGLE_DOCUMENT_AI_ENDPOINT: process.env.GOOGLE_DOCUMENT_AI_ENDPOINT,
    GOOGLE_DOCUMENT_AI_FIELD_MASK: process.env.GOOGLE_DOCUMENT_AI_FIELD_MASK,
    GOOGLE_DOCUMENT_AI_SKIP_HUMAN_REVIEW:
      process.env.GOOGLE_DOCUMENT_AI_SKIP_HUMAN_REVIEW,
  };
}

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
