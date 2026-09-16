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
