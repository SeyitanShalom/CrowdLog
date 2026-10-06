import { BadRequestException, Injectable } from "@nestjs/common";
import { EventMemberRole } from "@prisma/client";
import { isEmail } from "class-validator";
import { createHash, randomBytes } from "node:crypto";
import { AUTH_COOKIE_NAME, SESSION_TTL_DAYS } from "./auth.constants";
import type { AuthenticatedUser } from "./auth.types";
import type { SignInDto } from "./dto/sign-in.dto";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async signIn(dto: SignInDto) {
    const email = this.normalizeSignInEmail(dto.email);
    const name = dto.name?.trim() || null;
    const phone = this.normalizePhone(dto.phone);

    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        name: name ?? undefined,
        phone: phone ?? undefined,
      },
      create: {
        email,
        name,
        phone,
      },
    });

    await this.claimOwnerlessEvents(user.id);

    const token = this.createSessionToken();
    const expiresAt = this.sessionExpiresAt();

    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt,
      },
    });

    return {
      token,
      expiresAt,
      user: this.toAuthenticatedUser(user),
    };
  }

  async signOut(cookieHeader: string | undefined) {
    const token = this.sessionTokenFromCookie(cookieHeader);

    if (!token) {
      return;
    }

    await this.prisma.userSession.deleteMany({
      where: { tokenHash: this.hashToken(token) },
    });
  }

  async currentUser(cookieHeader: string | undefined) {
    const token = this.sessionTokenFromCookie(cookieHeader);

    if (!token) {
      return null;
    }

    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: true },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) {
        await this.prisma.userSession.delete({ where: { id: session.id } });
      }

      return null;
    }

    return this.toAuthenticatedUser(session.user);
  }

  sessionCookie(token: string, expiresAt: Date) {
    const sameSite = this.cookieSameSite();

    return [
      `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      `SameSite=${sameSite}`,
      `Expires=${expiresAt.toUTCString()}`,
      this.shouldUseSecureCookie(sameSite) ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  clearSessionCookie() {
    const sameSite = this.cookieSameSite();

    return [
      `${AUTH_COOKIE_NAME}=`,
      "Path=/",
      "HttpOnly",
      `SameSite=${sameSite}`,
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      this.shouldUseSecureCookie(sameSite) ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  private async claimOwnerlessEvents(userId: string) {
    const events = await this.prisma.event.findMany({
      where: { ownerId: null },
      select: { id: true },
    });

    if (events.length === 0) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.event.updateMany({
        where: { ownerId: null },
        data: { ownerId: userId },
      }),
      this.prisma.eventMembership.createMany({
        data: events.map((event) => ({
          eventId: event.id,
          userId,
          role: EventMemberRole.OWNER,
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  private createSessionToken() {
    return randomBytes(32).toString("base64url");
  }

  private sessionExpiresAt() {
    return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private cookieSameSite() {
    return process.env.AUTH_COOKIE_SAMESITE?.trim() || "Lax";
  }

  private shouldUseSecureCookie(sameSite: string) {
    return (
      process.env.NODE_ENV === "production" ||
      sameSite.toLowerCase() === "none"
    );
  }

  private sessionTokenFromCookie(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
    const cookie = cookies.find((entry) =>
      entry.startsWith(`${AUTH_COOKIE_NAME}=`),
    );

    if (!cookie) {
      return null;
    }

    return decodeURIComponent(cookie.slice(AUTH_COOKIE_NAME.length + 1));
  }

  private toAuthenticatedUser(user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
    };
  }

  private normalizeSignInEmail(value: unknown) {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";

    if (!isEmail(email)) {
      throw new BadRequestException("Enter a valid email address.");
    }

    return email;
  }

  private normalizePhone(value: string | undefined) {
    const phone = value?.trim() || null;

    if (!phone) {
      return null;
    }

    if (!/^\+?[0-9()\-\s.]{7,32}$/.test(phone)) {
      throw new BadRequestException("Enter a valid phone number.");
    }

    return phone;
  }
}
