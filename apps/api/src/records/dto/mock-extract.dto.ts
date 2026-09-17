import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class MockExtractDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  rowCount?: number;
}
