import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BillingCycle, BusinessType, Prisma, RenewalStatus, SubscriptionLifecycleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ZohoService } from '../zoho/zoho.service';
import { AnnexureService } from './annexure.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import * as Papa from 'papaparse';
import type {
  CreateSubscriptionDto, UpdateSubscriptionDto,
  RenewalQuoteDto, ProrataQuoteDto, StartSubscriptionDto,
  ImportSubscriptionDto, ImportInvoiceRefDto, BulkUpdatePriceDto, BulkRenewalQuoteDto,
  CombinedRenewalQuoteDto,
} from './dto/subscriptions.dto';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zoho: ZohoService,
    private readonly annexure: AnnexureService,
    private readonly auditLogs: AuditLogsService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------
  // List
  // ------------------------------------------------------------------
  async list(params: {
    orgId?: string;
    status?: string;
    billingCycle?: string;
    expiringDays?: number;
    search?: string;
    ids?: string[];
    page?: number;
    limit?: number;
  }) {
    const { orgId, status, billingCycle, expiringDays, search, ids, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (orgId)        where.organizationId = orgId;
    if (billingCycle) where.billingCycle = billingCycle;
    Object.assign(where, this.buildLifecycleWhere(status, expiringDays));
    if (search) {
      where.OR = [
        { subscriptionNumber: { contains: search, mode: 'insensitive' } },
        { zohoCustomerName:   { contains: search, mode: 'insensitive' } },
        { zohoItemName:       { contains: search, mode: 'insensitive' } },
        { domain: { domainName: { contains: search, mode: 'insensitive' } } },
        { renewalHistory: { some: { quoteNumber: { contains: search, mode: 'insensitive' } } } },
        { renewalHistory: { some: { invoiceNumber: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    if (ids?.length) where.id = { in: ids };

    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        orderBy: { endDate: 'asc' },
        skip,
        take: limit,
        include: {
          organization: { select: { id: true, name: true } },
          domain:       { select: { id: true, domainName: true } },
          _count:       { select: { renewalHistory: true } },
          renewalHistory: {
            orderBy: { createdAt: 'desc' },
            take: 15,
            select: {
              id: true,
              quoteNumber: true,
              quoteDate: true,
              quantity: true,
              sellingPrice: true,
              subtotalAmount: true,
              currency: true,
              serviceStartDate: true,
              serviceEndDate: true,
              businessType: true,
              renewalStatus: true,
              zohoEstimateStatus: true,
              domain: { select: { domainName: true } },
            },
          },
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return { subscriptions, total, page, limit };
  }

  // ------------------------------------------------------------------
  // Find one
  // ------------------------------------------------------------------
  async findOne(id: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, zohoOrgId: true, dataCenter: true } },
        domain:       { select: { id: true, domainName: true } },
        originLead:   { select: { id: true, leadNumber: true, companyName: true } },
        originQuickQuote: { select: { id: true, quoteNumber: true } },
        renewalHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    return sub;
  }

  // ------------------------------------------------------------------
  // Bulk Actions
  // ------------------------------------------------------------------
  async bulkUpdatePrice(dto: BulkUpdatePriceDto, user: AuthUser) {
    const { subscriptionIds, newPrice } = dto;
    if (!subscriptionIds.length) {
      throw new BadRequestException('No subscriptions selected');
    }

    const res = await this.prisma.subscription.updateMany({
      where: { id: { in: subscriptionIds } },
      data: {
        subscriptionPrice: newPrice,
      },
    });

    for (const subId of subscriptionIds) {
      await this.auditLogs.logAction({
        entityType: 'subscription',
        entityId: subId,
        action: 'update',
        changeSummary: `Subscription price bulk updated to ${newPrice}`,
        userId: user.id,
        userEmailSnapshot: user.email,
      });
    }

    this.logger.log(`Bulk updated price for ${res.count} subscriptions to ${newPrice}`);
    return { success: true, count: res.count };
  }

  async bulkUpdateStatus(dto: { subscriptionIds: string[], status: string }, user: AuthUser) {
    const { subscriptionIds, status } = dto;
    const result = await this.prisma.subscription.updateMany({
      where: { id: { in: subscriptionIds } },
      data: { lifecycleStatus: status as SubscriptionLifecycleStatus }
    });

    for (const subId of subscriptionIds) {
      await this.auditLogs.logAction({
        entityType: 'subscription',
        entityId: subId,
        action: 'update',
        changeSummary: `Subscription status bulk updated to ${status}`,
        userId: user.id,
        userEmailSnapshot: user.email,
      });
    }

    return { updatedCount: result.count };
  }

  async bulkRenewalQuote(dto: BulkRenewalQuoteDto) {
    const { subscriptionIds, priceOverrides } = dto;
    if (!subscriptionIds.length) throw new BadRequestException('No subscriptions selected');

    // 1. Fetch all selected subscriptions with needed relations
    const subs = await this.prisma.subscription.findMany({
      where: { id: { in: subscriptionIds } },
      include: {
        organization: true,
        domain: true,
      },
    });

    if (!subs.length) throw new NotFoundException('Subscriptions not found');

    // 2. Group subscriptions PER CUSTOMER (not per item): a customer whose subs
    //    share cycle + end-month gets ONE quote even across different items —
    //    mixed-item groups are built as a multi-line estimate via the combined-
    //    quote engine below (user decision 2026-07-16; was one quote per item).
    // Key: orgId_zohoCustomerId_billingCycle_endMonthYear
    const groups = new Map<string, typeof subs>();

    for (const sub of subs) {
      if (!['Active', 'Expiring_Soon', 'Expired'].includes(sub.lifecycleStatus)) {
        this.logger.warn(`Skipping sub ${sub.id} (Status: ${sub.lifecycleStatus})`);
        continue;
      }

      const endDate = new Date(sub.endDate);
      const monthYear = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
      const key = `${sub.organizationId}_${sub.zohoCustomerId}_${sub.billingCycle}_${monthYear}`;

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(sub);
    }

    const results = [];
    let totalAmountSummary = 0;

    // Legacy per-item override key (kept so any caller still sending the old
    // orgId_cust_item_cycle_month keys keeps working).
    const legacyKeyOf = (s: (typeof subs)[number]) => {
      const e = new Date(s.endDate);
      const my = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}`;
      return `${s.organizationId}_${s.zohoCustomerId}_${s.zohoItemId}_${s.billingCycle}_${my}`;
    };

    // 3. Process each group
    for (const [key, groupSubs] of groups.entries()) {
      try {
        const firstSub = groupSubs[0];

        // Mixed items (or mixed rates) in one customer-group → one multi-line
        // estimate via the combined-quote engine (lines merged by item+dates+rate,
        // per-line ≥100-domain annexure handled there).
        const uniform = new Set(groupSubs.map((s) =>
          `${s.zohoItemId}|${Number(s.nextRenewalPrice ?? s.subscriptionPrice)}`,
        )).size === 1;
        if (!uniform) {
          const combinedOverrides: Record<string, number> = {};
          for (const s of groupSubs) {
            const o = priceOverrides?.[legacyKeyOf(s)] ?? priceOverrides?.[key];
            if (o !== undefined) combinedOverrides[s.id] = Number(o);
          }
          const combined = await this.combinedRenewalQuote({
            subscriptionIds: groupSubs.map((s) => s.id),
            ...(Object.keys(combinedOverrides).length ? { priceOverrides: combinedOverrides } : {}),
          });
          totalAmountSummary += combined.totalAmount;
          results.push({
            groupKey: key,
            zohoCustomerName: firstSub.zohoCustomerName,
            zohoItemName: `Combined (${combined.lineCount} lines · ${combined.domainCount} domains)`,
            domainCount: combined.domainCount,
            totalAmount: combined.totalAmount,
            zohoEstimateNumber: combined.zohoEstimateNumber,
            hasAnnexure: false,
            renewalBatchId: combined.renewalBatchId,
            subscriptionIds: combined.subscriptionIds,
          });
          this.logger.log(
            `Created combined bulk quote ${combined.zohoEstimateNumber} (${combined.lineCount} lines / ${combined.domainCount} domains)`,
          );
          continue;
        }
        const domainCount = groupSubs.length;
        
        // Determine unit price
        // Prioritize: Override > nextRenewalPrice > subscriptionPrice
        const groupOverride = priceOverrides?.[key] ?? priceOverrides?.[legacyKeyOf(firstSub)];
        const unitPrice = groupOverride !== undefined 
          ? Number(groupOverride)
          : Number(firstSub.nextRenewalPrice ?? firstSub.subscriptionPrice);

        const totalAmount = unitPrice * domainCount;
        totalAmountSummary += totalAmount;

        // Determine new dates based on firstSub's cycle
        const newStartDate = new Date(firstSub.endDate);
        newStartDate.setDate(newStartDate.getDate() + 1);
        const newEndDate = this.addBillingCycle(newStartDate, firstSub.billingCycle as BillingCycle);
        // adjust end date to be inclusive (e.g. minus 1 day)
        const adjustedEndDate = new Date(newEndDate);
        adjustedEndDate.setDate(adjustedEndDate.getDate() - 1);

        const isBulk = domainCount >= 100;

        // "first-domain +N more" summary for the Domain Name fields (per user: single
        // aggregated line, so we can't list every domain in the per-line field).
        const firstDomain = firstSub.domain.domainName;
        const domainSummary = domainCount > 1 ? `${firstDomain} +${domainCount - 1} more` : firstDomain;

        // Build description (Indian DD/MM/YYYY dates in the human-readable text).
        let description = `Renewal Period: ${this.formatDateDMY(newStartDate)} to ${this.formatDateDMY(adjustedEndDate)}`;
        if (isBulk) {
          description += `\nRenewal for ${domainCount} domains (Complete domain list attached in Technical Annexure)`;
        } else {
          description += `\nDomains:\n` + groupSubs.map(s => s.domain.domainName).join('\n');
        }

        // Header + line-item custom fields, both via the org-aware mapping helper
        // (never hardcode Zoho labels/api_names — they vary per org; e.g. this org's
        // field is labelled "Business Type?" not "Business Type", which 400'd the create).
        const businessTypeLabel = await this.zoho.getBusinessTypeLabel(firstSub.organizationId, 'Renewal');
        const { options: billingOpts } = await this.zoho.getBillingOptions(firstSub.organizationId);
        const subsPeriodLabel =
          billingOpts.find(o => o.value === firstSub.billingCycle)?.label
          || this.billingCycleZohoLabel(firstSub.billingCycle);
        const startIso = this.formatDate(newStartDate);
        const endIso = this.formatDate(adjustedEndDate);
        const costStr = firstSub.costPrice != null ? String(Number(firstSub.costPrice)) : '';

        const estimateCf = await this.zoho.buildCustomFields(firstSub.organizationId, 'estimates', {
          business_type:  businessTypeLabel,   // → cf_new_business
          billing_period: subsPeriodLabel,     // → cf_billing_period
          domain_name:    domainSummary,       // → cf_domain_name (header)
          service_expiry: endIso,              // → cf_next_invoice_date
          quantity:       String(domainCount), // → cf_total_licences
        });
        const lineItemCf = await this.zoho.buildCustomFields(firstSub.organizationId, 'items', {
          domain_name: domainSummary,          // → cf_domain_name (line item)
          start_date:  startIso,               // → cf_subscription_start_date
          end_date:    endIso,                 // → cf_subscription_end_date
          cost_price:  costStr,                // → cf_cost_price
        });

        // Build Zoho Estimate Payload
        const estimatePayload = {
          customer_id: firstSub.zohoCustomerId,
          date: this.formatDate(new Date()),
          expiry_date: endIso,
          line_items: [
            {
              item_id: firstSub.zohoItemId,
              name: firstSub.zohoItemName || 'Subscription Renewal',
              description,
              rate: unitPrice,
              quantity: domainCount,
              ...(lineItemCf.length ? { item_custom_fields: lineItemCf } : {}),
            }
          ],
          ...(estimateCf.length ? { custom_fields: estimateCf } : {}),
        };

        // Create Estimate in Zoho
        const client = await this.zoho.clientFor(firstSub.organizationId);
        const estimateRes = await client.post<{ code: number; message: string; estimate: any }>('/estimates', estimatePayload);
        
        if (estimateRes.code !== 0) {
          throw new Error(`Zoho Error: ${estimateRes.message}`);
        }

        const estimate = estimateRes.estimate;

        const annexureData = isBulk ? groupSubs.map(s => ({
          domainName: s.domain.domainName,
          status: s.lifecycleStatus
        })) : null;

        if (isBulk) {
          // Fire and forget, or await it if we want to ensure it's attached before finishing
          await this.annexure.generateAndUploadAnnexure(
            firstSub.organizationId,
            estimate.estimate_id,
            estimate.estimate_number,
            annexureData! as { domainName: string; status: string }[]
          );
        }

        // Save RenewalHistories & Update Subscriptions

        const batch = await this.prisma.renewalBatch.create({
          data: {
            organizationId: firstSub.organizationId,
            zohoCustomerId: firstSub.zohoCustomerId,
            zohoCustomerName: firstSub.zohoCustomerName,
            zohoItemId: firstSub.zohoItemId,
            zohoItemName: firstSub.zohoItemName,
            billingCycle: firstSub.billingCycle,
            domainCount,
            unitPrice,
            totalAmount,
            zohoEstimateId: estimate.estimate_id,
            zohoEstimateNumber: estimate.estimate_number,
            hasAnnexure: isBulk,
            annexureData: annexureData ?? undefined,
          }
        });

        // Save RenewalHistories & Update Subscriptions
        const subIds = groupSubs.map(s => s.id);
        
        await this.prisma.$transaction(async (tx) => {
          for (const s of groupSubs) {
            await tx.renewalHistory.create({
              data: {
                subscriptionId: s.id,
                organizationId: s.organizationId,
                domainId: s.domainId,
                businessType: 'Renewal',
                billingCycle: s.billingCycle as BillingCycle,
                quantity: 1, // per sub, it's 1 domain
                sellingPrice: unitPrice,
                subtotalAmount: unitPrice,
                renewalStatus: 'Quoted',
                zohoEstimateStatus: 'draft',
                quoteId: estimate.estimate_id,
                quoteNumber: estimate.estimate_number,
                quoteDate: new Date(),
                rawQuotePayload: estimate,
                bulkRenewalBatchId: batch.id,
              }
            });
          }

          await tx.subscription.updateMany({
            where: { id: { in: subIds } },
            data: { processStatus: 'Renewal_Quoted' }
          });
        });

        results.push({
          groupKey: key,
          zohoCustomerName: firstSub.zohoCustomerName,
          zohoItemName: firstSub.zohoItemName,
          domainCount,
          totalAmount,
          zohoEstimateNumber: estimate.estimate_number,
          hasAnnexure: isBulk,
          renewalBatchId: batch.id,
          subscriptionIds: subIds,
        });

        this.logger.log(`Created bulk quote ${estimate.estimate_number} for ${domainCount} domains`);

      } catch (err: any) {
        this.logger.error(`Failed to process group ${key}: ${err.message}`);
        results.push({ groupKey: key, error: err.message });
      }
    }

    const failed = results.filter((r): r is { groupKey: string; error: string } => 'error' in r);
    const succeeded = results.filter((r) => !('error' in r));
    return {
      batches: results,
      totalGroups: groups.size,
      totalAmount: totalAmountSummary,
      createdCount: succeeded.length,
      failedCount: failed.length,
      estimateNumbers: succeeded.map((r) => (r as { zohoEstimateNumber?: string }).zohoEstimateNumber).filter(Boolean),
      // Batch ids of the just-created runs — the UI navigates to the batch review screen with these.
      batchIds: succeeded.map((r) => (r as { renewalBatchId?: string }).renewalBatchId).filter(Boolean),
      errors: failed.map((r) => r.error),
    };
  }

  // ------------------------------------------------------------------
  // Combined single quote — collapse many subscriptions of ONE customer
  // (mixed items / cycles / renewal months) into a single multi-line Zoho
  // estimate. Each subscription becomes its own line item carrying its own
  // renewal period + domain; the estimate HEADER custom fields are taken from
  // the subscription whose renewal date is nearest / most overdue (earliest
  // endDate). One RenewalBatch links every sub's history to the one estimate.
  // ------------------------------------------------------------------
  async combinedRenewalQuote(dto: CombinedRenewalQuoteDto) {
    const { subscriptionIds, priceOverrides } = dto;
    if (!subscriptionIds?.length) throw new BadRequestException('No subscriptions selected');

    const subs = await this.prisma.subscription.findMany({
      where: { id: { in: subscriptionIds } },
      include: { organization: true, domain: true },
    });
    if (!subs.length) throw new NotFoundException('Subscriptions not found');

    // A combined quote is per-customer: every selected sub must share org + customer.
    const orgId = subs[0].organizationId;
    const custId = subs[0].zohoCustomerId;
    if (subs.some((s) => s.organizationId !== orgId || s.zohoCustomerId !== custId)) {
      throw new BadRequestException('Combined quote requires all subscriptions from the same customer & organization');
    }

    // Only renewable subs contribute to the quote.
    const renewable = subs.filter((s) => ['Active', 'Expiring_Soon', 'Expired'].includes(s.lifecycleStatus));
    if (!renewable.length) {
      throw new BadRequestException('No renewable subscriptions (Active / Expiring Soon / Expired) selected');
    }

    // Header comes from the nearest-renewal / most-overdue sub (earliest endDate).
    const headerSub = [...renewable].sort(
      (a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime(),
    )[0];

    // Compute each subscription's renewal term/price. Each domain keeps its own
    // renewal_history row regardless of how estimate lines are grouped below.
    type SubInfo = {
      sub: (typeof renewable)[number];
      unitPrice: number;
      qty: number;
      newStart: Date;
      adjEnd: Date;
      startIso: string;
      endIso: string;
    };
    const subInfos: SubInfo[] = renewable.map((s) => {
      const newStart = new Date(s.endDate);
      newStart.setDate(newStart.getDate() + 1);
      const newEnd = this.addBillingCycle(newStart, s.billingCycle as BillingCycle);
      const adjEnd = new Date(newEnd);
      adjEnd.setDate(adjEnd.getDate() - 1);
      const override = priceOverrides?.[s.id];
      const unitPrice = override !== undefined
        ? Number(override)
        : Number(s.nextRenewalPrice ?? s.subscriptionPrice);
      const qty = Number(s.quantity) || 1;
      return {
        sub: s, unitPrice, qty, newStart, adjEnd,
        startIso: this.formatDate(newStart), endIso: this.formatDate(adjEnd),
      };
    });

    const totalAmount = subInfos.reduce((sum, si) => sum + si.unitPrice * si.qty, 0);

    // Merge into estimate lines: ONE line per (item + renewal period + rate). Subs
    // sharing all three collapse into a single line; the domains (with their
    // quantities) are listed in that line's description as "domain.com (qty)".
    const lineGroups = new Map<string, SubInfo[]>();
    for (const si of subInfos) {
      const key = `${si.sub.zohoItemId}::${si.startIso}::${si.endIso}::${si.unitPrice}`;
      const arr = lineGroups.get(key);
      if (arr) arr.push(si);
      else lineGroups.set(key, [si]);
    }

    const BULK_THRESHOLD = 100; // ≥100 domains in one line → summarize + annexure (like "Generate Bulk Quotes")
    const lineItems: any[] = [];
    const bulkAnnexures: { domains: SubInfo[]; label: string; subtitle: string }[] = [];
    let lineIdx = 0;

    for (const group of lineGroups.values()) {
      lineIdx++;
      const first = group[0];
      const domainCount = group.length;
      const lineQty = group.reduce((sum, g) => sum + g.qty, 0);
      const isBulk = domainCount >= BULK_THRESHOLD;
      const period = `${this.formatDateDMY(first.newStart)} to ${this.formatDateDMY(first.adjEnd)}`;

      let description = `Renewal Period: ${period}`;
      if (isBulk) {
        description += `\nRenewal for ${domainCount} domains (Complete domain list attached in Technical Annexure)`;
        bulkAnnexures.push({
          domains: group,
          label: `L${lineIdx}`,
          subtitle: `${first.sub.zohoItemName ?? 'Item'} · ${period}`,
        });
      } else {
        description += `\nDomains:\n` + group.map((g) => `${g.sub.domain.domainName} (${g.qty})`).join('\n');
      }

      const firstDomain = first.sub.domain.domainName;
      const domainSummary = domainCount > 1 ? `${firstDomain} +${domainCount - 1} more` : firstDomain;
      const costStr = first.sub.costPrice != null ? String(Number(first.sub.costPrice)) : '';

      const lineItemCf = await this.zoho.buildCustomFields(orgId, 'items', {
        domain_name: domainSummary,
        start_date:  first.startIso,
        end_date:    first.endIso,
        cost_price:  costStr,
      });

      lineItems.push({
        item_id: first.sub.zohoItemId,
        name: first.sub.zohoItemName || 'Subscription Renewal',
        description,
        rate: first.unitPrice,
        quantity: lineQty,
        ...(lineItemCf.length ? { item_custom_fields: lineItemCf } : {}),
      });
    }

    // Header custom fields — from the nearest-renewal sub (per user's decision).
    const headerStart = new Date(headerSub.endDate);
    headerStart.setDate(headerStart.getDate() + 1);
    const headerEnd = this.addBillingCycle(headerStart, headerSub.billingCycle as BillingCycle);
    const headerAdjEnd = new Date(headerEnd);
    headerAdjEnd.setDate(headerAdjEnd.getDate() - 1);
    const headerEndIso = this.formatDate(headerAdjEnd);

    const businessTypeLabel = await this.zoho.getBusinessTypeLabel(orgId, 'Renewal');
    const { options: billingOpts } = await this.zoho.getBillingOptions(orgId);
    const headerPeriodLabel =
      billingOpts.find((o) => o.value === headerSub.billingCycle)?.label
      || this.billingCycleZohoLabel(headerSub.billingCycle);
    const domainSummary = renewable.length > 1
      ? `${headerSub.domain.domainName} +${renewable.length - 1} more`
      : headerSub.domain.domainName;

    const estimateCf = await this.zoho.buildCustomFields(orgId, 'estimates', {
      business_type:  businessTypeLabel,
      billing_period: headerPeriodLabel,
      domain_name:    domainSummary,
      service_expiry: headerEndIso,
      quantity:       String(renewable.length),
    });

    const estimatePayload = {
      customer_id: custId,
      date: this.formatDate(new Date()),
      expiry_date: headerEndIso,
      line_items: lineItems,
      ...(estimateCf.length ? { custom_fields: estimateCf } : {}),
    };

    const client = await this.zoho.clientFor(orgId);
    const estimateRes = await client.post<{ code: number; message: string; estimate: any }>('/estimates', estimatePayload);
    if (estimateRes.code !== 0) {
      throw new Error(`Zoho Error: ${estimateRes.message}`);
    }
    const estimate = estimateRes.estimate;

    // Attach a Technical Annexure per large (≥100-domain) line group.
    for (const a of bulkAnnexures) {
      await this.annexure.generateAndUploadAnnexure(
        orgId,
        estimate.estimate_id,
        estimate.estimate_number,
        a.domains.map((d) => ({
          domainName: d.sub.domain.domainName,
          status:     d.sub.lifecycleStatus,
          quantity:   d.qty,
        })),
        { subtitle: a.subtitle, fileLabel: a.label },
      );
    }

    // Persist one RenewalBatch (scalar summary columns carry header/representative
    // values; the full per-domain breakdown lives in annexureData) + link every sub.
    const batch = await this.prisma.renewalBatch.create({
      data: {
        organizationId:   orgId,
        zohoCustomerId:   custId,
        zohoCustomerName: headerSub.zohoCustomerName,
        zohoItemId:       headerSub.zohoItemId,
        zohoItemName:     `Combined Quote (${lineGroups.size} lines · ${renewable.length} domains)`,
        billingCycle:     headerSub.billingCycle,
        domainCount:      renewable.length,
        unitPrice:        headerSub.subscriptionPrice,
        totalAmount,
        zohoEstimateId:     estimate.estimate_id,
        zohoEstimateNumber: estimate.estimate_number,
        hasAnnexure:      bulkAnnexures.length > 0,
        annexureData: subInfos.map((si) => ({
          domainName: si.sub.domain.domainName,
          itemName:   si.sub.zohoItemName,
          unitPrice:  si.unitPrice,
          quantity:   si.qty,
          startDate:  si.startIso,
          endDate:    si.endIso,
        })),
      },
    });

    const subIds = renewable.map((s) => s.id);
    await this.prisma.$transaction(async (tx) => {
      for (const si of subInfos) {
        await tx.renewalHistory.create({
          data: {
            subscriptionId:  si.sub.id,
            organizationId:  orgId,
            domainId:        si.sub.domainId,
            businessType:    'Renewal',
            billingCycle:    si.sub.billingCycle as BillingCycle,
            quantity:        si.qty,
            sellingPrice:    si.unitPrice,
            subtotalAmount:  si.unitPrice * si.qty,
            serviceStartDate: si.newStart,
            serviceEndDate:   si.adjEnd,
            renewalStatus:   'Quoted',
            zohoEstimateStatus: 'draft',
            quoteId:         estimate.estimate_id,
            quoteNumber:     estimate.estimate_number,
            quoteDate:       new Date(),
            rawQuotePayload: estimate,
            bulkRenewalBatchId: batch.id,
          },
        });
      }
      await tx.subscription.updateMany({
        where: { id: { in: subIds } },
        data: { processStatus: 'Renewal_Quoted' },
      });
    });

    this.logger.log(
      `Created combined quote ${estimate.estimate_number} for customer ${custId} — ${lineGroups.size} lines / ${renewable.length} domains, total ${totalAmount}`,
    );

    return {
      renewalBatchId: batch.id,
      zohoEstimateId: estimate.estimate_id,
      zohoEstimateNumber: estimate.estimate_number,
      lineCount: lineGroups.size,
      domainCount: renewable.length,
      totalAmount,
      skippedCount: subs.length - renewable.length,
      subscriptionIds: subIds,
    };
  }

  // ------------------------------------------------------------------
  // Bulk Export / Import CSV
  // ------------------------------------------------------------------
  async exportCsv(params: {
    orgId?: string;
    status?: string;
    billingCycle?: string;
    expiringDays?: number;
    search?: string;
  }) {
    // Re-use the list filtering logic
    const { orgId, status, billingCycle, expiringDays, search } = params;
    
    const where: Record<string, unknown> = {};
    if (orgId)        where.organizationId = orgId;
    if (billingCycle) where.billingCycle = billingCycle;
    Object.assign(where, this.buildLifecycleWhere(status, expiringDays));
    if (search) {
      where.OR = [
        { subscriptionNumber: { contains: search, mode: 'insensitive' } },
        { zohoCustomerName:   { contains: search, mode: 'insensitive' } },
        { zohoItemName:       { contains: search, mode: 'insensitive' } },
        { domain: { domainName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where,
      include: {
        domain: true,
        organization: true,
      },
      orderBy: { endDate: 'asc' },
    });

    const csvData = subscriptions.map(sub => ({
      ID: sub.id,
      Subscription_Number: sub.subscriptionNumber,
      Customer_Name: sub.zohoCustomerName,
      Item_Name: sub.zohoItemName,
      Domain_Name: sub.domain?.domainName,
      Start_Date: sub.startDate ? this.formatDate(sub.startDate) : '',
      End_Date: sub.endDate ? this.formatDate(sub.endDate) : '',
      Billing_Cycle: sub.billingCycle,
      Quantity: Number(sub.quantity),
      Price: Number(sub.subscriptionPrice),
      Next_Renewal_Price: sub.nextRenewalPrice ? Number(sub.nextRenewalPrice) : '',
      Cost: Number(sub.costPrice),
      Status: sub.lifecycleStatus,
    }));

    return Papa.unparse(csvData);
  }

  async importCsv(fileBuffer: Buffer, fileName?: string, createdBy?: string) {
    const csvString = fileBuffer.toString('utf-8');
    const parsed = Papa.parse(csvString, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      throw new BadRequestException(`CSV Parsing Error: ${parsed.errors[0].message}`);
    }

    const rows = parsed.data as any[];
    let updatedCount = 0;

    // Structured records — kept in full in csv_import_logs even when the
    // human-readable string arrays returned to the caller get long.
    const skippedRows: { row: number; id: string | null; reason: string }[] = [];
    const errorRows: { row: number; id: string | null; reason: string }[] = [];

    // Valid statuses from prisma enum
    const validStatuses = [
      'Pending', 'Active', 'Expiring_Soon', 'Expired',
      'Inactive', 'Cancelled'
    ];

    const parseDateString = (dateStr: string): Date | null => {
      if (!dateStr) return null;
      // Handle DD-MM-YYYY or DD/MM/YYYY
      if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(dateStr)) {
        const parts = dateStr.split(/[-/]/);
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }
      const d2 = new Date(dateStr);
      return isNaN(d2.getTime()) ? null : d2;
    };

    const shortId = (id: string) => (id.length > 8 ? `${id.substring(0, 8)}...` : id);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +1 for 0-index, +1 for header row
      const rawId = row['ID'];
      const subId = rawId ? String(rawId).trim() : '';

      if (!subId) {
        skippedRows.push({ row: rowNum, id: null, reason: 'Blank ID column — row skipped' });
        continue;
      }

      try {
        const updateData: any = {};

        const parseMoney = (field: string, label: string) => {
          if (row[field] === undefined || row[field] === '') return;
          const n = Number(row[field]);
          if (Number.isNaN(n)) throw new Error(`Invalid ${label}: "${row[field]}"`);
          return n;
        };

        const price = parseMoney('Price', 'Price');
        if (price !== undefined) updateData.subscriptionPrice = price;
        const nextRenewalPrice = parseMoney('Next_Renewal_Price', 'Next_Renewal_Price');
        if (nextRenewalPrice !== undefined) updateData.nextRenewalPrice = nextRenewalPrice;
        const cost = parseMoney('Cost', 'Cost');
        if (cost !== undefined) updateData.costPrice = cost;

        if (row['Start_Date']) {
          const d = parseDateString(row['Start_Date']);
          if (d) updateData.startDate = d;
          else throw new Error(`Invalid Start_Date: "${row['Start_Date']}"`);
        }
        if (row['End_Date']) {
          const d = parseDateString(row['End_Date']);
          if (d) updateData.endDate = d;
          else throw new Error(`Invalid End_Date: "${row['End_Date']}"`);
        }

        if (row['Status']) {
          let st = row['Status'].trim();
          if (/^suspend(ed)?$/i.test(st)) st = 'Inactive';
          if (/^cancel(led)?$/i.test(st)) st = 'Cancelled';
          if (/^expire(d)?$/i.test(st)) st = 'Expired';
          if (/^active$/i.test(st)) st = 'Active';
          if (/^pending$/i.test(st)) st = 'Pending';
          if (/^inactive$/i.test(st)) st = 'Inactive';
          if (/^expiring\s*soon$/i.test(st)) st = 'Expiring_Soon';

          if (validStatuses.includes(st)) {
            updateData.lifecycleStatus = st as SubscriptionLifecycleStatus;
          } else {
             throw new Error(`Invalid Status: "${row['Status']}"`);
          }
        }

        if (Object.keys(updateData).length === 0) {
          skippedRows.push({
            row: rowNum, id: subId,
            reason: 'No recognized columns had values — nothing to update',
          });
          continue;
        }

        await this.prisma.subscription.update({
          where: { id: subId },
          data: updateData,
        });
        updatedCount++;
      } catch (err: unknown) {
        let reason: string;
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          reason = `Subscription ID not found in database: ${subId}`;
        } else {
          reason = err instanceof Error ? err.message : String(err);
        }
        errorRows.push({ row: rowNum, id: subId, reason });
      }
    }

    const importLog = await this.prisma.csvImportLog.create({
      data: {
        importType: 'subscriptions_bulk_update',
        fileName: fileName ?? undefined,
        totalRows: rows.length,
        updatedCount,
        skippedCount: skippedRows.length,
        errorCount: errorRows.length,
        skippedRows: skippedRows as unknown as Prisma.InputJsonValue,
        errorRows: errorRows as unknown as Prisma.InputJsonValue,
        createdBy: createdBy ?? undefined,
      },
    });

    this.logger.log(
      `CSV import (${importLog.id}): ${rows.length} rows → ${updatedCount} updated, ${skippedRows.length} skipped, ${errorRows.length} errors`,
    );

    const fmt = (r: { row: number; id: string | null; reason: string }) =>
      r.id ? `Row ${r.row} (ID ${shortId(r.id)}): ${r.reason}` : `Row ${r.row}: ${r.reason}`;

    return {
      success: true,
      importLogId: importLog.id,
      totalRows: rows.length,
      updatedCount,
      skippedCount: skippedRows.length,
      errorCount: errorRows.length,
      skipped: skippedRows.length > 0 ? skippedRows.map(fmt) : undefined,
      errors: errorRows.length > 0 ? errorRows.map(fmt) : undefined,
    };
  }

  // ------------------------------------------------------------------
  // CSV Import Logs — audit trail (see csv_import_logs / CsvImportLog)
  // ------------------------------------------------------------------
  async listImportLogs(limit = 20) {
    return this.prisma.csvImportLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, importType: true, fileName: true,
        totalRows: true, updatedCount: true, createdCount: true, enrichedCount: true,
        skippedCount: true, errorCount: true,
        createdBy: true, createdAt: true,
      },
    });
  }

  async getImportLog(id: string) {
    const log = await this.prisma.csvImportLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException(`Import log ${id} not found`);
    return log;
  }

  /** CSV of just the error rows for a given import log — for the user to fix and re-upload. */
  async getImportLogErrorsCsv(id: string): Promise<string> {
    const log = await this.getImportLog(id);
    const errorRows = (log.errorRows as unknown as { row: number; id: string | null; reason: string }[] | null) ?? [];
    const skippedRows = (log.skippedRows as unknown as { row: number; id: string | null; reason: string }[] | null) ?? [];
    const warningRows = (log.warningRows as unknown as { row: number; id: string | null; reason: string }[] | null) ?? [];

    const csvData = [
      ...errorRows.map((r) => ({ Row: r.row, ID: r.id ?? '', Type: 'Error', Reason: r.reason })),
      ...warningRows.map((r) => ({ Row: r.row, ID: r.id ?? '', Type: 'Warning', Reason: r.reason })),
      ...skippedRows.map((r) => ({ Row: r.row, ID: r.id ?? '', Type: 'Skipped', Reason: r.reason })),
    ].sort((a, b) => a.Row - b.Row);

    return Papa.unparse(csvData);
  }

  // ------------------------------------------------------------------
  // CSV Bulk-CREATE importer (Track A) — distinct from the update-only importCsv.
  // Resolves Zoho customer/item refs, auto-creates domains, feeds the shared
  // applyImportItem core, and reports created / enriched / warnings / errors.
  // ------------------------------------------------------------------
  async importCreateCsv(fileBuffer: Buffer, fileName?: string, createdBy?: string) {
    const csvString = fileBuffer.toString('utf-8');
    const parsed = Papa.parse(csvString, { header: true, skipEmptyLines: true });
    if (parsed.errors.length > 0) {
      throw new BadRequestException(`CSV Parsing Error: ${parsed.errors[0].message}`);
    }
    const rows = parsed.data as Record<string, string>[];

    let createdCount = 0;
    let enrichedCount = 0;
    const warningRows: { row: number; id: string | null; reason: string }[] = [];
    const errorRows: { row: number; id: string | null; reason: string }[] = [];

    // Header accessor tolerant of spacing/casing/underscores ("Item Name" == "item_name").
    const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '');
    const get = (row: Record<string, string>, ...names: string[]): string => {
      for (const n of names) if (row[n] !== undefined) return String(row[n]).trim();
      for (const n of names) {
        const key = Object.keys(row).find((k) => norm(k) === norm(n));
        if (key) return String(row[key]).trim();
      }
      return '';
    };

    // Org resolution — default to the single active org when no column is given.
    const activeOrgs = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true, name: true, zohoOrgId: true, baseCurrency: true },
    });
    const orgCache = new Map<string, string | null>();
    const resolveOrg = (orgVal: string): string | null => {
      if (!orgVal) return activeOrgs.length === 1 ? activeOrgs[0].id : null;
      if (orgCache.has(orgVal)) return orgCache.get(orgVal) ?? null;
      const m = activeOrgs.find(
        (o) => o.name.toLowerCase() === orgVal.toLowerCase() || o.zohoOrgId === orgVal,
      );
      orgCache.set(orgVal, m?.id ?? null);
      return m?.id ?? null;
    };

    const seenKeys = new Set<string>(); // intra-file duplicate detection

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +1 for 0-index, +1 for header row
      const custNumber = get(row, 'Customer Number');
      const domainName = get(row, 'Domain Name');
      const itemKey    = get(row, 'Item ID', 'SKU', 'Item SKU');
      const itemName   = get(row, 'Item Name');
      const label = domainName || custNumber || `row ${rowNum}`;

      try {
        if (!custNumber) throw new Error('Missing Customer Number');
        if (!domainName) throw new Error('Missing Domain Name');
        if (!itemKey && !itemName) throw new Error('Missing Item (need Item ID/SKU or Item Name)');

        // Organization
        const orgId = resolveOrg(get(row, 'Organization', 'Org'));
        if (!orgId) {
          throw new Error(
            get(row, 'Organization', 'Org')
              ? `Organization not found: "${get(row, 'Organization', 'Org')}"`
              : 'Multiple active organizations — add an "Organization" column',
          );
        }

        // Customer — resolve Customer Number (Zoho contact_number in cache.extra)
        const custMatches = await this.prisma.zohoCache.findMany({
          where: {
            organizationId: orgId, entityType: 'customer',
            extra: { path: ['contact_number'], equals: custNumber },
          },
          take: 2,
        });
        if (custMatches.length === 0) throw new Error(`Customer Number "${custNumber}" not found in Zoho cache — sync Zoho first`);
        if (custMatches.length > 1)  throw new Error(`Customer Number "${custNumber}" is ambiguous (matches ${custMatches.length})`);
        const customer = custMatches[0];

        // Item — prefer ID/SKU, else fall back to Name
        let item: { zohoId: string; displayName: string | null } | null = null;
        if (itemKey) {
          item = await this.prisma.zohoCache.findFirst({
            where: {
              organizationId: orgId, entityType: 'item',
              OR: [{ zohoId: itemKey }, { extra: { path: ['sku'], equals: itemKey } }],
            },
          });
          if (!item) throw new Error(`Item ID/SKU "${itemKey}" not found in Zoho cache`);
        } else {
          const itemMatches = await this.prisma.zohoCache.findMany({
            where: { organizationId: orgId, entityType: 'item', displayName: { equals: itemName, mode: 'insensitive' } },
            take: 2,
          });
          if (itemMatches.length === 0) throw new Error(`Item Name "${itemName}" not found in Zoho cache`);
          if (itemMatches.length > 1)  throw new Error(`Item Name "${itemName}" is ambiguous — use an Item ID/SKU column`);
          item = itemMatches[0];
        }

        // Billing cycle
        const cycleRaw = get(row, 'Billing Cycle', 'Subs Period');
        if (!cycleRaw) throw new Error('Missing Billing Cycle');
        const billingCycle = this.mapBillingCycleLabel(cycleRaw);
        if (!billingCycle) throw new Error(`Unrecognized Billing Cycle: "${cycleRaw}"`);

        // Dates
        const startRaw = get(row, 'Start Date');
        const endRaw   = get(row, 'End Date');
        if (!startRaw) throw new Error('Missing Start Date');
        if (!endRaw)   throw new Error('Missing End Date');
        const startDate = this.parseFlexibleDate(startRaw);
        const endDate   = this.parseFlexibleDate(endRaw);
        if (!startDate) throw new Error(`Invalid Start Date: "${startRaw}"`);
        if (!endDate)   throw new Error(`Invalid End Date: "${endRaw}"`);
        if (endDate < startDate) throw new Error(`End Date (${endRaw}) is before Start Date (${startRaw})`);

        // Price / quantity / cost
        const priceRaw = get(row, 'Price');
        if (priceRaw === '') throw new Error('Missing Price');
        const price = Number(priceRaw);
        if (Number.isNaN(price) || price < 0) throw new Error(`Invalid Price: "${priceRaw}"`);
        const qtyRaw = get(row, 'Quantity', 'Qty');
        const quantity = qtyRaw === '' ? 1 : Number(qtyRaw);
        if (Number.isNaN(quantity) || quantity <= 0) throw new Error(`Invalid Quantity: "${qtyRaw}"`);
        const costRaw = get(row, 'Cost', 'Cost Price');
        const costPrice = costRaw === '' ? 0 : Number(costRaw);
        if (Number.isNaN(costPrice) || costPrice < 0) throw new Error(`Invalid Cost: "${costRaw}"`);

        // Currency — must match the customer's Zoho currency when provided; else default to it.
        const baseCurrency = (activeOrgs.find((o) => o.id === orgId)?.baseCurrency ?? 'INR').toUpperCase();
        const custCurrency = ((customer.extra as { currency_code?: string } | null)?.currency_code ?? '').toUpperCase();
        const providedCurrency = get(row, 'Currency').toUpperCase();
        if (providedCurrency && custCurrency && providedCurrency !== custCurrency) {
          throw new Error(`Currency ${providedCurrency} does not match customer's Zoho currency ${custCurrency} — fix the row or leave Currency blank`);
        }
        const currency = providedCurrency || custCurrency || baseCurrency;
        const rateRaw = get(row, 'Exchange Rate', 'ExchangeRate', 'Rate');
        const exchangeRate = rateRaw === '' ? (currency === baseCurrency ? 1 : 0) : Number(rateRaw);
        if (Number.isNaN(exchangeRate) || exchangeRate < 0) throw new Error(`Invalid Exchange Rate: "${rateRaw}"`);

        // Soft warnings (row still imports)
        const warnings: string[] = [];
        if (currency !== baseCurrency && exchangeRate === 0) {
          warnings.push(`Currency ${currency} has no exchange rate — ${baseCurrency}-equivalent will be unavailable (add an "Exchange Rate" column)`);
        }
        if (billingCycle !== BillingCycle.one_time) {
          const spanCycle = this.cycleFromSpan(startDate, endDate);
          if (spanCycle !== billingCycle) {
            const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
            warnings.push(`Billing Cycle "${cycleRaw}" doesn't match the ${days}-day term (looks ${spanCycle})`);
          }
        }
        const dupKey = `${orgId}::${customer.zohoId}::${item.zohoId}::${domainName.toLowerCase()}`;
        if (seenKeys.has(dupKey)) warnings.push('Duplicate of an earlier row in this file');
        seenKeys.add(dupKey);

        // Feed the shared core (handles domain auto-create + dedup + create/enrich)
        const dto: ImportSubscriptionDto = {
          organizationId:    orgId,
          zohoCustomerId:    customer.zohoId,
          zohoCustomerName:  customer.displayName ?? undefined,
          zohoItemId:        item.zohoId,
          zohoItemName:      item.displayName ?? undefined,
          domainName,
          quantity,
          subscriptionPrice: price,
          costPrice,
          billingCycle,
          currency,
          exchangeRate,
          startDate:         this.formatDate(startDate),
          endDate:           this.formatDate(endDate),
        };
        const outcome = await this.applyImportItem(dto, {
          lifecycleStatusOnCreate: this.computeLifecycleFromEnd(endDate),
        });

        if (outcome === 'created')       createdCount++;
        else if (outcome === 'enriched') enrichedCount++;
        else warnings.push('Subscription already exists (org+customer+item+domain) — not re-created');

        if (warnings.length) warningRows.push({ row: rowNum, id: label, reason: warnings.join('; ') });
      } catch (err) {
        errorRows.push({ row: rowNum, id: label, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    const importLog = await this.prisma.csvImportLog.create({
      data: {
        importType:   'subscriptions_bulk_create',
        fileName:     fileName ?? undefined,
        totalRows:    rows.length,
        createdCount,
        enrichedCount,
        errorCount:   errorRows.length,
        warningRows:  warningRows as unknown as Prisma.InputJsonValue,
        errorRows:    errorRows as unknown as Prisma.InputJsonValue,
        createdBy:    createdBy ?? undefined,
      },
    });

    this.logger.log(
      `CSV create import (${importLog.id}): ${rows.length} rows → ${createdCount} created, ${enrichedCount} enriched, ${warningRows.length} warnings, ${errorRows.length} errors`,
    );

    const fmt = (r: { row: number; id: string | null; reason: string }) =>
      r.id ? `Row ${r.row} (${r.id}): ${r.reason}` : `Row ${r.row}: ${r.reason}`;

    return {
      success: true,
      importLogId: importLog.id,
      totalRows: rows.length,
      createdCount,
      enrichedCount,
      warningCount: warningRows.length,
      errorCount: errorRows.length,
      warnings: warningRows.length ? warningRows.map(fmt) : undefined,
      errors: errorRows.length ? errorRows.map(fmt) : undefined,
    };
  }

  /** Parse DD-MM-YYYY, DD/MM/YYYY, or ISO date strings. */
  private parseFlexibleDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(dateStr)) {
      const [d, m, y] = dateStr.split(/[-/]/).map((p) => parseInt(p, 10));
      const dt = new Date(y, m - 1, d);
      if (!isNaN(dt.getTime())) return dt;
    }
    const dt2 = new Date(dateStr);
    return isNaN(dt2.getTime()) ? null : dt2;
  }

  /** Map a friendly billing-cycle label to the BillingCycle enum (null if unknown). */
  private mapBillingCycleLabel(raw: string): BillingCycle | null {
    switch (raw.trim().toLowerCase().replace(/\s+/g, ' ')) {
      case 'monthly': case 'month':                                  return BillingCycle.monthly;
      case 'quarterly': case 'quarter':                              return BillingCycle.quarterly;
      case 'half yearly': case 'half-yearly': case 'halfyearly':
      case 'semi annual': case 'semi-annual':                        return BillingCycle.half_yearly;
      case 'annual': case 'annually': case 'yearly': case '1 year': case 'year': return BillingCycle.annual;
      case 'biennial': case '2 years': case '2 year':                return BillingCycle.biennial;
      case 'triennial': case '3 years': case '3 year':               return BillingCycle.triennial;
      case 'one time': case 'onetime': case 'one-time':              return BillingCycle.one_time;
      default: return null;
    }
  }

  /** Infer a billing cycle from the term length (for the CSV cycle-mismatch warning). */
  private cycleFromSpan(start: Date, end: Date): BillingCycle {
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (days <= 35)  return BillingCycle.monthly;
    if (days <= 95)  return BillingCycle.quarterly;
    if (days <= 190) return BillingCycle.half_yearly;
    if (days <= 370) return BillingCycle.annual;
    if (days <= 740) return BillingCycle.biennial;
    return BillingCycle.triennial;
  }

  /**
   * Build Prisma `where` conditions for lifecycle status filtering.
   * Active / Expiring_Soon / Expired are computed from endDate so stale DB values are bypassed.
   * Cancelled, Inactive, Pending are manually set and use the stored field.
   */
  private buildLifecycleWhere(status?: string, expiringDays?: number): Record<string, unknown> {
    // Use UTC midnight so date comparisons align with how Zoho date-strings are stored
    // (new Date('YYYY-MM-DD') is always parsed as UTC midnight by the JS spec).
    // Using setHours() on an IST server would shift the boundary by -5:30h, causing
    // "yesterday" subscriptions to bleed into the "expiring" filter window.
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const soonCutoff = new Date(today); soonCutoff.setUTCDate(soonCutoff.getUTCDate() + 30);
    const result: Record<string, unknown> = {};
    const dateStatuses = new Set(['Active', 'Expiring_Soon', 'Expired']);

    if (status) {
      if (status === 'Expired') {
        result.endDate = { lt: today };
        result.lifecycleStatus = { notIn: ['Cancelled', 'Inactive'] };
      } else if (status === 'Expiring_Soon') {
        result.endDate = { gte: today, lte: soonCutoff };
        result.lifecycleStatus = { notIn: ['Cancelled', 'Inactive'] };
      } else if (status === 'Active') {
        result.endDate = { gt: soonCutoff };
        result.lifecycleStatus = { notIn: ['Cancelled', 'Inactive'] };
      } else {
        result.lifecycleStatus = status;
      }
    }

    if (expiringDays) {
      const cutoff = new Date(today);
      cutoff.setUTCDate(cutoff.getUTCDate() + expiringDays);
      result.endDate = { gte: today, lte: cutoff };
      if (!status || dateStatuses.has(status)) {
        result.lifecycleStatus = { notIn: ['Cancelled', 'Inactive'] };
      }
    }

    return result;
  }

  /** Lifecycle status from the end date: Expired / Expiring_Soon (≤30d) / Active. */
  private computeLifecycleFromEnd(endDate: Date): SubscriptionLifecycleStatus {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const soon = new Date(now); soon.setDate(soon.getDate() + 30);
    if (endDate < now)  return 'Expired' as SubscriptionLifecycleStatus;
    if (endDate <= soon) return 'Expiring_Soon' as SubscriptionLifecycleStatus;
    return 'Active' as SubscriptionLifecycleStatus;
  }

  // Helper formatting Date to YYYY-MM-DD
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /** Human-readable DD/MM/YYYY (Indian format) for descriptions — NOT for Zoho date fields (those need ISO). */
  private formatDateDMY(date: Date): string {
    const [y, m, d] = this.formatDate(date).split('-');
    return `${d}/${m}/${y}`;
  }

  /**
   * Zoho "Subs Period" dropdown label for a billing cycle. Prefer the org's live
   * option labels (getBillingOptions); this static map is the fallback for when that
   * metadata is empty, so the field never silently drops. NOTE: annual → "Yearly".
   */
  private billingCycleZohoLabel(cycle: string): string {
    const map: Record<string, string> = {
      monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half Yearly',
      annual: 'Yearly', biennial: 'Biennial', triennial: 'Triennial', one_time: 'One-Time',
    };
    return map[cycle] ?? cycle;
  }

  // ------------------------------------------------------------------
  // Create (from UI manually)
  // ------------------------------------------------------------------
  async create(dto: CreateSubscriptionDto, user: AuthUser) {
    let domainId = dto.domainId;

    if (!domainId && dto.domainName) {
      let domain = await this.prisma.domain.findFirst({
        where: { domainName: dto.domainName, organizationId: dto.organizationId, zohoCustomerId: dto.zohoCustomerId },
      });
      if (!domain) {
        domain = await this.prisma.domain.create({
          data: {
            domainName: dto.domainName,
            organizationId: dto.organizationId,
            zohoCustomerId: dto.zohoCustomerId,
            zohoCustomerName: dto.zohoCustomerName,
          },
        });
      }
      domainId = domain.id;
    }

    if (!domainId) {
      throw new BadRequestException('Either domainId or domainName must be provided');
    }

    // Origin quote number for the Fresh order-history entry (internal QQ number;
    // there is no Zoho estimate for a fresh conversion, so quoteId stays null).
    const originQuote = dto.originQuickQuoteId
      ? await this.prisma.quickQuote.findUnique({
          where: { id: dto.originQuickQuoteId },
          select: { quoteNumber: true },
        })
      : null;

    const subscriptionNumber = await this.settings.generateNumber(
      dto.organizationId,
      'subscription',
      new Date(dto.startDate),
    );

    const sub = await this.prisma.$transaction(async (tx) => {
      const createdSub = await tx.subscription.create({
        data: {
          subscriptionNumber,
          organizationId:    dto.organizationId,
          domainId:          domainId,
          zohoCustomerId:    dto.zohoCustomerId,
          zohoCustomerName:  dto.zohoCustomerName,
          zohoItemId:        dto.zohoItemId,
          zohoItemName:      dto.zohoItemName,
          originLeadId:      dto.originLeadId,
          originQuickQuoteId: dto.originQuickQuoteId,
          quantity:          dto.quantity,
          subscriptionPrice: dto.subscriptionPrice,
          nextRenewalPrice:  dto.nextRenewalPrice,
          costPrice:         dto.costPrice ?? 0,
          billingCycle:      dto.billingCycle,
          startDate:         new Date(dto.startDate),
          endDate:           new Date(dto.endDate),
          nextRenewalDate:   dto.nextRenewalDate ? new Date(dto.nextRenewalDate) : null,
          autoRenew:         dto.autoRenew ?? false,
          notes:             dto.notes,
          // Lifecycle status (defaults to Pending in schema when omitted)
          ...(dto.lifecycleStatus && { lifecycleStatus: dto.lifecycleStatus }),
          // Invoice linkage
          ...(dto.lastInvoiceId     && { lastInvoiceId: dto.lastInvoiceId }),
          ...(dto.lastInvoiceNumber && { lastInvoiceNumber: dto.lastInvoiceNumber }),
          ...(dto.lastInvoiceDate   && { lastInvoiceDate: new Date(dto.lastInvoiceDate) }),
        },
        include: { organization: true, domain: true },
      });

      // Fresh order entry → the detail page's Order History shows the original
      // quote + invoice, not just renewals/pro-rata.
      if (dto.lastInvoiceId || dto.originQuickQuoteId) {
        await tx.renewalHistory.create({
          data: {
            subscriptionId:   createdSub.id,
            organizationId:   createdSub.organizationId,
            domainId:         createdSub.domainId,
            businessType:     'Fresh',
            billingCycle:     createdSub.billingCycle,
            serviceStartDate: createdSub.startDate,
            serviceEndDate:   createdSub.endDate,
            quantity:         dto.quantity,
            sellingPrice:     dto.subscriptionPrice,
            costPrice:        dto.costPrice ?? 0,
            subtotalAmount:   dto.quantity * dto.subscriptionPrice,
            currency:         createdSub.currency,
            renewalStatus:    dto.lastInvoiceId ? 'Invoiced' : 'Quoted',
            quoteNumber:      originQuote?.quoteNumber,
            invoiceId:        dto.lastInvoiceId,
            invoiceNumber:    dto.lastInvoiceNumber,
            invoiceDate:      dto.lastInvoiceDate ? new Date(dto.lastInvoiceDate) : null,
          },
        });
      }

      return createdSub;
    });

    await this.auditLogs.logAction({
      entityType: 'subscription',
      entityId: sub.id,
      action: 'create',
      changeSummary: `Subscription ${sub.subscriptionNumber} created manually for domain ${sub.domain.domainName}`,
      newValue: sub,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    return sub;
  }

  // ------------------------------------------------------------------
  // Import from Zoho invoices — grouped, idempotent, with history backfill
  // ------------------------------------------------------------------
  async importGrouped(items: ImportSubscriptionDto[]) {
    let created = 0;
    let enriched = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        const outcome = await this.applyImportItem(item);
        if (outcome === 'created')       created++;
        else if (outcome === 'enriched') enriched++;
        else                             skipped++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${item.domainName} / ${item.zohoItemName ?? item.zohoItemId}: ${msg}`);
      }
    }

    this.logger.log(
      `Import complete: ${created} created, ${enriched} enriched, ${skipped} skipped, ${errors.length} errors`,
    );
    return { created, enriched, skipped, errors };
  }

  /**
   * Import a single grouped subscription item — the shared core behind the
   * "Import from Zoho" wizard and (later) the CSV create-importer.
   *   - Resolves the domain, auto-creating it if missing.
   *   - No matching subscription  → CREATE it + backfill history.
   *   - Matching subscription     → ENRICH it: attach only the history rows it
   *     doesn't already have and refresh the last-invoice snapshot. Never
   *     creates a duplicate.
   * Returns the outcome so the caller can tally created/enriched/skipped.
   */
  /**
   * Bulk-domains quote → one subscription per domain (after the quote is
   * converted to a Zoho invoice). Reuses the CSV-import core (applyImportItem):
   * natural-key dedup, enrich-don't-duplicate, idempotent history. Dates come
   * from the convert step (persisted onto the quote items); the converted
   * invoice is linked as each subscription's last invoice + history row.
   */
  async bulkCreateFromQuote(quoteId: string) {
    const quote = await this.prisma.quickQuote.findUnique({
      where: { id: quoteId },
      include: { items: true, lead: true },
    });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.status !== 'Pushed_To_Zoho' || !quote.zohoEstimateId) {
      throw new BadRequestException('Quote abhi convert nahi hui — pehle Create Invoice karo');
    }
    const customerId = quote.zohoCustomerId ?? quote.lead?.convertedToZohoCustomerId;
    if (!customerId) throw new BadRequestException('Zoho customer missing on this quote');
    const customerName = quote.zohoCustomerName ?? quote.lead?.companyName ?? '';

    let created = 0, enriched = 0, skipped = 0;
    const errors: string[] = [];
    const today = new Date();

    for (const item of quote.items) {
      if (!item.isSubscription) continue;
      const rawList = item.domainList as Array<{ domain: string; qty?: number }> | null;
      const domains = Array.isArray(rawList) && rawList.length
        ? rawList
        : item.primaryDomain ? [{ domain: item.primaryDomain, qty: Number(item.quantity) }] : [];
      if (!domains.length) continue;

      if (!item.zohoItemId) {
        errors.push(`${item.itemName}: Zoho item ID missing (quote me item cache se select karke banao)`);
        continue;
      }
      if (!item.billingCycle) {
        errors.push(`${item.itemName}: Subs. Period missing`);
        continue;
      }

      const start = item.serviceStartDate ?? today;
      const end = item.serviceEndDate ?? (() => { const d = new Date(start); d.setFullYear(d.getFullYear() + 1); return d; })();
      const startIso = start.toISOString().split('T')[0];
      const endIso = end.toISOString().split('T')[0];
      const daysLeft = (end.getTime() - today.getTime()) / 86_400_000;
      const lifecycle: SubscriptionLifecycleStatus =
        daysLeft < 0 ? 'Expired' : daysLeft <= 30 ? 'Expiring_Soon' : 'Active';

      for (const d of domains) {
        try {
          if (item.renewedSubscriptionId) {
            const existingSub = await this.prisma.subscription.findUnique({
              where: { id: item.renewedSubscriptionId },
            });
            if (!existingSub) {
              throw new NotFoundException(`Subscription ID ${item.renewedSubscriptionId} not found`);
            }

            const historyData = {
              subscriptionId:   existingSub.id,
              organizationId:   quote.targetOrganizationId,
              domainId:         existingSub.domainId,
              businessType:     BusinessType.Renewal,
              billingCycle:     item.billingCycle,
              serviceStartDate: start,
              serviceEndDate:   end,
              quantity:         d.qty ?? 1,
              sellingPrice:     Number(item.unitPrice),
              subtotalAmount:   (d.qty ?? 1) * Number(item.unitPrice),
              currency:         quote.currency,
              exchangeRate:     existingSub.exchangeRate ?? 1,
              renewalStatus:    'Paid' as const,
              quoteId:          quote.zohoEstimateId,
              quoteNumber:      quote.zohoEstimateNumber,
              quoteDate:        quote.pushedToZohoAt ?? today,
              invoiceId:        quote.zohoEstimateId,
              invoiceNumber:    quote.zohoEstimateNumber,
              invoiceDate:      quote.pushedToZohoAt ?? today,
            };

            const existingHistory = await this.prisma.renewalHistory.findFirst({
              where: { subscriptionId: existingSub.id, quoteId: quote.zohoEstimateId },
            });

            if (!existingHistory) {
              await this.prisma.renewalHistory.create({ data: historyData });
            }

            const nextRenewal = new Date(end);
            nextRenewal.setDate(nextRenewal.getDate() + 1);

            await this.prisma.subscription.update({
              where: { id: existingSub.id },
              data: {
                quantity:          d.qty ?? Number(existingSub.quantity),
                subscriptionPrice: Number(item.unitPrice),
                nextRenewalPrice:  Number(item.unitPrice),
                costPrice:         item.costPrice != null ? Number(item.costPrice) : existingSub.costPrice,
                billingCycle:      item.billingCycle,
                startDate:         start,
                endDate:           end,
                nextRenewalDate:   nextRenewal,
                lifecycleStatus:   lifecycle,
                lastQuoteId:       quote.zohoEstimateId,
                lastQuoteNumber:   quote.zohoEstimateNumber,
                lastQuoteDate:     quote.pushedToZohoAt ?? today,
                lastInvoiceId:     quote.zohoEstimateId,
                lastInvoiceNumber: quote.zohoEstimateNumber,
                lastInvoiceDate:   end,
                processStatus:     'Renewal_Paid',
              },
            });

            enriched++;
          } else {
            const result = await this.applyImportItem({
              organizationId:    quote.targetOrganizationId,
              zohoCustomerId:    customerId,
              zohoCustomerName:  customerName,
              zohoItemId:        item.zohoItemId,
              zohoItemName:      item.itemName,
              domainName:        d.domain,
              quantity:          d.qty ?? 1,
              subscriptionPrice: Number(item.unitPrice),
              costPrice:         item.costPrice != null ? Number(item.costPrice) : undefined,
              billingCycle:      item.billingCycle,
              startDate:         startIso,
              endDate:           endIso,
              lastInvoiceId:     quote.zohoEstimateId,           // converted invoice (field reused)
              lastInvoiceNumber: quote.zohoEstimateNumber ?? undefined,
              currency:          quote.currency,
              history: [{
                invoiceId:     quote.zohoEstimateId,
                invoiceNumber: quote.zohoEstimateNumber ?? undefined,
                invoiceDate:   (quote.pushedToZohoAt ?? today).toISOString().split('T')[0],
                startDate:     startIso,
                endDate:       endIso,
                quantity:      d.qty ?? 1,
                price:         Number(item.unitPrice),
                businessType:  'Fresh',
              }],
            }, { lifecycleStatusOnCreate: lifecycle, originQuickQuoteId: quote.id });

            if (result === 'created') created++;
            else if (result === 'enriched') enriched++;
            else skipped++;
          }
        } catch (err) {
          errors.push(`${d.domain}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    this.logger.log(
      `Bulk-create from quote ${quote.quoteNumber}: ${created} created, ${enriched} enriched, ${skipped} skipped, ${errors.length} errors`,
    );
    return { created, enriched, skipped, errors, total: created + enriched + skipped + errors.length };
  }

  private async applyImportItem(
    item: ImportSubscriptionDto,
    opts: { lifecycleStatusOnCreate?: SubscriptionLifecycleStatus; originQuickQuoteId?: string } = {},
  ): Promise<'created' | 'enriched' | 'skipped'> {
    // 1. Resolve / create domain
    let domain = await this.prisma.domain.findFirst({
      where: { domainName: item.domainName, organizationId: item.organizationId, zohoCustomerId: item.zohoCustomerId },
    });
    if (!domain) {
      domain = await this.prisma.domain.create({
        data: {
          domainName:       item.domainName,
          organizationId:   item.organizationId,
          zohoCustomerId:   item.zohoCustomerId,
          zohoCustomerName: item.zohoCustomerName,
        },
      });
    }

    // 2. Natural-key lookup: org + customer + item + domain
    const existing = await this.prisma.subscription.findFirst({
      where: {
        organizationId: item.organizationId,
        zohoCustomerId: item.zohoCustomerId,
        zohoItemId:     item.zohoItemId,
        domainId:       domain.id,
      },
    });

    // 3a. ENRICH an existing subscription (no duplicate)
    if (existing) {
      const addedHistory = await this.backfillHistory(
        existing.id, item.organizationId, domain.id, item.billingCycle, item.history ?? [],
      );

      // Refresh the last-invoice snapshot only if the incoming term is newer.
      let refreshed = false;
      if (item.lastInvoiceId) {
        const incomingDate = new Date(item.endDate);
        if (!existing.lastInvoiceDate || incomingDate > existing.lastInvoiceDate) {
          await this.prisma.subscription.update({
            where: { id: existing.id },
            data: {
              lastInvoiceId: item.lastInvoiceId,
              ...(item.lastInvoiceNumber && { lastInvoiceNumber: item.lastInvoiceNumber }),
              lastInvoiceDate: incomingDate,
            },
          });
          refreshed = true;
        }
      }

      return addedHistory > 0 || refreshed ? 'enriched' : 'skipped';
    }

    // No existing subscription. For estimate-sourced imports, only create when the
    // quote is Accepted/Invoiced — never materialize a sub from an open/expired proforma.
    if (item.sourceIsEstimate) {
      const st = (item.sourceQuoteStatus ?? '').toLowerCase();
      if (st !== 'accepted' && st !== 'invoiced') return 'skipped';
    }

    // 3b. CREATE a new subscription (current/latest term, Active)
    const nextRenewal = new Date(item.endDate);
    nextRenewal.setDate(nextRenewal.getDate() + 1);

    const subscriptionNumber = await this.settings.generateNumber(
      item.organizationId,
      'subscription',
      new Date(item.startDate),
    );

    const sub = await this.prisma.subscription.create({
      data: {
        subscriptionNumber,
        organizationId:    item.organizationId,
        domainId:          domain.id,
        zohoCustomerId:    item.zohoCustomerId,
        zohoCustomerName:  item.zohoCustomerName,
        zohoItemId:        item.zohoItemId,
        zohoItemName:      item.zohoItemName,
        quantity:          item.quantity,
        subscriptionPrice: item.subscriptionPrice,
        costPrice:         item.costPrice ?? 0,
        billingCycle:      item.billingCycle,
        currency:          item.currency ?? 'INR',
        exchangeRate:      item.exchangeRate ?? 1,
        startDate:         new Date(item.startDate),
        endDate:           new Date(item.endDate),
        nextRenewalDate:   nextRenewal,
        lifecycleStatus:   opts.lifecycleStatusOnCreate ?? 'Active',
        ...(item.lastInvoiceId     && { lastInvoiceId: item.lastInvoiceId }),
        ...(item.lastInvoiceNumber && { lastInvoiceNumber: item.lastInvoiceNumber }),
        lastInvoiceDate:   new Date(item.endDate),
        ...(opts.originQuickQuoteId && { originQuickQuoteId: opts.originQuickQuoteId }),
      },
    });

    await this.backfillHistory(
      sub.id, item.organizationId, domain.id, item.billingCycle, item.history ?? [],
    );
    return 'created';
  }

  /**
   * Insert renewal_history rows for the given past invoices, skipping any whose
   * invoiceId already exists on the subscription (idempotent — safe to re-run).
   * Returns the number of rows actually added.
   */
  private async backfillHistory(
    subscriptionId: string,
    organizationId: string,
    domainId: string,
    billingCycle: BillingCycle,
    history: ImportInvoiceRefDto[],
  ): Promise<number> {
    if (!history.length) return 0;

    const existingRows = await this.prisma.renewalHistory.findMany({
      where: { subscriptionId },
      select: { invoiceId: true, quoteId: true },
    });
    // Dedup on whichever id the row carries — invoice-sourced by invoiceId,
    // estimate-sourced (quote-only) by quoteId.
    const seenInvoices = new Set(existingRows.map((r) => r.invoiceId).filter(Boolean) as string[]);
    const seenQuotes   = new Set(existingRows.map((r) => r.quoteId).filter(Boolean) as string[]);

    const fresh = history.filter((h) => {
      if (h.invoiceId) return !seenInvoices.has(h.invoiceId);
      if (h.quoteId)   return !seenQuotes.has(h.quoteId);
      return false; // no identifier → can't dedup safely, skip
    });
    if (!fresh.length) return 0;

    await this.prisma.renewalHistory.createMany({
      data: fresh.map((h) => ({
        subscriptionId,
        organizationId,
        domainId,
        businessType:     this.mapBusinessType(h.businessType),
        billingCycle,
        serviceStartDate: h.startDate ? new Date(h.startDate) : null,
        serviceEndDate:   h.endDate   ? new Date(h.endDate)   : null,
        quantity:         h.quantity ?? null,
        sellingPrice:     h.price ?? null,
        subtotalAmount:   (h.quantity ?? 0) * (h.price ?? 0),
        currency:         h.currency ?? 'INR',
        exchangeRate:     h.exchangeRate ?? 1,
        // Invoice-sourced rows are Paid; quote-only rows are Quoted.
        renewalStatus:    h.invoiceId ? 'Paid' : 'Quoted',
        quoteId:            h.quoteId,
        quoteNumber:        h.quoteNumber,
        quoteDate:          h.quoteDate ? new Date(h.quoteDate) : null,
        zohoEstimateStatus: h.quoteStatus,
        invoiceId:        h.invoiceId,
        invoiceNumber:    h.invoiceNumber,
        invoiceDate:      h.invoiceDate ? new Date(h.invoiceDate) : null,
      })),
    });
    return fresh.length;
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------
  async update(id: string, dto: UpdateSubscriptionDto, user: AuthUser) {
    const existing = await this.findOne(id);

    // --- Zoho document lookup (if lastQuoteNumber or lastInvoiceNumber provided) ---
    let quoteData: { estimateId: string; estimateNumber: string; date: string } | null = null;
    let invoiceData: { invoiceId: string; invoiceNumber: string; date: string } | null = null;

    // Only lookup + create history when the document number has actually changed.
    // This prevents duplicate renewal_history rows if the user saves the form twice
    // with the same numbers, or saves without touching the document fields.
    const quoteChanged   = dto.lastQuoteNumber   && dto.lastQuoteNumber.trim()   !== (existing.lastQuoteNumber   ?? '');
    const invoiceChanged = dto.lastInvoiceNumber && dto.lastInvoiceNumber.trim() !== (existing.lastInvoiceNumber ?? '');
    // Same number re-submitted → update existing history row's service dates
    const quoteSame   = !quoteChanged   && dto.lastQuoteNumber   && dto.lastQuoteNumber.trim()   === (existing.lastQuoteNumber   ?? '') && !!existing.lastQuoteNumber;
    const invoiceSame = !invoiceChanged && dto.lastInvoiceNumber && dto.lastInvoiceNumber.trim() === (existing.lastInvoiceNumber ?? '') && !!existing.lastInvoiceNumber;

    if (quoteChanged || invoiceChanged) {
      const internalOrgId = existing.organizationId;  // clientFor() expects our internal UUID
      const contactId = existing.zohoCustomerId;

      if (quoteChanged) {
        quoteData = await this.zoho.lookupEstimateByNumber(internalOrgId, dto.lastQuoteNumber!.trim(), contactId);
      }
      if (invoiceChanged) {
        invoiceData = await this.zoho.lookupInvoiceByNumber(internalOrgId, dto.lastInvoiceNumber!.trim(), contactId);
      }
    }

    // --- Core fields + snapshot update ---
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        ...(dto.quantity          !== undefined && { quantity: dto.quantity }),
        ...(dto.subscriptionPrice !== undefined && { subscriptionPrice: dto.subscriptionPrice }),
        ...(dto.nextRenewalPrice  !== undefined && { nextRenewalPrice: dto.nextRenewalPrice }),
        ...(dto.costPrice         !== undefined && { costPrice: dto.costPrice }),
        ...(dto.billingCycle      !== undefined && { billingCycle: dto.billingCycle }),
        ...(dto.startDate         !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate           !== undefined && { endDate: new Date(dto.endDate) }),
        ...(dto.nextRenewalDate   !== undefined && { nextRenewalDate: new Date(dto.nextRenewalDate) }),
        ...(dto.autoRenew         !== undefined && { autoRenew: dto.autoRenew }),
        ...(dto.notes             !== undefined && { notes: dto.notes }),
        ...(dto.currency          !== undefined && { currency: dto.currency.toUpperCase() }),
        ...(dto.exchangeRate      !== undefined && { exchangeRate: dto.exchangeRate }),
        ...(quoteData && {
          lastQuoteId:     quoteData.estimateId,
          lastQuoteNumber: quoteData.estimateNumber,
          lastQuoteDate:   new Date(quoteData.date),
        }),
        ...(invoiceData && {
          lastInvoiceId:     invoiceData.invoiceId,
          lastInvoiceNumber: invoiceData.invoiceNumber,
          lastInvoiceDate:   new Date(invoiceData.date),
        }),
        updatedAt: new Date(),
      },
    });

    // --- Recalculate service dates when same document number is re-submitted ---
    // Lets the user re-save the Edit form with the same quote/invoice number to
    // fix previously wrong serviceStartDate / serviceEndDate in the history row.
    if (quoteSame || invoiceSame) {
      const effectiveEndDate = dto.endDate ? new Date(dto.endDate) : new Date(existing.endDate);
      const effectiveCycle   = (dto.billingCycle ?? existing.billingCycle) as BillingCycle;
      const renewStart = new Date(effectiveEndDate);
      renewStart.setDate(renewStart.getDate() + 1);
      const renewEndRaw = this.addBillingCycle(renewStart, effectiveCycle);
      const renewEnd = new Date(renewEndRaw);
      renewEnd.setDate(renewEnd.getDate() - 1);

      const orClauses: Prisma.RenewalHistoryWhereInput[] = [];
      if (quoteSame)   orClauses.push({ quoteNumber:   dto.lastQuoteNumber!.trim() });
      if (invoiceSame) orClauses.push({ invoiceNumber: dto.lastInvoiceNumber!.trim() });

      await this.prisma.renewalHistory.updateMany({
        where: { subscriptionId: id, OR: orClauses },
        data:  { serviceStartDate: renewStart, serviceEndDate: renewEnd },
      });
      this.logger.log(
        `renewal_history dates re-synced for sub ${id}: ${renewStart.toISOString()} → ${renewEnd.toISOString()}`,
      );
    }

    // --- Upsert renewal_history entry when documents are linked ---
    // If a row with the same quoteId / invoiceId already exists for this subscription,
    // update it (fix service dates, status) instead of creating a duplicate.
    if (quoteData || invoiceData) {
      const renewalStatus: RenewalStatus = invoiceData ? RenewalStatus.Invoiced : RenewalStatus.Quoted;
      const qty = Number(existing.quantity);
      const price = Number(existing.nextRenewalPrice ?? existing.subscriptionPrice);
      // Prefer Zoho line-item dates passed from the mapping UI; fall back to calculated next period.
      const renewalStart = dto.serviceStartDate
        ? new Date(dto.serviceStartDate)
        : (() => { const d = new Date(existing.endDate); d.setDate(d.getDate() + 1); return d; })();
      const renewalEnd = dto.serviceEndDate
        ? new Date(dto.serviceEndDate)
        : (() => {
            const raw = this.addBillingCycle(renewalStart, existing.billingCycle as BillingCycle);
            const d = new Date(raw); d.setDate(d.getDate() - 1); return d;
          })();

      // Check for an existing row with the same Zoho document ID or number
      const orClauses: Prisma.RenewalHistoryWhereInput[] = [];
      if (quoteData) {
        orClauses.push({ subscriptionId: id, quoteId: quoteData.estimateId });
        orClauses.push({ subscriptionId: id, quoteNumber: quoteData.estimateNumber });
      }
      if (invoiceData) {
        orClauses.push({ subscriptionId: id, invoiceId: invoiceData.invoiceId });
        orClauses.push({ subscriptionId: id, invoiceNumber: invoiceData.invoiceNumber });
      }
      const existingRow = orClauses.length
        ? await this.prisma.renewalHistory.findFirst({ where: { OR: orClauses } })
        : null;

      const docData = {
        ...(quoteData && {
          quoteId:     quoteData.estimateId,
          quoteNumber: quoteData.estimateNumber,
          quoteDate:   new Date(quoteData.date),
        }),
        ...(invoiceData && {
          invoiceId:     invoiceData.invoiceId,
          invoiceNumber: invoiceData.invoiceNumber,
          invoiceDate:   new Date(invoiceData.date),
        }),
      };

      if (existingRow) {
        // Update the existing row — fix service dates and status
        await this.prisma.renewalHistory.update({
          where: { id: existingRow.id },
          data: {
            serviceStartDate: renewalStart,
            serviceEndDate:   renewalEnd,
            quantity:         qty,
            sellingPrice:     price,
            costPrice:        existing.costPrice ?? null,
            subtotalAmount:   qty * price,
            renewalStatus,
            ...docData,
          },
        });
        this.logger.log(
          `renewal_history updated (upsert) for sub ${id}: ${renewalStatus}` +
          (quoteData   ? ` quote=${quoteData.estimateNumber}`   : '') +
          (invoiceData ? ` invoice=${invoiceData.invoiceNumber}` : ''),
        );
      } else {
        await this.prisma.renewalHistory.create({
          data: {
            subscriptionId: id,
            organizationId: existing.organizationId,
            domainId:       existing.domainId,
            businessType:   BusinessType.Renewal,
            billingCycle:   existing.billingCycle,
            serviceStartDate: renewalStart,
            serviceEndDate:   renewalEnd,
            quantity:         qty,
            sellingPrice:     price,
            costPrice:        existing.costPrice ?? null,
            subtotalAmount:   qty * price,
            renewalStatus,
            ...docData,
          },
        });
        this.logger.log(
          `renewal_history created for sub ${id}: ${renewalStatus}` +
          (quoteData   ? ` quote=${quoteData.estimateNumber}`   : '') +
          (invoiceData ? ` invoice=${invoiceData.invoiceNumber}` : ''),
        );
      }
    }

    await this.auditLogs.logAction({
      entityType: 'subscription',
      entityId: id,
      action: 'update',
      changeSummary: `Subscription ${existing.subscriptionNumber} updated`,
      newValue: updated,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    return updated;
  }

  // ------------------------------------------------------------------
  // Expiry status sync (called by cron or on-demand)
  // ------------------------------------------------------------------
  async syncExpiryStatuses() {
    const now = new Date();
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);

    // Mark Expiring_Soon (active, expires within 30 days)
    const expiringSoon = await this.prisma.subscription.updateMany({
      where: {
        lifecycleStatus: 'Active',
        endDate: { lte: in30Days, gte: now },
      },
      data: { lifecycleStatus: 'Expiring_Soon' },
    });

    // Mark Expired (end date passed)
    const expired = await this.prisma.subscription.updateMany({
      where: {
        lifecycleStatus: { in: ['Active', 'Expiring_Soon'] },
        endDate: { lt: now },
      },
      data: { lifecycleStatus: 'Expired' },
    });

    this.logger.log(`Expiry sync: ${expiringSoon.count} → ExpiringSoon, ${expired.count} → Expired`);
    return { expiringSoon: expiringSoon.count, expired: expired.count };
  }

  /**
   * Prefill renewal quote details from existing subscriptions.
   * Validates they belong to same customer and organization, and are in renewable status.
   */
  async prefillRenewalQuote(ids: string[]) {
    const subs = await this.prisma.subscription.findMany({
      where: { id: { in: ids } },
      include: { domain: true },
    });

    if (subs.length !== ids.length) {
      throw new NotFoundException('कुछ subscriptions नहीं मिलीं');
    }

    const first = subs[0];
    const orgId = first.organizationId;
    const custId = first.zohoCustomerId;
    const custName = first.zohoCustomerName;

    for (const sub of subs) {
      if (sub.organizationId !== orgId) {
        throw new BadRequestException('सभी subscriptions एक ही Organization की होनी चाहिए');
      }
      if (sub.zohoCustomerId !== custId) {
        throw new BadRequestException('सभी subscriptions एक ही Customer की होनी चाहिए');
      }
      if (!['Active', 'Expiring_Soon', 'Expired'].includes(sub.lifecycleStatus)) {
        throw new BadRequestException(
          `रिन्यूअल केवल Active, Expiring Soon या Expired सब्सक्रिप्शन्स के लिए ही संभव है। Sub ${sub.subscriptionNumber} का स्टेटस: ${sub.lifecycleStatus}`
        );
      }
    }

    const items = subs.map((sub, idx) => {
      const start = new Date(sub.endDate);
      start.setDate(start.getDate() + 1);
      const end = this.addBillingCycle(start, sub.billingCycle);

      return {
        id: Math.random().toString(36).slice(2),
        line_order: idx + 1,
        zoho_item_id: sub.zohoItemId,
        item_name: sub.zohoItemName || 'Subscription Renewal',
        item_description: `${sub.domain.domainName} (${sub.billingCycle})`,
        quantity: Number(sub.quantity),
        unit_price: Number(sub.nextRenewalPrice ?? sub.subscriptionPrice),
        cost_price: Number(sub.costPrice),
        discount_percent: 0,
        tax_rate: 18,
        is_subscription: true,
        billing_cycle: sub.billingCycle,
        primary_domain: sub.domain.domainName,
        service_period_start: start.toISOString().split('T')[0],
        service_period_end: end.toISOString().split('T')[0],
        renewed_subscription_id: sub.id,
      };
    });

    return {
      organizationId: orgId,
      zohoCustomerId: custId,
      zohoCustomerName: custName,
      items,
    };
  }

  // ------------------------------------------------------------------
  // Renewal Quote (Quote Type 3) — pushes Estimate to Zoho
  // ------------------------------------------------------------------
  async generateRenewalQuote(id: string, dto: RenewalQuoteDto) {
    const sub = await this.findOne(id);

    if (!['Active', 'Expiring_Soon', 'Expired'].includes(sub.lifecycleStatus)) {
      throw new BadRequestException(`Cannot generate renewal for status: ${sub.lifecycleStatus}`);
    }

    const newStartDate = new Date(sub.endDate);
    newStartDate.setDate(newStartDate.getDate() + 1);
    const newEndDate = this.addBillingCycle(newStartDate, sub.billingCycle);

    const price = dto.overridePrice
      ?? Number(sub.nextRenewalPrice ?? sub.subscriptionPrice);
    const qty = dto.overrideQuantity ?? Number(sub.quantity);

    // Push Estimate to Zoho
    let zohoEstimateId: string | null = null;
    let zohoEstimateNumber: string | null = null;

    try {
      const zohoClient = await this.zoho.clientFor(sub.organizationId);
      const estimatePayload = await this.buildEstimatePayload(sub, qty, price, newStartDate, newEndDate, 'Renewal');
      const resp = await zohoClient.post<{ estimate: { estimate_id: string; estimate_number: string } }>(
        '/estimates', estimatePayload,
      );
      zohoEstimateId     = resp.estimate?.estimate_id ?? null;
      zohoEstimateNumber = resp.estimate?.estimate_number ?? null;
    } catch (err) {
      this.logger.warn(`Zoho estimate creation failed for sub ${id}: ${String(err)}`);
      // Continue — we still log in renewal_history
    }

    const today = new Date();
    const renewal = await this.prisma.renewalHistory.create({
      data: {
        subscriptionId:  id,
        organizationId:  sub.organizationId,
        domainId:        sub.domainId,
        businessType:    'Renewal',
        billingCycle:    sub.billingCycle,
        serviceStartDate: newStartDate,
        serviceEndDate:   newEndDate,
        quantity:         qty,
        sellingPrice:     price,
        subtotalAmount:   qty * price,
        renewalStatus:    'Quoted',
        quoteId:          zohoEstimateId,
        quoteNumber:      zohoEstimateNumber,
        quoteDate:        today,
      },
    });

    // Update subscription last_quote_*
    await this.prisma.subscription.update({
      where: { id },
      data: {
        processStatus:   'Renewal_Quoted',
        lastQuoteId:     zohoEstimateId,
        lastQuoteNumber: zohoEstimateNumber,
        lastQuoteDate:   today,
      },
    });

    this.logger.log(`Renewal quote generated for sub ${sub.subscriptionNumber}${zohoEstimateNumber ? ` → Zoho ${zohoEstimateNumber}` : ' (offline)'}`);
    return { renewal, zoho_estimate_id: zohoEstimateId, zoho_estimate_number: zohoEstimateNumber };
  }

  // ------------------------------------------------------------------
  // Pro-rata Quote (Quote Type 4)
  // ------------------------------------------------------------------
  async generateProrataQuote(id: string, dto: ProrataQuoteDto) {
    const sub = await this.findOne(id);

    if (sub.lifecycleStatus !== 'Active' && sub.lifecycleStatus !== 'Expiring_Soon') {
      throw new BadRequestException(`Pro-rata only allowed for Active/ExpiringSoon subscriptions`);
    }

    const effectiveDate = new Date(dto.effectiveDate);
    const endDate = new Date(sub.endDate);

    if (effectiveDate >= endDate) {
      throw new BadRequestException('Effective date must be before subscription end date');
    }

    const periodDays = Math.ceil((endDate.getTime() - effectiveDate.getTime()) / 86_400_000);
    const cycledays  = this.billingCycleDays(sub.billingCycle, effectiveDate);
    const dailyRate  = Number(sub.subscriptionPrice) / cycledays;
    const prorataSubtotal = Math.round(periodDays * dailyRate * dto.additionalLicenses * 100) / 100;

    let zohoEstimateId: string | null = null;
    let zohoEstimateNumber: string | null = null;

    try {
      const zohoClient = await this.zoho.clientFor(sub.organizationId);
      const proRataLabel = await this.zoho.getBusinessTypeLabel(sub.organizationId, 'Pro-rata');
      const estimateCf = await this.zoho.buildCustomFields(sub.organizationId, 'estimates', {
        domain_name:             sub.domain.domainName,
        business_type:           proRataLabel,
        service_expiry:          endDate.toISOString().split('T')[0],
        start_date:              effectiveDate.toISOString().split('T')[0],
        end_date:                endDate.toISOString().split('T')[0],
        quantity:                String(Number(sub.quantity) + dto.additionalLicenses),
        cost_price:              String(Number(sub.costPrice)),
        unit_price:              String(Number(sub.subscriptionPrice)),
        central_subscription_id: sub.id,
      });
      const endDateStr       = endDate.toISOString().split('T')[0];
      const effectiveDateStr = effectiveDate.toISOString().split('T')[0];
      const estimatePayload = {
        customer_id: sub.zohoCustomerId,
        line_items: [{
          item_id:     sub.zohoItemId,
          description: `Pro-rata: +${dto.additionalLicenses} licenses (${effectiveDateStr} → ${endDateStr})`,
          quantity:    dto.additionalLicenses,
          rate:        Math.round(dailyRate * periodDays * 100) / 100,
        }],
        custom_fields: estimateCf,
        notes: dto.notes ?? `Pro-rata for ${dto.additionalLicenses} additional licenses from ${effectiveDateStr} to ${endDateStr}`,
      };

      const resp = await zohoClient.post<{ estimate: { estimate_id: string; estimate_number: string } }>(
        '/estimates', estimatePayload,
      );
      zohoEstimateId     = resp.estimate?.estimate_id ?? null;
      zohoEstimateNumber = resp.estimate?.estimate_number ?? null;
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (err instanceof Error ? err.message : String(err));
      this.logger.error(`Zoho pro-rata estimate failed for sub ${id}: ${msg}`);
      throw new BadRequestException(`Zoho estimate create नहीं हुई: ${msg}`);
    }

    const today = new Date();
    const history = await this.prisma.renewalHistory.create({
      data: {
        subscriptionId:   id,
        organizationId:   sub.organizationId,
        domainId:         sub.domainId,
        businessType:     'ProRata',
        serviceStartDate: effectiveDate,
        serviceEndDate:   endDate,
        quantity:         dto.additionalLicenses,
        sellingPrice:     dailyRate * periodDays,
        subtotalAmount:   prorataSubtotal,
        renewalStatus:    'Quoted',
        quoteId:          zohoEstimateId,
        quoteNumber:      zohoEstimateNumber,
        quoteDate:        today,
      },
    });

    this.logger.log(`Pro-rata quote for sub ${sub.subscriptionNumber}: ₹${prorataSubtotal} for ${dto.additionalLicenses} licenses × ${periodDays} days`);
    return {
      history,
      calculation: { periodDays, dailyRate, prorataSubtotal, additionalLicenses: dto.additionalLicenses },
      zoho_estimate_id: zohoEstimateId,
      zoho_estimate_number: zohoEstimateNumber,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** Map Zoho "Business Type?" label → our BusinessType enum. */
  private mapBusinessType(raw?: string): BusinessType {
    switch ((raw ?? '').trim().toLowerCase()) {
      case 'fresh':    return BusinessType.Fresh;
      case 'pro-rata':
      case 'prorata':  return BusinessType.ProRata;
      case 'renewal':
      case 'transfer': // Transfer ≈ renewal continuation (no Transfer in our enum)
      default:         return BusinessType.Renewal;
    }
  }

  private addBillingCycle(from: Date, cycle: BillingCycle): Date {
    const d = new Date(from);
    switch (cycle) {
      case BillingCycle.monthly:     d.setMonth(d.getMonth() + 1); break;
      case BillingCycle.quarterly:   d.setMonth(d.getMonth() + 3); break;
      case BillingCycle.half_yearly: d.setMonth(d.getMonth() + 6); break;
      case BillingCycle.annual:      d.setFullYear(d.getFullYear() + 1); break;
      case BillingCycle.biennial:    d.setFullYear(d.getFullYear() + 2); break;
      case BillingCycle.triennial:   d.setFullYear(d.getFullYear() + 3); break;
      default: d.setFullYear(d.getFullYear() + 1); // fallback annual
    }
    d.setDate(d.getDate() - 1); // end of last day of period
    return d;
  }

  private billingCycleDays(cycle: BillingCycle, from: Date): number {
    switch (cycle) {
      case BillingCycle.monthly:     return 30;
      case BillingCycle.quarterly:   return 90;
      case BillingCycle.half_yearly: return 182;
      case BillingCycle.annual:      return 365;
      case BillingCycle.biennial:    return 730;
      case BillingCycle.triennial:   return 1095;
      default: return 365;
    }
  }

  // ------------------------------------------------------------------
  // Start Subscription — Manual trigger (Estimate or Invoice)
  // ------------------------------------------------------------------
  async startSubscription(id: string, dto: StartSubscriptionDto) {
    const sub = await this.findOne(id);

    if (sub.lifecycleStatus !== 'Pending') {
      throw new BadRequestException(
        `Subscription can only be started from Pending status (current: ${sub.lifecycleStatus})`,
      );
    }

    const startDate = new Date(dto.startDate);
    const endDate   = new Date(dto.endDate);
    const qty       = Number(sub.quantity);
    const price     = Number(sub.nextRenewalPrice ?? sub.subscriptionPrice);

    let zohoDocId: string | null = null;
    let zohoDocNumber: string | null = null;

    try {
      const zohoClient = await this.zoho.clientFor(sub.organizationId);

      if (dto.zohoDocumentType === 'estimate') {
        const payload = await this.buildEstimatePayload(sub, qty, price, startDate, endDate, 'Fresh');
        const resp = await zohoClient.post<{ estimate: { estimate_id: string; estimate_number: string } }>(
          '/estimates', payload,
        );
        zohoDocId     = resp.estimate?.estimate_id ?? null;
        zohoDocNumber = resp.estimate?.estimate_number ?? null;
      } else {
        // Invoice
        const { options: billingOpts } = await this.zoho.getBillingOptions(sub.organizationId);
        const subsPeriodLabel = billingOpts.find((o) => o.value === String(sub.billingCycle))?.label ?? '';
        const invoiceCf = await this.zoho.buildCustomFields(sub.organizationId, 'invoices', {
          domain_name:    sub.domain.domainName,
          business_type:  await this.zoho.getBusinessTypeLabel(sub.organizationId, 'Fresh'),
          billing_period: subsPeriodLabel,
          service_expiry: endDate.toISOString().split('T')[0],
          start_date:     startDate.toISOString().split('T')[0],
          end_date:       endDate.toISOString().split('T')[0],
          quantity:       String(qty),
          cost_price:     String(Number(sub.costPrice)),
          unit_price:     String(price),
        });
        const payload = {
          customer_id: sub.zohoCustomerId,
          custom_fields: invoiceCf,
          line_items: [{
            item_id:     sub.zohoItemId,
            quantity:    qty,
            rate:        price,
            description: `${dto.startDate} to ${dto.endDate}`,
          }],
          notes: dto.notes ?? `Invoice for ${sub.domain.domainName}`,
        };
        const resp = await zohoClient.post<{ invoice: { invoice_id: string; invoice_number: string } }>(
          '/invoices', payload,
        );
        zohoDocId     = resp.invoice?.invoice_id ?? null;
        zohoDocNumber = resp.invoice?.invoice_number ?? null;
      }
    } catch (err) {
      this.logger.warn(`Zoho ${dto.zohoDocumentType} creation failed for sub ${id}: ${String(err)}`);
    }

    const nextRenewalDate = this.addBillingCycle(endDate, sub.billingCycle as BillingCycle);
    nextRenewalDate.setDate(nextRenewalDate.getDate() + 1);

    const renewalStatus = dto.zohoDocumentType === 'estimate' ? 'Quoted' : 'Invoiced';
    const processStatus = dto.zohoDocumentType === 'estimate' ? 'Renewal_Quoted' : 'Renewal_Invoiced';

    // Create renewal history entry
    await this.prisma.renewalHistory.create({
      data: {
        subscriptionId:  id,
        organizationId:  sub.organizationId,
        domainId:        sub.domainId,
        businessType:    'Renewal',
        billingCycle:    sub.billingCycle as BillingCycle,
        serviceStartDate: startDate,
        serviceEndDate:   endDate,
        quantity:         qty,
        sellingPrice:     price,
        subtotalAmount:   qty * price,
        renewalStatus,
        ...(dto.zohoDocumentType === 'estimate'
          ? { quoteId: zohoDocId, quoteNumber: zohoDocNumber, quoteDate: new Date() }
          : { invoiceId: zohoDocId, invoiceNumber: zohoDocNumber, invoiceDate: new Date() }),
      },
    });

    // Activate subscription
    await this.prisma.subscription.update({
      where: { id },
      data: {
        lifecycleStatus:  'Active',
        processStatus,
        startDate,
        endDate,
        nextRenewalDate,
        ...(dto.zohoDocumentType === 'estimate'
          ? { lastQuoteId: zohoDocId, lastQuoteNumber: zohoDocNumber, lastQuoteDate: new Date() }
          : { lastInvoiceId: zohoDocId, lastInvoiceNumber: zohoDocNumber, lastInvoiceDate: new Date() }),
      },
    });

    this.logger.log(
      `Subscription ${sub.subscriptionNumber} started — ${dto.zohoDocumentType} ${zohoDocNumber ?? '(offline)'}`,
    );
    return {
      zoho_document_type:   dto.zohoDocumentType,
      zoho_document_id:     zohoDocId,
      zoho_document_number: zohoDocNumber,
      start_date:           dto.startDate,
      end_date:             dto.endDate,
    };
  }

  private async buildEstimatePayload(
    sub: Awaited<ReturnType<SubscriptionsService['findOne']>>,
    qty: number, price: number,
    startDate: Date, endDate: Date,
    businessConcept: 'Fresh' | 'Renewal' = 'Renewal',
  ) {
    // Per-module mapping resolves Subs Period to the estimate's own api_name
    // (cf_billing_period), distinct from the invoice's cf_subs_period.
    const businessLabel = await this.zoho.getBusinessTypeLabel(sub.organizationId, businessConcept);
    const { options: billingOpts } = await this.zoho.getBillingOptions(sub.organizationId);
    const subsPeriodLabel = billingOpts.find((o) => o.value === String(sub.billingCycle))?.label ?? '';
    const customFields = await this.zoho.buildCustomFields(sub.organizationId, 'estimates', {
      domain_name:             sub.domain.domainName,
      business_type:           businessLabel,
      billing_period:          subsPeriodLabel,
      service_expiry:          endDate.toISOString().split('T')[0],
      start_date:              startDate.toISOString().split('T')[0],
      end_date:                endDate.toISOString().split('T')[0],
      quantity:                String(qty),
      cost_price:              String(Number(sub.costPrice)),
      unit_price:              String(price),
      central_subscription_id: sub.id,
    });
    return {
      customer_id: sub.zohoCustomerId,
      line_items: [{
        item_id:  sub.zohoItemId,
        quantity: qty,
        rate:     price,
        description: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
      }],
      custom_fields: customFields,
      notes: `${businessConcept} for ${sub.domain.domainName}`,
    };
  }

  // ------------------------------------------------------------------
  // Proforma Invoice (Zoho Estimate) — email via Zoho + status sync
  // ------------------------------------------------------------------

  /** Load a renewal_history row + its subscription (for org + Zoho customer). */
  private async findRenewalHistory(historyId: string) {
    const row = await this.prisma.renewalHistory.findUnique({
      where: { id: historyId },
      include: { subscription: true },
    });
    if (!row) throw new NotFoundException(`Renewal record ${historyId} not found`);
    if (!row.quoteId) throw new BadRequestException('Is record me koi Zoho estimate (proforma) nahi hai');
    return row;
  }

  /** Fetch Zoho's pre-filled email content for an estimate (subject, body, to/cc/bcc, templates list, contact suggestions). */
  async getEmailPreview(historyId: string, templateId?: string) {
    const row = await this.findRenewalHistory(historyId);
    const client = await this.zoho.clientFor(row.organizationId);

    // Fetch all contact emails for suggestions (primary + contact persons)
    const contactEmails: Array<{ name: string; email: string }> = [];
    try {
      const c = await client.get<{
        contact?: {
          email?: string;
          contact_name?: string;
          contact_persons?: Array<{ first_name?: string; last_name?: string; email?: string }>;
        };
      }>(`/contacts/${row.subscription.zohoCustomerId}`);
      const contact = c.contact;
      if (contact?.email) {
        contactEmails.push({ name: contact.contact_name ?? 'Primary', email: contact.email });
      }
      if (contact?.contact_persons) {
        for (const p of contact.contact_persons) {
          if (p.email && !contactEmails.find(e => e.email === p.email)) {
            contactEmails.push({
              name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Contact',
              email: p.email,
            });
          }
        }
      }
    } catch { /* non-fatal — suggestions unavailable */ }

    const url = templateId
      ? `/estimates/${row.quoteId}/email?email_template_id=${templateId}`
      : `/estimates/${row.quoteId}/email`;

    const resp = await client.get<{
      data?: {
        from_email?: string;
        to_mail_ids?: string[];
        cc_mail_ids?: string[];
        bcc_mail_ids?: string[];
        subject?: string;
        body?: string;
        emailtemplates?: Array<{ email_template_id: string; name: string; selected: boolean }>;
      };
    }>(url);

    const d = resp.data ?? {};

    // Pre-fill To from Zoho template OR fall back to contact's primary email
    const toMailIds = (d.to_mail_ids?.length)
      ? d.to_mail_ids
      : contactEmails.slice(0, 1).map(e => e.email);

    return {
      fromEmail:      d.from_email     ?? null,
      toMailIds,
      ccMailIds:      d.cc_mail_ids    ?? [],
      bccMailIds:     d.bcc_mail_ids   ?? [],
      subject:        d.subject        ?? '',
      body:           d.body           ?? '',
      emailTemplates: d.emailtemplates ?? [],
      contactEmails,
    };
  }

  /**
   * Send the proforma (Zoho Estimate) to the customer — the email goes FROM Zoho Books
   * (Zoho's sender config) but is triggered from our app. Zoho also marks the estimate 'sent'.
   * Result status is synced back into renewal_history.
   */
  async sendProforma(
    historyId: string,
    override?: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string },
  ) {
    const row = await this.findRenewalHistory(historyId);
    const client = await this.zoho.clientFor(row.organizationId);

    const payload: Record<string, unknown> = {};
    if (override?.toMailIds?.length)  payload.to_mail_ids  = override.toMailIds;
    if (override?.ccMailIds?.length)  payload.cc_mail_ids  = override.ccMailIds;
    if (override?.bccMailIds?.length) payload.bcc_mail_ids = override.bccMailIds;
    if (override?.subject)            payload.subject      = override.subject;
    if (override?.body)               payload.body         = override.body;

    try {
      // POST /estimates/{id}/email — sends the mail via Zoho + sets estimate status = sent
      await client.post(`/estimates/${row.quoteId}/email`, payload);
    } catch (err) {
      const zohoBody = (err as { response?: { data?: { message?: string } } })?.response?.data;
      throw new BadRequestException(`Zoho email failed: ${zohoBody?.message ?? (err instanceof Error ? err.message : String(err))}`);
    }

    await this.prisma.renewalHistory.updateMany({
      where: { quoteId: row.quoteId },
      data: { zohoEstimateStatus: 'sent', sentAt: new Date() },
    });
    this.logger.log(`Proforma ${row.quoteNumber} emailed via Zoho (estimate ${row.quoteId})`);
    return { ok: true, zohoEstimateStatus: 'sent', sentTo: (override?.toMailIds ?? [])[0] ?? null };
  }

  /**
   * Convert the Quote/Estimate into an Invoice directly via Zoho Books API.
   * Copies all line items and customer details automatically based on estimate ID.
   */
  async convertToInvoice(historyId: string) {
    const row = await this.findRenewalHistory(historyId);
    if (!row.quoteId) throw new BadRequestException('No quote/estimate ID found');
    const client = await this.zoho.clientFor(row.organizationId);

    // 1. Convert Estimate to Invoice
    let zohoInvoiceId: string;
    let zohoInvoiceNumber: string | null = null;
    let zohoInvoiceDate: string | null = null;

    try {
      // Fetch the estimate to copy its customer and line items
      const estResp = await client.get<{ estimate: any }>(`/estimates/${row.quoteId}`);
      const est = estResp.estimate;
      if (!est) throw new Error('Estimate not found in Zoho');

      const payload = {
        customer_id: est.customer_id,
        invoiced_estimate_id: est.estimate_id,
        line_items: est.line_items.map((item: any) => ({
          item_id: item.item_id,
          name: item.name,
          description: item.description,
          rate: item.rate,
          quantity: item.quantity,
          discount: item.discount,
          discount_amount: item.discount_amount,
          tax_id: item.tax_id,
        })),
        notes: est.notes,
        terms: est.terms,
        // Omitted custom_fields to let Zoho natively copy only the supported fields
      };

      const resp = await client.post<{ invoice: { invoice_id: string; invoice_number: string; date?: string } }>(
        `/invoices?estimate_id=${row.quoteId}`,
        payload
      );
      if (!resp.invoice?.invoice_id) throw new Error('No invoice_id in response');
      zohoInvoiceId = resp.invoice.invoice_id;
      zohoInvoiceNumber = resp.invoice.invoice_number;
      zohoInvoiceDate = resp.invoice.date ?? null;
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || String(err);
      this.logger.error(`Failed to convert estimate to invoice: ${msg}`);
      throw new BadRequestException(`Zoho conversion failed: ${msg}`);
    }

    // 2. Mark the estimate as Accepted (to keep it clean)
    try {
      await client.post(`/estimates/${row.quoteId}/status/accepted`, {});
    } catch (e) {
      this.logger.warn(`Failed to mark estimate ${row.quoteId} as accepted, but conversion succeeded.`);
    }
    
    // 3. Update the local DB
    await this.prisma.renewalHistory.updateMany({
      where: { quoteId: row.quoteId },
      data: {
        invoiceId: zohoInvoiceId,
        invoiceNumber: zohoInvoiceNumber,
        zohoInvoiceStatus: 'draft',
        renewalStatus: 'Invoiced',
        zohoEstimateStatus: 'invoiced',
        invoiceDate: zohoInvoiceDate ? new Date(zohoInvoiceDate) : new Date(),
      },
    });

    return {
      ok: true,
      invoiceId: zohoInvoiceId,
      invoiceNumber: zohoInvoiceNumber,
    };
  }


  /**
   * Pull the live status of the Zoho estimate AND (once converted) the resulting
   * Tax Invoice, syncing both into renewal_history so the history reflects Zoho Books.
   * Flow: estimate status → invoice link → invoice status (paid/unpaid/overdue) → payment.
   */
  async refreshProformaStatus(historyId: string) {
    const row = await this.findRenewalHistory(historyId);
    const client = await this.zoho.clientFor(row.organizationId);

    // 1. Estimate (proforma) status + any linked invoice reference
    const estResp = await client.get<{
      estimate?: { status?: string; invoice_id?: string; invoice_number?: string; invoices?: Array<{ invoice_id?: string; invoice_number?: string }> };
    }>(`/estimates/${row.quoteId}`);
    this.logger.log(`EST RESP for ${row.quoteId}: ${JSON.stringify(estResp.estimate)}`);
    const estimateStatus = estResp.estimate?.status ?? null;
    const firstInvoice = estResp.estimate?.invoices?.[0];
    let invoiceId = firstInvoice?.invoice_id || estResp.estimate?.invoice_id || row.invoiceId || null;
    let invoiceNumber = firstInvoice?.invoice_number || estResp.estimate?.invoice_number || row.invoiceNumber || null;

    if (!invoiceId && estimateStatus === 'invoiced') {
      try {
        const listResp = await client.get<{ invoices: Array<{ invoice_id: string; invoice_number: string }> }>(`/invoices?estimate_id=${row.quoteId}`);
        if (listResp.invoices && listResp.invoices.length > 0) {
          invoiceId = listResp.invoices[0].invoice_id;
          invoiceNumber = listResp.invoices[0].invoice_number;
        }
      } catch (err) {
        this.logger.warn(`Failed to find linked invoice for estimate ${row.quoteId}`, err);
      }
    }

    const data: Prisma.RenewalHistoryUpdateInput = { zohoEstimateStatus: estimateStatus };
    if (estimateStatus === 'invoiced' && row.renewalStatus === 'Quoted') {
      data.renewalStatus = 'Invoiced';
    }

    // 2. If an invoice exists, pull its live status + payment info
    let isPaidTransition = false;
    if (invoiceId) {
      data.invoiceId = invoiceId;
      if (invoiceNumber) data.invoiceNumber = invoiceNumber;
      try {
        const invResp = await client.get<{
          invoice?: {
            status?: string;
            date?: string;
            last_payment_date?: string;
            payments?: Array<{ payment_id?: string; date?: string }>;
          };
        }>(`/invoices/${invoiceId}`);
        const inv = invResp.invoice;
        if (inv) {
          data.zohoInvoiceStatus = inv.status ?? null;
          if (inv.date) data.invoiceDate = new Date(inv.date);
          const payment = inv.payments?.[0];
          if (payment?.payment_id) {
            data.paymentId = payment.payment_id;
            const payDate = payment.date ?? inv.last_payment_date;
            if (payDate) data.paymentDate = new Date(payDate);
          }
          if (inv.status === 'paid' || inv.status === 'partially_paid') {
            // Always attempt to update subscription dates on paid invoice,
            // not just on the first-time transition, so re-syncing a paid
            // invoice still fixes dates if they were missed earlier.
            isPaidTransition = true;
            data.renewalStatus = 'Paid';
          }
          else if (['sent', 'overdue'].includes(inv.status ?? '') && row.renewalStatus === 'Quoted') {
            data.renewalStatus = 'Invoiced';
          }
        }
      } catch (err) {
        this.logger.warn(`Invoice ${invoiceId} status sync failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await this.prisma.renewalHistory.updateMany({ where: { quoteId: row.quoteId }, data });

    // If paid, update the subscription dates.
    // De-duplicate by subscriptionId (take latest row per subscription) so that
    // stale duplicate history rows don't conflict with each other.
    // The specifically-synced row always takes precedence for its own subscription.
    if (isPaidTransition) {
      const allRows = await this.prisma.renewalHistory.findMany({
        where: { quoteId: row.quoteId },
        orderBy: { createdAt: 'desc' },
      });
      const latestBySubId = new Map<string, typeof allRows[0]>();
      for (const r of allRows) {
        if (!latestBySubId.has(r.subscriptionId)) {
          latestBySubId.set(r.subscriptionId, r);
        }
      }
      // The specifically-synced row always wins for its subscription
      latestBySubId.set(row.subscriptionId, row as typeof allRows[0]);

      for (const r of latestBySubId.values()) {
        const sub = await this.prisma.subscription.findUnique({
          where: { id: r.subscriptionId },
        });
        if (sub) {
          const updateData: Record<string, unknown> = {
            processStatus: 'None',
            lastInvoiceId: invoiceId,
          };

          if (r.businessType === 'Renewal' && r.serviceStartDate && r.serviceEndDate) {
            updateData.startDate       = r.serviceStartDate;
            updateData.endDate         = r.serviceEndDate;
            updateData.lifecycleStatus = 'Active';
            const nextRenewal = new Date(r.serviceEndDate);
            nextRenewal.setDate(nextRenewal.getDate() + 1);
            updateData.nextRenewalDate = nextRenewal;
          } else if (r.businessType === 'ProRata' && r.quantity) {
            updateData.quantity = Number(sub.quantity) + Number(r.quantity);
          }

          await this.prisma.subscription.update({
            where: { id: r.subscriptionId },
            data: updateData,
          });

          await this.auditLogs.logAction({
            entityType: 'subscription',
            entityId: r.subscriptionId,
            action: 'update',
            changeSummary: `Invoice ${invoiceNumber || invoiceId || ''} paid via Zoho Books. Subscription dates and status updated.`,
            userEmailSnapshot: 'System',
          });
        }
      }
      this.logger.log(`Subscription updated on paid invoice for quote ${row.quoteId}`);
    }

    return {
      ok: true,
      zohoEstimateStatus: data.zohoEstimateStatus as string | null,
      zohoInvoiceStatus:  data.zohoInvoiceStatus as string | null,
      invoiceNumber:      data.invoiceNumber as string | null,
      renewalStatus:      data.renewalStatus as string,
    };
  }

  // ------------------------------------------------------------------
  // Tax Invoice — resend via Zoho (once an estimate is converted)
  // ------------------------------------------------------------------

  /** Load a renewal_history row that has a linked Zoho invoice. */
  private async findRenewalHistoryWithInvoice(historyId: string) {
    const row = await this.prisma.renewalHistory.findUnique({
      where: { id: historyId },
      include: { subscription: true },
    });
    if (!row) throw new NotFoundException(`Renewal record ${historyId} not found`);
    if (!row.invoiceId) throw new BadRequestException('Is record me koi Zoho Tax Invoice nahi hai');
    return row;
  }

  /** Fetch Zoho's pre-filled email content for the Tax Invoice (subject/body/to/cc/bcc + templates). */
  async getInvoiceEmailPreview(historyId: string, templateId?: string) {
    const row = await this.findRenewalHistoryWithInvoice(historyId);
    const client = await this.zoho.clientFor(row.organizationId);

    const contactEmails: Array<{ name: string; email: string }> = [];
    try {
      const c = await client.get<{
        contact?: {
          email?: string;
          contact_name?: string;
          contact_persons?: Array<{ first_name?: string; last_name?: string; email?: string }>;
        };
      }>(`/contacts/${row.subscription.zohoCustomerId}`);
      const contact = c.contact;
      if (contact?.email) contactEmails.push({ name: contact.contact_name ?? 'Primary', email: contact.email });
      for (const p of contact?.contact_persons ?? []) {
        if (p.email && !contactEmails.find(e => e.email === p.email)) {
          contactEmails.push({
            name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Contact',
            email: p.email,
          });
        }
      }
    } catch { /* non-fatal */ }

    const url = templateId
      ? `/invoices/${row.invoiceId}/email?email_template_id=${templateId}`
      : `/invoices/${row.invoiceId}/email`;

    const resp = await client.get<{
      data?: {
        from_email?: string;
        to_mail_ids?: string[];
        cc_mail_ids?: string[];
        bcc_mail_ids?: string[];
        subject?: string;
        body?: string;
        emailtemplates?: Array<{ email_template_id: string; name: string; selected: boolean }>;
      };
    }>(url);

    const d = resp.data ?? {};
    const toMailIds = d.to_mail_ids?.length ? d.to_mail_ids : contactEmails.slice(0, 1).map(e => e.email);

    return {
      fromEmail:      d.from_email     ?? null,
      toMailIds,
      ccMailIds:      d.cc_mail_ids    ?? [],
      bccMailIds:     d.bcc_mail_ids   ?? [],
      subject:        d.subject        ?? '',
      body:           d.body           ?? '',
      emailTemplates: d.emailtemplates ?? [],
      contactEmails,
    };
  }

  /** (Re)send the Tax Invoice to the customer via Zoho Books. */
  async sendInvoice(
    historyId: string,
    override?: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string },
  ) {
    const row = await this.findRenewalHistoryWithInvoice(historyId);
    const client = await this.zoho.clientFor(row.organizationId);

    const payload: Record<string, unknown> = {};
    if (override?.toMailIds?.length)  payload.to_mail_ids  = override.toMailIds;
    if (override?.ccMailIds?.length)  payload.cc_mail_ids  = override.ccMailIds;
    if (override?.bccMailIds?.length) payload.bcc_mail_ids = override.bccMailIds;
    if (override?.subject)            payload.subject      = override.subject;
    if (override?.body)               payload.body         = override.body;

    try {
      await client.post(`/invoices/${row.invoiceId}/email`, payload);
    } catch (err) {
      const zohoBody = (err as { response?: { data?: { message?: string } } })?.response?.data;
      throw new BadRequestException(`Zoho invoice email failed: ${zohoBody?.message ?? (err instanceof Error ? err.message : String(err))}`);
    }

    await this.prisma.renewalHistory.updateMany({
      where: { invoiceId: row.invoiceId },
      data: { zohoInvoiceStatus: 'sent', sentAt: new Date() },
    });

    this.logger.log(`Tax Invoice ${row.invoiceNumber} emailed via Zoho (invoice ${row.invoiceId})`);
    return { ok: true, sentTo: (override?.toMailIds ?? [])[0] ?? null };
  }

  // ------------------------------------------------------------------
  // Dedicated Billing History
  // ------------------------------------------------------------------
  async getBillingHistory(params: { 
    page?: number; 
    limit?: number; 
    search?: string;
    type?: string;
    cycle?: string;
    quoteStatus?: string;
    invoiceStatus?: string;
  }) {
    const { page = 1, limit = 20, search, type, cycle, quoteStatus, invoiceStatus } = params;
    const offset = (page - 1) * limit;
    
    // We use raw SQL to deduplicate by quote_id/id and calculate total
    const searchFilter = search ? `%${search}%` : null;
    
    // Subquery retrieves the distinct latest row per quote.
    const sql = `
      SELECT * FROM (
        SELECT DISTINCT ON (COALESCE(rh.bulk_renewal_batch_id::text, rh.invoice_id, rh.quote_id, rh.id::text))
          rh.id as "historyId",
          rh.created_at as "createdAt",
          rh.business_type as "businessType",
          rh.billing_cycle as "billingCycle",
          rh.renewal_status as "renewalStatus",
          rh.zoho_estimate_status as "zohoEstimateStatus",
          rh.zoho_invoice_status as "zohoInvoiceStatus",
          rh.quote_id as "quoteId",
          COALESCE(rh.quote_number, qq.quote_number) as "quoteNumber",
          rh.invoice_id as "invoiceId",
          rh.invoice_number as "invoiceNumber",
          SUM(rh.subtotal_amount) OVER (PARTITION BY COALESCE(rh.bulk_renewal_batch_id::text, rh.invoice_id, rh.quote_id, rh.id::text)) as "groupedTotalAmount",
          COUNT(*) OVER (PARTITION BY COALESCE(rh.bulk_renewal_batch_id::text, rh.invoice_id, rh.quote_id, rh.id::text)) as "groupedDomainCount",
          rh.subtotal_amount as "subtotalAmount",
          rh.currency,
          sub.zoho_customer_name as "zohoCustomerName",
          sub.zoho_customer_id as "zohoCustomerId",
          sub.zoho_item_name as "zohoItemName",
          d.domain_name as "domainName",
          org.name as "orgName",
          org.zoho_org_id as "zohoOrgId",
          org.data_center as "dataCenter",
          rb.id as "batchId",
          rb.domain_count as "batchDomainCount",
          rb.total_amount as "batchTotalAmount",
          rh.service_start_date as "serviceStartDate",
          rh.service_end_date as "serviceEndDate",
          rh.quantity,
          rh.selling_price as "sellingPrice"
        FROM renewal_history rh
        INNER JOIN subscriptions sub ON rh.subscription_id = sub.id
        INNER JOIN organizations org ON rh.organization_id = org.id
        INNER JOIN domains d ON rh.domain_id = d.id
        LEFT JOIN renewal_batches rb ON rh.bulk_renewal_batch_id = rb.id
        LEFT JOIN quick_quotes qq ON sub.origin_quick_quote_id = qq.id
        WHERE
          ($1::text IS NULL OR 
           sub.zoho_customer_name ILIKE $1 OR 
           COALESCE(rh.quote_number, qq.quote_number) ILIKE $1 OR 
           rh.invoice_number ILIKE $1 OR
           sub.zoho_item_name ILIKE $1)
          AND ($4::text IS NULL OR rh.business_type::text ILIKE $4)
          AND ($5::text IS NULL OR rh.billing_cycle::text ILIKE $5)
          AND ($6::text IS NULL OR (COALESCE(rh.zoho_estimate_status, rh.renewal_status::text) ILIKE $6))
          AND ($7::text IS NULL OR rh.zoho_invoice_status ILIKE $7)
        ORDER BY COALESCE(rh.bulk_renewal_batch_id::text, rh.invoice_id, rh.quote_id, rh.id::text), rh.created_at DESC
      ) as distinct_history
      ORDER BY "createdAt" DESC
      LIMIT $2 OFFSET $3;
    `;

    const countSql = `
      SELECT COUNT(DISTINCT COALESCE(rh.bulk_renewal_batch_id::text, rh.invoice_id, rh.quote_id, rh.id::text))::int as total
      FROM renewal_history rh
      INNER JOIN subscriptions sub ON rh.subscription_id = sub.id
      LEFT JOIN quick_quotes qq ON sub.origin_quick_quote_id = qq.id
      WHERE
        ($1::text IS NULL OR 
         sub.zoho_customer_name ILIKE $1 OR 
         COALESCE(rh.quote_number, qq.quote_number) ILIKE $1 OR 
         rh.invoice_number ILIKE $1 OR
         sub.zoho_item_name ILIKE $1)
        AND ($2::text IS NULL OR rh.business_type::text ILIKE $2)
        AND ($3::text IS NULL OR rh.billing_cycle::text ILIKE $3)
        AND ($4::text IS NULL OR (COALESCE(rh.zoho_estimate_status, rh.renewal_status::text) ILIKE $4))
        AND ($5::text IS NULL OR rh.zoho_invoice_status ILIKE $5)
    `;

    const queryArgs = [searchFilter, limit, offset, type || null, cycle || null, quoteStatus || null, invoiceStatus || null];
    const rows = await this.prisma.$queryRawUnsafe<any[]>(sql, ...queryArgs);
    const countArgs = [searchFilter, type || null, cycle || null, quoteStatus || null, invoiceStatus || null];
    const countResult = await this.prisma.$queryRawUnsafe<{ total: number }[]>(countSql, ...countArgs);
    const total = countResult[0]?.total ?? 0;

    return {
      items: rows.map(r => ({
        id: r.historyId,
        createdAt: r.createdAt,
        businessType: r.businessType,
        billingCycle: r.billingCycle,
        renewalStatus: r.renewalStatus,
        zohoEstimateStatus: r.zohoEstimateStatus,
        zohoInvoiceStatus: r.zohoInvoiceStatus,
        quoteId: r.quoteId,
        quoteNumber: r.quoteNumber,
        invoiceId: r.invoiceId,
        invoiceNumber: r.invoiceNumber,
        amount: r.batchId ? Number(r.batchTotalAmount) : Number(r.groupedTotalAmount),
        currency: r.currency,
        zohoCustomerName: r.zohoCustomerName,
        zohoCustomerId: r.zohoCustomerId,
        zohoItemName: r.zohoItemName,
        domainCount: r.batchId ? Number(r.batchDomainCount) : Number(r.groupedDomainCount),
        domainName: r.batchId ? null : r.domainName,
        serviceStartDate: r.serviceStartDate ? new Date(r.serviceStartDate).toISOString() : null,
        serviceEndDate: r.serviceEndDate ? new Date(r.serviceEndDate).toISOString() : null,
        quantity: r.quantity != null ? String(r.quantity) : null,
        sellingPrice: r.sellingPrice != null ? String(r.sellingPrice) : null,
        organization: {
          name: r.orgName,
          zohoOrgId: r.zohoOrgId,
          dataCenter: r.dataCenter,
        },
      })),
      total,
      page,
      limit,
    };
  }

  async getBillingHistoryActivity(historyId: string) {
    const history = await this.prisma.renewalHistory.findUnique({
      where: { id: historyId },
      select: { quoteId: true, invoiceId: true, organizationId: true }
    });
    if (!history) throw new NotFoundException('History record not found');

    const client = await this.zoho.clientFor(history.organizationId);

    let quoteComments = [];
    let invoiceComments = [];

    if (history.quoteId) {
      try {
        const resp = await client.get<{ comments: any[] }>(`/estimates/${history.quoteId}/comments`);
        quoteComments = resp?.comments ?? [];
      } catch (err) {
        this.logger.warn(`Failed to fetch quote comments for ${history.quoteId}`, err);
      }
    }

    if (history.invoiceId) {
      try {
        const resp = await client.get<{ comments: any[] }>(`/invoices/${history.invoiceId}/comments`);
        invoiceComments = resp?.comments ?? [];
      } catch (err) {
        this.logger.warn(`Failed to fetch invoice comments for ${history.invoiceId}`, err);
      }
    }

    return { quoteComments, invoiceComments };
  }

  // ------------------------------------------------------------------
  // Renewal Batches History
  // ------------------------------------------------------------------
  async listRenewalBatches(params: { page?: number; limit?: number; search?: string; ids?: string[] }) {
    const { page = 1, limit = 20, search, ids } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.RenewalBatchWhereInput = {};
    // When navigating from "Generate Bulk Quotes", the UI passes the just-created batch ids
    // so the review screen shows only this run's batches.
    if (ids?.length) where.id = { in: ids };
    if (search) {
      where.OR = [
        { zohoCustomerName:    { contains: search, mode: 'insensitive' } },
        { zohoItemName:        { contains: search, mode: 'insensitive' } },
        { zohoEstimateNumber:  { contains: search, mode: 'insensitive' } },
        // Find the batch a specific domain belongs to — matches any domain in the batch.
        { renewalHistories: { some: { domain: { domainName: { contains: search, mode: 'insensitive' } } } } },
      ];
    }

    const [batches, total] = await Promise.all([
      this.prisma.renewalBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          // Org zohoOrgId + dataCenter power the Zoho Books deep link on the review screen.
          organization: { select: { zohoOrgId: true, dataCenter: true } },
          renewalHistories: {
            select: {
              subscriptionId: true,
              domain: { select: { domainName: true } },
              // All rows in a batch share the one estimate, so a representative row's
              // status describes the whole batch (see deriveBatchStatus).
              zohoEstimateStatus: true,
              zohoInvoiceStatus: true,
              renewalStatus: true,
            },
          },
        },
      }),
      this.prisma.renewalBatch.count({ where }),
    ]);

    const term = search?.trim().toLowerCase() ?? '';
    return {
      batches: batches.map(b => {
        const rep = b.renewalHistories[0];
        return {
          ...b,
          subscriptionIds: b.renewalHistories.map(rh => rh.subscriptionId),
          // Live-ish status for the batch review screen (persisted by send/refresh).
          zohoEstimateStatus: rep?.zohoEstimateStatus ?? null,
          zohoInvoiceStatus:  rep?.zohoInvoiceStatus ?? null,
          status: this.deriveBatchStatus(rep?.zohoEstimateStatus, rep?.zohoInvoiceStatus),
          // When searching, surface which domain(s) in this batch matched — a batch can
          // hold 100+ domains, so the row needs to show why it was returned.
          matchedDomains: term
            ? Array.from(
                new Set(
                  b.renewalHistories
                    .map(rh => rh.domain?.domainName)
                    .filter((d): d is string => !!d && d.toLowerCase().includes(term)),
                ),
              )
            : [],
        };
      }),
      total,
      page,
      limit,
    };
  }

  /** Normalize a batch's estimate + invoice status into one label for the review screen. */
  private deriveBatchStatus(estimateStatus?: string | null, invoiceStatus?: string | null): string {
    const inv = (invoiceStatus ?? '').toLowerCase();
    const est = (estimateStatus ?? '').toLowerCase();
    if (inv === 'paid') return 'Paid';
    if (inv) return 'Invoiced';                 // sent / overdue / partially_paid
    if (est) return est;                        // draft / sent / accepted / declined / invoiced / expired
    return 'draft';
  }

  // ------------------------------------------------------------------
  // Batch-level proforma actions (one estimate → many history rows)
  // ------------------------------------------------------------------

  /** Load a renewal batch with its history rows (all rows share the one estimate). */
  private async findBatchWithHistory(batchId: string) {
    const batch = await this.prisma.renewalBatch.findUnique({
      where: { id: batchId },
      include: { renewalHistories: { include: { subscription: true } } },
    });
    if (!batch) throw new NotFoundException(`Renewal batch ${batchId} not found`);
    if (!batch.zohoEstimateId) throw new BadRequestException('Is batch me koi Zoho estimate nahi hai');
    return batch;
  }

  /** Zoho email content for a batch's estimate — reuses the per-history preview via a representative row. */
  async getBatchEmailPreview(batchId: string, templateId?: string) {
    const batch = await this.findBatchWithHistory(batchId);
    const rep = batch.renewalHistories.find(h => h.quoteId);
    if (!rep) throw new BadRequestException('Batch me koi quote-linked history row nahi hai');
    return this.getEmailPreview(rep.id, templateId);
  }

  /**
   * Send the batch's ONE estimate to the customer via Zoho, then mark every history row
   * in the batch as sent. `override` carries compose-modal values; omit it for a plain
   * bulk-send with Zoho's default template.
   */
  async sendBatch(
    batchId: string,
    override?: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string },
  ) {
    const batch = await this.findBatchWithHistory(batchId);
    const client = await this.zoho.clientFor(batch.organizationId);

    const payload: Record<string, unknown> = {};
    if (override?.toMailIds?.length)  payload.to_mail_ids  = override.toMailIds;
    if (override?.ccMailIds?.length)  payload.cc_mail_ids  = override.ccMailIds;
    if (override?.bccMailIds?.length) payload.bcc_mail_ids = override.bccMailIds;
    if (override?.subject)            payload.subject      = override.subject;
    if (override?.body)               payload.body         = override.body;

    try {
      await client.post(`/estimates/${batch.zohoEstimateId}/email`, payload);
    } catch (err) {
      const zohoBody = (err as { response?: { data?: { message?: string } } })?.response?.data;
      throw new BadRequestException(`Zoho email failed: ${zohoBody?.message ?? (err instanceof Error ? err.message : String(err))}`);
    }

    await this.prisma.renewalHistory.updateMany({
      where: { bulkRenewalBatchId: batchId },
      data: { zohoEstimateStatus: 'sent', sentAt: new Date() },
    });
    this.logger.log(`Batch ${batch.zohoEstimateNumber} emailed via Zoho (estimate ${batch.zohoEstimateId})`);
    return { ok: true, zohoEstimateStatus: 'sent', sentTo: (override?.toMailIds ?? [])[0] ?? null };
  }

  /**
   * Pull the batch estimate's live status (+ linked invoice / payment) from Zoho ONCE and
   * persist it to every history row in the batch. Mirrors refreshProformaStatus but batch-wide.
   */
  async refreshBatch(batchId: string) {
    const batch = await this.findBatchWithHistory(batchId);
    const client = await this.zoho.clientFor(batch.organizationId);

    const estResp = await client.get<{
      estimate?: { status?: string; invoice_id?: string; invoice_number?: string; invoices?: Array<{ invoice_id?: string; invoice_number?: string }> };
    }>(`/estimates/${batch.zohoEstimateId}`);
    const estimateStatus = estResp.estimate?.status ?? null;
    const firstInvoice = estResp.estimate?.invoices?.[0];
    let invoiceId = firstInvoice?.invoice_id || estResp.estimate?.invoice_id || null;
    let invoiceNumber = firstInvoice?.invoice_number || estResp.estimate?.invoice_number || null;

    if (!invoiceId && estimateStatus === 'invoiced') {
      try {
        const listResp = await client.get<{ invoices: Array<{ invoice_id: string; invoice_number: string }> }>(`/invoices?estimate_id=${batch.zohoEstimateId}`);
        if (listResp.invoices && listResp.invoices.length > 0) {
          invoiceId = listResp.invoices[0].invoice_id;
          invoiceNumber = listResp.invoices[0].invoice_number;
        }
      } catch (err) {
        this.logger.warn(`Failed to find linked invoice for estimate ${batch.zohoEstimateId}`, err);
      }
    }

    const data: Prisma.RenewalHistoryUpdateManyMutationInput = { zohoEstimateStatus: estimateStatus };
    let renewalStatus: 'Invoiced' | 'Paid' | null = estimateStatus === 'invoiced' ? 'Invoiced' : null;
    let zohoInvoiceStatus: string | null = null;

    if (invoiceId) {
      data.invoiceId = invoiceId;
      if (invoiceNumber) data.invoiceNumber = invoiceNumber;
      try {
        const invResp = await client.get<{
          invoice?: {
            status?: string;
            date?: string;
            last_payment_date?: string;
            payments?: Array<{ payment_id?: string; date?: string }>;
          };
        }>(`/invoices/${invoiceId}`);
        const inv = invResp.invoice;
        if (inv) {
          zohoInvoiceStatus = inv.status ?? null;
          data.zohoInvoiceStatus = zohoInvoiceStatus;
          if (inv.date) data.invoiceDate = new Date(inv.date);
          const payment = inv.payments?.[0];
          if (payment?.payment_id) {
            data.paymentId = payment.payment_id;
            const payDate = payment.date ?? inv.last_payment_date;
            if (payDate) data.paymentDate = new Date(payDate);
          }
          if (inv.status === 'paid' || inv.status === 'partially_paid') renewalStatus = 'Paid';
          else if (['sent', 'overdue'].includes(inv.status ?? '')) renewalStatus = renewalStatus ?? 'Invoiced';
        }
      } catch (err) {
        this.logger.warn(`Batch ${batchId} invoice ${invoiceId} status sync failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (renewalStatus) data.renewalStatus = renewalStatus;

    // Find all rows in this batch that are not yet marked Paid in local DB
    const historyRows = await this.prisma.renewalHistory.findMany({
      where: { bulkRenewalBatchId: batchId, renewalStatus: { not: 'Paid' } },
    });

    await this.prisma.renewalHistory.updateMany({ where: { bulkRenewalBatchId: batchId }, data });

    // If transitioned to Paid, extend all the subscriptions in the batch!
    if (renewalStatus === 'Paid' && historyRows.length > 0) {
      for (const historyRow of historyRows) {
        const sub = await this.prisma.subscription.findUnique({
          where: { id: historyRow.subscriptionId },
        });
        if (!sub) continue;

        const updateData: Record<string, unknown> = {
          processStatus: 'None',
          lastInvoiceId: invoiceId,
        };

        if (historyRow.businessType === 'Renewal' &&
            historyRow.serviceStartDate && historyRow.serviceEndDate) {
          updateData.startDate       = historyRow.serviceStartDate;
          updateData.endDate         = historyRow.serviceEndDate;
          updateData.lifecycleStatus = 'Active';
          const nextRenewal = new Date(historyRow.serviceEndDate);
          nextRenewal.setDate(nextRenewal.getDate() + 1);
          updateData.nextRenewalDate = nextRenewal;
        } else if (historyRow.businessType === 'ProRata' && historyRow.quantity) {
          updateData.quantity = Number(sub.quantity) + Number(historyRow.quantity);
        }

        await this.prisma.subscription.update({
          where: { id: historyRow.subscriptionId },
          data: updateData,
        });

        await this.auditLogs.logAction({
          entityType: 'subscription',
          entityId: historyRow.subscriptionId,
          action: 'update',
          changeSummary: `Invoice ${invoiceNumber || invoiceId || ''} was paid via Zoho Books. Auto-renewed dates and activated subscription.`,
          userEmailSnapshot: 'System',
        });

        this.logger.log(`Subscription ${sub.subscriptionNumber} dates/status updated via bulk refresh (paid transition)`);
      }
    }

    return {
      ok: true,
      zohoEstimateStatus: estimateStatus,
      zohoInvoiceStatus,
      invoiceNumber,
      renewalStatus,
      status: this.deriveBatchStatus(estimateStatus, zohoInvoiceStatus),
    };
  }

  async bulkTransferCustomer(
    dto: { subscriptionIds: string[]; zohoCustomerId: string; zohoCustomerName: string },
    user: AuthUser,
  ) {
    const { subscriptionIds, zohoCustomerId, zohoCustomerName } = dto;
    if (!subscriptionIds.length) throw new BadRequestException('No subscriptions selected');

    // Fetch subscriptions with their current domain info
    const subscriptions = await this.prisma.subscription.findMany({
      where: { id: { in: subscriptionIds } },
      include: { domain: true },
    });

    // For each unique source domain, find or create the equivalent domain record
    // under the target customer so the same mapped domain name can exist per-customer.
    const domainMapping = new Map<string, string>(); // source domainId → target domainId

    for (const sub of subscriptions) {
      if (domainMapping.has(sub.domainId)) continue;

      const { domainName, organizationId, status, notes } = sub.domain;

      let targetDomain = await this.prisma.domain.findFirst({
        where: { domainName, organizationId, zohoCustomerId },
      });

      if (!targetDomain) {
        targetDomain = await this.prisma.domain.create({
          data: { domainName, organizationId, zohoCustomerId, zohoCustomerName, status, notes: notes ?? undefined },
        });
        this.logger.log(`Transfer: created domain "${domainName}" for customer ${zohoCustomerId}`);
      }

      domainMapping.set(sub.domainId, targetDomain.id);
    }

    // Update each subscription: new customer + re-mapped domainId
    let count = 0;
    for (const sub of subscriptions) {
      const newDomainId = domainMapping.get(sub.domainId) ?? sub.domainId;
      const domainChanged = newDomainId !== sub.domainId;

      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { zohoCustomerId, zohoCustomerName, domainId: newDomainId },
      });

      await this.auditLogs.logAction({
        entityType: 'subscription',
        entityId: sub.id,
        action: 'update',
        changeSummary: `Customer transferred to "${zohoCustomerName}" (${zohoCustomerId})${domainChanged ? '; domain record re-mapped' : ''}`,
        userId: user.id,
        userEmailSnapshot: user.email,
      });

      count++;
    }

    this.logger.log(
      `Bulk customer transfer: ${count} subs → ${zohoCustomerName} (${zohoCustomerId}) by ${user.email}`,
    );
    return { success: true, count };
  }

  async remove(id: string, user: AuthUser) {
    const sub = await this.findOne(id);

    // Delete associated renewal history
    await this.prisma.renewalHistory.deleteMany({
      where: { subscriptionId: id },
    });

    // Delete subscription
    await this.prisma.subscription.delete({
      where: { id },
    });

    await this.auditLogs.logAction({
      entityType: 'subscription',
      entityId: id,
      action: 'delete',
      changeSummary: `Subscription ${sub.subscriptionNumber} for domain ${sub.domain?.domainName || id} deleted`,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    this.logger.log(`Deleted subscription ${id}`);
    return { deleted: true };
  }
}
