import { TemplateFieldType, type Prisma } from "@prisma/client";

const eventInclude = {
  templates: {
    orderBy: { createdAt: "asc" },
    include: {
      fields: {
        orderBy: { sortOrder: "asc" },
      },
    },
  },
} satisfies Prisma.EventInclude;

export type EventWithTemplates = Prisma.EventGetPayload<{
  include: typeof eventInclude;
}>;

type TemplateWithFields = EventWithTemplates["templates"][number];
type FieldWithJson = TemplateWithFields["fields"][number];

const fieldTypeMap: Record<TemplateFieldType, string> = {
  TEXT: "text",
  EMAIL: "email",
  PHONE: "phone",
  NUMBER: "number",
  SIGNATURE: "signature",
  DATE: "date",
  SELECT: "select",
};

export function getEventInclude() {
  return eventInclude;
}

export function toEventResponse(event: EventWithTemplates) {
  const defaultTemplate =
    event.templates.find((template) => template.isDefault) ??
    event.templates[0];

  return {
    id: event.id,
    title: event.title,
    description: event.description ?? "",
    eventDate: event.eventDate ? toDateInputValue(event.eventDate) : "",
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    template: defaultTemplate
      ? toTemplateResponse(defaultTemplate)
      : {
          id: "",
          eventId: event.id,
          name: "Default attendance template",
          isDefault: true,
          fields: [],
          createdAt: event.createdAt.toISOString(),
          updatedAt: event.updatedAt.toISOString(),
        },
  };
}

export function toTemplateResponse(template: TemplateWithFields) {
  return {
    id: template.id,
    eventId: template.eventId,
    name: template.name,
    isDefault: template.isDefault,
    fields: template.fields.map(toFieldResponse),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

export function toFieldResponse(field: FieldWithJson) {
  return {
    id: field.id,
    label: field.label,
    key: field.key,
    type: fieldTypeMap[field.type],
    required: field.required,
    sortOrder: field.sortOrder,
    aliases: jsonStringArray(field.aliases),
    options: jsonStringArray(field.options),
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString(),
  };
}

function jsonStringArray(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}
