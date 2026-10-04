const assert = require("node:assert/strict");
const { mkdir, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

const {
  GoogleVisionOcrProvider,
} = require("../dist/ocr/google-vision-ocr.provider");
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

test("Google Vision OCR provider posts image bytes and maps table rows", async () => {
  const previousEnv = snapshotVisionEnv();
  const previousFetch = global.fetch;
  const tempDir = join(process.cwd(), ".tmp", "google-vision-ocr-provider-test");
  const filePath = join(tempDir, "attendance-sheet.png");
  const calls = [];
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
      aliases: ["Full Name"],
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

  process.env.GOOGLE_VISION_API_KEY = "vision-test-key";
  process.env.GOOGLE_VISION_MODEL = "builtin/stable";
  process.env.GOOGLE_VISION_LANGUAGE_HINTS = "en, yo";
  delete process.env.GOOGLE_VISION_ACCESS_TOKEN;
  delete process.env.GOOGLE_VISION_ENDPOINT;
  delete process.env.GOOGLE_VISION_FEATURE_TYPE;

  global.fetch = async (...args) => {
    calls.push(args);

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          responses: [
            {
              fullTextAnnotation: {
                text:
                  "Full Name Email Address Company\nAda Okafor Ada at Example dot Com Apex Digital Lab",
                pages: [
                  {
                    width: 420,
                    height: 180,
                    blocks: [
                      {
                        paragraphs: [
                          {
                            words: [
                              visionWord("Full", 10, 10, 44, 28, 0.96),
                              visionWord("Name", 48, 10, 90, 28, 0.96),
                              visionWord("Email", 120, 10, 166, 28, 0.94),
                              visionWord("Address", 170, 10, 238, 28, 0.94),
                              visionWord("Company", 318, 10, 388, 28, 0.9),
                              visionWord("Ada", 10, 42, 40, 60, 0.93),
                              visionWord("Okafor", 44, 42, 100, 60, 0.93),
                              visionWord("Ada", 120, 42, 150, 60, 0.89),
                              visionWord("at", 154, 42, 170, 60, 0.89),
                              visionWord("Example", 174, 42, 230, 60, 0.89),
                              visionWord("dot", 234, 42, 258, 60, 0.89),
                              visionWord("Com", 262, 42, 292, 60, 0.89),
                              visionWord("Apex", 318, 42, 360, 60, 0.9),
                              visionWord("Digital", 364, 42, 414, 60, 0.9),
                              visionWord("Lab", 418, 42, 444, 60, 0.9),
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }),
    };
  };

  try {
    const result = await new GoogleVisionOcrProvider().extract(
      extractionInput({ filePath, fields }),
    );

    assert.equal(calls.length, 1);

    const annotateUrl = new URL(calls[0][0]);

    assert.equal(annotateUrl.origin, "https://vision.googleapis.com");
    assert.equal(annotateUrl.pathname, "/v1/images:annotate");
    assert.equal(annotateUrl.searchParams.get("key"), "vision-test-key");
    assert.deepEqual(calls[0][1].headers, {
      "Content-Type": "application/json; charset=utf-8",
    });

    const payload = JSON.parse(calls[0][1].body);

    assert.equal(
      payload.requests[0].image.content,
      Buffer.from("image-bytes").toString("base64"),
    );
    assert.deepEqual(payload.requests[0].features, [
      {
        type: "DOCUMENT_TEXT_DETECTION",
        model: "builtin/stable",
      },
    ]);
    assert.deepEqual(payload.requests[0].imageContext, {
      languageHints: ["en", "yo"],
    });
    assert.equal(result.providerName, "google-vision");
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
    assert.equal(result.rawOcrJson.provider, "google-vision");
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Google Vision OCR provider maps simple label/value form rows", async () => {
  const previousEnv = snapshotVisionEnv();
  const previousFetch = global.fetch;
  const tempDir = join(
    process.cwd(),
    ".tmp",
    "google-vision-ocr-form-provider-test",
  );
  const filePath = join(tempDir, "attendance-form.png");
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
      aliases: ["Full Name"],
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
  const calls = [];

  input.options.layout = "form";
  await mkdir(tempDir, { recursive: true });
  await writeFile(filePath, "image-bytes");

  process.env.GOOGLE_VISION_ACCESS_TOKEN = "vision-test-token";
  process.env.GOOGLE_VISION_ENDPOINT = "https://us-vision.googleapis.com";
  delete process.env.GOOGLE_VISION_API_KEY;

  global.fetch = async (...args) => {
    calls.push(args);

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          responses: [
            {
              fullTextAnnotation: {
                text: "Full Name Ada Okafor\nEmail Address Ada at Example dot Com",
                pages: [
                  {
                    width: 420,
                    height: 180,
                    blocks: [
                      {
                        paragraphs: [
                          {
                            words: [
                              visionWord("Full", 10, 10, 44, 28, 0.95),
                              visionWord("Name", 48, 10, 90, 28, 0.95),
                              visionWord("Ada", 140, 10, 170, 28, 0.92),
                              visionWord("Okafor", 174, 10, 230, 28, 0.92),
                              visionWord("Email", 10, 42, 58, 60, 0.94),
                              visionWord("Address", 62, 42, 130, 60, 0.94),
                              visionWord("Ada", 180, 42, 210, 60, 0.88),
                              visionWord("at", 214, 42, 230, 60, 0.88),
                              visionWord("Example", 234, 42, 294, 60, 0.88),
                              visionWord("dot", 298, 42, 322, 60, 0.88),
                              visionWord("Com", 326, 42, 356, 60, 0.88),
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }),
    };
  };
  try {
    const result = await new GoogleVisionOcrProvider().extract(input);

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0][0],
      "https://us-vision.googleapis.com/v1/images:annotate",
    );
    assert.deepEqual(calls[0][1].headers, {
      Authorization: "Bearer vision-test-token",
      "Content-Type": "application/json; charset=utf-8",
    });
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0].data, {
      name: "Ada Okafor",
      email: "ada@example.com",
    });
    assert.equal(result.suggestedFields.length, 0);
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("configured OCR provider uses explicit google vision mode", async () => {
  const previousEnv = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
  };
  const calls = [];
  const provider = new ConfiguredOcrProvider(
    providerThatShouldNotRun("mock"),
    providerThatShouldNotRun("windows"),
    providerThatShouldNotRun("http"),
    providerThatShouldNotRun("azure"),
    providerThatShouldNotRun("google"),
    {
      extract: async (input) => {
        calls.push(input);

        return {
          providerName: "google-vision-test",
          rawOcrJson: { provider: "google-vision-test" },
          rows: [],
          suggestedFields: [],
        };
      },
    },
  );

  process.env.OCR_PROVIDER = "google-vision";

  try {
    const result = await provider.extract(
      extractionInput({ filePath: undefined, fields: [] }),
    );

    assert.equal(result.providerName, "google-vision-test");
    assert.equal(calls.length, 1);
  } finally {
    restoreEnv(previousEnv);
  }
});

test("configured OCR provider can use Google Vision during auto mode", async () => {
  const previousEnv = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY,
    GOOGLE_VISION_ACCESS_TOKEN: process.env.GOOGLE_VISION_ACCESS_TOKEN,
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    AZURE_DOCUMENT_INTELLIGENCE_KEY:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
    GOOGLE_DOCUMENT_AI_PROJECT_ID: process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID,
    GOOGLE_DOCUMENT_AI_LOCATION: process.env.GOOGLE_DOCUMENT_AI_LOCATION,
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
    GOOGLE_DOCUMENT_AI_ACCESS_TOKEN: process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN,
    OCR_HTTP_ENDPOINT: process.env.OCR_HTTP_ENDPOINT,
  };
  const googleVisionProvider = {
    name: "google-vision",
    extract: mockFn(async () => ({
      providerName: "google-vision-test",
      rawOcrJson: { provider: "google-vision-test" },
      rows: [],
      suggestedFields: [],
    })),
  };
  const provider = new ConfiguredOcrProvider(
    providerThatShouldNotRun("mock"),
    providerThatShouldNotRun("windows"),
    providerThatShouldNotRun("http"),
    undefined,
    undefined,
    googleVisionProvider,
  );

  process.env.OCR_PROVIDER = "auto";
  process.env.GOOGLE_VISION_API_KEY = "vision-test-key";
  delete process.env.GOOGLE_VISION_ACCESS_TOKEN;
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  delete process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID;
  delete process.env.GOOGLE_DOCUMENT_AI_LOCATION;
  delete process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  delete process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN;
  delete process.env.OCR_HTTP_ENDPOINT;

  try {
    const result = await provider.extract(
      extractionInput({ filePath: "C:/uploads/attendance.png", fields: [] }),
    );

    assert.equal(result.providerName, "google-vision-test");
    assert.equal(googleVisionProvider.extract.calls.length, 1);
  } finally {
    restoreEnv(previousEnv);
  }
});

function visionWord(text, left, top, right, bottom, confidence) {
  return {
    symbols: text.split("").map((letter) => ({
      text: letter,
      confidence,
    })),
    confidence,
    boundingBox: {
      vertices: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    },
  };
}

function providerThatShouldNotRun(name) {
  return {
    name,
    canReadPdfDirectly: () => false,
    extract: async () => {
      throw new Error(`${name} provider should not be called`);
    },
  };
}

function snapshotVisionEnv() {
  return {
    GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY,
    GOOGLE_VISION_ACCESS_TOKEN: process.env.GOOGLE_VISION_ACCESS_TOKEN,
    GOOGLE_VISION_ENDPOINT: process.env.GOOGLE_VISION_ENDPOINT,
    GOOGLE_VISION_FEATURE_TYPE: process.env.GOOGLE_VISION_FEATURE_TYPE,
    GOOGLE_VISION_MODEL: process.env.GOOGLE_VISION_MODEL,
    GOOGLE_VISION_LANGUAGE_HINTS: process.env.GOOGLE_VISION_LANGUAGE_HINTS,
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
