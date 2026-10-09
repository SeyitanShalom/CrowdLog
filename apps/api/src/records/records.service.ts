import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AttendanceDocumentStatus,
  AttendanceRecordStatus,
  EventMemberRole as PrismaEventMemberRole,
  Prisma,
  type AttendanceDocument,
  type TemplateField,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import { UploadStorageService } from "../storage/upload-storage.service";
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
type PdfRenderMode = "auto" | "render-pages" | "full-document";
type ExportRecordWithDocument = Prisma.AttendanceRecordGetPayload<{
  include: {
    document: true;
  };
}>;
type AnalyticsRecord = Prisma.AttendanceRecordGetPayload<{
  include: {
    document: true;
    reviewedBy: {
      select: {
        id: true;
        email: true;
        name: true;
      };
    };
    values: {
      include: {
        field: true;
      };
    };
  };
}>;
type ApiFieldType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "signature"
  | "date"
  | "select"
  | "multi_select";
type ApiEventMemberRole = "owner" | "reviewer";
type AnalyticsStatusCounts = {
  total: number;
  reviewed: number;
  approved: number;
  rejected: number;
  needsReview: number;
  draft: number;
};
type EventRecordAnalyticsResponse = {
  eventId: string;
  generatedAt: string;
  summary: AnalyticsStatusCounts & {
    reviewRate: number;
    approvalRate: number;
    rejectionRate: number;
    averageConfidence: number | null;
    lowConfidenceRecords: number;
    validationIssueCells: number;
  };
  documents: Array<
    AnalyticsStatusCounts & {
      id: string;
      name: string;
      status: string;
      reviewRate: number;
      averageConfidence: number | null;
      validationIssueCells: number;
      lastActivityAt: string | null;
    }
  >;
  reviewers: Array<{
    userId: string;
    email: string;
    name: string | null;
    role: ApiEventMemberRole;
    reviewed: number;
    approved: number;
    rejected: number;
    shareOfReviewed: number;
    lastReviewedAt: string | null;
  }>;
  fields: Array<{
    fieldId: string;
    key: string;
    label: string;
    type: ApiFieldType;
    required: boolean;
    populatedRecords: number;
    blankRecords: number;
    issueCells: number;
    lowConfidenceCells: number;
    averageConfidence: number | null;
  }>;
  activity: Array<{
    date: string;
    createdRecords: number;
    reviewedRecords: number;
    approvedRecords: number;
    rejectedRecords: number;
  }>;
};

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
    @Optional()
    private readonly uploadStorage: UploadStorageService = new UploadStorageService(),
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

  async getRecordAnalytics(
    eventId: string,
    userId: string,
  ): Promise<EventRecordAnalyticsResponse> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        },
        templates: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          include: {
            fields: {
              orderBy: { sortOrder: "asc" },
            },
          },
        },
        documents: {
          orderBy: [{ updatedAt: "desc" }, { fileName: "asc" }],
        },
        records: {
          orderBy: [{ createdAt: "asc" }, { rowNumber: "asc" }],
          include: {
            document: true,
            reviewedBy: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
            values: {
              include: {
                field: true,
              },
            },
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanAccessEvent(event, userId);

    const fields = event.templates[0]?.fields ?? [];

    return {
      eventId,
      generatedAt: new Date().toISOString(),
      summary: this.eventAnalyticsSummary(event.records),
      documents: this.documentAnalytics(event.documents, event.records),
      reviewers: this.reviewerAnalytics(event.members, event.records),
      fields: this.fieldAnalytics(fields, event.records),
      activity: this.activityAnalytics(event.records),
    };
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
    const rows = this.toDataOnlyExportRows(template.fields, records);

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
    let localFilePath: string | undefined;
    let extractionOptions: OcrExtractionOptions = {
      rowCount: dto.rowCount,
      layout: dto.layout,
    };
    let extraction: OcrExtractionResult;

    try {
      localFilePath = await this.uploadStorage.downloadToTempFile(
        document.fileUrl,
      );
      extractionOptions = await this.toExtractionOptions(
        document,
        dto,
        localFilePath,
      );
      extraction = await this.extractDocumentWithOptions(
        document,
        template,
        extractionOptions,
        localFilePath,
      );
    } catch (error) {
      await this.recordExtractionFailure(document, extractionOptions, error);
      throw new ServiceUnavailableException(
        `Could not extract selected file. ${this.sanitizedErrorMessage(error)}`,
      );
    } finally {
      await this.uploadStorage.cleanupTempFile(localFilePath);
    }

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

  private eventAnalyticsSummary(records: AnalyticsRecord[]) {
    const counts = this.recordStatusCounts(records);
    const confidenceValues = records
      .map((record) => record.confidenceScore)
      .filter((value): value is number => typeof value === "number");
    const validationIssueCells = records.reduce(
      (total, record) =>
        total +
        record.values.filter(
          (value) => this.jsonStringArray(value.validationIssues).length > 0,
        ).length,
      0,
    );

    return {
      ...counts,
      reviewRate: this.rate(counts.reviewed, counts.total),
      approvalRate: this.rate(counts.approved, counts.total),
      rejectionRate: this.rate(counts.rejected, counts.total),
      averageConfidence: this.average(confidenceValues),
      lowConfidenceRecords: records.filter(
        (record) =>
          typeof record.confidenceScore === "number" &&
          record.confidenceScore < 0.75,
      ).length,
      validationIssueCells,
    };
  }

  private documentAnalytics(
    documents: Array<{
      id: string;
      fileName: string;
      status: AttendanceDocumentStatus;
      createdAt: Date;
      updatedAt: Date;
    }>,
    records: AnalyticsRecord[],
  ): EventRecordAnalyticsResponse["documents"] {
    const reports = new Map<
      string,
      EventRecordAnalyticsResponse["documents"][number]
    >();

    for (const document of documents) {
      reports.set(document.id, {
        id: document.id,
        name: document.fileName,
        status: fromPrismaDocumentStatus(document.status),
        ...this.emptyStatusCounts(),
        reviewRate: 0,
        averageConfidence: null,
        validationIssueCells: 0,
        lastActivityAt: this.isoDate(document.updatedAt ?? document.createdAt),
      });
    }

    for (const record of records) {
      const documentId = record.documentId ?? "manual";
      const report =
        reports.get(documentId) ??
        {
          id: documentId,
          name: record.document?.fileName ?? "Manual rows",
          status: record.document
            ? fromPrismaDocumentStatus(record.document.status)
            : "manual",
          ...this.emptyStatusCounts(),
          reviewRate: 0,
          averageConfidence: null,
          validationIssueCells: 0,
          lastActivityAt: null,
        };

      this.incrementStatusCounts(report, record.status);
      report.averageConfidence = this.runningAverage(
        report.averageConfidence,
        report.total - 1,
        record.confidenceScore,
      );
      report.validationIssueCells += record.values.filter(
        (value) => this.jsonStringArray(value.validationIssues).length > 0,
      ).length;
      report.lastActivityAt = this.latestIsoDate(
        report.lastActivityAt,
        record.updatedAt,
      );
      report.reviewRate = this.rate(report.reviewed, report.total);
      reports.set(documentId, report);
    }

    return Array.from(reports.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  private reviewerAnalytics(
    members: Array<{
      userId: string;
      role: PrismaEventMemberRole;
      user: { email: string; name: string | null };
    }>,
    records: AnalyticsRecord[],
  ): EventRecordAnalyticsResponse["reviewers"] {
    const reviewedRecords = records.filter(
      (record) =>
        record.status === AttendanceRecordStatus.APPROVED ||
        record.status === AttendanceRecordStatus.REJECTED,
    );
    const reports = new Map<
      string,
      EventRecordAnalyticsResponse["reviewers"][number]
    >();
    const unattributed: EventRecordAnalyticsResponse["reviewers"][number] = {
      userId: "unattributed",
      email: "Rows reviewed before reviewer tracking",
      name: "Unattributed",
      role: "reviewer",
      reviewed: 0,
      approved: 0,
      rejected: 0,
      shareOfReviewed: 0,
      lastReviewedAt: null,
    };

    for (const member of members) {
      reports.set(member.userId, {
        userId: member.userId,
        email: member.user.email,
        name: member.user.name,
        role: this.fromPrismaEventMemberRole(member.role),
        reviewed: 0,
        approved: 0,
        rejected: 0,
        shareOfReviewed: 0,
        lastReviewedAt: null,
      });
    }

    for (const record of reviewedRecords) {
      const report = record.reviewedByUserId
        ? reports.get(record.reviewedByUserId)
        : unattributed;

      if (!report) {
        continue;
      }

      report.reviewed += 1;
      report.approved += record.status === AttendanceRecordStatus.APPROVED ? 1 : 0;
      report.rejected += record.status === AttendanceRecordStatus.REJECTED ? 1 : 0;
      report.lastReviewedAt = this.latestIsoDate(
        report.lastReviewedAt,
        record.reviewedAt ?? record.updatedAt,
      );
    }

    const result =
      unattributed.reviewed > 0
        ? [...reports.values(), unattributed]
        : Array.from(reports.values());

    return result.map((report) => ({
      ...report,
      shareOfReviewed: this.rate(report.reviewed, reviewedRecords.length),
    }));
  }

  private fieldAnalytics(
    fields: TemplateField[],
    records: AnalyticsRecord[],
  ): EventRecordAnalyticsResponse["fields"] {
    return fields.map((field) => {
      const cells = records.flatMap((record) =>
        record.values.filter((value) => value.fieldId === field.id),
      );
      const confidenceValues = cells
        .map((cell) => cell.confidence)
        .filter((value): value is number => typeof value === "number");
      const populatedRecords = records.filter((record) =>
        this.hasRecordValue(this.jsonRecord(record.dataJson)[field.key]),
      ).length;

      return {
        fieldId: field.id,
        key: field.key,
        label: field.label,
        type: this.fromPrismaFieldType(field.type),
        required: field.required,
        populatedRecords,
        blankRecords: Math.max(0, records.length - populatedRecords),
        issueCells: cells.filter(
          (cell) => this.jsonStringArray(cell.validationIssues).length > 0,
        ).length,
        lowConfidenceCells: cells.filter(
          (cell) => typeof cell.confidence === "number" && cell.confidence < 0.75,
        ).length,
        averageConfidence: this.average(confidenceValues),
      };
    });
  }

  private activityAnalytics(
    records: AnalyticsRecord[],
  ): EventRecordAnalyticsResponse["activity"] {
    const buckets = new Map<
      string,
      EventRecordAnalyticsResponse["activity"][number]
    >();
    const bucketFor = (date: Date) => {
      const key = date.toISOString().slice(0, 10);
      const existing = buckets.get(key);

      if (existing) {
        return existing;
      }

      const bucket = {
        date: key,
        createdRecords: 0,
        reviewedRecords: 0,
        approvedRecords: 0,
        rejectedRecords: 0,
      };

      buckets.set(key, bucket);
      return bucket;
    };

    for (const record of records) {
      bucketFor(record.createdAt).createdRecords += 1;

      if (
        record.status !== AttendanceRecordStatus.APPROVED &&
        record.status !== AttendanceRecordStatus.REJECTED
      ) {
        continue;
      }

      const reviewedBucket = bucketFor(record.reviewedAt ?? record.updatedAt);

      reviewedBucket.reviewedRecords += 1;
      reviewedBucket.approvedRecords +=
        record.status === AttendanceRecordStatus.APPROVED ? 1 : 0;
      reviewedBucket.rejectedRecords +=
        record.status === AttendanceRecordStatus.REJECTED ? 1 : 0;
    }

    return Array.from(buckets.values()).sort((left, right) =>
      left.date.localeCompare(right.date),
    );
  }

  private recordStatusCounts(records: AnalyticsRecord[]) {
    const counts = this.emptyStatusCounts();

    for (const record of records) {
      this.incrementStatusCounts(counts, record.status);
    }

    return counts;
  }

  private emptyStatusCounts() {
    return {
      total: 0,
      reviewed: 0,
      approved: 0,
      rejected: 0,
      needsReview: 0,
      draft: 0,
    };
  }

  private incrementStatusCounts(
    counts: ReturnType<RecordsService["emptyStatusCounts"]>,
    status: AttendanceRecordStatus,
  ) {
    counts.total += 1;

    if (status === AttendanceRecordStatus.APPROVED) {
      counts.reviewed += 1;
      counts.approved += 1;
    } else if (status === AttendanceRecordStatus.REJECTED) {
      counts.reviewed += 1;
      counts.rejected += 1;
    } else if (status === AttendanceRecordStatus.NEEDS_REVIEW) {
      counts.needsReview += 1;
    } else {
      counts.draft += 1;
    }
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

  private async toExtractionOptions(
    document: Pick<AttendanceDocument, "fileType">,
    dto: MockExtractDto,
    filePath: string | undefined,
  ): Promise<OcrExtractionOptions> {
    const options: OcrExtractionOptions = {
      rowCount: dto.rowCount,
      layout: dto.layout,
    };

    if (document.fileType !== "application/pdf") {
      return options;
    }

    const totalPages = await this.detectPdfPageCount(filePath);
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
    filePath: string | undefined,
  ): Promise<OcrExtractionResult> {
    const documentInput = {
      id: document.id,
      eventId: document.eventId,
      fileName: document.fileName,
      fileType: document.fileType,
      fileUrl: document.fileUrl,
      filePath,
    };

    if (document.fileType !== "application/pdf") {
      return this.ocrProvider.extract({
        document: documentInput,
        template,
        options,
      });
    }

    const renderMode = this.pdfRenderMode();

    if (renderMode === "full-document") {
      return this.extractFullPdfDocument(
        documentInput,
        template,
        options,
        "OCR_PDF_RENDER_MODE is set to full-document.",
        renderMode,
      );
    }

    if (
      renderMode === "auto" &&
      this.canProviderReadPdfDirectly(documentInput, template, options)
    ) {
      return this.extractFullPdfDocument(
        documentInput,
        template,
        options,
        "Configured OCR provider can read PDF documents directly.",
        renderMode,
      );
    }

    if (!this.pdfPageRenderer) {
      return this.extractFullPdfDocument(
        documentInput,
        template,
        options,
        "No PDF page renderer is registered.",
        renderMode,
      );
    }

    const availability = await this.pdfRendererAvailability();

    if (!availability.available) {
      return this.extractFullPdfDocument(
        documentInput,
        template,
        options,
        availability.reason ?? "PDF renderer is not available.",
        renderMode,
      );
    }

    const renderResult = await this.pdfPageRenderer.renderPages({
      filePath: documentInput.filePath,
      fileName: document.fileName,
      pageStart: options.pageStart ?? 1,
      pageCount: options.pageCount ?? 1,
    });

    if (!renderResult.rendered) {
      return this.extractFullPdfDocument(
        documentInput,
        template,
        options,
        renderResult.reason,
        renderMode,
      );
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

  private async extractFullPdfDocument(
    document: {
      id: string;
      eventId: string;
      fileName: string;
      fileType: string | null;
      fileUrl: string;
      filePath: string | undefined;
    },
    template: TemplateWithFields,
    options: OcrExtractionOptions,
    reason: string,
    renderMode: PdfRenderMode,
  ): Promise<OcrExtractionResult> {
    let result: OcrExtractionResult;

    try {
      result = await this.ocrProvider.extract({
        document,
        template,
        options,
      });
    } catch (error) {
      throw this.fullPdfExtractionError(
        document,
        options,
        reason,
        renderMode,
        error,
      );
    }

    return {
      ...result,
      rawOcrJson: {
        provider: "pdf-full-document",
        document: {
          id: document.id,
          fileName: document.fileName,
          fileType: document.fileType,
          fileUrl: document.fileUrl,
        },
        pages: {
          start: options.pageStart ?? 1,
          count: options.pageCount ?? 1,
          total: options.totalPages ?? options.pageCount ?? 1,
        },
        layout: options.layout ?? "table",
        pdfHandling: {
          renderMode,
          renderer: "pdftoppm",
          renderedPages: false,
          reason,
          directProvider: result.providerName,
        },
        providerResult: {
          provider: result.providerName,
          rawOcrJson: result.rawOcrJson,
        },
      } as Prisma.InputJsonObject,
    };
  }

  private async recordExtractionFailure(
    document: Pick<
      AttendanceDocument,
      "id" | "fileName" | "fileType" | "fileUrl"
    >,
    options: OcrExtractionOptions,
    error: unknown,
  ) {
    await this.prisma.attendanceDocument
      .update({
        where: { id: document.id },
        data: {
          status: AttendanceDocumentStatus.FAILED,
          rawOcrJson: this.extractionFailureRawOcrJson(document, options, error),
        },
      })
      .catch(() => {
        // Keep the original extraction failure as the visible error.
      });
  }

  private extractionFailureRawOcrJson(
    document: Pick<
      AttendanceDocument,
      "id" | "fileName" | "fileType" | "fileUrl"
    >,
    options: OcrExtractionOptions,
    error: unknown,
  ) {
    const isPdf = document.fileType === "application/pdf";

    return {
      provider: "extraction-failure",
      document: {
        id: document.id,
        fileName: document.fileName,
        fileType: document.fileType,
        fileUrl: document.fileUrl,
      },
      options: {
        rowCount: options.rowCount ?? null,
        layout: options.layout ?? "table",
        pageStart: options.pageStart ?? null,
        pageCount: options.pageCount ?? null,
        totalPages: options.totalPages ?? null,
      },
      ...(isPdf
        ? {
            pages: {
              start: options.pageStart ?? 1,
              count: options.pageCount ?? 1,
              total: options.totalPages ?? options.pageCount ?? 1,
            },
          }
        : {}),
      error: this.errorDiagnostic(error),
    } as Prisma.InputJsonObject;
  }

  private fullPdfExtractionError(
    document: {
      fileName: string;
    },
    options: OcrExtractionOptions,
    reason: string,
    renderMode: PdfRenderMode,
    error: unknown,
  ) {
    const pageStart = options.pageStart ?? 1;
    const pageCount = options.pageCount ?? 1;
    const pageEnd = pageStart + pageCount - 1;
    const message = [
      `Full-document PDF OCR failed for "${document.fileName}"`,
      `provider "${this.ocrProvider.name}"`,
      `render mode "${renderMode}"`,
      `pages ${pageStart}-${pageEnd}`,
      `reason: ${reason}`,
      `provider error: ${this.sanitizedErrorMessage(error)}`,
    ].join("; ");

    return new Error(message, { cause: error });
  }

  private errorDiagnostic(
    error: unknown,
    depth = 0,
  ): Prisma.InputJsonObject {
    const diagnostic: Record<string, Prisma.InputJsonValue> = {
      name: error instanceof Error ? error.name : typeof error,
      message: this.sanitizedErrorMessage(error),
    };
    const cause = error instanceof Error ? error.cause : undefined;

    if (cause && depth < 2) {
      diagnostic.cause = this.errorDiagnostic(cause, depth + 1);
    }

    return diagnostic as Prisma.InputJsonObject;
  }

  private sanitizedErrorMessage(error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown extraction error.";

    return this.redactSensitiveText(message.replace(/\s+/g, " ").trim()).slice(
      0,
      600,
    );
  }

  private redactSensitiveText(value: string) {
    return value
      .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
      .replace(
        /(ocp-apim-subscription-key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
        "$1[redacted]",
      )
      .replace(
        /((?:api[_-]?key|subscription[_-]?key|token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
        "$1[redacted]",
      )
      .replace(
        /((?:aws[_-]?)?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
        "$1[redacted]",
      );
  }

  private async pdfRendererAvailability() {
    const renderer = this.pdfPageRenderer as
      | (PdfPageRenderer & {
          isAvailable?: () => Promise<{ available: boolean; reason?: string }>;
        })
      | undefined;

    if (!renderer?.isAvailable) {
      return { available: true };
    }

    const result = await renderer.isAvailable();

    return result.available
      ? { available: true }
      : {
          available: false,
          reason: result.reason ?? "PDF renderer is not available.",
        };
  }

  private canProviderReadPdfDirectly(
    document: {
      id: string;
      eventId: string;
      fileName: string;
      fileType: string | null;
      fileUrl: string;
      filePath: string | undefined;
    },
    template: TemplateWithFields,
    options: OcrExtractionOptions,
  ) {
    return (
      this.ocrProvider.canReadPdfDirectly?.({
        document,
        template,
        options,
      }) ?? false
    );
  }

  private pdfRenderMode(): PdfRenderMode {
    const value = process.env.OCR_PDF_RENDER_MODE?.trim().toLowerCase();

    if (value === "render-pages" || value === "full-document") {
      return value;
    }

    return "auto";
  }

  private async extractRenderedPdfPages(
    document: AttendanceDocument,
    template: TemplateWithFields,
    options: OcrExtractionOptions,
    pages: RenderedPdfPage[],
  ): Promise<OcrExtractionResult> {
    const pageResults: OcrExtractionResult[] = [];

    for (const page of pages) {
      try {
        pageResults.push(
          await this.ocrProvider.extract({
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
        );
      } catch (error) {
        throw this.renderedPdfPageExtractionError(
          document,
          options,
          page,
          error,
        );
      }
    }

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

  private renderedPdfPageExtractionError(
    document: {
      fileName: string;
    },
    options: OcrExtractionOptions,
    page: RenderedPdfPage,
    error: unknown,
  ) {
    const pageStart = options.pageStart ?? 1;
    const pageCount = options.pageCount ?? 1;
    const pageEnd = pageStart + pageCount - 1;
    const providerName = this.ocrProvider.name ?? "unknown";
    const message = [
      `Rendered PDF page OCR failed for "${document.fileName}"`,
      `page ${page.pageNumber}`,
      `rendered file "${page.fileName}"`,
      `provider "${providerName}"`,
      `requested pages ${pageStart}-${pageEnd}`,
      `provider error: ${this.sanitizedErrorMessage(error)}`,
    ].join("; ");

    return new Error(message, { cause: error });
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

  private toDataOnlyExportRows(
    fields: TemplateField[],
    records: ExportRecordWithDocument[],
  ) {
    const headers = fields.map((field) => field.label);
    const rows = records.map((record) => {
      const data = this.jsonRecord(record.dataJson);

      return fields.map((field) => this.valueToString(data[field.key]));
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

  private jsonStringArray(value: Prisma.JsonValue) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string");
  }

  private hasRecordValue(value: RecordCellValue | undefined) {
    return value !== undefined && value !== null && value !== "" && value !== false;
  }

  private average(values: number[]) {
    if (values.length === 0) {
      return null;
    }

    return Number(
      (values.reduce((total, value) => total + value, 0) / values.length).toFixed(
        2,
      ),
    );
  }

  private runningAverage(
    currentAverage: number | null,
    previousCount: number,
    nextValue: number | null,
  ) {
    if (typeof nextValue !== "number") {
      return currentAverage;
    }

    if (currentAverage === null || previousCount === 0) {
      return Number(nextValue.toFixed(2));
    }

    return Number(
      ((currentAverage * previousCount + nextValue) / (previousCount + 1)).toFixed(
        2,
      ),
    );
  }

  private rate(part: number, total: number) {
    if (total === 0) {
      return 0;
    }

    return Math.round((part / total) * 100);
  }

  private latestIsoDate(currentValue: string | null, nextValue: Date | null) {
    if (!nextValue) {
      return currentValue;
    }

    if (!currentValue) {
      return this.isoDate(nextValue);
    }

    return nextValue.getTime() > new Date(currentValue).getTime()
      ? this.isoDate(nextValue)
      : currentValue;
  }

  private isoDate(value: Date | null | undefined) {
    return value ? value.toISOString() : null;
  }

  private fromPrismaEventMemberRole(
    role: PrismaEventMemberRole,
  ): ApiEventMemberRole {
    return role === PrismaEventMemberRole.OWNER ? "owner" : "reviewer";
  }

  private fromPrismaFieldType(type: TemplateField["type"]): ApiFieldType {
    if (type === "MULTI_SELECT") {
      return "multi_select";
    }

    return type.toLowerCase() as ApiFieldType;
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
