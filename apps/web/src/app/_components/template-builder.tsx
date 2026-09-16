"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  FIELD_TYPES,
  dedupeFieldKey,
  makeClientId,
  normalizeFieldKey,
  splitCommaList,
  type CrowdLogEvent,
  type DraftField,
  type EventDraft,
  type FieldType,
  type TemplateField,
} from "@crowdlog/shared";

const STORAGE_KEY = "crowdlog.saved-events.v1";
const STORAGE_EVENT = "crowdlog:saved-events";

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  email: "Email",
  phone: "Phone",
  number: "Number",
  signature: "Signature",
  date: "Date",
  select: "Select",
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

function subscribeToSavedEvents(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("storage", onStoreChange);
  window.addEventListener(STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(STORAGE_EVENT, onStoreChange);
  };
}

function getSavedEventsSnapshot() {
  if (typeof window === "undefined") {
    return "[]";
  }

  return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
}

function getServerSavedEventsSnapshot() {
  return "[]";
}

function parseSavedEvents(snapshot: string): CrowdLogEvent[] {
  try {
    const parsedValue = JSON.parse(snapshot);
    return Array.isArray(parsedValue) ? (parsedValue as CrowdLogEvent[]) : [];
  } catch {
    return [];
  }
}

function writeSavedEvents(events: CrowdLogEvent[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

type StatusMessage = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

export function TemplateBuilder() {
  const [draft, setDraft] = useState<EventDraft>(starterDraft);
  const [status, setStatus] = useState<StatusMessage>(null);
  const savedEventsSnapshot = useSyncExternalStore(
    subscribeToSavedEvents,
    getSavedEventsSnapshot,
    getServerSavedEventsSnapshot,
  );
  const savedEvents = useMemo(
    () => parseSavedEvents(savedEventsSnapshot),
    [savedEventsSnapshot],
  );

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

  function saveEventTemplate() {
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

    const now = new Date().toISOString();
    const eventId = makeClientId("event");

    const event: CrowdLogEvent = {
      id: eventId,
      title,
      description: draft.description.trim(),
      eventDate: draft.eventDate,
      createdAt: now,
      updatedAt: now,
      template: {
        id: makeClientId("template"),
        eventId,
        name: templateName,
        isDefault: true,
        fields,
        createdAt: now,
        updatedAt: now,
      },
    };

    writeSavedEvents([event, ...savedEvents]);
    setStatus({ tone: "success", text: "Event template saved." });
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
                    className="h-11 rounded-md bg-[#2f6f4e] px-4 text-sm font-semibold text-white transition hover:bg-[#265c41] focus:outline-none focus:ring-2 focus:ring-[#a8d3b7]"
                  >
                    Save event template
                  </button>
                </div>
              </div>
            </div>
          </div>
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
              {savedEvents.length === 0 ? (
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
                      <button
                        type="button"
                        onClick={() => loadSavedEvent(event)}
                        className="h-9 rounded-md border border-[#cbd5c8] px-3 text-sm font-medium text-[#334033] transition hover:bg-[#f3f5ef]"
                      >
                        Load
                      </button>
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
