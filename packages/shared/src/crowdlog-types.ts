export const FIELD_TYPES = [
  "text",
  "email",
  "phone",
  "number",
  "signature",
  "date",
  "select",
  "multi_select",
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

export const EVENT_MEMBER_ROLES = ["owner", "reviewer"] as const;

export type EventMemberRole = (typeof EVENT_MEMBER_ROLES)[number];

export type EventMember = {
  id: string;
  eventId: string;
  userId: string;
  email: string;
  name: string | null;
  role: EventMemberRole;
  createdAt: string;
  updatedAt: string;
};

export type CrowdLogEvent = {
  id: string;
  ownerId?: string | null;
  title: string;
  description: string;
  eventDate: string;
  template: AttendanceTemplate;
  members: EventMember[];
  createdAt: string;
  updatedAt: string;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthSession = {
  user: AuthUser | null;
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
  validationIssues: string[];
  boundingBox: unknown;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceRecord = {
  id: string;
  eventId: string;
  documentId: string | null;
  reviewedByUserId: string | null;
  reviewedBy: AuthUser | null;
  reviewedAt: string | null;
  rowNumber: number | null;
  data: RecordData;
  confidenceScore: number | null;
  status: RecordStatus;
  document: AttendanceDocumentSummary | null;
  values: AttendanceRecordValue[];
  createdAt: string;
  updatedAt: string;
};

export type OcrFieldSuggestion = {
  label: string;
  key: string;
  type: FieldType;
  aliases: string[];
  options: string[];
  sampleValues: string[];
  confidence: number;
};

export type MockExtractionResult = {
  document: AttendanceDocumentSummary;
  records: AttendanceRecord[];
  suggestedFields: OcrFieldSuggestion[];
};

export type RecordStatusCounts = {
  total: number;
  reviewed: number;
  approved: number;
  rejected: number;
  needsReview: number;
  draft: number;
};

export type EventRecordAnalytics = {
  eventId: string;
  generatedAt: string;
  summary: RecordStatusCounts & {
    reviewRate: number;
    approvalRate: number;
    rejectionRate: number;
    averageConfidence: number | null;
    lowConfidenceRecords: number;
    validationIssueCells: number;
  };
  documents: Array<
    RecordStatusCounts & {
      id: string;
      name: string;
      status: string;
      reviewRate: number;
      averageConfidence: number | null;
      validationIssueCells: number;
      lastActivityAt: string | null;
    }
  >;
  reviewers: Array<{
    userId: string;
    email: string;
    name: string | null;
    role: EventMemberRole;
    reviewed: number;
    approved: number;
    rejected: number;
    shareOfReviewed: number;
    lastReviewedAt: string | null;
  }>;
  fields: Array<{
    fieldId: string;
    key: string;
    label: string;
    type: FieldType;
    required: boolean;
    populatedRecords: number;
    blankRecords: number;
    issueCells: number;
    lowConfidenceCells: number;
    averageConfidence: number | null;
  }>;
  activity: Array<{
    date: string;
    createdRecords: number;
    reviewedRecords: number;
    approvedRecords: number;
    rejectedRecords: number;
  }>;
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
