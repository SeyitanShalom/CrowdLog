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
  cleanOcrText,
  getOcrFieldTerms,
  normalizeNoisyOcrTerm,
  normalizeOcrCellValue,
  normalizeOcrTerm,
} from "./ocr-value-normalization";

const MAX_HEADER_MATCH_SCORE = 14;

type GoogleProcessResponse = {
  document?: GoogleDocument;
  humanReviewStatus?: unknown;
};

type GoogleDocument = {
  text?: unknown;
  pages?: unknown;
  entities?: unknown;
};

type GooglePage = {
  pageNumber?: unknown;
  tables?: unknown;
  formFields?: unknown;
};

type GoogleTable = {
  headerRows?: unknown;
  bodyRows?: unknown;
};

type GoogleTableRow = {
  cells?: unknown;
};

type GoogleTableCell = {
  layout?: unknown;
};

type GoogleFormField = {
  fieldName?: GoogleLayoutContainer;
  fieldValue?: GoogleLayoutContainer;
};

type GoogleEntity = {
  type?: unknown;
  mentionText?: unknown;
  confidence?: unknown;
  pageAnchor?: unknown;
};

type GoogleLayoutContainer = {
  layout?: unknown;
};

type GoogleLayout = {
  textAnchor?: unknown;
  confidence?: unknown;
  boundingPoly?: unknown;
};

type HeaderMapping = {
  field: TemplateField;
  columnIndex: number;
  headerText: string | null;
  confidence: number;
};

type TableSuggestionSource = {
  headerText: string;
  sampleValues: string[];
  confidence: number;
};

type KeyValuePair = {
  key: string;
  value: string;
  confidence: number;
  boundingBox: Prisma.InputJsonObject | null;
  pageNumber?: number;
};

@Injectable()
export class GoogleDocumentAiOcrProvider implements OcrProvider {
  readonly name = "google-document-ai";

  canReadPdfDirectly(input: OcrExtractionInput) {
    return (
      input.document.fileType === "application/pdf" &&
      Boolean(input.document.filePath) &&
      this.isConfigured()
    );
  }

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    if (!input.document.filePath) {
      throw new Error("Google Document AI OCR requires a local document file.");
    }

    const response = await this.processDocument(input);
    const document = response.document ?? {};
    const rows =
      input.options?.layout === "form"
        ? this.rowsFromFormData(input.template.fields, document, input)
        : this.rowsFromTables(input.template.fields, document, input);

    return {
      providerName: this.name,
      rawOcrJson: this.toRawOcrJson(input, response),
      rows,
      suggestedFields: this.suggestedFieldsFromTables(
        input.template.fields,
        document,
      ),
    };
  }

  private async processDocument(input: OcrExtractionInput) {
    const accessToken = requiredEnv(
      "GOOGLE_DOCUMENT_AI_ACCESS_TOKEN",
      "Google Document AI OCR",
    );
    const fileContent = await readFile(input.document.filePath as string);
    const response = await fetch(this.processUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        skipHumanReview: process.env.GOOGLE_DOCUMENT_AI_SKIP_HUMAN_REVIEW !== "false",
        rawDocument: {
          mimeType: input.document.fileType || "application/octet-stream",
          content: fileContent.toString("base64"),
        },
        ...this.fieldMask(),
        ...this.processOptions(input),
      }),
    });
    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      throw new Error(
        `Google Document AI process request failed with status ${
          response.status
        }.${this.errorDetail(bodyText)}`,
      );
    }

    return this.parseJsonResponse(bodyText);
  }

  private processUrl() {
    const projectId = requiredEnv(
      "GOOGLE_DOCUMENT_AI_PROJECT_ID",
      "Google Document AI OCR",
    );
    const location = requiredEnv(
      "GOOGLE_DOCUMENT_AI_LOCATION",
      "Google Document AI OCR",
    );
    const processorId = requiredEnv(
      "GOOGLE_DOCUMENT_AI_PROCESSOR_ID",
      "Google Document AI OCR",
    );
    const endpoint =
      process.env.GOOGLE_DOCUMENT_AI_ENDPOINT?.trim() ??
      `https://${location}-documentai.googleapis.com`;
    const processorVersion =
      process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION?.trim();
    const processorPath = processorVersion
      ? `/v1/projects/${encodeURIComponent(
          projectId,
        )}/locations/${encodeURIComponent(location)}/processors/${encodeURIComponent(
          processorId,
        )}/processorVersions/${encodeURIComponent(processorVersion)}:process`
      : `/v1/projects/${encodeURIComponent(
          projectId,
        )}/locations/${encodeURIComponent(location)}/processors/${encodeURIComponent(
          processorId,
        )}:process`;

    return new URL(processorPath, normalizeEndpoint(endpoint)).toString();
  }

  private fieldMask() {
    const fieldMask = process.env.GOOGLE_DOCUMENT_AI_FIELD_MASK?.trim();

    return fieldMask ? { fieldMask } : {};
  }

  private processOptions(input: OcrExtractionInput) {
    const pageStart = input.options?.pageStart;
    const pageCount = input.options?.pageCount;

    if (!pageStart || !pageCount) {
      return {};
    }

    return {
      processOptions: {
        individualPageSelector: {
          pages: Array.from(
            { length: pageCount },
            (_item, index) => pageStart + index,
          ),
        },
      },
    };
  }

  private parseJsonResponse(bodyText: string): GoogleProcessResponse {
    if (!bodyText) {
      return {};
    }

    try {
      const parsed = JSON.parse(bodyText);

      return isPlainObject(parsed) ? parsed : {};
    } catch {
      throw new Error("Google Document AI returned invalid JSON.");
    }
  }

  private rowsFromTables(
    fields: TemplateField[],
    document: GoogleDocument,
    input: OcrExtractionInput,
  ) {
    const documentText = stringValue(document.text) ?? "";
    const rows: OcrExtractedRow[] = [];

    for (const page of arrayOfObjects<GooglePage>(document.pages)) {
      const pageNumber = positiveInteger(page.pageNumber);

      for (const table of arrayOfObjects<GoogleTable>(page.tables)) {
        const headerCells = this.firstTableRowCells(table.headerRows);
        const mappings = this.headerMappings(fields, headerCells, documentText);
        const bodyRows = arrayOfObjects<GoogleTableRow>(table.bodyRows);

        for (const bodyRow of bodyRows) {
          rows.push(
            this.rowFromTableCells(
              fields,
              arrayOfObjects<GoogleTableCell>(bodyRow.cells),
              mappings,
              documentText,
              rows.length,
              pageNumber ?? input.options?.pageStart,
            ),
          );
        }
      }
    }

    return rows
      .filter((row) =>
        Object.values(row.data).some(
          (value) => value !== "" && value !== null && value !== false,
        ),
      )
      .slice(0, input.options?.rowCount ?? 25);
  }

  private rowsFromFormData(
    fields: TemplateField[],
    document: GoogleDocument,
    input: OcrExtractionInput,
  ) {
    const documentText = stringValue(document.text) ?? "";
    const pairs = this.formPairs(document, documentText);

    if (pairs.length === 0) {
      return this.rowsFromTables(fields, document, input);
    }

    const usedPairs = new Set<KeyValuePair>();
    const values = fields.map((field) => {
      const match = this.bestKeyValuePair(field, pairs, usedPairs);

      if (match) {
        usedPairs.add(match.pair);
      }

      const normalized = normalizeOcrCellValue(field, match?.pair.value ?? "");

      return {
        field,
        rawValue: normalized.rawValue,
        normalizedValue: normalized.normalizedValue,
        confidence: this.cellConfidence(
          match?.confidence ?? 0.62,
          normalized.confidence,
          normalized.issues.length,
        ),
        issues: normalized.issues,
        boundingBox: match?.pair.boundingBox ?? null,
      };
    });
    const data = this.dataFromValues(values);

    return [
      {
        rowNumber: 1,
        sourcePage:
          pairs.find((pair) => typeof pair.pageNumber === "number")
            ?.pageNumber ?? input.options?.pageStart,
        data,
        values,
        confidenceScore: this.averageConfidence(values),
      },
    ].filter((row) =>
      Object.values(row.data).some(
        (value) => value !== "" && value !== null && value !== false,
      ),
    );
  }

  private formPairs(document: GoogleDocument, documentText: string) {
    const pairs: KeyValuePair[] = [];

    for (const page of arrayOfObjects<GooglePage>(document.pages)) {
      const pageNumber = positiveInteger(page.pageNumber);

      for (const formField of arrayOfObjects<GoogleFormField>(page.formFields)) {
        const keyLayout = toLayout(formField.fieldName?.layout);
        const valueLayout = toLayout(formField.fieldValue?.layout);
        const key = cleanOcrText(this.textFromLayout(documentText, keyLayout));
        const value = cleanOcrText(
          this.textFromLayout(documentText, valueLayout),
        );

        if (!key) {
          continue;
        }

        pairs.push({
          key,
          value,
          confidence: confidenceNumber(valueLayout?.confidence) ?? 0.74,
          boundingBox: toBoundingBox(valueLayout, pageNumber),
          pageNumber,
        });
      }
    }

    for (const entity of arrayOfObjects<GoogleEntity>(document.entities)) {
      const key = cleanOcrText(stringValue(entity.type) ?? "");
      const value = cleanOcrText(stringValue(entity.mentionText) ?? "");

      if (!key) {
        continue;
      }

      pairs.push({
        key,
        value,
        confidence: confidenceNumber(entity.confidence) ?? 0.74,
        boundingBox: toEntityBoundingBox(entity),
        pageNumber: entityPageNumber(entity),
      });
    }

    return pairs;
  }

  private bestKeyValuePair(
    field: TemplateField,
    pairs: KeyValuePair[],
    usedPairs: Set<KeyValuePair>,
  ) {
    return pairs
      .filter((pair) => !usedPairs.has(pair))
      .map((pair) => ({
        pair,
        score: this.fieldMatchScore(pair.key, field),
        confidence: pair.confidence,
      }))
      .filter(
        (candidate): candidate is {
          pair: KeyValuePair;
          score: number;
          confidence: number;
        } => candidate.score !== null && candidate.score <= MAX_HEADER_MATCH_SCORE,
      )
      .sort((left, right) => left.score - right.score)[0];
  }

  private firstTableRowCells(rows: unknown) {
    return arrayOfObjects<GoogleTableCell>(
      arrayOfObjects<GoogleTableRow>(rows)[0]?.cells,
    );
  }

  private headerMappings(
    fields: TemplateField[],
    headerCells: GoogleTableCell[],
    documentText: string,
  ) {
    const mappedColumns = new Set<number>();

    return fields.map((field, fieldIndex) => {
      const match = headerCells
        .map((cell, columnIndex) => ({
          cell,
          columnIndex,
          headerText: this.textFromLayout(documentText, toLayout(cell.layout)),
          score: this.fieldMatchScore(
            this.textFromLayout(documentText, toLayout(cell.layout)),
            field,
          ),
        }))
        .filter(
          (candidate): candidate is {
            cell: GoogleTableCell;
            columnIndex: number;
            headerText: string;
            score: number;
          } =>
            !mappedColumns.has(candidate.columnIndex) &&
            candidate.score !== null &&
            candidate.score <= MAX_HEADER_MATCH_SCORE,
        )
        .sort(
          (left, right) =>
            left.score - right.score || left.columnIndex - right.columnIndex,
        )[0];

      if (match) {
        mappedColumns.add(match.columnIndex);

        return {
          field,
          columnIndex: match.columnIndex,
          headerText: cleanOcrText(match.headerText),
          confidence: this.headerMatchConfidence(match.score),
        };
      }

      const fallbackColumnIndex = this.nextFallbackColumnIndex(
        fieldIndex,
        mappedColumns,
      );

      mappedColumns.add(fallbackColumnIndex);

      return {
        field,
        columnIndex: fallbackColumnIndex,
        headerText: null,
        confidence: 0.58,
      };
    });
  }

  private nextFallbackColumnIndex(fieldIndex: number, mappedColumns: Set<number>) {
    if (!mappedColumns.has(fieldIndex)) {
      return fieldIndex;
    }

    let candidate = 0;

    while (mappedColumns.has(candidate)) {
      candidate += 1;
    }

    return candidate;
  }

  private rowFromTableCells(
    fields: TemplateField[],
    rowCells: GoogleTableCell[],
    mappings: HeaderMapping[],
    documentText: string,
    rowIndex: number,
    pageNumber: number | undefined,
  ) {
    const values = fields.map((field) => {
      const mapping = mappings.find((item) => item.field.id === field.id);
      const cell = mapping ? rowCells[mapping.columnIndex] : undefined;
      const layout = toLayout(cell?.layout);
      const rawText = cleanOcrText(this.textFromLayout(documentText, layout));
      const normalized = normalizeOcrCellValue(field, rawText);

      return {
        field,
        rawValue: normalized.rawValue,
        normalizedValue: normalized.normalizedValue,
        confidence: this.cellConfidence(
          mapping?.confidence ?? 0.58,
          confidenceNumber(layout?.confidence) ?? normalized.confidence,
          normalized.issues.length,
        ),
        issues: normalized.issues,
        boundingBox: toBoundingBox(layout, pageNumber),
      };
    });
    const data = this.dataFromValues(values);

    return {
      rowNumber: rowIndex + 1,
      sourcePage: pageNumber,
      data,
      values,
      confidenceScore: this.averageConfidence(values),
    };
  }

  private suggestedFieldsFromTables(
    fields: TemplateField[],
    document: GoogleDocument,
  ) {
    const documentText = stringValue(document.text) ?? "";
    const suggestions: OcrSuggestedField[] = [];
    const takenKeys = new Set(fields.map((field) => field.key));

    for (const page of arrayOfObjects<GooglePage>(document.pages)) {
      for (const table of arrayOfObjects<GoogleTable>(page.tables)) {
        for (const source of this.unmappedHeaderSources(fields, table, documentText)) {
          const key = this.dedupeFieldKey(
            this.normalizeFieldKey(source.headerText),
            takenKeys,
          );

          takenKeys.add(key);
          suggestions.push({
            label: this.toTitleLabel(source.headerText),
            key,
            type: this.inferFieldType(source.sampleValues),
            aliases: [],
            options:
              this.inferFieldType(source.sampleValues) === "select"
                ? source.sampleValues
                : [],
            sampleValues: source.sampleValues,
            confidence: source.confidence,
          });
        }
      }
    }

    return suggestions;
  }

  private unmappedHeaderSources(
    fields: TemplateField[],
    table: GoogleTable,
    documentText: string,
  ): TableSuggestionSource[] {
    const headerCells = this.firstTableRowCells(table.headerRows);
    const mappings = this.headerMappings(fields, headerCells, documentText);
    const mappedColumns = new Set(mappings.map((mapping) => mapping.columnIndex));
    const bodyRows = arrayOfObjects<GoogleTableRow>(table.bodyRows);

    return headerCells
      .map((cell, columnIndex) => ({
        columnIndex,
        headerText: cleanOcrText(this.textFromLayout(documentText, toLayout(cell.layout))),
      }))
      .filter(
        (candidate) =>
          !mappedColumns.has(candidate.columnIndex) &&
          candidate.headerText.length > 0,
      )
      .map((candidate) => {
        const sampleValues = bodyRows
          .map((row) => arrayOfObjects<GoogleTableCell>(row.cells)[candidate.columnIndex])
          .map((cell) =>
            cleanOcrText(this.textFromLayout(documentText, toLayout(cell?.layout))),
          )
          .filter(Boolean);

        return {
          headerText: candidate.headerText,
          sampleValues: uniqueStrings(sampleValues).slice(0, 8),
          confidence: 0.72,
        };
      });
  }

  private textFromLayout(documentText: string, layout: GoogleLayout | null) {
    const textAnchor = toTextAnchor(layout?.textAnchor);
    const content = stringValue(textAnchor?.content);

    if (content) {
      return content;
    }

    const segments = arrayOfObjects(textAnchor?.textSegments);

    return segments
      .map((segment) =>
        textSlice(documentText, integerString(segment.startIndex) ?? 0, integerString(segment.endIndex)),
      )
      .join("");
  }

  private fieldMatchScore(value: string | null, field: TemplateField) {
    const normalizedValues = Array.from(
      new Set([
        normalizeOcrTerm(value ?? ""),
        normalizeNoisyOcrTerm(value ?? ""),
      ]),
    ).filter(Boolean);

    if (normalizedValues.length === 0) {
      return null;
    }

    let bestScore: number | null = null;

    for (const term of getOcrFieldTerms(field)) {
      const normalizedTerms = Array.from(
        new Set([normalizeOcrTerm(term), normalizeNoisyOcrTerm(term)]),
      ).filter(Boolean);

      for (const normalizedValue of normalizedValues) {
        for (const normalizedTerm of normalizedTerms) {
          const distance = levenshteinDistance(normalizedValue, normalizedTerm);
          const longestLength = Math.max(
            normalizedValue.length,
            normalizedTerm.length,
          );
          const shortestLength = Math.min(
            normalizedValue.length,
            normalizedTerm.length,
          );
          const maxDistance = Math.max(2, Math.floor(longestLength * 0.22));
          let score: number | null = null;

          if (normalizedValue === normalizedTerm) {
            score = 0;
          } else if (
            shortestLength >= 3 &&
            (normalizedValue.includes(normalizedTerm) ||
              normalizedTerm.includes(normalizedValue))
          ) {
            score = Math.abs(normalizedValue.length - normalizedTerm.length) + 2;
          } else if (distance <= maxDistance) {
            score = distance + 10;
          }

          if (score !== null && (bestScore === null || score < bestScore)) {
            bestScore = score;
          }
        }
      }
    }

    return bestScore;
  }

  private headerMatchConfidence(score: number) {
    if (score === 0) {
      return 0.96;
    }

    if (score <= 4) {
      return 0.9;
    }

    if (score <= 8) {
      return 0.82;
    }

    return 0.72;
  }

  private cellConfidence(
    structureConfidence: number,
    valueConfidence: number,
    issueCount: number,
  ) {
    const confidence = valueConfidence * 0.72 + structureConfidence * 0.28;
    const cappedConfidence =
      issueCount > 0 ? Math.min(confidence, 0.68) : confidence;

    return Number(clampConfidence(cappedConfidence).toFixed(2));
  }

  private dataFromValues(values: OcrExtractedCell[]) {
    return Object.fromEntries(
      values.map((value) => [value.field.key, value.normalizedValue]),
    ) as Record<string, OcrCellValue>;
  }

  private averageConfidence(values: OcrExtractedCell[]) {
    if (values.length === 0) {
      return 0;
    }

    return Number(
      (
        values.reduce((sum, value) => sum + value.confidence, 0) / values.length
      ).toFixed(2),
    );
  }

  private inferFieldType(sampleValues: string[]): OcrSuggestedFieldType {
    const uniqueValues = new Set(sampleValues.map((value) => value.toLowerCase()));

    if (sampleValues.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
      return "number";
    }

    if (sampleValues.every((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      return "email";
    }

    if (uniqueValues.size > 1 && uniqueValues.size <= 8) {
      return "select";
    }

    return "text";
  }

  private toTitleLabel(value: string) {
    return cleanOcrText(value)
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private normalizeFieldKey(label: string) {
    const key = label
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return key || "field";
  }

  private dedupeFieldKey(baseKey: string, takenKeys: Set<string>) {
    let candidate = baseKey;
    let suffix = 2;

    while (takenKeys.has(candidate)) {
      candidate = `${baseKey}_${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private isConfigured() {
    return (
      Boolean(process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID?.trim()) &&
      Boolean(process.env.GOOGLE_DOCUMENT_AI_LOCATION?.trim()) &&
      Boolean(process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID?.trim()) &&
      Boolean(process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN?.trim())
    );
  }

  private toRawOcrJson(
    input: OcrExtractionInput,
    response: GoogleProcessResponse,
  ) {
    return {
      provider: this.name,
      processor: {
        projectId: process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID?.trim() ?? null,
        location: process.env.GOOGLE_DOCUMENT_AI_LOCATION?.trim() ?? null,
        processorId: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID?.trim() ?? null,
        processorVersion:
          process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION?.trim() ?? null,
      },
      document: {
        id: input.document.id ?? null,
        fileName: input.document.fileName,
        fileType: input.document.fileType,
        fileUrl: input.document.fileUrl,
      },
      options: input.options ?? {},
      response: toJsonValue(response),
    } satisfies Prisma.InputJsonObject;
  }

  private errorDetail(bodyText: string) {
    return bodyText ? ` ${bodyText.slice(0, 300)}` : "";
  }
}

function requiredEnv(key: string, label: string) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`${key} is required when ${label} is selected.`);
  }

  return value;
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayOfObjects<T extends Record<string, unknown>>(value: unknown): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPlainObject) as T[];
}

function toLayout(value: unknown): GoogleLayout | null {
  return isPlainObject(value) ? (value as GoogleLayout) : null;
}

function toTextAnchor(value: unknown) {
  return isPlainObject(value) ? value : null;
}

function integerString(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return null;
}

function positiveInteger(value: unknown) {
  const integer = integerString(value);

  return integer !== null && integer > 0 ? integer : undefined;
}

function confidenceNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(clampConfidence(value).toFixed(2))
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function textSlice(value: string, start: number, end: number | null) {
  const bytes = Buffer.from(value, "utf8");
  const safeStart = Math.max(0, Math.min(start, bytes.length));
  const safeEnd = end === null ? bytes.length : Math.max(safeStart, Math.min(end, bytes.length));

  return bytes.subarray(safeStart, safeEnd).toString("utf8");
}

function toBoundingBox(
  layout: GoogleLayout | null,
  pageNumber: number | undefined,
) {
  const boundingPoly = isPlainObject(layout?.boundingPoly)
    ? layout?.boundingPoly
    : null;

  if (!boundingPoly) {
    return null;
  }

  const vertices = Array.isArray(boundingPoly.normalizedVertices)
    ? boundingPoly.normalizedVertices
    : Array.isArray(boundingPoly.vertices)
      ? boundingPoly.vertices
      : [];
  const points = vertices
    .filter(isPlainObject)
    .map((point) => ({
      x: typeof point.x === "number" ? point.x : null,
      y: typeof point.y === "number" ? point.y : null,
    }))
    .filter((point): point is { x: number; y: number } => {
      return point.x !== null && point.y !== null;
    });

  if (points.length === 0) {
    return {
      pageNumber: pageNumber ?? null,
      polygon: toJsonValue(vertices),
    } satisfies Prisma.InputJsonObject;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  return {
    pageNumber: pageNumber ?? null,
    x: Number(left.toFixed(4)),
    y: Number(top.toFixed(4)),
    width: Number((right - left).toFixed(4)),
    height: Number((bottom - top).toFixed(4)),
    normalized: Array.isArray(boundingPoly.normalizedVertices),
    polygon: toJsonValue(vertices),
  } satisfies Prisma.InputJsonObject;
}

function toEntityBoundingBox(entity: GoogleEntity) {
  const pageRefs = arrayOfObjects(
    isPlainObject(entity.pageAnchor) ? entity.pageAnchor.pageRefs : undefined,
  );
  const pageRef = pageRefs[0];

  if (!pageRef) {
    return null;
  }

  return toBoundingBox(
    {
      boundingPoly: pageRef.boundingPoly,
    },
    entityPageNumber(entity),
  );
}

function entityPageNumber(entity: GoogleEntity) {
  const pageRefs = arrayOfObjects(
    isPlainObject(entity.pageAnchor) ? entity.pageAnchor.pageRefs : undefined,
  );
  const page = integerString(pageRefs[0]?.page);

  return page === null ? undefined : page + 1;
}

function toJsonValue(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

function levenshteinDistance(left: string, right: string) {
  const distances = Array.from({ length: left.length + 1 }, (_item, index) => [
    index,
  ]);

  for (let index = 1; index <= right.length; index += 1) {
    distances[0][index] = index;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      distances[row][column] =
        left[row - 1] === right[column - 1]
          ? distances[row - 1][column - 1]
          : Math.min(
              distances[row - 1][column - 1],
              distances[row][column - 1],
              distances[row - 1][column],
            ) + 1;
    }
  }

  return distances[left.length][right.length];
}
