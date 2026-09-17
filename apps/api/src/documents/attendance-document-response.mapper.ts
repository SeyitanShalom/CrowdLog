import { AttendanceDocumentStatus, type AttendanceDocument } from "@prisma/client";

type AttendanceDocumentWithCount = AttendanceDocument & {
  _count?: {
    records: number;
  };
};

export function toAttendanceDocumentResponse(
  document: AttendanceDocumentWithCount,
) {
  return {
    id: document.id,
    eventId: document.eventId,
    fileName: document.fileName,
    fileType: document.fileType,
    fileUrl: document.fileUrl,
    status: fromPrismaDocumentStatus(document.status),
    recordCount: document._count?.records ?? 0,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function fromPrismaDocumentStatus(status: AttendanceDocumentStatus) {
  const statusMap: Record<AttendanceDocumentStatus, string> = {
    UPLOADED: "uploaded",
    PROCESSING: "processing",
    EXTRACTED: "extracted",
    REVIEWED: "reviewed",
    APPROVED: "approved",
    FAILED: "failed",
  };

  return statusMap[status];
}
