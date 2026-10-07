import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class RequestEmailOtpDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsIn(["sign-up"])
  mode: "sign-up";

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^\+?[0-9()\-\s.]{7,32}$/, {
    message: "phone must be a valid phone number",
  })
  phone?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password: string;
}
