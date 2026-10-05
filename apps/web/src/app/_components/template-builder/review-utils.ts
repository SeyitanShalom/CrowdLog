import type {
  AttendanceDocumentSummary,
  AttendanceRecord,
  AuthUser,
  CrowdLogEvent,
  EventMemberRole,
  RecordCellValue,
  TemplateField,
} from "@crowdlog/shared";
import { RECORD_STATUS_LABELS } from "./constants";
import type { ReviewStatusFilter } from "./types";

export function valueToString(value: RecordCellValue | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

export function valueToBoolean(value: RecordCellValue | undefined) {
  return value === true || value === "true" || value === "signed";
}

export function confidenceLabel(confidence: number | null | undefined) {
  if (confidence === null || confidence === undefined) {
    return "n/a";
  }

  return `${Math.round(confidence * 100)}%`;
}

export function formatNullableConfidence(
  confidence: number | null | undefined,
) {
  return confidence === null || confidence === undefined
    ? "n/a"
    : confidenceLabel(confidence);
}

export function toPositiveInteger(value: string, fallback: number) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return parsedValue;
}

export function getReviewCounts(records: AttendanceRecord[]) {
  const approved = records.filter((record) => record.status === "approved").length;
  const rejected = records.filter((record) => record.status === "rejected").length;

  return {
    total: records.length,
    reviewed: approved + rejected,
    approved,
    rejected,
    needsReview: records.filter((record) => record.status === "needs_review")
      .length,
    draft: records.filter((record) => record.status === "draft").length,
  };
}

export function percentage(part: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((part / total) * 100);
}

export function formatPercentage(part: number, total: number) {
  return `${percentage(part, total)}%`;
}

export function formatShortDateTime(value: string | null | undefined) {
  if (!value) {
    return "No activity";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No activity";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getDocumentReports(
  documents: AttendanceDocumentSummary[],
  records: AttendanceRecord[],
) {
  const reports = new Map<
    string,
    {
      id: string;
      name: string;
      status: string;
      total: number;
      reviewed: number;
      approved: number;
      rejected: number;
      needsReview: number;
      draft: number;
      lastActivityAt: string | null;
    }
  >();

  for (const document of documents) {
    reports.set(document.id, {
      id: document.id,
      name: document.fileName,
      status: document.status,
      total: 0,
      reviewed: 0,
      approved: 0,
      rejected: 0,
      needsReview: 0,
      draft: 0,
      lastActivityAt: document.updatedAt ?? document.createdAt ?? null,
    });
  }

  for (const record of records) {
    const id = record.documentId ?? "manual";
    const report =
      reports.get(id) ??
      {
        id,
        name: record.document?.fileName ?? "Manual rows",
        status: record.document?.status ?? "review",
        total: 0,
        reviewed: 0,
        approved: 0,
        rejected: 0,
        needsReview: 0,
        draft: 0,
        lastActivityAt: null,
      };

    report.total += 1;
    report.reviewed +=
      record.status === "approved" || record.status === "rejected" ? 1 : 0;
    report.approved += record.status === "approved" ? 1 : 0;
    report.rejected += record.status === "rejected" ? 1 : 0;
    report.needsReview += record.status === "needs_review" ? 1 : 0;
    report.draft += record.status === "draft" ? 1 : 0;
    report.lastActivityAt = latestDate(report.lastActivityAt, record.updatedAt);
    reports.set(id, report);
  }

  return Array.from(reports.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function getReviewerReports(
  event: CrowdLogEvent | null,
  currentUser: AuthUser | null,
  records: AttendanceRecord[],
) {
  const reports =
    event?.members.map((member) => ({
      id: member.userId,
      name: member.name || member.email,
      email: member.email,
      role: member.role,
      isCurrentUser: member.userId === currentUser?.id,
      reviewed: 0,
      approved: 0,
      rejected: 0,
      lastReviewedAt: null as string | null,
    })) ?? [];
  const reportByUserId = new Map(reports.map((report) => [report.id, report]));
  const unattributed = {
    id: "unattributed",
    name: "Unattributed",
    email: "Rows reviewed before reviewer tracking",
    role: "reviewer" as EventMemberRole,
    isCurrentUser: false,
    reviewed: 0,
    approved: 0,
    rejected: 0,
    lastReviewedAt: null as string | null,
  };

  for (const record of records) {
    if (record.status !== "approved" && record.status !== "rejected") {
      continue;
    }

    const report = record.reviewedByUserId
      ? reportByUserId.get(record.reviewedByUserId)
      : unattributed;

    if (!report) {
      continue;
    }

    report.reviewed += 1;
    report.approved += record.status === "approved" ? 1 : 0;
    report.rejected += record.status === "rejected" ? 1 : 0;
    report.lastReviewedAt = latestDate(
      report.lastReviewedAt,
      record.reviewedAt ?? record.updatedAt,
    );
  }

  return unattributed.reviewed > 0 ? [...reports, unattributed] : reports;
}

export function latestDate(
  currentValue: string | null | undefined,
  nextValue: string | null | undefined,
) {
  if (!nextValue) {
    return currentValue ?? null;
  }

  if (!currentValue) {
    return nextValue;
  }

  return new Date(nextValue).getTime() > new Date(currentValue).getTime()
    ? nextValue
    : currentValue;
}

export function filterReviewRecords(
  records: AttendanceRecord[],
  fields: TemplateField[],
  searchQuery: string,
  statusFilter: ReviewStatusFilter,
) {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return records.filter((record) => {
    if (statusFilter !== "all" && record.status !== statusFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const searchableValues = [
      String(record.rowNumber ?? ""),
      RECORD_STATUS_LABELS[record.status],
      record.document?.fileName ?? "",
      ...fields.map((field) => valueToString(record.data[field.key])),
    ];

    return searchableValues.some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    );
  });
}

export function createCsvContent(
  event: CrowdLogEvent,
  fields: TemplateField[],
  records: AttendanceRecord[],
) {
  const headers = [
    "Event",
    "Row",
    "Status",
    "Confidence",
    "Document",
    ...fields.map((field) => field.label),
  ];
  const rows = records.map((record) => [
    event.title,
    String(record.rowNumber ?? ""),
    RECORD_STATUS_LABELS[record.status],
    confidenceLabel(record.confidenceScore),
    record.document?.fileName ?? "",
    ...fields.map((field) => valueToString(record.data[field.key])),
  ]);

  return [headers, ...rows].map(csvRow).join("\r\n");
}

function csvRow(values: string[]) {
  return values.map(csvCell).join(",");
}

function csvCell(value: string) {
  const escapedValue = value.replace(/"/g, '""');

  return /[",\r\n]/.test(escapedValue) ? `"${escapedValue}"` : escapedValue;
}

export function downloadCsv(fileName: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });

  downloadBlob(fileName, blob);
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function toFileSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "crowdlog-export";
}
