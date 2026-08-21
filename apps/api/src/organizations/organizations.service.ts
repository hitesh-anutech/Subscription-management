import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateOrganizationDto, UpdateOrganizationDto } from './dto/create-organization.dto';

/**
 * Organizations service — manages the 4 Zoho Books org records.
 *
 * NOT exposed here:
 *   - OAuth token reads/writes → ZohoService manages those
 *   - Webhook secret rotation  → ZohoService manages
 *
 * This service intentionally returns OAuth-stripped views via `toPublic()`.
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.organization.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      include: { orgSettings: true },
    });
    return { organizations: rows.map(this.toPublic) };
  }

  async findOne(id: string) {
    const row = await this.prisma.organization.findUnique({
      where: { id },
      include: { orgSettings: true },
    });
    if (!row) throw new NotFoundException(`Organization ${id} not found`);
    return this.toPublic(row);
  }

  async create(dto: CreateOrganizationDto) {
    // Guard: zoho_org_id must be globally unique
    const existing = await this.prisma.organization.findUnique({
      where: { zohoOrgId: dto.zoho_org_id },
    });
    if (existing) {
      throw new ConflictException(
        `Zoho org id ${dto.zoho_org_id} is already registered as "${existing.name}"`,
      );
    }

    // Map Zoho-style data center strings (with dots) → Prisma enum identifiers
    const dcInput = dto.data_center ?? 'in';
    const dataCenterMap: Record<string, 'in' | 'com' | 'eu' | 'com_au' | 'jp' | 'sa'> = {
      'in': 'in',
      'com': 'com',
      'eu': 'eu',
      'com.au': 'com_au',
      'com_au': 'com_au',
      'jp': 'jp',
      'sa': 'sa',
    };
    const dataCenter = dataCenterMap[dcInput];
    if (!dataCenter) {
      throw new ConflictException(`Unknown data center "${dcInput}"`);
    }

    const created = await this.prisma.organization.create({
      data: {
        name: dto.name,
        zohoOrgId: dto.zoho_org_id,
        dataCenter,
        baseCurrency: dto.base_currency ?? 'INR',
        connectionStatus: 'disconnected',
        isActive: true,
        orgSettings: {
          create: {
            // Sensible defaults — admin can edit in Settings later
            displayName: dto.name,
            country: 'India',
            pdfTemplate: 'modern',
          },
        },
      },
      include: { orgSettings: true },
    });

    this.logger.log(`Created organization "${created.name}" (id=${created.id})`);
    return this.toPublic(created);
  }

  async update(id: string, dto: UpdateOrganizationDto) {
    await this.assertExists(id);
    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.is_active !== undefined && { isActive: dto.is_active }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata as Record<string, string> }),
      },
      include: { orgSettings: true },
    });
    return this.toPublic(updated);
  }

  /**
   * Soft-delete: sets is_active=false + clears OAuth tokens.
   * Refuses deletion if active subscriptions exist for this org.
   */
  async softDelete(id: string) {
    await this.assertExists(id);

    const activeSubsCount = await this.prisma.subscription.count({
      where: { organizationId: id, lifecycleStatus: { in: ['Active', 'Pending', 'Expiring_Soon'] } },
    });
    if (activeSubsCount > 0) {
      throw new ConflictException(
        `Cannot delete organization: ${activeSubsCount} active subscription(s) reference it. Mark them Cancelled first.`,
      );
    }

    try {
      // Attempt hard delete first
      await this.prisma.organization.delete({ where: { id } });
      this.logger.log(`Hard-deleted organization id=${id}`);
    } catch (error: any) {
      // P2003 means foreign key constraint failed
      if (error.code === 'P2003') {
        // Fallback to soft delete
        await this.prisma.organization.update({
          where: { id },
          data: {
            isActive: false,
            connectionStatus: 'disconnected',
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
            tokenExpiresAt: null,
          },
        });
        this.logger.log(`Soft-deleted organization id=${id} (due to related records)`);
      } else {
        throw error;
      }
    }
  }

  async getHealth(id: string) {
    const row = await this.prisma.organization.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        connectionStatus: true,
        lastSyncAt: true,
        tokenExpiresAt: true,
        scopes: true,
      },
    });
    if (!row) throw new NotFoundException(`Organization ${id} not found`);

    const tokenExpired =
      row.tokenExpiresAt !== null && row.tokenExpiresAt.getTime() < Date.now();

    return {
      organization_id: row.id,
      name: row.name,
      connection_status: row.connectionStatus,
      token_expires_at: row.tokenExpiresAt,
      token_expired: tokenExpired,
      last_sync_at: row.lastSyncAt,
      scopes: row.scopes,
    };
  }

  private async assertExists(id: string) {
    const row = await this.prisma.organization.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Organization ${id} not found`);
  }

  /**
   * Strip encrypted OAuth tokens before returning.
   * Frontend never needs them.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPublic = (row: any) => {
    const {
      accessTokenEncrypted: _at,
      refreshTokenEncrypted: _rt,
      ...rest
    } = row;
    return rest;
  };
}
