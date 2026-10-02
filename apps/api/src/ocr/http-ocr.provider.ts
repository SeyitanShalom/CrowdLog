import { Injectable } from "@nestjs/common";
import type { Prisma, TemplateField } from "@prisma/client";
import { readFile } from "node:fs/promises";
import {
  type OcrCellValue,
  type OcrExtractionInput,
  type OcrExtractionResult,
  type OcrExtractedCell,
  type OcrExtractedRow,
  type OcrProvider,
  type OcrSuggestedField,
  type OcrSuggestedFieldType,
} from "./ocr-provider.interface";
import {
  clampConfidence,
  normalizeOcrCellValue,
} from "./ocr-value-normalization";

type HttpOcrResponse = {
  providerName?: unknown;
  rawOcrJson?: unknown;
  rows?: unknown;
  suggestedFields?: unknown;
};

type HttpOcrRow = {
  rowNumber?: unknown;
  sourcePage?: unknown;
  data?: unknown;
  values?: unknown;
  confidenceScore?: unknown;
};

type HttpOcrCell = {
  fieldKey?: unknown;
  key?: unknown;
  rawValue?: unknown;
  normalizedValue?: unknown;
  confidence?: unknown;
  issues?: unknown;
  validationIssues?: unknown;
  boundingBox?: unknown;
};

@Injectable()
export class HttpOcrProvider implements OcrProvider {
  readonly name = "http-ocr";

  canReadPdfDirectly(input: OcrExtractionInput) {
    return (
      input.document.fileType === "application/pdf" &&
      Boolean(process.env.OCR_HTTP_ENDPOINT?.trim()) &&
      process.env.OCR_HTTP_DIRECT_PDF === "true"
    );
  }

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    const endpoint = process.env.OCR_HTTP_ENDPOINT?.trim();

    if (!endpoint) {
      throw new Error("OCR_HTTP_ENDPOINT is required when OCR_PROVIDER is http.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(await this.requestPayload(input)),
    });
    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      const detail = bodyText ? ` ${bodyText.slice(0, 300)}` : "";

      throw new Error(
        `HTTP OCR provider failed with status ${response.status}.${detail}`,
      );
    }

    return this.toExtractionResult(input, this.parseResponse(bodyText));
  }

  private headers() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const bearerToken = process.env.OCR_HTTP_BEARER_TOKEN?.trim();

    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    return headers;
  }

  private async requestPayload(input: OcrExtractionInput) {
    return {
      type: "crowdlog_ocr_extraction",
      document: {
        id: input.document.id ?? null,
        eventId: input.document.eventId,
        fileName: input.document.fileName,
        fileType: input.document.fileType,
        fileUrl: input.document.fileUrl,
        ...(await this.documentContent(input.document.filePath)),
      },
      template: {
        id: input.template.id,
        name: input.template.name,
        fields: input.template.fields.map((field) => ({
          id: field.id,
          label: field.label,
          key: field.key,
          type: field.type,
          required: field.required,
          sortOrder: field.sortOrder,
          aliases: jsonStringArray(field.aliases),
          options: jsonStringArray(field.options),
        })),
      },
      options: input.options ?? {},
    };
  }

  private async documentContent(filePath: string | undefined) {
    if (!filePath || process.env.OCR_HTTP_INCLUDE_FILE === "false") {
      return {};
    }

    const content = await readFile(filePath);

    return {
      contentEncoding: "base64",
      fileBase64: content.toString("base64"),
      fileSize: content.byteLength,
    };
  }

  private parseResponse(bodyText: string): HttpOcrResponse {
    if (!bodyText) {
      return {};
    }

    try {
      const parsed = JSON.parse(bodyText);

      return isPlainObject(parsed) ? parsed : {};
    } catch {
      throw new Error("HTTP OCR provider returned invalid JSON.");
    }
  }

  private toExtractionResult(
    input: OcrExtractionInput,
    response: HttpOcrResponse,
  ): OcrExtractionResult {
    return {
      providerName:
        typeof response.providerName === "string"
          ? response.providerName
          : this.name,
      rawOcrJson: this.toRawOcrJson(response),
      rows: this.toRows(input.template.fields, response.rows),
      suggestedFields: this.toSuggestedFields(response.suggestedFields),
    };
  }

  private toRawOcrJson(response: HttpOcrResponse) {
    const rawOcrJson = toInputJsonObject(response.rawOcrJson);

    if (rawOcrJson) {
      return rawOcrJson;
    }

    return {
      provider: this.name,
      response: toJsonValue(response),
    } satisfies Prisma.InputJsonObject;
  }

  private toRows(fields: TemplateField[], rows: unknown): OcrExtractedRow[] {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .filter(isPlainObject)
      .map((row, index) => this.toRow(fields, row as HttpOcrRow, index));
  }

  private toRow(
    fields: TemplateField[],
    row: HttpOcrRow,
    index: number,
  ): OcrExtractedRow {
    const data = isPlainObject(row.data) ? row.data : {};
    const cellsByKey = this.cellsByFieldKey(row.values);
    const values = fields.map((field) =>
      this.toCell(field, data[field.key], cellsByKey.get(field.key)),
    );
    const rowData = Object.fromEntries(
      values.map((value) => [value.field.key, value.normalizedValue]),
    ) as Record<string, OcrCellValue>;
    const averageConfidence = values.length
      ? values.reduce((sum, value) => sum + value.confidence, 0) / values.length
      : 0;

    return {
      rowNumber: positiveInteger(row.rowNumber) ?? index + 1,
      sourcePage: positiveInteger(row.sourcePage),
      data: rowData,
      values,
      confidenceScore:
        confidenceNumber(row.confidenceScore) ??
        Number(averageConfidence.toFixed(2)),
    };
  }

  private toCell(
    field: TemplateField,
    dataValue: unknown,
    cell: HttpOcrCell | undefined,
  ): OcrExtractedCell {
    const rawValue =
      toCellValue(cell?.rawValue) ?? toCellValue(dataValue) ?? "";
    const normalized = normalizeOcrCellValue(field, String(rawValue));
    const explicitNormalizedValue = toCellValue(cell?.normalizedValue);
    const normalizedValue =
      explicitNormalizedValue !== undefined
        ? explicitNormalizedValue
        : normalized.normalizedValue;
    const issues =
      stringArray(cell?.issues) ??
      stringArray(cell?.validationIssues) ??
      normalized.issues;

    return {
      field,
      rawValue,
      normalizedValue,
      confidence:
        confidenceNumber(cell?.confidence) ??
        Number(normalized.confidence.toFixed(2)),
      issues,
      boundingBox: toInputJsonObject(cell?.boundingBox),
    };
  }

  private cellsByFieldKey(values: unknown) {
    const result = new Map<string, HttpOcrCell>();

    if (!Array.isArray(values)) {
      return result;
    }

    for (const value of values) {
      if (!isPlainObject(value)) {
        continue;
      }

      const keyValue = value.fieldKey ?? value.key;

      if (typeof keyValue === "string" && keyValue.trim()) {
        result.set(keyValue, value as HttpOcrCell);
      }
    }

    return result;
  }

  private toSuggestedFields(value: unknown): OcrSuggestedField[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(isPlainObject).flatMap((item) => {
      const label = stringValue(item.label);
      const key = stringValue(item.key);
      const type = suggestedFieldType(item.type);

      if (!label || !key || !type) {
        return [];
      }

      return [
        {
          label,
          key,
          type,
          aliases: stringArray(item.aliases) ?? [],
          options: stringArray(item.options) ?? [],
          sampleValues: stringArray(item.sampleValues) ?? [],
          confidence: confidenceNumber(item.confidence) ?? 0.5,
        },
      ];
    });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toCellValue(value: unknown): OcrCellValue | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return undefined;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function confidenceNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(clampConfidence(value).toFixed(2))
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter((item): item is string => typeof item === "string");
}

function jsonStringArray(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function suggestedFieldType(value: unknown): OcrSuggestedFieldType | null {
  return value === "text" ||
    value === "email" ||
    value === "phone" ||
    value === "number" ||
    value === "signature" ||
    value === "date" ||
    value === "select" ||
    value === "multi_select"
    ? value
    : null;
}

function toInputJsonObject(value: unknown) {
  const json = toJsonValue(value);

  return json && typeof json === "object" && !Array.isArray(json)
    ? (json as Prisma.InputJsonObject)
    : null;
}

function toJsonValue(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}
