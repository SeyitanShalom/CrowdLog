import type { Prisma, TemplateField } from "@prisma/client";

export const OCR_PROVIDER = Symbol("OCR_PROVIDER");

export type OcrCellValue = string | number | boolean | null;

export type OcrDocumentInput = {
  id?: string;
  eventId: string;
  fileName: string;
  fileType: string | null;
  fileUrl: string;
  filePath?: string;
};

export type OcrTemplateInput = {
  id: string;
  name: string;
  fields: TemplateField[];
};

export type OcrExtractionOptions = {
  rowCount?: number;
  pageStart?: number;
  pageCount?: number;
  totalPages?: number;
  layout?: "table" | "form";
};

export type OcrExtractedCell = {
  field: TemplateField;
  rawValue: OcrCellValue;
  normalizedValue: OcrCellValue;
  confidence: number;
  issues?: string[];
  boundingBox?: Prisma.InputJsonObject | null;
};

export type OcrExtractedRow = {
  rowNumber: number;
  sourcePage?: number;
  data: Record<string, OcrCellValue>;
  values: OcrExtractedCell[];
  confidenceScore: number;
};

export type OcrSuggestedFieldType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "signature"
  | "date"
  | "select"
  | "multi_select";

export type OcrSuggestedField = {
  label: string;
  key: string;
  type: OcrSuggestedFieldType;
  aliases: string[];
  options: string[];
  sampleValues: string[];
  confidence: number;
};

export type OcrExtractionInput = {
  document: OcrDocumentInput;
  template: OcrTemplateInput;
  options?: OcrExtractionOptions;
};

export type OcrExtractionResult = {
  providerName: string;
  rawOcrJson: Prisma.InputJsonObject;
  rows: OcrExtractedRow[];
  suggestedFields: OcrSuggestedField[];
};

export interface OcrProvider {
  readonly name: string;
  canReadPdfDirectly?(input: OcrExtractionInput): boolean;
  extract(input: OcrExtractionInput): Promise<OcrExtractionResult>;
}
