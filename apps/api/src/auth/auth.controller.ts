import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser, AuthUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * POST /api/auth/login
   * Public — sets httpOnly session cookie and returns user info.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, token } = await this.auth.login(dto, req);
    res.cookie(this.auth.cookieName(), token, this.auth.cookieOptions());
    return { user };
  }

  /**
   * POST /api/auth/logout
   * Clears session cookie and deletes DB session.
   */
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string>)?.[this.auth.cookieName()]
      ?? req.headers['authorization']?.replace('Bearer ', '');

    if (token) await this.auth.logout(token);
    res.clearCookie(this.auth.cookieName(), { path: '/' });
    return { message: 'Logged out' };
  }

  /**
   * GET /api/auth/me
   * Returns currently authenticated user info.
   */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
