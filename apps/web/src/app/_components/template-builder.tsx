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
  type CrowdLogEvent,
  type DraftField,
  type EventDraft,
  type FieldType,
  type RecordCellValue,
  type RecordStatus,
  type TemplateField,
} from "@crowdlog/shared";
import {
  approveAttendanceRecord,
  createEvent,
  getApiFileUrl,
  listDocuments,
  listEvents,
  listRecords,
  mockExtractDocument,
  mockExtractRecords,
  rejectAttendanceRecord,
  updateAttendanceRecord,
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

type StatusMessage = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

export function TemplateBuilder() {
  const [draft, setDraft] = useState<EventDraft>(starterDraft);
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
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [isMockExtracting, setIsMockExtracting] = useState(false);
  const [busyRecordIds, setBusyRecordIds] = useState<string[]>([]);
  const [reviewStatus, setReviewStatus] = useState<StatusMessage>(null);

  useEffect(() => {
    let shouldIgnore = false;

    async function loadEvents() {
      try {
        const events = await listEvents();

        if (!shouldIgnore) {
          setSavedEvents(events);
        }
      } catch {
        if (!shouldIgnore) {
          setStatus({
            tone: "error",
            text: "Could not load saved events from the API.",
          });
        }
      } finally {
        if (!shouldIgnore) {
          setIsLoadingEvents(false);
        }
      }
    }

    void loadEvents();

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
      setReviewStatus({
        tone: "info",
        text: "Template ready for mock extraction.",
      });
    } catch {
      setStatus({
        tone: "error",
        text: "Could not save the event. Make sure the API is running.",
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
      setReviewStatus({
        tone: "error",
        text: "Could not load documents and records for review.",
      });
    } finally {
      setIsLoadingRecords(false);
      setIsLoadingDocuments(false);
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

  async function runMockExtraction() {
    if (!reviewEvent) {
      setReviewStatus({ tone: "error", text: "Select a saved event first." });
      return;
    }

    setIsMockExtracting(true);
    setReviewStatus({ tone: "info", text: "Creating mock extracted rows." });

    try {
      const result = selectedDocumentId
        ? await mockExtractDocument(selectedDocumentId, 4)
        : await mockExtractRecords(reviewEvent.id, 4);
      setRecords((currentRecords) => [...result.records, ...currentRecords]);
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
        text: `Created ${result.records.length} mock rows for review.`,
      });
    } catch {
      setReviewStatus({
        tone: "error",
        text: "Could not create mock extracted rows.",
      });
    } finally {
      setIsMockExtracting(false);
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
          <div className="flex flex-wrap gap-2 text-xs font-medium text-[#36513f]">
            <span className="rounded-md border border-[#cbd8c8] bg-[#edf3ea] px-3 py-1.5">
              Milestone 1
            </span>
            <span className="rounded-md border border-[#d7d0bd] bg-[#f8f1dd] px-3 py-1.5">
              Dynamic templates
            </span>
            <span className="rounded-md border border-[#c9d9dd] bg-[#e9f4f5] px-3 py-1.5">
              OCR later
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1480px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-5">
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
                    disabled={isSaving}
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
            documents={documents}
            selectedDocumentId={selectedDocumentId}
            records={records}
            isLoadingDocuments={isLoadingDocuments}
            isUploadingDocument={isUploadingDocument}
            isLoadingRecords={isLoadingRecords}
            isMockExtracting={isMockExtracting}
            busyRecordIds={busyRecordIds}
            reviewStatus={reviewStatus}
            onSelectDocument={setSelectedDocumentId}
            onUploadDocument={uploadReviewDocument}
            onMockExtract={runMockExtraction}
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
                savedEvents.map((event) => (
                  <div key={event.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#172017]">
                          {event.title}
                        </p>
                        <p className="mt-1 text-xs text-[#667265]">
                          {event.template.fields.length} fields
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => loadSavedEvent(event)}
                          className="h-9 rounded-md border border-[#cbd5c8] px-3 text-sm font-medium text-[#334033] transition hover:bg-[#f3f5ef]"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => selectReviewEvent(event)}
                          className="h-9 rounded-md bg-[#2f6f4e] px-3 text-sm font-semibold text-white transition hover:bg-[#265c41]"
                        >
                          Review
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

type ReviewWorkspaceProps = {
  reviewEvent: CrowdLogEvent | null;
  documents: AttendanceDocumentSummary[];
  selectedDocumentId: string;
  records: AttendanceRecord[];
  isLoadingDocuments: boolean;
  isUploadingDocument: boolean;
  isLoadingRecords: boolean;
  isMockExtracting: boolean;
  busyRecordIds: string[];
  reviewStatus: StatusMessage;
  onSelectDocument: (documentId: string) => void;
  onUploadDocument: (file: File) => void;
  onMockExtract: () => void;
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
  documents,
  selectedDocumentId,
  records,
  isLoadingDocuments,
  isUploadingDocument,
  isLoadingRecords,
  isMockExtracting,
  busyRecordIds,
  reviewStatus,
  onSelectDocument,
  onUploadDocument,
  onMockExtract,
  onCellChange,
  onSave,
  onApprove,
  onReject,
}: ReviewWorkspaceProps) {
  const fields = reviewEvent?.template.fields ?? [];
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? null;

  return (
    <section className="rounded-lg border border-[#d9dfd3] bg-white">
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
        <button
          type="button"
          onClick={onMockExtract}
          disabled={!reviewEvent || isMockExtracting}
          className="h-10 rounded-md bg-[#2f6f4e] px-4 text-sm font-semibold text-white transition hover:bg-[#265c41] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isMockExtracting
            ? "Extracting..."
            : selectedDocument
              ? "Mock extract selected file"
              : "Run mock extraction"}
        </button>
      </div>

      <div className="grid gap-4 px-4 py-4 sm:px-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <DocumentUploadPanel
            documents={documents}
            selectedDocumentId={selectedDocumentId}
            isLoadingDocuments={isLoadingDocuments}
            isUploadingDocument={isUploadingDocument}
            disabled={!reviewEvent}
            onSelectDocument={onSelectDocument}
            onUploadDocument={onUploadDocument}
          />
          <MockDocumentPreview
            event={reviewEvent}
            records={records}
            selectedDocument={selectedDocument}
          />
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2 text-xs font-semibold text-[#3b4a3b]">
              <span className="rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2.5 py-1">
                Rows: {records.length}
              </span>
              <span className="rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2.5 py-1">
                Documents: {documents.length}
              </span>
              <span className="rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2.5 py-1">
                Fields: {fields.length}
              </span>
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
                    Status
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
                ) : (
                  records.map((record) => {
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

                          return (
                            <td key={field.id} className="align-top px-3 py-3">
                              <ReviewCell
                                field={field}
                                value={record.data[field.key]}
                                isLowConfidence={isLowConfidence}
                                confidence={value?.confidence}
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
  disabled,
  onSelectDocument,
  onUploadDocument,
}: {
  documents: AttendanceDocumentSummary[];
  selectedDocumentId: string;
  isLoadingDocuments: boolean;
  isUploadingDocument: boolean;
  disabled: boolean;
  onSelectDocument: (documentId: string) => void;
  onUploadDocument: (file: File) => void;
}) {
  return (
    <div className="rounded-lg border border-[#dfe4dc] bg-[#fbfcf9] p-4">
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

      <div className="mt-4">
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
      </div>

      {documents.length > 0 ? (
        <div className="mt-4 divide-y divide-[#e5e9e2] rounded-md border border-[#e5e9e2] bg-white">
          {documents.slice(0, 4).map((document) => (
            <button
              key={document.id}
              type="button"
              onClick={() => onSelectDocument(document.id)}
              className={`block w-full px-3 py-3 text-left transition hover:bg-[#f6f8f2] ${
                document.id === selectedDocumentId ? "bg-[#edf3ea]" : ""
              }`}
            >
              <span className="block truncate text-sm font-semibold text-[#172017]">
                {document.fileName}
              </span>
              <span className="mt-1 block text-xs text-[#667265]">
                {document.status} - {document.recordCount ?? 0} rows
              </span>
            </button>
          ))}
        </div>
      ) : null}
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
  disabled,
  onChange,
}: {
  field: TemplateField;
  value: RecordCellValue | undefined;
  isLowConfidence: boolean;
  confidence: number | null | undefined;
  disabled: boolean;
  onChange: (value: RecordCellValue) => void;
}) {
  const inputClassName = `h-10 w-full rounded-md border px-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] ${
    isLowConfidence
      ? "border-[#d9a443] bg-[#fff8e6] focus:border-[#b7831e] focus:ring-2 focus:ring-[#f4dda6]"
      : "border-[#cbd5c8] bg-white focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
  }`;

  return (
    <div className="grid gap-1.5">
      {field.type === "signature" ? (
        <label
          className={`flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium ${
            isLowConfidence
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
