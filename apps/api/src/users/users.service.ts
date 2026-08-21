import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { CryptoService } from '../crypto/crypto.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly cryptoService: CryptoService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, metadata: true, isActive: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => ({
      ...u,
      allowedOrgIds: (u.metadata as Record<string, unknown>)?.allowed_org_ids as string[] | null ?? null,
    }));
  }

  async createUser(data: { name: string; email: string; role: UserRole }) {
    // Generate a temporary 12-character password (alphanumeric URL-safe)
    const tempPassword = this.cryptoService.randomToken(9); 
    const passwordHash = await this.cryptoService.hashPassword(tempPassword);

    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        passwordHash,
        isActive: true,
      },
      select: { id: true, name: true, email: true, role: true, isActive: true, metadata: true },
    });

    try {
      await this.emailService.send({
        to: user.email,
        subject: 'Welcome to ExcelTech Subscription Management Tool',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <h2 style="color:#1e293b">Welcome, ${user.name}!</h2>
            <p style="color:#475569">
              आपको ExcelTech Subscription Management Tool में <strong>${user.role}</strong> role के साथ जोड़ा गया है।
            </p>
            <p style="color:#475569">
              आप नीचे दी गई जानकारी का उपयोग करके सिस्टम में लॉगिन कर सकते हैं:
            </p>
            <div style="background-color:#f8fafc;padding:12px;border-radius:6px;margin:16px 0;">
              <strong>Email:</strong> ${user.email}<br/>
              <strong>Password:</strong> <span style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${tempPassword}</span>
            </div>
            <p style="color:#475569;font-size:14px">
              <em>Please log in and change your password immediately.</em>
            </p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
            <p style="color:#94a3b8;font-size:12px">
              Excel Technologies — Subscription Management Tool
            </p>
          </div>
        `,
      });
      this.logger.log(`Invitation email sent to ${user.email}`);
    } catch (error) {
      this.logger.error(`Failed to send invitation email to ${user.email}`, error instanceof Error ? error.stack : String(error));
    }

    return {
      ...user,
      allowedOrgIds: null,
    };
  }

  async updateUser(userId: string, data: { name?: string; role?: UserRole; isActive?: boolean }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.role && { role: data.role }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
      select: { id: true, name: true, email: true, role: true, isActive: true, metadata: true },
    });

    return {
      ...updated,
      allowedOrgIds: (updated.metadata as Record<string, unknown>)?.allowed_org_ids as string[] | null ?? null,
    };
  }

  async setOrgAccess(userId: string, orgIds: string[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const existing = (user.metadata as Record<string, unknown>) ?? {};
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { metadata: { ...existing, allowed_org_ids: orgIds } },
      select: { id: true, name: true, email: true, role: true, isActive: true, metadata: true },
    });

    return {
      ...updated,
      allowedOrgIds: orgIds,
    };
  }

  async resendInvite(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    // Generate a new temporary password
    const tempPassword = this.cryptoService.randomToken(9);
    const passwordHash = await this.cryptoService.hashPassword(tempPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    try {
      await this.emailService.send({
        to: user.email,
        subject: 'Password Reset / Account Access - ExcelTech Subscription Tool',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <h2 style="color:#1e293b">Hello, ${user.name || 'User'}!</h2>
            <p style="color:#475569">
              आपके अकाउंट का एक्सेस रीसेट कर दिया गया है या आपको सिस्टम में दोबारा इन्वाइट किया गया है।
            </p>
            <p style="color:#475569">
              आप नीचे दी गई नई जानकारी का उपयोग करके सिस्टम में लॉगिन कर सकते हैं:
            </p>
            <div style="background-color:#f8fafc;padding:12px;border-radius:6px;margin:16px 0;">
              <strong>Email:</strong> ${user.email}<br/>
              <strong>New Password:</strong> <span style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${tempPassword}</span>
            </div>
            <p style="color:#475569;font-size:14px">
              <em>Please log in and change your password immediately.</em>
            </p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
            <p style="color:#94a3b8;font-size:12px">
              Excel Technologies — Subscription Management Tool
            </p>
          </div>
        `,
      });
      this.logger.log(`Resend invite/reset email sent to ${user.email}`);
    } catch (error) {
      this.logger.error(`Failed to send resend invite email to ${user.email}`, error instanceof Error ? error.stack : String(error));
      throw new Error("Failed to send email. Check SMTP settings.");
    }

    return { success: true, message: "Email sent successfully with a new temporary password." };
  }
}
