import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { AuthUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';

const SESSION_COOKIE = 'subs_session';
const SESSION_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Validate credentials → create session → return token + user.
   */
  async login(dto: LoginDto, req: Request): Promise<{ user: AuthUser; token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        passwordHash: true,
        isActive: true,
        lockedUntil: true,
        failedLoginCount: true,
      },
    });

    // Generic error — don't reveal whether email exists
    const invalidError = new UnauthorizedException('Invalid email or password');

    if (!user || !user.passwordHash) throw invalidError;
    if (!user.isActive) throw new UnauthorizedException('Account is inactive — contact admin');

    // Check account lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(`Account locked — try again in ${mins} minute(s)`);
    }

    const valid = await this.crypto.verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      // Increment failed count, lock after 5 failures
      const count = (user.failedLoginCount ?? 0) + 1;
      const lockedUntil = count >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: count, ...(lockedUntil && { lockedUntil }) },
      });
      throw invalidError;
    }

    // Reset failed count on success
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // Create session
    const token = this.crypto.randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        sessionToken: token,
        userId: user.id,
        expiresAt,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });

    this.logger.log(`Login: user ${user.email} (id=${user.id})`);

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    return { user: authUser, token };
  }

  /**
   * Destroy session in DB.
   */
  async logout(token: string): Promise<void> {
    await this.prisma.session
      .delete({ where: { sessionToken: token } })
      .catch(() => {
        // Already deleted or never existed — fine
      });
  }

  /**
   * Validate session token → return AuthUser or null.
   */
  async validateSession(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { sessionToken: token },
      include: {
        user: {
          select: { id: true, email: true, name: true, role: true, isActive: true },
        },
      },
    });

    if (!session) return null;
    if (session.expiresAt < new Date()) {
      // Expired — clean up
      await this.prisma.session.delete({ where: { sessionToken: token } }).catch(() => {});
      return null;
    }
    if (!session.user.isActive) return null;

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
    };
  }

  /**
   * Cookie config used in controller.
   */
  cookieOptions() {
    const isProd = this.config.get('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax' as const,
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    };
  }

  cookieName() {
    return SESSION_COOKIE;
  }
}
