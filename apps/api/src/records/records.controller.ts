import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CreateAttendanceRecordsDto } from "./dto/create-attendance-records.dto";
import { MockExtractDto } from "./dto/mock-extract.dto";
import { getXlsxContentType } from "./record-export";
import { UpdateAttendanceRecordDto } from "./dto/update-attendance-record.dto";
import { RecordsService } from "./records.service";

@Controller()
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get("events/:eventId/records")
  @UseGuards(AuthGuard)
  listRecords(
    @Param("eventId") eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recordsService.listRecords(eventId, user.id);
  }

  @Get("events/:eventId/records/export")
  @UseGuards(AuthGuard)
  async exportRecords(
    @Param("eventId") eventId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { setHeader: (name: string, value: string) => void },
  ) {
    const exportFile = await this.recordsService.exportRecordsCsv(
      eventId,
      user.id,
    );

    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportFile.fileName}"`,
    );

    return exportFile.content;
  }

  @Get("events/:eventId/records/export.xlsx")
  @UseGuards(AuthGuard)
  async exportRecordsXlsx(
    @Param("eventId") eventId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { setHeader: (name: string, value: string) => void },
  ) {
    const exportFile = await this.recordsService.exportRecordsXlsx(
      eventId,
      user.id,
    );

    response.setHeader("Content-Type", getXlsxContentType());
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportFile.fileName}"`,
    );

    return exportFile.content;
  }

  @Post("events/:eventId/records")
  @UseGuards(AuthGuard)
  createRecords(
    @Param("eventId") eventId: string,
    @Body() dto: CreateAttendanceRecordsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recordsService.createRecords(eventId, dto, user.id);
  }

  @Post("events/:eventId/mock-extract")
  @UseGuards(AuthGuard)
  mockExtract(
    @Param("eventId") eventId: string,
    @Body() dto: MockExtractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recordsService.mockExtract(eventId, dto, user.id);
  }

  @Post("documents/:documentId/mock-extract")
  @UseGuards(AuthGuard)
  mockExtractDocument(
    @Param("documentId") documentId: string,
    @Body() dto: MockExtractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recordsService.mockExtractDocument(documentId, dto, user.id);
  }

  @Post("documents/:documentId/extract")
  @UseGuards(AuthGuard)
  extractDocument(
    @Param("documentId") documentId: string,
    @Body() dto: MockExtractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recordsService.extractDocument(documentId, dto, user.id);
  }

  @Patch("records/:recordId")
  @UseGuards(AuthGuard)
  updateRecord(
    @Param("recordId") recordId: string,
    @Body() dto: UpdateAttendanceRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recordsService.updateRecord(recordId, dto, user.id);
  }

  @Post("records/:recordId/approve")
  @UseGuards(AuthGuard)
  approveRecord(
    @Param("recordId") recordId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recordsService.approveRecord(recordId, user.id);
  }

  @Post("records/:recordId/reject")
  @UseGuards(AuthGuard)
  rejectRecord(
    @Param("recordId") recordId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recordsService.rejectRecord(recordId, user.id);
  }
}
