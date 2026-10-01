const assert = require("node:assert/strict");
const test = require("node:test");

const { WindowsOcrProvider } = require("../dist/ocr/windows-ocr.provider");

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

function word(text, x, y, width = text.length * 8) {
  return {
    text,
    x,
    y,
    width,
    height: 18,
  };
}

function providerWithOcr(words) {
  const provider = new WindowsOcrProvider();

  provider.runWindowsOcr = async () => ({
    text: words.map((item) => item.text).join(" "),
    words,
  });

  return provider;
}

function extractionInput({ fields, layout = "form", rowCount = 10 }) {
  return {
    document: {
      id: "document_form",
      eventId: "event_1",
      fileName: "membership-form.png",
      fileType: "image/png",
      fileUrl: "/uploads/membership-form.png",
      filePath: "C:/uploads/membership-form.png",
    },
    template: {
      id: "template_1",
      name: "Membership form",
      fields,
    },
    options: {
      layout,
      rowCount,
      pageStart: 2,
    },
  };
}

test("windows OCR parses same-line form label and value pairs", async () => {
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
    field({
      id: "field_phone",
      label: "Phone",
      key: "phone",
      type: "PHONE",
      sortOrder: 3,
      aliases: ["Phone Number"],
    }),
    field({
      id: "field_signature",
      label: "Signature",
      key: "signature",
      type: "SIGNATURE",
      required: true,
      sortOrder: 4,
      aliases: ["Signed"],
    }),
  ];
  const provider = providerWithOcr([
    word("Name:", 32, 40, 48),
    word("Ada", 160, 40, 28),
    word("Okafor", 196, 40, 54),
    word("Email", 32, 78, 42),
    word("Ada", 160, 78, 28),
    word("at", 192, 78, 16),
    word("Example", 214, 78, 58),
    word("dot", 278, 78, 26),
    word("Com", 310, 78, 30),
    word("Phone", 32, 116, 44),
    word("O8O", 160, 116, 28),
    word("12S", 194, 116, 28),
    word("34S6", 228, 116, 38),
    word("Signature", 32, 154, 74),
    word("Signed", 160, 154, 52),
  ]);

  const result = await provider.extract(extractionInput({ fields }));

  assert.equal(result.providerName, "windows-ocr");
  assert.equal(result.rawOcrJson.mode, "form");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sourcePage, 2);
  assert.deepEqual(result.rows[0].data, {
    name: "Ada Okafor",
    email: "ada@example.com",
    phone: "0801253456",
    signature: true,
  });
  assert.ok(result.rows[0].confidenceScore > 0.8);
  assert.ok(result.rows[0].values.every((value) => value.boundingBox));
  assert.deepEqual(
    result.rawOcrJson.rows[0].fields.map((item) => item.key),
    ["name", "email", "phone", "signature"],
  );
});

test("windows OCR separates repeated form entries", async () => {
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
    }),
  ];
  const provider = providerWithOcr([
    word("Name", 32, 40, 42),
    word("Ada", 160, 40, 28),
    word("Okafor", 196, 40, 54),
    word("Email", 32, 78, 42),
    word("ada@example.com", 160, 78, 126),
    word("Name", 32, 196, 42),
    word("Tunde", 160, 196, 48),
    word("Balogun", 214, 196, 64),
    word("Email", 32, 234, 42),
    word("tunde@example.com", 160, 234, 142),
  ]);

  const result = await provider.extract(
    extractionInput({ fields, rowCount: 2 }),
  );

  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((row) => row.data),
    [
      { name: "Ada Okafor", email: "ada@example.com" },
      { name: "Tunde Balogun", email: "tunde@example.com" },
    ],
  );
  assert.deepEqual(
    result.rawOcrJson.rows.map((row) => row.formNumber),
    [1, 2],
  );
});
