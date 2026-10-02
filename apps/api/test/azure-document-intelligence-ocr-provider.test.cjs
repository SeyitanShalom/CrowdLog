const assert = require("node:assert/strict");
const { mkdir, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

const {
  AzureDocumentIntelligenceOcrProvider,
} = require("../dist/ocr/azure-document-intelligence-ocr.provider");
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
      layout: "table",
      pageStart: 2,
      pageCount: 1,
      totalPages: 4,
    },
  };
}

test("Azure Document Intelligence OCR provider posts the document and maps table rows", async () => {
  const previousEnv = {
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    AZURE_DOCUMENT_INTELLIGENCE_KEY:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
    AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID,
    AZURE_DOCUMENT_INTELLIGENCE_FEATURES:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_FEATURES,
    AZURE_DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS,
    AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS,
  };
  const previousFetch = global.fetch;
  const tempDir = join(
    process.cwd(),
    ".tmp",
    "azure-document-intelligence-ocr-provider-test",
  );
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

  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT =
    "https://crowdlog-test.cognitiveservices.azure.com";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "azure-test-key";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID = "prebuilt-layout";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_FEATURES = "keyValuePairs";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS = "0";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS = "1000";

  global.fetch = async (...args) => {
    calls.push(args);

    if (calls.length === 1) {
      return {
        ok: true,
        status: 202,
        headers: {
          get: (name) =>
            name.toLowerCase() === "operation-location"
              ? "https://crowdlog-test.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-layout/analyzeResults/result_1?api-version=2024-11-30"
              : null,
        },
        text: async () => "",
      };
    }

    return {
      ok: true,
      status: 200,
      headers: {
        get: () => null,
      },
      text: async () =>
        JSON.stringify({
          status: "succeeded",
          analyzeResult: {
            apiVersion: "2024-11-30",
            modelId: "prebuilt-layout",
            content:
              "Full Name Email Address Company\nAda Okafor Ada at Example dot Com Apex Digital Lab",
            tables: [
              {
                rowCount: 2,
                columnCount: 3,
                cells: [
                  {
                    kind: "columnHeader",
                    rowIndex: 0,
                    columnIndex: 0,
                    content: "Full Name",
                    boundingRegions: [
                      { pageNumber: 2, polygon: [10, 10, 100, 10, 100, 28, 10, 28] },
                    ],
                  },
                  {
                    kind: "columnHeader",
                    rowIndex: 0,
                    columnIndex: 1,
                    content: "Email Address",
                    boundingRegions: [
                      { pageNumber: 2, polygon: [110, 10, 240, 10, 240, 28, 110, 28] },
                    ],
                  },
                  {
                    kind: "columnHeader",
                    rowIndex: 0,
                    columnIndex: 2,
                    content: "Company",
                    boundingRegions: [
                      { pageNumber: 2, polygon: [250, 10, 360, 10, 360, 28, 250, 28] },
                    ],
                  },
                  {
                    rowIndex: 1,
                    columnIndex: 0,
                    content: "Ada Okafor",
                    confidence: 0.93,
                    boundingRegions: [
                      { pageNumber: 2, polygon: [10, 34, 100, 34, 100, 52, 10, 52] },
                    ],
                  },
                  {
                    rowIndex: 1,
                    columnIndex: 1,
                    content: "Ada at Example dot Com",
                    confidence: 0.88,
                    boundingRegions: [
                      { pageNumber: 2, polygon: [110, 34, 240, 34, 240, 52, 110, 52] },
                    ],
                  },
                  {
                    rowIndex: 1,
                    columnIndex: 2,
                    content: "Apex Digital Lab",
                    confidence: 0.9,
                    boundingRegions: [
                      { pageNumber: 2, polygon: [250, 34, 360, 34, 360, 52, 250, 52] },
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
    const result = await new AzureDocumentIntelligenceOcrProvider().extract(
      extractionInput({ filePath, fields }),
    );

    assert.equal(calls.length, 2);

    const analyzeUrl = new URL(calls[0][0]);

    assert.equal(
      analyzeUrl.origin,
      "https://crowdlog-test.cognitiveservices.azure.com",
    );
    assert.equal(
      analyzeUrl.pathname,
      "/documentintelligence/documentModels/prebuilt-layout:analyze",
    );
    assert.equal(analyzeUrl.searchParams.get("api-version"), "2024-11-30");
    assert.equal(analyzeUrl.searchParams.get("pages"), "2");
    assert.equal(analyzeUrl.searchParams.get("features"), "keyValuePairs");
    assert.equal(calls[0][1].method, "POST");
    assert.deepEqual(calls[0][1].headers, {
      "Content-Type": "image/png",
      "Ocp-Apim-Subscription-Key": "azure-test-key",
    });
    assert.equal(Buffer.from(calls[0][1].body).toString(), "image-bytes");

    assert.equal(
      calls[1][0],
      "https://crowdlog-test.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-layout/analyzeResults/result_1?api-version=2024-11-30",
    );
    assert.deepEqual(calls[1][1].headers, {
      "Ocp-Apim-Subscription-Key": "azure-test-key",
    });

    assert.equal(result.providerName, "azure-document-intelligence");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].sourcePage, 2);
    assert.deepEqual(result.rows[0].data, {
      name: "Ada Okafor",
      email: "ada@example.com",
    });
    assert.equal(result.rows[0].values[0].boundingBox.pageNumber, 2);
    assert.equal(result.rows[0].values[0].boundingBox.width, 90);
    assert.equal(result.rows[0].values[1].normalizedValue, "ada@example.com");
    assert.equal(result.suggestedFields.length, 1);
    assert.equal(result.suggestedFields[0].key, "company");
    assert.deepEqual(result.suggestedFields[0].sampleValues, [
      "Apex Digital Lab",
    ]);
    assert.equal(result.rawOcrJson.provider, "azure-document-intelligence");
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("configured OCR provider uses explicit azure mode", async () => {
  const previousEnv = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
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
    extract: async () => {
      throw new Error("http provider should not be called");
    },
  };
  const azureProvider = {
    extract: async (input) => {
      calls.push(input);

      return {
        providerName: "azure-test",
        rawOcrJson: { provider: "azure-test" },
        rows: [],
        suggestedFields: [],
      };
    },
  };
  const provider = new ConfiguredOcrProvider(
    mockProvider,
    windowsProvider,
    httpProvider,
    azureProvider,
  );

  process.env.OCR_PROVIDER = "azure";

  try {
    const result = await provider.extract(
      extractionInput({ filePath: undefined, fields: [] }),
    );

    assert.equal(result.providerName, "azure-test");
    assert.equal(calls.length, 1);
  } finally {
    restoreEnv(previousEnv);
  }
});

test("configured OCR provider reports native PDF support when auto mode can use Azure", async () => {
  const previousEnv = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    AZURE_DOCUMENT_INTELLIGENCE_KEY:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
  };
  const mockProvider = {
    canReadPdfDirectly: () => false,
    extract: async () => {
      throw new Error("mock provider should not be called");
    },
  };
  const windowsProvider = {
    canReadPdfDirectly: () => false,
    extract: async () => {
      throw new Error("windows provider should not be called");
    },
  };
  const httpProvider = {
    canReadPdfDirectly: () => false,
    extract: async () => {
      throw new Error("http provider should not be called");
    },
  };
  const azureProvider = {
    canReadPdfDirectly: mockFn((input) => {
      assert.equal(input.document.fileType, "application/pdf");

      return true;
    }),
    extract: async () => {
      throw new Error("azure provider should not be called");
    },
  };
  const provider = new ConfiguredOcrProvider(
    mockProvider,
    windowsProvider,
    httpProvider,
    azureProvider,
  );
  const input = extractionInput({ filePath: "C:/uploads/attendance.pdf", fields: [] });

  input.document.fileName = "attendance.pdf";
  input.document.fileType = "application/pdf";
  input.document.fileUrl = "/uploads/attendance.pdf";
  process.env.OCR_PROVIDER = "auto";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT =
    "https://crowdlog-test.cognitiveservices.azure.com";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "azure-test-key";

  try {
    assert.equal(provider.canReadPdfDirectly(input), true);
    assert.equal(azureProvider.canReadPdfDirectly.calls.length, 1);
  } finally {
    restoreEnv(previousEnv);
  }
});

test("configured OCR provider keeps fallback diagnostics when Azure fails in auto mode", async () => {
  const previousEnv = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    OCR_FALLBACK_TO_MOCK: process.env.OCR_FALLBACK_TO_MOCK,
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    AZURE_DOCUMENT_INTELLIGENCE_KEY:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
    OCR_HTTP_ENDPOINT: process.env.OCR_HTTP_ENDPOINT,
  };
  const mockProvider = {
    name: "mock",
    extract: mockFn(async () => ({
      providerName: "mock",
      rawOcrJson: { provider: "mock" },
      rows: [],
      suggestedFields: [],
    })),
  };
  const windowsProvider = {
    name: "windows-ocr",
    extract: async () => {
      throw new Error("windows provider should not be called");
    },
  };
  const httpProvider = {
    name: "http-ocr",
    canReadPdfDirectly: () => false,
    extract: async () => {
      throw new Error("http provider should not be called");
    },
  };
  const azureProvider = {
    name: "azure-document-intelligence",
    extract: mockFn(async () => {
      throw new Error(
        "Azure failed with api-key=secret-key authorization: Bearer secret-token",
      );
    }),
  };
  const provider = new ConfiguredOcrProvider(
    mockProvider,
    windowsProvider,
    httpProvider,
    azureProvider,
  );
  const input = extractionInput({ filePath: "C:/uploads/attendance.pdf", fields: [] });

  input.document.fileName = "attendance.pdf";
  input.document.fileType = "application/pdf";
  input.document.fileUrl = "/uploads/attendance.pdf";
  process.env.OCR_PROVIDER = "auto";
  delete process.env.OCR_FALLBACK_TO_MOCK;
  delete process.env.OCR_HTTP_ENDPOINT;
  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT =
    "https://crowdlog-test.cognitiveservices.azure.com";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "azure-test-key";

  try {
    const result = await provider.extract(input);

    assert.equal(azureProvider.extract.calls.length, 1);
    assert.equal(mockProvider.extract.calls.length, 1);
    assert.equal(result.providerName, "mock");
    assert.equal(result.rawOcrJson.provider, "configured-ocr");
    assert.equal(result.rawOcrJson.selectedProvider, "mock");
    assert.deepEqual(result.rawOcrJson.providerResult, { provider: "mock" });
    assert.equal(result.rawOcrJson.fallbackFailures.length, 1);
    assert.equal(
      result.rawOcrJson.fallbackFailures[0].provider,
      "azure-document-intelligence",
    );
    assert.match(
      result.rawOcrJson.fallbackFailures[0].message,
      /api-key=\[redacted\]/,
    );
    assert.match(
      result.rawOcrJson.fallbackFailures[0].message,
      /Bearer \[redacted\]/,
    );
    assert.doesNotMatch(
      result.rawOcrJson.fallbackFailures[0].message,
      /secret-key|secret-token/,
    );
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
