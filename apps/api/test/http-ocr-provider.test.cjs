const assert = require("node:assert/strict");
const { mkdir, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

const { ConfiguredOcrProvider } = require("../dist/ocr/configured-ocr.provider");
const { HttpOcrProvider } = require("../dist/ocr/http-ocr.provider");

const now = new Date("2026-10-01T00:00:00.000Z");

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
      fileName: "attendance-sheet.png",
      fileType: "image/png",
      fileUrl: "/uploads/attendance-sheet.png",
      filePath,
    },
    template: {
      id: "template_1",
      name: "Attendance",
      fields,
    },
    options: {
      rowCount: 10,
      layout: "form",
      pageStart: 2,
      pageCount: 1,
      totalPages: 4,
    },
  };
}

test("http OCR provider posts document content and maps provider rows", async () => {
  const previousEnv = {
    OCR_HTTP_ENDPOINT: process.env.OCR_HTTP_ENDPOINT,
    OCR_HTTP_BEARER_TOKEN: process.env.OCR_HTTP_BEARER_TOKEN,
    OCR_HTTP_INCLUDE_FILE: process.env.OCR_HTTP_INCLUDE_FILE,
  };
  const previousFetch = global.fetch;
  const tempDir = join(process.cwd(), ".tmp", "http-ocr-provider-test");
  const filePath = join(tempDir, "attendance-sheet.png");
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
  await writeFile(filePath, "image-bytes");

  process.env.OCR_HTTP_ENDPOINT = "https://ocr-provider.example/extract";
  process.env.OCR_HTTP_BEARER_TOKEN = "ocr-test-token";
  delete process.env.OCR_HTTP_INCLUDE_FILE;
  global.fetch = async (...args) => {
    calls.push(args);

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          providerName: "cloud-test",
          rawOcrJson: {
            provider: "cloud-test",
            pageCount: 1,
          },
          rows: [
            {
              rowNumber: 4,
              sourcePage: 2,
              data: {
                name: "Ada Okafor",
                email: "Ada at Example dot Com",
              },
              values: [
                {
                  fieldKey: "name",
                  rawValue: "Ada Okafor",
                  confidence: 0.91,
                  boundingBox: { x: 10, y: 20, width: 90, height: 18 },
                },
              ],
            },
          ],
          suggestedFields: [
            {
              label: "Company",
              key: "company",
              type: "text",
              aliases: ["Organization"],
              options: [],
              sampleValues: ["Apex Digital Lab"],
              confidence: 0.7,
            },
          ],
        }),
    };
  };

  try {
    const result = await new HttpOcrProvider().extract(
      extractionInput({ filePath, fields }),
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "https://ocr-provider.example/extract");
    assert.equal(calls[0][1].method, "POST");
    assert.deepEqual(calls[0][1].headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer ocr-test-token",
    });

    const payload = JSON.parse(calls[0][1].body);

    assert.equal(payload.type, "crowdlog_ocr_extraction");
    assert.equal(payload.document.fileName, "attendance-sheet.png");
    assert.equal(payload.document.contentEncoding, "base64");
    assert.equal(
      payload.document.fileBase64,
      Buffer.from("image-bytes").toString("base64"),
    );
    assert.equal(payload.document.fileSize, 11);
    assert.deepEqual(
      payload.template.fields.map((item) => ({
        key: item.key,
        type: item.type,
        aliases: item.aliases,
      })),
      [
        { key: "name", type: "TEXT", aliases: [] },
        { key: "email", type: "EMAIL", aliases: ["Email Address"] },
      ],
    );
    assert.deepEqual(payload.options, {
      rowCount: 10,
      layout: "form",
      pageStart: 2,
      pageCount: 1,
      totalPages: 4,
    });

    assert.equal(result.providerName, "cloud-test");
    assert.deepEqual(result.rawOcrJson, {
      provider: "cloud-test",
      pageCount: 1,
    });
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0].data, {
      name: "Ada Okafor",
      email: "ada@example.com",
    });
    assert.equal(result.rows[0].rowNumber, 4);
    assert.equal(result.rows[0].sourcePage, 2);
    assert.equal(result.rows[0].values[0].field.id, "field_name");
    assert.deepEqual(result.rows[0].values[0].boundingBox, {
      x: 10,
      y: 20,
      width: 90,
      height: 18,
    });
    assert.equal(result.rows[0].values[1].normalizedValue, "ada@example.com");
    assert.equal(result.suggestedFields[0].key, "company");
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("http OCR provider advertises direct PDF support only when enabled", () => {
  const previousEnv = {
    OCR_HTTP_ENDPOINT: process.env.OCR_HTTP_ENDPOINT,
    OCR_HTTP_DIRECT_PDF: process.env.OCR_HTTP_DIRECT_PDF,
  };
  const provider = new HttpOcrProvider();
  const input = extractionInput({
    filePath: "C:/uploads/attendance.pdf",
    fields: [],
  });

  input.document.fileName = "attendance.pdf";
  input.document.fileType = "application/pdf";
  input.document.fileUrl = "/uploads/attendance.pdf";
  process.env.OCR_HTTP_ENDPOINT = "https://ocr-provider.example/extract";
  delete process.env.OCR_HTTP_DIRECT_PDF;

  try {
    assert.equal(provider.canReadPdfDirectly(input), false);

    process.env.OCR_HTTP_DIRECT_PDF = "true";
    assert.equal(provider.canReadPdfDirectly(input), true);

    input.document.fileType = "image/png";
    assert.equal(provider.canReadPdfDirectly(input), false);
  } finally {
    restoreEnv(previousEnv);
  }
});

test("configured OCR provider uses explicit http mode", async () => {
  const previousEnv = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    OCR_HTTP_ENDPOINT: process.env.OCR_HTTP_ENDPOINT,
  };
  const calls = [];
  const mockProvider = {
    extract: async () => {
      throw new Error("mock provider should not be called");
    },
  };
  const windowsProvider = {
    extract: async () => {
      throw new Error("windows provider should not be called");
    },
  };
  const httpProvider = {
    extract: async (input) => {
      calls.push(input);

      return {
        providerName: "http-test",
        rawOcrJson: { provider: "http-test" },
        rows: [],
        suggestedFields: [],
      };
    },
  };
  const provider = new ConfiguredOcrProvider(
    mockProvider,
    windowsProvider,
    httpProvider,
  );

  process.env.OCR_PROVIDER = "http";
  delete process.env.OCR_HTTP_ENDPOINT;

  try {
    const result = await provider.extract(
      extractionInput({ filePath: undefined, fields: [] }),
    );

    assert.equal(result.providerName, "http-test");
    assert.equal(calls.length, 1);
  } finally {
    restoreEnv(previousEnv);
  }
});

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
