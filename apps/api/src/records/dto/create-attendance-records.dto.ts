import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export const RECORD_STATUSES = [
  "draft",
  "needs_review",
  "approved",
  "rejected",
] as const;

export type ApiRecordStatus = (typeof RECORD_STATUSES)[number];

export class CreateAttendanceRecordInputDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rowNumber?: number;

  @IsObject()
  data: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  confidenceScore?: number;

  @IsOptional()
  @IsIn(RECORD_STATUSES)
  status?: ApiRecordStatus;
}

export class CreateAttendanceRecordsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => CreateAttendanceRecordInputDto)
  records: CreateAttendanceRecordInputDto[];
}
