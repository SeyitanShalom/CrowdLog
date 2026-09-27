const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getOcrFieldTerms,
  normalizeNoisyOcrTerm,
  normalizeOcrCellValue,
} = require("../dist/ocr/ocr-value-normalization");

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
