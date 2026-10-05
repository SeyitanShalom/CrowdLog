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

test("windows OCR parses compact inline form label-value tokens", async () => {
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
    field({
      id: "field_phone",
      label: "Phone",
      key: "phone",
      type: "PHONE",
      sortOrder: 3,
    }),
    field({
      id: "field_signature",
      label: "Signature",
      key: "signature",
      type: "SIGNATURE",
      required: true,
      sortOrder: 4,
    }),
  ];
  const provider = providerWithOcr([
    word("Name:Ada", 32, 40, 72),
    word("Okafor", 112, 40, 54),
    word("Email:ada@example.com", 32, 78, 166),
    word("Phone:O8O", 32, 116, 76),
    word("12S", 116, 116, 28),
    word("34S6", 150, 116, 38),
    word("Signature:Yes", 32, 154, 108),
  ]);

  const result = await provider.extract(extractionInput({ fields }));
  const nameValue = result.rows[0].values.find(
    (value) => value.field.key === "name",
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].data, {
    name: "Ada Okafor",
    email: "ada@example.com",
    phone: "0801253456",
    signature: true,
  });
  assert.equal(nameValue.rawValue, "Ada Okafor");
  assert.ok(nameValue.boundingBox);
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

test("windows OCR captures wrapped form values and signature checkbox marks", async () => {
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
    }),
    field({
      id: "field_address",
      label: "Address",
      key: "address",
      type: "TEXT",
      required: true,
      sortOrder: 2,
    }),
    field({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: true,
      sortOrder: 3,
    }),
    field({
      id: "field_signature",
      label: "Signature",
      key: "signature",
      type: "SIGNATURE",
      required: true,
      sortOrder: 4,
    }),
  ];
  const provider = providerWithOcr([
    word("Name", 32, 40, 42),
    word("Ada", 160, 40, 28),
    word("Okafor", 196, 40, 54),
    word("Address", 32, 78, 62),
    word("14", 160, 78, 18),
    word("Broad", 184, 78, 48),
    word("Street", 238, 78, 52),
    word("Floor", 160, 108, 42),
    word("2", 208, 108, 10),
    word("Lagos", 224, 108, 46),
    word("Email", 32, 146, 42),
    word("ada@example.com", 160, 146, 126),
    word("X", 32, 184, 12),
    word("Signature", 60, 184, 74),
  ]);

  const result = await provider.extract(extractionInput({ fields }));

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].data, {
    name: "Ada Okafor",
    address: "14 Broad Street Floor 2 Lagos",
    email: "ada@example.com",
    signature: true,
  });
  assert.equal(
    result.rows[0].values.find((value) => value.field.key === "signature")
      .rawValue,
    "X",
  );
  assert.ok(
    result.rows[0].values.find((value) => value.field.key === "address")
      .boundingBox.height > 18,
  );
});

test("windows OCR reads selected options from form checkbox groups", async () => {
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
    }),
    field({
      id: "field_attendance",
      label: "Attendance",
      key: "attendance",
      type: "SELECT",
      required: true,
      sortOrder: 2,
      options: ["Present", "Absent", "Excused"],
    }),
    field({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: true,
      sortOrder: 3,
    }),
  ];
  const provider = providerWithOcr([
    word("Name", 32, 40, 42),
    word("Ada", 160, 40, 28),
    word("Okafor", 196, 40, 54),
    word("Attendance", 32, 78, 86),
    word("X", 60, 112, 12),
    word("Present", 84, 112, 62),
    word("Absent", 84, 142, 54),
    word("Excused", 84, 172, 62),
    word("Email", 32, 216, 42),
    word("ada@example.com", 160, 216, 126),
  ]);

  const result = await provider.extract(extractionInput({ fields }));

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].data, {
    name: "Ada Okafor",
    attendance: "Present",
    email: "ada@example.com",
  });
  assert.equal(
    result.rows[0].values.find((value) => value.field.key === "attendance")
      .rawValue,
    "Present",
  );
});

test("windows OCR preserves multiple checked select options for review", async () => {
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
    }),
    field({
      id: "field_attendance",
      label: "Attendance",
      key: "attendance",
      type: "SELECT",
      required: true,
      sortOrder: 2,
      options: ["Present", "Absent", "Excused"],
    }),
    field({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: true,
      sortOrder: 3,
    }),
  ];
  const provider = providerWithOcr([
    word("Name", 32, 40, 42),
    word("Ada", 160, 40, 28),
    word("Okafor", 196, 40, 54),
    word("Attendance", 32, 78, 86),
    word("X", 60, 112, 12),
    word("Present", 84, 112, 62),
    word("Absent", 84, 142, 54),
    word("X", 60, 172, 12),
    word("Excused", 84, 172, 62),
    word("Email", 32, 216, 42),
    word("ada@example.com", 160, 216, 126),
  ]);

  const result = await provider.extract(extractionInput({ fields }));
  const attendanceValue = result.rows[0].values.find(
    (value) => value.field.key === "attendance",
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].data, {
    name: "Ada Okafor",
    attendance: "Present, Excused",
    email: "ada@example.com",
  });
  assert.equal(attendanceValue.rawValue, "Present, Excused");
  assert.deepEqual(attendanceValue.issues, [
    "Multiple selected options for a single-select field.",
  ]);
  assert.ok(attendanceValue.confidence < 0.75);
});

test("windows OCR accepts multiple checked options for multi-select fields", async () => {
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
    }),
    field({
      id: "field_attendance_tags",
      label: "Attendance Tags",
      key: "attendance_tags",
      type: "MULTI_SELECT",
      required: true,
      sortOrder: 2,
      options: ["Present", "Remote", "Excused"],
    }),
    field({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: true,
      sortOrder: 3,
    }),
  ];
  const provider = providerWithOcr([
    word("Name", 32, 40, 42),
    word("Ada", 160, 40, 28),
    word("Okafor", 196, 40, 54),
    word("Attendance", 32, 78, 86),
    word("Tags", 122, 78, 34),
    word("X", 60, 112, 12),
    word("Present", 84, 112, 62),
    word("X", 60, 142, 12),
    word("Remote", 84, 142, 58),
    word("Excused", 84, 172, 62),
    word("Email", 32, 216, 42),
    word("ada@example.com", 160, 216, 126),
  ]);

  const result = await provider.extract(extractionInput({ fields }));
  const attendanceTagsValue = result.rows[0].values.find(
    (value) => value.field.key === "attendance_tags",
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].data, {
    name: "Ada Okafor",
    attendance_tags: "Present, Remote",
    email: "ada@example.com",
  });
  assert.equal(attendanceTagsValue.rawValue, "Present, Remote");
  assert.deepEqual(attendanceTagsValue.issues, []);
  assert.ok(attendanceTagsValue.confidence >= 0.75);
});

test("windows OCR captures handwritten-looking signature region marks", async () => {
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
    }),
    field({
      id: "field_signature",
      label: "Signature",
      key: "signature",
      type: "SIGNATURE",
      required: true,
      sortOrder: 2,
    }),
    field({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: true,
      sortOrder: 3,
    }),
  ];
  const provider = providerWithOcr([
    word("Name", 32, 40, 42),
    word("Ada", 160, 40, 28),
    word("Okafor", 196, 40, 54),
    word("Signature", 32, 82, 74),
    word("/\\", 164, 84, 36),
    word("Email", 32, 126, 42),
    word("ada@example.com", 160, 126, 126),
  ]);

  const result = await provider.extract(extractionInput({ fields }));
  const signatureValue = result.rows[0].values.find(
    (value) => value.field.key === "signature",
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].data, {
    name: "Ada Okafor",
    signature: true,
    email: "ada@example.com",
  });
  assert.equal(signatureValue.rawValue, "signature mark");
  assert.deepEqual(signatureValue.issues, []);
  assert.ok(signatureValue.boundingBox);
  assert.equal(signatureValue.boundingBox.x, 164);
});

test("windows OCR captures split stroke clusters in signature regions", async () => {
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
    }),
    field({
      id: "field_signature",
      label: "Signature",
      key: "signature",
      type: "SIGNATURE",
      required: true,
      sortOrder: 2,
    }),
    field({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: true,
      sortOrder: 3,
    }),
  ];
  const provider = providerWithOcr([
    word("Name", 32, 40, 42),
    word("Ada", 160, 40, 28),
    word("Okafor", 196, 40, 54),
    word("Signature", 32, 82, 74),
    word("/", 164, 106, 8),
    word("_", 176, 110, 28),
    word("\\", 214, 106, 8),
    word("Email", 32, 160, 42),
    word("ada@example.com", 160, 160, 126),
  ]);

  const result = await provider.extract(extractionInput({ fields }));
  const signatureValue = result.rows[0].values.find(
    (value) => value.field.key === "signature",
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].data, {
    name: "Ada Okafor",
    signature: true,
    email: "ada@example.com",
  });
  assert.equal(signatureValue.rawValue, "signature mark");
  assert.deepEqual(signatureValue.issues, []);
  assert.ok(signatureValue.boundingBox);
  assert.equal(signatureValue.boundingBox.x, 164);
  assert.ok(signatureValue.boundingBox.width > 50);
});

test("windows OCR does not treat a blank signature line as signed", async () => {
  const fields = [
    field({
      id: "field_name",
      label: "Name",
      key: "name",
      type: "TEXT",
      required: true,
    }),
    field({
      id: "field_signature",
      label: "Signature",
      key: "signature",
      type: "SIGNATURE",
      required: true,
      sortOrder: 2,
    }),
    field({
      id: "field_email",
      label: "Email",
      key: "email",
      type: "EMAIL",
      required: true,
      sortOrder: 3,
    }),
  ];
  const provider = providerWithOcr([
    word("Name", 32, 40, 42),
    word("Ada", 160, 40, 28),
    word("Okafor", 196, 40, 54),
    word("Signature", 32, 82, 74),
    word("________", 164, 110, 96),
    word("Email", 32, 160, 42),
    word("ada@example.com", 160, 160, 126),
  ]);

  const result = await provider.extract(extractionInput({ fields }));
  const signatureValue = result.rows[0].values.find(
    (value) => value.field.key === "signature",
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].data, {
    name: "Ada Okafor",
    signature: false,
    email: "ada@example.com",
  });
  assert.equal(signatureValue.rawValue, "");
  assert.deepEqual(signatureValue.issues, ["Missing required value."]);
  assert.equal(signatureValue.boundingBox, null);
});
