import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { TemplateFieldInputDto } from "./template-field-input.dto";

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsISO8601()
  eventDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  templateName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldInputDto)
  fields?: TemplateFieldInputDto[];
}
