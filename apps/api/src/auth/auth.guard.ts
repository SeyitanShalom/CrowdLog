import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import type { AuthenticatedUser } from "./auth.types";

export type AuthenticatedRequest = {
  headers: {
    cookie?: string;
  };
  user?: AuthenticatedUser;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.authService.currentUser(request.headers.cookie);

    if (!user) {
      throw new UnauthorizedException("Sign in to continue.");
    }

    request.user = user;
    return true;
  }
}
