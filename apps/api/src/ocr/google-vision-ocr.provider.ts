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

const DEFAULT_ENDPOINT = "https://vision.googleapis.com";
const DEFAULT_FEATURE_TYPE = "DOCUMENT_TEXT_DETECTION";
const MAX_HEADER_MATCH_SCORE = 14;
const MAX_HEADER_SPAN_WORDS = 4;

type GoogleVisionBatchResponse = {
  responses?: unknown;
};

type GoogleVisionAnnotateResponse = {
  error?: unknown;
  fullTextAnnotation?: GoogleFullTextAnnotation;
  textAnnotations?: unknown;
};

type GoogleFullTextAnnotation = {
  text?: unknown;
  pages?: unknown;
};

type GooglePage = {
  width?: unknown;
  height?: unknown;
  blocks?: unknown;
};

type GoogleBlock = {
  paragraphs?: unknown;
};

type GoogleParagraph = {
  words?: unknown;
};

type GoogleWord = {
  symbols?: unknown;
  boundingBox?: unknown;
  confidence?: unknown;
};

type GoogleSymbol = {
  text?: unknown;
  property?: unknown;
  confidence?: unknown;
};

type GoogleTextAnnotation = {
  description?: unknown;
  boundingPoly?: unknown;
  score?: unknown;
};

type VisionWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  pageNumber: number;
  boundingBox: Prisma.InputJsonObject | null;
};

type VisionColumn = {
  field: TemplateField;
  x: number;
  headerText: string | null;
  headerWords: VisionWord[];
  matchConfidence: number;
};

type HeaderCandidate = {
  text: string;
  x: number;
  words: VisionWord[];
};

type RowGroup = {
  words: VisionWord[];
  y: number;
};

@Injectable()
export class GoogleVisionOcrProvider implements OcrProvider {
  readonly name = "google-vision";

  canReadPdfDirectly(_input: OcrExtractionInput) {
    return false;
  }

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    if (!input.document.filePath) {
      throw new Error("Google Vision OCR requires a local document file.");
    }

    if (input.document.fileType === "application/pdf") {
      throw new Error(
        "Google Vision OCR requires an image file or rendered PDF page. Set OCR_PDF_RENDER_MODE to render-pages for PDF inputs.",
      );
    }

    const response = await this.annotateImage(input);
    const annotation = this.firstAnnotation(response);
    const words = this.wordsFromAnnotation(annotation, input);
    const rows =
      input.options?.layout === "form"
        ? this.rowsFromForm(words, input)
        : this.rowsFromTable(words, input);

    return {
      providerName: this.name,
      rawOcrJson: this.toRawOcrJson(input, response, words, rows),
      rows,
      suggestedFields:
        input.options?.layout === "form"
          ? []
          : this.suggestedFieldsFromTable(words, input.template.fields),
    };
  }

  private async annotateImage(input: OcrExtractionInput) {
    const fileContent = await readFile(input.document.filePath as string);
    const response = await fetch(this.annotateUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        requests: [
          {
            image: {
              content: fileContent.toString("base64"),
            },
            features: [
              {
                type: this.featureType(),
                ...this.featureModel(),
              },
            ],
            ...this.imageContext(),
          },
        ],
      }),
    });
    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      throw new Error(
        `Google Vision annotate request failed with status ${
          response.status
        }.${this.errorDetail(bodyText)}`,
      );
    }

    return this.parseJsonResponse(bodyText);
  }

  private annotateUrl() {
    const url = new URL(
      "/v1/images:annotate",
      normalizeEndpoint(
        process.env.GOOGLE_VISION_ENDPOINT?.trim() ?? DEFAULT_ENDPOINT,
      ),
    );
    const apiKey = process.env.GOOGLE_VISION_API_KEY?.trim();

    if (apiKey) {
      url.searchParams.set("key", apiKey);
    }

    if (!apiKey && !process.env.GOOGLE_VISION_ACCESS_TOKEN?.trim()) {
      throw new Error(
        "GOOGLE_VISION_API_KEY or GOOGLE_VISION_ACCESS_TOKEN is required when Google Vision OCR is selected.",
      );
    }

    return url.toString();
  }

  private headers() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
    };
    const accessToken = process.env.GOOGLE_VISION_ACCESS_TOKEN?.trim();

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    return headers;
  }

  private featureType() {
    const value = process.env.GOOGLE_VISION_FEATURE_TYPE?.trim();

    return value || DEFAULT_FEATURE_TYPE;
  }

  private featureModel() {
    const model = process.env.GOOGLE_VISION_MODEL?.trim();

    return model ? { model } : {};
  }

  private imageContext() {
    const languageHints = (process.env.GOOGLE_VISION_LANGUAGE_HINTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    return languageHints.length > 0 ? { imageContext: { languageHints } } : {};
  }

  private parseJsonResponse(bodyText: string): GoogleVisionBatchResponse {
    if (!bodyText) {
      return {};
    }

    try {
      const parsed = JSON.parse(bodyText);

      return isPlainObject(parsed) ? parsed : {};
    } catch {
      throw new Error("Google Vision returned invalid JSON.");
    }
  }

  private firstAnnotation(
    response: GoogleVisionBatchResponse,
  ): GoogleVisionAnnotateResponse {
    const annotation = arrayOfObjects<GoogleVisionAnnotateResponse>(
      response.responses,
    )[0];

    if (!annotation) {
      return {};
    }

    if (isPlainObject(annotation.error)) {
      const message = stringValue(annotation.error.message);
      const code = stringValue(annotation.error.code);

      throw new Error(
        `Google Vision annotation failed.${
          message || code ? ` ${[code, message].filter(Boolean).join(": ")}` : ""
        }`,
      );
    }

    return annotation;
  }

  private wordsFromAnnotation(
    annotation: GoogleVisionAnnotateResponse,
    input: OcrExtractionInput,
  ) {
    const words = this.fullTextWords(annotation.fullTextAnnotation, input);

    return words.length > 0
      ? words
      : this.textAnnotationWords(annotation.textAnnotations, input);
  }

  private fullTextWords(
    annotation: GoogleFullTextAnnotation | undefined,
    input: OcrExtractionInput,
  ) {
    const words: VisionWord[] = [];

    for (const [pageIndex, page] of arrayOfObjects<GooglePage>(
      annotation?.pages,
    ).entries()) {
      const pageNumber = input.options?.pageStart
        ? input.options.pageStart + pageIndex
        : pageIndex + 1;

      for (const block of arrayOfObjects<GoogleBlock>(page.blocks)) {
        for (const paragraph of arrayOfObjects<GoogleParagraph>(
          block.paragraphs,
        )) {
          for (const word of arrayOfObjects<GoogleWord>(paragraph.words)) {
            const text = cleanOcrText(this.wordText(word));
            const box = boxFromPoly(word.boundingBox, {
              pageNumber,
              pageWidth: numberValue(page.width),
              pageHeight: numberValue(page.height),
            });

            if (!text || !box) {
              continue;
            }

            words.push({
              text,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              confidence: confidenceNumber(word.confidence) ?? 0.82,
              pageNumber,
              boundingBox: box.json,
            });
          }
        }
      }
    }

    return words;
  }

  private textAnnotationWords(
    annotations: unknown,
    input: OcrExtractionInput,
  ) {
    return arrayOfObjects<GoogleTextAnnotation>(annotations)
      .slice(1)
      .flatMap((annotation) => {
        const text = cleanOcrText(stringValue(annotation.description) ?? "");
        const box = boxFromPoly(annotation.boundingPoly, {
          pageNumber: input.options?.pageStart ?? 1,
        });

        if (!text || !box) {
          return [];
        }

        return [
          {
            text,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            confidence: confidenceNumber(annotation.score) ?? 0.72,
            pageNumber: input.options?.pageStart ?? 1,
            boundingBox: box.json,
          },
        ];
      });
  }

  private wordText(word: GoogleWord) {
    return arrayOfObjects<GoogleSymbol>(word.symbols)
      .map((symbol) => stringValue(symbol.text) ?? "")
      .join("");
  }

  private rowsFromTable(
    words: VisionWord[],
    input: OcrExtractionInput,
  ): OcrExtractedRow[] {
    const rows: OcrExtractedRow[] = [];

    for (const pageWords of this.wordsByPage(words)) {
      const pageRows = this.groupWordsIntoRows(pageWords);
      const headerRow = this.headerRow(input.template.fields, pageRows);

      if (!headerRow) {
        continue;
      }

      const columns = this.resolveColumns(input.template.fields, headerRow.words);
      const bodyRows = pageRows.filter((row) => row.y > headerRow.y);

      for (const row of bodyRows) {
        rows.push(this.tableRow(row.words, columns, rows.length));
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

  private rowsFromForm(
    words: VisionWord[],
    input: OcrExtractionInput,
  ): OcrExtractedRow[] {
    const fields = input.template.fields;
    const matches = fields.map((field) => {
      const match = this.bestFieldLabelMatch(field, words);
      const valueWords = match ? this.valueWordsForLabel(match, words) : [];
      const rawText = this.wordsToText(valueWords);
      const normalized = normalizeOcrCellValue(field, rawText);

      return {
        field,
        rawValue: normalized.rawValue,
        normalizedValue: normalized.normalizedValue,
        confidence: this.cellConfidence(
          match?.confidence ?? 0.56,
          normalized.confidence,
          normalized.issues.length,
        ),
        issues: normalized.issues,
        boundingBox: this.wordsBoundingBox(valueWords),
      };
    });
    const data = this.dataFromValues(matches);

    return [
      {
        rowNumber: 1,
        sourcePage:
          matches
            .map((match) => pageNumberFromBox(match.boundingBox))
            .find((pageNumber) => typeof pageNumber === "number") ??
          input.options?.pageStart,
        data,
        values: matches,
        confidenceScore: this.averageConfidence(matches),
      },
    ].filter((row) =>
      Object.values(row.data).some(
        (value) => value !== "" && value !== null && value !== false,
      ),
    );
  }

  private bestFieldLabelMatch(field: TemplateField, words: VisionWord[]) {
    return this.headerCandidates(words)
      .map((candidate) => ({
        candidate,
        score: this.fieldMatchScore(candidate.text, field),
      }))
      .filter(
        (match): match is { candidate: HeaderCandidate; score: number } =>
          match.score !== null && match.score <= MAX_HEADER_MATCH_SCORE,
      )
      .sort(
        (left, right) =>
          left.score - right.score ||
          right.candidate.words.length - left.candidate.words.length ||
          left.candidate.words[0].y - right.candidate.words[0].y ||
          left.candidate.words[0].x - right.candidate.words[0].x,
      )
      .map((match) => ({
        ...match.candidate,
        confidence: this.headerMatchConfidence(match.score),
      }))[0];
  }

  private valueWordsForLabel(
    label: HeaderCandidate & { confidence: number },
    words: VisionWord[],
  ) {
    const rows = this.groupWordsIntoRows(
      words.filter((word) => word.pageNumber === label.words[0]?.pageNumber),
    );
    const labelRow = rows.find((row) =>
      label.words.some((labelWord) => row.words.includes(labelWord)),
    );
    const labelRight = Math.max(
      ...label.words.map((word) => word.x + word.width),
    );

    if (labelRow) {
      const sameLineValueWords = labelRow.words.filter(
        (word) => word.x > labelRight + this.medianWordWidth(labelRow.words) * 0.4,
      );

      if (sameLineValueWords.length > 0) {
        return sameLineValueWords;
      }
    }

    const labelRowIndex = labelRow ? rows.indexOf(labelRow) : -1;

    return labelRowIndex >= 0 ? rows[labelRowIndex + 1]?.words ?? [] : [];
  }

  private tableRow(
    rowWords: VisionWord[],
    columns: VisionColumn[],
    rowIndex: number,
  ): OcrExtractedRow {
    const values = columns.map((column, columnIndex) => {
      const cellWords = rowWords.filter(
        (word) => this.nearestColumnIndex(word, columns) === columnIndex,
      );
      const rawText = this.wordsToText(cellWords);
      const normalized = normalizeOcrCellValue(column.field, rawText);

      return {
        field: column.field,
        rawValue: normalized.rawValue,
        normalizedValue: normalized.normalizedValue,
        confidence: this.cellConfidence(
          column.matchConfidence,
          Math.min(
            normalized.confidence,
            cellWords.length > 0 ? this.averageWordConfidence(cellWords) : 0.68,
          ),
          normalized.issues.length,
        ),
        issues: normalized.issues,
        boundingBox: this.wordsBoundingBox(cellWords),
      };
    });
    const data = this.dataFromValues(values);

    return {
      rowNumber: rowIndex + 1,
      sourcePage: rowWords[0]?.pageNumber,
      data,
      values,
      confidenceScore: this.averageConfidence(values),
    };
  }

  private suggestedFieldsFromTable(words: VisionWord[], fields: TemplateField[]) {
    const suggestions: OcrSuggestedField[] = [];
    const takenKeys = new Set(fields.map((field) => field.key));

    for (const pageWords of this.wordsByPage(words)) {
      const pageRows = this.groupWordsIntoRows(pageWords);
      const headerRow = this.headerRow(fields, pageRows);

      if (!headerRow) {
        continue;
      }

      const columns = this.resolveColumns(fields, headerRow.words);
      const usedHeaderWords = new Set(
        columns.flatMap((column) => column.headerWords),
      );
      const unmappedHeaderWords = headerRow.words.filter(
        (word) => !usedHeaderWords.has(word),
      );

      for (const candidate of this.headerCandidates(unmappedHeaderWords)) {
        const candidateLeft = Math.min(...candidate.words.map((word) => word.x));
        const leftSlack = this.medianWordWidth(candidate.words) * 0.2;
        const sampleValues = pageRows
          .filter((row) => row.y > headerRow.y)
          .map((row) =>
            this.wordsToText(
              row.words.filter(
                (word) =>
                  this.centerX(word) >= candidateLeft - leftSlack &&
                  Math.abs(this.centerX(word) - candidate.x) <=
                  this.columnDistanceLimitForX(candidate.x, columns),
              ),
            ),
          )
          .filter(Boolean);

        if (sampleValues.length === 0) {
          continue;
        }

        const key = this.dedupeFieldKey(
          this.normalizeFieldKey(candidate.text),
          takenKeys,
        );

        takenKeys.add(key);
        suggestions.push({
          label: this.toTitleLabel(candidate.text),
          key,
          type: this.inferFieldType(sampleValues),
          aliases: [],
          options:
            this.inferFieldType(sampleValues) === "select"
              ? uniqueStrings(sampleValues)
              : [],
          sampleValues: uniqueStrings(sampleValues).slice(0, 8),
          confidence: 0.7,
        });
      }
    }

    return suggestions;
  }

  private resolveColumns(fields: TemplateField[], headerWords: VisionWord[]) {
    const candidates = this.headerCandidates(headerWords);
    const matches = fields
      .flatMap((field) =>
        candidates.map((candidate) => ({
          field,
          candidate,
          score: this.fieldMatchScore(candidate.text, field),
        })),
      )
      .filter(
        (match): match is {
          field: TemplateField;
          candidate: HeaderCandidate;
          score: number;
        } => match.score !== null && match.score <= MAX_HEADER_MATCH_SCORE,
      )
      .sort(
        (left, right) =>
          left.score - right.score ||
          right.candidate.words.length - left.candidate.words.length ||
          left.field.sortOrder - right.field.sortOrder,
      );
    const usedWords = new Set<VisionWord>();
    const mappedColumns = new Map<string, VisionColumn>();
    const fallbackXs = this.fallbackColumnXs(fields.length, headerWords);

    for (const match of matches) {
      if (
        mappedColumns.has(match.field.id) ||
        match.candidate.words.some((word) => usedWords.has(word))
      ) {
        continue;
      }

      match.candidate.words.forEach((word) => usedWords.add(word));
      mappedColumns.set(match.field.id, {
        field: match.field,
        x: match.candidate.x,
        headerText: match.candidate.text,
        headerWords: match.candidate.words,
        matchConfidence: this.headerMatchConfidence(match.score),
      });
    }

    return fields.map(
      (field, index) =>
        mappedColumns.get(field.id) ?? {
          field,
          x: fallbackXs[index] ?? 35 + index * 75,
          headerText: null,
          headerWords: [],
          matchConfidence: 0.58,
        },
    );
  }

  private headerRow(fields: TemplateField[], rows: RowGroup[]) {
    return rows
      .slice(0, 6)
      .map((row) => ({
        row,
        score: this.headerRowScore(fields, row.words),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.row.y - right.row.y)
      .map((candidate) => candidate.row)[0];
  }

  private headerRowScore(fields: TemplateField[], words: VisionWord[]) {
    let score = 0;

    for (const field of fields) {
      const bestScore = this.headerCandidates(words)
        .map((candidate) => this.fieldMatchScore(candidate.text, field))
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right)[0];

      if (bestScore !== undefined && bestScore <= MAX_HEADER_MATCH_SCORE) {
        score += 20 - bestScore;
      }
    }

    return score;
  }

  private headerCandidates(words: VisionWord[]) {
    const candidates: HeaderCandidate[] = [];
    const sortedWords = [...words].sort((left, right) => left.x - right.x);

    for (let start = 0; start < sortedWords.length; start += 1) {
      for (
        let length = 1;
        length <= MAX_HEADER_SPAN_WORDS && start + length <= sortedWords.length;
        length += 1
      ) {
        const span = sortedWords.slice(start, start + length);

        if (!this.isCompactSpan(span)) {
          break;
        }

        candidates.push({
          text: this.wordsToText(span),
          x: this.centerXSpan(span),
          words: span,
        });
      }
    }

    return candidates.filter((candidate) => candidate.text);
  }

  private isCompactSpan(words: VisionWord[]) {
    if (words.length <= 1) {
      return true;
    }

    const maxGap = Math.max(24, this.medianWordWidth(words) * 1.8);

    for (let index = 1; index < words.length; index += 1) {
      const gap = words[index].x - (words[index - 1].x + words[index - 1].width);

      if (gap > maxGap || words[index].pageNumber !== words[0].pageNumber) {
        return false;
      }
    }

    return true;
  }

  private groupWordsIntoRows(words: VisionWord[]) {
    const rows: RowGroup[] = [];
    const tolerance = this.rowTolerance(words);

    for (const word of [...words].sort((left, right) => left.y - right.y || left.x - right.x)) {
      const centerY = word.y + word.height / 2;
      const row = rows.find(
        (candidate) =>
          word.pageNumber === candidate.words[0]?.pageNumber &&
          Math.abs(candidate.y - centerY) <= tolerance,
      );

      if (row) {
        row.words.push(word);
        row.y =
          row.words.reduce((sum, item) => sum + item.y + item.height / 2, 0) /
          row.words.length;
      } else {
        rows.push({ words: [word], y: centerY });
      }
    }

    return rows
      .map((row) => ({
        ...row,
        words: row.words.sort((left, right) => left.x - right.x),
      }))
      .sort((left, right) => left.y - right.y);
  }

  private wordsByPage(words: VisionWord[]) {
    const pageNumbers = uniqueNumbers(words.map((word) => word.pageNumber));

    return pageNumbers.map((pageNumber) =>
      words.filter((word) => word.pageNumber === pageNumber),
    );
  }

  private nearestColumnIndex(word: VisionWord, columns: VisionColumn[]) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    columns.forEach((column, index) => {
      const distance = Math.abs(this.centerX(word) - column.x);

      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });

    return bestDistance <= this.columnDistanceLimit(bestIndex, columns)
      ? bestIndex
      : null;
  }

  private columnDistanceLimit(index: number, columns: VisionColumn[]) {
    return this.columnDistanceLimitForX(columns[index]?.x ?? 0, columns);
  }

  private columnDistanceLimitForX(x: number, columns: VisionColumn[]) {
    const gaps = columns
      .map((column) => Math.abs(column.x - x))
      .filter((gap) => gap > 0)
      .sort((left, right) => left - right);

    if (gaps.length === 0) {
      return 80;
    }

    return Math.min(160, Math.max(36, gaps[0] * 0.8));
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

  private averageWordConfidence(words: VisionWord[]) {
    if (words.length === 0) {
      return 0;
    }

    return words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
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

  private dataFromValues(values: OcrExtractedCell[]) {
    return Object.fromEntries(
      values.map((value) => [value.field.key, value.normalizedValue]),
    ) as Record<string, OcrCellValue>;
  }

  private wordsToText(words: VisionWord[]) {
    return cleanOcrText(
      [...words]
        .sort((left, right) => left.y - right.y || left.x - right.x)
        .map((word) => word.text)
        .join(" "),
    );
  }

  private wordsBoundingBox(words: VisionWord[]) {
    if (words.length === 0) {
      return null;
    }

    const xs = words.flatMap((word) => [word.x, word.x + word.width]);
    const ys = words.flatMap((word) => [word.y, word.y + word.height]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);

    return {
      pageNumber: words[0].pageNumber,
      x: Number(left.toFixed(4)),
      y: Number(top.toFixed(4)),
      width: Number((right - left).toFixed(4)),
      height: Number((bottom - top).toFixed(4)),
      boxes: words.map((word) => word.boundingBox).filter(Boolean),
    } satisfies Prisma.InputJsonObject;
  }

  private centerX(word: VisionWord) {
    return word.x + word.width / 2;
  }

  private centerXSpan(words: VisionWord[]) {
    const xs = words.flatMap((word) => [word.x, word.x + word.width]);

    return (Math.min(...xs) + Math.max(...xs)) / 2;
  }

  private rowTolerance(words: VisionWord[]) {
    return Math.max(8, this.median(words.map((word) => word.height)) * 0.75);
  }

  private medianWordWidth(words: VisionWord[]) {
    return this.median(words.map((word) => word.width));
  }

  private median(values: number[]) {
    const sorted = values
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);

    if (sorted.length === 0) {
      return 16;
    }

    return sorted[Math.floor(sorted.length / 2)];
  }

  private fallbackColumnXs(fieldCount: number, headerWords: VisionWord[]) {
    const centers = headerWords
      .map((word) => this.centerX(word))
      .sort((left, right) => left - right);

    if (centers.length >= fieldCount) {
      return Array.from({ length: fieldCount }, (_item, index) => {
        const headerIndex =
          fieldCount === 1
            ? 0
            : Math.round((index * (centers.length - 1)) / (fieldCount - 1));

        return centers[headerIndex];
      });
    }

    return centers;
  }

  private inferFieldType(sampleValues: string[]): OcrSuggestedFieldType {
    const uniqueValues = new Set(sampleValues.map((value) => value.toLowerCase()));

    if (sampleValues.every((value) => /^-?\d+(\.\d)?$/.test(value))) {
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

  private toTitleLabel(value: string) {
    return cleanOcrText(value)
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private toRawOcrJson(
    input: OcrExtractionInput,
    response: GoogleVisionBatchResponse,
    words: VisionWord[],
    rows: OcrExtractedRow[],
  ) {
    return {
      provider: this.name,
      document: {
        id: input.document.id ?? null,
        fileName: input.document.fileName,
        fileType: input.document.fileType,
        fileUrl: input.document.fileUrl,
      },
      options: input.options ?? {},
      request: {
        endpoint:
          process.env.GOOGLE_VISION_ENDPOINT?.trim() ?? DEFAULT_ENDPOINT,
        featureType: this.featureType(),
        model: process.env.GOOGLE_VISION_MODEL?.trim() ?? null,
        hasLanguageHints: Boolean(
          process.env.GOOGLE_VISION_LANGUAGE_HINTS?.trim(),
        ),
      },
      words: words.slice(0, 300).map((word) => ({
        text: word.text,
        pageNumber: word.pageNumber,
        confidence: word.confidence,
        boundingBox: word.boundingBox,
      })),
      rows: rows.map((row) => row.data),
      response: toJsonValue(response),
    } satisfies Prisma.InputJsonObject;
  }

  private errorDetail(bodyText: string) {
    return bodyText ? ` ${bodyText.slice(0, 300)}` : "";
  }
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function confidenceNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(clampConfidence(value).toFixed(2))
    : undefined;
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function pageNumberFromBox(value: Prisma.InputJsonObject | null | undefined) {
  const pageNumber = value?.pageNumber;

  return typeof pageNumber === "number" ? pageNumber : undefined;
}

function boxFromPoly(
  value: unknown,
  {
    pageNumber,
    pageWidth,
    pageHeight,
  }: {
    pageNumber: number;
    pageWidth?: number | null;
    pageHeight?: number | null;
  },
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const vertices = Array.isArray(value.normalizedVertices)
    ? value.normalizedVertices
    : Array.isArray(value.vertices)
      ? value.vertices
      : [];
  const normalized = Array.isArray(value.normalizedVertices);
  const points = vertices
    .filter(isPlainObject)
    .map((point) => ({
      x: typeof point.x === "number" ? point.x : 0,
      y: typeof point.y === "number" ? point.y : 0,
    }));

  if (points.length === 0) {
    return null;
  }

  const scaledPoints =
    normalized && pageWidth && pageHeight
      ? points.map((point) => ({
          x: point.x * pageWidth,
          y: point.y * pageHeight,
        }))
      : points;
  const xs = scaledPoints.map((point) => point.x);
  const ys = scaledPoints.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const json = {
    pageNumber,
    x: Number(left.toFixed(4)),
    y: Number(top.toFixed(4)),
    width: Number((right - left).toFixed(4)),
    height: Number((bottom - top).toFixed(4)),
    normalized,
    polygon: toJsonValue(vertices),
  } satisfies Prisma.InputJsonObject;

  return {
    x: json.x,
    y: json.y,
    width: json.width,
    height: json.height,
    json,
  };
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
