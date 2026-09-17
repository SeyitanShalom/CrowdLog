import { IsIn, IsObject, IsOptional } from "class-validator";
import { RECORD_STATUSES, type ApiRecordStatus } from "./create-attendance-records.dto";

export class UpdateAttendanceRecordDto {
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsIn(RECORD_STATUSES)
  status?: ApiRecordStatus;
}
