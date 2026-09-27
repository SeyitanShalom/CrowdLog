import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

export class AddEventReviewerDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}
