import {
  BadRequestException, Injectable, Logger,
  NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { BillingCycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import type { AppConfig } from '../config/configuration';
import type { CreateQuickQuoteDto, UpdateQuickQuoteDto, SendQuoteDto, AcceptQuoteDto, RejectQuoteDto } from './dto/quick-quotes.dto';

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹', USD: '$', AED: 'AED ', EUR: '€', GBP: '£',
};

const CYCLE_LABELS: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half Yearly',
  annual: 'Yearly', biennial: 'Biennial', triennial: 'Triennial', one_time: 'One Time',
};

/**
 * Formats the "Subscription Validity" meta line for quotes/PDFs/emails.
 *   Named cycle (not one_time) → "Monthly (28/07/2026 to 27/08/2026)"
 *   one_time / no cycle + dates → "30 days (28/07/2026 to 27/08/2026)"
 */
function formatValidityLabel(
  cycle: string | null | undefined,
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
  fmtDate: (d: Date) => string,
): string {
  const dateRange = startDate && endDate ? `(${fmtDate(startDate)} to ${fmtDate(endDate)})` : '';
  if (cycle && cycle !== 'one_time') {
    const label = CYCLE_LABELS[cycle] ?? cycle;
    return dateRange ? `${label} ${dateRange}` : label;
  }
  if (startDate && endDate) {
    const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
    return `${days} days${dateRange ? ` ${dateRange}` : ''}`;
  }
  return cycle ? (CYCLE_LABELS[cycle] ?? cycle) : '';
}

@Injectable()
export class QuickQuotesService {
  private readonly logger = new Logger(QuickQuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly auditLogs: AuditLogsService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------
  // List
  // ------------------------------------------------------------------
  async list(params: { status?: string; search?: string; customer_type?: string; page?: number; limit?: number }) {
    const { status, search, customer_type, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (customer_type) where.customerType = customer_type;
    if (search) {
      where.OR = [
        { quoteNumber: { contains: search, mode: 'insensitive' } },
        { zohoCustomerName: { contains: search, mode: 'insensitive' } },
        { lead: { companyName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [quotes, total] = await Promise.all([
      this.prisma.quickQuote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          lead: { select: { id: true, companyName: true, email: true } },
          targetOrganization: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.quickQuote.count({ where }),
    ]);

    return { quotes, total, page, limit };
  }

  // ------------------------------------------------------------------
  // Find one
  // ------------------------------------------------------------------
  async findOne(id: string) {
    const quote = await this.prisma.quickQuote.findUnique({
      where: { id },
      include: {
        items: { orderBy: { lineOrder: 'asc' } },
        lead: true,
        targetOrganization: { select: { id: true, name: true, zohoOrgId: true, dataCenter: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        revisionOf: { select: { id: true, quoteNumber: true } },
        revisions: { select: { id: true, quoteNumber: true, status: true, createdAt: true } },
      },
    });
    if (!quote) throw new NotFoundException(`Quote ${id} not found`);
    return quote;
  }

  // ------------------------------------------------------------------
  // Find by public token (unauthenticated)
  // ------------------------------------------------------------------
  async findByToken(token: string) {
    const quote = await this.prisma.quickQuote.findUnique({
      where: { publicToken: token },
      include: {
        items: { orderBy: { lineOrder: 'asc' } },
        lead: { select: { companyName: true, contactName: true, email: true, gstin: true } },
        targetOrganization: { select: { name: true } },
      },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.publicTokenExpiresAt && quote.publicTokenExpiresAt < new Date()) {
      throw new UnauthorizedException('Quote link has expired');
    }

    // Track view
    await this.prisma.quickQuote.update({
      where: { id: quote.id },
      data: {
        viewCount: { increment: 1 },
        viewedAt: quote.viewedAt ?? new Date(),
        status: quote.status === 'Sent' ? 'Viewed' : quote.status,
      },
    });

    return quote;
  }

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------
  async create(dto: CreateQuickQuoteDto, user: AuthUser) {
    const userId = user.id;
    this.validateCustomerFields(dto);

    const validityDays = dto.validity_days ?? 15;
    // Expiry: user-provided date > calculated from validity_days
    let expiryDate: Date;
    if (dto.expiry_date) {
      expiryDate = new Date(dto.expiry_date);
    } else {
      expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + validityDays);
    }
    const quoteDate = dto.quote_date ? new Date(dto.quote_date) : new Date();

    let quoteNumber = dto.quote_number;
    if (!quoteNumber) {
      quoteNumber = await this.settings.generateNumber(
        dto.target_organization_id,
        'quote',
        quoteDate,
      );
    }

    // Compute line totals
    const { items: itemDtos, subtotal, discountAmount, taxAmount, totalAmount } = this.computeTotals(dto);

    const baseData = {
      customerType: dto.customer_type,
      leadId: dto.lead_id,
      zohoCustomerId: dto.zoho_customer_id,
      zohoCustomerName: dto.zoho_customer_name,
      targetOrganizationId: dto.target_organization_id,
      validityDays,
      quoteDate,
      expiryDate,
      subtotal,
      discountAmount,
      taxAmount,
      totalAmount,
      isIntraState: dto.is_intra_state,
      cgstRate: dto.cgst_rate,
      sgstRate: dto.sgst_rate,
      igstRate: dto.igst_rate,
      termsAndConditions: dto.terms_and_conditions,
      notesToCustomer: dto.notes_to_customer,
      internalNotes: dto.internal_notes,
      createdByUserId: userId,
      ...(dto.quote_reference && { metadata: { reference: dto.quote_reference } }),
      quoteNumber,
      items: { create: itemDtos },
    };

    const quote = await this.prisma.quickQuote.create({
      data: baseData,
      include: { items: { orderBy: { lineOrder: 'asc' } } },
    });

    // A quote now exists for this lead → move it to "Quoted" (guarded so we never
    // downgrade a lead that's already further along: Negotiating/Won/Lost/Archived).
    if (quote.leadId) {
      await this.prisma.lead.updateMany({
        where: { id: quote.leadId, status: { in: ['New', 'Contacted'] } },
        data: { status: 'Quoted' },
      });
    }

    await this.auditLogs.logAction({
      entityType: 'quote',
      entityId: quote.id,
      action: 'create',
      changeSummary: `Quote ${quote.quoteNumber} created for customer type ${quote.customerType}`,
      newValue: quote,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    this.logger.log(`Created quote ${quote.quoteNumber} (${dto.customer_type})`);
    return quote;
  }

  // ------------------------------------------------------------------
  // Update (Draft only)
  // ------------------------------------------------------------------
  async update(id: string, dto: UpdateQuickQuoteDto, user: AuthUser) {
    const existing = await this.findOne(id);
    if (existing.status !== 'Draft') {
      throw new BadRequestException(`Only Draft quotes can be edited (current: ${existing.status})`);
    }

    const validityDays = dto.validity_days ?? existing.validityDays;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + validityDays);

    // If items provided, replace all
    if (dto.items) {
      await this.prisma.quickQuoteItem.deleteMany({ where: { quickQuoteId: id } });
    }

    const { items: itemDtos, subtotal, discountAmount, taxAmount, totalAmount } = dto.items
      ? this.computeTotals(dto as CreateQuickQuoteDto)
      : { items: [], subtotal: existing.subtotal, discountAmount: existing.discountAmount, taxAmount: existing.taxAmount, totalAmount: existing.totalAmount };

    const quote = await this.prisma.quickQuote.update({
      where: { id },
      data: {
        validityDays,
        expiryDate,
        subtotal,
        discountAmount,
        taxAmount,
        totalAmount,
        ...(dto.is_intra_state !== undefined && { isIntraState: dto.is_intra_state }),
        ...(dto.cgst_rate !== undefined && { cgstRate: dto.cgst_rate }),
        ...(dto.sgst_rate !== undefined && { sgstRate: dto.sgst_rate }),
        ...(dto.igst_rate !== undefined && { igstRate: dto.igst_rate }),
        ...(dto.terms_and_conditions !== undefined && { termsAndConditions: dto.terms_and_conditions }),
        ...(dto.notes_to_customer !== undefined && { notesToCustomer: dto.notes_to_customer }),
        ...(dto.internal_notes !== undefined && { internalNotes: dto.internal_notes }),
      },
    });

    if (dto.items && itemDtos.length > 0) {
      await this.prisma.quickQuoteItem.createMany({
        data: itemDtos.map((item) => ({ ...item, quickQuoteId: id })),
      });
    }

    const updated = await this.findOne(id);

    await this.auditLogs.logAction({
      entityType: 'quote',
      entityId: id,
      action: 'update',
      changeSummary: `Quote ${existing.quoteNumber} updated`,
      newValue: updated,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    return updated;
  }

  // ------------------------------------------------------------------
  // Send (generates public token for Mode B leads)
  // ------------------------------------------------------------------
  async send(id: string, dto: SendQuoteDto, user: AuthUser) {
    const quote = await this.findOne(id);
    // 'Sent' is allowed for resend (now that send actually emails the quote).
    if (!['Draft', 'Sent', 'Viewed'].includes(quote.status)) {
      throw new BadRequestException(`Cannot send quote in status: ${quote.status}`);
    }

    // Reuse the existing public token on resend so links already shared stay
    // valid; only the expiry window is refreshed. First send generates one.
    const publicToken = quote.publicToken ?? randomBytes(48).toString('hex');
    const tokenExpiry = new Date();
    tokenExpiry.setDate(tokenExpiry.getDate() + quote.validityDays);

    const updated = await this.prisma.quickQuote.update({
      where: { id },
      data: {
        status: 'Sent',
        sentAt: new Date(),
        publicToken,
        publicTokenExpiresAt: tokenExpiry,
      },
    });

    // Email the quote (quote_sent template) only when a recipient was explicitly given —
    // the UI prefills the lead's email; omitting it means "generate link only".
    // The token is persisted before mailing so the link in the email is always live;
    // an email failure is reported back (emailError) instead of failing the whole send.
    const recipient = dto.recipient_email?.trim() || null;
    let emailSent = false;
    let emailError: string | null = null;

    if (recipient) {
      // Generate the quote PDF to attach — best-effort: a PDF failure must not
      // block the email (the quote sheet is also inline in the HTML body).
      let attachments: Array<{ filename: string; content: string; type?: string }> | undefined;
      try {
        const pdf = await this.buildQuotePdf(quote, tokenExpiry);
        attachments = [{ filename: `${quote.quoteNumber}.pdf`, content: pdf.toString('base64'), type: 'application/pdf' }];
      } catch (err) {
        this.logger.warn(`Quote ${quote.quoteNumber} PDF attachment skipped: ${err instanceof Error ? err.message : String(err)}`);
      }

      try {
        await this.email.send({
          to: recipient,
          subject: `Your quote ${quote.quoteNumber} from ${quote.targetOrganization?.name ?? 'Excel Technologies'}`,
          html: this.buildQuoteEmailHtml(quote, tokenExpiry),
          organizationId: quote.targetOrganizationId,
          attachments,
        });
        emailSent = true;
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
        this.logger.error(`Quote ${quote.quoteNumber} email to ${recipient} failed: ${emailError}`);
      }
    }

    await this.auditLogs.logAction({
      entityType: 'quote',
      entityId: id,
      action: 'update',
      changeSummary: `Quote ${quote.quoteNumber} sent to ${recipient || 'recipient'}`,
      newValue: updated,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    this.logger.log(
      `Quote ${quote.quoteNumber} sent — token generated${emailSent ? `, emailed to ${recipient}` : ''}`,
    );
    return {
      quote: updated,
      public_url: `/quotes/public/${publicToken}`,
      token: publicToken,
      emailSent,
      emailTo: emailSent ? recipient : null,
      emailError,
    };
  }

  /**
   * Email-client-safe (inline CSS, table-layout) rendering of the quote as a
   * PDF-like page: greeting on the grey backdrop, a white A4-style sheet
   * (org header · BILL TO · items · totals · terms — mirrors the print page),
   * then the sign-off below the sheet. No links/buttons in the mail — the
   * quote is accepted manually in the app (user decision, 2026-07-15).
   */
  private buildQuoteEmailHtml(
    quote: Awaited<ReturnType<QuickQuotesService['findOne']>>,
    tokenExpiry: Date,
  ): string {
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // Zero-width spaces after dots / around @ so Gmail/Outlook don't auto-link
    // domains and email addresses in the mail (user wants plain text only).
    const noAutoLink = (s: string) => esc(s).replace(/\./g, '.​').replace(/@/g, '​@​');
    const symbol = CURRENCY_SYMBOLS[quote.currency] ?? `${quote.currency} `;
    const money = (v: unknown) =>
      `${symbol}${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const fmtDate = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    const orgName = quote.targetOrganization?.name ?? 'Excel Technologies';
    const greetName =
      quote.lead?.contactName || quote.lead?.companyName || quote.zohoCustomerName || 'Customer';
    const billToName = quote.lead?.companyName || quote.zohoCustomerName || 'Customer';
    const billToLocation = [quote.lead?.city, quote.lead?.state].filter(Boolean).join(', ');

    // Items table: # | Item | Qty | Rate | Amount (no tax/discount columns — per user)
    const cellR = 'padding:10px 8px;font-size:13px;color:#475569;text-align:right;border-bottom:1px solid #f1f5f9;vertical-align:top';
    const itemRows = quote.items.map((item, i) => {
      // Bulk-domains line → compact "Domains (N): a, b, c +N-3 more"
      const domainList = (item.domainList as Array<{ domain: string; qty?: number }> | null) ?? null;
      const domainLine = domainList && domainList.length > 1
        ? `<div style="font-size:11px;color:#64748b;margin-top:4px">Domains (${domainList.length}): <span style="color:#1e293b">${
            noAutoLink(domainList.slice(0, 3).map((d) => d.domain).join(', '))
          }${domainList.length > 3 ? ` +${domainList.length - 3} more (see annexure/details)` : ''}</span></div>`
        : item.primaryDomain
          ? `<div style="font-size:11px;color:#64748b;margin-top:4px">Domain Name: <span style="color:#1e293b">${noAutoLink(item.primaryDomain)}</span></div>`
          : '';
      return `
      <tr>
        <td style="padding:10px 8px 10px 0;font-size:12px;color:#94a3b8;border-bottom:1px solid #f1f5f9;vertical-align:top">${i + 1}</td>
        <td style="padding:10px 8px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;vertical-align:top">
          <strong>${esc(item.itemName)}</strong>
          ${item.itemDescription
            ? `<div style="font-size:11px;color:#64748b;white-space:pre-wrap;margin-top:3px">${noAutoLink(item.itemDescription)}</div>`
            : ''}
          ${domainLine}
          ${item.isSubscription && (item.billingCycle || (item.serviceStartDate && item.serviceEndDate))
            ? `<div style="font-size:11px;color:#64748b;margin-top:1px">Subscription Validity: <span style="color:#1e293b">${esc(formatValidityLabel(item.billingCycle, item.serviceStartDate, item.serviceEndDate, fmtDate))}</span></div>`
            : ''}
        </td>
        <td style="${cellR}">${Number(item.quantity)}</td>
        <td style="${cellR}">${money(item.unitPrice)}</td>
        <td style="${cellR};color:#1e293b;font-weight:bold">${money(item.lineTotal)}</td>
      </tr>`;
    }).join('');

    const totalRow = (label: string, value: string, bold = false) => `
      <tr>
        <td style="padding:3px 8px;font-size:${bold ? '15px' : '13px'};color:${bold ? '#1e293b' : '#64748b'};${bold ? 'font-weight:bold;border-top:2px solid #e2e8f0;padding-top:8px' : ''}">${label}</td>
        <td style="padding:3px 8px;font-size:${bold ? '15px' : '13px'};color:${bold ? '#1e293b' : '#64748b'};text-align:right;${bold ? 'font-weight:bold;border-top:2px solid #e2e8f0;padding-top:8px' : ''}">${value}</td>
      </tr>`;

    const th = 'padding:8px;font-size:11px;color:#64748b;font-weight:bold;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;text-align:right';
    const label = 'font-size:10px;color:#94a3b8;font-weight:bold;text-transform:uppercase;letter-spacing:1px';

    return `
<div style="background:#eef2f7;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto">

    <!-- Greeting (on the grey backdrop, above the sheet) -->
    <tr><td style="padding:0 6px 18px">
      <p style="margin:0 0 8px;font-size:14px;color:#334155">Dear ${esc(greetName)},</p>
      <p style="margin:0;font-size:13px;color:#64748b">
        Thank you for your interest. Please review your quotation below — valid until
        <strong style="color:#334155">${fmtDate(tokenExpiry)}</strong>.
      </p>
    </td></tr>

    <!-- White PDF-like sheet -->
    <tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:4px;padding:36px 40px">

      <!-- Sheet header -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #e2e8f0;padding-bottom:16px"><tr>
        <td style="padding-bottom:16px">
          <div style="font-size:20px;font-weight:bold;color:#0f172a">${esc(orgName)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Quotation</div>
        </td>
        <td style="text-align:right;padding-bottom:16px;vertical-align:top">
          <div style="font-family:monospace;font-size:14px;font-weight:bold;color:#1e293b">${esc(quote.quoteNumber)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Date: ${fmtDate(new Date(quote.quoteDate))}</div>
          <div style="font-size:12px;color:#64748b">Valid till: ${fmtDate(tokenExpiry)}</div>
        </td>
      </tr></table>

      <!-- Bill To -->
      <div style="padding:18px 0">
        <div style="${label};margin-bottom:5px">Bill To</div>
        <div style="font-size:14px;font-weight:bold;color:#1e293b">${esc(billToName)}</div>
        ${quote.lead?.contactName ? `<div style="font-size:13px;color:#475569">${esc(quote.lead.contactName)}</div>` : ''}
        ${quote.lead?.email ? `<div style="font-size:13px;color:#475569">${noAutoLink(quote.lead.email)}</div>` : ''}
        ${billToLocation ? `<div style="font-size:13px;color:#475569">${esc(billToLocation)}</div>` : ''}
        ${quote.lead?.gstin ? `<div style="font-size:11px;font-family:monospace;color:#64748b;margin-top:2px">GSTIN: ${esc(quote.lead.gstin)}</div>` : ''}
      </div>

      <!-- Items -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <th style="${th};text-align:left;width:22px">#</th>
          <th style="${th};text-align:left">Item</th>
          <th style="${th};width:48px">Qty</th>
          <th style="${th};width:90px">Rate</th>
          <th style="${th};width:100px">Amount</th>
        </tr>
        ${itemRows}
      </table>

      <!-- Totals -->
      <table role="presentation" cellpadding="0" cellspacing="0" align="right" style="margin-top:14px;width:250px">
        ${totalRow('Subtotal', money(quote.subtotal))}
        ${Number(quote.discountAmount) > 0 ? totalRow('Discount', `-${money(quote.discountAmount)}`) : ''}
        ${totalRow('Tax', money(quote.taxAmount))}
        ${totalRow('Total', money(quote.totalAmount), true)}
      </table>
      <div style="clear:both"></div>

      ${quote.notesToCustomer ? `
      <div style="margin-top:26px">
        <div style="${label};margin-bottom:5px">Notes</div>
        <div style="font-size:12px;color:#64748b;white-space:pre-wrap">${esc(quote.notesToCustomer)}</div>
      </div>` : ''}

      ${quote.termsAndConditions ? `
      <div style="margin-top:22px">
        <div style="${label};margin-bottom:5px">Terms &amp; Conditions</div>
        <div style="font-size:12px;color:#64748b;white-space:pre-wrap">${esc(quote.termsAndConditions)}</div>
      </div>` : ''}

    </td></tr>

    <!-- Sign-off below the white area -->
    <tr><td style="padding:20px 6px 4px">
      <p style="margin:0;font-size:13px;color:#475569">
        Regards,<br>
        <strong>${esc(quote.createdBy?.name ?? orgName)}</strong><br>
        ${esc(orgName)}
      </p>
    </td></tr>

  </table>
</div>`;
  }

  /**
   * Render the quote as a PDF (pdf-lib) for the SendGrid email attachment.
   * A quick quote is app-native (no Zoho estimate at send time), so there is no
   * Zoho PDF to fetch — we draw the same content as the print page / email sheet.
   *
   * NOTE: uses the Helvetica standard font (WinAnsi) — non-Latin-1 characters
   * (e.g. Devanagari in notes/terms) are stripped, and money uses the ISO
   * currency code (₹/other symbols aren't WinAnsi-encodable). Good enough for a
   * transactional attachment; embed a Unicode font later if Hindi text is needed.
   */
  private async buildQuotePdf(
    quote: Awaited<ReturnType<QuickQuotesService['findOne']>>,
    tokenExpiry: Date,
  ): Promise<Buffer> {
    // Strip characters WinAnsi/Helvetica can't encode (keeps Latin-1, drops the rest).
    const sane = (s: unknown) => String(s ?? '').replace(/[^\x20-\xFF]/g, '').replace(/[\x80-\x9F]/g, '');
    const money = (v: unknown) =>
      `${quote.currency} ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    // fmtDate is reassigned below after ov.dateFormat is known
    let fmtDate = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    // PDF branding (Settings → PDF Branding) — logo/signature are base64
    // data-URLs; the address fields feed the footer.
    const branding = await this.prisma.orgSettings.findUnique({
      where: { organizationId: quote.targetOrganizationId },
      select: {
        logoUrl: true, signatureImageUrl: true, legalName: true, displayName: true,
        brandColor: true, pdfWatermark: true,
        addressLine1: true, addressLine2: true, city: true, state: true,
        postalCode: true, country: true, phone: true, email: true, website: true, gstin: true,
        bankName: true, bankAccountNumber: true, bankIfsc: true, bankAccountHolder: true,
        settingsOverrides: true,
      },
    });

    // Parse settingsOverrides — all flags default to true (opt-out model)
    const rawOv = (branding?.settingsOverrides ?? {}) as Record<string, unknown>;
    const ov = {
      logoSize:            (rawOv.logoSize as string)      ?? 'md',
      logoAlignment:       (rawOv.logoAlignment as string) ?? 'left',
      showCompanyName:     rawOv.showCompanyName     !== false,
      signatureSize:       (rawOv.signatureSize as string) ?? 'md',
      showSignatureSection:rawOv.showSignatureSection !== false,
      fontFamily:          (rawOv.fontFamily as string)    ?? 'sans',
      documentTitle:       (rawOv.documentTitle as string) || 'QUOTATION',
      dateFormat:          (rawOv.dateFormat as string)    ?? 'dd/mm/yyyy',
      showBillToGstin:     rawOv.showBillToGstin     !== false,
      showBillToEmail:     rawOv.showBillToEmail      !== false,
      showBillToLocation:  rawOv.showBillToLocation   !== false,
      showItemDescription: rawOv.showItemDescription  !== false,
      showBillingMeta:     rawOv.showBillingMeta      !== false,
      showQtyColumn:       rawOv.showQtyColumn        !== false,
      showRateColumn:      rawOv.showRateColumn       !== false,
      showSubtotalRow:     rawOv.showSubtotalRow      !== false,
      showGstRow:          rawOv.showGstRow           !== false,
      showDiscountRow:     rawOv.showDiscountRow      !== false,
      showPayToSection:    rawOv.showPayToSection     !== false,
      showTermsSection:    rawOv.showTermsSection     !== false,
      showNotesSection:    rawOv.showNotesSection     !== false,
    };

    // Apply date format from overrides
    if (ov.dateFormat === 'dd-mmm-yyyy') {
      fmtDate = (d: Date) => sane(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
    }

    // Logo/signature max heights (px)
    const LOGO_H: Record<string, number> = { sm: 30, md: 46, lg: 70 };
    const SIG_H:  Record<string, number> = { sm: 30, md: 46, lg: 65 };
    const logoMaxH = LOGO_H[ov.logoSize] ?? 46;
    const sigMaxH  = SIG_H[ov.signatureSize] ?? 46;

    const doc = await PDFDocument.create();
    const fontPair = ov.fontFamily === 'serif'
      ? [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold]
      : ov.fontFamily === 'mono'
        ? [StandardFonts.Courier, StandardFonts.CourierBold]
        : [StandardFonts.Helvetica, StandardFonts.HelveticaBold];
    const font = await doc.embedFont(fontPair[0]);
    const bold = await doc.embedFont(fontPair[1]);

    // Embed a base64 data-URL image (PNG/JPEG only — pdf-lib can't do SVG/WebP).
    const embedImage = async (dataUrl?: string | null) => {
      if (!dataUrl) return null;
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl.trim());
      if (!m) return null;
      const mime = m[1].toLowerCase();
      const bytes = Buffer.from(m[2], 'base64');
      try {
        if (mime.includes('png')) return await doc.embedPng(bytes);
        if (mime.includes('jpeg') || mime.includes('jpg')) return await doc.embedJpg(bytes);
      } catch { /* corrupt/unsupported → skip */ }
      return null; // svg / webp unsupported
    };

    const A4 = { w: 595.28, h: 841.89 };
    const M = 50;                        // margin
    const RIGHT = A4.w - M;
    const dark = rgb(0.06, 0.09, 0.16);
    const grey = rgb(0.4, 0.45, 0.5);
    const line = rgb(0.88, 0.9, 0.93);
    const tint = rgb(0.972, 0.98, 0.988);

    // Brand color (Settings → PDF Branding) + a readable on-brand text color.
    const hexM = /^#?([0-9a-f]{6})$/i.exec((branding?.brandColor ?? '').trim());
    const bn = hexM ? parseInt(hexM[1], 16) : 0x1f2937;
    const bcR = ((bn >> 16) & 255) / 255, bcG = ((bn >> 8) & 255) / 255, bcB = (bn & 255) / 255;
    const brand = rgb(bcR, bcG, bcB);
    const onBrand = (0.299 * bcR + 0.587 * bcG + 0.114 * bcB) > 0.63 ? dark : rgb(1, 1, 1);

    // Per-page decoration: brand accent bar on top + optional diagonal watermark.
    const decorate = (p: PDFPage) => {
      p.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: brand });
      const wm = branding?.pdfWatermark?.trim();
      if (wm) {
        p.drawText(sane(wm.toUpperCase()), {
          x: 120, y: 230, size: 84, font: bold, color: grey, opacity: 0.07, rotate: degrees(38),
        });
      }
    };

    let page: PDFPage = doc.addPage([A4.w, A4.h]);
    decorate(page);
    let y = A4.h - M;

    const ensure = (needed: number) => {
      if (y - needed < M) { page = doc.addPage([A4.w, A4.h]); decorate(page); y = A4.h - M; }
    };
    const text = (s: string, x: number, size: number, f: PDFFont = font, color = dark) =>
      page.drawText(sane(s), { x, y, size, font: f, color });
    const textR = (s: string, xRight: number, size: number, f: PDFFont = font, color = dark) => {
      const str = sane(s);
      page.drawText(str, { x: xRight - f.widthOfTextAtSize(str, size), y, size, font: f, color });
    };
    const hr = () => { page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 1, color: line }); };
    const textC = (s: string, size: number, f: PDFFont = font, color = dark) => {
      // pdf-lib has no letter-spacing option → fake tracking by joining with thin spaces.
      const str = sane(s);
      const w = f.widthOfTextAtSize(str, size);
      page.drawText(str, { x: (A4.w - w) / 2, y, size, font: f, color });
    };
    const wrap = (s: string, f: PDFFont, size: number, maxW: number): string[] => {
      const words = sane(s).split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(next, size) > maxW && cur) { lines.push(cur); cur = w; }
        else cur = next;
      }
      if (cur) lines.push(cur);
      return lines.length ? lines : [''];
    };

    const orgName = quote.targetOrganization?.name ?? 'Excel Technologies';

    // --- Header ---
    // Right column (quote no / date / valid) — top-aligned, absolute y so the
    // logo on the left can be any height without shifting it.
    const headerTop = y;
    const drawRightAt = (s: string, yy: number, size: number, f: PDFFont, color = dark) => {
      const str = sane(s);
      page.drawText(str, { x: RIGHT - f.widthOfTextAtSize(str, size), y: yy, size, font: f, color });
    };
    drawRightAt(quote.quoteNumber, headerTop - 2, 14, bold, brand);
    drawRightAt(`Date: ${fmtDate(new Date(quote.quoteDate))}`, headerTop - 20, 10, font, grey);
    drawRightAt(`Valid till: ${fmtDate(tokenExpiry)}`, headerTop - 34, 10, font, grey);

    // Left column: logo (if PNG/JPEG) above the org name, else just the org name.
    const logo = await embedImage(branding?.logoUrl);
    if (logo) {
      const scale = Math.min(200 / logo.width, logoMaxH / logo.height, 1);
      const lw = logo.width * scale, lh = logo.height * scale;
      page.drawImage(logo, { x: M, y: headerTop - lh, width: lw, height: lh });
      y = headerTop - lh - 14;
      if (ov.showCompanyName) { text(orgName, M, 14, bold); y -= 18; }
    } else {
      if (ov.showCompanyName) { text(orgName, M, 20, bold); y -= 22; }
    }
    // Drop below whichever column is taller.
    y = Math.min(y, headerTop - 44);

    // Centered document title — use custom title, no artificial letter spacing
    textC(sane(ov.documentTitle.toUpperCase()), 18, bold, brand);
    y -= 12;
    hr();
    y -= 22;

    // --- Bill To ---
    text('BILL TO', M, 9, bold, brand);
    y -= 15;
    text(quote.lead?.companyName || quote.zohoCustomerName || 'Customer', M, 13, bold);
    y -= 15;
    for (const l of [
      quote.lead?.contactName,
      ov.showBillToEmail    ? quote.lead?.email : null,
      ov.showBillToLocation ? [quote.lead?.city, quote.lead?.state].filter(Boolean).join(', ') : null,
      ov.showBillToGstin    ? (quote.lead?.gstin ? `GSTIN: ${quote.lead.gstin}` : '') : null,
    ].filter(Boolean) as string[]) {
      text(l, M, 11, font, grey);
      y -= 14;
    }
    y -= 12;

    // --- Items header (brand-colored band) ---
    // Build column positions right-to-left based on visible columns
    const amtR = RIGHT;
    let rateR = amtR;
    if (ov.showRateColumn) rateR = amtR - 90;
    let qtyR = rateR;
    if (ov.showQtyColumn) qtyR = rateR - 80;
    const itemMaxW = qtyR - M - (ov.showQtyColumn || ov.showRateColumn ? 60 : 20);
    ensure(34);
    page.drawRectangle({ x: M - 8, y: y - 8, width: RIGHT - M + 16, height: 26, color: brand });
    text('#', M, 10, bold, onBrand);
    text('ITEM', M + 22, 10, bold, onBrand);
    if (ov.showQtyColumn)  textR('QTY',    qtyR,  10, bold, onBrand);
    if (ov.showRateColumn) textR('RATE',   rateR, 10, bold, onBrand);
    textR('AMOUNT', amtR, 10, bold, onBrand);
    y -= 26;

    // --- Item rows ---
    quote.items.forEach((item, i) => {
      const nameLines = wrap(item.itemName, bold, 12, itemMaxW);
      const extra: string[] = [];
      const domainList = (item.domainList as Array<{ domain: string; qty?: number }> | null) ?? null;
      if (ov.showBillingMeta) {
        if (domainList && domainList.length > 1) {
          extra.push(`Domains (${domainList.length}): ${domainList.slice(0, 4).map((d) => d.domain).join(', ')}${domainList.length > 4 ? ` +${domainList.length - 4} more` : ''}`);
        } else if (item.primaryDomain) {
          extra.push(`Domain Name: ${item.primaryDomain}`);
        }
        if (item.isSubscription && (item.billingCycle || (item.serviceStartDate && item.serviceEndDate))) {
          extra.push(`Subscription Validity: ${formatValidityLabel(item.billingCycle, item.serviceStartDate, item.serviceEndDate, fmtDate)}`);
        }
      }
      if (ov.showItemDescription && item.itemDescription) extra.push(...wrap(item.itemDescription, font, 10, itemMaxW));

      const blockH = nameLines.length * 15 + extra.length * 12 + 10;
      ensure(blockH);
      // Zebra stripe on alternate rows (subtle)
      if (i % 2 === 1) {
        page.drawRectangle({ x: M - 8, y: y + 12 - blockH, width: RIGHT - M + 16, height: blockH, color: tint });
      }
      const rowTop = y;
      // number + amounts aligned to the first line
      text(String(i + 1), M, 11, font, grey);
      if (ov.showQtyColumn)  textR(String(Number(item.quantity)), qtyR,  11);
      if (ov.showRateColumn) textR(money(item.unitPrice),         rateR, 11);
      textR(money(item.lineTotal), amtR, 11, bold);
      // item name (wrapped)
      nameLines.forEach((l) => { text(l, M + 22, 12, bold); y -= 15; });
      // extra lines
      extra.forEach((l) => { text(l, M + 22, 10, font, grey); y -= 12; });
      // divider
      y -= 4;
      page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: line });
      y -= 14;
      void rowTop;
    });

    // --- Totals (tinted card, Total value in brand color) ---
    const totRows: Array<{ label: string; value: string; big?: boolean }> = [
      ...(ov.showSubtotalRow ? [{ label: 'Subtotal', value: money(quote.subtotal) }] : []),
      ...(ov.showDiscountRow && Number(quote.discountAmount) > 0 ? [{ label: 'Discount', value: `-${money(quote.discountAmount)}` }] : []),
      ...(ov.showGstRow ? [{ label: 'GST', value: money(quote.taxAmount) }] : []),
      { label: 'Total', value: money(quote.totalAmount), big: true },
    ];
    const panelX = 340;
    const panelH = totRows.reduce((h, r) => h + (r.big ? 24 : 16), 0) + 18;
    ensure(panelH + 10);
    const panelTop = y + 4;
    page.drawRectangle({ x: panelX, y: panelTop - panelH, width: RIGHT - panelX + 8, height: panelH, color: tint });
    y = panelTop - 20;
    for (const r of totRows) {
      if (r.big) {
        page.drawLine({ start: { x: panelX + 12, y: y + 10 }, end: { x: RIGHT - 4, y: y + 10 }, thickness: 1, color: line });
      }
      text(r.label, panelX + 12, r.big ? 13 : 11, r.big ? bold : font, r.big ? dark : grey);
      textR(r.value, RIGHT - 4, r.big ? 13 : 11, r.big ? bold : font, r.big ? brand : grey);
      y -= r.big ? 24 : 16;
    }
    y -= 10;

    // --- Notes / Terms ---
    const block = (title: string, body: string) => {
      const lines = body.split(/\r?\n/).flatMap((ln) => wrap(ln, font, 10, RIGHT - M));
      ensure(20 + lines.length * 12);
      text(title, M, 9, bold, grey);
      y -= 14;
      lines.forEach((l) => { text(l, M, 10, font, grey); y -= 12; });
      y -= 10;
    };
    if (ov.showNotesSection && quote.notesToCustomer) block('NOTES', quote.notesToCustomer);
    if (ov.showTermsSection && quote.termsAndConditions) block('TERMS & CONDITIONS', quote.termsAndConditions);

    // --- Pay To (bank details, left) · signature + Authorised Signatory (right) ---
    const sig = ov.showSignatureSection ? await embedImage(branding?.signatureImageUrl) : null;
    const bankLines = ov.showPayToSection ? [
      branding?.bankAccountHolder,
      branding?.bankName,
      branding?.bankAccountNumber ? `A/C: ${branding.bankAccountNumber}` : '',
      branding?.bankIfsc ? `IFSC: ${branding.bankIfsc}` : '',
    ].filter(Boolean) as string[] : [];
    if (bankLines.length || sig) {
      ensure(110);
      y -= 14;
      const blockTop = y;
      let leftY = blockTop;
      if (bankLines.length) {
        page.drawText('PAY TO', { x: M, y: leftY, size: 9, font: bold, color: brand });
        leftY -= 14;
        bankLines.forEach((l, i) => {
          page.drawText(sane(l), { x: M, y: leftY, size: 10, font: i === 0 ? bold : font, color: i === 0 ? dark : grey });
          leftY -= 13;
        });
      }
      let rightY = blockTop;
      if (sig) {
        const scale = Math.min(150 / sig.width, sigMaxH / sig.height, 1);
        const sw = sig.width * scale, sh = sig.height * scale;
        page.drawImage(sig, { x: RIGHT - sw, y: rightY - sh + 8, width: sw, height: sh });
        rightY -= sh + 6;
      }
      const asLbl = 'Authorised Signatory';
      page.drawText(asLbl, { x: RIGHT - font.widthOfTextAtSize(asLbl, 9), y: rightY, size: 9, font, color: grey });
      rightY -= 12;
      const orgStr = sane(orgName);
      page.drawText(orgStr, { x: RIGHT - bold.widthOfTextAtSize(orgStr, 10), y: rightY, size: 10, font: bold, color: dark });
      rightY -= 12;
      y = Math.min(leftY, rightY) - 6;
    }

    // --- Company address footer (centered at the bottom) ---
    const footerLines = [
      branding?.legalName || branding?.displayName || orgName,
      [branding?.addressLine1, branding?.addressLine2].filter(Boolean).join(', '),
      [branding?.city, branding?.state, branding?.postalCode].filter(Boolean).join(', ')
        + (branding?.country ? `, ${branding.country}` : ''),
      [branding?.phone && `Ph: ${branding.phone}`, branding?.email, branding?.website].filter(Boolean).join('  ·  '),
      branding?.gstin ? `GSTIN: ${branding.gstin}` : '',
    ].map((l) => l.trim()).filter(Boolean);
    if (footerLines.length > 1) {
      ensure(footerLines.length * 12 + 16);
      y -= 12;
      page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: line });
      y -= 14;
      footerLines.forEach((l, i) => { textC(l, i === 0 ? 10 : 9, i === 0 ? bold : font, grey); y -= 12; });
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  // ------------------------------------------------------------------
  // Accept (public, token-based — Mode B only)
  // ------------------------------------------------------------------
  async accept(dto: AcceptQuoteDto) {
    const quote = await this.findByToken(dto.token);

    if (!['Sent', 'Viewed'].includes(quote.status)) {
      throw new BadRequestException(`Quote cannot be accepted in status: ${quote.status}`);
    }
    if (quote.expiryDate < new Date()) {
      throw new BadRequestException('Quote has expired');
    }

    const updated = await this.prisma.quickQuote.update({
      where: { id: quote.id },
      data: { status: 'Accepted', acceptedAt: new Date() },
    });

    // Update lead status to Won — but never downgrade an already-Converted lead
    // (a converted lead accepting a follow-up quote stays Converted; BUG-019).
    if (quote.leadId) {
      await this.prisma.lead.updateMany({
        where: { id: quote.leadId, status: { not: 'Converted' } },
        data: { status: 'Won' },
      });
    }

    this.logger.log(`Quote ${quote.quoteNumber} accepted`);
    return updated;
  }

  // ------------------------------------------------------------------
  // Reject (public, token-based) — customer declines from email / public page
  // ------------------------------------------------------------------
  async reject(dto: RejectQuoteDto) {
    const quote = await this.findByToken(dto.token);

    if (!['Sent', 'Viewed'].includes(quote.status)) {
      throw new BadRequestException(`Quote cannot be declined in status: ${quote.status}`);
    }

    const updated = await this.prisma.quickQuote.update({
      where: { id: quote.id },
      data: {
        status: 'Rejected',
        rejectedAt: new Date(),
        rejectionReason: dto.reason?.trim() || null,
      },
    });

    // Mark the lead Lost so the pipeline reflects the declined deal
    if (quote.leadId) {
      await this.prisma.lead.update({ where: { id: quote.leadId }, data: { status: 'Lost' } });
    }

    this.logger.log(`Quote ${quote.quoteNumber} declined${dto.reason ? ` — "${dto.reason}"` : ''}`);
    return updated;
  }

  /**
   * Admin-side accept (deal confirmed offline) — by quote id, no public token.
   * Allowed from Draft/Sent/Viewed/Expired; sets Accepted + marks the lead Won so the
   * quote can be converted to a Zoho customer + invoice.
   */
  async acceptByAdmin(id: string, user: AuthUser) {
    const quote = await this.findOne(id);
    if (!['Draft', 'Sent', 'Viewed', 'Expired'].includes(quote.status)) {
      throw new BadRequestException(`Quote cannot be accepted in status: ${quote.status}`);
    }

    const updated = await this.prisma.quickQuote.update({
      where: { id },
      data: { status: 'Accepted', acceptedAt: new Date() },
    });

    // Never downgrade an already-Converted lead to Won (BUG-019)
    if (quote.leadId) {
      await this.prisma.lead.updateMany({
        where: { id: quote.leadId, status: { not: 'Converted' } },
        data: { status: 'Won' },
      });
    }

    await this.auditLogs.logAction({
      entityType: 'quote',
      entityId: id,
      action: 'update',
      changeSummary: `Quote ${quote.quoteNumber} accepted by admin`,
      newValue: updated,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    this.logger.log(`Quote ${quote.quoteNumber} accepted by admin`);
    return updated;
  }

  /**
   * Undo an accidental accept (admin-side). Allowed only while the status is
   * still 'Accepted' — a converted quote is 'Pushed_To_Zoho' and can't be
   * reverted app-side (the Zoho invoice would have to be voided in Zoho).
   * Reverts the quote to 'Sent' (if it was ever sent) or 'Draft', clears
   * acceptedAt, and rolls a 'Won' lead back to 'Quoted'.
   */
  async unacceptByAdmin(id: string, user: AuthUser) {
    const quote = await this.findOne(id);
    if (quote.status !== 'Accepted') {
      throw new BadRequestException(`Quote is not Accepted (status: ${quote.status}) — undo possible nahi`);
    }

    const updated = await this.prisma.quickQuote.update({
      where: { id },
      data: {
        status: quote.sentAt ? 'Sent' : 'Draft',
        acceptedAt: null,
      },
    });

    // Roll the lead back only if the accept moved it to Won (leave Converted etc. alone)
    if (quote.leadId) {
      await this.prisma.lead.updateMany({
        where: { id: quote.leadId, status: 'Won' },
        data: { status: 'Quoted' },
      });
    }

    await this.auditLogs.logAction({
      entityType: 'quote',
      entityId: id,
      action: 'update',
      changeSummary: `Undid accept status for quote ${quote.quoteNumber} (moved to ${updated.status})`,
      newValue: updated,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    this.logger.log(`Quote ${quote.quoteNumber} accept undone → ${updated.status}`);
    return updated;
  }

  // ------------------------------------------------------------------
  // Delete (Draft only)
  // ------------------------------------------------------------------
  async remove(id: string, user: AuthUser) {
    const quote = await this.findOne(id);
    await this.prisma.quickQuote.delete({ where: { id } });

    await this.auditLogs.logAction({
      entityType: 'quote',
      entityId: id,
      action: 'delete',
      changeSummary: `Quote ${quote.quoteNumber} deleted`,
      userId: user.id,
      userEmailSnapshot: user.email,
    });

    return { deleted: true };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  private validateCustomerFields(dto: CreateQuickQuoteDto) {
    if (dto.customer_type === 'lead' && !dto.lead_id) {
      throw new BadRequestException('lead_id is required for lead quotes');
    }
    if (dto.customer_type === 'existing' && !dto.zoho_customer_id) {
      throw new BadRequestException('zoho_customer_id is required for existing customer quotes');
    }
  }

  private computeTotals(dto: CreateQuickQuoteDto | UpdateQuickQuoteDto) {
    const items = (dto.items ?? []).map((item) => {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      const discPct = Number(item.discount_percent ?? 0);
      const taxRate = Number(item.tax_rate ?? 18);

      const lineSubtotal = qty * price;
      const discountAmount = lineSubtotal * (discPct / 100);
      const taxableAmount = lineSubtotal - discountAmount;
      const lineTax = taxableAmount * (taxRate / 100);
      const lineTotal = taxableAmount + lineTax;

      return {
        lineOrder: item.line_order,
        zohoItemId: item.zoho_item_id,
        itemName: item.item_name,
        itemDescription: item.item_description,
        hsnOrSac: item.hsn_or_sac,
        quantity: qty,
        unitPrice: price,
        costPrice: item.cost_price != null ? Number(item.cost_price) : null,
        discountPercent: discPct,
        discountAmount,
        taxRate,
        lineSubtotal,
        lineTax,
        lineTotal,
        isSubscription: item.is_subscription ?? false,
        billingCycle: item.billing_cycle as BillingCycle | undefined,
        serviceStartDate: item.service_period_start ? new Date(item.service_period_start) : null,
        serviceEndDate: item.service_period_end ? new Date(item.service_period_end) : null,
        // Bulk-domains line: first domain doubles as primaryDomain (prefills the Convert modal)
        primaryDomain: item.primary_domain ?? item.domain_list?.[0]?.domain,
        domainList: item.domain_list?.length
          ? item.domain_list.map((d) => ({ domain: d.domain.trim(), qty: d.qty ?? 1 }))
          : undefined,
        renewedSubscriptionId: item.renewed_subscription_id || null,
      };
    });

    const subtotal = items.reduce((s, i) => s + i.lineSubtotal, 0);
    const discountAmount = items.reduce((s, i) => s + i.discountAmount, 0);
    const taxAmount = items.reduce((s, i) => s + i.lineTax, 0);
    const totalAmount = items.reduce((s, i) => s + i.lineTotal, 0);

    return { items, subtotal, discountAmount, taxAmount, totalAmount };
  }
}
