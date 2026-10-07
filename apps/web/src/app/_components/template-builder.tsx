"use client";

import Link from "next/link";
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
  type EventRecordAnalytics,
  type FieldType,
  type OcrFieldSuggestion,
  type RecordCellValue,
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
  getCurrentSession,
  getEventRecordAnalytics,
  listDocuments,
  listEvents,
  listRecords,
  mockExtractRecords,
  rejectAttendanceRecord,
  replaceAttendanceDocument,
  removeEventMember,
  requestEmailOtp,
  signIn as apiSignIn,
  signOut as apiSignOut,
  updateAttendanceRecord,
  updateEvent,
  updateEventMember,
  uploadAttendanceDocument,
  verifyEmailOtp,
  type AuthOtpMode,
  type CreateEventPayload,
  type UpdateEventPayload,
} from "@/lib/api-client";
import { isValidEmailAddress } from "@/lib/email-validation";
import { isValidPhoneNumber } from "@/lib/phone-validation";
import type { AuthDraft } from "./auth-modal";
import { AuthPanel } from "./template-builder/auth-panel";
import {
  EVENT_ROLE_LABELS,
  FIELD_TYPE_LABELS,
} from "./template-builder/constants";
import { canManageEvent, eventRoleForUser } from "./template-builder/event-access";
import {
  ReviewWorkspace,
  SummaryItem,
} from "./template-builder/review-workspace";
import type {
  DocumentExtractionOptions,
  StatusMessage,
} from "./template-builder/types";
import {
  downloadBlob,
  valueToString,
} from "./template-builder/review-utils";
import { WebsiteHelpDialog } from "./help-dialog";

const PORTFOLIO_DEMO_EVENT_TITLE = "Portfolio Demo: Computer Science Seminar";
const PORTFOLIO_DEMO_OWNER_EMAIL = "owner.demo@crowdlog.local";
const PORTFOLIO_DEMO_OWNER_NAME = "Amina Okafor";
const MIN_PASSWORD_LENGTH = 6;

const starterDraft: EventDraft = {
  title: "",
  description: "",
  eventDate: "",
  templateName: "",
  fields: [],
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

function fieldUsesOptions(type: FieldType) {
  return type === "select" || type === "multi_select";
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
    options: fieldUsesOptions(field.type) ? splitCommaList(field.optionsText) : [],
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

function shouldOpenPortfolioDemo() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("portfolioDemo") === "1";
}

function requestedInviteEventId() {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("eventId")?.trim() || null;
}

function findPortfolioDemoEvent(events: CrowdLogEvent[]) {
  if (!shouldOpenPortfolioDemo()) {
    return null;
  }

  return events.find((event) => event.title === PORTFOLIO_DEMO_EVENT_TITLE) ?? null;
}

function findInviteEvent(events: CrowdLogEvent[]) {
  const eventId = requestedInviteEventId();

  if (!eventId) {
    return null;
  }

  return events.find((event) => event.id === eventId) ?? null;
}

function portfolioDemoMissingStatus(): StatusMessage {
  return {
    tone: "error",
    text: "Portfolio demo event not found. Run npm run seed:portfolio, then sign in as owner.demo@crowdlog.local.",
  };
}

function inviteEventMissingStatus(): StatusMessage {
  return {
    tone: "error",
    text: "This invited event is not available for the signed-in account.",
  };
}

export function TemplateBuilder() {
  const [draft, setDraft] = useState<EventDraft>(starterDraft);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authDraft, setAuthDraft] = useState<AuthDraft>({
    email: "",
    name: "",
    phone: "",
    password: "",
  });
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [savedEvents, setSavedEvents] = useState<CrowdLogEvent[]>([]);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [reviewEvent, setReviewEvent] = useState<CrowdLogEvent | null>(null);
  const [documents, setDocuments] = useState<AttendanceDocumentSummary[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [recordAnalytics, setRecordAnalytics] =
    useState<EventRecordAnalytics | null>(null);
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
  const [isHelpOpen, setIsHelpOpen] = useState(false);

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
            phone: session.user?.phone ?? currentDraft.phone,
          }));
        }

        if (!session.user) {
          if (!shouldIgnore) {
            if (shouldOpenPortfolioDemo()) {
              setAuthDraft({
                email: PORTFOLIO_DEMO_OWNER_EMAIL,
                name: PORTFOLIO_DEMO_OWNER_NAME,
                phone: "",
                password: "",
              });
            }
            setSavedEvents([]);
            setRecordAnalytics(null);
            setStatus({
              tone: "info",
              text: shouldOpenPortfolioDemo()
                ? "Sign in to open the portfolio demo event."
                : requestedInviteEventId()
                  ? "Sign in with the invited email address to open this event."
                : "Sign in to load your events.",
            });
          }
          return;
        }

        const events = await listEvents();
        const portfolioDemoEvent = findPortfolioDemoEvent(events);
        const inviteEvent = findInviteEvent(events);
        const requestedEvent = portfolioDemoEvent ?? inviteEvent;

        if (!shouldIgnore) {
          setSavedEvents(events);
          setStatus(null);

          if (requestedEvent) {
            setDraft(eventToDraft(requestedEvent));
            setEditingEventId(requestedEvent.id);
            setReviewEvent(requestedEvent);
            setIsLoadingRecords(true);
            setIsLoadingDocuments(true);
            setFieldSuggestions([]);
            setReviewStatus({
              tone: "info",
              text: portfolioDemoEvent
                ? "Loading portfolio demo event."
                : "Loading invited event.",
            });
          }

          if (shouldOpenPortfolioDemo() && !portfolioDemoEvent) {
            setStatus(portfolioDemoMissingStatus());
          } else if (requestedInviteEventId() && !inviteEvent) {
            setStatus(inviteEventMissingStatus());
          }
        }

        if (requestedEvent) {
          try {
            const [nextDocuments, nextRecords, nextAnalytics] = await Promise.all([
              listDocuments(requestedEvent.id),
              listRecords(requestedEvent.id),
              getEventRecordAnalytics(requestedEvent.id),
            ]);

            if (!shouldIgnore) {
              setDocuments(nextDocuments);
              setSelectedDocumentId(nextDocuments[0]?.id ?? "");
              setRecords(nextRecords);
              setRecordAnalytics(nextAnalytics);
              setReviewStatus({
                tone: "success",
                text: portfolioDemoEvent
                  ? "Portfolio demo loaded."
                  : "Invited event loaded.",
              });
            }
          } catch {
            if (!shouldIgnore) {
              setDocuments([]);
              setSelectedDocumentId("");
              setRecords([]);
              setRecordAnalytics(null);
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

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) {
      return;
    }

    const targetId = window.location.hash.slice(1);

    window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }, []);

  const templateFields = useMemo(
    () =>
      draft.fields
        .filter((field) => field.label.trim())
        .map((field, index) => fieldFromDraft(field, index)),
    [draft.fields],
  );

  const requiredCount = templateFields.filter((field) => field.required).length;
  const fieldTypeSummary = FIELD_TYPES.map((type) => ({
    type,
    count: templateFields.filter((field) => field.type === type).length,
  })).filter((entry) => entry.count > 0);
  const canManageReviewEvent = canManageEvent(reviewEvent, currentUser);
  const editingEvent = useMemo(() => {
    if (!editingEventId) {
      return null;
    }

    return (
      savedEvents.find((event) => event.id === editingEventId) ??
      (reviewEvent?.id === editingEventId ? reviewEvent : null)
    );
  }, [editingEventId, reviewEvent, savedEvents]);
  const isEditingExistingEvent = editingEventId !== null;
  const canSaveDraft =
    !isEditingExistingEvent ||
    (editingEvent ? canManageEvent(editingEvent, currentUser) : false);

  function validateAuthDraft(mode: AuthOtpMode) {
    const email = authDraft.email.trim();
    const name = authDraft.name.trim();
    const phone = authDraft.phone.trim();
    const password = authDraft.password;

    if (!email) {
      setStatus({ tone: "error", text: "Email is required to sign in." });
      return;
    }

    if (!isValidEmailAddress(email)) {
      setStatus({ tone: "error", text: "Enter a valid email address." });
      return;
    }

    if (!password) {
      setStatus({
        tone: "error",
        text:
          mode === "sign-up"
            ? "Password is required to create an account."
            : "Password is required to sign in.",
      });
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatus({
        tone: "error",
        text: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }

    if (mode === "sign-up" && !name) {
      setStatus({ tone: "error", text: "Name is required to create an account." });
      return;
    }

    if (mode === "sign-up" && !phone) {
      setStatus({
        tone: "error",
        text: "Phone number is required to create an account.",
      });
      return;
    }

    if (mode === "sign-up" && !isValidPhoneNumber(phone)) {
      setStatus({ tone: "error", text: "Enter a valid phone number." });
      return;
    }

    return { email, name, phone, password };
  }

  async function requestAuthOtp() {
    const authProfile = validateAuthDraft("sign-up");

    if (!authProfile) {
      return false;
    }

    setIsSigningIn(true);
    setStatus({ tone: "info", text: "Sending verification code." });

    try {
      await requestEmailOtp({
        mode: "sign-up",
        email: authProfile.email,
        name: authProfile.name || undefined,
        phone: authProfile.phone || undefined,
        password: authProfile.password,
      });
      setStatus({ tone: "success", text: "Verification code sent." });

      return true;
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not send code. ${getErrorMessage(error)}`,
      });

      return false;
    } finally {
      setIsSigningIn(false);
    }
  }

  async function verifyAuthOtp(token: string) {
    const authProfile = validateAuthDraft("sign-up");

    if (!authProfile) {
      return false;
    }

    setIsSigningIn(true);
    setStatus({ tone: "info", text: "Verifying email." });

    try {
      const session = await verifyEmailOtp({
        email: authProfile.email,
        token,
        name: authProfile.name || undefined,
        phone: authProfile.phone || undefined,
      });
      const events = await listEvents();
      const portfolioDemoEvent = findPortfolioDemoEvent(events);
      const inviteEvent = findInviteEvent(events);
      const requestedEvent = portfolioDemoEvent ?? inviteEvent;

      setCurrentUser(session.user);
      setAuthDraft({
        email: session.user.email,
        name: session.user.name ?? authProfile.name,
        phone: session.user.phone ?? authProfile.phone,
        password: "",
      });
      setSavedEvents(events);
      setStatus({ tone: "success", text: "Account created and signed in." });

      if (requestedEvent) {
        setDraft(eventToDraft(requestedEvent));
        setEditingEventId(requestedEvent.id);
        await selectReviewEvent(requestedEvent);
      } else if (shouldOpenPortfolioDemo()) {
        setStatus(portfolioDemoMissingStatus());
      } else if (requestedInviteEventId()) {
        setStatus(inviteEventMissingStatus());
      }

      return true;
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not verify code. ${getErrorMessage(error)}`,
      });

      return false;
    } finally {
      setIsSigningIn(false);
      setIsLoadingEvents(false);
    }
  }

  async function signIn() {
    const authProfile = validateAuthDraft("sign-in");

    if (!authProfile) {
      return false;
    }

    setIsSigningIn(true);
    setStatus({ tone: "info", text: "Signing in." });

    try {
      const session = await apiSignIn({
        email: authProfile.email,
        password: authProfile.password,
      });
      const events = await listEvents();
      const portfolioDemoEvent = findPortfolioDemoEvent(events);
      const inviteEvent = findInviteEvent(events);
      const requestedEvent = portfolioDemoEvent ?? inviteEvent;

      setCurrentUser(session.user);
      setAuthDraft({
        email: session.user.email,
        name: session.user.name ?? "",
        phone: session.user.phone ?? "",
        password: "",
      });
      setSavedEvents(events);
      setStatus({ tone: "success", text: "Signed in." });

      if (requestedEvent) {
        setDraft(eventToDraft(requestedEvent));
        setEditingEventId(requestedEvent.id);
        await selectReviewEvent(requestedEvent);
      } else if (shouldOpenPortfolioDemo()) {
        setStatus(portfolioDemoMissingStatus());
      } else if (requestedInviteEventId()) {
        setStatus(inviteEventMissingStatus());
      }

      return true;
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not sign in. ${getErrorMessage(error)}`,
      });

      return false;
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
      setEditingEventId(null);
      setReviewEvent(null);
      setDocuments([]);
      setSelectedDocumentId("");
      setRecords([]);
      setRecordAnalytics(null);
      setMemberDraft({ email: "", name: "" });
      setRemovingMemberIds([]);
      setFieldSuggestions([]);
      setReviewStatus(null);
      setStatus({ tone: "info", text: "Signed out." });
      setAuthDraft((currentDraft) => ({ ...currentDraft, password: "" }));
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

    if (isEditingExistingEvent && !editingEvent) {
      setStatus({
        tone: "error",
        text: "This saved event is no longer available. Reset the draft before saving a new event.",
      });
      return;
    }

    if (isEditingExistingEvent && editingEvent && !canSaveDraft) {
      setStatus({
        tone: "error",
        text: "Only event owners can save changes to this event.",
      });
      return;
    }

    const fieldPayload = fields.map((field) => ({
      id: field.id,
      label: field.label,
      key: field.key,
      type: field.type,
      required: field.required,
      sortOrder: field.sortOrder,
      aliases: field.aliases,
      options: field.options,
    }));

    const createPayload: CreateEventPayload = {
      title,
      description: draft.description.trim(),
      eventDate: draft.eventDate || undefined,
      templateName,
      fields: fieldPayload.map((field) => ({
        label: field.label,
        key: field.key,
        type: field.type,
        required: field.required,
        sortOrder: field.sortOrder,
        aliases: field.aliases,
        options: field.options,
      })),
    };
    const updatePayload: UpdateEventPayload = {
      title,
      description: draft.description.trim(),
      eventDate: draft.eventDate || null,
      templateName,
      fields: fieldPayload.map((field) => ({
        label: field.label,
        id: field.id,
        key: field.key,
        type: field.type,
        required: field.required,
        sortOrder: field.sortOrder,
        aliases: field.aliases,
        options: field.options,
      })),
    };

    setIsSaving(true);
    setStatus({
      tone: "info",
      text: isEditingExistingEvent ? "Saving event changes." : "Saving event.",
    });

    try {
      const event =
        isEditingExistingEvent && editingEvent
          ? await updateEvent(editingEvent.id, updatePayload)
          : await createEvent(createPayload);

      if (isEditingExistingEvent) {
        replaceSavedEvent(event);
      } else {
        setSavedEvents((currentEvents) => [event, ...currentEvents]);
      }

      setDraft(eventToDraft(event));
      setEditingEventId(event.id);
      setStatus({
        tone: "success",
        text: isEditingExistingEvent
          ? "Event template changes saved."
          : "Event template saved to Supabase.",
      });
      setFieldSuggestions([]);
      await selectReviewEvent(event);
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
    setEditingEventId(null);
    setStatus({ tone: "info", text: "Draft cleared." });
  }

  function loadSavedEvent(event: CrowdLogEvent) {
    setDraft(eventToDraft(event));
    setEditingEventId(event.id);
    setStatus({
      tone: "info",
      text: canManageEvent(event, currentUser)
        ? "Saved event loaded for editing."
        : "Saved event loaded for viewing. Only owners can save changes.",
    });
  }

  async function refreshRecordAnalytics(eventId = reviewEvent?.id) {
    if (!eventId) {
      setRecordAnalytics(null);
      return;
    }

    try {
      setRecordAnalytics(await getEventRecordAnalytics(eventId));
    } catch {
      setRecordAnalytics(null);
    }
  }

  async function selectReviewEvent(event: CrowdLogEvent) {
    setReviewEvent(event);
    setIsLoadingRecords(true);
    setIsLoadingDocuments(true);
    setFieldSuggestions([]);
    setReviewStatus({ tone: "info", text: "Loading documents and records." });

    try {
      const [nextDocuments, nextRecords, nextAnalytics] = await Promise.all([
        listDocuments(event.id),
        listRecords(event.id),
        getEventRecordAnalytics(event.id),
      ]);
      setDocuments(nextDocuments);
      setSelectedDocumentId(nextDocuments[0]?.id ?? "");
      setRecords(nextRecords);
      setRecordAnalytics(nextAnalytics);
      setReviewStatus(
        nextRecords.length
          ? { tone: "success", text: "Review records loaded." }
          : { tone: "info", text: "No extracted records for this event yet." },
      );
    } catch {
      setDocuments([]);
      setSelectedDocumentId("");
      setRecords([]);
      setRecordAnalytics(null);
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
        setRecordAnalytics(null);
        setFieldSuggestions([]);
        setReviewStatus({ tone: "info", text: "Deleted event removed." });
      }

      if (editingEventId === event.id) {
        setEditingEventId(null);
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

    if (!isValidEmailAddress(email)) {
      setReviewStatus({ tone: "error", text: "Enter a valid reviewer email." });
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
      setReviewStatus({
        tone: "success",
        text: "Reviewer added and invitation queued.",
      });
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
      await refreshRecordAnalytics(reviewEvent.id);
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
      await refreshRecordAnalytics(document.eventId);
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
      await refreshRecordAnalytics(document.eventId);
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
      await refreshRecordAnalytics(reviewEvent.id);
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
        await refreshRecordAnalytics(reviewEvent.id);
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
      await refreshRecordAnalytics(reviewEvent.id);
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
      await refreshRecordAnalytics(record.eventId);
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
      await refreshRecordAnalytics(record.eventId);
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
      await refreshRecordAnalytics(record.eventId);
      setReviewStatus({ tone: "success", text: "Row rejected." });
    } catch {
      setReviewStatus({ tone: "error", text: "Could not reject row." });
    } finally {
      setRecordBusy(record.id, false);
    }
  }

  return (
    <div className="app-shell min-h-screen text-[#2f241b] lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">
      <header className="sticky top-0 z-30 shrink-0 border-b border-white/50 bg-white/62 shadow-[0_18px_60px_rgba(124,69,32,0.08)] backdrop-blur-2xl">
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="motion-rise flex min-w-0 items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#ff6a00] text-sm font-black text-white shadow-[0_14px_30px_rgba(249,115,22,0.28)]">
              CL
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ff6a00]">
                CrowdLog
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[#2f241b] sm:text-3xl">
                Attendance sheets into clean records.
              </h1>
            </div>
          </div>
          <div className="motion-rise-delay-1 flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#70411d]">
              <span className="rounded-md border border-[#fed7aa] bg-[#fff7ed]/80 px-3 py-1.5 shadow-sm">
                Auth phase
              </span>
              <span className="rounded-md border border-[#ecc6a9] bg-[#fff0e5]/80 px-3 py-1.5 shadow-sm">
                Owner events
              </span>
              <span className="rounded-md border border-[#b9cfdf] bg-[#ebf5fb]/80 px-3 py-1.5 shadow-sm">
                OCR review
              </span>
              <button
                type="button"
                aria-label="Open website help"
                title="Open website help"
                onClick={() => setIsHelpOpen(true)}
                className="grid h-8 w-8 place-items-center rounded-full border border-[#fed7aa] bg-white/80 text-sm font-black text-[#f97316] shadow-sm hover:bg-white"
              >
                ?
              </button>
            </div>
            <AuthPanel
              currentUser={currentUser}
              authDraft={authDraft}
              isLoadingSession={isLoadingSession}
              isSigningIn={isSigningIn}
              onAuthDraftChange={setAuthDraft}
              onRequestOtp={requestAuthOtp}
              onSignIn={signIn}
              onVerifyOtp={verifyAuthOtp}
              onSignOut={signOut}
            />
          </div>
        </div>
      </header>

      {isHelpOpen ? (
        <WebsiteHelpDialog onClose={() => setIsHelpOpen(false)} />
      ) : null}

      <main className="mx-auto grid w-full max-w-[1480px] gap-6 px-4 py-6 sm:px-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden lg:px-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section
          id="portfolio-template-builder"
          className="scroll-mt-5 space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-2 lg:pb-6"
        >
          <div className="glass-panel motion-rise overflow-hidden rounded-lg">
            <div className="panel-head px-4 py-4 sm:px-5">
              <h2 className="text-lg font-semibold text-[#2f241b]">Event</h2>
            </div>
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
                Event title
                <input
                  value={draft.title}
                  onChange={(event) => updateDraft("title", event.target.value)}
                  className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#ff6a00] focus:ring-2 focus:ring-[#fed7aa]"
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
                  className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#ff6a00] focus:ring-2 focus:ring-[#fed7aa]"
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
                  className="min-h-24 resize-y rounded-md border border-[#cbd5c8] bg-white px-3 py-2 text-sm font-normal outline-none transition focus:border-[#ff6a00] focus:ring-2 focus:ring-[#fed7aa]"
                />
              </label>
            </div>
          </div>

          <div className="glass-panel motion-rise-delay-1 overflow-hidden rounded-lg">
            <div className="panel-head flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="text-lg font-semibold text-[#2f241b]">
                  Attendance template
                </h2>
                <p className="mt-1 text-sm text-[#5f7370]">
                  Event - Template - Fields
                </p>
              </div>
              <button
                type="button"
                onClick={addField}
                className="action-primary h-10 rounded-md px-4 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#fed7aa]"
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
                  className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#ff6a00] focus:ring-2 focus:ring-[#fed7aa]"
                />
              </label>

              <div className="space-y-3">
                {draft.fields.length === 0 ? (
                  <div className="soft-card rounded-lg p-5 text-sm text-[#6f6359]">
                    <p className="font-semibold text-[#2f241b]">
                      No attendance fields yet.
                    </p>
                    <p className="mt-1">
                      Add fields for the information you want to capture, such
                      as name, matric number, department, level, or signature.
                    </p>
                    <button
                      type="button"
                      onClick={addField}
                      className="action-primary mt-4 h-10 rounded-md px-4 text-sm font-semibold text-white"
                    >
                      Add first field
                    </button>
                  </div>
                ) : (
                  draft.fields.map((field, index) => (
                    <article
                      key={field.id}
                      className="field-card overflow-hidden rounded-lg border"
                    >
                      <div className="flex flex-col gap-3 border-b border-[#dce8e4] bg-white/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-md bg-gradient-to-br from-[#ff6a00] to-[#fff700] px-2 text-sm font-semibold text-white shadow-sm">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#2f241b]">
                              {field.label || `Field ${index + 1}`}
                            </p>
                            <p className="mt-1 block truncate text-xs font-medium text-[#6d7f7c]">
                              Order {index + 1} in this attendance template
                            </p>
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
                            className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#ff6a00] focus:ring-2 focus:ring-[#fed7aa]"
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
                            className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#ff6a00] focus:ring-2 focus:ring-[#fed7aa]"
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
                            className="h-4 w-4 rounded border-[#aebbac] accent-[#ff6a00]"
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
                            className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#ff6a00] focus:ring-2 focus:ring-[#fed7aa]"
                          />
                        </label>

                        <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265] sm:col-span-2 xl:col-span-2">
                          Options
                          <input
                            value={field.optionsText}
                            disabled={!fieldUsesOptions(field.type)}
                            onChange={(event) =>
                              updateField(field.id, (currentField) => ({
                                ...currentField,
                                optionsText: event.target.value,
                              }))
                            }
                            className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition disabled:bg-[#f1f3ee] disabled:text-[#8a9588] focus:border-[#ff6a00] focus:ring-2 focus:ring-[#fed7aa]"
                          />
                        </label>
                      </div>

                      <div className="flex flex-col gap-2 border-t border-[#e8ece5] bg-white/62 px-3 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-4">
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
                  ))
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-h-6 text-sm">
                  {status ? (
                    <p
                      className={
                        status.tone === "success"
                          ? "font-medium text-[#ff6a00]"
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
                    {isEditingExistingEvent ? "New draft" : "Reset draft"}
                  </button>
                  <button
                    type="button"
                    onClick={saveEventTemplate}
                    disabled={
                      isSaving ||
                      !currentUser ||
                      isLoadingSession ||
                      !canSaveDraft
                    }
                    className="action-primary h-11 rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#fed7aa]"
                  >
                    {isSaving
                      ? "Saving..."
                      : isEditingExistingEvent
                        ? "Save changes"
                        : "Save event template"}
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
            analytics={recordAnalytics}
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

        <aside className="space-y-5 lg:min-h-0 lg:overflow-y-auto lg:pl-1 lg:pb-6">
          <section
            id="portfolio-template-summary"
            className="glass-panel-strong motion-rise-delay-1 overflow-hidden rounded-lg"
          >
            <div className="panel-head px-4 py-4">
              <h2 className="text-lg font-semibold text-[#2f241b]">
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
              <div className="soft-card rounded-lg p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#667265]">
                  Field types
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-[#70411d]">
                  {fieldTypeSummary.length > 0 ? (
                    fieldTypeSummary.map((entry) => (
                      <span
                        key={entry.type}
                        className="rounded-md border border-[#fed7aa] bg-white/75 px-2.5 py-1 shadow-sm"
                      >
                        {FIELD_TYPE_LABELS[entry.type]}: {entry.count}
                      </span>
                    ))
                  ) : (
                    <span className="text-[#6d7f7c]">
                      Add fields to see the mix.
                    </span>
                  )}
                </div>
              </div>
              <div className="soft-card rounded-lg p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#667265]">
                  Draft readiness
                </p>
                <div className="mt-3 grid gap-2 text-sm text-[#70411d]">
                  <div className="flex items-center justify-between gap-3 rounded-md bg-white/70 px-3 py-2">
                    <span>Event title</span>
                    <span className="font-semibold text-[#2f241b]">
                      {draft.title.trim() ? "Set" : "Missing"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md bg-white/70 px-3 py-2">
                    <span>Template name</span>
                    <span className="font-semibold text-[#2f241b]">
                      {draft.templateName.trim() ? "Set" : "Missing"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md bg-white/70 px-3 py-2">
                    <span>Required coverage</span>
                    <span className="font-semibold text-[#2f241b]">
                      {requiredCount} of {templateFields.length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section
            id="portfolio-saved-events"
            className="glass-panel-strong motion-rise-delay-2 overflow-hidden rounded-lg"
          >
            <div className="panel-head px-4 py-4">
              <h2 className="text-lg font-semibold text-[#2f241b]">
                Saved events
              </h2>
            </div>
            <div className="divide-y divide-[#dce8e4]">
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
                    <div
                      key={event.id}
                      className="px-4 py-4 transition hover:bg-white/42"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#2f241b]">
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
                            {isOwner ? "Edit" : "View"}
                          </button>
                          <button
                            type="button"
                            onClick={() => selectReviewEvent(event)}
                            disabled={isDeleting}
                            className="action-primary h-9 rounded-md px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Review
                          </button>
                          {eventRole ? (
                            <Link
                              href={`/events/${event.id}/team`}
                              className="inline-flex h-9 items-center rounded-md border border-[#cbd5c8] px-3 text-sm font-semibold text-[#334033] transition hover:bg-[#f3f5ef]"
                            >
                              Team
                            </Link>
                          ) : null}
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
