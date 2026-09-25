import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AttendanceDocumentStatus,
  AttendanceRecordStatus,
  Prisma,
  type TemplateField,
} from "@prisma/client";
import {
  OCR_PROVIDER,
  type OcrExtractedRow,
  type OcrProvider,
} from "../ocr/ocr-provider.interface";
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
  fromPrismaDocumentStatus,
  toAttendanceDocumentResponse,
} from "../documents/attendance-document-response.mapper";
import { toPrismaRecordStatus } from "./record-status.mapper";

type RecordCellValue = string | number | boolean | null;
type TemplateWithFields = {
  id: string;
  name: string;
  fields: TemplateField[];
};

const EXTRACTION_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 20000,
};

@Injectable()
export class RecordsService {
  constructor(
    @Inject(OCR_PROVIDER) private readonly ocrProvider: OcrProvider,
    private readonly prisma: PrismaService,
  ) {}

  async listRecords(eventId: string) {
    await this.getEventTemplate(eventId);

    const records = await this.prisma.attendanceRecord.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "desc" }, { rowNumber: "asc" }],
      include: getAttendanceRecordInclude(),
    });

    return records.map(toAttendanceRecordResponse);
  }

  async createRecords(eventId: string, dto: CreateAttendanceRecordsDto) {
    const template = await this.getEventTemplate(eventId);

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

  async mockExtract(eventId: string, dto: MockExtractDto) {
    const template = await this.getEventTemplate(eventId);
    const documentInput = {
      eventId,
      fileName: `${template.name} mock attendance sheet`,
      fileType: "mock/table",
      fileUrl: "mock://table-style-attendance-sheet",
    };
    const extraction = await this.ocrProvider.extract({
      document: documentInput,
      template,
      options: { rowCount: dto.rowCount },
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

        const records = [];

        for (const row of extraction.rows) {
          records.push(
            await tx.attendanceRecord.create({
              data: this.toExtractedRecordCreateInput(eventId, document.id, row),
              include: getAttendanceRecordInclude(),
            }),
          );
        }

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
    };
  }

  async mockExtractDocument(documentId: string, dto: MockExtractDto) {
    const document = await this.prisma.attendanceDocument.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException("Attendance document not found.");
    }

    const template = await this.getEventTemplate(document.eventId);
    const extraction = await this.ocrProvider.extract({
      document: {
        id: document.id,
        eventId: document.eventId,
        fileName: document.fileName,
        fileType: document.fileType,
        fileUrl: document.fileUrl,
      },
      template,
      options: { rowCount: dto.rowCount },
    });

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

        const records = [];

        for (const row of extraction.rows) {
          records.push(
            await tx.attendanceRecord.create({
              data: this.toExtractedRecordCreateInput(
                document.eventId,
                document.id,
                row,
              ),
              include: getAttendanceRecordInclude(),
            }),
          );
        }

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
    };
  }

  async updateRecord(recordId: string, dto: UpdateAttendanceRecordDto) {
    const existingRecord = await this.prisma.attendanceRecord.findUnique({
      where: { id: recordId },
    });

    if (!existingRecord) {
      throw new NotFoundException("Attendance record not found.");
    }

    const template = await this.getEventTemplate(existingRecord.eventId);
    const data = dto.data
      ? this.cleanDataForFields(dto.data, template.fields)
      : undefined;

    const updatedRecord = await this.prisma.$transaction(async (tx) => {
      const record = await tx.attendanceRecord.update({
        where: { id: recordId },
        data: {
          dataJson: data ? this.toJsonObject(data) : undefined,
          confidenceScore: data ? 1 : undefined,
          status: dto.status ? toPrismaRecordStatus(dto.status) : undefined,
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
            },
            create: {
              recordId,
              fieldId: field.id,
              rawValue: this.stringifyValue(value),
              normalizedValue: this.stringifyValue(value),
              confidence: 1,
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

  async approveRecord(recordId: string) {
    return this.updateStatus(recordId, AttendanceRecordStatus.APPROVED);
  }

  async rejectRecord(recordId: string) {
    return this.updateStatus(recordId, AttendanceRecordStatus.REJECTED);
  }

  private async updateStatus(
    recordId: string,
    status: AttendanceRecordStatus,
  ) {
    const record = await this.prisma.attendanceRecord
      .update({
        where: { id: recordId },
        data: { status },
        include: getAttendanceRecordInclude(),
      })
      .catch(() => {
        throw new NotFoundException("Attendance record not found.");
      });

    return toAttendanceRecordResponse(record);
  }

  private async getEventTemplate(eventId: string): Promise<TemplateWithFields> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
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

    const template = event.templates[0];

    if (!template) {
      throw new NotFoundException("Event does not have an attendance template.");
    }

    return {
      id: template.id,
      name: template.name,
      fields: template.fields,
    };
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
          };
        }),
      },
    };
  }

  private toExtractedRecordCreateInput(
    eventId: string,
    documentId: string,
    row: OcrExtractedRow,
  ): Prisma.AttendanceRecordCreateInput {
    return {
      event: { connect: { id: eventId } },
      document: { connect: { id: documentId } },
      rowNumber: row.rowNumber,
      dataJson: this.toJsonObject(row.data),
      confidenceScore: row.confidenceScore,
      status:
        row.confidenceScore < 0.75
          ? AttendanceRecordStatus.NEEDS_REVIEW
          : AttendanceRecordStatus.DRAFT,
      values: {
        create: row.values.map((value) => ({
          field: { connect: { id: value.field.id } },
          rawValue: this.stringifyValue(value.rawValue),
          normalizedValue: this.stringifyValue(value.normalizedValue),
          confidence: value.confidence,
          boundingBox: value.boundingBox ?? undefined,
        })),
      },
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
}
