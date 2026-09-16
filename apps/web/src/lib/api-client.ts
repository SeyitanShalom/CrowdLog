import type { CrowdLogEvent, TemplateField } from "@crowdlog/shared";

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

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}
