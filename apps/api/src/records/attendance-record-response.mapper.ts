import type { Prisma } from "@prisma/client";
import { fromPrismaDocumentStatus } from "../documents/attendance-document-response.mapper";
import { fromPrismaRecordStatus } from "./record-status.mapper";

const recordInclude = {
  document: true,
  values: {
    include: {
      field: true,
    },
  },
} satisfies Prisma.AttendanceRecordInclude;

export type AttendanceRecordWithValues = Prisma.AttendanceRecordGetPayload<{
  include: typeof recordInclude;
}>;

export function getAttendanceRecordInclude() {
  return recordInclude;
}

export function toAttendanceRecordResponse(record: AttendanceRecordWithValues) {
  const values = [...record.values].sort(
    (left, right) => left.field.sortOrder - right.field.sortOrder,
  );

  return {
    id: record.id,
    eventId: record.eventId,
    documentId: record.documentId,
    rowNumber: record.rowNumber,
    data: jsonRecord(record.dataJson),
    confidenceScore: record.confidenceScore,
    status: fromPrismaRecordStatus(record.status),
    document: record.document
      ? {
          id: record.document.id,
          fileName: record.document.fileName,
          fileType: record.document.fileType,
          fileUrl: record.document.fileUrl,
          status: fromPrismaDocumentStatus(record.document.status),
        }
      : null,
    values: values.map((value) => ({
      id: value.id,
      recordId: value.recordId,
      fieldId: value.fieldId,
      fieldKey: value.field.key,
      fieldLabel: value.field.label,
      rawValue: value.rawValue,
      normalizedValue: value.normalizedValue,
      confidence: value.confidence,
      boundingBox: value.boundingBox,
      createdAt: value.createdAt.toISOString(),
      updatedAt: value.updatedAt.toISOString(),
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function jsonRecord(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string | number | boolean | null> = {};

  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      result[key] = item;
    }
  }

  return result;
}
