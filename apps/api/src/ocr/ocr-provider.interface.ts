import type { Prisma, TemplateField } from "@prisma/client";

export const OCR_PROVIDER = Symbol("OCR_PROVIDER");

export type OcrCellValue = string | number | boolean | null;

export type OcrDocumentInput = {
  id?: string;
  eventId: string;
  fileName: string;
  fileType: string | null;
  fileUrl: string;
};

export type OcrTemplateInput = {
  id: string;
  name: string;
  fields: TemplateField[];
};

export type OcrExtractionOptions = {
  rowCount?: number;
};

export type OcrExtractedCell = {
  field: TemplateField;
  rawValue: OcrCellValue;
  normalizedValue: OcrCellValue;
  confidence: number;
  boundingBox?: Prisma.InputJsonObject | null;
};

export type OcrExtractedRow = {
  rowNumber: number;
  data: Record<string, OcrCellValue>;
  values: OcrExtractedCell[];
  confidenceScore: number;
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
};

export interface OcrProvider {
  readonly name: string;
  extract(input: OcrExtractionInput): Promise<OcrExtractionResult>;
}
