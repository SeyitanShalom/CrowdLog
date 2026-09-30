import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
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
  @UseGuards(AuthGuard)
  listDocuments(
    @Param("eventId") eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.listDocuments(eventId, user.id);
  }

  @Post("events/:eventId/documents")
  @UseGuards(AuthGuard)
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.createDocumentFromUpload(eventId, file, user.id);
  }

  @Put("documents/:documentId")
  @UseGuards(AuthGuard)
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
  replaceDocument(
    @Param("documentId") documentId: string,
    @UploadedFile() file: UploadedAttendanceFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.replaceDocumentFile(documentId, file, user.id);
  }

  @Delete("documents/:documentId")
  @UseGuards(AuthGuard)
  deleteDocument(
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.deleteDocument(documentId, user.id);
  }

  @Get("uploads/:fileName")
  @UseGuards(AuthGuard)
  getUploadedFile(
    @Param("fileName") fileName: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.getUploadedFile(fileName, user.id);
  }
}
