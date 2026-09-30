const assert = require("node:assert/strict");
const { mkdir, unlink, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

const { AttendanceDocumentStatus } = require("@prisma/client");
const { RecordsService } = require("../dist/records/records.service");

function mockFn(implementation) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return implementation?.(...args);
  };

  fn.calls = calls;
  return fn;
}

const now = new Date("2026-09-30T00:00:00.000Z");

function templateField() {
  return {
    id: "field_name",
    templateId: "template_1",
    label: "Name",
    key: "name",
    type: "TEXT",
    required: true,
    sortOrder: 1,
    aliases: [],
    options: [],
    createdAt: now,
    updatedAt: now,
  };
}

test("PDF document extraction clamps requested page range to detected pages", async () => {
  const uploadsDir = join(process.cwd(), "uploads");
  const fileName = "test-multipage.pdf";
  const filePath = join(uploadsDir, fileName);

  await mkdir(uploadsDir, { recursive: true });
  await writeFile(
    filePath,
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Page >> endobj",
      "2 0 obj << /Type /Page >> endobj",
      "3 0 obj << /Type /Page >> endobj",
      "4 0 obj << /Type /Pages /Kids [1 0 R 2 0 R 3 0 R] >> endobj",
    ].join("\n"),
  );

  const tx = {
    attendanceRecord: {
      deleteMany: mockFn(async () => ({ count: 0 })),
      createMany: mockFn(async () => ({ count: 0 })),
      findMany: mockFn(async () => []),
    },
    attendanceDocument: {
      update: mockFn(async () => ({
        id: "document_pdf",
        eventId: "event_1",
        fileName,
        fileType: "application/pdf",
        fileUrl: `/uploads/${fileName}`,
        status: AttendanceDocumentStatus.EXTRACTED,
        rawOcrJson: { provider: "test" },
        createdAt: now,
        updatedAt: now,
        _count: { records: 0 },
      })),
    },
    attendanceRecordValue: {
      createMany: mockFn(async () => ({ count: 0 })),
    },
  };
  const prisma = {
    attendanceDocument: {
      findUnique: mockFn(async () => ({
        id: "document_pdf",
        eventId: "event_1",
        fileName,
        fileType: "application/pdf",
        fileUrl: `/uploads/${fileName}`,
        status: AttendanceDocumentStatus.UPLOADED,
        rawOcrJson: null,
        createdAt: now,
        updatedAt: now,
        event: {
          id: "event_1",
          ownerId: "user_owner",
          members: [],
        },
      })),
    },
    event: {
      findUnique: mockFn(async () => ({
        id: "event_1",
        title: "Seminar",
        ownerId: "user_owner",
        members: [],
        templates: [
          {
            id: "template_1",
            name: "Default attendance template",
            fields: [templateField()],
          },
        ],
      })),
    },
    $transaction: mockFn(async (callback) => callback(tx)),
  };
  const ocrProvider = {
    extract: mockFn(async (input) => {
      assert.equal(input.options.rowCount, 5);
      assert.equal(input.options.pageStart, 2);
      assert.equal(input.options.pageCount, 2);
      assert.equal(input.options.totalPages, 3);

      return {
        providerName: "test",
        rawOcrJson: { provider: "test" },
        rows: [],
        suggestedFields: [],
      };
    }),
  };
  const service = new RecordsService(ocrProvider, prisma);

  try {
    await service.extractDocument(
      "document_pdf",
      { rowCount: 5, pageStart: 2, pageCount: 5 },
      "user_owner",
    );

    assert.equal(ocrProvider.extract.calls.length, 1);
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
});

test("document extraction passes requested form layout to the OCR provider", async () => {
  const tx = {
    attendanceRecord: {
      deleteMany: mockFn(async () => ({ count: 0 })),
      createMany: mockFn(async () => ({ count: 0 })),
      findMany: mockFn(async () => []),
    },
    attendanceDocument: {
      update: mockFn(async () => ({
        id: "document_form",
        eventId: "event_1",
        fileName: "membership-form.png",
        fileType: "image/png",
        fileUrl: "/uploads/membership-form.png",
        status: AttendanceDocumentStatus.EXTRACTED,
        rawOcrJson: { provider: "test" },
        createdAt: now,
        updatedAt: now,
        _count: { records: 0 },
      })),
    },
    attendanceRecordValue: {
      createMany: mockFn(async () => ({ count: 0 })),
    },
  };
  const prisma = {
    attendanceDocument: {
      findUnique: mockFn(async () => ({
        id: "document_form",
        eventId: "event_1",
        fileName: "membership-form.png",
        fileType: "image/png",
        fileUrl: "/uploads/membership-form.png",
        status: AttendanceDocumentStatus.UPLOADED,
        rawOcrJson: null,
        createdAt: now,
        updatedAt: now,
        event: {
          id: "event_1",
          ownerId: "user_owner",
          members: [],
        },
      })),
    },
    event: {
      findUnique: mockFn(async () => ({
        id: "event_1",
        title: "Seminar",
        ownerId: "user_owner",
        members: [],
        templates: [
          {
            id: "template_1",
            name: "Default attendance template",
            fields: [templateField()],
          },
        ],
      })),
    },
    $transaction: mockFn(async (callback) => callback(tx)),
  };
  const ocrProvider = {
    extract: mockFn(async (input) => {
      assert.equal(input.options.layout, "form");

      return {
        providerName: "test",
        rawOcrJson: { provider: "test", mode: "form" },
        rows: [],
        suggestedFields: [],
      };
    }),
  };
  const service = new RecordsService(ocrProvider, prisma);

  await service.extractDocument(
    "document_form",
    { rowCount: 4, layout: "form" },
    "user_owner",
  );

  assert.equal(ocrProvider.extract.calls.length, 1);
});

test("PDF document extraction renders pages before OCR when a renderer is available", async () => {
  const tx = {
    attendanceRecord: {
      deleteMany: mockFn(async () => ({ count: 0 })),
      createMany: mockFn(async () => ({ count: 2 })),
      findMany: mockFn(async () => []),
    },
    attendanceDocument: {
      update: mockFn(async (input) => ({
        id: "document_pdf",
        eventId: "event_1",
        fileName: "attendance.pdf",
        fileType: "application/pdf",
        fileUrl: "/uploads/attendance.pdf",
        status: AttendanceDocumentStatus.EXTRACTED,
        rawOcrJson: input.data.rawOcrJson,
        createdAt: now,
        updatedAt: now,
        _count: { records: 2 },
      })),
    },
    attendanceRecordValue: {
      createMany: mockFn(async () => ({ count: 0 })),
    },
  };
  const prisma = {
    attendanceDocument: {
      findUnique: mockFn(async () => ({
        id: "document_pdf",
        eventId: "event_1",
        fileName: "attendance.pdf",
        fileType: "application/pdf",
        fileUrl: "/uploads/attendance.pdf",
        status: AttendanceDocumentStatus.UPLOADED,
        rawOcrJson: null,
        createdAt: now,
        updatedAt: now,
        event: {
          id: "event_1",
          ownerId: "user_owner",
          members: [],
        },
      })),
    },
    event: {
      findUnique: mockFn(async () => ({
        id: "event_1",
        title: "Seminar",
        ownerId: "user_owner",
        members: [],
        templates: [
          {
            id: "template_1",
            name: "Default attendance template",
            fields: [templateField()],
          },
        ],
      })),
    },
    $transaction: mockFn(async (callback) => callback(tx)),
  };
  const ocrProvider = {
    extract: mockFn(async (input) => {
      assert.equal(input.document.fileType, "image/png");
      assert.match(input.document.fileUrl, /^rendered-pdf:\/\//);

      return {
        providerName: "test-page-ocr",
        rawOcrJson: {
          provider: "test-page-ocr",
          fileName: input.document.fileName,
        },
        rows: [
          {
            rowNumber: 1,
            sourcePage: input.options.pageStart,
            data: { name: `Page ${input.options.pageStart}` },
            values: [],
            confidenceScore: 0.9,
          },
        ],
        suggestedFields: [],
      };
    }),
  };
  const renderer = {
    renderPages: mockFn(async () => ({
      rendered: true,
      pages: [
        {
          pageNumber: 2,
          fileName: "attendance-page-2.png",
          filePath: "C:/tmp/page-2.png",
          fileType: "image/png",
          cleanupDirectory: "C:/tmp/rendered",
        },
        {
          pageNumber: 3,
          fileName: "attendance-page-3.png",
          filePath: "C:/tmp/page-3.png",
          fileType: "image/png",
          cleanupDirectory: "C:/tmp/rendered",
        },
      ],
    })),
    cleanupRenderedPages: mockFn(async () => null),
  };
  const service = new RecordsService(ocrProvider, prisma, renderer);

  await service.extractDocument(
    "document_pdf",
    { rowCount: 5, pageStart: 2, pageCount: 2 },
    "user_owner",
  );

  assert.equal(renderer.renderPages.calls.length, 1);
  assert.equal(renderer.cleanupRenderedPages.calls.length, 1);
  assert.equal(ocrProvider.extract.calls.length, 2);
  assert.equal(tx.attendanceDocument.update.calls[0][0].data.rawOcrJson.provider, "pdf-page-renderer");
  assert.deepEqual(
    tx.attendanceRecord.createMany.calls[0][0].data.map((record) => ({
      rowNumber: record.rowNumber,
      dataJson: record.dataJson,
    })),
    [
      { rowNumber: 1, dataJson: { name: "Page 2" } },
      { rowNumber: 2, dataJson: { name: "Page 3" } },
    ],
  );
});
