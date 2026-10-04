import { Injectable } from "@nestjs/common";
import type { Prisma, TemplateField } from "@prisma/client";
import { createHash, createHmac } from "node:crypto";
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

const AWS_ALGORITHM = "AWS4-HMAC-SHA256";
const AWS_SERVICE = "textract";
const MAX_HEADER_MATCH_SCORE = 14;

type AwsTextractResponse = {
  AnalyzeDocumentModelVersion?: unknown;
  Blocks?: unknown;
  DocumentMetadata?: unknown;
};

type AwsTextractBlock = {
  BlockType?: unknown;
  ColumnIndex?: unknown;
  Confidence?: unknown;
  EntityTypes?: unknown;
  Geometry?: unknown;
  Id?: unknown;
  Page?: unknown;
  Relationships?: unknown;
  RowIndex?: unknown;
  SelectionStatus?: unknown;
  Text?: unknown;
};

type AwsTextractRelationship = {
  Type?: unknown;
  Ids?: unknown;
};

type HeaderMapping = {
  field: TemplateField;
  columnIndex: number;
  headerText: string | null;
  confidence: number;
};

type KeyValuePair = {
  key: string;
  value: string;
  confidence: number;
  boundingBox: Prisma.InputJsonObject | null;
  pageNumber?: number;
};

type TableSuggestionSource = {
  headerText: string;
  sampleValues: string[];
  confidence: number;
};

@Injectable()
export class AwsTextractOcrProvider implements OcrProvider {
  readonly name = "aws-textract";

  canReadPdfDirectly(input: OcrExtractionInput) {
    return (
      input.document.fileType === "application/pdf" &&
      Boolean(input.document.filePath) &&
      this.isConfigured()
    );
  }

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    if (!input.document.filePath) {
      throw new Error("AWS Textract OCR requires a local document file.");
    }

    const response = await this.analyzeDocument(input);
    const blocks = arrayOfObjects<AwsTextractBlock>(response.Blocks);
    const blockMap = this.blockMap(blocks);
    const rows =
      input.options?.layout === "form"
        ? this.rowsFromForms(input.template.fields, blocks, blockMap, input)
        : this.rowsFromTables(input.template.fields, blocks, blockMap, input);

    return {
      providerName: this.name,
      rawOcrJson: this.toRawOcrJson(input, response),
      rows,
      suggestedFields: this.suggestedFieldsFromTables(
        input.template.fields,
        blocks,
        blockMap,
      ),
    };
  }

  private async analyzeDocument(input: OcrExtractionInput) {
    const region = this.region();
    const endpoint = this.endpoint(region);
    const fileContent = await readFile(input.document.filePath as string);
    const body = JSON.stringify({
      Document: {
        Bytes: fileContent.toString("base64"),
      },
      FeatureTypes: this.featureTypes(input),
    });
    const headers = this.signedHeaders({
      body,
      endpoint,
      operation: "AnalyzeDocument",
      region,
    });
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers,
      body,
    });
    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      throw new Error(
        `AWS Textract AnalyzeDocument request failed with status ${
          response.status
        }.${this.errorDetail(bodyText)}`,
      );
    }

    return this.parseJsonResponse(bodyText);
  }

  private signedHeaders({
    body,
    endpoint,
    operation,
    region,
  }: {
    body: string;
    endpoint: URL;
    operation: "AnalyzeDocument";
    region: string;
  }) {
    const accessKeyId = requiredEnv(
      ["AWS_TEXTRACT_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"],
      "AWS Textract OCR",
    );
    const secretAccessKey = requiredEnv(
      ["AWS_TEXTRACT_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"],
      "AWS Textract OCR",
    );
    const sessionToken =
      process.env.AWS_TEXTRACT_SESSION_TOKEN?.trim() ??
      process.env.AWS_SESSION_TOKEN?.trim();
    const amzDate = this.amzDate(new Date());
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = {
      "content-type": "application/x-amz-json-1.1",
      host: endpoint.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "x-amz-target": `Textract.${operation}`,
    };

    if (sessionToken) {
      headers["x-amz-security-token"] = sessionToken;
    }

    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((key) => `${key}:${headers[key].replace(/\s+/g, " ").trim()}\n`)
      .join("");
    const canonicalRequest = [
      "POST",
      this.canonicalUri(endpoint),
      this.canonicalQueryString(endpoint),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${region}/${AWS_SERVICE}/aws4_request`;
    const stringToSign = [
      AWS_ALGORITHM,
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = hmacHex(
      this.signingKey(secretAccessKey, dateStamp, region),
      stringToSign,
    );

    return {
      ...headers,
      authorization: `${AWS_ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  private signingKey(secretAccessKey: string, dateStamp: string, region: string) {
    const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
    const dateRegionKey = hmacBuffer(dateKey, region);
    const dateRegionServiceKey = hmacBuffer(dateRegionKey, AWS_SERVICE);

    return hmacBuffer(dateRegionServiceKey, "aws4_request");
  }

  private canonicalUri(endpoint: URL) {
    return endpoint.pathname || "/";
  }

  private canonicalQueryString(endpoint: URL) {
    return Array.from(endpoint.searchParams.entries())
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey === rightKey
          ? leftValue.localeCompare(rightValue)
          : leftKey.localeCompare(rightKey),
      )
      .map(
        ([key, value]) =>
          `${encodeRfc3986(key)}=${encodeRfc3986(value)}`,
      )
      .join("&");
  }

  private featureTypes(input: OcrExtractionInput) {
    const configured = (process.env.AWS_TEXTRACT_FEATURE_TYPES ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    if (configured.length > 0) {
      return uniqueStrings(configured);
    }

    return input.options?.layout === "form"
      ? ["FORMS", "SIGNATURES"]
      : ["TABLES", "FORMS"];
  }

  private parseJsonResponse(bodyText: string): AwsTextractResponse {
    if (!bodyText) {
      return {};
    }

    try {
      const parsed = JSON.parse(bodyText);

      return isPlainObject(parsed) ? parsed : {};
    } catch {
      throw new Error("AWS Textract returned invalid JSON.");
    }
  }

  private rowsFromTables(
    fields: TemplateField[],
    blocks: AwsTextractBlock[],
    blockMap: Map<string, AwsTextractBlock>,
    input: OcrExtractionInput,
  ) {
    const rows: OcrExtractedRow[] = [];

    for (const table of blocks.filter((block) => block.BlockType === "TABLE")) {
      const cells = this.relatedBlocks(table, blockMap, "CHILD").filter(
        (block) => block.BlockType === "CELL",
      );
      const headerRowIndex = this.headerRowIndex(cells);
      const mappings = this.headerMappings(fields, cells, headerRowIndex, blockMap);
      const dataRowIndexes = uniqueNumbers(
        cells
          .map((cell) => integerValue(cell.RowIndex))
          .filter((rowIndex): rowIndex is number => rowIndex !== null)
          .filter((rowIndex) => rowIndex > headerRowIndex),
      );

      for (const rowIndex of dataRowIndexes) {
        rows.push(
          this.rowFromTableCells(
            fields,
            cells.filter((cell) => integerValue(cell.RowIndex) === rowIndex),
            mappings,
            blockMap,
            rows.length,
            input,
          ),
        );
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

  private rowsFromForms(
    fields: TemplateField[],
    blocks: AwsTextractBlock[],
    blockMap: Map<string, AwsTextractBlock>,
    input: OcrExtractionInput,
  ) {
    const pairs = this.formPairs(blocks, blockMap);

    if (pairs.length === 0) {
      return this.rowsFromTables(fields, blocks, blockMap, input);
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

  private formPairs(
    blocks: AwsTextractBlock[],
    blockMap: Map<string, AwsTextractBlock>,
  ) {
    return blocks
      .filter(
        (block) =>
          block.BlockType === "KEY_VALUE_SET" &&
          stringArray(block.EntityTypes).includes("KEY"),
      )
      .flatMap((keyBlock) => {
        const valueBlock = this.relatedBlocks(keyBlock, blockMap, "VALUE").find(
          (block) =>
            block.BlockType === "KEY_VALUE_SET" &&
            stringArray(block.EntityTypes).includes("VALUE"),
        );
        const key = this.blockText(keyBlock, blockMap);
        const value = valueBlock ? this.blockText(valueBlock, blockMap) : "";

        if (!key) {
          return [];
        }

        return [
          {
            key,
            value,
            confidence: confidenceNumber(valueBlock?.Confidence) ?? 0.74,
            boundingBox: toBoundingBox(valueBlock ?? keyBlock),
            pageNumber:
              positiveInteger(valueBlock?.Page) ??
              positiveInteger(keyBlock.Page),
          },
        ];
      });
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

  private headerRowIndex(cells: AwsTextractBlock[]) {
    const headerIndexes = cells
      .filter((cell) => stringArray(cell.EntityTypes).includes("COLUMN_HEADER"))
      .map((cell) => integerValue(cell.RowIndex))
      .filter((rowIndex): rowIndex is number => rowIndex !== null);

    if (headerIndexes.length > 0) {
      return Math.min(...headerIndexes);
    }

    const rowIndexes = cells
      .map((cell) => integerValue(cell.RowIndex))
      .filter((rowIndex): rowIndex is number => rowIndex !== null);

    return rowIndexes.length > 0 ? Math.min(...rowIndexes) : 1;
  }

  private headerMappings(
    fields: TemplateField[],
    cells: AwsTextractBlock[],
    headerRowIndex: number,
    blockMap: Map<string, AwsTextractBlock>,
  ) {
    const headerCells = cells.filter(
      (cell) => integerValue(cell.RowIndex) === headerRowIndex,
    );
    const mappedColumns = new Set<number>();

    return fields.map((field, fieldIndex) => {
      const match = headerCells
        .map((cell) => ({
          cell,
          columnIndex: integerValue(cell.ColumnIndex),
          headerText: this.blockText(cell, blockMap),
          score: this.fieldMatchScore(this.blockText(cell, blockMap), field),
        }))
        .filter(
          (candidate): candidate is {
            cell: AwsTextractBlock;
            columnIndex: number;
            headerText: string;
            score: number;
          } =>
            candidate.columnIndex !== null &&
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
          headerText: match.headerText,
          confidence: this.headerMatchConfidence(match.score),
        };
      }

      const fallbackColumnIndex = this.nextFallbackColumnIndex(
        fieldIndex + 1,
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

  private nextFallbackColumnIndex(
    fieldColumnIndex: number,
    mappedColumns: Set<number>,
  ) {
    if (!mappedColumns.has(fieldColumnIndex)) {
      return fieldColumnIndex;
    }

    let candidate = 1;

    while (mappedColumns.has(candidate)) {
      candidate += 1;
    }

    return candidate;
  }

  private rowFromTableCells(
    fields: TemplateField[],
    rowCells: AwsTextractBlock[],
    mappings: HeaderMapping[],
    blockMap: Map<string, AwsTextractBlock>,
    rowIndex: number,
    input: OcrExtractionInput,
  ) {
    const values = fields.map((field) => {
      const mapping = mappings.find((item) => item.field.id === field.id);
      const cell = mapping
        ? rowCells.find(
            (candidate) =>
              integerValue(candidate.ColumnIndex) === mapping.columnIndex,
          )
        : undefined;
      const rawText = cell ? this.blockText(cell, blockMap) : "";
      const normalized = normalizeOcrCellValue(field, rawText);

      return {
        field,
        rawValue: normalized.rawValue,
        normalizedValue: normalized.normalizedValue,
        confidence: this.cellConfidence(
          mapping?.confidence ?? 0.58,
          confidenceNumber(cell?.Confidence) ?? normalized.confidence,
          normalized.issues.length,
        ),
        issues: normalized.issues,
        boundingBox: toBoundingBox(cell),
      };
    });
    const data = this.dataFromValues(values);

    return {
      rowNumber: rowIndex + 1,
      sourcePage:
        rowCells
          .map((cell) => positiveInteger(cell.Page))
          .find((page) => typeof page === "number") ??
        input.options?.pageStart,
      data,
      values,
      confidenceScore: this.averageConfidence(values),
    };
  }

  private suggestedFieldsFromTables(
    fields: TemplateField[],
    blocks: AwsTextractBlock[],
    blockMap: Map<string, AwsTextractBlock>,
  ) {
    const suggestions: OcrSuggestedField[] = [];
    const takenKeys = new Set(fields.map((field) => field.key));

    for (const table of blocks.filter((block) => block.BlockType === "TABLE")) {
      for (const source of this.unmappedHeaderSources(
        fields,
        table,
        blockMap,
      )) {
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

    return suggestions;
  }

  private unmappedHeaderSources(
    fields: TemplateField[],
    table: AwsTextractBlock,
    blockMap: Map<string, AwsTextractBlock>,
  ): TableSuggestionSource[] {
    const cells = this.relatedBlocks(table, blockMap, "CHILD").filter(
      (block) => block.BlockType === "CELL",
    );
    const headerRowIndex = this.headerRowIndex(cells);
    const mappings = this.headerMappings(fields, cells, headerRowIndex, blockMap);
    const mappedColumns = new Set(mappings.map((mapping) => mapping.columnIndex));
    const dataRowIndexes = uniqueNumbers(
      cells
        .map((cell) => integerValue(cell.RowIndex))
        .filter((rowIndex): rowIndex is number => rowIndex !== null)
        .filter((rowIndex) => rowIndex > headerRowIndex),
    );

    return cells
      .filter((cell) => integerValue(cell.RowIndex) === headerRowIndex)
      .map((cell) => ({
        cell,
        columnIndex: integerValue(cell.ColumnIndex),
        headerText: this.blockText(cell, blockMap),
      }))
      .filter(
        (candidate): candidate is {
          cell: AwsTextractBlock;
          columnIndex: number;
          headerText: string;
        } =>
          candidate.columnIndex !== null &&
          !mappedColumns.has(candidate.columnIndex) &&
          candidate.headerText.length > 0,
      )
      .map((candidate) => {
        const sampleValues = dataRowIndexes
          .map(
            (rowIndex) =>
              cells.find(
                (cell) =>
                  integerValue(cell.RowIndex) === rowIndex &&
                  integerValue(cell.ColumnIndex) === candidate.columnIndex,
              ) ?? null,
          )
          .map((cell) => (cell ? this.blockText(cell, blockMap) : ""))
          .filter(Boolean);

        return {
          headerText: candidate.headerText,
          sampleValues: uniqueStrings(sampleValues).slice(0, 8),
          confidence: 0.72,
        };
      });
  }

  private blockMap(blocks: AwsTextractBlock[]) {
    const result = new Map<string, AwsTextractBlock>();

    for (const block of blocks) {
      const id = stringValue(block.Id);

      if (id) {
        result.set(id, block);
      }
    }

    return result;
  }

  private relatedBlocks(
    block: AwsTextractBlock,
    blockMap: Map<string, AwsTextractBlock>,
    relationshipType: string,
  ) {
    return arrayOfObjects<AwsTextractRelationship>(block.Relationships)
      .filter((relationship) => relationship.Type === relationshipType)
      .flatMap((relationship) => stringArray(relationship.Ids))
      .map((id) => blockMap.get(id))
      .filter((item): item is AwsTextractBlock => Boolean(item));
  }

  private blockText(
    block: AwsTextractBlock,
    blockMap: Map<string, AwsTextractBlock>,
  ): string {
    const directText = stringValue(block.Text);

    if (directText) {
      return cleanOcrText(directText);
    }

    const parts = this.relatedBlocks(block, blockMap, "CHILD").flatMap(
      (child) => {
        if (child.BlockType === "WORD") {
          return stringValue(child.Text) ?? "";
        }

        if (child.BlockType === "SELECTION_ELEMENT") {
          return child.SelectionStatus === "SELECTED" ? "X" : "";
        }

        if (child.BlockType === "SIGNATURE") {
          return "signed";
        }

        return "";
      },
    );

    return cleanOcrText(parts.filter(Boolean).join(" "));
  }

  private fieldMatchScore(value: string, field: TemplateField) {
    const normalizedValues = Array.from(
      new Set([normalizeOcrTerm(value), normalizeNoisyOcrTerm(value)]),
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

  private region() {
    return requiredEnv(
      ["AWS_TEXTRACT_REGION", "AWS_REGION", "AWS_DEFAULT_REGION"],
      "AWS Textract OCR",
    );
  }

  private endpoint(region: string) {
    return new URL(
      process.env.AWS_TEXTRACT_ENDPOINT?.trim() ??
        `https://textract.${region}.amazonaws.com/`,
    );
  }

  private isConfigured() {
    return (
      Boolean(
        process.env.AWS_TEXTRACT_ACCESS_KEY_ID?.trim() ??
          process.env.AWS_ACCESS_KEY_ID?.trim(),
      ) &&
      Boolean(
        process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY?.trim() ??
          process.env.AWS_SECRET_ACCESS_KEY?.trim(),
      ) &&
      Boolean(
        process.env.AWS_TEXTRACT_REGION?.trim() ??
          process.env.AWS_REGION?.trim() ??
          process.env.AWS_DEFAULT_REGION?.trim(),
      )
    );
  }

  private toRawOcrJson(
    input: OcrExtractionInput,
    response: AwsTextractResponse,
  ) {
    return {
      provider: this.name,
      region:
        process.env.AWS_TEXTRACT_REGION?.trim() ??
        process.env.AWS_REGION?.trim() ??
        process.env.AWS_DEFAULT_REGION?.trim() ??
        null,
      endpoint: process.env.AWS_TEXTRACT_ENDPOINT?.trim() ?? null,
      featureTypes: this.featureTypes(input),
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

  private amzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  }

  private errorDetail(bodyText: string) {
    return bodyText ? ` ${bodyText.slice(0, 300)}` : "";
  }
}

function requiredEnv(keys: string[], label: string) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  throw new Error(`${keys.join(" or ")} is required when ${label} is selected.`);
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

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function positiveInteger(value: unknown) {
  const integer = integerValue(value);

  return integer !== null && integer > 0 ? integer : undefined;
}

function confidenceNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(clampConfidence(value / 100).toFixed(2))
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacBuffer(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toBoundingBox(block: AwsTextractBlock | undefined) {
  if (!isPlainObject(block?.Geometry)) {
    return null;
  }

  const boundingBox = isPlainObject(block.Geometry.BoundingBox)
    ? block.Geometry.BoundingBox
    : null;
  const left = typeof boundingBox?.Left === "number" ? boundingBox.Left : null;
  const top = typeof boundingBox?.Top === "number" ? boundingBox.Top : null;
  const width =
    typeof boundingBox?.Width === "number" ? boundingBox.Width : null;
  const height =
    typeof boundingBox?.Height === "number" ? boundingBox.Height : null;

  if (left === null || top === null || width === null || height === null) {
    return {
      pageNumber: block.Page ?? null,
      polygon: toJsonValue(block.Geometry.Polygon),
    } satisfies Prisma.InputJsonObject;
  }

  return {
    pageNumber: block.Page ?? null,
    x: Number(left.toFixed(4)),
    y: Number(top.toFixed(4)),
    width: Number(width.toFixed(4)),
    height: Number(height.toFixed(4)),
    normalized: true,
    polygon: toJsonValue(block.Geometry.Polygon),
  } satisfies Prisma.InputJsonObject;
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
