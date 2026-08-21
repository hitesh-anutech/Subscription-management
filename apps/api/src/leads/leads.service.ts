import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ZohoService } from '../zoho/zoho.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CreateLeadDto, UpdateLeadDto } from './dto/leads.dto';
import type { AuthUser } from '../auth/decorators/current-user.decorator';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly zohoService: ZohoService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(params: { status?: string; search?: string; orgId?: string; page?: number; limit?: number }) {
    const { status, search, orgId, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (orgId)  where.targetOrganizationId = orgId;
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search } },
        { primaryDomain: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { _count: { select: { quickQuotes: true } } },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { leads, total, page, limit };
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        quickQuotes: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, quoteNumber: true, status: true, totalAmount: true, createdAt: true },
        },
        conversions: { orderBy: { convertedAt: 'desc' }, take: 1 },
      },
    });
    if (!lead) throw new NotFoundException(`Lead ${id} not found`);
    return lead;
  }

  async create(dto: CreateLeadDto, user: AuthUser) {
    const dupSetting = (await this.settings.get('lead', 'duplicate_detection')) ?? 'warn';
    if (dupSetting === 'block') {
      const existing = await this.prisma.lead.findFirst({ where: { email: dto.email } });
      if (existing) {
        throw new ConflictException(`Lead with email ${dto.email} already exists (${existing.leadNumber})`);
      }
    }

    if (!dto.target_organization_id) {
      throw new BadRequestException('Target organization ID is required');
    }

    const leadNumber = await this.settings.generateNumber(
      dto.target_organization_id,
      'lead',
    );

    const lead = await this.prisma.lead.create({
      data: {
        leadNumber,
        companyName: dto.company_name ?? '',
        contactName: dto.contact_name,
        email: dto.email,
        phone: dto.phone,
        designation: dto.designation,
        billingAddressLine1: dto.billing_address_line1,
        billingAddressLine2: dto.billing_address_line2,
        city: dto.city,
        state: dto.state,
        stateCode: dto.state_code,
        postalCode: dto.postal_code,
        country: dto.country ?? undefined,
        gstin: dto.gstin,
        gstTreatment: dto.gst_treatment,
        pan: dto.pan,
        primaryDomain: dto.primary_domain,
        industry: dto.industry,
        leadSource: dto.lead_source,
        estimatedCloseDate: dto.estimated_close_date ? new Date(dto.estimated_close_date) : undefined,
        estimatedValue: dto.estimated_value,
        notes: dto.notes,
        targetOrganizationId: dto.target_organization_id,
      },
    });

    await this.auditLogs.logAction({
      entityType: 'lead',
      entityId: lead.id,
      action: 'create',
      changeSummary: `Lead ${lead.leadNumber} created for company ${lead.companyName}`,
      newValue: lead,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    this.logger.log(`Created lead ${lead.leadNumber} — ${lead.companyName}`);
    return lead;
  }

  async update(id: string, dto: UpdateLeadDto, user: AuthUser) {
    await this.findOne(id);

    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        ...(dto.company_name && { companyName: dto.company_name }),
        ...(dto.contact_name !== undefined && { contactName: dto.contact_name }),
        ...(dto.email && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.designation !== undefined && { designation: dto.designation }),
        ...(dto.billing_address_line1 !== undefined && { billingAddressLine1: dto.billing_address_line1 }),
        ...(dto.billing_address_line2 !== undefined && { billingAddressLine2: dto.billing_address_line2 }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.state !== undefined && { state: dto.state }),
        ...(dto.state_code !== undefined && { stateCode: dto.state_code }),
        ...(dto.postal_code !== undefined && { postalCode: dto.postal_code }),
        ...(dto.gstin !== undefined && { gstin: dto.gstin }),
        ...(dto.gst_treatment !== undefined && { gstTreatment: dto.gst_treatment }),
        ...(dto.pan !== undefined && { pan: dto.pan }),
        ...(dto.primary_domain !== undefined && { primaryDomain: dto.primary_domain }),
        ...(dto.industry !== undefined && { industry: dto.industry }),
        ...(dto.lead_source !== undefined && { leadSource: dto.lead_source }),
        ...(dto.status && { status: dto.status }),
        ...(dto.estimated_close_date && { estimatedCloseDate: new Date(dto.estimated_close_date) }),
        ...(dto.estimated_value !== undefined && { estimatedValue: dto.estimated_value }),
        ...(dto.lost_reason !== undefined && { lostReason: dto.lost_reason }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.target_organization_id !== undefined && { targetOrganizationId: dto.target_organization_id || null }),
      },
    });

    await this.auditLogs.logAction({
      entityType: 'lead',
      entityId: lead.id,
      action: 'update',
      changeSummary: `Lead ${lead.leadNumber} updated`,
      newValue: lead,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    return lead;
  }

  async remove(id: string, user: AuthUser) {
    const lead = await this.findOne(id);

    await this.prisma.$transaction(async (tx) => {
      // 1. Delete associated lead conversions
      await tx.leadConversion.deleteMany({
        where: { leadId: id },
      });

      // 2. Delete associated quick quotes (Prisma will automatically cascade delete quick_quote_items)
      await tx.quickQuote.deleteMany({
        where: { leadId: id },
      });

      // 3. Delete the lead itself
      await tx.lead.delete({
        where: { id },
      });
    });

    await this.auditLogs.logAction({
      entityType: 'lead',
      entityId: id,
      action: 'delete',
      changeSummary: `Lead ${lead.companyName} deleted along with associated conversions and quotes`,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    this.logger.log(`Deleted lead ${id}`);
    return { deleted: true };
  }

  async syncToZoho(id: string, user: AuthUser) {
    const lead = await this.findOne(id);
    if (lead.status !== 'Converted') {
      throw new BadRequestException('Lead must be Converted to sync to Zoho');
    }
    if (!lead.targetOrganizationId) {
      throw new BadRequestException('Lead is not associated with an organization');
    }

    const conversion = lead.conversions?.[0];
    if (!conversion || !conversion.zohoCustomerId) {
      throw new BadRequestException('Lead has not been successfully converted to a Zoho customer');
    }

    const payload: Record<string, unknown> = {
      contact_name: lead.companyName,
      company_name: lead.companyName,
    };

    if (lead.gstin || lead.gstTreatment || lead.pan) {
      payload.gst_no = lead.gstin || undefined;
      payload.gst_treatment = lead.gstTreatment || undefined;
      payload.pan = lead.pan || undefined;
    }

    if (lead.billingAddressLine1 || lead.city || lead.state) {
      const address = {
        address: lead.billingAddressLine1 || '',
        street2: lead.billingAddressLine2 || '',
        city: lead.city || '',
        state: lead.state || '',
        zip: lead.postalCode || '',
        country: 'India',
      };
      payload.billing_address = address;
      payload.shipping_address = address;
    }

    await this.zohoService.updateContactDetails(lead.targetOrganizationId, conversion.zohoCustomerId, payload);

    await this.auditLogs.logAction({
      entityType: 'lead',
      entityId: lead.id,
      action: 'update',
      changeSummary: `Synced lead contact details to Zoho Books`,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    return { success: true };
  }
}
