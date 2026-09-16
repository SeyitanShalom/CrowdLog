import { TemplateFieldType } from "@prisma/client";
import type { ApiFieldType } from "./dto/template-field-input.dto";

export function toPrismaFieldType(type: ApiFieldType) {
  const fieldTypes: Record<ApiFieldType, TemplateFieldType> = {
    text: TemplateFieldType.TEXT,
    email: TemplateFieldType.EMAIL,
    phone: TemplateFieldType.PHONE,
    number: TemplateFieldType.NUMBER,
    signature: TemplateFieldType.SIGNATURE,
    date: TemplateFieldType.DATE,
    select: TemplateFieldType.SELECT,
  };

  return fieldTypes[type];
}
