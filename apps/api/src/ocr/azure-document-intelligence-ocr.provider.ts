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
import { detectOcrTableHeaderRowIndex } from "./table-header";

const DEFAULT_API_VERSION = "2024-11-30";
const DEFAULT_MODEL_ID = "prebuilt-layout";
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_HEADER_MATCH_SCORE = 14;

type AzureAnalyzeResponse = {
  status?: unknown;
  error?: unknown;
  analyzeResult?: AzureAnalyzeResult;
};

type AzureAnalyzeResult = {
  apiVersion?: unknown;
  modelId?: unknown;
  content?: unknown;
  pages?: unknown;
  tables?: unknown;
  keyValuePairs?: unknown;
  documents?: unknown;
};

type AzureTable = {
  rowCount?: unknown;
  columnCount?: unknown;
  cells?: unknown;
  boundingRegions?: unknown;
};

type AzureTableCell = {
  kind?: unknown;
  rowIndex?: unknown;
  columnIndex?: unknown;
  content?: unknown;
  confidence?: unknown;
  boundingRegions?: unknown;
};

type AzurePage = {
  pageNumber?: unknown;
  words?: unknown;
};

type AzurePageWord = {
  content?: unknown;
  polygon?: unknown;
};

type PositionedAzureWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type AzureKeyValuePair = {
  key?: unknown;
  value?: unknown;
  confidence?: unknown;
};

type AzureContentElement = {
  content?: unknown;
  boundingRegions?: unknown;
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

@Injectable()
export class AzureDocumentIntelligenceOcrProvider implements OcrProvider {
  readonly name = "azure-document-intelligence";

  canReadPdfDirectly(input: OcrExtractionInput) {
    return (
      input.document.fileType === "application/pdf" &&
      Boolean(input.document.filePath) &&
      Boolean(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim()) &&
      Boolean(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim())
    );
  }

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    if (!input.document.filePath) {
      throw new Error(
        "Azure Document Intelligence OCR requires a local document file.",
      );
    }

    const analyzeResponse = await this.analyzeDocument(input);
    const analyzeResult = analyzeResponse.analyzeResult ?? {};
    const rows =
      input.options?.layout === "form"
        ? this.rowsFromKeyValuePairs(input.template.fields, analyzeResult, input)
        : this.rowsFromTables(input.template.fields, analyzeResult, input);

    return {
      providerName: this.name,
      rawOcrJson: this.toRawOcrJson(input, analyzeResponse),
      rows,
      suggestedFields: this.suggestedFieldsFromTables(
        input.template.fields,
        analyzeResult,
      ),
    };
  }

  private async analyzeDocument(input: OcrExtractionInput) {
    const endpoint = requiredEnv(
      "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT",
      "Azure Document Intelligence OCR",
    );
    const key = requiredEnv(
      "AZURE_DOCUMENT_INTELLIGENCE_KEY",
      "Azure Document Intelligence OCR",
    );
    const fileContent = await readFile(input.document.filePath as string);
    const analyzeUrl = this.analyzeUrl(endpoint, input);
    const analyzeResponse = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Content-Type": input.document.fileType || "application/octet-stream",
        "Ocp-Apim-Subscription-Key": key,
      },
      body: fileContent,
    });
    const bodyText = await analyzeResponse.text().catch(() => "");

    if (!analyzeResponse.ok) {
      throw new Error(
        `Azure Document Intelligence analyze request failed with status ${
          analyzeResponse.status
        }.${this.errorDetail(bodyText)}`,
      );
    }

    const operationLocation = analyzeResponse.headers.get("operation-location");

    if (!operationLocation) {
      const parsed = this.parseJsonResponse(bodyText);

      if (parsed.status === "succeeded" || parsed.analyzeResult) {
        return parsed;
      }

      throw new Error(
        "Azure Document Intelligence analyze response did not include an Operation-Location header.",
      );
    }

    return this.pollAnalyzeResult(operationLocation, key);
  }

  private analyzeUrl(endpoint: string, input: OcrExtractionInput) {
    const modelId =
      process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID?.trim() ??
      DEFAULT_MODEL_ID;
    const url = new URL(
      `/documentintelligence/documentModels/${encodeURIComponent(
        modelId,
      )}:analyze`,
      normalizeEndpoint(endpoint),
    );

    url.searchParams.set(
      "api-version",
      process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION?.trim() ??
        DEFAULT_API_VERSION,
    );

    const pages = this.pageRange(input);

    if (pages) {
      url.searchParams.set("pages", pages);
    }

    const features = process.env.AZURE_DOCUMENT_INTELLIGENCE_FEATURES?.trim();

    if (features) {
      url.searchParams.set("features", features);
    }

    return url.toString();
  }

  private pageRange(input: OcrExtractionInput) {
    const pageStart = input.options?.pageStart;
    const pageCount = input.options?.pageCount;

    if (!pageStart || !pageCount) {
      return null;
    }

    const pageEnd = pageStart + pageCount - 1;

    return pageEnd === pageStart ? String(pageStart) : `${pageStart}-${pageEnd}`;
  }

  private async pollAnalyzeResult(operationLocation: string, key: string) {
    const timeoutMs = envNumber(
      "AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
    );
    const intervalMs = envNumber(
      "AZURE_DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS",
      DEFAULT_POLL_INTERVAL_MS,
    );
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const response = await fetch(operationLocation, {
        method: "GET",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
        },
      });
      const bodyText = await response.text().catch(() => "");

      if (!response.ok) {
        throw new Error(
          `Azure Document Intelligence result request failed with status ${
            response.status
          }.${this.errorDetail(bodyText)}`,
        );
      }

      const parsed = this.parseJsonResponse(bodyText);
      const status = typeof parsed.status === "string" ? parsed.status : "";

      if (status === "succeeded") {
        return parsed;
      }

      if (status === "failed" || status === "canceled") {
        throw new Error(
          `Azure Document Intelligence analysis ${status}.${this.azureErrorDetail(
            parsed.error,
          )}`,
        );
      }

      await delay(intervalMs);
    }

    throw new Error("Azure Document Intelligence analysis timed out.");
  }

  private parseJsonResponse(bodyText: string): AzureAnalyzeResponse {
    if (!bodyText) {
      return {};
    }

    try {
      const parsed = JSON.parse(bodyText);

      return isPlainObject(parsed) ? parsed : {};
    } catch {
      throw new Error("Azure Document Intelligence returned invalid JSON.");
    }
  }

  private rowsFromTables(
    fields: TemplateField[],
    analyzeResult: AzureAnalyzeResult,
    input: OcrExtractionInput,
  ) {
    const tables = arrayOfObjects<AzureTable>(analyzeResult.tables);
    const rows: OcrExtractedRow[] = [];
    let previousHeaderMappings: HeaderMapping[] | null = null;

    for (const table of tables) {
      const cells = arrayOfObjects<AzureTableCell>(table.cells);
      const detectedTableHeaderRowIndex = this.detectHeaderRowIndex(
        cells,
        fields,
      );
      const externalHeaderCells =
        detectedTableHeaderRowIndex === null
          ? this.externalHeaderCells(analyzeResult, table, cells, fields)
          : null;
      const detectedHeaderRowIndex = externalHeaderCells
        ? -1
        : detectedTableHeaderRowIndex;
      const rowIndexes = cells
        .map((cell) => integerValue(cell.rowIndex))
        .filter((rowIndex): rowIndex is number => rowIndex !== null);
      const headerRowIndex =
        detectedHeaderRowIndex ??
        (rowIndexes.length > 0 ? Math.min(...rowIndexes) : 0);
      let reusePreviousHeader = false;
      let mappings: HeaderMapping[];

      if (detectedHeaderRowIndex === null && previousHeaderMappings) {
        reusePreviousHeader = true;
        mappings = previousHeaderMappings;
      } else {
        mappings = this.headerMappings(
          fields,
          externalHeaderCells ?? cells,
          headerRowIndex,
        );
        previousHeaderMappings = mappings;
      }

      const dataRowIndexes = uniqueNumbers(
        cells
          .map((cell) => integerValue(cell.rowIndex))
          .filter((rowIndex): rowIndex is number => rowIndex !== null)
          .filter((rowIndex) =>
            reusePreviousHeader ? true : rowIndex > headerRowIndex,
          ),
      );

      for (const rowIndex of dataRowIndexes) {
        rows.push(
          this.rowFromTableCells(
            fields,
            cells.filter((cell) => integerValue(cell.rowIndex) === rowIndex),
            mappings,
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

  private rowsFromKeyValuePairs(
    fields: TemplateField[],
    analyzeResult: AzureAnalyzeResult,
    input: OcrExtractionInput,
  ) {
    const keyValuePairs = arrayOfObjects<AzureKeyValuePair>(
      analyzeResult.keyValuePairs,
    );

    if (keyValuePairs.length === 0) {
      return this.rowsFromTables(fields, analyzeResult, input);
    }

    const usedPairs = new Set<AzureKeyValuePair>();
    const values = fields.map((field) => {
      const match = this.bestKeyValuePair(field, keyValuePairs, usedPairs);

      if (match) {
        usedPairs.add(match.pair);
      }

      const rawText = match ? contentOf(match.pair.value) : "";
      const normalized = normalizeOcrCellValue(field, rawText);

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
        boundingBox: toBoundingBox(match?.pair.value),
      };
    });

    const data = this.dataFromValues(values);
    const confidenceScore = this.averageConfidence(values);

    return [
      {
        rowNumber: 1,
        sourcePage: this.firstSourcePage(keyValuePairs.map((pair) => pair.value)),
        data,
        values,
        confidenceScore,
      },
    ].filter((row) =>
      Object.values(row.data).some(
        (value) => value !== "" && value !== null && value !== false,
      ),
    );
  }

  private bestKeyValuePair(
    field: TemplateField,
    pairs: AzureKeyValuePair[],
    usedPairs: Set<AzureKeyValuePair>,
  ) {
    return pairs
      .filter((pair) => !usedPairs.has(pair))
      .map((pair) => ({
        pair,
        score: this.fieldMatchScore(contentOf(pair.key), field),
        confidence: confidenceNumber(pair.confidence) ?? 0.74,
      }))
      .filter(
        (candidate): candidate is {
          pair: AzureKeyValuePair;
          score: number;
          confidence: number;
        } => candidate.score !== null && candidate.score <= MAX_HEADER_MATCH_SCORE,
      )
      .sort((left, right) => left.score - right.score)[0];
  }

  private detectHeaderRowIndex(
    cells: AzureTableCell[],
    fields: TemplateField[],
  ) {
    const indexedCells = cells
      .map((cell) => ({
        rowIndex: integerValue(cell.rowIndex),
        columnIndex: integerValue(cell.columnIndex),
        text: cleanOcrText(stringValue(cell.content) ?? ""),
        isExplicitHeader: cell.kind === "columnHeader",
      }))
      .filter(
        (cell): cell is {
          rowIndex: number;
          columnIndex: number;
          text: string;
          isExplicitHeader: boolean;
        } => cell.rowIndex !== null && cell.columnIndex !== null,
      );

    return detectOcrTableHeaderRowIndex(
      indexedCells,
      fields,
      (text, field) => this.fieldMatchScore(text, field),
      MAX_HEADER_MATCH_SCORE,
    );
  }

  private headerRowIndex(cells: AzureTableCell[], fields: TemplateField[]) {
    const detectedHeaderRowIndex = this.detectHeaderRowIndex(cells, fields);

    if (detectedHeaderRowIndex !== null) {
      return detectedHeaderRowIndex;
    }

    const rowIndexes = cells
      .map((cell) => integerValue(cell.rowIndex))
      .filter((rowIndex): rowIndex is number => rowIndex !== null);

    return rowIndexes.length > 0 ? Math.min(...rowIndexes) : 0;
  }

  private headerMappings(
    fields: TemplateField[],
    cells: AzureTableCell[],
    headerRowIndex: number,
  ) {
    const headerCells = cells.filter(
      (cell) => integerValue(cell.rowIndex) === headerRowIndex,
    );
    const mappedColumns = new Set<number>();
    const mappings = fields.map((field, fieldIndex) => {
      const match = headerCells
        .map((cell) => ({
          cell,
          columnIndex: integerValue(cell.columnIndex),
          score: this.fieldMatchScore(stringValue(cell.content), field),
        }))
        .filter(
          (candidate): candidate is {
            cell: AzureTableCell;
            columnIndex: number;
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
          headerText: stringValue(match.cell.content),
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

    return mappings;
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
    rowCells: AzureTableCell[],
    mappings: HeaderMapping[],
    rowIndex: number,
    input: OcrExtractionInput,
  ) {
    const values = fields.map((field) => {
      const mapping = mappings.find((item) => item.field.id === field.id);
      const cell = mapping
        ? rowCells.find(
            (candidate) =>
              integerValue(candidate.columnIndex) === mapping.columnIndex,
          )
        : undefined;
      const rawText = cleanOcrText(stringValue(cell?.content) ?? "");
      const normalized = normalizeOcrCellValue(field, rawText);

      return {
        field,
        rawValue: normalized.rawValue,
        normalizedValue: normalized.normalizedValue,
        confidence: this.cellConfidence(
          mapping?.confidence ?? 0.58,
          confidenceNumber(cell?.confidence) ?? normalized.confidence,
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
        this.firstSourcePage(rowCells) ?? input.options?.pageStart ?? undefined,
      data,
      values,
      confidenceScore: this.averageConfidence(values),
    };
  }

  private suggestedFieldsFromTables(
    fields: TemplateField[],
    analyzeResult: AzureAnalyzeResult,
  ) {
    const suggestions: OcrSuggestedField[] = [];
    const takenKeys = new Set(fields.map((field) => field.key));

    for (const table of arrayOfObjects<AzureTable>(analyzeResult.tables)) {
      for (const source of this.unmappedHeaderSources(
        fields,
        table,
        analyzeResult,
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

  private externalHeaderCells(
    analyzeResult: AzureAnalyzeResult,
    table: AzureTable,
    cells: AzureTableCell[],
    fields: TemplateField[],
  ) {
    const rowIndexes = cells
      .map((cell) => integerValue(cell.rowIndex))
      .filter((rowIndex): rowIndex is number => rowIndex !== null);

    if (rowIndexes.length === 0) {
      return null;
    }

    const firstBodyRowIndex = Math.min(...rowIndexes);
    const columns = cells
      .filter((cell) => integerValue(cell.rowIndex) === firstBodyRowIndex)
      .map((cell) => {
        const columnIndex = integerValue(cell.columnIndex);
        const box = toBoundingBox(cell);

        if (
          columnIndex === null ||
          !isPlainObject(box) ||
          typeof box.x !== "number" ||
          typeof box.y !== "number" ||
          typeof box.width !== "number" ||
          typeof box.height !== "number"
        ) {
          return null;
        }

        return {
          columnIndex,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          centerX: box.x + box.width / 2,
        };
      })
      .filter(
        (
          column,
        ): column is {
          columnIndex: number;
          x: number;
          y: number;
          width: number;
          height: number;
          centerX: number;
        } => column !== null,
      )
      .sort((left, right) => left.columnIndex - right.columnIndex);

    if (columns.length < 2) {
      return null;
    }

    const pageNumber =
      this.firstSourcePage(
        cells.filter((cell) => integerValue(cell.rowIndex) === firstBodyRowIndex),
      ) ?? this.firstSourcePage([table]);
    const pageWords = arrayOfObjects<AzurePage>(analyzeResult.pages).flatMap(
      (page) => {
        const currentPageNumber = integerValue(page.pageNumber);

        if (pageNumber !== undefined && currentPageNumber !== pageNumber) {
          return [];
        }

        return arrayOfObjects<AzurePageWord>(page.words)
          .map(positionedAzureWord)
          .filter(
            (word): word is PositionedAzureWord => word !== null,
          );
      },
    );
    const tableTop = Math.min(...columns.map((column) => column.y));
    const tableLeft = Math.min(...columns.map((column) => column.x));
    const tableRight = Math.max(
      ...columns.map((column) => column.x + column.width),
    );
    const wordsAboveTable = pageWords.filter((word) => {
      const centerX = word.x + word.width / 2;

      return (
        word.y + word.height <= tableTop + 1 &&
        centerX >= tableLeft - 12 &&
        centerX <= tableRight + 12
      );
    });
    const candidateRows = groupPositionedAzureWords(wordsAboveTable).slice(-8);
    const candidateCells = candidateRows.flatMap((row, rowIndex) => {
      const wordsByColumn = new Map<number, PositionedAzureWord[]>();

      for (const word of row) {
        const wordCenterX = word.x + word.width / 2;
        const nearestColumn = columns
          .map((column) => ({
            column,
            distance: Math.abs(column.centerX - wordCenterX),
          }))
          .sort((left, right) => left.distance - right.distance)[0];

        if (!nearestColumn) {
          continue;
        }

        const columnPosition = columns.findIndex(
          (column) => column.columnIndex === nearestColumn.column.columnIndex,
        );
        const adjacentGaps = [
          columns[columnPosition - 1]
            ? nearestColumn.column.centerX - columns[columnPosition - 1].centerX
            : null,
          columns[columnPosition + 1]
            ? columns[columnPosition + 1].centerX - nearestColumn.column.centerX
            : null,
        ].filter((gap): gap is number => gap !== null && gap > 0);
        const maxDistance = Math.max(
          18,
          Math.min(
            90,
            Math.max(
              nearestColumn.column.width * 0.45,
              adjacentGaps.length > 0 ? Math.min(...adjacentGaps) * 0.45 : 0,
            ),
          ),
        );

        if (nearestColumn.distance > maxDistance) {
          continue;
        }

        const columnWords = wordsByColumn.get(
          nearestColumn.column.columnIndex,
        ) ?? [];
        columnWords.push(word);
        wordsByColumn.set(nearestColumn.column.columnIndex, columnWords);
      }

      if (wordsByColumn.size < Math.ceil(columns.length / 2)) {
        return [];
      }

      return Array.from(wordsByColumn, ([columnIndex, words]) => ({
        rowIndex,
        columnIndex,
        content: cleanOcrText(
          words
            .sort((left, right) => left.x - right.x)
            .map((word) => word.text)
            .join(" "),
        ),
      }));
    });
    const headerRowIndex = detectOcrTableHeaderRowIndex(
      candidateCells.map((cell) => ({ ...cell, text: cell.content })),
      fields,
      (text, field) => this.fieldMatchScore(text, field),
      MAX_HEADER_MATCH_SCORE,
    );

    if (headerRowIndex === null) {
      return null;
    }

    return candidateCells
      .filter((cell) => cell.rowIndex === headerRowIndex)
      .map((cell) => ({
        rowIndex: -1,
        columnIndex: cell.columnIndex,
        content: cell.content,
      }));
  }

  private unmappedHeaderSources(
    fields: TemplateField[],
    table: AzureTable,
    analyzeResult: AzureAnalyzeResult,
  ): TableSuggestionSource[] {
    const cells = arrayOfObjects<AzureTableCell>(table.cells);
    const detectedTableHeaderRowIndex = this.detectHeaderRowIndex(cells, fields);
    const externalHeaderCells =
      detectedTableHeaderRowIndex === null
        ? this.externalHeaderCells(analyzeResult, table, cells, fields)
        : null;
    const headerRowIndex = externalHeaderCells
      ? -1
      : (detectedTableHeaderRowIndex ?? this.headerRowIndex(cells, fields));
    const headerCells = externalHeaderCells
      ? externalHeaderCells
      : cells.filter((cell) => integerValue(cell.rowIndex) === headerRowIndex);
    const mappings = this.headerMappings(
      fields,
      externalHeaderCells ?? cells,
      headerRowIndex,
    );
    const mappedColumns = new Set(
      mappings
        .filter((mapping) => mapping.headerText !== null)
        .map((mapping) => mapping.columnIndex),
    );
    const dataRowIndexes = uniqueNumbers(
      cells
        .map((cell) => integerValue(cell.rowIndex))
        .filter((rowIndex): rowIndex is number => rowIndex !== null)
        .filter((rowIndex) => externalHeaderCells || rowIndex > headerRowIndex),
    );

    return headerCells
      .map((cell) => ({
        cell,
        columnIndex: integerValue(cell.columnIndex),
        headerText: cleanOcrText(stringValue(cell.content) ?? ""),
      }))
      .filter(
        (candidate): candidate is {
          cell: AzureTableCell;
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
                  integerValue(cell.rowIndex) === rowIndex &&
                  integerValue(cell.columnIndex) === candidate.columnIndex,
              )?.content,
          )
          .map((value) => cleanOcrText(stringValue(value) ?? ""))
          .filter(Boolean);

        return {
          headerText: candidate.headerText,
          sampleValues: uniqueStrings(sampleValues).slice(0, 8),
          confidence: 0.72,
        };
      });
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

  private firstSourcePage(values: unknown[]) {
    for (const value of values) {
      const pageNumber = firstBoundingRegion(value)?.pageNumber;

      if (typeof pageNumber === "number") {
        return pageNumber;
      }
    }

    return undefined;
  }

  private inferFieldType(sampleValues: string[]): OcrSuggestedFieldType {
    const uniqueValues = new Set(sampleValues.map((value) => value.toLowerCase()));

    if (sampleValues.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
      return "number";
    }

    if (sampleValues.every((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      return "email";
    }

    if (uniqueValues.size > 1 && uniqueValues.size < 8) {
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

  private toRawOcrJson(
    input: OcrExtractionInput,
    response: AzureAnalyzeResponse,
  ) {
    return {
      provider: this.name,
      modelId:
        process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID?.trim() ??
        DEFAULT_MODEL_ID,
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

  private azureErrorDetail(error: unknown) {
    if (!isPlainObject(error)) {
      return "";
    }

    const message = stringValue(error.message);
    const code = stringValue(error.code);

    if (!message && !code) {
      return "";
    }

    return ` ${[code, message].filter(Boolean).join(": ")}`;
  }
}

function requiredEnv(key: string, label: string) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`${key} is required when ${label} is selected.`);
  }

  return value;
}

function envNumber(key: string, fallback: number) {
  const value = Number(process.env[key]);

  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function confidenceNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(clampConfidence(value).toFixed(2))
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function contentOf(value: unknown) {
  if (!isPlainObject(value)) {
    return "";
  }

  return cleanOcrText(stringValue(value.content) ?? "");
}

function firstBoundingRegion(value: unknown) {
  if (!isPlainObject(value)) {
    return null;
  }

  const regions = arrayOfObjects(value.boundingRegions);

  return regions[0] ?? null;
}

function toBoundingBox(value: unknown) {
  const region = firstBoundingRegion(value);

  if (!region) {
    return null;
  }

  const polygon = Array.isArray(region.polygon) ? region.polygon : [];
  const points = polygonToPoints(polygon);

  if (points.length === 0) {
    return {
      pageNumber: region.pageNumber ?? null,
      polygon: toJsonValue(polygon),
    } satisfies Prisma.InputJsonObject;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  return {
    pageNumber: region.pageNumber ?? null,
    x: Number(left.toFixed(2)),
    y: Number(top.toFixed(2)),
    width: Number((right - left).toFixed(2)),
    height: Number((bottom - top).toFixed(2)),
    polygon: toJsonValue(polygon),
  } satisfies Prisma.InputJsonObject;
}

function positionedAzureWord(value: AzurePageWord): PositionedAzureWord | null {
  const text = cleanOcrText(stringValue(value.content) ?? "");
  const points = polygonToPoints(Array.isArray(value.polygon) ? value.polygon : []);

  if (!text || points.length === 0) {
    return null;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  return {
    text,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function groupPositionedAzureWords(words: PositionedAzureWord[]) {
  const heights = words.map((word) => word.height).sort((left, right) => left - right);
  const middle = Math.floor(heights.length / 2);
  const medianHeight =
    heights.length === 0
      ? 8
      : heights.length % 2 === 0
        ? (heights[middle - 1] + heights[middle]) / 2
        : heights[middle];
  const tolerance = Math.min(14, Math.max(3, medianHeight * 0.75));
  const rows: PositionedAzureWord[][] = [];

  for (const word of [...words].sort(
    (left, right) =>
      left.y + left.height / 2 - (right.y + right.height / 2) ||
      left.x - right.x,
  )) {
    const centerY = word.y + word.height / 2;
    const row = rows.find((candidate) => {
      const rowCenterY =
        candidate.reduce(
          (sum, item) => sum + item.y + item.height / 2,
          0,
        ) / candidate.length;

      return Math.abs(rowCenterY - centerY) <= tolerance;
    });

    if (row) {
      row.push(word);
    } else {
      rows.push([word]);
    }
  }

  return rows
    .map((row) => row.sort((left, right) => left.x - right.x))
    .sort((left, right) => {
      const leftCenterY =
        left.reduce((sum, word) => sum + word.y + word.height / 2, 0) /
        left.length;
      const rightCenterY =
        right.reduce((sum, word) => sum + word.y + word.height / 2, 0) /
        right.length;

      return leftCenterY - rightCenterY;
    });
}

function polygonToPoints(polygon: unknown[]) {
  if (polygon.every((item) => typeof item === "number")) {
    const numbers = polygon as number[];
    const points: Array<{ x: number; y: number }> = [];

    for (let index = 0; index + 1 < numbers.length; index += 2) {
      points.push({ x: numbers[index], y: numbers[index + 1] });
    }

    return points;
  }

  return polygon
    .filter(isPlainObject)
    .map((point) => ({
      x: typeof point.x === "number" ? point.x : null,
      y: typeof point.y === "number" ? point.y : null,
    }))
    .filter((point): point is { x: number; y: number } => {
      return point.x !== null && point.y !== null;
    });
}

function toJsonValue(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

function levenshteinDistance(left: string, right: string) {
  const distances = Array.from({ length: left.length + 1 }, (_, index) => [
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
