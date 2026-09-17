import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AttendanceDocumentStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  toAttendanceDocumentResponse,
} from "./attendance-document-response.mapper";
import type { UploadedAttendanceFile } from "./local-upload.types";

const UPLOAD_DIRECTORY = resolve(process.cwd(), "uploads");

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listDocuments(eventId: string) {
    await this.ensureEventExists(eventId);

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
  ) {
    await this.ensureEventExists(eventId);

    if (!file) {
      throw new BadRequestException("Upload an attendance sheet file.");
    }

    await mkdir(UPLOAD_DIRECTORY, { recursive: true });

    const storedFileName = this.createStoredFileName(file.originalname);
    const filePath = join(UPLOAD_DIRECTORY, storedFileName);

    await writeFile(filePath, file.buffer);

    const document = await this.prisma.attendanceDocument.create({
      data: {
        eventId,
        fileName: file.originalname,
        fileType: file.mimetype,
        fileUrl: `/uploads/${storedFileName}`,
        status: AttendanceDocumentStatus.UPLOADED,
      },
      include: {
        _count: {
          select: { records: true },
        },
      },
    });

    return toAttendanceDocumentResponse(document);
  }

  async getUploadedFile(fileName: string) {
    if (fileName !== basename(fileName)) {
      throw new BadRequestException("Invalid upload file name.");
    }

    const filePath = join(UPLOAD_DIRECTORY, fileName);

    await access(filePath).catch(() => {
      throw new NotFoundException("Uploaded file not found.");
    });

    const document = await this.prisma.attendanceDocument.findFirst({
      where: { fileUrl: `/uploads/${fileName}` },
    });

    return new StreamableFile(createReadStream(filePath), {
      type: document?.fileType ?? "application/octet-stream",
      disposition: `inline; filename="${document?.fileName ?? fileName}"`,
    });
  }

  private async ensureEventExists(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }
  }

  private createStoredFileName(originalName: string) {
    const extension = extname(originalName).toLowerCase();
    const baseName = basename(originalName, extension)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

    return `${Date.now()}-${randomUUID()}-${baseName || "attendance-sheet"}${extension}`;
  }
}
