const assert = require("node:assert/strict");
const { unlink } = require("node:fs/promises");
const { basename, join } = require("node:path");
const test = require("node:test");

const { NotFoundException } = require("@nestjs/common");
const { AttendanceDocumentStatus } = require("@prisma/client");
const { DocumentsService } = require("../dist/documents/documents.service");

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

function documentWithEvent(overrides = {}) {
  return {
    id: "document_1",
    eventId: "event_1",
    fileName: "week-1.png",
    fileType: "image/png",
    fileUrl: "mock://week-1.png",
    status: AttendanceDocumentStatus.EXTRACTED,
    rawOcrJson: { source: "test" },
    createdAt: now,
    updatedAt: now,
    event: {
      ownerId: "user_owner",
      members: [{ userId: "user_reviewer" }],
    },
    _count: {
      records: 3,
    },
    ...overrides,
  };
}

test("event members can delete uploaded documents and their extracted rows", async () => {
  const tx = {
    attendanceRecord: {
      deleteMany: mockFn(async () => ({ count: 3 })),
    },
    attendanceDocument: {
      delete: mockFn(async () => null),
    },
  };
  const prisma = {
    attendanceDocument: {
      findUnique: mockFn(async () => documentWithEvent()),
    },
    $transaction: mockFn(async (callback) => callback(tx)),
  };
  const service = new DocumentsService(prisma);

  const result = await service.deleteDocument("document_1", "user_reviewer");

  assert.deepEqual(tx.attendanceRecord.deleteMany.calls[0][0], {
    where: { documentId: "document_1" },
  });
  assert.deepEqual(tx.attendanceDocument.delete.calls[0][0], {
    where: { id: "document_1" },
  });
  assert.deepEqual(result, {
    id: "document_1",
    eventId: "event_1",
    deletedRecordCount: 3,
  });
});

test("outsiders cannot delete uploaded documents", async () => {
  const tx = {
    attendanceRecord: {
      deleteMany: mockFn(),
    },
    attendanceDocument: {
      delete: mockFn(),
    },
  };
  const prisma = {
    attendanceDocument: {
      findUnique: mockFn(async () =>
        documentWithEvent({
          event: {
            ownerId: "user_owner",
            members: [],
          },
        }),
      ),
    },
    $transaction: mockFn(async (callback) => callback(tx)),
  };
  const service = new DocumentsService(prisma);

  await assert.rejects(
    () => service.deleteDocument("document_1", "user_outsider"),
    NotFoundException,
  );
  assert.equal(prisma.$transaction.calls.length, 0);
});

test("event members can replace a document file and clear its old extraction", async () => {
  const tx = {
    attendanceRecord: {
      deleteMany: mockFn(async () => ({ count: 2 })),
    },
    attendanceDocument: {
      update: mockFn(async (input) => ({
        id: "document_1",
        eventId: "event_1",
        fileName: input.data.fileName,
        fileType: input.data.fileType,
        fileUrl: input.data.fileUrl,
        status: input.data.status,
        rawOcrJson: null,
        createdAt: now,
        updatedAt: now,
        _count: {
          records: 0,
        },
      })),
    },
  };
  const prisma = {
    attendanceDocument: {
      findUnique: mockFn(async () => documentWithEvent()),
    },
    $transaction: mockFn(async (callback) => callback(tx)),
  };
  const service = new DocumentsService(prisma);

  const result = await service.replaceDocumentFile(
    "document_1",
    {
      originalname: "replacement sheet.png",
      mimetype: "image/png",
      buffer: Buffer.from("replacement"),
    },
    "user_reviewer",
  );

  try {
    assert.deepEqual(tx.attendanceRecord.deleteMany.calls[0][0], {
      where: { documentId: "document_1" },
    });
    assert.equal(tx.attendanceDocument.update.calls[0][0].data.fileName, "replacement sheet.png");
    assert.equal(tx.attendanceDocument.update.calls[0][0].data.status, AttendanceDocumentStatus.UPLOADED);
    assert.equal(result.fileName, "replacement sheet.png");
    assert.equal(result.status, "uploaded");
    assert.equal(result.recordCount, 0);
    assert.match(result.fileUrl, /^\/uploads\/.+replacement-sheet\.png$/);
  } finally {
    await unlink(join(process.cwd(), "uploads", basename(result.fileUrl))).catch(
      () => undefined,
    );
  }
});
