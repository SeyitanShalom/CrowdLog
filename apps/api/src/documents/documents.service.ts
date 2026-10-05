import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  StreamableFile,
} from "@nestjs/common";
import { extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { AttendanceDocumentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UploadStorageService } from "../storage/upload-storage.service";
import {
  toAttendanceDocumentResponse,
} from "./attendance-document-response.mapper";
import type { UploadedAttendanceFile } from "./local-upload.types";

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly uploadStorage: UploadStorageService = new UploadStorageService(),
  ) {}

  async listDocuments(eventId: string, userId: string) {
    await this.ensureEventAccess(eventId, userId);

    const documents = await this.prisma.attendanceDocument.findMany({
      where: { eventId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { records: true },
        },
      },
    });

    return documents.map(toAttendanceDocumentResponse);
  }

  async createDocumentFromUpload(
    eventId: string,
    file: UploadedAttendanceFile | undefined,
    userId: string,
  ) {
    await this.ensureEventAccess(eventId, userId);

    if (!file) {
      throw new BadRequestException("Upload an attendance sheet file.");
    }

    const storedFileName = this.createStoredFileName(file.originalname);
    const fileUrl = await this.uploadStorage.uploadFile(storedFileName, file);

    try {
      const document = await this.prisma.attendanceDocument.create({
        data: {
          eventId,
          fileName: file.originalname,
          fileType: file.mimetype,
          fileUrl,
          status: AttendanceDocumentStatus.UPLOADED,
        },
        include: {
          _count: {
            select: { records: true },
          },
        },
      });

      return toAttendanceDocumentResponse(document);
    } catch (error) {
      await this.deleteUploadedFile(fileUrl);
      throw error;
    }
  }

  async getUploadedFile(fileName: string, userId: string) {
    if (fileName !== basename(fileName)) {
      throw new BadRequestException("Invalid upload file name.");
    }

    const document = await this.prisma.attendanceDocument.findFirst({
      where: { fileUrl: this.uploadStorage.fileUrlForObjectKey(fileName) },
      include: {
        event: {
          include: { members: true },
        },
      },
    });

    if (!document) {
      throw new NotFoundException("Uploaded file not found.");
    }

    this.ensureCanAccessEvent(document.event, userId);
    const fileContent = await this.uploadStorage.downloadFile(document.fileUrl);

    return new StreamableFile(Readable.from([fileContent]), {
      type: document.fileType ?? "application/octet-stream",
      disposition: `inline; filename="${document.fileName}"`,
    });
  }

  async replaceDocumentFile(
    documentId: string,
    file: UploadedAttendanceFile | undefined,
    userId: string,
  ) {
    if (!file) {
      throw new BadRequestException("Upload a replacement attendance sheet file.");
    }

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

    const storedFileName = this.createStoredFileName(file.originalname);
    const nextFileUrl = await this.uploadStorage.uploadFile(storedFileName, file);

    try {
      const updatedDocument = await this.prisma.$transaction(async (tx) => {
        await tx.attendanceRecord.deleteMany({
          where: { documentId },
        });

        return tx.attendanceDocument.update({
          where: { id: documentId },
          data: {
            fileName: file.originalname,
            fileType: file.mimetype,
            fileUrl: nextFileUrl,
            status: AttendanceDocumentStatus.UPLOADED,
            rawOcrJson: Prisma.DbNull,
          },
          include: {
            _count: {
              select: { records: true },
            },
          },
        });
      });

      await this.deleteUploadedFile(document.fileUrl);

      return toAttendanceDocumentResponse(updatedDocument);
    } catch (error) {
      await this.deleteUploadedFile(nextFileUrl);
      throw error;
    }
  }

  async deleteDocument(documentId: string, userId: string) {
    const document = await this.prisma.attendanceDocument.findUnique({
      where: { id: documentId },
      include: {
        event: {
          include: { members: true },
        },
        _count: {
          select: { records: true },
        },
      },
    });

    if (!document) {
      throw new NotFoundException("Attendance document not found.");
    }

    this.ensureCanAccessEvent(document.event, userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceRecord.deleteMany({
        where: { documentId },
      });

      await tx.attendanceDocument.delete({
        where: { id: documentId },
      });
    });

    await this.deleteUploadedFile(document.fileUrl);

    return {
      id: document.id,
      eventId: document.eventId,
      deletedRecordCount: document._count.records,
    };
  }

  private async ensureEventAccess(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { members: true },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanAccessEvent(event, userId);
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

  private createStoredFileName(originalName: string) {
    const extension = extname(originalName).toLowerCase();
    const baseName = basename(originalName, extension)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

    return `${Date.now()}-${randomUUID()}-${baseName || "attendance-sheet"}${extension}`;
  }

  private async deleteUploadedFile(fileUrl: string) {
    if (!fileUrl.startsWith("/uploads/")) {
      return;
    }

    const fileName = fileUrl.replace("/uploads/", "");

    if (fileName !== basename(fileName)) {
      return;
    }

    await this.uploadStorage.deleteFile(fileUrl).catch(() => {
      // The database is the source of truth; missing stored files are harmless.
    });
  }
}
