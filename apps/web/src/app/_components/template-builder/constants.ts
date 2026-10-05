import type {
  EventMemberRole,
  FieldType,
  RecordStatus,
} from "@crowdlog/shared";
import type { ReviewStatusFilter } from "./types";

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  email: "Email",
  phone: "Phone",
  number: "Number",
  signature: "Signature",
  date: "Date",
  select: "Select",
  multi_select: "Multi-select",
};

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
};

export const EVENT_ROLE_LABELS: Record<EventMemberRole, string> = {
  owner: "Owner",
  reviewer: "Reviewer",
};

export const REVIEW_STATUS_FILTERS: Array<{
  value: ReviewStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "needs_review", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
