import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';

export interface SettingValue {
  category: string;
  key: string;
  value: unknown;
  isSensitive: boolean;
  description?: string | null;
}

/**
 * SettingsService — Read/write app_settings table.
 *
 * Sensitive values (API keys, secrets) are encrypted at rest using CryptoService.
 * The UI gets a masked value ("••••••") for sensitive fields instead of plaintext.
 *
 * Usage:
 *   await settings.get('email', 'sendgrid_api_key')   → decrypted string
 *   await settings.set('email', 'sendgrid_api_key', 'SG.xxx', { sensitive: true })
 *   await settings.getCategory('email')               → all keys in category
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Get a single setting value (decrypted if sensitive).
   * Returns null if not found.
   */
  async get(category: string, key: string): Promise<string | null> {
    const row = await this.prisma.appSettings.findUnique({
      where: { uq_app_settings_key: { category, settingKey: key } },
    });
    if (!row) return null;

    const raw = this.extractString(row.settingValue);
    if (!raw) return null;

    if (row.isSensitive) {
      const decrypted = this.crypto.decrypt(raw);
      return decrypted;
    }
    return raw;
  }

  /**
   * Get all settings in a category.
   * Sensitive values are masked for UI display.
   */
  async getCategory(category: string): Promise<SettingValue[]> {
    const rows = await this.prisma.appSettings.findMany({
      where: { category },
      orderBy: { settingKey: 'asc' },
    });

    return rows.map((row: (typeof rows)[number]) => {
      const raw = this.extractString(row.settingValue);
      const displayValue = row.isSensitive && raw
        ? '••••••'
        : raw ?? '';

      return {
        category: row.category,
        key: row.settingKey,
        value: displayValue,
        isSensitive: row.isSensitive,
        description: row.description,
      };
    });
  }

  /**
   * Set a single setting value.
   * Creates if not exists, updates if exists (upsert).
   */
  async set(
    category: string,
    key: string,
    value: string,
    opts?: {
      sensitive?: boolean;
      description?: string;
      updatedByUserId?: string;
    },
  ): Promise<void> {
    const sensitive = opts?.sensitive ?? false;
    const storedValue = sensitive ? (this.crypto.encrypt(value) ?? value) : value;

    await this.prisma.appSettings.upsert({
      where: { uq_app_settings_key: { category, settingKey: key } },
      create: {
        category,
        settingKey: key,
        settingValue: storedValue,
        isSensitive: sensitive,
        description: opts?.description,
        updatedByUserId: opts?.updatedByUserId ?? null,
      },
      update: {
        settingValue: storedValue,
        ...(opts?.description !== undefined && { description: opts.description }),
        ...(opts?.updatedByUserId && { updatedByUserId: opts.updatedByUserId }),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Setting updated: ${category}.${key}${sensitive ? ' (sensitive)' : ''}`);
  }

  /**
   * Bulk upsert settings in a category.
   */
  async setMany(
    category: string,
    entries: Array<{ key: string; value: string; sensitive?: boolean; description?: string }>,
    updatedByUserId?: string,
  ): Promise<void> {
    for (const entry of entries) {
      await this.set(category, entry.key, entry.value, {
        sensitive: entry.sensitive,
        description: entry.description,
        updatedByUserId,
      });
    }
  }

  /**
   * Delete a setting.
   */
  async delete(category: string, key: string): Promise<void> {
    const row = await this.prisma.appSettings.findUnique({
      where: { uq_app_settings_key: { category, settingKey: key } },
    });
    if (!row) throw new NotFoundException(`Setting ${category}.${key} not found`);

    await this.prisma.appSettings.delete({
      where: { uq_app_settings_key: { category, settingKey: key } },
    });
  }

  /**
   * Get all categories that have at least one setting.
   */
  async listCategories(): Promise<string[]> {
    const rows = await this.prisma.appSettings.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return rows.map((r: (typeof rows)[number]) => r.category);
  }

  async generateNumber(
    orgId: string,
    type: 'quote' | 'lead' | 'subscription',
    date: Date = new Date(),
  ): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: { orgSettings: true },
    });
    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }

    const orgShort = org.name
      .split(/[\s_-]+/)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .substring(0, 10);

    const year = date.getFullYear();
    const month = date.getMonth();
    let fyStart = year;
    if (month < 3) {
      fyStart = year - 1;
    }
    const fyEnd = (fyStart + 1) % 100;
    const fyStart2Digit = fyStart % 100;
    const fyStr = `${String(fyStart2Digit).padStart(2, '0')}-${String(fyEnd).padStart(2, '0')}`;

    const yyyyStr = String(year);
    const yyStr = String(year % 100).padStart(2, '0');

    let pattern = '';
    if (type === 'quote') {
      pattern = org.orgSettings?.quoteNumberFormat || (await this.get('quick_quote', 'number_format')) || 'QQ-{ORG}-{FY}-{NNNN}';
    } else if (type === 'lead') {
      pattern = org.orgSettings?.leadNumberFormat || (await this.get('quick_quote', 'lead_number_format')) || 'LD-{ORG}-{FY}-{NNNN}';
    } else {
      pattern = org.orgSettings?.subscriptionNumberFormat || (await this.get('quick_quote', 'subscription_number_format')) || 'SUB-{ORG}-{FY}-{NNNN}';
    }

    // Normalize plain-keyword form (e.g. "YYYY") to braced form ("{YYYY}") so settings saved
    // from the global format UI (which shows YYYY/NNNN without braces) work correctly.
    // Process YYYY before YY to avoid partial-match; use lookbehind/ahead to skip already-braced tokens.
    pattern = pattern
      .replace(/(?<!\{)YYYY(?!\})/g, '{YYYY}')
      .replace(/(?<!\{)FY(?!\})/g, '{FY}')
      .replace(/(?<!\{)ORG(?!\})/g, '{ORG}')
      .replace(/(?<!\{)NNNN(?!\})/g, '{NNNN}')
      .replace(/(?<!\{)(?<!Y)YY(?!Y)(?!\})/g, '{YY}');

    const searchPattern = pattern
      .replace('{ORG}', orgShort)
      .replace('{FY}', fyStr)
      .replace('{YYYY}', yyyyStr)
      .replace('{YY}', yyStr);

    const startsWithPattern = searchPattern.split('{NNNN}')[0];

    let latestNumber: string | null = null;

    if (type === 'quote') {
      const row = await this.prisma.quickQuote.findFirst({
        where: { targetOrganizationId: orgId, quoteNumber: { startsWith: startsWithPattern } },
        orderBy: { quoteNumber: 'desc' },
        select: { quoteNumber: true },
      });
      latestNumber = row?.quoteNumber ?? null;
    } else if (type === 'lead') {
      const row = await this.prisma.lead.findFirst({
        where: { targetOrganizationId: orgId, leadNumber: { startsWith: startsWithPattern } },
        orderBy: { leadNumber: 'desc' },
        select: { leadNumber: true },
      });
      latestNumber = row?.leadNumber ?? null;
    } else {
      const row = await this.prisma.subscription.findFirst({
        where: { organizationId: orgId, subscriptionNumber: { startsWith: startsWithPattern } },
        orderBy: { subscriptionNumber: 'desc' },
        select: { subscriptionNumber: true },
      });
      latestNumber = row?.subscriptionNumber ?? null;
    }

    let nextNum = 1;
    if (latestNumber) {
      const regexStr = '^' + searchPattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace('\\{NNNN\\}', '(\\d+)') + '$';
      try {
        const regex = new RegExp(regexStr);
        const match = latestNumber.match(regex);
        if (match && match[1]) {
          nextNum = parseInt(match[1], 10) + 1;
        } else {
          const endMatch = latestNumber.match(/(\d+)$/);
          if (endMatch) {
            nextNum = parseInt(endMatch[1], 10) + 1;
          }
        }
      } catch {
        const endMatch = latestNumber.match(/(\d+)$/);
        if (endMatch) {
          nextNum = parseInt(endMatch[1], 10) + 1;
        }
      }
    }

    const padNum = String(nextNum).padStart(4, '0');
    return searchPattern.replace('{NNNN}', padNum);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private extractString(value: unknown): string | null {
    if (typeof value === 'string') return value || null;
    if (value === null || value === undefined) return null;
    return String(value);
  }
}
