"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FIELD_TYPES,
  dedupeFieldKey,
  makeClientId,
  normalizeFieldKey,
  splitCommaList,
  type AttendanceDocumentSummary,
  type AttendanceRecord,
  type AuthUser,
  type CrowdLogEvent,
  type DraftField,
  type EventMember,
  type EventMemberRole,
  type EventDraft,
  type FieldType,
  type OcrFieldSuggestion,
  type RecordCellValue,
  type RecordStatus,
  type TemplateField,
} from "@crowdlog/shared";
import {
  addEventReviewer,
  approveAttendanceRecord,
  createEvent,
  createTemplateField,
  deleteAttendanceDocument,
  deleteEvent,
  extractDocument,
  exportEventRecordsCsv,
  exportEventRecordsXlsx,
  getApiFileUrl,
  getCurrentSession,
  listDocuments,
  listEvents,
  listRecords,
  mockExtractRecords,
  rejectAttendanceRecord,
  replaceAttendanceDocument,
  removeEventMember,
  signIn as apiSignIn,
  signOut as apiSignOut,
  updateAttendanceRecord,
  updateEventMember,
  uploadAttendanceDocument,
  type CreateEventPayload,
} from "@/lib/api-client";

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  email: "Email",
  phone: "Phone",
  number: "Number",
  signature: "Signature",
  date: "Date",
  select: "Select",
};

const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
};

const EVENT_ROLE_LABELS: Record<EventMemberRole, string> = {
  owner: "Owner",
  reviewer: "Reviewer",
};

type ReviewStatusFilter = RecordStatus | "all";
type DocumentExtractionOptions = {
  pageStart?: number;
  pageCount?: number;
  layout?: ExtractionLayout;
};
type ExtractionLayout = "table" | "form";

const REVIEW_STATUS_FILTERS: Array<{
  value: ReviewStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "needs_review", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const PORTFOLIO_DEMO_EVENT_TITLE = "Portfolio Demo: Computer Science Seminar";
const PORTFOLIO_DEMO_OWNER_EMAIL = "owner.demo@crowdlog.local";
const PORTFOLIO_DEMO_OWNER_NAME = "Amina Okafor";

const starterDraft: EventDraft = {
  title: "Computer Science Seminar",
  description: "Department seminar attendance for students and guests.",
  eventDate: "",
  templateName: "Default attendance template",
  fields: [
    {
      id: "field_name",
      label: "Name",
      key: "name",
      type: "text",
      required: true,
      sortOrder: 1,
      aliasesText: "Full Name",
      optionsText: "",
    },
    {
      id: "field_matric_number",
      label: "Matric Number",
      key: "matric_number",
      type: "text",
      required: true,
      sortOrder: 2,
      aliasesText: "Matric No, Reg No, Student ID",
      optionsText: "",
    },
    {
      id: "field_department",
      label: "Department",
      key: "department",
      type: "text",
      required: true,
      sortOrder: 3,
      aliasesText: "Dept",
      optionsText: "",
    },
    {
      id: "field_level",
      label: "Level",
      key: "level",
      type: "select",
      required: false,
      sortOrder: 4,
      aliasesText: "Year",
      optionsText: "100, 200, 300, 400, 500",
    },
    {
      id: "field_signature",
      label: "Signature",
      key: "signature",
      type: "signature",
      required: false,
      sortOrder: 5,
      aliasesText: "Sign",
      optionsText: "",
    },
  ],
};

function createBlankField(existingKeys: string[]): DraftField {
  const key = dedupeFieldKey("new_field", existingKeys);

  return {
    id: makeClientId("field"),
    label: "New Field",
    key,
    type: "text",
    required: false,
    sortOrder: existingKeys.length + 1,
    aliasesText: "",
    optionsText: "",
  };
}

function reorderFields(fields: DraftField[]) {
  return fields.map((field, index) => ({
    ...field,
    sortOrder: index + 1,
  }));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

function fieldFromDraft(field: DraftField, index: number): TemplateField {
  return {
    id: field.id,
    label: field.label.trim(),
    key: field.key,
    type: field.type,
    required: field.required,
    sortOrder: index + 1,
    aliases: splitCommaList(field.aliasesText),
    options: field.type === "select" ? splitCommaList(field.optionsText) : [],
  };
}

function eventToDraft(event: CrowdLogEvent): EventDraft {
  return {
    title: event.title,
    description: event.description,
    eventDate: event.eventDate,
    templateName: event.template.name,
    fields: event.template.fields.map((field) => ({
      ...field,
      aliasesText: field.aliases.join(", "),
      optionsText: field.options.join(", "),
    })),
  };
}

function addFieldToEvent(
  event: CrowdLogEvent,
  field: TemplateField,
): CrowdLogEvent {
  return {
    ...event,
    template: {
      ...event.template,
      fields: [...event.template.fields, field].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      ),
    },
  };
}

function eventRoleForUser(
  event: CrowdLogEvent | null,
  user: AuthUser | null,
): EventMemberRole | null {
  if (!event || !user) {
    return null;
  }

  const membership = event.members.find((member) => member.userId === user.id);

  if (membership) {
    return membership.role;
  }

  return event.ownerId === user.id ? "owner" : null;
}

function canManageEvent(event: CrowdLogEvent | null, user: AuthUser | null) {
  return eventRoleForUser(event, user) === "owner";
}

function shouldOpenPortfolioDemo() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("portfolioDemo") === "1";
}

function findPortfolioDemoEvent(events: CrowdLogEvent[]) {
  if (!shouldOpenPortfolioDemo()) {
    return null;
  }

  return events.find((event) => event.title === PORTFOLIO_DEMO_EVENT_TITLE) ?? null;
}

function portfolioDemoMissingStatus(): StatusMessage {
  return {
    tone: "error",
    text: "Portfolio demo event not found. Run npm run seed:portfolio, then sign in as owner.demo@crowdlog.local.",
  };
}

function valueToString(value: RecordCellValue | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function valueToBoolean(value: RecordCellValue | undefined) {
  return value === true || value === "true" || value === "signed";
}

function confidenceLabel(confidence: number | null | undefined) {
  if (confidence === null || confidence === undefined) {
    return "n/a";
  }

  return `${Math.round(confidence * 100)}%`;
}

function toPositiveInteger(value: string, fallback: number) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return parsedValue;
}

function getReviewCounts(records: AttendanceRecord[]) {
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

function percentage(part: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((part / total) * 100);
}

function formatPercentage(part: number, total: number) {
  return `${percentage(part, total)}%`;
}

function formatShortDateTime(value: string | null | undefined) {
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

function getDocumentReports(
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

function getReviewerReports(
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

function latestDate(
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

function filterReviewRecords(
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

function createCsvContent(
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

function downloadCsv(fileName: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });

  downloadBlob(fileName, blob);
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function toFileSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "crowdlog-export";
}

type StatusMessage = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

export function TemplateBuilder() {
  const [draft, setDraft] = useState<EventDraft>(starterDraft);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authDraft, setAuthDraft] = useState({ email: "", name: "" });
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [savedEvents, setSavedEvents] = useState<CrowdLogEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [reviewEvent, setReviewEvent] = useState<CrowdLogEvent | null>(null);
  const [documents, setDocuments] = useState<AttendanceDocumentSummary[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [replacingDocumentId, setReplacingDocumentId] = useState<string | null>(
    null,
  );
  const [deletingDocumentIds, setDeletingDocumentIds] = useState<string[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [isMockExtracting, setIsMockExtracting] = useState(false);
  const [isExportingAllCsv, setIsExportingAllCsv] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [busyRecordIds, setBusyRecordIds] = useState<string[]>([]);
  const [deletingEventIds, setDeletingEventIds] = useState<string[]>([]);
  const [memberDraft, setMemberDraft] = useState({ email: "", name: "" });
  const [isAddingReviewer, setIsAddingReviewer] = useState(false);
  const [removingMemberIds, setRemovingMemberIds] = useState<string[]>([]);
  const [updatingMemberIds, setUpdatingMemberIds] = useState<string[]>([]);
  const [fieldSuggestions, setFieldSuggestions] = useState<OcrFieldSuggestion[]>(
    [],
  );
  const [addingFieldKeys, setAddingFieldKeys] = useState<string[]>([]);
  const [reviewStatus, setReviewStatus] = useState<StatusMessage>(null);

  useEffect(() => {
    let shouldIgnore = false;

    async function loadSession() {
      try {
        const session = await getCurrentSession();

        if (!shouldIgnore) {
          setCurrentUser(session.user);
          setAuthDraft((currentDraft) => ({
            ...currentDraft,
            email: session.user?.email ?? currentDraft.email,
            name: session.user?.name ?? currentDraft.name,
          }));
        }

        if (!session.user) {
          if (!shouldIgnore) {
            if (shouldOpenPortfolioDemo()) {
              setAuthDraft({
                email: PORTFOLIO_DEMO_OWNER_EMAIL,
                name: PORTFOLIO_DEMO_OWNER_NAME,
              });
            }
            setSavedEvents([]);
            setStatus({
              tone: "info",
              text: shouldOpenPortfolioDemo()
                ? "Sign in to open the portfolio demo event."
                : "Sign in to load your events.",
            });
          }
          return;
        }

        const events = await listEvents();
        const portfolioDemoEvent = findPortfolioDemoEvent(events);

        if (!shouldIgnore) {
          setSavedEvents(events);
          setStatus(null);

          if (portfolioDemoEvent) {
            setDraft(eventToDraft(portfolioDemoEvent));
            setReviewEvent(portfolioDemoEvent);
            setIsLoadingRecords(true);
            setIsLoadingDocuments(true);
            setFieldSuggestions([]);
            setReviewStatus({
              tone: "info",
              text: "Loading portfolio demo event.",
            });
          }

          if (shouldOpenPortfolioDemo() && !portfolioDemoEvent) {
            setStatus(portfolioDemoMissingStatus());
          }
        }

        if (portfolioDemoEvent) {
          try {
            const [nextDocuments, nextRecords] = await Promise.all([
              listDocuments(portfolioDemoEvent.id),
              listRecords(portfolioDemoEvent.id),
            ]);

            if (!shouldIgnore) {
              setDocuments(nextDocuments);
              setSelectedDocumentId(nextDocuments[0]?.id ?? "");
              setRecords(nextRecords);
              setReviewStatus({ tone: "success", text: "Portfolio demo loaded." });
            }
          } catch {
            if (!shouldIgnore) {
              setDocuments([]);
              setSelectedDocumentId("");
              setRecords([]);
              setReviewStatus({
                tone: "error",
                text: "Could not load the portfolio demo event.",
              });
            }
          } finally {
            if (!shouldIgnore) {
              setIsLoadingRecords(false);
              setIsLoadingDocuments(false);
            }
          }
        }
      } catch {
        if (!shouldIgnore) {
          setStatus({
            tone: "error",
            text: "Could not load your session from the API.",
          });
        }
      } finally {
        if (!shouldIgnore) {
          setIsLoadingSession(false);
          setIsLoadingEvents(false);
        }
      }
    }

    void loadSession();

    return () => {
      shouldIgnore = true;
    };
  }, []);

  const templateFields = useMemo(
    () =>
      draft.fields
        .filter((field) => field.label.trim())
        .map((field, index) => fieldFromDraft(field, index)),
    [draft.fields],
  );

  const previewPayload = useMemo(
    () => ({
      event: {
        title: draft.title.trim() || "Untitled event",
        description: draft.description.trim(),
        eventDate: draft.eventDate || null,
      },
      attendanceTemplate: {
        name: draft.templateName.trim() || "Attendance template",
        fields: templateFields,
      },
    }),
    [
      draft.description,
      draft.eventDate,
      draft.templateName,
      draft.title,
      templateFields,
    ],
  );

  const requiredCount = templateFields.filter((field) => field.required).length;
  const fieldTypeSummary = FIELD_TYPES.map((type) => ({
    type,
    count: templateFields.filter((field) => field.type === type).length,
  })).filter((entry) => entry.count > 0);
  const canManageReviewEvent = canManageEvent(reviewEvent, currentUser);

  async function signIn() {
    const email = authDraft.email.trim();
    const name = authDraft.name.trim();

    if (!email) {
      setStatus({ tone: "error", text: "Email is required to sign in." });
      return;
    }

    setIsSigningIn(true);
    setStatus({ tone: "info", text: "Signing in." });

    try {
      const session = await apiSignIn({
        email,
        name: name || undefined,
      });
      const events = await listEvents();
      const portfolioDemoEvent = findPortfolioDemoEvent(events);

      setCurrentUser(session.user);
      setSavedEvents(events);
      setStatus({ tone: "success", text: "Signed in." });

      if (portfolioDemoEvent) {
        setDraft(eventToDraft(portfolioDemoEvent));
        await selectReviewEvent(portfolioDemoEvent);
      } else if (shouldOpenPortfolioDemo()) {
        setStatus(portfolioDemoMissingStatus());
      }
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not sign in. ${getErrorMessage(error)}`,
      });
    } finally {
      setIsSigningIn(false);
      setIsLoadingEvents(false);
    }
  }

  async function signOut() {
    setIsSigningIn(true);

    try {
      await apiSignOut();
    } catch {
      // Clearing local state is still the least surprising result for sign out.
    } finally {
      setCurrentUser(null);
      setSavedEvents([]);
      setReviewEvent(null);
      setDocuments([]);
      setSelectedDocumentId("");
      setRecords([]);
      setMemberDraft({ email: "", name: "" });
      setRemovingMemberIds([]);
      setFieldSuggestions([]);
      setReviewStatus(null);
      setStatus({ tone: "info", text: "Signed out." });
      setIsLoadingEvents(false);
      setIsSigningIn(false);
    }
  }

  function updateDraft<K extends keyof EventDraft>(
    key: K,
    value: EventDraft[K],
  ) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [key]: value,
    }));
  }

  function updateField(
    id: string,
    updater: (field: DraftField, fields: DraftField[]) => DraftField,
  ) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      fields: currentDraft.fields.map((field) =>
        field.id === id ? updater(field, currentDraft.fields) : field,
      ),
    }));
  }

  function updateFieldLabel(id: string, label: string) {
    updateField(id, (field, fields) => {
      const otherKeys = fields
        .filter((currentField) => currentField.id !== id)
        .map((currentField) => currentField.key);
      const nextKey = dedupeFieldKey(normalizeFieldKey(label), otherKeys);

      return {
        ...field,
        label,
        key: nextKey,
      };
    });
  }

  function addField() {
    setDraft((currentDraft) => ({
      ...currentDraft,
      fields: reorderFields([
        ...currentDraft.fields,
        createBlankField(currentDraft.fields.map((field) => field.key)),
      ]),
    }));
    setStatus({ tone: "info", text: "Field added." });
  }

  function replaceSavedEvent(nextEvent: CrowdLogEvent) {
    setSavedEvents((currentEvents) =>
      currentEvents.map((event) =>
        event.id === nextEvent.id ? nextEvent : event,
      ),
    );

    setReviewEvent((currentEvent) =>
      currentEvent?.id === nextEvent.id ? nextEvent : currentEvent,
    );
  }

  function removeField(id: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      fields: reorderFields(
        currentDraft.fields.filter((field) => field.id !== id),
      ),
    }));
  }

  function moveField(id: string, direction: -1 | 1) {
    setDraft((currentDraft) => {
      const index = currentDraft.fields.findIndex((field) => field.id === id);
      const nextIndex = index + direction;

      if (index < 0 || nextIndex < 0 || nextIndex >= currentDraft.fields.length) {
        return currentDraft;
      }

      const fields = [...currentDraft.fields];
      const [field] = fields.splice(index, 1);
      fields.splice(nextIndex, 0, field);

      return {
        ...currentDraft,
        fields: reorderFields(fields),
      };
    });
  }

  async function saveEventTemplate() {
    if (!currentUser) {
      setStatus({ tone: "error", text: "Sign in before saving an event." });
      return;
    }

    const title = draft.title.trim();
    const templateName = draft.templateName.trim();
    const fields = templateFields;

    if (!title) {
      setStatus({ tone: "error", text: "Event title is required." });
      return;
    }

    if (!templateName) {
      setStatus({ tone: "error", text: "Template name is required." });
      return;
    }

    if (fields.length === 0) {
      setStatus({ tone: "error", text: "Add at least one attendance field." });
      return;
    }

    const payload: CreateEventPayload = {
      title,
      description: draft.description.trim(),
      eventDate: draft.eventDate || undefined,
      templateName,
      fields: fields.map((field) => ({
        label: field.label,
        key: field.key,
        type: field.type,
        required: field.required,
        sortOrder: field.sortOrder,
        aliases: field.aliases,
        options: field.options,
      })),
    };

    setIsSaving(true);

    try {
      const event = await createEvent(payload);
      setSavedEvents((currentEvents) => [event, ...currentEvents]);
      setStatus({ tone: "success", text: "Event template saved to Supabase." });
      setReviewEvent(event);
      setDocuments([]);
      setSelectedDocumentId("");
      setRecords([]);
      setFieldSuggestions([]);
      setReviewStatus({
        tone: "info",
        text: "Template ready for extraction.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not save the event. ${getErrorMessage(error)}`,
      });
    } finally {
      setIsSaving(false);
    }
  }

  function resetDraft() {
    setDraft({
      ...starterDraft,
      fields: starterDraft.fields.map((field) => ({ ...field })),
    });
    setStatus({ tone: "info", text: "Draft reset to the starter template." });
  }

  function loadSavedEvent(event: CrowdLogEvent) {
    setDraft(eventToDraft(event));
    setStatus({ tone: "info", text: "Saved event loaded into the editor." });
  }

  async function selectReviewEvent(event: CrowdLogEvent) {
    setReviewEvent(event);
    setIsLoadingRecords(true);
    setIsLoadingDocuments(true);
    setFieldSuggestions([]);
    setReviewStatus({ tone: "info", text: "Loading documents and records." });

    try {
      const [nextDocuments, nextRecords] = await Promise.all([
        listDocuments(event.id),
        listRecords(event.id),
      ]);
      setDocuments(nextDocuments);
      setSelectedDocumentId(nextDocuments[0]?.id ?? "");
      setRecords(nextRecords);
      setReviewStatus(
        nextRecords.length
          ? { tone: "success", text: "Review records loaded." }
          : { tone: "info", text: "No extracted records for this event yet." },
      );
    } catch {
      setDocuments([]);
      setSelectedDocumentId("");
      setRecords([]);
      setFieldSuggestions([]);
      setReviewStatus({
        tone: "error",
        text: "Could not load documents and records for review.",
      });
    } finally {
      setIsLoadingRecords(false);
      setIsLoadingDocuments(false);
    }
  }

  async function deleteSavedEvent(event: CrowdLogEvent) {
    if (!canManageEvent(event, currentUser)) {
      setStatus({ tone: "error", text: "Only event owners can delete events." });
      return;
    }

    const shouldDelete = window.confirm(
      `Delete "${event.title}" and its extracted records?`,
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingEventIds((currentIds) => [...currentIds, event.id]);

    try {
      await deleteEvent(event.id);
      setSavedEvents((currentEvents) =>
        currentEvents.filter((currentEvent) => currentEvent.id !== event.id),
      );

      if (reviewEvent?.id === event.id) {
        setReviewEvent(null);
        setDocuments([]);
        setSelectedDocumentId("");
        setRecords([]);
        setFieldSuggestions([]);
        setReviewStatus({ tone: "info", text: "Deleted event removed." });
      }

      setStatus({ tone: "success", text: "Saved event deleted." });
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not delete the event. ${getErrorMessage(error)}`,
      });
    } finally {
      setDeletingEventIds((currentIds) =>
        currentIds.filter((eventId) => eventId !== event.id),
      );
    }
  }

  async function addReviewer() {
    if (!reviewEvent || !canManageReviewEvent) {
      setReviewStatus({
        tone: "error",
        text: "Only event owners can add reviewers.",
      });
      return;
    }

    const email = memberDraft.email.trim();
    const name = memberDraft.name.trim();

    if (!email) {
      setReviewStatus({ tone: "error", text: "Reviewer email is required." });
      return;
    }

    setIsAddingReviewer(true);
    setReviewStatus({ tone: "info", text: "Adding reviewer." });

    try {
      const nextEvent = await addEventReviewer(reviewEvent.id, {
        email,
        name: name || undefined,
      });

      replaceSavedEvent(nextEvent);
      setMemberDraft({ email: "", name: "" });
      setReviewStatus({ tone: "success", text: "Reviewer added." });
    } catch (error) {
      setReviewStatus({
        tone: "error",
        text: `Could not add reviewer. ${getErrorMessage(error)}`,
      });
    } finally {
      setIsAddingReviewer(false);
    }
  }

  async function removeReviewer(member: EventMember) {
    if (!reviewEvent || !canManageReviewEvent) {
      setReviewStatus({
        tone: "error",
        text: "Only event owners can remove reviewers.",
      });
      return;
    }

    const shouldRemove = window.confirm(`Remove ${member.email} from this event?`);

    if (!shouldRemove) {
      return;
    }

    setRemovingMemberIds((currentIds) => [...currentIds, member.id]);

    try {
      const nextEvent = await removeEventMember(reviewEvent.id, member.id);
      replaceSavedEvent(nextEvent);
      setReviewStatus({ tone: "success", text: "Reviewer removed." });
    } catch (error) {
      setReviewStatus({
        tone: "error",
        text: `Could not remove reviewer. ${getErrorMessage(error)}`,
      });
    } finally {
      setRemovingMemberIds((currentIds) =>
        currentIds.filter((memberId) => memberId !== member.id),
      );
    }
  }

  async function changeMemberRole(
    member: EventMember,
    nextRole: EventMemberRole,
  ) {
    if (!reviewEvent || !canManageReviewEvent) {
      setReviewStatus({
        tone: "error",
        text: "Only event owners can change member roles.",
      });
      return;
    }

    if (member.role === nextRole) {
      return;
    }

    const ownerCount = reviewEvent.members.filter(
      (eventMember) => eventMember.role === "owner",
    ).length;

    if (member.role === "owner" && nextRole === "reviewer" && ownerCount <= 1) {
      setReviewStatus({
        tone: "error",
        text: "Add another owner before changing this owner to reviewer.",
      });
      return;
    }

    const targetName = member.name || member.email;
    const isCurrentUser = member.userId === currentUser?.id;
    const confirmText =
      nextRole === "owner"
        ? `Make ${targetName} an owner of this event?`
        : isCurrentUser
          ? "Change your role to reviewer? You will lose owner controls for this event."
          : `Change ${targetName} to reviewer?`;

    if (!window.confirm(confirmText)) {
      return;
    }

    setUpdatingMemberIds((currentIds) => [...currentIds, member.id]);
    setReviewStatus({ tone: "info", text: "Updating member role." });

    try {
      const nextEvent = await updateEventMember(reviewEvent.id, member.id, {
        role: nextRole,
      });
      replaceSavedEvent(nextEvent);
      setReviewStatus({
        tone: "success",
        text:
          nextRole === "owner"
            ? "Member promoted to owner."
            : "Member changed to reviewer.",
      });
    } catch (error) {
      setReviewStatus({
        tone: "error",
        text: `Could not update member role. ${getErrorMessage(error)}`,
      });
    } finally {
      setUpdatingMemberIds((currentIds) =>
        currentIds.filter((memberId) => memberId !== member.id),
      );
    }
  }

  async function uploadReviewDocument(file: File) {
    if (!reviewEvent) {
      setReviewStatus({ tone: "error", text: "Select a saved event first." });
      return;
    }

    setIsUploadingDocument(true);
    setReviewStatus({ tone: "info", text: "Uploading attendance sheet." });

    try {
      const document = await uploadAttendanceDocument(reviewEvent.id, file);
      setDocuments((currentDocuments) => [document, ...currentDocuments]);
      setSelectedDocumentId(document.id);
      setReviewStatus({ tone: "success", text: "Attendance sheet uploaded." });
    } catch {
      setReviewStatus({
        tone: "error",
        text: "Could not upload this attendance sheet.",
      });
    } finally {
      setIsUploadingDocument(false);
    }
  }

  async function replaceReviewDocument(file: File) {
    if (!selectedDocumentId) {
      setReviewStatus({ tone: "error", text: "Select a file to replace." });
      return;
    }

    setReplacingDocumentId(selectedDocumentId);
    setReviewStatus({ tone: "info", text: "Replacing attendance sheet." });

    try {
      const document = await replaceAttendanceDocument(selectedDocumentId, file);

      setDocuments((currentDocuments) =>
        currentDocuments.map((currentDocument) =>
          currentDocument.id === document.id ? document : currentDocument,
        ),
      );
      setRecords((currentRecords) =>
        currentRecords.filter((record) => record.documentId !== document.id),
      );
      setFieldSuggestions([]);
      setSelectedDocumentId(document.id);
      setReviewStatus({
        tone: "success",
        text: "Attendance sheet replaced. Run extraction again when ready.",
      });
    } catch (error) {
      setReviewStatus({
        tone: "error",
        text: `Could not replace this attendance sheet. ${getErrorMessage(error)}`,
      });
    } finally {
      setReplacingDocumentId(null);
    }
  }

  async function deleteReviewDocument(document: AttendanceDocumentSummary) {
    const shouldDelete = window.confirm(
      `Delete ${document.fileName} and its extracted rows?`,
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingDocumentIds((currentIds) => [...currentIds, document.id]);
    setReviewStatus({ tone: "info", text: "Deleting attendance sheet." });

    try {
      await deleteAttendanceDocument(document.id);

      const nextDocuments = documents.filter(
        (currentDocument) => currentDocument.id !== document.id,
      );

      setDocuments(nextDocuments);
      setSelectedDocumentId((currentDocumentId) =>
        currentDocumentId === document.id
          ? nextDocuments[0]?.id ?? ""
          : currentDocumentId,
      );
      setRecords((currentRecords) =>
        currentRecords.filter((record) => record.documentId !== document.id),
      );
      setFieldSuggestions([]);
      setReviewStatus({
        tone: "success",
        text: "Attendance sheet deleted.",
      });
    } catch (error) {
      setReviewStatus({
        tone: "error",
        text: `Could not delete this attendance sheet. ${getErrorMessage(error)}`,
      });
    } finally {
      setDeletingDocumentIds((currentIds) =>
        currentIds.filter((documentId) => documentId !== document.id),
      );
    }
  }

  async function runMockExtraction(options?: DocumentExtractionOptions) {
    if (!reviewEvent) {
      setReviewStatus({ tone: "error", text: "Select a saved event first." });
      return;
    }

    setIsMockExtracting(true);
    setReviewStatus({
      tone: "info",
      text: selectedDocumentId
        ? "Extracting selected file."
        : "Generating mock rows.",
    });

    try {
      const result = selectedDocumentId
        ? await extractDocument(selectedDocumentId, {
            rowCount: 25,
            ...options,
          })
        : await mockExtractRecords(reviewEvent.id, 4);
      setFieldSuggestions(result.suggestedFields ?? []);
      setRecords((currentRecords) => [
        ...result.records,
        ...currentRecords.filter(
          (record) => record.documentId !== result.document.id,
        ),
      ]);
      setDocuments((currentDocuments) => {
        const hasDocument = currentDocuments.some(
          (document) => document.id === result.document.id,
        );

        if (hasDocument) {
          return currentDocuments.map((document) =>
            document.id === result.document.id ? result.document : document,
          );
        }

        return [result.document, ...currentDocuments];
      });
      setSelectedDocumentId(result.document.id);
      setReviewStatus({
        tone: "success",
        text: selectedDocumentId
          ? `Extracted ${result.records.length} rows for review.`
          : `Generated ${result.records.length} mock rows for review.`,
      });
    } catch (error) {
      setReviewStatus({
        tone: "error",
        text: `Could not create mock extracted rows. ${getErrorMessage(error)}`,
      });
    } finally {
      setIsMockExtracting(false);
    }
  }

  async function exportAllEventRecords() {
    if (!reviewEvent) {
      setReviewStatus({ tone: "error", text: "Select a saved event first." });
      return;
    }

    setIsExportingAllCsv(true);
    setReviewStatus({ tone: "info", text: "Preparing full CSV export." });

    try {
      const exportFile = await exportEventRecordsCsv(reviewEvent.id);

      downloadBlob(exportFile.fileName, exportFile.blob);
      setReviewStatus({
        tone: "success",
        text: "Full event CSV export downloaded.",
      });
    } catch (error) {
      setReviewStatus({
        tone: "error",
        text: `Could not export full CSV. ${getErrorMessage(error)}`,
      });
    } finally {
      setIsExportingAllCsv(false);
    }
  }

  async function exportEventRecordsExcel() {
    if (!reviewEvent) {
      setReviewStatus({ tone: "error", text: "Select a saved event first." });
      return;
    }

    setIsExportingExcel(true);
    setReviewStatus({ tone: "info", text: "Preparing Excel export." });

    try {
      const exportFile = await exportEventRecordsXlsx(reviewEvent.id);

      downloadBlob(exportFile.fileName, exportFile.blob);
      setReviewStatus({
        tone: "success",
        text: "Excel export downloaded.",
      });
    } catch (error) {
      setReviewStatus({
        tone: "error",
        text: `Could not export Excel file. ${getErrorMessage(error)}`,
      });
    } finally {
      setIsExportingExcel(false);
    }
  }

  async function addSuggestedField(suggestion: OcrFieldSuggestion) {
    if (!reviewEvent) {
      return;
    }

    if (!canManageReviewEvent) {
      setReviewStatus({
        tone: "error",
        text: "Only event owners can add suggested fields.",
      });
      return;
    }

    setAddingFieldKeys((currentKeys) => [...currentKeys, suggestion.key]);

    try {
      const field = await createTemplateField(reviewEvent.template.id, {
        label: suggestion.label,
        key: suggestion.key,
        type: suggestion.type,
        required: false,
        sortOrder: reviewEvent.template.fields.length + 1,
        aliases: suggestion.aliases,
        options: suggestion.options,
      });
      const nextEvent = addFieldToEvent(reviewEvent, field);

      setReviewEvent(nextEvent);
      setSavedEvents((currentEvents) =>
        currentEvents.map((event) =>
          event.id === nextEvent.id ? nextEvent : event,
        ),
      );
      setFieldSuggestions((currentSuggestions) =>
        currentSuggestions.filter(
          (currentSuggestion) => currentSuggestion.key !== suggestion.key,
        ),
      );

      if (!selectedDocumentId) {
        setReviewStatus({
          tone: "success",
          text: `${field.label} added to the template.`,
        });
        return;
      }

      const result = await extractDocument(selectedDocumentId, { rowCount: 25 });
      setRecords((currentRecords) => [
        ...result.records,
        ...currentRecords.filter(
          (record) => record.documentId !== result.document.id,
        ),
      ]);
      setDocuments((currentDocuments) =>
        currentDocuments.map((document) =>
          document.id === result.document.id ? result.document : document,
        ),
      );
      setFieldSuggestions(result.suggestedFields ?? []);
      setReviewStatus({
        tone: "success",
        text: `${field.label} added and the selected file was re-extracted.`,
      });
    } catch (error) {
      setReviewStatus({
        tone: "error",
        text: `Could not add suggested field. ${getErrorMessage(error)}`,
      });
    } finally {
      setAddingFieldKeys((currentKeys) =>
        currentKeys.filter((key) => key !== suggestion.key),
      );
    }
  }

  function updateRecordCell(
    recordId: string,
    fieldKey: string,
    value: RecordCellValue,
  ) {
    setRecords((currentRecords) =>
      currentRecords.map((record) =>
        record.id === recordId
          ? {
              ...record,
              status:
                record.status === "approved" || record.status === "rejected"
                  ? "needs_review"
                  : record.status,
              data: {
                ...record.data,
                [fieldKey]: value,
              },
              values: record.values.map((recordValue) =>
                recordValue.fieldKey === fieldKey
                  ? {
                      ...recordValue,
                      rawValue: valueToString(value),
                      normalizedValue: valueToString(value),
                      confidence: 1,
                      validationIssues: [],
                    }
                  : recordValue,
              ),
            }
          : record,
      ),
    );
  }

  function setRecordBusy(recordId: string, isBusy: boolean) {
    setBusyRecordIds((currentIds) =>
      isBusy
        ? Array.from(new Set([...currentIds, recordId]))
        : currentIds.filter((currentId) => currentId !== recordId),
    );
  }

  function replaceRecord(updatedRecord: AttendanceRecord) {
    setRecords((currentRecords) =>
      currentRecords.map((record) =>
        record.id === updatedRecord.id ? updatedRecord : record,
      ),
    );
  }

  async function saveRecord(record: AttendanceRecord) {
    setRecordBusy(record.id, true);

    try {
      const updatedRecord = await updateAttendanceRecord(record.id, {
        data: record.data,
        status: record.status,
      });
      replaceRecord(updatedRecord);
      setReviewStatus({ tone: "success", text: "Row saved." });
    } catch {
      setReviewStatus({ tone: "error", text: "Could not save row changes." });
    } finally {
      setRecordBusy(record.id, false);
    }
  }

  async function approveRecordRow(record: AttendanceRecord) {
    setRecordBusy(record.id, true);

    try {
      await updateAttendanceRecord(record.id, { data: record.data });
      const updatedRecord = await approveAttendanceRecord(record.id);
      replaceRecord(updatedRecord);
      setReviewStatus({ tone: "success", text: "Row approved." });
    } catch {
      setReviewStatus({ tone: "error", text: "Could not approve row." });
    } finally {
      setRecordBusy(record.id, false);
    }
  }

  async function rejectRecordRow(record: AttendanceRecord) {
    setRecordBusy(record.id, true);

    try {
      const updatedRecord = await rejectAttendanceRecord(record.id);
      replaceRecord(updatedRecord);
      setReviewStatus({ tone: "success", text: "Row rejected." });
    } catch {
      setReviewStatus({ tone: "error", text: "Could not reject row." });
    } finally {
      setRecordBusy(record.id, false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8f4] text-[#1f2a22]">
      <header className="border-b border-[#d9dfd3] bg-white">
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5f745f]">
              CrowdLog
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[#172017] sm:text-3xl">
              Attendance sheets into clean records.
            </h1>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap gap-2 text-xs font-medium text-[#36513f]">
              <span className="rounded-md border border-[#cbd8c8] bg-[#edf3ea] px-3 py-1.5">
                Auth phase
              </span>
              <span className="rounded-md border border-[#d7d0bd] bg-[#f8f1dd] px-3 py-1.5">
                Owner events
              </span>
              <span className="rounded-md border border-[#c9d9dd] bg-[#e9f4f5] px-3 py-1.5">
                OCR review
              </span>
            </div>
            <AuthPanel
              currentUser={currentUser}
              authDraft={authDraft}
              isLoadingSession={isLoadingSession}
              isSigningIn={isSigningIn}
              onAuthDraftChange={setAuthDraft}
              onSignIn={signIn}
              onSignOut={signOut}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1480px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section id="portfolio-template-builder" className="scroll-mt-5 space-y-5">
          <div className="rounded-lg border border-[#d9dfd3] bg-white">
            <div className="border-b border-[#e1e5dc] px-4 py-4 sm:px-5">
              <h2 className="text-lg font-semibold text-[#172017]">Event</h2>
            </div>
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
                Event title
                <input
                  value={draft.title}
                  onChange={(event) => updateDraft("title", event.target.value)}
                  className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
                Event date
                <input
                  type="date"
                  value={draft.eventDate}
                  onChange={(event) =>
                    updateDraft("eventDate", event.target.value)
                  }
                  className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-[#334033] sm:col-span-2">
                Description
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    updateDraft("description", event.target.value)
                  }
                  rows={3}
                  className="min-h-24 resize-y rounded-md border border-[#cbd5c8] bg-white px-3 py-2 text-sm font-normal outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-[#d9dfd3] bg-white">
            <div className="flex flex-col gap-3 border-b border-[#e1e5dc] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="text-lg font-semibold text-[#172017]">
                  Attendance template
                </h2>
                <p className="mt-1 text-sm text-[#667265]">
                  Event - Template - Fields
                </p>
              </div>
              <button
                type="button"
                onClick={addField}
                className="h-10 rounded-md bg-[#2f6f4e] px-4 text-sm font-semibold text-white transition hover:bg-[#265c41] focus:outline-none focus:ring-2 focus:ring-[#a8d3b7]"
              >
                + Add field
              </button>
            </div>

            <div className="px-4 py-4 sm:px-5">
              <label className="mb-4 grid gap-1.5 text-sm font-medium text-[#334033]">
                Template name
                <input
                  value={draft.templateName}
                  onChange={(event) =>
                    updateDraft("templateName", event.target.value)
                  }
                  className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                />
              </label>

              <div className="space-y-3">
                {draft.fields.map((field, index) => (
                  <article
                    key={field.id}
                    className="overflow-hidden rounded-lg border border-[#dfe4dc] bg-[#fbfcf9]"
                  >
                    <div className="flex flex-col gap-3 border-b border-[#e3e8df] bg-[#f6f8f2] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-md bg-[#2f6f4e] px-2 text-sm font-semibold text-white">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#172017]">
                            {field.label || `Field ${index + 1}`}
                          </p>
                          <code className="mt-1 block truncate text-xs font-medium text-[#647364]">
                            {field.key}
                          </code>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className="inline-flex h-8 items-center rounded-md border border-[#cbd8c8] bg-white px-2.5 text-xs font-semibold text-[#36513f]">
                          {FIELD_TYPE_LABELS[field.type]}
                        </span>
                        {field.required ? (
                          <span className="inline-flex h-8 items-center rounded-md border border-[#d7d0bd] bg-[#f8f1dd] px-2.5 text-xs font-semibold text-[#66562b]">
                            Required
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-3 px-3 py-3 sm:grid-cols-2 sm:px-4 xl:grid-cols-[minmax(220px,1fr)_150px_150px_minmax(220px,1fr)]">
                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265] xl:col-span-2">
                        Label
                        <input
                          value={field.label}
                          onChange={(event) =>
                            updateFieldLabel(field.id, event.target.value)
                          }
                          className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                        Type
                        <select
                          value={field.type}
                          onChange={(event) =>
                            updateField(field.id, (currentField) => ({
                              ...currentField,
                              type: event.target.value as FieldType,
                            }))
                          }
                          className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                        >
                          {FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {FIELD_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex h-10 items-center gap-2 self-end rounded-md border border-[#dfe4dc] bg-white px-3 text-sm font-medium text-[#334033]">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) =>
                            updateField(field.id, (currentField) => ({
                              ...currentField,
                              required: event.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-[#aebbac] accent-[#2f6f4e]"
                        />
                        Required
                      </label>

                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265] sm:col-span-2 xl:col-span-2">
                        Aliases
                        <input
                          value={field.aliasesText}
                          onChange={(event) =>
                            updateField(field.id, (currentField) => ({
                              ...currentField,
                              aliasesText: event.target.value,
                            }))
                          }
                          className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265] sm:col-span-2 xl:col-span-2">
                        Options
                        <input
                          value={field.optionsText}
                          disabled={field.type !== "select"}
                          onChange={(event) =>
                            updateField(field.id, (currentField) => ({
                              ...currentField,
                              optionsText: event.target.value,
                            }))
                          }
                          className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition disabled:bg-[#f1f3ee] disabled:text-[#8a9588] focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                        />
                      </label>
                    </div>

                    <div className="flex flex-col gap-2 border-t border-[#e8ece5] bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-4">
                      <button
                        type="button"
                        onClick={() => moveField(field.id, -1)}
                        disabled={index === 0}
                        className="h-10 rounded-md border border-[#cbd5c8] px-3 text-sm font-medium text-[#334033] transition hover:bg-[#f3f5ef] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(field.id, 1)}
                        disabled={index === draft.fields.length - 1}
                        className="h-10 rounded-md border border-[#cbd5c8] px-3 text-sm font-medium text-[#334033] transition hover:bg-[#f3f5ef] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        onClick={() => removeField(field.id)}
                        className="h-10 rounded-md border border-[#d9b7aa] px-3 text-sm font-medium text-[#8a3d2d] transition hover:bg-[#fff1ed]"
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-h-6 text-sm">
                  {status ? (
                    <p
                      className={
                        status.tone === "success"
                          ? "font-medium text-[#2f6f4e]"
                          : status.tone === "error"
                            ? "font-medium text-[#a33f2f]"
                            : "font-medium text-[#546657]"
                      }
                    >
                      {status.text}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={resetDraft}
                    className="h-11 rounded-md border border-[#cbd5c8] px-4 text-sm font-semibold text-[#334033] transition hover:bg-[#f3f5ef]"
                  >
                    Reset draft
                  </button>
                    <button
                      type="button"
                      onClick={saveEventTemplate}
                    disabled={isSaving || !currentUser || isLoadingSession}
                      className="h-11 rounded-md bg-[#2f6f4e] px-4 text-sm font-semibold text-white transition hover:bg-[#265c41] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#a8d3b7]"
                    >
                    {isSaving ? "Saving..." : "Save event template"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <ReviewWorkspace
            reviewEvent={reviewEvent}
            currentUser={currentUser}
            canManageEvent={canManageReviewEvent}
            documents={documents}
            selectedDocumentId={selectedDocumentId}
            records={records}
            isLoadingDocuments={isLoadingDocuments}
            isUploadingDocument={isUploadingDocument}
            replacingDocumentId={replacingDocumentId}
            deletingDocumentIds={deletingDocumentIds}
            isLoadingRecords={isLoadingRecords}
            isMockExtracting={isMockExtracting}
            isExportingAllCsv={isExportingAllCsv}
            isExportingExcel={isExportingExcel}
            busyRecordIds={busyRecordIds}
            memberDraft={memberDraft}
            isAddingReviewer={isAddingReviewer}
            removingMemberIds={removingMemberIds}
            updatingMemberIds={updatingMemberIds}
            fieldSuggestions={fieldSuggestions}
            addingFieldKeys={addingFieldKeys}
            reviewStatus={reviewStatus}
            onMemberDraftChange={setMemberDraft}
            onAddReviewer={addReviewer}
            onRemoveReviewer={removeReviewer}
            onChangeMemberRole={changeMemberRole}
            onSelectDocument={setSelectedDocumentId}
            onUploadDocument={uploadReviewDocument}
            onReplaceDocument={replaceReviewDocument}
            onDeleteDocument={deleteReviewDocument}
            onMockExtract={runMockExtraction}
            onExportAllCsv={exportAllEventRecords}
            onExportExcel={exportEventRecordsExcel}
            onAddSuggestedField={addSuggestedField}
            onCellChange={updateRecordCell}
            onSave={saveRecord}
            onApprove={approveRecordRow}
            onReject={rejectRecordRow}
          />
        </section>

        <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          <section className="rounded-lg border border-[#d9dfd3] bg-white">
            <div className="border-b border-[#e1e5dc] px-4 py-4">
              <h2 className="text-lg font-semibold text-[#172017]">
                Template summary
              </h2>
            </div>
            <div className="grid gap-3 px-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <SummaryItem
                  label="Fields"
                  value={String(templateFields.length)}
                />
                <SummaryItem label="Required" value={String(requiredCount)} />
              </div>
              <div className="rounded-lg border border-[#e1e5dc] bg-[#fafbf8] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#667265]">
                  Field types
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {fieldTypeSummary.map((entry) => (
                    <span
                      key={entry.type}
                      className="rounded-md border border-[#d8dfd2] bg-white px-2.5 py-1 text-xs font-medium text-[#3b4a3b]"
                    >
                      {FIELD_TYPE_LABELS[entry.type]}: {entry.count}
                    </span>
                  ))}
                </div>
              </div>
              <pre className="max-h-[360px] overflow-auto rounded-lg border border-[#e1e5dc] bg-[#172017] p-3 text-xs leading-5 text-[#edf3ea]">
                {JSON.stringify(previewPayload, null, 2)}
              </pre>
            </div>
          </section>

          <section className="rounded-lg border border-[#d9dfd3] bg-white">
            <div className="border-b border-[#e1e5dc] px-4 py-4">
              <h2 className="text-lg font-semibold text-[#172017]">
                Saved events
              </h2>
            </div>
            <div className="divide-y divide-[#e5e9e2]">
              {isLoadingEvents ? (
                <p className="px-4 py-4 text-sm text-[#667265]">
                  Loading saved events...
                </p>
              ) : savedEvents.length === 0 ? (
                <p className="px-4 py-4 text-sm text-[#667265]">
                  No saved templates yet.
                </p>
              ) : (
                savedEvents.map((event) => {
                  const isDeleting = deletingEventIds.includes(event.id);
                  const eventRole = eventRoleForUser(event, currentUser);
                  const isOwner = eventRole === "owner";

                  return (
                    <div key={event.id} className="px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#172017]">
                            {event.title}
                          </p>
                          <p className="mt-1 text-xs text-[#667265]">
                            {event.template.fields.length} fields
                          </p>
                          {eventRole ? (
                            <span className="mt-2 inline-flex rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2 py-1 text-xs font-semibold text-[#526052]">
                              {EVENT_ROLE_LABELS[eventRole]}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => loadSavedEvent(event)}
                            disabled={isDeleting}
                            className="h-9 rounded-md border border-[#cbd5c8] px-3 text-sm font-medium text-[#334033] transition hover:bg-[#f3f5ef] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() => selectReviewEvent(event)}
                            disabled={isDeleting}
                            className="h-9 rounded-md bg-[#2f6f4e] px-3 text-sm font-semibold text-white transition hover:bg-[#265c41] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Review
                          </button>
                          {isOwner ? (
                            <button
                              type="button"
                              onClick={() => deleteSavedEvent(event)}
                              disabled={isDeleting}
                              className="h-9 rounded-md border border-[#d9b7aa] px-3 text-sm font-semibold text-[#8a3d2d] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isDeleting ? "Deleting" : "Delete"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function AuthPanel({
  currentUser,
  authDraft,
  isLoadingSession,
  isSigningIn,
  onAuthDraftChange,
  onSignIn,
  onSignOut,
}: {
  currentUser: AuthUser | null;
  authDraft: { email: string; name: string };
  isLoadingSession: boolean;
  isSigningIn: boolean;
  onAuthDraftChange: (draft: { email: string; name: string }) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  if (isLoadingSession) {
    return (
      <div className="text-sm font-medium text-[#667265]">
        Checking session...
      </div>
    );
  }

  if (currentUser) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 text-sm">
          <span className="block truncate font-semibold text-[#172017]">
            {currentUser.name || currentUser.email}
          </span>
          <span className="block truncate text-xs text-[#667265]">
            {currentUser.email}
          </span>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningIn}
          className="h-9 rounded-md border border-[#cbd5c8] px-3 text-xs font-semibold text-[#334033] transition hover:bg-[#f3f5ef] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-2 sm:grid-cols-[180px_160px_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        onSignIn();
      }}
    >
      <input
        type="email"
        value={authDraft.email}
        placeholder="Email"
        onChange={(event) =>
          onAuthDraftChange({ ...authDraft, email: event.target.value })
        }
        className="h-9 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
      />
      <input
        value={authDraft.name}
        placeholder="Name"
        onChange={(event) =>
          onAuthDraftChange({ ...authDraft, name: event.target.value })
        }
        className="h-9 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
      />
      <button
        type="submit"
        disabled={isSigningIn}
        className="h-9 rounded-md bg-[#2f6f4e] px-3 text-xs font-semibold text-white transition hover:bg-[#265c41] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSigningIn ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}

type ReviewWorkspaceProps = {
  reviewEvent: CrowdLogEvent | null;
  currentUser: AuthUser | null;
  canManageEvent: boolean;
  documents: AttendanceDocumentSummary[];
  selectedDocumentId: string;
  records: AttendanceRecord[];
  isLoadingDocuments: boolean;
  isUploadingDocument: boolean;
  replacingDocumentId: string | null;
  deletingDocumentIds: string[];
  isLoadingRecords: boolean;
  isMockExtracting: boolean;
  isExportingAllCsv: boolean;
  isExportingExcel: boolean;
  busyRecordIds: string[];
  memberDraft: { email: string; name: string };
  isAddingReviewer: boolean;
  removingMemberIds: string[];
  updatingMemberIds: string[];
  fieldSuggestions: OcrFieldSuggestion[];
  addingFieldKeys: string[];
  reviewStatus: StatusMessage;
  onMemberDraftChange: (draft: { email: string; name: string }) => void;
  onAddReviewer: () => void;
  onRemoveReviewer: (member: EventMember) => void;
  onChangeMemberRole: (member: EventMember, nextRole: EventMemberRole) => void;
  onSelectDocument: (documentId: string) => void;
  onUploadDocument: (file: File) => void;
  onReplaceDocument: (file: File) => void;
  onDeleteDocument: (document: AttendanceDocumentSummary) => void;
  onMockExtract: (options?: DocumentExtractionOptions) => void;
  onExportAllCsv: () => void;
  onExportExcel: () => void;
  onAddSuggestedField: (suggestion: OcrFieldSuggestion) => void;
  onCellChange: (
    recordId: string,
    fieldKey: string,
    value: RecordCellValue,
  ) => void;
  onSave: (record: AttendanceRecord) => void;
  onApprove: (record: AttendanceRecord) => void;
  onReject: (record: AttendanceRecord) => void;
};

function ReviewWorkspace({
  reviewEvent,
  currentUser,
  canManageEvent,
  documents,
  selectedDocumentId,
  records,
  isLoadingDocuments,
  isUploadingDocument,
  replacingDocumentId,
  deletingDocumentIds,
  isLoadingRecords,
  isMockExtracting,
  isExportingAllCsv,
  isExportingExcel,
  busyRecordIds,
  memberDraft,
  isAddingReviewer,
  removingMemberIds,
  updatingMemberIds,
  fieldSuggestions,
  addingFieldKeys,
  reviewStatus,
  onMemberDraftChange,
  onAddReviewer,
  onRemoveReviewer,
  onChangeMemberRole,
  onSelectDocument,
  onUploadDocument,
  onReplaceDocument,
  onDeleteDocument,
  onMockExtract,
  onExportAllCsv,
  onExportExcel,
  onAddSuggestedField,
  onCellChange,
  onSave,
  onApprove,
  onReject,
}: ReviewWorkspaceProps) {
  const fields = useMemo(
    () => reviewEvent?.template.fields ?? [],
    [reviewEvent],
  );
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? null;
  const selectedDocumentIsPdf = selectedDocument?.fileType === "application/pdf";
  const [pdfPageStart, setPdfPageStart] = useState("1");
  const [pdfPageCount, setPdfPageCount] = useState("1");
  const [extractionLayout, setExtractionLayout] =
    useState<ExtractionLayout>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>("all");
  const reviewCounts = useMemo(() => getReviewCounts(records), [records]);
  const filteredRecords = useMemo(
    () => filterReviewRecords(records, fields, searchQuery, statusFilter),
    [fields, records, searchQuery, statusFilter],
  );

  function exportFilteredRecords() {
    if (!reviewEvent || filteredRecords.length === 0) {
      return;
    }

    const csvContent = createCsvContent(reviewEvent, fields, filteredRecords);
    const fileName = `${toFileSlug(reviewEvent.title)}-attendance.csv`;

    downloadCsv(fileName, csvContent);
  }

  function extractionOptions() {
    return {
      layout: extractionLayout,
      ...(selectedDocumentIsPdf
        ? {
            pageStart: toPositiveInteger(pdfPageStart, 1),
            pageCount: toPositiveInteger(pdfPageCount, 1),
          }
        : {}),
    };
  }

  return (
    <section
      id="portfolio-review-workspace"
      className="scroll-mt-5 rounded-lg border border-[#d9dfd3] bg-white"
    >
      <div className="flex flex-col gap-3 border-b border-[#e1e5dc] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-lg font-semibold text-[#172017]">
            Review extracted records
          </h2>
          <p className="mt-1 text-sm text-[#667265]">
            {reviewEvent
              ? reviewEvent.title
              : "Select a saved event to begin review."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          {selectedDocument ? (
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
              Layout
              <select
                value={extractionLayout}
                onChange={(event) =>
                  setExtractionLayout(event.target.value as ExtractionLayout)
                }
                className="h-10 w-32 rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
              >
                <option value="table">Table rows</option>
                <option value="form">Forms</option>
              </select>
            </label>
          ) : null}
          {selectedDocumentIsPdf ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Page start
                <input
                  type="number"
                  min={1}
                  value={pdfPageStart}
                  onChange={(event) => setPdfPageStart(event.target.value)}
                  className="h-10 w-24 rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Pages
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={pdfPageCount}
                  onChange={(event) => setPdfPageCount(event.target.value)}
                  className="h-10 w-24 rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                />
              </label>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => onMockExtract(extractionOptions())}
            disabled={!reviewEvent || isMockExtracting}
            className="h-10 rounded-md bg-[#2f6f4e] px-4 text-sm font-semibold text-white transition hover:bg-[#265c41] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isMockExtracting
              ? selectedDocument
                ? "Extracting..."
                : "Generating..."
              : selectedDocument
                ? "Extract selected file"
                : "Generate mock rows"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 sm:px-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <DocumentUploadPanel
            documents={documents}
            selectedDocumentId={selectedDocumentId}
            isLoadingDocuments={isLoadingDocuments}
            isUploadingDocument={isUploadingDocument}
            replacingDocumentId={replacingDocumentId}
            deletingDocumentIds={deletingDocumentIds}
            disabled={!reviewEvent}
            onSelectDocument={onSelectDocument}
            onUploadDocument={onUploadDocument}
            onReplaceDocument={onReplaceDocument}
            onDeleteDocument={onDeleteDocument}
          />
          <EventMembersPanel
            event={reviewEvent}
            currentUser={currentUser}
            canManageEvent={canManageEvent}
            memberDraft={memberDraft}
            isAddingReviewer={isAddingReviewer}
            removingMemberIds={removingMemberIds}
            updatingMemberIds={updatingMemberIds}
            onMemberDraftChange={onMemberDraftChange}
            onAddReviewer={onAddReviewer}
            onRemoveReviewer={onRemoveReviewer}
            onChangeMemberRole={onChangeMemberRole}
          />
          <MockDocumentPreview
            event={reviewEvent}
            records={records}
            selectedDocument={selectedDocument}
          />
        </div>

        <div className="min-w-0">
          <div className="mb-3 grid gap-3">
            <div className="flex flex-wrap gap-2 text-xs font-semibold text-[#3b4a3b]">
              <SummaryPill label="Rows" value={String(reviewCounts.total)} />
              <SummaryPill
                label="Visible"
                value={String(filteredRecords.length)}
              />
              <SummaryPill
                label="Reviewed"
                value={String(reviewCounts.reviewed)}
              />
              <SummaryPill
                label="Needs review"
                value={String(reviewCounts.needsReview)}
              />
              <SummaryPill
                label="Approved"
                value={String(reviewCounts.approved)}
              />
              <SummaryPill
                label="Rejected"
                value={String(reviewCounts.rejected)}
              />
              <SummaryPill label="Draft" value={String(reviewCounts.draft)} />
              <SummaryPill label="Documents" value={String(documents.length)} />
              <SummaryPill label="Fields" value={String(fields.length)} />
            </div>

            <ReportingDashboard
              event={reviewEvent}
              currentUser={currentUser}
              documents={documents}
              records={records}
            />

            <div
              id="portfolio-export-actions"
              className="scroll-mt-5 grid gap-2 xl:grid-cols-[minmax(220px,1fr)_180px_auto]"
            >
              <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Search
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  disabled={!reviewEvent || records.length === 0}
                  className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                />
              </label>

              <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Status
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as ReviewStatusFilter)
                  }
                  disabled={!reviewEvent || records.length === 0}
                  className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
                >
                  {REVIEW_STATUS_FILTERS.map((filter) => (
                    <option key={filter.value} value={filter.value}>
                      {filter.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap gap-2 self-end">
                <button
                  type="button"
                  onClick={exportFilteredRecords}
                  disabled={!reviewEvent || filteredRecords.length === 0}
                  className="h-10 rounded-md border border-[#b8c9b2] bg-white px-4 text-sm font-semibold text-[#2f6f4e] transition hover:bg-[#edf3ea] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export visible
                </button>
                <button
                  type="button"
                  onClick={onExportAllCsv}
                  disabled={!reviewEvent || isExportingAllCsv}
                  className="h-10 rounded-md bg-[#2f6f4e] px-4 text-sm font-semibold text-white transition hover:bg-[#265c41] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExportingAllCsv ? "Exporting" : "Export all CSV"}
                </button>
                <button
                  type="button"
                  onClick={onExportExcel}
                  disabled={!reviewEvent || isExportingExcel}
                  className="h-10 rounded-md border border-[#b8c9b2] bg-[#edf3ea] px-4 text-sm font-semibold text-[#2f6f4e] transition hover:bg-[#dfeade] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExportingExcel ? "Exporting" : "Export Excel"}
                </button>
              </div>
            </div>

            <div className="min-h-5 text-sm">
              {reviewStatus ? (
                <p
                  className={
                    reviewStatus.tone === "success"
                      ? "font-medium text-[#2f6f4e]"
                      : reviewStatus.tone === "error"
                        ? "font-medium text-[#a33f2f]"
                        : "font-medium text-[#546657]"
                  }
                >
                  {reviewStatus.text}
                </p>
              ) : null}
            </div>
          </div>

          {fieldSuggestions.length > 0 ? (
            <div className="mb-3 rounded-lg border border-[#d9d0a8] bg-[#fffaf0] p-3">
              <div className="mb-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#725b16]">
                  Suggested fields
                </p>
              </div>
              <div className="grid gap-2">
                {fieldSuggestions.map((suggestion) => {
                  const isAdding = addingFieldKeys.includes(suggestion.key);

                  return (
                    <div
                      key={suggestion.key}
                      className="flex flex-col gap-2 rounded-md border border-[#eadcae] bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#332a12]">
                          {suggestion.label}
                        </p>
                        <p className="mt-1 truncate text-xs text-[#725b16]">
                          {suggestion.sampleValues.slice(0, 4).join(", ")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onAddSuggestedField(suggestion)}
                        disabled={isAdding || !canManageEvent}
                        className="h-9 rounded-md border border-[#d2b15a] px-3 text-xs font-semibold text-[#725b16] transition hover:bg-[#fff3cf] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isAdding
                          ? "Adding"
                          : canManageEvent
                            ? "Add field"
                            : "Owner only"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-[#dfe4dc]">
            <table className="min-w-full border-collapse bg-white text-sm">
              <thead className="bg-[#f6f8f2] text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                <tr>
                  <th className="w-16 border-b border-[#dfe4dc] px-3 py-3">
                    Row
                  </th>
                  {fields.map((field) => (
                    <th
                      key={field.id}
                      className="min-w-[180px] border-b border-[#dfe4dc] px-3 py-3"
                    >
                      {field.label}
                    </th>
                  ))}
                  <th className="w-32 border-b border-[#dfe4dc] px-3 py-3">
                    Review status
                  </th>
                  <th className="w-56 border-b border-[#dfe4dc] px-3 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoadingRecords ? (
                  <tr>
                    <td
                      colSpan={fields.length + 3}
                      className="px-3 py-6 text-center text-sm text-[#667265]"
                    >
                      Loading records...
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td
                      colSpan={fields.length + 3}
                      className="px-3 py-6 text-center text-sm text-[#667265]"
                    >
                      No extracted rows yet.
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td
                      colSpan={fields.length + 3}
                      className="px-3 py-6 text-center text-sm text-[#667265]"
                    >
                      No rows match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record) => {
                    const isBusy = busyRecordIds.includes(record.id);

                    return (
                      <tr key={record.id} className="border-t border-[#edf0ea]">
                        <td className="align-top px-3 py-3 font-semibold text-[#334033]">
                          {record.rowNumber ?? "-"}
                        </td>
                        {fields.map((field) => {
                          const value = record.values.find(
                            (recordValue) => recordValue.fieldKey === field.key,
                          );
                          const isLowConfidence =
                            value?.confidence !== null &&
                            value?.confidence !== undefined &&
                            value.confidence < 0.75;
                          const validationIssues = value?.validationIssues ?? [];

                          return (
                            <td key={field.id} className="align-top px-3 py-3">
                              <ReviewCell
                                field={field}
                                value={record.data[field.key]}
                                isLowConfidence={isLowConfidence}
                                confidence={value?.confidence}
                                validationIssues={validationIssues}
                                disabled={isBusy}
                                onChange={(nextValue) =>
                                  onCellChange(record.id, field.key, nextValue)
                                }
                              />
                            </td>
                          );
                        })}
                        <td className="align-top px-3 py-3">
                          <StatusBadge status={record.status} />
                        </td>
                        <td className="align-top px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => onSave(record)}
                              disabled={isBusy}
                              className="h-9 rounded-md border border-[#cbd5c8] px-3 text-xs font-semibold text-[#334033] transition hover:bg-[#f3f5ef] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => onApprove(record)}
                              disabled={isBusy}
                              className="h-9 rounded-md bg-[#2f6f4e] px-3 text-xs font-semibold text-white transition hover:bg-[#265c41] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => onReject(record)}
                              disabled={isBusy}
                              className="h-9 rounded-md border border-[#d9b7aa] px-3 text-xs font-semibold text-[#8a3d2d] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function DocumentUploadPanel({
  documents,
  selectedDocumentId,
  isLoadingDocuments,
  isUploadingDocument,
  replacingDocumentId,
  deletingDocumentIds,
  disabled,
  onSelectDocument,
  onUploadDocument,
  onReplaceDocument,
  onDeleteDocument,
}: {
  documents: AttendanceDocumentSummary[];
  selectedDocumentId: string;
  isLoadingDocuments: boolean;
  isUploadingDocument: boolean;
  replacingDocumentId: string | null;
  deletingDocumentIds: string[];
  disabled: boolean;
  onSelectDocument: (documentId: string) => void;
  onUploadDocument: (file: File) => void;
  onReplaceDocument: (file: File) => void;
  onDeleteDocument: (document: AttendanceDocumentSummary) => void;
}) {
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? null;
  const isReplacingSelected = replacingDocumentId === selectedDocumentId;

  return (
    <div
      id="portfolio-document-extraction"
      className="scroll-mt-5 rounded-lg border border-[#dfe4dc] bg-[#fbfcf9] p-4"
    >
      <div className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667265]">
          Documents
        </p>
        <h3 className="mt-1 text-base font-semibold text-[#172017]">
          Attendance sheet
        </h3>
      </div>

      <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
        Upload file
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          disabled={disabled || isUploadingDocument}
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              onUploadDocument(file);
              event.target.value = "";
            }
          }}
          className="block w-full rounded-md border border-[#cbd5c8] bg-white text-sm text-[#334033] file:mr-3 file:h-10 file:border-0 file:bg-[#2f6f4e] file:px-3 file:text-sm file:font-semibold file:text-white disabled:cursor-not-allowed disabled:opacity-60"
        />
      </label>

      <div className="mt-3 grid gap-3">
        <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
          Selected file
          <select
            value={selectedDocumentId}
            disabled={disabled || isLoadingDocuments || documents.length === 0}
            onChange={(event) => onSelectDocument(event.target.value)}
            className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal text-[#1f2a22] outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
          >
            <option value="">
              {isLoadingDocuments ? "Loading documents..." : "No file selected"}
            </option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.fileName}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
          Replace selected
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={disabled || !selectedDocument || isReplacingSelected}
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (file) {
                onReplaceDocument(file);
                event.target.value = "";
              }
            }}
            className="block w-full rounded-md border border-[#cbd5c8] bg-white text-sm text-[#334033] file:mr-3 file:h-10 file:border-0 file:bg-[#edf3ea] file:px-3 file:text-sm file:font-semibold file:text-[#2f6f4e] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>

      {documents.length > 0 ? (
        <div className="mt-4 divide-y divide-[#e5e9e2] rounded-md border border-[#e5e9e2] bg-white">
          {documents.slice(0, 4).map((document) => {
            const isDeleting = deletingDocumentIds.includes(document.id);
            const isSelected = document.id === selectedDocumentId;

            return (
              <div
                key={document.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 ${
                  isSelected ? "bg-[#edf3ea]" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDocument(document.id)}
                  className="min-w-0 text-left transition hover:text-[#2f6f4e]"
                >
                  <span className="block truncate text-sm font-semibold text-[#172017]">
                    {document.fileName}
                  </span>
                  <span className="mt-1 block text-xs text-[#667265]">
                    {document.status} - {document.recordCount ?? 0} rows
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteDocument(document)}
                  disabled={disabled || isDeleting || replacingDocumentId === document.id}
                  className="h-8 rounded-md border border-[#d9b7aa] px-2.5 text-xs font-semibold text-[#8a3d2d] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleting ? "Deleting" : "Delete"}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function EventMembersPanel({
  event,
  currentUser,
  canManageEvent,
  memberDraft,
  isAddingReviewer,
  removingMemberIds,
  updatingMemberIds,
  onMemberDraftChange,
  onAddReviewer,
  onRemoveReviewer,
  onChangeMemberRole,
}: {
  event: CrowdLogEvent | null;
  currentUser: AuthUser | null;
  canManageEvent: boolean;
  memberDraft: { email: string; name: string };
  isAddingReviewer: boolean;
  removingMemberIds: string[];
  updatingMemberIds: string[];
  onMemberDraftChange: (draft: { email: string; name: string }) => void;
  onAddReviewer: () => void;
  onRemoveReviewer: (member: EventMember) => void;
  onChangeMemberRole: (member: EventMember, nextRole: EventMemberRole) => void;
}) {
  const currentRole = eventRoleForUser(event, currentUser);
  const members = event?.members ?? [];
  const ownerCount = members.filter((member) => member.role === "owner").length;

  return (
    <div className="rounded-lg border border-[#dfe4dc] bg-[#fbfcf9] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667265]">
            Event team
          </p>
          <h3 className="mt-1 text-base font-semibold text-[#172017]">
            Members
          </h3>
        </div>
        {currentRole ? (
          <span className="rounded-md border border-[#d8dfd2] bg-white px-2.5 py-1 text-xs font-semibold text-[#526052]">
            {EVENT_ROLE_LABELS[currentRole]}
          </span>
        ) : null}
      </div>

      {canManageEvent ? (
        <form
          className="grid gap-2"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            onAddReviewer();
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
            Reviewer email
            <input
              type="email"
              value={memberDraft.email}
              onChange={(inputEvent) =>
                onMemberDraftChange({
                  ...memberDraft,
                  email: inputEvent.target.value,
                })
              }
              className="h-10 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
            Reviewer name
            <input
              value={memberDraft.name}
              onChange={(inputEvent) =>
                onMemberDraftChange({
                  ...memberDraft,
                  name: inputEvent.target.value,
                })
              }
              className="h-10 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
            />
          </label>
          <button
            type="submit"
            disabled={isAddingReviewer || !memberDraft.email.trim()}
            className="h-10 rounded-md bg-[#2f6f4e] px-3 text-sm font-semibold text-white transition hover:bg-[#265c41] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAddingReviewer ? "Adding reviewer" : "Add reviewer"}
          </button>
        </form>
      ) : null}

      <div className="mt-4 divide-y divide-[#e5e9e2] rounded-md border border-[#e5e9e2] bg-white">
        {members.length === 0 ? (
          <div className="px-3 py-3 text-sm text-[#667265]">
            No event selected.
          </div>
        ) : (
          members.map((member) => {
            const isRemoving = removingMemberIds.includes(member.id);
            const isUpdating = updatingMemberIds.includes(member.id);
            const isCurrentUser = member.userId === currentUser?.id;
            const canDemoteOwner = member.role === "owner" && ownerCount > 1;

            return (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#172017]">
                    {member.name || member.email}
                    {isCurrentUser ? " (you)" : ""}
                  </p>
                  <p className="mt-1 truncate text-xs text-[#667265]">
                    {member.email}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2 py-1 text-xs font-semibold text-[#526052]">
                    {EVENT_ROLE_LABELS[member.role]}
                  </span>
                  {canManageEvent ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      {member.role === "reviewer" ? (
                        <button
                          type="button"
                          onClick={() => onChangeMemberRole(member, "owner")}
                          disabled={isUpdating}
                          className="h-8 rounded-md border border-[#b8c9b2] px-2.5 text-xs font-semibold text-[#2f6f4e] transition hover:bg-[#edf3ea] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isUpdating ? "Updating" : "Make owner"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onChangeMemberRole(member, "reviewer")}
                          disabled={isUpdating || !canDemoteOwner}
                          title={
                            canDemoteOwner
                              ? undefined
                              : "Add another owner before changing this role."
                          }
                          className="h-8 rounded-md border border-[#d8dfd2] px-2.5 text-xs font-semibold text-[#526052] transition hover:bg-[#f3f5ef] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isUpdating ? "Updating" : "Make reviewer"}
                        </button>
                      )}
                      {member.role === "reviewer" ? (
                        <button
                          type="button"
                          onClick={() => onRemoveReviewer(member)}
                          disabled={isRemoving || isUpdating}
                          className="h-8 rounded-md border border-[#d9b7aa] px-2.5 text-xs font-semibold text-[#8a3d2d] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRemoving ? "Removing" : "Remove"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function MockDocumentPreview({
  event,
  records,
  selectedDocument,
}: {
  event: CrowdLogEvent | null;
  records: AttendanceRecord[];
  selectedDocument: AttendanceDocumentSummary | null;
}) {
  const fields = event?.template.fields ?? [];
  const previewRows = records.slice(0, 5);
  const fileUrl = selectedDocument ? getApiFileUrl(selectedDocument.fileUrl) : "";

  return (
    <div className="rounded-lg border border-[#dfe4dc] bg-[#fbfcf9] p-4">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667265]">
          Sheet preview
        </p>
        <h3 className="mt-1 text-base font-semibold text-[#172017]">
          {selectedDocument?.fileName ?? event?.title ?? "No event selected"}
        </h3>
      </div>

      {selectedDocument ? (
        <div className="overflow-hidden rounded-md border border-[#d9dfd3] bg-white shadow-sm">
          <object
            data={fileUrl}
            type={selectedDocument.fileType ?? undefined}
            className="h-[360px] w-full bg-[#f6f8f2]"
          >
            <div className="grid h-[360px] place-items-center p-4 text-center text-sm text-[#667265]">
              Preview unavailable.
            </div>
          </object>
        </div>
      ) : (
        <div className="rounded-md border border-[#d9dfd3] bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between border-b border-[#e5e9e2] pb-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667265]">
            Attendance
          </span>
          <span className="text-xs text-[#667265]">table style</span>
        </div>
        <div className="overflow-hidden rounded-md border border-[#e5e9e2]">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead className="bg-[#f6f8f2] text-[#526052]">
              <tr>
                {fields.slice(0, 4).map((field) => (
                  <th key={field.id} className="border-b border-[#e5e9e2] p-2">
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.length > 0 ? (
                previewRows.map((record) => (
                  <tr key={record.id}>
                    {fields.slice(0, 4).map((field) => (
                      <td
                        key={field.id}
                        className="border-t border-[#f0f2ed] p-2 text-[#334033]"
                      >
                        {valueToString(record.data[field.key]) || "-"}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                Array.from({ length: 4 }, (_, rowIndex) => (
                  <tr key={rowIndex}>
                    {fields.slice(0, 4).map((field) => (
                      <td
                        key={field.id}
                        className="border-t border-[#f0f2ed] p-2 text-[#a1aaa0]"
                      >
                        -
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

function ReviewCell({
  field,
  value,
  isLowConfidence,
  confidence,
  validationIssues,
  disabled,
  onChange,
}: {
  field: TemplateField;
  value: RecordCellValue | undefined;
  isLowConfidence: boolean;
  confidence: number | null | undefined;
  validationIssues: string[];
  disabled: boolean;
  onChange: (value: RecordCellValue) => void;
}) {
  const hasValidationIssues = validationIssues.length > 0;
  const needsAttention = isLowConfidence || hasValidationIssues;
  const inputClassName = `h-10 w-full rounded-md border px-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] ${
    needsAttention
      ? "border-[#d9a443] bg-[#fff8e6] focus:border-[#b7831e] focus:ring-2 focus:ring-[#f4dda6]"
      : "border-[#cbd5c8] bg-white focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
  }`;

  return (
    <div className="grid gap-1.5">
      {field.type === "signature" ? (
        <label
          className={`flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium ${
            needsAttention
              ? "border-[#d9a443] bg-[#fff8e6] text-[#6b561d]"
              : "border-[#cbd5c8] bg-white text-[#334033]"
          }`}
        >
          <input
            type="checkbox"
            checked={valueToBoolean(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className="h-4 w-4 rounded border-[#aebbac] accent-[#2f6f4e]"
          />
          Signed
        </label>
      ) : field.type === "select" ? (
        <select
          value={valueToString(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={inputClassName}
        >
          <option value="">Choose</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
          value={valueToString(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={inputClassName}
        />
      )}

      {isLowConfidence ? (
        <span className="text-xs font-semibold text-[#8a6516]">
          Low confidence: {confidenceLabel(confidence)}
        </span>
      ) : null}
      {hasValidationIssues ? (
        <span className="text-xs font-semibold text-[#8a6516]">
          {validationIssues.join(" ")}
        </span>
      ) : null}
    </div>
  );
}

function ReportingDashboard({
  event,
  currentUser,
  documents,
  records,
}: {
  event: CrowdLogEvent | null;
  currentUser: AuthUser | null;
  documents: AttendanceDocumentSummary[];
  records: AttendanceRecord[];
}) {
  const counts = getReviewCounts(records);
  const documentReports = getDocumentReports(documents, records);
  const reviewerReports = getReviewerReports(event, currentUser, records);
  const remaining = counts.draft + counts.needsReview;
  const reviewPercent = percentage(counts.reviewed, counts.total);
  const approvalPercent = percentage(counts.approved, counts.total);

  return (
    <div
      id="portfolio-reporting-panels"
      className="scroll-mt-5 grid gap-3 2xl:grid-cols-3"
    >
      <section className="rounded-md border border-[#dfe6db] bg-[#fbfcf9] p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
          Event completion
        </p>
        <div className="mt-3 grid gap-3">
          <ReportProgress
            label="Reviewed"
            value={reviewPercent}
            detail={`${counts.reviewed}/${counts.total} rows`}
          />
          <ReportProgress
            label="Approved"
            value={approvalPercent}
            detail={`${counts.approved}/${counts.total} rows`}
            barClassName="bg-[#47785c]"
          />
          <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-[#526052]">
            <span className="rounded-md border border-[#e1e5dc] bg-white px-2 py-1.5">
              Remaining: {remaining}
            </span>
            <span className="rounded-md border border-[#e1e5dc] bg-white px-2 py-1.5">
              Rejected: {counts.rejected}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-[#dfe6db] bg-[#fbfcf9] p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
          Documents
        </p>
        <div className="mt-3 grid max-h-48 gap-2 overflow-auto pr-1">
          {documentReports.length === 0 ? (
            <p className="text-sm text-[#667265]">No documents yet.</p>
          ) : (
            documentReports.map((document) => (
              <div
                key={document.id}
                className="rounded-md border border-[#e1e5dc] bg-white px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[#172017]">
                    {document.name}
                  </p>
                  <span className="text-xs font-semibold text-[#2f6f4e]">
                    {formatPercentage(document.reviewed, document.total)}
                  </span>
                </div>
                <ProgressBar value={percentage(document.reviewed, document.total)} />
                <p className="mt-1 text-xs text-[#667265]">
                  {document.reviewed}/{document.total} reviewed -{" "}
                  {document.status} - {formatShortDateTime(document.lastActivityAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-[#dfe6db] bg-[#fbfcf9] p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
          Reviewers
        </p>
        <div className="mt-3 grid max-h-48 gap-2 overflow-auto pr-1">
          {reviewerReports.length === 0 ? (
            <p className="text-sm text-[#667265]">No reviewers yet.</p>
          ) : (
            reviewerReports.map((reviewer) => (
              <div
                key={reviewer.id}
                className="rounded-md border border-[#e1e5dc] bg-white px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[#172017]">
                    {reviewer.name}
                    {reviewer.isCurrentUser ? " (you)" : ""}
                  </p>
                  <span className="shrink-0 text-xs font-semibold text-[#526052]">
                    {EVENT_ROLE_LABELS[reviewer.role]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#667265]">
                  {reviewer.reviewed} reviewed - {reviewer.approved} approved -{" "}
                  {reviewer.rejected} rejected
                </p>
                <p className="mt-1 text-xs text-[#667265]">
                  {formatShortDateTime(reviewer.lastReviewedAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ReportProgress({
  label,
  value,
  detail,
  barClassName = "bg-[#2f6f4e]",
}: {
  label: string;
  value: number;
  detail: string;
  barClassName?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-semibold text-[#3b4a3b]">
        <span>{label}</span>
        <span>{detail}</span>
      </div>
      <ProgressBar value={value} barClassName={barClassName} />
    </div>
  );
}

function ProgressBar({
  value,
  barClassName = "bg-[#2f6f4e]",
}: {
  value: number;
  barClassName?: string;
}) {
  const width = Math.max(0, Math.min(100, value));

  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#e5eadf]">
      <div className={`h-full ${barClassName}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function StatusBadge({ status }: { status: RecordStatus }) {
  const className =
    status === "approved"
      ? "border-[#b8d5bd] bg-[#edf7ef] text-[#2f6f4e]"
      : status === "rejected"
        ? "border-[#d9b7aa] bg-[#fff1ed] text-[#8a3d2d]"
        : status === "needs_review"
          ? "border-[#d9d0a8] bg-[#fff8e6] text-[#725b16]"
          : "border-[#d8dfd2] bg-[#fafbf8] text-[#526052]";

  return (
    <span
      className={`inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-semibold ${className}`}
    >
      {RECORD_STATUS_LABELS[status]}
    </span>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2.5 py-1">
      {label}: {value}
    </span>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#e1e5dc] bg-[#fafbf8] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#667265]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-[#172017]">{value}</p>
    </div>
  );
}
