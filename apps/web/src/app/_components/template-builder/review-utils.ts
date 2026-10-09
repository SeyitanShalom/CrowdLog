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

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = (46 << 9) | (1 << 5) | 1;
const CRC_TABLE = createCrcTable();

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

export function createDataOnlyXlsxBlob(
  fields: TemplateField[],
  records: AttendanceRecord[],
) {
  const rows = [
    fields.map((field) => field.label),
    ...records.map((record) =>
      fields.map((field) => valueToString(record.data[field.key])),
    ),
  ];

  return new Blob([createXlsxWorkbook("Attendance", rows)], {
    type: XLSX_CONTENT_TYPE,
  });
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

function createXlsxWorkbook(sheetName: string, rows: string[][]) {
  const safeSheetName = sanitizeSheetName(sheetName);

  return createZip([
    {
      path: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      path: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      path: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${xmlEscape(safeSheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      path: "xl/worksheets/sheet1.xml",
      content: createWorksheetXml(rows),
    },
  ]);
}

function createWorksheetXml(rows: string[][]) {
  const maxColumnCount = Math.max(1, ...rows.map((row) => row.length));
  const maxRowCount = Math.max(1, rows.length);
  const dimension = `A1:${columnName(maxColumnCount)}${maxRowCount}`;
  const sheetData = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map(
          (value, columnIndex) =>
            `<c r="${columnName(columnIndex + 1)}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`,
        )
        .join("");

      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetData>${sheetData}</sheetData>
</worksheet>`;
}

function sanitizeSheetName(value: string) {
  const safeName = value.replace(/[\]\\/*?:[\]]/g, " ").trim().slice(0, 31);

  return safeName || "Attendance";
}

function columnName(index: number) {
  let currentIndex = index;
  let name = "";

  while (currentIndex > 0) {
    const remainder = (currentIndex - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    currentIndex = Math.floor((currentIndex - 1) / 26);
  }

  return name;
}

function xmlEscape(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createZip(entries: Array<{ path: string; content: string | Uint8Array }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encodeText(entry.path);
    const data =
      typeof entry.content === "string" ? encodeText(entry.content) : entry.content;
    const crc = crc32(data);
    const localHeader = createLocalFileHeader(name, data, crc);
    const centralHeader = createCentralDirectoryHeader(name, data, crc, offset);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const endRecord = createEndOfCentralDirectory(
    entries.length,
    offset,
    centralDirectory.length,
  );

  return concatBytes([...localParts, centralDirectory, endRecord]);
}

function createLocalFileHeader(name: Uint8Array, data: Uint8Array, crc: number) {
  const header = new Uint8Array(30 + name.length);

  writeUint32(header, 0, 0x04034b50);
  writeUint16(header, 4, 20);
  writeUint16(header, 6, 0);
  writeUint16(header, 8, 0);
  writeUint16(header, 10, ZIP_DOS_TIME);
  writeUint16(header, 12, ZIP_DOS_DATE);
  writeUint32(header, 14, crc);
  writeUint32(header, 18, data.length);
  writeUint32(header, 22, data.length);
  writeUint16(header, 26, name.length);
  writeUint16(header, 28, 0);
  header.set(name, 30);

  return header;
}

function createCentralDirectoryHeader(
  name: Uint8Array,
  data: Uint8Array,
  crc: number,
  offset: number,
) {
  const header = new Uint8Array(46 + name.length);

  writeUint32(header, 0, 0x02014b50);
  writeUint16(header, 4, 20);
  writeUint16(header, 6, 20);
  writeUint16(header, 8, 0);
  writeUint16(header, 10, 0);
  writeUint16(header, 12, ZIP_DOS_TIME);
  writeUint16(header, 14, ZIP_DOS_DATE);
  writeUint32(header, 16, crc);
  writeUint32(header, 20, data.length);
  writeUint32(header, 24, data.length);
  writeUint16(header, 28, name.length);
  writeUint16(header, 30, 0);
  writeUint16(header, 32, 0);
  writeUint16(header, 34, 0);
  writeUint16(header, 36, 0);
  writeUint32(header, 38, 0);
  writeUint32(header, 42, offset);
  header.set(name, 46);

  return header;
}

function createEndOfCentralDirectory(
  entryCount: number,
  centralDirectoryOffset: number,
  centralDirectorySize: number,
) {
  const record = new Uint8Array(22);

  writeUint32(record, 0, 0x06054b50);
  writeUint16(record, 4, 0);
  writeUint16(record, 6, 0);
  writeUint16(record, 8, entryCount);
  writeUint16(record, 10, entryCount);
  writeUint32(record, 12, centralDirectorySize);
  writeUint32(record, 16, centralDirectoryOffset);
  writeUint16(record, 20, 0);

  return record;
}

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function encodeText(value: string) {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function writeUint16(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint16(
    offset,
    value,
    true,
  );
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(
    offset,
    value,
    true,
  );
}
