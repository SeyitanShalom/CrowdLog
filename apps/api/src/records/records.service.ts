import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AttendanceDocumentStatus,
  AttendanceRecordStatus,
  Prisma,
  type AttendanceDocument,
  type TemplateField,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  OCR_PROVIDER,
  type OcrExtractedRow,
  type OcrExtractionOptions,
  type OcrExtractionResult,
  type OcrProvider,
} from "../ocr/ocr-provider.interface";
import {
  PdfPageRenderer,
  type RenderedPdfPage,
} from "../ocr/pdf-page-renderer";
import { PrismaService } from "../prisma/prisma.service";
import {
  type CreateAttendanceRecordInputDto,
  type CreateAttendanceRecordsDto,
} from "./dto/create-attendance-records.dto";
import type { MockExtractDto } from "./dto/mock-extract.dto";
import type { UpdateAttendanceRecordDto } from "./dto/update-attendance-record.dto";
import {
  getAttendanceRecordInclude,
  toAttendanceRecordResponse,
} from "./attendance-record-response.mapper";
import {
  createCsvContent,
  createXlsxWorkbook,
  toFileSlug,
} from "./record-export";
import {
  fromPrismaDocumentStatus,
  toAttendanceDocumentResponse,
} from "../documents/attendance-document-response.mapper";
import { toPrismaRecordStatus } from "./record-status.mapper";

type RecordCellValue = string | number | boolean | null;
type TemplateWithFields = {
  eventTitle: string;
  id: string;
  name: string;
  fields: TemplateField[];
};
type ExportRecordWithDocument = Prisma.AttendanceRecordGetPayload<{
  include: {
    document: true;
  };
}>;

const EXTRACTION_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 60000,
};

const EXPORT_STATUS_LABELS: Record<AttendanceRecordStatus, string> = {
  DRAFT: "Draft",
  NEEDS_REVIEW: "Needs review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

@Injectable()
export class RecordsService {
  constructor(
    @Inject(OCR_PROVIDER) private readonly ocrProvider: OcrProvider,
    private readonly prisma: PrismaService,
    private readonly pdfPageRenderer?: PdfPageRenderer,
  ) {}

  async listRecords(eventId: string, userId: string) {
    await this.getEventTemplate(eventId, userId);

    const records = await this.prisma.attendanceRecord.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "desc" }, { rowNumber: "asc" }],
      include: getAttendanceRecordInclude(),
    });

    return records.map(toAttendanceRecordResponse);
  }

  async exportRecordsCsv(eventId: string, userId: string) {
    const { template, records } = await this.getEventExportData(eventId, userId);
    const rows = this.toExportRows(template.eventTitle, template.fields, records);

    return {
      fileName: `${toFileSlug(template.eventTitle)}-attendance.csv`,
      content: createCsvContent(rows),
    };
  }

  async exportRecordsXlsx(eventId: string, userId: string) {
    const { template, records } = await this.getEventExportData(eventId, userId);
    const rows = this.toExportRows(template.eventTitle, template.fields, records);

    return {
      fileName: `${toFileSlug(template.eventTitle)}-attendance.xlsx`,
      content: createXlsxWorkbook("Attendance", rows),
    };
  }

  async createRecords(
    eventId: string,
    dto: CreateAttendanceRecordsDto,
    userId: string,
  ) {
    const template = await this.getEventTemplate(eventId, userId);

    const records = await this.prisma.$transaction(
      dto.records.map((record, index) =>
        this.prisma.attendanceRecord.create({
          data: this.toRecordCreateInput(eventId, template.fields, record, index),
          include: getAttendanceRecordInclude(),
        }),
      ),
    );

    return records.map(toAttendanceRecordResponse);
  }

  async mockExtract(eventId: string, dto: MockExtractDto, userId: string) {
    const template = await this.getEventTemplate(eventId, userId);
    const documentInput = {
      eventId,
      fileName: `${template.name} mock attendance sheet`,
      fileType: "mock/table",
      fileUrl: "mock://table-style-attendance-sheet",
    };
    const extraction = await this.ocrProvider.extract({
      document: documentInput,
      template,
      options: { rowCount: dto.rowCount, layout: dto.layout },
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
        const document = await tx.attendanceDocument.create({
          data: {
            eventId: documentInput.eventId,
            fileName: documentInput.fileName,
            fileType: documentInput.fileType,
            fileUrl: documentInput.fileUrl,
            status: AttendanceDocumentStatus.EXTRACTED,
            rawOcrJson: extraction.rawOcrJson,
          },
        });

        const records = await this.createExtractedRows(
          tx,
          eventId,
          document.id,
          extraction.rows,
        );

        return {
          document,
          records,
        };
      },
      EXTRACTION_TRANSACTION_OPTIONS,
    );

    return {
      document: {
        id: result.document.id,
        eventId: result.document.eventId,
        fileName: result.document.fileName,
        fileType: result.document.fileType,
        fileUrl: result.document.fileUrl,
        status: fromPrismaDocumentStatus(result.document.status),
        createdAt: result.document.createdAt.toISOString(),
        updatedAt: result.document.updatedAt.toISOString(),
      },
      records: result.records.map(toAttendanceRecordResponse),
      suggestedFields: extraction.suggestedFields,
    };
  }

  async mockExtractDocument(
    documentId: string,
    dto: MockExtractDto,
    userId: string,
  ) {
    return this.extractDocument(documentId, dto, userId);
  }

  async extractDocument(documentId: string, dto: MockExtractDto, userId: string) {
    const document = await this.prisma.attendanceDocument.findUnique({
      where: { id: documentId },
      include: {
        event: {
          include: { members: true },
        },
      },
    });

    if (!document) {
      throw new NotFoundException("Attendance document not found.");
    }

    this.ensureCanAccessEvent(document.event, userId);

    const template = await this.getEventTemplate(document.eventId, userId);
    const extractionOptions = await this.toExtractionOptions(document, dto);
    const extraction = await this.extractDocumentWithOptions(
      document,
      template,
      extractionOptions,
    );

    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.attendanceRecord.deleteMany({
          where: { documentId },
        });

        const updatedDocument = await tx.attendanceDocument.update({
          where: { id: documentId },
          data: {
            status: AttendanceDocumentStatus.EXTRACTED,
            rawOcrJson: extraction.rawOcrJson,
          },
          include: {
            _count: {
              select: { records: true },
            },
          },
        });

        const records = await this.createExtractedRows(
          tx,
          document.eventId,
          document.id,
          extraction.rows,
        );

        const documentWithCount = {
          ...updatedDocument,
          _count: {
            records: records.length,
          },
        };

        return {
          document: documentWithCount,
          records,
        };
      },
      EXTRACTION_TRANSACTION_OPTIONS,
    );

    return {
      document: toAttendanceDocumentResponse(result.document),
      records: result.records.map(toAttendanceRecordResponse),
      suggestedFields: extraction.suggestedFields,
    };
  }

  async updateRecord(
    recordId: string,
    dto: UpdateAttendanceRecordDto,
    userId: string,
  ) {
    const existingRecord = await this.prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        event: {
          include: { members: true },
        },
      },
    });

    if (!existingRecord) {
      throw new NotFoundException("Attendance record not found.");
    }

    this.ensureCanAccessEvent(existingRecord.event, userId);

    const template = await this.getEventTemplate(existingRecord.eventId, userId);
    const data = dto.data
      ? this.cleanDataForFields(dto.data, template.fields)
      : undefined;
    const status = dto.status ? toPrismaRecordStatus(dto.status) : undefined;

    const updatedRecord = await this.prisma.$transaction(async (tx) => {
      const record = await tx.attendanceRecord.update({
        where: { id: recordId },
        data: {
          dataJson: data ? this.toJsonObject(data) : undefined,
          confidenceScore: data ? 1 : undefined,
          status,
          ...(status ? this.toReviewAttribution(status, userId) : {}),
        },
        include: getAttendanceRecordInclude(),
      });

      if (!data) {
        return record;
      }

      await Promise.all(
        template.fields.map((field) => {
          const value = data[field.key] ?? null;

          return tx.attendanceRecordValue.upsert({
            where: {
              recordId_fieldId: {
                recordId,
                fieldId: field.id,
              },
            },
            update: {
              rawValue: this.stringifyValue(value),
              normalizedValue: this.stringifyValue(value),
              confidence: 1,
              validationIssues: [],
            },
            create: {
              recordId,
              fieldId: field.id,
              rawValue: this.stringifyValue(value),
              normalizedValue: this.stringifyValue(value),
              confidence: 1,
              validationIssues: [],
            },
          });
        }),
      );

      return tx.attendanceRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: getAttendanceRecordInclude(),
      });
    });

    return toAttendanceRecordResponse(updatedRecord);
  }

  async approveRecord(recordId: string, userId: string) {
    return this.updateStatus(recordId, AttendanceRecordStatus.APPROVED, userId);
  }

  async rejectRecord(recordId: string, userId: string) {
    return this.updateStatus(recordId, AttendanceRecordStatus.REJECTED, userId);
  }

  private async updateStatus(
    recordId: string,
    status: AttendanceRecordStatus,
    userId: string,
  ) {
    const existingRecord = await this.prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        event: {
          include: { members: true },
        },
      },
    });

    if (!existingRecord) {
      throw new NotFoundException("Attendance record not found.");
    }

    this.ensureCanAccessEvent(existingRecord.event, userId);

    const record = await this.prisma.attendanceRecord.update({
      where: { id: recordId },
      data: {
        status,
        ...this.toReviewAttribution(status, userId),
      },
      include: getAttendanceRecordInclude(),
    });

    return toAttendanceRecordResponse(record);
  }

  private toReviewAttribution(
    status: AttendanceRecordStatus,
    userId: string,
  ): Prisma.AttendanceRecordUpdateInput {
    if (
      status === AttendanceRecordStatus.APPROVED ||
      status === AttendanceRecordStatus.REJECTED
    ) {
      return {
        reviewedBy: { connect: { id: userId } },
        reviewedAt: new Date(),
      };
    }

    return {
      reviewedBy: { disconnect: true },
      reviewedAt: null,
    };
  }

  private async getEventTemplate(
    eventId: string,
    userId: string,
  ): Promise<TemplateWithFields> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        members: true,
        templates: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          include: {
            fields: {
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanAccessEvent(event, userId);

    const template = event.templates[0];

    if (!template) {
      throw new NotFoundException("Event does not have an attendance template.");
    }

    return {
      eventTitle: event.title,
      id: template.id,
      name: template.name,
      fields: template.fields,
    };
  }

  private async getEventExportData(eventId: string, userId: string) {
    const template = await this.getEventTemplate(eventId, userId);

    const records = await this.prisma.attendanceRecord.findMany({
      where: { eventId },
      orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
      include: {
        document: true,
      },
    });

    return {
      template,
      records,
    };
  }

  private ensureCanAccessEvent(
    event: { ownerId: string | null; members: Array<{ userId: string }> },
    userId: string,
  ) {
    if (
      event.ownerId === userId ||
      event.members.some((member) => member.userId === userId)
    ) {
      return;
    }

    throw new NotFoundException("Event not found.");
  }

  private toRecordCreateInput(
    eventId: string,
    fields: TemplateField[],
    record: CreateAttendanceRecordInputDto,
    index: number,
  ): Prisma.AttendanceRecordCreateInput {
    const data = this.cleanDataForFields(record.data, fields);
    const confidenceScore = record.confidenceScore ?? 1;

    return {
      event: { connect: { id: eventId } },
      rowNumber: record.rowNumber ?? index + 1,
      dataJson: this.toJsonObject(data),
      confidenceScore,
      status: record.status
        ? toPrismaRecordStatus(record.status)
        : confidenceScore < 0.75
          ? AttendanceRecordStatus.NEEDS_REVIEW
          : AttendanceRecordStatus.DRAFT,
      values: {
        create: fields.map((field) => {
          const value = data[field.key] ?? null;

          return {
            field: { connect: { id: field.id } },
            rawValue: this.stringifyValue(value),
            normalizedValue: this.stringifyValue(value),
            confidence: confidenceScore,
            validationIssues: [],
          };
        }),
      },
    };
  }

  private async createExtractedRows(
    tx: Prisma.TransactionClient,
    eventId: string,
    documentId: string,
    rows: OcrExtractedRow[],
  ) {
    const recordRows = rows.map((row) => ({
      id: randomUUID(),
      eventId,
      documentId,
      row,
    }));

    await tx.attendanceRecord.createMany({
      data: recordRows.map(({ id, row }) =>
        this.toExtractedRecordCreateManyInput(eventId, documentId, id, row),
      ),
    });

    await tx.attendanceRecordValue.createMany({
      data: recordRows.flatMap(({ id, row }) =>
        row.values.map((value) => ({
          recordId: id,
          fieldId: value.field.id,
          rawValue: this.stringifyValue(value.rawValue),
          normalizedValue: this.stringifyValue(value.normalizedValue),
          confidence: value.confidence,
          validationIssues: value.issues ?? [],
          boundingBox: value.boundingBox ?? undefined,
        })),
      ),
    });

    return tx.attendanceRecord.findMany({
      where: {
        id: {
          in: recordRows.map((record) => record.id),
        },
      },
      orderBy: { rowNumber: "asc" },
      include: getAttendanceRecordInclude(),
    });
  }

  private toExtractedRecordCreateManyInput(
    eventId: string,
    documentId: string,
    recordId: string,
    row: OcrExtractedRow,
  ): Prisma.AttendanceRecordCreateManyInput {
    return {
      id: recordId,
      eventId,
      documentId,
      rowNumber: row.rowNumber,
      dataJson: this.toJsonObject(row.data),
      confidenceScore: row.confidenceScore,
      status:
        row.confidenceScore < 0.75
          ? AttendanceRecordStatus.NEEDS_REVIEW
          : AttendanceRecordStatus.DRAFT,
    };
  }

  private cleanDataForFields(
    data: Record<string, unknown>,
    fields: TemplateField[],
  ) {
    const result: Record<string, RecordCellValue> = {};

    for (const field of fields) {
      result[field.key] = this.toRecordCellValue(data[field.key]);
    }

    return result;
  }

  private toRecordCellValue(value: unknown): RecordCellValue {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      return value;
    }

    return "";
  }

  private toJsonObject(data: Record<string, RecordCellValue>) {
    return data as Prisma.InputJsonObject;
  }

  private stringifyValue(value: RecordCellValue) {
    if (value === null) {
      return null;
    }

    return String(value);
  }

  private toUploadedFilePath(fileUrl: string) {
    if (!fileUrl.startsWith("/uploads/")) {
      return undefined;
    }

    const fileName = fileUrl.replace("/uploads/", "");

    if (fileName !== basename(fileName)) {
      return undefined;
    }

    return resolve(process.cwd(), "uploads", fileName);
  }

  private async toExtractionOptions(
    document: Pick<AttendanceDocument, "fileType" | "fileUrl">,
    dto: MockExtractDto,
  ): Promise<OcrExtractionOptions> {
    const options: OcrExtractionOptions = {
      rowCount: dto.rowCount,
      layout: dto.layout,
    };

    if (document.fileType !== "application/pdf") {
      return options;
    }

    const totalPages = await this.detectPdfPageCount(
      this.toUploadedFilePath(document.fileUrl),
    );
    const pageStart = Math.min(dto.pageStart ?? 1, totalPages);
    const requestedPageCount = dto.pageCount ?? 1;
    const pageCount = Math.min(
      requestedPageCount,
      Math.max(1, totalPages - pageStart + 1),
    );

    return {
      ...options,
      pageStart,
      pageCount,
      totalPages,
    };
  }

  private async detectPdfPageCount(filePath: string | undefined) {
    if (!filePath) {
      return 1;
    }

    try {
      const content = await readFile(filePath, "latin1");
      const pageMatches = content.match(/\/Type\s*\/Page\b/g);

      return Math.max(1, pageMatches?.length ?? 1);
    } catch {
      return 1;
    }
  }

  private async extractDocumentWithOptions(
    document: AttendanceDocument,
    template: TemplateWithFields,
    options: OcrExtractionOptions,
  ): Promise<OcrExtractionResult> {
    const documentInput = {
      id: document.id,
      eventId: document.eventId,
      fileName: document.fileName,
      fileType: document.fileType,
      fileUrl: document.fileUrl,
      filePath: this.toUploadedFilePath(document.fileUrl),
    };

    if (document.fileType !== "application/pdf" || !this.pdfPageRenderer) {
      return this.ocrProvider.extract({
        document: documentInput,
        template,
        options,
      });
    }

    const renderResult = await this.pdfPageRenderer.renderPages({
      filePath: documentInput.filePath,
      fileName: document.fileName,
      pageStart: options.pageStart ?? 1,
      pageCount: options.pageCount ?? 1,
    });

    if (!renderResult.rendered) {
      return this.ocrProvider.extract({
        document: documentInput,
        template,
        options,
      });
    }

    try {
      return await this.extractRenderedPdfPages(
        document,
        template,
        options,
        renderResult.pages,
      );
    } finally {
      await this.pdfPageRenderer.cleanupRenderedPages(renderResult.pages);
    }
  }

  private async extractRenderedPdfPages(
    document: AttendanceDocument,
    template: TemplateWithFields,
    options: OcrExtractionOptions,
    pages: RenderedPdfPage[],
  ): Promise<OcrExtractionResult> {
    const pageResults = await Promise.all(
      pages.map((page) =>
        this.ocrProvider.extract({
          document: {
            id: document.id,
            eventId: document.eventId,
            fileName: page.fileName,
            fileType: page.fileType,
            fileUrl: `rendered-pdf://${document.id}/${page.pageNumber}`,
            filePath: page.filePath,
          },
          template,
          options: {
            rowCount: options.rowCount,
            layout: options.layout,
            pageStart: page.pageNumber,
            pageCount: 1,
            totalPages: options.totalPages,
          },
        }),
      ),
    );
    const rows = pageResults.flatMap((result, resultIndex) =>
      result.rows.map((row) => ({
        ...row,
        sourcePage: row.sourcePage ?? pages[resultIndex].pageNumber,
      })),
    );

    return {
      providerName: "pdf-page-renderer",
      rawOcrJson: {
        provider: "pdf-page-renderer",
        renderer: "pdftoppm",
        document: {
          id: document.id,
          fileName: document.fileName,
          fileType: document.fileType,
          fileUrl: document.fileUrl,
        },
        pages: {
          start: options.pageStart ?? 1,
          count: pages.length,
          total: options.totalPages ?? pages.length,
        },
        layout: options.layout ?? "table",
        pageResults: pageResults.map((result, index) => ({
          page: pages[index].pageNumber,
          provider: result.providerName,
          rawOcrJson: result.rawOcrJson,
        })),
      } as Prisma.InputJsonObject,
      rows: rows.map((row, index) => ({
        ...row,
        rowNumber: index + 1,
      })),
      suggestedFields: this.dedupeSuggestedFields(
        pageResults.flatMap((result) => result.suggestedFields),
      ),
    };
  }

  private dedupeSuggestedFields(
    suggestedFields: OcrExtractionResult["suggestedFields"],
  ) {
    const seenKeys = new Set<string>();

    return suggestedFields.filter((suggestion) => {
      if (seenKeys.has(suggestion.key)) {
        return false;
      }

      seenKeys.add(suggestion.key);
      return true;
    });
  }

  private toExportRows(
    eventTitle: string,
    fields: TemplateField[],
    records: ExportRecordWithDocument[],
  ) {
    const headers = [
      "Event",
      "Row",
      "Status",
      "Confidence",
      "Document",
      ...fields.map((field) => field.label),
    ];
    const rows = records.map((record) => {
      const data = this.jsonRecord(record.dataJson);

      return [
        eventTitle,
        String(record.rowNumber ?? ""),
        EXPORT_STATUS_LABELS[record.status],
        this.confidenceLabel(record.confidenceScore),
        record.document?.fileName ?? "",
        ...fields.map((field) => this.valueToString(data[field.key])),
      ];
    });

    return [headers, ...rows];
  }

  private jsonRecord(value: Prisma.JsonValue) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const result: Record<string, RecordCellValue> = {};

    for (const [key, item] of Object.entries(value)) {
      if (
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean" ||
        item === null
      ) {
        result[key] = item;
      }
    }

    return result;
  }

  private valueToString(value: RecordCellValue | undefined) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }

  private confidenceLabel(confidence: number | null | undefined) {
    if (confidence === null || confidence === undefined) {
      return "n/a";
    }

    return `${Math.round(confidence * 100)}%`;
  }

}
