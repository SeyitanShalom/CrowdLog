export const FIELD_TYPES = [
  "text",
  "email",
  "phone",
  "number",
  "signature",
  "date",
  "select",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type TemplateField = {
  id: string;
  label: string;
  key: string;
  type: FieldType;
  required: boolean;
  sortOrder: number;
  aliases: string[];
  options: string[];
};

export type AttendanceTemplate = {
  id: string;
  eventId: string;
  name: string;
  isDefault: boolean;
  fields: TemplateField[];
  createdAt: string;
  updatedAt: string;
};

export type CrowdLogEvent = {
  id: string;
  title: string;
  description: string;
  eventDate: string;
  template: AttendanceTemplate;
  createdAt: string;
  updatedAt: string;
};

export const RECORD_STATUSES = [
  "draft",
  "needs_review",
  "approved",
  "rejected",
] as const;

export type RecordStatus = (typeof RECORD_STATUSES)[number];

export type RecordCellValue = string | number | boolean | null;

export type RecordData = Record<string, RecordCellValue>;

export type AttendanceDocumentSummary = {
  id: string;
  eventId?: string;
  fileName: string;
  fileType: string | null;
  fileUrl: string;
  status: string;
  recordCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AttendanceRecordValue = {
  id: string;
  recordId: string;
  fieldId: string;
  fieldKey: string;
  fieldLabel: string;
  rawValue: string | null;
  normalizedValue: string | null;
  confidence: number | null;
  boundingBox: unknown;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceRecord = {
  id: string;
  eventId: string;
  documentId: string | null;
  rowNumber: number | null;
  data: RecordData;
  confidenceScore: number | null;
  status: RecordStatus;
  document: AttendanceDocumentSummary | null;
  values: AttendanceRecordValue[];
  createdAt: string;
  updatedAt: string;
};

export type MockExtractionResult = {
  document: AttendanceDocumentSummary;
  records: AttendanceRecord[];
};

export type DraftField = {
  id: string;
  label: string;
  key: string;
  type: FieldType;
  required: boolean;
  sortOrder: number;
  aliasesText: string;
  optionsText: string;
};

export type EventDraft = {
  title: string;
  description: string;
  eventDate: string;
  templateName: string;
  fields: DraftField[];
};
