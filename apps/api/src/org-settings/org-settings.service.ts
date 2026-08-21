import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';

@Injectable()
export class OrgSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async findByOrgId(orgId: string) {
    await this.assertOrgExists(orgId);
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId: orgId },
    });
    if (!settings) return null;
    // Never expose the encrypted password — return a boolean flag instead
    const { smtpPasswordEncrypted, emailSignatureHtml: _sig, ...rest } = settings;
    return { ...rest, isSmtpConfigured: smtpPasswordEncrypted != null };
  }

  async upsert(orgId: string, dto: UpdateOrgSettingsDto, userId?: string) {
    await this.assertOrgExists(orgId);

    const {
      settingsOverrides: _rawOv,
      smtpPassword: rawSmtpPass,
      ...restDto
    } = dto;

    const data: Record<string, unknown> = {
      ...restDto,
      ...(dto.settingsOverrides != null
        ? { settingsOverrides: dto.settingsOverrides as unknown as import('@prisma/client').Prisma.InputJsonValue }
        : {}),
      // Only update the encrypted password when a new (non-empty) value is provided
      ...(rawSmtpPass ? { smtpPasswordEncrypted: this.crypto.encrypt(rawSmtpPass) } : {}),
      // Explicitly clear password when null is passed (user wants to remove it)
      ...(rawSmtpPass === null ? { smtpPasswordEncrypted: null } : {}),
      updatedByUserId: userId ?? null,
    };

    return this.prisma.orgSettings.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: { ...data, updatedAt: new Date() },
    });
  }

  /** Read raw SMTP credentials for internal use by EmailService (not exposed via API). */
  async getSmtpCredentials(orgId: string): Promise<{ smtpUser: string; smtpPass: string } | null> {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId: orgId },
      select: { smtpUser: true, smtpPasswordEncrypted: true },
    });
    if (!settings?.smtpUser || !settings.smtpPasswordEncrypted) return null;
    const smtpPass = this.crypto.decrypt(settings.smtpPasswordEncrypted);
    if (!smtpPass) return null;
    return { smtpUser: settings.smtpUser, smtpPass };
  }

  private async assertOrgExists(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);
  }
}
