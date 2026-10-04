const assert = require("node:assert/strict");
const { mkdir, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

const {
  AwsTextractOcrProvider,
} = require("../dist/ocr/aws-textract-ocr.provider");
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
      pageCount: 1,
      totalPages: 4,
    },
  };
}

test("AWS Textract OCR provider signs AnalyzeDocument requests and maps table rows", async () => {
  const previousEnv = snapshotAwsEnv();
  const previousFetch = global.fetch;
  const tempDir = join(process.cwd(), ".tmp", "aws-textract-ocr-provider-test");
  const filePath = join(tempDir, "attendance-sheet.pdf");
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
  await writeFile(filePath, "%PDF-1.7\n");

  process.env.AWS_TEXTRACT_REGION = "us-east-1";
  process.env.AWS_TEXTRACT_ACCESS_KEY_ID = "AKIATESTACCESS";
  process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.AWS_TEXTRACT_SESSION_TOKEN = "test-session-token";
  delete process.env.AWS_TEXTRACT_ENDPOINT;
  delete process.env.AWS_TEXTRACT_FEATURE_TYPES;

  global.fetch = async (...args) => {
    calls.push(args);

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          AnalyzeDocumentModelVersion: "1.0",
          Blocks: [
            table("table_1", [
              "cell_h1",
              "cell_h2",
              "cell_h3",
              "cell_name",
              "cell_email",
              "cell_company",
            ]),
            cell("cell_h1", 1, 1, ["word_full", "word_name"], {
              entityTypes: ["COLUMN_HEADER"],
            }),
            cell("cell_h2", 1, 2, ["word_email", "word_address"], {
              entityTypes: ["COLUMN_HEADER"],
            }),
            cell("cell_h3", 1, 3, ["word_company"], {
              entityTypes: ["COLUMN_HEADER"],
            }),
            cell("cell_name", 2, 1, ["word_ada", "word_okafor"], {
              confidence: 93,
            }),
            cell(
              "cell_email",
              2,
              2,
              ["word_ada_email", "word_at", "word_example", "word_dot", "word_com"],
              { confidence: 88 },
            ),
            cell("cell_company", 2, 3, ["word_apex", "word_digital", "word_lab"], {
              confidence: 91,
            }),
            word("word_full", "Full"),
            word("word_name", "Name"),
            word("word_email", "Email"),
            word("word_address", "Address"),
            word("word_company", "Company"),
            word("word_ada", "Ada"),
            word("word_okafor", "Okafor"),
            word("word_ada_email", "Ada"),
            word("word_at", "at"),
            word("word_example", "Example"),
            word("word_dot", "dot"),
            word("word_com", "Com"),
            word("word_apex", "Apex"),
            word("word_digital", "Digital"),
            word("word_lab", "Lab"),
          ],
        }),
    };
  };

  try {
    const result = await new AwsTextractOcrProvider().extract(
      extractionInput({ filePath, fields }),
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "https://textract.us-east-1.amazonaws.com/");
    assert.equal(calls[0][1].method, "POST");
    assert.equal(
      calls[0][1].headers["content-type"],
      "application/x-amz-json-1.1",
    );
    assert.equal(calls[0][1].headers["x-amz-target"], "Textract.AnalyzeDocument");
    assert.equal(
      calls[0][1].headers["x-amz-security-token"],
      "test-session-token",
    );
    assert.match(
      calls[0][1].headers.authorization,
      /^AWS4-HMAC-SHA256 Credential=AKIATESTACCESS\/\d{8}\/us-east-1\/textract\/aws4_request, SignedHeaders=/,
    );

    const payload = JSON.parse(calls[0][1].body);

    assert.equal(payload.Document.Bytes, Buffer.from("%PDF-1.7\n").toString("base64"));
    assert.deepEqual(payload.FeatureTypes, ["TABLES", "FORMS"]);
    assert.equal(result.providerName, "aws-textract");
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
    assert.equal(result.rawOcrJson.provider, "aws-textract");
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("AWS Textract OCR provider maps form key-value pairs", async () => {
  const previousEnv = snapshotAwsEnv();
  const previousFetch = global.fetch;
  const tempDir = join(process.cwd(), ".tmp", "aws-textract-ocr-form-test");
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

  input.document.fileName = "attendance-form.png";
  input.document.fileType = "image/png";
  input.document.fileUrl = "/uploads/attendance-form.png";
  input.options.layout = "form";
  await mkdir(tempDir, { recursive: true });
  await writeFile(filePath, "image-bytes");

  process.env.AWS_REGION = "eu-west-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIAFORMACCESS";
  process.env.AWS_SECRET_ACCESS_KEY = "form-secret-key";
  delete process.env.AWS_TEXTRACT_REGION;
  delete process.env.AWS_TEXTRACT_ACCESS_KEY_ID;
  delete process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY;

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        Blocks: [
          keyValue("key_name", "KEY", ["word_full", "word_name"], ["value_name"]),
          keyValue("value_name", "VALUE", ["word_ada", "word_okafor"]),
          keyValue(
            "key_email",
            "KEY",
            ["word_email", "word_address"],
            ["value_email"],
          ),
          keyValue("value_email", "VALUE", [
            "word_ada_email",
            "word_at",
            "word_example",
            "word_dot",
            "word_com",
          ]),
          word("word_full", "Full"),
          word("word_name", "Name"),
          word("word_ada", "Ada"),
          word("word_okafor", "Okafor"),
          word("word_email", "Email"),
          word("word_address", "Address"),
          word("word_ada_email", "Ada"),
          word("word_at", "at"),
          word("word_example", "Example"),
          word("word_dot", "dot"),
          word("word_com", "Com"),
        ],
      }),
  });

  try {
    const result = await new AwsTextractOcrProvider().extract(input);

    assert.equal(result.rows.length, 1);
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

test("configured OCR provider uses explicit AWS Textract mode", async () => {
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
    providerThatShouldNotRun("google-vision"),
    {
      extract: async (input) => {
        calls.push(input);

        return {
          providerName: "aws-textract-test",
          rawOcrJson: { provider: "aws-textract-test" },
          rows: [],
          suggestedFields: [],
        };
      },
    },
  );

  process.env.OCR_PROVIDER = "textract";

  try {
    const result = await provider.extract(
      extractionInput({ filePath: undefined, fields: [] }),
    );

    assert.equal(result.providerName, "aws-textract-test");
    assert.equal(calls.length, 1);
  } finally {
    restoreEnv(previousEnv);
  }
});

test("configured OCR provider reports native PDF support when auto mode can use AWS Textract", () => {
  const previousEnv = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    AWS_TEXTRACT_REGION: process.env.AWS_TEXTRACT_REGION,
    AWS_TEXTRACT_ACCESS_KEY_ID: process.env.AWS_TEXTRACT_ACCESS_KEY_ID,
    AWS_TEXTRACT_SECRET_ACCESS_KEY: process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY,
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    AZURE_DOCUMENT_INTELLIGENCE_KEY:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
    GOOGLE_DOCUMENT_AI_PROJECT_ID: process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID,
    GOOGLE_DOCUMENT_AI_LOCATION: process.env.GOOGLE_DOCUMENT_AI_LOCATION,
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
    GOOGLE_DOCUMENT_AI_ACCESS_TOKEN: process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN,
  };
  const awsProvider = {
    canReadPdfDirectly: mockFn((input) => {
      assert.equal(input.document.fileType, "application/pdf");

      return true;
    }),
    extract: async () => {
      throw new Error("aws provider should not be called");
    },
  };
  const provider = new ConfiguredOcrProvider(
    providerThatShouldNotRun("mock"),
    providerThatShouldNotRun("windows"),
    providerThatShouldNotRun("http"),
    undefined,
    undefined,
    undefined,
    awsProvider,
  );
  const input = extractionInput({
    filePath: "C:/uploads/attendance.pdf",
    fields: [],
  });

  process.env.OCR_PROVIDER = "auto";
  process.env.AWS_TEXTRACT_REGION = "us-east-1";
  process.env.AWS_TEXTRACT_ACCESS_KEY_ID = "AKIATESTACCESS";
  process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY = "test-secret-key";
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  delete process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID;
  delete process.env.GOOGLE_DOCUMENT_AI_LOCATION;
  delete process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  delete process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN;

  try {
    assert.equal(provider.canReadPdfDirectly(input), true);
    assert.equal(awsProvider.canReadPdfDirectly.calls.length, 1);
  } finally {
    restoreEnv(previousEnv);
  }
});

function table(id, cellIds) {
  return {
    BlockType: "TABLE",
    Id: id,
    Relationships: [{ Type: "CHILD", Ids: cellIds }],
  };
}

function cell(id, rowIndex, columnIndex, childIds, overrides = {}) {
  return {
    BlockType: "CELL",
    Id: id,
    RowIndex: rowIndex,
    ColumnIndex: columnIndex,
    Confidence: overrides.confidence ?? 96,
    EntityTypes: overrides.entityTypes ?? [],
    Page: 2,
    Geometry: {
      BoundingBox: {
        Left: columnIndex * 0.2,
        Top: rowIndex * 0.1,
        Width: 0.16,
        Height: 0.04,
      },
      Polygon: [],
    },
    Relationships: [{ Type: "CHILD", Ids: childIds }],
  };
}

function keyValue(id, entityType, childIds, valueIds = []) {
  const relationships = [{ Type: "CHILD", Ids: childIds }];

  if (valueIds.length > 0) {
    relationships.push({ Type: "VALUE", Ids: valueIds });
  }

  return {
    BlockType: "KEY_VALUE_SET",
    Id: id,
    EntityTypes: [entityType],
    Confidence: 91,
    Page: 1,
    Geometry: {
      BoundingBox: {
        Left: 0.1,
        Top: 0.2,
        Width: 0.3,
        Height: 0.04,
      },
      Polygon: [],
    },
    Relationships: relationships,
  };
}

function word(id, text) {
  return {
    BlockType: "WORD",
    Id: id,
    Text: text,
    Confidence: 97,
    Page: 2,
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

function snapshotAwsEnv() {
  return {
    AWS_TEXTRACT_REGION: process.env.AWS_TEXTRACT_REGION,
    AWS_TEXTRACT_ACCESS_KEY_ID: process.env.AWS_TEXTRACT_ACCESS_KEY_ID,
    AWS_TEXTRACT_SECRET_ACCESS_KEY:
      process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY,
    AWS_TEXTRACT_SESSION_TOKEN: process.env.AWS_TEXTRACT_SESSION_TOKEN,
    AWS_TEXTRACT_ENDPOINT: process.env.AWS_TEXTRACT_ENDPOINT,
    AWS_TEXTRACT_FEATURE_TYPES: process.env.AWS_TEXTRACT_FEATURE_TYPES,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
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
