import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

const FIELD_TYPES = [
  "text",
  "email",
  "phone",
  "number",
  "signature",
  "date",
  "select",
] as const;

export type ApiFieldType = (typeof FIELD_TYPES)[number];

export class TemplateFieldInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  key: string;

  @IsIn(FIELD_TYPES)
  type: ApiFieldType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  options?: string[];
}
