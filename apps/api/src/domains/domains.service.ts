import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as Papa from 'papaparse';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CreateDomainDto, UpdateDomainDto } from './dto/domains.dto';
import type { AuthUser } from '../auth/decorators/current-user.decorator';

/** Lifecycle statuses that count as a "live" (active) subscription on a domain. */
const ACTIVE_SUB_STATUSES = ['Active', 'Expiring_Soon'] as const;

@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Build the Prisma `where` clause shared by list/exportCsv. */
  private buildWhere(params: { orgId?: string; search?: string; status?: string }) {
    const { orgId, search, status } = params;
    const where: Record<string, unknown> = {};
    if (orgId)  where.organizationId = orgId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { domainName: { contains: search, mode: 'insensitive' } },
        { zohoCustomerName: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async list(params: { orgId?: string; search?: string; status?: string; page?: number; limit?: number }) {
    const { orgId, search, status, page = 1, limit = 30 } = params;
    const skip = (page - 1) * limit;

    const where = this.buildWhere({ orgId, search, status });
    // Stat cards reflect the org/search context but always show the full status
    // breakdown, so they ignore the status filter itself.
    const statsWhere = this.buildWhere({ orgId, search });

    const [domains, total, statusGroups] = await Promise.all([
      this.prisma.domain.findMany({
        where,
        orderBy: { domainName: 'asc' },
        skip,
        take: limit,
        include: {
          organization: { select: { id: true, name: true, zohoOrgId: true, dataCenter: true } },
          subscriptions: {
            orderBy: { endDate: 'asc' },
            select: {
              id: true,
              subscriptionNumber: true,
              zohoItemName: true,
              quantity: true,
              subscriptionPrice: true,
              billingCycle: true,
              startDate: true,
              endDate: true,
              lifecycleStatus: true,
              processStatus: true,
              lastInvoiceId: true,
              lastInvoiceNumber: true,
              lastQuoteId: true,
              lastQuoteNumber: true,
            },
          },
          _count: { select: { subscriptions: true } },
        },
      }),
      this.prisma.domain.count({ where }),
      this.prisma.domain.groupBy({
        by: ['status'],
        where: statsWhere,
        _count: { _all: true },
      }),
    ]);

    const domainsWithCounts = domains.map((d) => ({
      ...d,
      activeSubsCount: d.subscriptions.filter((s) =>
        (ACTIVE_SUB_STATUSES as readonly string[]).includes(s.lifecycleStatus),
      ).length,
    }));

    const byStatus = (s: string) =>
      statusGroups.find((g) => g.status === s)?._count._all ?? 0;
    const stats = {
      total:     statusGroups.reduce((sum, g) => sum + g._count._all, 0),
      active:    byStatus('active'),
      suspended: byStatus('suspended'),
      inactive:  byStatus('inactive'),
    };

    return { domains: domainsWithCounts, total, page, limit, stats };
  }

  async exportCsv(params: { orgId?: string; search?: string; status?: string }) {
    const where = this.buildWhere(params);
    const domains = await this.prisma.domain.findMany({
      where,
      orderBy: { domainName: 'asc' },
      include: {
        organization: { select: { name: true } },
        subscriptions: { select: { lifecycleStatus: true } },
      },
    });

    const rows = domains.map((d) => ({
      Domain:                d.domainName,
      Customer:              d.zohoCustomerName ?? '',
      Zoho_Customer_ID:      d.zohoCustomerId,
      Organization:          d.organization?.name ?? '',
      Status:                d.status,
      Active_Subscriptions:  d.subscriptions.filter((s) =>
        (ACTIVE_SUB_STATUSES as readonly string[]).includes(s.lifecycleStatus),
      ).length,
      Total_Subscriptions:   d.subscriptions.length,
      Added_On:              d.createdAt.toISOString().slice(0, 10),
    }));

    return Papa.unparse(rows);
  }

  async findOne(id: string) {
    const domain = await this.prisma.domain.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        subscriptions: {
          orderBy: { endDate: 'asc' },
          include: { organization: { select: { name: true } } },
        },
      },
    });
    if (!domain) throw new NotFoundException(`Domain ${id} not found`);
    return domain;
  }

  async create(dto: CreateDomainDto, user: AuthUser) {
    const existing = await this.prisma.domain.findFirst({
      where: { domainName: dto.domainName, organizationId: dto.organizationId, zohoCustomerId: dto.zohoCustomerId },
    });
    if (existing) throw new ConflictException(`Domain "${dto.domainName}" already exists for this customer`);

    const domain = await this.prisma.domain.create({
      data: {
        domainName:       dto.domainName,
        organizationId:   dto.organizationId,
        zohoCustomerId:   dto.zohoCustomerId,
        zohoCustomerName: dto.zohoCustomerName,
        notes:            dto.notes,
      },
      include: { organization: { select: { id: true, name: true } } },
    });

    await this.auditLogs.logAction({
      entityType: 'domain',
      entityId: domain.id,
      action: 'create',
      changeSummary: `Domain ${domain.domainName} created`,
      newValue: domain,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    return domain;
  }

  async update(id: string, dto: UpdateDomainDto, user: AuthUser) {
    const existing = await this.findOne(id);

    // If renaming, check no other domain record for the same org+customer already has that name
    if (dto.domainName && dto.domainName !== existing.domainName) {
      const conflict = await this.prisma.domain.findFirst({
        where: {
          domainName:    dto.domainName,
          organizationId: existing.organizationId,
          zohoCustomerId: existing.zohoCustomerId,
          NOT: { id },
        },
      });
      if (conflict) {
        throw new ConflictException(`Domain "${dto.domainName}" already exists for this customer`);
      }
    }

    const domain = await this.prisma.domain.update({
      where: { id },
      data: {
        ...(dto.domainName       !== undefined && { domainName: dto.domainName }),
        ...(dto.status           !== undefined && { status: dto.status }),
        ...(dto.zohoCustomerName !== undefined && { zohoCustomerName: dto.zohoCustomerName }),
        ...(dto.notes            !== undefined && { notes: dto.notes }),
        updatedAt: new Date(),
      },
    });

    await this.auditLogs.logAction({
      entityType: 'domain',
      entityId: id,
      action: 'update',
      changeSummary: dto.domainName && dto.domainName !== existing.domainName
        ? `Domain renamed from "${existing.domainName}" to "${dto.domainName}"`
        : `Domain ${existing.domainName} updated`,
      newValue: domain,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    return domain;
  }

  async delete(id: string, user: AuthUser) {
    const domain = await this.findOne(id);
    const activeSubs = domain.subscriptions.filter((s) =>
      (ACTIVE_SUB_STATUSES as readonly string[]).includes(s.lifecycleStatus),
    ).length;
    
    if (activeSubs > 0) {
      throw new ConflictException(`Cannot delete domain "${domain.domainName}" because it has ${activeSubs} active subscription(s).`);
    }

    await this.prisma.domain.delete({ where: { id } });

    await this.auditLogs.logAction({
      entityType: 'domain',
      entityId: id,
      action: 'delete',
      changeSummary: `Domain ${domain.domainName} deleted`,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    return { success: true };
  }

  async bulkDelete(ids: string[], user: AuthUser) {
    if (!ids || ids.length === 0) {
      throw new ConflictException('No domains provided for deletion.');
    }
    
    let deletedCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        await this.delete(id, user);
        deletedCount++;
      } catch (err: any) {
        errors.push(err.message);
      }
    }

    if (deletedCount === 0 && errors.length > 0) {
      throw new ConflictException(`Failed to delete domains: ${errors[0]}`);
    }

    return { 
      success: true, 
      deletedCount, 
      errors: errors.length > 0 ? errors : undefined 
    };
  }
}
