import type {
  AttendanceDocumentSummary,
  AttendanceRecord,
  AuthSession,
  AuthUser,
  CrowdLogEvent,
  EventMemberRole,
  EventRecordAnalytics,
  MockExtractionResult,
  RecordData,
  RecordStatus,
  TemplateField,
} from "@crowdlog/shared";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000");

export type CreateEventPayload = {
  title: string;
  description?: string;
  eventDate?: string;
  templateName: string;
  fields: Array<
    Pick<
      TemplateField,
      "label" | "key" | "type" | "required" | "sortOrder" | "aliases" | "options"
    >
  >;
};

export type UpdateEventPayload = Omit<
  CreateEventPayload,
  "eventDate" | "fields"
> & {
  eventDate?: string | null;
  fields: Array<
    Pick<
      TemplateField,
      | "id"
      | "label"
      | "key"
      | "type"
      | "required"
      | "sortOrder"
      | "aliases"
      | "options"
    >
  >;
};

export type AuthProfilePayload = {
  email: string;
  name?: string;
  phone?: string;
};

export type AuthOtpMode = "sign-in" | "sign-up";

export type SignInPayload = {
  email: string;
  password: string;
};

export type RequestEmailOtpPayload = AuthProfilePayload & {
  mode: "sign-up";
};

export type VerifyEmailOtpPayload = AuthProfilePayload & {
  token: string;
  password: string;
};

export async function getCurrentSession() {
  return request<AuthSession>("/auth/me");
}

export async function requestEmailOtp(payload: RequestEmailOtpPayload) {
  return request<{ ok: true }>("/auth/otp/request", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function verifyEmailOtp(payload: VerifyEmailOtpPayload) {
  return request<{ user: AuthUser }>("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function signIn(payload: SignInPayload) {
  return request<{ user: AuthUser }>("/auth/sign-in", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function signOut() {
  return request<{ ok: true }>("/auth/sign-out", {
    method: "POST",
  });
}

export async function listEvents() {
  return request<CrowdLogEvent[]>("/events");
}

export async function getEvent(eventId: string) {
  return request<CrowdLogEvent>(`/events/${eventId}`);
}

export async function createEvent(payload: CreateEventPayload) {
  return request<CrowdLogEvent>("/events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateEvent(
  eventId: string,
  payload: UpdateEventPayload,
) {
  return request<CrowdLogEvent>(`/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteEvent(eventId: string) {
  return request<{ id: string }>(`/events/${eventId}`, {
    method: "DELETE",
  });
}

export type AddEventReviewerPayload = {
  email: string;
  name?: string;
};

export async function addEventReviewer(
  eventId: string,
  payload: AddEventReviewerPayload,
) {
  return request<CrowdLogEvent>(`/events/${eventId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function removeEventMember(eventId: string, memberId: string) {
  return request<CrowdLogEvent>(`/events/${eventId}/members/${memberId}`, {
    method: "DELETE",
  });
}

export type UpdateEventMemberPayload = {
  role: EventMemberRole;
};

export async function updateEventMember(
  eventId: string,
  memberId: string,
  payload: UpdateEventMemberPayload,
) {
  return request<CrowdLogEvent>(`/events/${eventId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type CreateTemplateFieldPayload = Pick<
  TemplateField,
  "label" | "key" | "type" | "required" | "sortOrder" | "aliases" | "options"
>;

export async function createTemplateField(
  templateId: string,
  payload: CreateTemplateFieldPayload,
) {
  return request<TemplateField>(`/templates/${templateId}/fields`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type UpdateAttendanceRecordPayload = {
  data?: RecordData;
  status?: RecordStatus;
};

export async function listRecords(eventId: string) {
  return request<AttendanceRecord[]>(`/events/${eventId}/records`);
}

export async function getEventRecordAnalytics(eventId: string) {
  return request<EventRecordAnalytics>(`/events/${eventId}/records/analytics`);
}

export async function exportEventRecordsCsv(eventId: string) {
  return exportEventRecordsFile({
    path: `/events/${eventId}/records/export`,
    fallbackFileName: `crowdlog-event-${eventId}.csv`,
    failureLabel: "CSV export",
    fallbackContentType: "text/csv;charset=utf-8",
  });
}

export async function exportEventRecordsXlsx(eventId: string) {
  return exportEventRecordsFile({
    path: `/events/${eventId}/records/export.xlsx?scope=data-only&v=2`,
    fallbackFileName: `crowdlog-event-${eventId}.xlsx`,
    failureLabel: "Excel export",
    fallbackContentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function exportEventRecordsFile({
  path,
  fallbackFileName,
  failureLabel,
  fallbackContentType,
}: {
  path: string;
  fallbackFileName: string;
  failureLabel: string;
  fallbackContentType: string;
}) {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      credentials: "include",
    });
  } catch {
    throw new Error(`Could not reach the API at ${API_BASE_URL}.`);
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(
      message || `${failureLabel} failed with status ${response.status}.`,
    );
  }

  const contentType = response.headers.get("Content-Type") ?? fallbackContentType;
  const content = await response.arrayBuffer();

  return {
    blob: blobFromExportContent(content, contentType, fallbackContentType),
    fileName:
      fileNameFromContentDisposition(response.headers.get("Content-Disposition")) ??
      fallbackFileName,
  };
}

function blobFromExportContent(
  content: ArrayBuffer,
  contentType: string,
  fallbackContentType: string,
) {
  const bytes = new Uint8Array(content);
  const serializedBufferBytes = bufferBytesFromSerializedJson(bytes);

  if (serializedBufferBytes) {
    return new Blob([serializedBufferBytes], { type: fallbackContentType });
  }

  return new Blob([bytes], { type: contentType });
}

function bufferBytesFromSerializedJson(bytes: Uint8Array) {
  const marker = '{"type":"Buffer","data":[';
  const prefix = new TextDecoder().decode(bytes.slice(0, marker.length));

  if (prefix !== marker) {
    return null;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("type" in parsed) ||
      !("data" in parsed) ||
      parsed.type !== "Buffer" ||
      !Array.isArray(parsed.data)
    ) {
      return null;
    }

    const data = parsed.data;

    if (
      !data.every(
        (value) =>
          Number.isInteger(value) && value >= 0 && value <= 255,
      )
    ) {
      return null;
    }

    return new Uint8Array(data);
  } catch {
    return null;
  }
}

export async function listDocuments(eventId: string) {
  return request<AttendanceDocumentSummary[]>(`/events/${eventId}/documents`);
}

export async function uploadAttendanceDocument(eventId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return request<AttendanceDocumentSummary>(`/events/${eventId}/documents`, {
    method: "POST",
    body: formData,
  });
}

export async function replaceAttendanceDocument(documentId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return request<AttendanceDocumentSummary>(`/documents/${documentId}`, {
    method: "PUT",
    body: formData,
  });
}

export type DeleteAttendanceDocumentResult = {
  id: string;
  eventId: string;
  deletedRecordCount: number;
};

export async function deleteAttendanceDocument(documentId: string) {
  return request<DeleteAttendanceDocumentResult>(`/documents/${documentId}`, {
    method: "DELETE",
  });
}

export async function mockExtractRecords(eventId: string, rowCount = 4) {
  return request<MockExtractionResult>(`/events/${eventId}/mock-extract`, {
    method: "POST",
    body: JSON.stringify({ rowCount }),
  });
}

export async function mockExtractDocument(documentId: string, rowCount = 4) {
  return request<MockExtractionResult>(`/documents/${documentId}/mock-extract`, {
    method: "POST",
    body: JSON.stringify({ rowCount }),
  });
}

export type ExtractDocumentOptions = {
  rowCount?: number;
  pageStart?: number;
  pageCount?: number;
  layout?: "table" | "form";
};

export async function extractDocument(
  documentId: string,
  options: ExtractDocumentOptions = { rowCount: 50 },
) {
  return request<MockExtractionResult>(`/documents/${documentId}/extract`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function getApiFileUrl(fileUrl: string) {
  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
    return fileUrl;
  }

  return `${API_BASE_URL}${fileUrl.startsWith("/") ? fileUrl : `/${fileUrl}`}`;
}

export async function updateAttendanceRecord(
  recordId: string,
  payload: UpdateAttendanceRecordPayload,
) {
  return request<AttendanceRecord>(`/records/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function approveAttendanceRecord(recordId: string) {
  return request<AttendanceRecord>(`/records/${recordId}/approve`, {
    method: "POST",
  });
}

export async function rejectAttendanceRecord(recordId: string) {
  return request<AttendanceRecord>(`/records/${recordId}/reject`, {
    method: "POST",
  });
}

async function request<T>(path: string, init?: RequestInit) {
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(`Could not reach the API at ${API_BASE_URL}.`);
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(
      message || `API request failed with status ${response.status}.`,
    );
  }

  return (await response.json()) as T;
}

async function readErrorMessage(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message;

    if (typeof message === "string" && message.trim()) {
      return message;
    }

    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    return text;
  }

  return text || fallback;
}

function fileNameFromContentDisposition(header: string | null) {
  if (!header) {
    return null;
  }

  const encodedFileName = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];

  if (encodedFileName) {
    try {
      return decodeURIComponent(encodedFileName);
    } catch {
      return encodedFileName;
    }
  }

  const quotedFileName = header.match(/filename="([^"]+)"/i)?.[1];

  if (quotedFileName) {
    return quotedFileName;
  }

  return header.match(/filename=([^;]+)/i)?.[1]?.trim() ?? null;
}
