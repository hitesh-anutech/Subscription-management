import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthUser } from './decorators/current-user.decorator';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Global AuthGuard — validates session cookie on every request.
 * Mark a route as public with @Public() to skip auth.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Not authenticated — please log in');
    }

    const user = await this.auth.validateSession(token);
    if (!user) {
      // Clear stale cookie
      const response = context.switchToHttp().getResponse<Response>();
      response.clearCookie('subs_session');
      throw new UnauthorizedException('Session expired — please log in again');
    }

    request.user = user;
    return true;
  }

  private extractToken(request: Request): string | null {
    // Primary: httpOnly cookie
    const cookie = (request.cookies as Record<string, string>)?.subs_session;
    if (cookie) return cookie;

    // Fallback: Authorization header (for API clients / testing)
    const authHeader = request.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return null;
  }
}
