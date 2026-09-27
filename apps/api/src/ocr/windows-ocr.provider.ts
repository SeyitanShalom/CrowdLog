import { Injectable } from "@nestjs/common";
import type { Prisma, TemplateField } from "@prisma/client";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  type OcrCellValue,
  type OcrExtractionInput,
  type OcrExtractionResult,
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

const execFileAsync = promisify(execFile);
const WINDOWS_OCR_SCRIPT = resolve(process.cwd(), "scripts", "windows-ocr.ps1");
const DEFAULT_COLUMN_X = [35, 109, 184, 260, 335, 410, 485, 560];
const MAX_COLUMN_DISTANCE = 65;
const MAX_HEADER_SPAN_WORDS = 4;
const MAX_HEADER_WORD_GAP = 36;
const MAX_HEADER_MATCH_SCORE = 14;

type WindowsOcrWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type WindowsOcrOutput = {
  text: string;
  words: WindowsOcrWord[];
};

type OcrColumn = {
  field: TemplateField;
  x: number;
  headerText: string | null;
  matchConfidence: number;
};

type HeaderCandidate = {
  text: string;
  x: number;
  words: WindowsOcrWord[];
};

@Injectable()
export class WindowsOcrProvider implements OcrProvider {
  readonly name = "windows-ocr";

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    if (!input.document.filePath) {
      throw new Error("Windows OCR requires a local uploaded document file.");
    }

    const ocr = await this.runWindowsOcr(input.document.filePath);
    const columns = this.resolveColumns(input.template.fields, ocr.words);
    const bodyRows = this.groupBodyWords(ocr.words);
    const rows = this.buildRows(columns, bodyRows, input);
    const suggestedFields = this.buildFieldSuggestions(
      input.template.fields,
      columns,
      bodyRows,
      ocr.words,
    );

    return {
      providerName: this.name,
      rawOcrJson: {
        provider: this.name,
        document: {
          id: input.document.id ?? null,
          fileName: input.document.fileName,
          fileType: input.document.fileType,
          fileUrl: input.document.fileUrl,
        },
        text: ocr.text,
        words: ocr.words.slice(0, 300),
        columnMappings: columns.map((column) => ({
          fieldKey: column.field.key,
          headerText: column.headerText,
          x: column.x,
          confidence: column.matchConfidence,
        })),
        rows: rows.map((row) => row.data),
        validations: rows.map((row) => ({
          rowNumber: row.rowNumber,
          values: row.values.map((value) => ({
            fieldKey: value.field.key,
            confidence: value.confidence,
            issues: value.issues ?? [],
          })),
        })),
        suggestedFields,
      } as Prisma.InputJsonObject,
      rows,
      suggestedFields,
    };
  }

  private async runWindowsOcr(filePath: string) {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        WINDOWS_OCR_SCRIPT,
        "-Path",
        filePath,
      ],
      {
        maxBuffer: 1024 * 1024 * 5,
        windowsHide: true,
      },
    );

    return JSON.parse(stdout) as WindowsOcrOutput;
  }

  private buildRows(
    columns: OcrColumn[],
    bodyRows: WindowsOcrWord[][],
    input: OcrExtractionInput,
  ) {
    const rowCount = input.options?.rowCount ?? 25;

    return bodyRows
      .map((rowWords, index) => this.toExtractedRow(rowWords, columns, index))
      .filter((row) =>
        Object.values(row.data).some(
          (value) => value !== "" && value !== null && value !== false,
        ),
      )
      .slice(0, rowCount);
  }

  private resolveColumns(fields: TemplateField[], words: WindowsOcrWord[]) {
    const headerCandidates = this.buildHeaderCandidates(words);
    const matches: Array<{
      field: TemplateField;
      candidate: HeaderCandidate;
      score: number;
    }> = [];

    for (const field of fields) {
      for (const candidate of headerCandidates) {
        const score = this.headerMatchScore(candidate.text, field);

        if (score === null || score > MAX_HEADER_MATCH_SCORE) {
          continue;
        }

        matches.push({ field, candidate, score });
      }
    }

    matches.sort(
      (left, right) =>
        left.score - right.score ||
        right.candidate.words.length - left.candidate.words.length ||
        left.field.sortOrder - right.field.sortOrder,
    );

    const mappedColumns = new Map<string, OcrColumn>();
    const usedHeaderWords = new Set<WindowsOcrWord>();
    const fallbackColumnXs = this.estimateFallbackColumnXs(fields.length, words);

    for (const match of matches) {
      if (
        mappedColumns.has(match.field.id) ||
        match.candidate.words.some((word) => usedHeaderWords.has(word))
      ) {
        continue;
      }

      for (const word of match.candidate.words) {
        usedHeaderWords.add(word);
      }

      mappedColumns.set(match.field.id, {
        field: match.field,
        x: match.candidate.x,
        headerText: match.candidate.text,
        matchConfidence: this.headerMatchConfidence(match.score),
      });
    }

    return fields.map(
      (field, index) =>
        mappedColumns.get(field.id) ?? {
          field,
          x: fallbackColumnXs[index] ?? DEFAULT_COLUMN_X[index] ?? 35 + index * 75,
          headerText: null,
          matchConfidence: 0.62,
        },
    );
  }

  private groupBodyWords(words: WindowsOcrWord[]) {
    const headerBottom = this.headerBottom(words);
    const sortedWords = words
      .filter(
        (word) =>
          this.isUsableWord(word) && word.y > headerBottom + 3 && word.x >= 25,
      )
      .sort((left, right) => left.y - right.y || left.x - right.x);

    return this.groupWordsIntoRows(sortedWords, this.rowTolerance(sortedWords));
  }

  private buildFieldSuggestions(
    fields: TemplateField[],
    mappedColumns: OcrColumn[],
    bodyRows: WindowsOcrWord[][],
    words: WindowsOcrWord[],
  ): OcrSuggestedField[] {
    const suggestions: OcrSuggestedField[] = [];
    const existingKeys = fields.map((field) => field.key);
    const headerWords = this.headerWords(words);

    for (const x of DEFAULT_COLUMN_X) {
      if (mappedColumns.some((column) => Math.abs(column.x - x) <= 20)) {
        continue;
      }

      const sampleValues = this.sampleColumnValues(bodyRows, x);

      if (sampleValues.length < 2) {
        continue;
      }

      const header = headerWords.find(
        (word) => Math.abs(this.centerX(word) - x) <= MAX_COLUMN_DISTANCE,
      );
      const inferred = this.inferSuggestedField(header?.text, sampleValues, x);

      if (!inferred) {
        continue;
      }

      const key = this.dedupeFieldKey(this.normalizeFieldKey(inferred.label), [
        ...existingKeys,
        ...suggestions.map((suggestion) => suggestion.key),
      ]);

      suggestions.push({
        label: inferred.label,
        key,
        type: inferred.type,
        aliases: inferred.aliases,
        options: inferred.options,
        sampleValues,
        confidence: inferred.confidence,
      });
    }

    return suggestions;
  }

  private sampleColumnValues(bodyRows: WindowsOcrWord[][], x: number) {
    const values = bodyRows
      .map((row) =>
        this.toCellValue(
          row.filter((word) => Math.abs(this.centerX(word) - x) <= 40),
        ),
      )
      .filter(Boolean);
    const uniqueValues: string[] = [];

    for (const value of values) {
      if (!uniqueValues.includes(value)) {
        uniqueValues.push(value);
      }
    }

    return uniqueValues.slice(0, 8);
  }

  private inferSuggestedField(
    headerText: string | undefined,
    sampleValues: string[],
    x: number,
  ):
    | {
        label: string;
        type: OcrSuggestedFieldType;
        aliases: string[];
        options: string[];
        confidence: number;
      }
    | null {
    const normalizedHeader = headerText ? normalizeOcrTerm(headerText) : "";
    const normalizedSamples = sampleValues.map((value) =>
      normalizeOcrTerm(value),
    );
    const taxaValues = ["bird", "rodent", "reptile", "mammal", "amphibian"];
    const looksLikeTaxa =
      normalizedHeader.includes("taxa") ||
      normalizedHeader.includes("taxon") ||
      normalizedSamples.some((value) =>
        taxaValues.some((taxaValue) => value.includes(taxaValue)),
      );

    if (looksLikeTaxa) {
      return {
        label: "Taxa",
        type: "select",
        aliases: ["Taxon", "Status"],
        options: sampleValues,
        confidence: 0.86,
      };
    }

    if (headerText) {
      const label = this.toTitleLabel(headerText);

      return {
        label,
        type: this.inferFieldType(sampleValues),
        aliases: [],
        options: this.inferFieldType(sampleValues) === "select" ? sampleValues : [],
        confidence: 0.72,
      };
    }

    if (sampleValues.length >= 4) {
      return {
        label: `Column ${DEFAULT_COLUMN_X.indexOf(x) + 1}`,
        type: this.inferFieldType(sampleValues),
        aliases: [],
        options: [],
        confidence: 0.48,
      };
    }

    return null;
  }

  private inferFieldType(sampleValues: string[]): OcrSuggestedFieldType {
    const uniqueValues = new Set(sampleValues.map((value) => value.toLowerCase()));

    if (uniqueValues.size > 1 && uniqueValues.size <= 8) {
      return "select";
    }

    if (sampleValues.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
      return "number";
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

  private dedupeFieldKey(baseKey: string, takenKeys: string[]) {
    const taken = new Set(takenKeys);
    let candidate = baseKey;
    let suffix = 2;

    while (taken.has(candidate)) {
      candidate = `${baseKey}_${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private toExtractedRow(
    words: WindowsOcrWord[],
    columns: OcrColumn[],
    index: number,
  ): OcrExtractedRow {
    const values = columns.map((column, columnIndex) => {
      const { field } = column;
      const cellWords = words.filter(
        (word) => this.nearestColumnIndex(word, columns) === columnIndex,
      );
      const rawText = this.toCellValue(cellWords);
      const normalized = normalizeOcrCellValue(field, rawText);
      const confidence = this.cellConfidence(
        column.matchConfidence,
        normalized.confidence,
        normalized.issues.length,
      );

      return {
        field,
        rawValue: normalized.rawValue,
        normalizedValue: normalized.normalizedValue,
        confidence,
        issues: normalized.issues,
        boundingBox: this.toBoundingBox(cellWords),
      };
    });
    const data = Object.fromEntries(
      values.map((value) => [value.field.key, value.normalizedValue]),
    ) as Record<string, OcrCellValue>;
    const confidenceScore = values.length
      ? values.reduce((sum, value) => sum + value.confidence, 0) / values.length
      : 0;

    return {
      rowNumber: index + 1,
      data,
      values,
      confidenceScore: Number(confidenceScore.toFixed(2)),
    };
  }

  private toCellValue(words: WindowsOcrWord[]) {
    return cleanOcrText(
      words
        .filter((word) => this.isUsableWord(word))
        .sort((left, right) => left.x - right.x)
        .map((word) => word.text)
        .join(" "),
    );
  }

  private nearestColumnIndex(word: WindowsOcrWord, columns: OcrColumn[]) {
    const centerX = word.x + word.width / 2;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    columns.forEach((column, index) => {
      const distance = Math.abs(centerX - column.x);

      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });

    return bestDistance <= this.columnDistanceLimit(bestIndex, columns)
      ? bestIndex
      : null;
  }

  private headerMatchScore(word: string, field: TemplateField) {
    const normalizedWords = Array.from(
      new Set([normalizeOcrTerm(word), normalizeNoisyOcrTerm(word)]),
    ).filter(Boolean);

    if (normalizedWords.length === 0) {
      return null;
    }

    let bestScore: number | null = null;

    for (const term of getOcrFieldTerms(field)) {
      const terms = Array.from(
        new Set([normalizeOcrTerm(term), normalizeNoisyOcrTerm(term)]),
      ).filter(Boolean);

      for (const normalizedWord of normalizedWords) {
        for (const normalizedTerm of terms) {
          const distance = this.levenshteinDistance(
            normalizedWord,
            normalizedTerm,
          );
          const longestLength = Math.max(
            normalizedWord.length,
            normalizedTerm.length,
          );
          const shortestLength = Math.min(
            normalizedWord.length,
            normalizedTerm.length,
          );
          const maxDistance = Math.max(2, Math.floor(longestLength * 0.22));
          let score: number | null = null;

          if (normalizedWord === normalizedTerm) {
            score = 0;
          } else if (
            shortestLength >= 3 &&
            (normalizedWord.includes(normalizedTerm) ||
              normalizedTerm.includes(normalizedWord))
          ) {
            score = Math.abs(normalizedWord.length - normalizedTerm.length) + 2;
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

  private buildHeaderCandidates(words: WindowsOcrWord[]) {
    const headerWords = this.headerWords(words);
    const candidates: HeaderCandidate[] = [];

    for (let start = 0; start < headerWords.length; start += 1) {
      for (
        let length = 1;
        length <= MAX_HEADER_SPAN_WORDS && start + length <= headerWords.length;
        length += 1
      ) {
        const span = headerWords.slice(start, start + length);

        if (!this.isCompactHeaderSpan(span)) {
          break;
        }

        const text = this.toCellValue(span);

        if (!text) {
          continue;
        }

        candidates.push({
          text,
          x: this.spanCenterX(span),
          words: span,
        });
      }
    }

    return candidates;
  }

  private headerWords(words: WindowsOcrWord[]) {
    const usableWords = words
      .filter((word) => this.isUsableWord(word) && word.x >= 25)
      .sort((left, right) => left.y - right.y || left.x - right.x);
    const rows = this.groupWordsIntoRows(
      usableWords,
      this.rowTolerance(usableWords),
    );
    const headerRow = rows
      .slice(0, 4)
      .sort(
        (left, right) =>
          right.length - left.length || this.averageY(left) - this.averageY(right),
      )[0];

    return headerRow ? [...headerRow].sort((left, right) => left.x - right.x) : [];
  }

  private headerBottom(words: WindowsOcrWord[]) {
    const headerWords = this.headerWords(words);

    if (headerWords.length === 0) {
      return 26;
    }

    return Math.max(...headerWords.map((word) => word.y + word.height));
  }

  private groupWordsIntoRows(words: WindowsOcrWord[], tolerance: number) {
    const rows: WindowsOcrWord[][] = [];

    for (const word of words) {
      const row = rows.find(
        (candidate) => Math.abs(this.averageY(candidate) - word.y) <= tolerance,
      );

      if (row) {
        row.push(word);
      } else {
        rows.push([word]);
      }
    }

    return rows.map((row) => row.sort((left, right) => left.x - right.x));
  }

  private isCompactHeaderSpan(words: WindowsOcrWord[]) {
    const maxGap = Math.max(
      MAX_HEADER_WORD_GAP,
      this.median(words.map((word) => word.width)) * 1.4,
    );

    return words.every((word, index) => {
      if (index === 0) {
        return true;
      }

      const previous = words[index - 1];
      const gap = word.x - (previous.x + previous.width);

      return gap <= maxGap;
    });
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
    columnConfidence: number,
    valueConfidence: number,
    issueCount: number,
  ) {
    const confidence = valueConfidence * 0.72 + columnConfidence * 0.28;
    const cappedConfidence =
      issueCount > 0 ? Math.min(confidence, 0.68) : confidence;

    return Number(clampConfidence(cappedConfidence).toFixed(2));
  }

  private toBoundingBox(words: WindowsOcrWord[]) {
    if (words.length === 0) {
      return null;
    }

    const left = Math.min(...words.map((word) => word.x));
    const top = Math.min(...words.map((word) => word.y));
    const right = Math.max(...words.map((word) => word.x + word.width));
    const bottom = Math.max(...words.map((word) => word.y + word.height));

    return {
      x: Number(left.toFixed(2)),
      y: Number(top.toFixed(2)),
      width: Number((right - left).toFixed(2)),
      height: Number((bottom - top).toFixed(2)),
    } satisfies Prisma.InputJsonObject;
  }

  private estimateFallbackColumnXs(fieldCount: number, words: WindowsOcrWord[]) {
    const headerCenters = this.headerWords(words)
      .map((word) => this.centerX(word))
      .sort((left, right) => left - right);

    if (headerCenters.length >= fieldCount) {
      return Array.from({ length: fieldCount }, (_, index) => {
        const headerIndex =
          fieldCount === 1
            ? 0
            : Math.round((index * (headerCenters.length - 1)) / (fieldCount - 1));

        return headerCenters[headerIndex];
      });
    }

    return DEFAULT_COLUMN_X.slice(0, fieldCount);
  }

  private columnDistanceLimit(columnIndex: number, columns: OcrColumn[]) {
    const sortedColumns = [...columns].sort((left, right) => left.x - right.x);
    const column = columns[columnIndex];
    const sortedIndex = sortedColumns.findIndex(
      (candidate) => candidate.field.id === column.field.id,
    );
    const gaps = [
      sortedColumns[sortedIndex - 1]
        ? Math.abs(column.x - sortedColumns[sortedIndex - 1].x)
        : null,
      sortedColumns[sortedIndex + 1]
        ? Math.abs(sortedColumns[sortedIndex + 1].x - column.x)
        : null,
    ].filter((gap): gap is number => gap !== null && gap > 0);

    if (gaps.length === 0) {
      return MAX_COLUMN_DISTANCE;
    }

    return Math.min(140, Math.max(42, Math.min(...gaps) * 0.55));
  }

  private isUsableWord(word: WindowsOcrWord) {
    return /[a-z0-9]/i.test(cleanOcrText(word.text));
  }

  private rowTolerance(words: WindowsOcrWord[]) {
    const medianHeight = this.median(words.map((word) => word.height));

    return Math.min(18, Math.max(6, medianHeight * 0.65));
  }

  private centerX(word: WindowsOcrWord) {
    return word.x + word.width / 2;
  }

  private spanCenterX(words: WindowsOcrWord[]) {
    const left = Math.min(...words.map((word) => word.x));
    const right = Math.max(...words.map((word) => word.x + word.width));

    return left + (right - left) / 2;
  }

  private averageY(words: WindowsOcrWord[]) {
    return words.reduce((sum, word) => sum + word.y, 0) / words.length;
  }

  private median(values: number[]) {
    if (values.length === 0) {
      return 10;
    }

    const sortedValues = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sortedValues.length / 2);

    return sortedValues.length % 2 === 0
      ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
      : sortedValues[middle];
  }

  private levenshteinDistance(left: string, right: string) {
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
}
