import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentsService } from "./documents.service";
import type { UploadedAttendanceFile } from "./local-upload.types";

const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get("events/:eventId/documents")
  listDocuments(@Param("eventId") eventId: string) {
    return this.documentsService.listDocuments(eventId);
  }

  @Post("events/:eventId/documents")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
      },
      fileFilter: (_request, file, callback) => {
        if (ALLOWED_FILE_TYPES.has(file.mimetype)) {
          callback(null, true);
          return;
        }

        callback(
          new Error("Upload a PDF, JPEG, PNG, or WebP attendance sheet."),
          false,
        );
      },
    }),
  )
  uploadDocument(
    @Param("eventId") eventId: string,
    @UploadedFile() file: UploadedAttendanceFile | undefined,
  ) {
    return this.documentsService.createDocumentFromUpload(eventId, file);
  }

  @Get("uploads/:fileName")
  getUploadedFile(@Param("fileName") fileName: string) {
    return this.documentsService.getUploadedFile(fileName);
  }
}
