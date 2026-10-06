import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class VerifyEmailOtpDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, {
    message: "token must be a 6 digit verification code",
  })
  token: string;

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
}
