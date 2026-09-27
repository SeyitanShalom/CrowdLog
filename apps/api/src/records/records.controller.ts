import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CreateAttendanceRecordsDto } from "./dto/create-attendance-records.dto";
import { MockExtractDto } from "./dto/mock-extract.dto";
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
