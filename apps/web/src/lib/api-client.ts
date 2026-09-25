import type {
  AttendanceDocumentSummary,
  AttendanceRecord,
  CrowdLogEvent,
  MockExtractionResult,
  RecordData,
  RecordStatus,
  TemplateField,
} from "@crowdlog/shared";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:4000";

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

export async function listEvents() {
  return request<CrowdLogEvent[]>("/events");
}

export async function createEvent(payload: CreateEventPayload) {
  return request<CrowdLogEvent>("/events", {
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
