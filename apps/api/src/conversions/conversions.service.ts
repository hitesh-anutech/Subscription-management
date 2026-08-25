import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { QuickQuoteItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ZohoService } from '../zoho/zoho.service';
import { AnnexureService } from '../subscriptions/annexure.service';
import type { TriggerConversionDto, ConvertQuoteDto, CreateInvoiceDto } from './dto/conversions.dto';

/** Bulk-domains quote line entry (quick_quote_items.domain_list JSON). */
type ItemDomain = { domain: string; qty?: number };

function getDomainList(item: { domainList?: unknown }): ItemDomain[] | null {
  const dl = item.domainList as ItemDomain[] | null | undefined;
  return Array.isArray(dl) && dl.length ? dl : null;
}

/** "first.com +N more" label for header/line Domain custom fields on bulk lines. */
function domainSummary(domains: ItemDomain[]): string {
  return domains.length > 1 ? `${domains[0].domain} +${domains.length - 1} more` : domains[0].domain;
}

/** DD/MM/YYYY from an ISO date string. */
function fmtDMY(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const CONV_CYCLE_LABELS: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half Yearly',
  annual: 'Yearly', biennial: 'Biennial', triennial: 'Triennial', one_time: 'One Time',
};

/**
 * "Monthly (28/07/2026 to 27/08/2026)" for named cycles,
 * "30 days (28/07/2026 to 27/08/2026)" for one_time / pro-rata.
 */
function convValidityLabel(cycle: string | null | undefined, startIso: string, endIso: string): string {
  const dateRange = `(${fmtDMY(startIso)} to ${fmtDMY(endIso)})`;
  if (cycle && cycle !== 'one_time') {
    return `${CONV_CYCLE_LABELS[cycle] ?? cycle} ${dateRange}`;
  }
  const days = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 86400000);
  return `${days} days ${dateRange}`;
}

/** Add one billing cycle to a date (end-of-period). */
function addCycle(from: Date, cycle: string): Date {
  const d = new Date(from);
  switch (cycle) {
    case 'monthly':     d.setMonth(d.getMonth() + 1); break;
    case 'quarterly':   d.setMonth(d.getMonth() + 3); break;
    case 'half_yearly': d.setMonth(d.getMonth() + 6); break;
    case 'biennial':    d.setFullYear(d.getFullYear() + 2); break;
    case 'triennial':   d.setFullYear(d.getFullYear() + 3); break;
    case 'one_time':    return d;
    default:            d.setFullYear(d.getFullYear() + 1); // annual
  }
  d.setDate(d.getDate() - 1);
  return d;
}

/**
 * ConversionsService — lead → Zoho customer + Invoice conversion.
 *
 * Updated flow (per user requirement):
 *   1. Create Zoho Customer (POST /contacts) — with dynamic custom fields
 *   2. Create domain record
 *   3. Create Zoho Invoice (POST /invoices) — NOT Estimate; Zoho serial number used
 *   4. Update lead + quote + audit log
 *   5. Return invoice data + quote items → Frontend redirects to Subscription Creation page
 *
 * Subscriptions are NOT auto-created here — user reviews on the Subscription
 * Creation page and clicks "Create Subscription" manually.
 *   5. Update lead.status = 'Converted'
 *   6. Update quick_quote.status = 'Pushed_To_Zoho'
 *   7. Insert lead_conversions audit row → Commit
 */
@Injectable()
export class ConversionsService {
  private readonly logger = new Logger(ConversionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zoho: ZohoService,
    private readonly annexure: AnnexureService,
  ) {}

  /**
   * Build Zoho invoice line_items, attaching each item's line-level custom fields
   * (Domain Name / Start Date / End Date / Cost Price) from the mapped 'items' module.
   */
  private async buildInvoiceLineItems(
    orgId: string,
    items: QuickQuoteItem[],
    convs: { domainName: string; startIso: string; endIso: string; costPrice?: number }[],
  ) {
    return Promise.all(items.map(async (item, idx) => {
      const conv = convs[idx] ?? convs[0];
      // Bulk-domains line → single aggregated Zoho line (qty = Σ domain qty):
      // domain CF shows "first +N more"; <100 domains listed in the description,
      // ≥100 → summary line + Technical Annexure PDF attached after invoice create.
      const domains = getDomainList(item);
      // costPrice: prefer DTO value (form-confirmed), fall back to DB
      const costPriceVal = conv.costPrice != null
        ? String(conv.costPrice)
        : (item.costPrice != null ? String(Number(item.costPrice)) : '');
      const itemCf = await this.zoho.buildCustomFields(orgId, 'items', {
        // Each line carries its OWN quote-item domain; the convert-level domain
        // is only a fallback for legacy items without one.
        domain_name: domains ? domainSummary(domains) : (item.primaryDomain || conv.domainName),
        start_date:  conv.startIso,
        end_date:    conv.endIso,
        cost_price:  costPriceVal,
      });

      let description = item.itemDescription ?? '';

      // Single-domain line: add "Domain Name:" label.
      const singleDomain = !domains && (item.primaryDomain || conv.domainName);
      if (singleDomain) {
        description += (description ? '\n' : '') + `Domain Name: ${singleDomain}`;
      }

      // Bulk-domain line: add the domain list.
      if (domains && domains.length > 1) {
        description += description ? '\n\n' : '';
        description += domains.length < 100
          ? `Total of domain: [${domains.length}]\n${domains.map((d) => (d.qty && d.qty !== 1 ? `${d.domain} (${d.qty})` : d.domain)).join(', ')}`
          : `Bulk order for ${domains.length} domains — see attached Technical Annexure.`;
      }

      // Subscription validity (all subscription lines).
      if (item.isSubscription && conv.startIso && conv.endIso) {
        description += (description ? '\n' : '') +
          `Subscription Validity: ${convValidityLabel(item.billingCycle ? String(item.billingCycle) : null, conv.startIso, conv.endIso)}`;
      }

      return {
        item_id:     item.zohoItemId ?? undefined,
        name:        item.itemName,
        description,
        quantity:    Number(item.quantity),
        rate:        Number(item.unitPrice),
        ...(itemCf.length ? { item_custom_fields: itemCf } : {}),
      };
    }));
  }

  /**
   * After the Zoho invoice exists: persist the convert-time service dates onto
   * the quote items (drives the subscription prefill + bulk subscription create)
   * and attach a Technical Annexure PDF for every bulk line with ≥100 domains
   * (mirrors the renewal bulk-quote design). Non-fatal — annexure logs errors.
   */
  private async finalizeBulkInvoiceExtras(
    orgId: string,
    quote: { id: string; quoteNumber: string; items: QuickQuoteItem[] },
    invoiceId: string,
    invoiceNumber: string | null,
  ) {
    for (const [idx, it] of quote.items.entries()) {
      const domains = getDomainList(it);
      if (domains && domains.length >= 100) {
        await this.annexure.generateAndUploadAnnexure(
          orgId, invoiceId, invoiceNumber ?? quote.quoteNumber,
          domains.map((d) => ({ domainName: d.domain, status: 'New', quantity: d.qty ?? 1 })),
          { entity: 'invoices', subtitle: `${it.itemName} — ${quote.quoteNumber}`, fileLabel: `L${idx + 1}` },
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Trigger conversion
  // ------------------------------------------------------------------
  async triggerConversion(leadId: string, dto: TriggerConversionDto, userId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        quickQuotes: {
          where: dto.quickQuoteId ? { id: dto.quickQuoteId } : { status: 'Accepted' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { items: true },
        },
      },
    });

    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);
    if (lead.status === 'Converted') {
      throw new BadRequestException('Lead is already converted');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
    });
    if (!org) throw new NotFoundException(`Organization ${dto.organizationId} not found`);

    const quote = lead.quickQuotes[0] ?? null;
    if (!quote) {
      throw new BadRequestException('No accepted quote found for this lead — accept a quote first');
    }
    // Guard: even when an explicit quickQuoteId is passed, only an Accepted quote may convert.
    if (quote.status !== 'Accepted') {
      throw new BadRequestException(`Quote ${quote.quoteNumber} is not Accepted (status: ${quote.status}) — pehle quote accept karo`);
    }

    this.logger.log(`Starting conversion: lead=${lead.leadNumber} org=${org.name} quote=${quote.quoteNumber}`);

    let zohoCustomerId: string | null = null;
    let domainId: string | null = null;
    // Domain is collected at the Convert/Push step now; fall back to the lead's domain.
    let domainName = dto.domainName?.trim() || lead.primaryDomain || `lead-${lead.id}`;
    let errorMessage: string | null = null;
    let conversionStatus: 'success' | 'failed' = 'failed';

    try {
      const orgId = dto.organizationId;
      const zohoClient = await this.zoho.clientFor(dto.organizationId);

      // ── Step 1: Create Zoho Customer (with dynamic custom fields) ─────
      const primaryItem = quote.items.find((i) => i.isSubscription) ?? quote.items[0];
      const contactCf = await this.zoho.buildCustomFields(dto.organizationId, 'contacts', {
        domain_name:   lead.primaryDomain ?? '',
        business_type: await this.zoho.getBusinessTypeLabel(dto.organizationId, 'Fresh'),
        quantity:      primaryItem ? String(Number(primaryItem.quantity)) : '',
        unit_price:    primaryItem ? String(Number(primaryItem.unitPrice)) : '',
      });

      const contactPayload = {
        contact_name:    lead.companyName,
        contact_type:    'customer',
        billing_address: {
          address: lead.billingAddressLine1 ?? '',
          street2: lead.billingAddressLine2 ?? '',
          city:    lead.city ?? '',
          state:   lead.state ?? '',
          zip:     lead.postalCode ?? '',
          country: lead.country ?? 'India',
        },
        contact_persons: [{
          first_name:         (lead.contactName ?? '').split(' ')[0] ?? '',
          last_name:          (lead.contactName ?? '').split(' ').slice(1).join(' ') ?? '',
          email:              lead.email,
          phone:              lead.phone ?? '',
          is_primary_contact: true,
        }],
        gst_no:        lead.gstin ?? '',
        gst_treatment: lead.gstTreatment ?? '',
        pan_no:        lead.pan ?? '',
        website:       lead.primaryDomain ? `https://${lead.primaryDomain}` : '',
        custom_fields: contactCf,
      };

      // Zoho Books wants the entity fields at the TOP LEVEL of the JSON body,
      // NOT wrapped as { contact: {...} } (the estimate/invoice paths send flat too).
      const contactResp = await zohoClient.post<{ contact: { contact_id: string } }>(
        '/contacts', contactPayload,
      );
      zohoCustomerId = contactResp.contact?.contact_id;
      if (!zohoCustomerId) throw new Error('Zoho did not return a contact_id');
      this.logger.log(`Step 1 ✓ Zoho customer: ${zohoCustomerId}`);

      // ── Step 2: Create domain record ──────────────────────────────────
      let domain = await this.prisma.domain.findFirst({
        where: { domainName, organizationId: dto.organizationId, zohoCustomerId },
      });
      if (!domain) {
        domain = await this.prisma.domain.create({
          data: { domainName, organizationId: dto.organizationId, zohoCustomerId, zohoCustomerName: lead.companyName },
        });
      }
      domainId   = domain.id;
      domainName = domain.domainName;
      this.logger.log(`Step 2 ✓ Domain: ${domainName}`);

      conversionStatus = 'success';

    } catch (err) {
      // Zoho errors come back as an AxiosError — the real reason lives in response.data
      // ({ code, message }), not err.message ("Request failed with status code 400").
      const zohoBody = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data;
      const raw = zohoBody?.message ?? (err instanceof Error ? err.message : String(err));
      // A mandatory custom field missing/unmapped → actionable pointer to the mapping settings.
      errorMessage = /mandatory|required|cf_|custom field/i.test(raw)
        ? `Zoho ne field reject kiya — Settings → Custom Field Mapping me is org ke mandatory fields map karke dobara try karo. (Zoho: ${raw})`
        : `Zoho: ${raw}`;
      this.logger.error(
        `Conversion failed for lead ${lead.leadNumber}: ${raw}` +
        (zohoBody?.code != null ? ` (code ${zohoBody.code})` : ''),
      );
    }

    // ── Steps 4-6: DB updates ─────────────────────────────────────────
    await this.prisma.$transaction(async (tx) => {
      if (conversionStatus === 'success' && zohoCustomerId) {
        await tx.lead.update({
          where: { id: leadId },
          data: {
            status: 'Converted',
            convertedToZohoCustomerId: zohoCustomerId,
            convertedAt:              new Date(),
            targetOrganizationId:     dto.organizationId,
          },
        });

        await tx.quickQuote.update({
          where: { id: quote.id },
          data: {
            // Invoice will be created separately via POST .../create-invoice after subscriptions.
            subscriptionDecision: dto.subscriptionDecision ?? 'create_now',
          },
        });
      }

      await tx.leadConversion.create({
        data: {
          leadId,
          quickQuoteId:      quote.id,
          organizationId:    dto.organizationId,
          zohoCustomerId:    zohoCustomerId ?? undefined,
          // zohoEstimateId populated later when invoice is created via create-invoice endpoint
          subscriptionIds:   [],
          conversionStatus,
          errorMessage:      errorMessage ?? undefined,
          convertedByUserId: userId ?? undefined,
          convertedAt:       new Date(),
        },
      });
    });

    if (conversionStatus !== 'success') {
      throw new BadRequestException(`Conversion failed: ${errorMessage}`);
    }

    // Return full data needed for Subscription Creation page
    const subItems = quote.items.filter((i) => i.isSubscription);
    // Domain + service dates were collected at Convert; recompute the same values used
    // for the invoice so the Subscription page pre-fills the chosen domain + start (and
    // an auto-calculated, editable end date).
    const convStartDate = dto.serviceStartDate ? new Date(dto.serviceStartDate) : new Date();
    const convStartIso  = convStartDate.toISOString().split('T')[0];
    this.logger.log(`✓ Conversion complete: lead ${lead.leadNumber} — invoice pending (create via create-invoice endpoint)`);

    return {
      zohoCustomerId,
      zohoCustomerName:  lead.companyName,
      zohoInvoiceId:     null as string | null,   // invoice created separately after subscriptions
      zohoInvoiceNumber: null as string | null,
      domainId,
      domainName,
      organizationId:    dto.organizationId,
      quickQuoteId:      quote.id,
      subscriptionDecision: dto.subscriptionDecision ?? 'create_now',
      // >1 → bulk-domains quote: UI runs bulk subscription create instead of the single-sub page
      bulkDomainCount: quote.items.filter((i) => i.isSubscription)
        .reduce((s, i) => { const dl = getDomainList(i); return s + (dl && dl.length > 1 ? dl.length : 0); }, 0),
      // Pre-fill data for subscription creation
      subscriptionItems: subItems.map((item) => ({
        zohoItemId:    item.zohoItemId,
        zohoItemName:  item.itemName,
        quantity:      Number(item.quantity),
        price:         Number(item.unitPrice),
        costPrice:     item.costPrice != null ? Number(item.costPrice) : 0,
        billingCycle:  item.billingCycle,
        primaryDomain: item.primaryDomain ?? domainName,
        serviceStartDate: convStartIso,
        serviceEndDate:   addCycle(convStartDate, String(item.billingCycle ?? 'annual')).toISOString().split('T')[0],
      })),
    };
  }

  // ------------------------------------------------------------------
  // Existing-customer Standard Quote → Zoho Tax Invoice (no new Contact)
  // ------------------------------------------------------------------
  /**
   * Convert an ACCEPTED quote directly into a Zoho Tax Invoice when the
   * customer ALREADY exists in Zoho — either an existing-customer quote
   * (quote.zohoCustomerId) or a lead-quote whose lead was converted earlier
   * (lead.convertedToZohoCustomerId). No Contact is created either way.
   * Mirrors the invoice-creation step of triggerConversion (flat body, mapped custom fields).
   */
  async convertExistingCustomerQuote(quoteId: string, dto: ConvertQuoteDto, userId?: string) {
    const quote = await this.prisma.quickQuote.findUnique({
      where: { id: quoteId },
      include: { items: true, lead: true, targetOrganization: { select: { name: true } } },
    });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    const zohoCustomerId = quote.zohoCustomerId ?? quote.lead?.convertedToZohoCustomerId ?? null;
    if (!zohoCustomerId) {
      throw new BadRequestException('Is quote ka customer Zoho me exist nahi karta (zohoCustomerId missing) — Convert to Customer use karo');
    }
    if (quote.status !== 'Accepted') {
      throw new BadRequestException(`Quote ${quote.quoteNumber} is not Accepted (status: ${quote.status})`);
    }

    const orgId = quote.targetOrganizationId;

    // Guard: Zoho customer IDs are org-specific. If the cache knows this ID only
    // under a DIFFERENT org (e.g. the customer was picked before switching the org
    // on the quote form), Zoho would fail with a cryptic "Customer is not
    // accessible" — fail early with an actionable message instead. Not-in-cache
    // is allowed (cache may be stale); Zoho stays the final authority.
    const cacheRows = await this.prisma.zohoCache.findMany({
      where: { entityType: 'customer', zohoId: zohoCustomerId },
      select: { organizationId: true, organization: { select: { name: true } } },
    });
    if (cacheRows.length && !cacheRows.some((r) => r.organizationId === orgId)) {
      const otherOrg = cacheRows[0].organization?.name ?? 'kisi aur org';
      throw new BadRequestException(
        `Customer/org mismatch: yeh quote "${quote.targetOrganization?.name ?? 'target org'}" ki hai, ` +
        `par isme saved customer "${otherOrg}" ka hai. Quote ke customer ko sahi org se dobara select karke nayi quote banao.`,
      );
    }

    const zohoCustomerName = quote.zohoCustomerName ?? quote.lead?.companyName ?? '';

    const primary = quote.items.find((i) => i.isSubscription) ?? quote.items[0];
    // Domain collected at the Convert/Push step now; fall back to any legacy quote domain.
    let domainName = dto.domainName?.trim() || primary?.primaryDomain || `quote-${quote.id}`;
    let domainId: string | null = null;

    // Domain record (find/create) for this customer + domain
    let domain = await this.prisma.domain.findFirst({
      where: { domainName, organizationId: orgId, zohoCustomerId },
    });
    if (!domain) {
      domain = await this.prisma.domain.create({
        data: { domainName, organizationId: orgId, zohoCustomerId, zohoCustomerName },
      });
    }
    domainId = domain.id;
    domainName = domain.domainName;

    // Store subscription decision; invoice will be created separately via create-invoice endpoint.
    await this.prisma.quickQuote.update({
      where: { id: quote.id },
      data: { subscriptionDecision: dto.subscriptionDecision ?? 'create_now' },
    });

    const subItems = quote.items.filter((i) => i.isSubscription);
    void userId;
    const convStartDate = dto.serviceStartDate ? new Date(dto.serviceStartDate) : new Date();
    const convStartIso  = convStartDate.toISOString().split('T')[0];
    this.logger.log(`✓ Existing-customer quote ${quote.quoteNumber} Phase 1 done (customer + domain). Invoice pending.`);
    return {
      zohoCustomerId,
      zohoCustomerName,
      zohoInvoiceId:     null as string | null,   // invoice created separately after subscriptions
      zohoInvoiceNumber: null as string | null,
      domainId,
      domainName,
      organizationId: orgId,
      quickQuoteId:   quote.id,
      subscriptionDecision: dto.subscriptionDecision ?? 'create_now',
      bulkDomainCount: subItems
        .reduce((s, i) => { const dl = getDomainList(i); return s + (dl && dl.length > 1 ? dl.length : 0); }, 0),
      subscriptionItems: subItems.map((item) => ({
        zohoItemId:    item.zohoItemId,
        zohoItemName:  item.itemName,
        quantity:      Number(item.quantity),
        price:         Number(item.unitPrice),
        costPrice:     item.costPrice != null ? Number(item.costPrice) : 0,
        billingCycle:  item.billingCycle,
        primaryDomain: item.primaryDomain ?? domainName,
        serviceStartDate: convStartIso,
        serviceEndDate:   addCycle(convStartDate, String(item.billingCycle ?? 'annual')).toISOString().split('T')[0],
      })),
    };
  }

  // ------------------------------------------------------------------
  // Phase 2: Create Zoho Invoice after subscriptions are confirmed
  // ------------------------------------------------------------------

  /**
   * Create the Zoho Tax Invoice for a quote after the user has confirmed
   * subscription details (domain name, billing cycle, start/end dates per item).
   * Called by POST /api/conversions/quote/:id/create-invoice from the
   * Create Subscription page — both after "Create Subscriptions" and after "Skip".
   *
   * dto.items is aligned with the quote's subscription items in form order.
   * Skip case: frontend passes rows with empty domainName and today's dates.
   */
  async createInvoiceForQuote(quoteId: string, dto: CreateInvoiceDto) {
    const quote = await this.prisma.quickQuote.findUnique({
      where: { id: quoteId },
      include: { items: true, lead: true },
    });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);

    const zohoCustomerId = quote.zohoCustomerId ?? quote.lead?.convertedToZohoCustomerId ?? null;
    if (!zohoCustomerId) {
      throw new BadRequestException('Customer Zoho ID missing — conversion pehle complete karo');
    }
    if (quote.zohoEstimateId) {
      throw new BadRequestException(`Invoice already exists: ${quote.zohoEstimateNumber ?? quote.zohoEstimateId}`);
    }

    const orgId = quote.targetOrganizationId;
    const zohoClient = await this.zoho.clientFor(orgId);
    const today = new Date();
    const todayIso = today.toISOString().split('T')[0];

    // Build per-item conv array aligned with quote.items.
    // dto.items[i] corresponds to the i-th subscription item in the quote.
    const subItems = quote.items.filter((it) => it.isSubscription);
    const convs: { domainName: string; startIso: string; endIso: string; costPrice?: number }[] = quote.items.map((item) => {
      const subIdx = subItems.indexOf(item);
      const dtoItem = subIdx >= 0 ? (dto.items[subIdx] ?? dto.items[0]) : (dto.items[0]);
      const startIso = dtoItem?.startDate ?? todayIso;
      const cycle = dtoItem?.billingCycle ?? String(item.billingCycle ?? 'annual');
      return {
        domainName: dtoItem?.domainName ?? item.primaryDomain ?? '',
        startIso,
        endIso: dtoItem?.endDate ?? addCycle(new Date(startIso), cycle).toISOString().split('T')[0],
        // DTO costPrice (form-confirmed) overrides DB value
        costPrice: dtoItem?.costPrice ?? (item.costPrice != null ? Number(item.costPrice) : undefined),
      };
    });

    // Primary subscription item drives invoice-level custom fields.
    const primary = quote.items.find((i) => i.isSubscription) ?? quote.items[0];
    const primaryIdx = quote.items.indexOf(primary!);
    const primaryConv = convs[primaryIdx] ?? convs[0];
    const primarySubIdx = subItems.findIndex((i) => i === primary);
    const billingEnum = dto.items[primarySubIdx >= 0 ? primarySubIdx : 0]?.billingCycle
      ?? String(primary?.billingCycle ?? 'annual');

    const { options: billingOpts } = await this.zoho.getBillingOptions(orgId);
    // Prefer the Zoho-stored label (matches the dropdown option exactly);
    // fall back to our own label table so the field is never left blank just
    // because the billing-options sync hasn't been run yet.
    const subsPeriodLabel = billingOpts.find((o) => o.value === billingEnum)?.label
      ?? CONV_CYCLE_LABELS[billingEnum]
      ?? '';
    const businessTypeLabel = await this.zoho.getBusinessTypeLabel(orgId, 'Fresh');

    const primaryDomains = primary ? getDomainList(primary) : null;
    const invoiceCf = await this.zoho.buildCustomFields(orgId, 'invoices', {
      domain_name:    primaryDomains ? domainSummary(primaryDomains) : (primaryConv.domainName || ''),
      business_type:  businessTypeLabel,
      billing_period: subsPeriodLabel,
      service_expiry: primaryConv.endIso,
      start_date:     primaryConv.startIso,
      end_date:       primaryConv.endIso,
      quantity:       primary ? String(Number(primary.quantity)) : '',
      unit_price:     primary ? String(Number(primary.unitPrice)) : '',
    });

    const invoicePayload = {
      customer_id:   zohoCustomerId,
      line_items:    await this.buildInvoiceLineItems(orgId, quote.items, convs),
      custom_fields: invoiceCf,
      notes:         quote.notesToCustomer ?? '',
      terms:         quote.termsAndConditions ?? '',
    };

    let zohoInvoiceId: string;
    let zohoInvoiceNumber: string | null;
    try {
      const invoiceResp = await zohoClient.post<{ invoice: { invoice_id: string; invoice_number: string } }>(
        '/invoices', invoicePayload,
      );
      zohoInvoiceId     = invoiceResp.invoice?.invoice_id;
      zohoInvoiceNumber = invoiceResp.invoice?.invoice_number ?? null;
      if (!zohoInvoiceId) throw new Error('Zoho did not return invoice_id');
    } catch (err) {
      const zohoBody = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data;
      const raw = zohoBody?.message ?? (err instanceof Error ? err.message : String(err));
      const msg = /mandatory|required|cf_|custom field/i.test(raw)
        ? `Zoho ne field reject kiya — Settings → Custom Field Mapping me mandatory fields map karke dobara try karo. (Zoho: ${raw})`
        : `Zoho invoice create nahi hui: ${raw}`;
      this.logger.error(`createInvoiceForQuote failed for quote ${quote.quoteNumber ?? quoteId}: ${raw}`);
      throw new BadRequestException(msg);
    }

    this.logger.log(`✓ Invoice created for quote ${quote.quoteNumber ?? quoteId}: ${zohoInvoiceNumber}`);

    // Annexure PDFs for bulk-domain lines (≥100 domains).
    await this.finalizeBulkInvoiceExtras(
      orgId,
      { id: quoteId, quoteNumber: quote.quoteNumber ?? quoteId, items: quote.items },
      zohoInvoiceId,
      zohoInvoiceNumber,
    );

    // Per-item service date update using confirmed subscription dates.
    if (quote.items.length > 0) {
      await this.prisma.$transaction(
        quote.items.map((item, idx) => {
          const c = convs[idx] ?? convs[0];
          return this.prisma.quickQuoteItem.update({
            where: { id: item.id },
            data: { serviceStartDate: new Date(c.startIso), serviceEndDate: new Date(c.endIso) },
          });
        }),
      );
    }

    // Mark quote as Pushed_To_Zoho now that the invoice exists.
    await this.prisma.quickQuote.update({
      where: { id: quoteId },
      data: {
        status:             'Pushed_To_Zoho',
        zohoEstimateId:     zohoInvoiceId,
        zohoEstimateNumber: zohoInvoiceNumber,
        pushedToZohoAt:     new Date(),
      },
    });

    // Backfill leadConversion audit row (may have been created without invoice data in Phase 1).
    await this.prisma.leadConversion.updateMany({
      where: { quickQuoteId: quoteId, zohoEstimateId: null },
      data:  { zohoEstimateId: zohoInvoiceId, zohoEstimateNumber: zohoInvoiceNumber ?? undefined },
    });

    // Backfill linked subscription + its Fresh renewal_history row.
    // The subscription is created before the invoice exists, so its lastInvoiceId is null.
    // The Fresh renewalHistory row likewise has invoiceId: null and renewalStatus: 'Quoted'.
    const linkedSubs = await this.prisma.subscription.findMany({
      where: { originQuickQuoteId: quoteId },
      select: { id: true },
    });
    if (linkedSubs.length) {
      const subIds = linkedSubs.map((s) => s.id);
      await this.prisma.subscription.updateMany({
        where: { id: { in: subIds }, lastInvoiceId: null },
        data: {
          lastInvoiceId:     zohoInvoiceId,
          lastInvoiceNumber: zohoInvoiceNumber ?? undefined,
          lastInvoiceDate:   new Date(),
        },
      });
      await this.prisma.renewalHistory.updateMany({
        where: { subscriptionId: { in: subIds }, businessType: 'Fresh', invoiceId: null },
        data: {
          invoiceId:     zohoInvoiceId,
          invoiceNumber: zohoInvoiceNumber ?? undefined,
          invoiceDate:   new Date(),
          renewalStatus: 'Invoiced',
        },
      });
    }

    return { zohoInvoiceId, zohoInvoiceNumber };
  }

  // ------------------------------------------------------------------
  // Post-conversion: the Zoho Invoice + next-step info for a Pushed_To_Zoho quote
  // ------------------------------------------------------------------

  /** Load a converted quote (+lead) or throw. */
  private async findConvertedQuote(quoteId: string) {
    const quote = await this.prisma.quickQuote.findUnique({
      where: { id: quoteId },
      include: { items: true, lead: true, targetOrganization: { select: { zohoOrgId: true } } },
    });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.status !== 'Pushed_To_Zoho' || !quote.zohoEstimateId) {
      throw new BadRequestException('Yeh quote abhi Zoho me convert nahi hui (koi invoice nahi)');
    }
    return quote;
  }

  /**
   * Everything the converted-quote "Invoice mode" panel needs in one call:
   * the Zoho invoice (id/number/status), a "View in Zoho" URL, the subscription
   * prefill, and whether a subscription already exists for this quote.
   */
  async getPostConvertInfo(quoteId: string) {
    const quote = await this.findConvertedQuote(quoteId);
    const orgId = quote.targetOrganizationId;
    const customerId = quote.zohoCustomerId ?? quote.lead?.convertedToZohoCustomerId ?? '';
    const customerName = quote.zohoCustomerName ?? quote.lead?.companyName ?? '';

    const [domain, existingSub] = await Promise.all([
      customerId
        ? this.prisma.domain.findFirst({ where: { organizationId: orgId, zohoCustomerId: customerId }, select: { id: true, domainName: true } })
        : Promise.resolve(null),
      this.prisma.subscription.findFirst({ where: { originQuickQuoteId: quoteId }, select: { id: true } }),
    ]);

    const zohoOrgId = quote.targetOrganization?.zohoOrgId ?? '';
    return {
      invoice: {
        id: quote.zohoEstimateId,
        number: quote.zohoEstimateNumber,
        status: quote.zohoInvoiceStatus ?? 'draft',
      },
      zohoInvoiceUrl: zohoOrgId ? `https://books.zoho.in/app/${zohoOrgId}#/invoices/${quote.zohoEstimateId}` : null,
      existingSubscriptionId: existingSub?.id ?? null,
      // Convert-time choice; null (pre-feature quotes) behaves like 'later' (button shows)
      subscriptionDecision: quote.subscriptionDecision ?? 'later',
      // >1 → the post-convert button becomes "Create N Subscriptions" (bulk endpoint)
      bulkDomainCount: quote.items.filter((i) => i.isSubscription)
        .reduce((s, i) => { const dl = getDomainList(i); return s + (dl && dl.length > 1 ? dl.length : 0); }, 0),
      prefill: {
        organizationId: orgId,
        zohoCustomerId: customerId,
        zohoCustomerName: customerName,
        domainId: domain?.id ?? '',
        zohoInvoiceId: quote.zohoEstimateId,
        zohoInvoiceNumber: quote.zohoEstimateNumber,
        leadId: quote.leadId ?? '',
        quickQuoteId: quote.id,
        subscriptionItems: quote.items.filter((i) => i.isSubscription).map((item) => ({
          zohoItemId: item.zohoItemId,
          zohoItemName: item.itemName,
          quantity: Number(item.quantity),
          price: Number(item.unitPrice),
          costPrice: item.costPrice != null ? Number(item.costPrice) : 0,
          billingCycle: item.billingCycle,
          primaryDomain: item.primaryDomain ?? domain?.domainName ?? null,
          serviceStartDate: item.serviceStartDate ? item.serviceStartDate.toISOString().split('T')[0] : null,
          serviceEndDate: item.serviceEndDate ? item.serviceEndDate.toISOString().split('T')[0] : null,
        })),
      },
    };
  }

  /** Change the convert-time subscription decision (e.g. undo an accidental "never"). */
  async setSubscriptionDecision(quoteId: string, decision: 'create_now' | 'later' | 'never') {
    await this.findConvertedQuote(quoteId);
    const updated = await this.prisma.quickQuote.update({
      where: { id: quoteId },
      data: { subscriptionDecision: decision },
      select: { subscriptionDecision: true },
    });
    return { ok: true, subscriptionDecision: updated.subscriptionDecision };
  }

  /**
   * Zoho's pre-filled email content for the converted invoice — drives the
   * shared SendEmailModal (same shape as subscriptions' getInvoiceEmailPreview):
   * subject/body (with template applied), template list, contact suggestions.
   */
  async getQuoteInvoiceEmailPreview(quoteId: string, templateId?: string) {
    const quote = await this.findConvertedQuote(quoteId);
    const client = await this.zoho.clientFor(quote.targetOrganizationId);

    const contactEmails: Array<{ name: string; email: string }> = [];
    try {
      const customerId = quote.zohoCustomerId || quote.lead?.convertedToZohoCustomerId;
      if (customerId) {
        const c = await client.get<{
          contact?: {
            email?: string;
            contact_name?: string;
            contact_persons?: Array<{ first_name?: string; last_name?: string; email?: string }>;
          };
        }>(`/contacts/${customerId}`);
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
      }
    } catch { /* non-fatal */ }
    // Lead email as an extra suggestion (may not be a Zoho contact person yet)
    if (quote.lead?.email && !contactEmails.find(e => e.email === quote.lead?.email)) {
      contactEmails.push({ name: quote.lead.contactName ?? quote.lead.companyName, email: quote.lead.email });
    }

    const url = templateId
      ? `/invoices/${quote.zohoEstimateId}/email?email_template_id=${templateId}`
      : `/invoices/${quote.zohoEstimateId}/email`;

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

  async emailQuoteInvoice(
    quoteId: string,
    override?: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string },
  ) {
    const quote = await this.findConvertedQuote(quoteId);
    const client = await this.zoho.clientFor(quote.targetOrganizationId);
    const body: Record<string, unknown> = {};

    // Compose-modal override (To/CC/BCC/subject/body reviewed by the user)
    if (override?.toMailIds?.length)  body.to_mail_ids  = override.toMailIds;
    if (override?.ccMailIds?.length)  body.cc_mail_ids  = override.ccMailIds;
    if (override?.bccMailIds?.length) body.bcc_mail_ids = override.bccMailIds;
    if (override?.subject)            body.subject      = override.subject;
    if (override?.body)               body.body         = override.body;

    // No override (legacy direct send) → resolve a default recipient
    if (!body.to_mail_ids) {
      try {
        const preview = await this.getQuoteInvoiceEmailPreview(quoteId);
        if (preview.toMailIds.length) body.to_mail_ids = preview.toMailIds;
      } catch (err) {
        this.logger.warn(`Failed to fetch default email details: ${err}`);
      }
      if (!body.to_mail_ids && quote.lead?.email) body.to_mail_ids = [quote.lead.email];
    }

    try {
      await client.post(`/invoices/${quote.zohoEstimateId}/email`, body);
    } catch (err) {
      const zb = (err as { response?: { data?: { message?: string } } })?.response?.data;
      throw new BadRequestException(
        `Zoho email failed: ${zb?.message ?? (err instanceof Error ? err.message : String(err))} ` +
        `(Agar aapne Zoho me email add kiya hai, to kripya check karein ki wo 'Contact Persons' ke andar added ho)`
      );
    }
    const updated = await this.prisma.quickQuote.update({
      where: { id: quoteId }, data: { zohoInvoiceStatus: 'sent' },
    });
    const sentTo = Array.isArray(body.to_mail_ids) ? (body.to_mail_ids as string[]).join(', ') : null;
    this.logger.log(`Invoice ${quote.zohoEstimateNumber} emailed via Zoho${sentTo ? ` to ${sentTo}` : ''}`);
    return { ok: true, zohoInvoiceStatus: updated.zohoInvoiceStatus, sentTo };
  }

  /** Pull the live Zoho invoice status into the app. */
  async refreshQuoteInvoiceStatus(quoteId: string) {
    const quote = await this.findConvertedQuote(quoteId);
    const client = await this.zoho.clientFor(quote.targetOrganizationId);
    const resp = await client.get<{ invoice?: { status?: string } }>(`/invoices/${quote.zohoEstimateId}`);
    const status = resp.invoice?.status ?? null;
    const updated = await this.prisma.quickQuote.update({
      where: { id: quoteId }, data: { zohoInvoiceStatus: status },
    });

    // Backfill linked subscriptions whose lastInvoiceId wasn't set at create time.
    if (quote.zohoEstimateId) {
      const linkedSubs = await this.prisma.subscription.findMany({
        where: { originQuickQuoteId: quoteId },
        select: { id: true },
      });
      if (linkedSubs.length) {
        const subIds = linkedSubs.map((s) => s.id);
        await this.prisma.subscription.updateMany({
          where: { id: { in: subIds }, lastInvoiceId: null },
          data: {
            lastInvoiceId:     quote.zohoEstimateId,
            lastInvoiceNumber: quote.zohoEstimateNumber ?? undefined,
            lastInvoiceDate:   new Date(),
          },
        });
        await this.prisma.renewalHistory.updateMany({
          where: { subscriptionId: { in: subIds }, businessType: 'Fresh', invoiceId: null },
          data: {
            invoiceId:     quote.zohoEstimateId,
            invoiceNumber: quote.zohoEstimateNumber ?? undefined,
            invoiceDate:   new Date(),
            renewalStatus: 'Invoiced',
          },
        });
      }
    }

    if (status === 'paid' && quote.zohoEstimateId) {
      // Find matching renewal history rows that are not yet marked Paid in local DB
      const historyRows = await this.prisma.renewalHistory.findMany({
        where: { invoiceId: quote.zohoEstimateId, renewalStatus: 'Invoiced' },
      });

      if (historyRows.length > 0) {
        // Mark all matching rows paid in one query
        await this.prisma.renewalHistory.updateMany({
          where: { invoiceId: quote.zohoEstimateId, renewalStatus: 'Invoiced' },
          data: { paymentDate: new Date(), renewalStatus: 'Paid' },
        });

        // Update each subscription's dates / quantity
        for (const historyRow of historyRows) {
          const sub = await this.prisma.subscription.findUnique({
            where: { id: historyRow.subscriptionId },
          });
          if (!sub) continue;

          const updateData: Record<string, unknown> = {
            processStatus: 'None',
            lastInvoiceId: quote.zohoEstimateId,
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
            // Dates UNCHANGED — only quantity increases
            updateData.quantity = Number(sub.quantity) + Number(historyRow.quantity);
          }

          await this.prisma.subscription.update({
            where: { id: historyRow.subscriptionId },
            data: updateData,
          });

          this.logger.log(`Refreshed quote invoice paid -> sub ${sub.subscriptionNumber} updated (${historyRow.businessType})`);
        }
      }
    }

    return { ok: true, zohoInvoiceStatus: updated.zohoInvoiceStatus };
  }

  // ------------------------------------------------------------------
  // Get conversion history for a lead
  // ------------------------------------------------------------------
  async getConversionsForLead(leadId: string) {
    return this.prisma.leadConversion.findMany({
      where: { leadId },
      orderBy: { convertedAt: 'desc' },
      include: { organization: { select: { id: true, name: true } } },
    });
  }
}
