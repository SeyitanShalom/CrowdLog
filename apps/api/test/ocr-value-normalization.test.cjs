const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getOcrFieldTerms,
  normalizeNoisyOcrTerm,
  normalizeOcrCellValue,
} = require("../dist/ocr/ocr-value-normalization");
const { MockOcrProvider } = require("../dist/ocr/mock-ocr.provider");

function field(overrides) {
  return {
    id: "field_test",
    templateId: "template_test",
    label: "Test Field",
    key: "test_field",
    type: "TEXT",
    required: false,
    sortOrder: 1,
    aliases: [],
    options: [],
    createdAt: new Date("2026-09-27T00:00:00.000Z"),
    updatedAt: new Date("2026-09-27T00:00:00.000Z"),
    ...overrides,
  };
}

test("adds common attendance aliases for matric fields", () => {
  const terms = getOcrFieldTerms(
    field({
      label: "Matric Number",
      key: "matric_number",
      aliases: ["Registration No"],
    }),
  );

  assert.ok(terms.includes("matricno"));
  assert.ok(terms.includes("regno"));
  assert.ok(terms.includes("studentid"));
});

test("normalizes noisy OCR terms used in low-resolution headers", () => {
  assert.equal(normalizeNoisyOcrTerm("Matr1c N0."), "matricno");
  assert.equal(normalizeNoisyOcrTerm("Ema1l Addre55"), "emailaddress");
});

test("normalizes OCR-friendly email text", () => {
  const result = normalizeOcrCellValue(
    field({ label: "Email", key: "email", type: "EMAIL", required: true }),
    "Ada at Example dot Com",
  );

  assert.equal(result.normalizedValue, "ada@example.com");
  assert.deepEqual(result.issues, []);
  assert.ok(result.confidence > 0.9);
});

test("repairs common low-resolution email punctuation", () => {
  const result = normalizeOcrCellValue(
    field({ label: "Email", key: "email", type: "EMAIL", required: true }),
    "Ada [at] Example dot c0m",
  );

  assert.equal(result.normalizedValue, "ada@example.com");
  assert.deepEqual(result.issues, []);
});

test("flags invalid required email values", () => {
  const result = normalizeOcrCellValue(
    field({ label: "Email", key: "email", type: "EMAIL", required: true }),
    "ada.example.com",
  );

  assert.equal(result.normalizedValue, "ada.example.com");
  assert.deepEqual(result.issues, ["Expected an email address."]);
  assert.ok(result.confidence <= 0.5);
});

test("cleans OCR number confusions", () => {
  const result = normalizeOcrCellValue(
    field({ label: "Score", key: "score", type: "NUMBER" }),
    "O1,234",
  );

  assert.equal(result.normalizedValue, 1234);
  assert.deepEqual(result.issues, []);
});

test("cleans noisy phone number glyphs", () => {
  const result = normalizeOcrCellValue(
    field({ label: "Phone", key: "phone", type: "PHONE" }),
    "O8O 12S 34S6",
  );

  assert.equal(result.normalizedValue, "0801253456");
  assert.deepEqual(result.issues, []);
});

test("normalizes local date text to ISO date input format", () => {
  const result = normalizeOcrCellValue(
    field({ label: "Date", key: "date", type: "DATE" }),
    "17/09/26",
  );

  assert.equal(result.normalizedValue, "2026-09-17");
  assert.deepEqual(result.issues, []);
});

test("fuzzy-matches select options", () => {
  const result = normalizeOcrCellValue(
    field({
      label: "Taxa",
      key: "taxa",
      type: "SELECT",
      options: ["Bird", "Rodent"],
    }),
    "Birds",
  );

  assert.equal(result.normalizedValue, "Bird");
  assert.deepEqual(result.issues, []);
});

test("fuzzy-matches noisy select options", () => {
  const result = normalizeOcrCellValue(
    field({
      label: "Taxa",
      key: "taxa",
      type: "SELECT",
      options: ["Bird", "Rodent"],
    }),
    "R0dent",
  );

  assert.equal(result.normalizedValue, "Rodent");
  assert.deepEqual(result.issues, []);
});

test("preserves multiple checked select options for review", () => {
  const result = normalizeOcrCellValue(
    field({
      label: "Attendance",
      key: "attendance",
      type: "SELECT",
      required: true,
      options: ["Present", "Absent", "Excused"],
    }),
    "Present, Excused",
  );

  assert.equal(result.normalizedValue, "Present, Excused");
  assert.deepEqual(result.issues, [
    "Multiple selected options for a single-select field.",
  ]);
  assert.ok(result.confidence < 0.75);
});

test("accepts multiple checked options for multi-select fields", () => {
  const result = normalizeOcrCellValue(
    field({
      label: "Attendance Tags",
      key: "attendance_tags",
      type: "MULTI_SELECT",
      required: true,
      options: ["Present", "Remote", "Excused"],
    }),
    "Present, Remote",
  );

  assert.equal(result.normalizedValue, "Present, Remote");
  assert.deepEqual(result.issues, []);
  assert.ok(result.confidence >= 0.9);
});

test("flags missing required signatures", () => {
  const result = normalizeOcrCellValue(
    field({
      label: "Signature",
      key: "signature",
      type: "SIGNATURE",
      required: true,
    }),
    "",
  );

  assert.equal(result.normalizedValue, false);
  assert.deepEqual(result.issues, ["Missing required value."]);
  assert.ok(result.confidence < 0.5);
});

test("mock OCR emits page-aware rows for multi-page document options", async () => {
  const provider = new MockOcrProvider();
  const result = await provider.extract({
    document: {
      id: "document_pdf",
      eventId: "event_1",
      fileName: "attendance.pdf",
      fileType: "application/pdf",
      fileUrl: "/uploads/attendance.pdf",
    },
    template: {
      id: "template_1",
      name: "Attendance",
      fields: [
        field({
          id: "field_name",
          label: "Name",
          key: "name",
          type: "TEXT",
        }),
      ],
    },
    options: {
      rowCount: 2,
      pageStart: 2,
      pageCount: 3,
      totalPages: 5,
    },
  });

  assert.equal(result.rows.length, 6);
  assert.deepEqual(
    result.rows.map((row) => row.sourcePage),
    [2, 2, 3, 3, 4, 4],
  );
  assert.deepEqual(result.rawOcrJson.pages, {
    start: 2,
    count: 3,
    total: 5,
  });
});

test("mock OCR emits form-style rows when requested", async () => {
  const provider = new MockOcrProvider();
  const result = await provider.extract({
    document: {
      id: "document_form",
      eventId: "event_1",
      fileName: "membership-form.png",
      fileType: "image/png",
      fileUrl: "/uploads/membership-form.png",
    },
    template: {
      id: "template_1",
      name: "Attendance",
      fields: [
        field({
          id: "field_name",
          label: "Name",
          key: "name",
          type: "TEXT",
        }),
        field({
          id: "field_email",
          label: "Email",
          key: "email",
          type: "EMAIL",
          sortOrder: 2,
        }),
      ],
    },
    options: {
      rowCount: 3,
      layout: "form",
    },
  });

  assert.equal(result.rows.length, 3);
  assert.equal(result.rawOcrJson.mode, "form");
  assert.equal(result.rawOcrJson.rows[0].formNumber, 1);
  assert.deepEqual(
    result.rawOcrJson.rows[0].fields.map((formField) => formField.key),
    ["name", "email"],
  );
  assert.ok(result.rows[0].values[0].boundingBox);
});
