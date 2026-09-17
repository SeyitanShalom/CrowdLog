import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CreateAttendanceRecordsDto } from "./dto/create-attendance-records.dto";
import { MockExtractDto } from "./dto/mock-extract.dto";
import { UpdateAttendanceRecordDto } from "./dto/update-attendance-record.dto";
import { RecordsService } from "./records.service";

@Controller()
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get("events/:eventId/records")
  listRecords(@Param("eventId") eventId: string) {
    return this.recordsService.listRecords(eventId);
  }

  @Post("events/:eventId/records")
  createRecords(
    @Param("eventId") eventId: string,
    @Body() dto: CreateAttendanceRecordsDto,
  ) {
    return this.recordsService.createRecords(eventId, dto);
  }

  @Post("events/:eventId/mock-extract")
  mockExtract(@Param("eventId") eventId: string, @Body() dto: MockExtractDto) {
    return this.recordsService.mockExtract(eventId, dto);
  }

  @Post("documents/:documentId/mock-extract")
  mockExtractDocument(
    @Param("documentId") documentId: string,
    @Body() dto: MockExtractDto,
  ) {
    return this.recordsService.mockExtractDocument(documentId, dto);
  }

  @Patch("records/:recordId")
  updateRecord(
    @Param("recordId") recordId: string,
    @Body() dto: UpdateAttendanceRecordDto,
  ) {
    return this.recordsService.updateRecord(recordId, dto);
  }

  @Post("records/:recordId/approve")
  approveRecord(@Param("recordId") recordId: string) {
    return this.recordsService.approveRecord(recordId);
  }

  @Post("records/:recordId/reject")
  rejectRecord(@Param("recordId") recordId: string) {
    return this.recordsService.rejectRecord(recordId);
  }
}
