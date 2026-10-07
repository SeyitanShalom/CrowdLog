import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { RequestEmailOtpDto } from "./dto/request-email-otp.dto";
import { SignInDto } from "./dto/sign-in.dto";
import { VerifyEmailOtpDto } from "./dto/verify-email-otp.dto";

type RequestWithCookies = {
  headers: {
    cookie?: string;
  };
};

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get("me")
  async me(@Req() request: RequestWithCookies) {
    return {
      user: await this.authService.currentUser(request.headers.cookie),
    };
  }

  @Post("sign-in")
  async signIn(
    @Body() dto: SignInDto,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const session = await this.authService.signIn(dto);

    response.setHeader(
      "Set-Cookie",
      this.authService.sessionCookie(session.token, session.expiresAt),
    );

    return { user: session.user };
  }

  @Post("otp/request")
  async requestEmailOtp(@Body() dto: RequestEmailOtpDto) {
    return this.authService.requestEmailOtp(dto);
  }

  @Post("otp/verify")
  async verifyEmailOtp(
    @Body() dto: VerifyEmailOtpDto,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const session = await this.authService.verifyEmailOtp(dto);

    response.setHeader(
      "Set-Cookie",
      this.authService.sessionCookie(session.token, session.expiresAt),
    );

    return { user: session.user };
  }

  @Post("sign-out")
  async signOut(
    @Req() request: RequestWithCookies,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    await this.authService.signOut(request.headers.cookie);
    response.setHeader("Set-Cookie", this.authService.clearSessionCookie());

    return { ok: true };
  }
}
