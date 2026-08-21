import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ZohoService } from './zoho.service';

/**
 * WebhookService — processes incoming Zoho Books webhook events.
 *
 * Event types handled:
 *   estimate_updated (status = accepted)  → log acceptance
 *   invoice_created                        → log invoice on renewal_history
 *   payment_added                          → mark renewal paid, extend subscription
 *
 * Idempotency: event_hash (sha256 of org_id+event_type+entity_id+payload)
 * prevents duplicate processing.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zoho: ZohoService,
  ) {}

  async ingest(orgId: string | null, payload: Record<string, unknown>): Promise<{ queued: boolean; skipped?: boolean }> {
    const eventType  = String(payload['event_type']  ?? payload['type']  ?? 'unknown');
    const entityId   = String(payload['entity_id']   ?? (payload['data'] as Record<string, unknown>)?.['estimate_id'] ?? (payload['data'] as Record<string, unknown>)?.['invoice_id'] ?? (payload['data'] as Record<string, unknown>)?.['payment_id'] ?? 'unknown');

    const hash = createHash('sha256')
      .update(`${orgId}:${eventType}:${entityId}:${JSON.stringify(payload)}`)
      .digest('hex');

    const existing = await this.prisma.webhookEvent.findUnique({ where: { eventHash: hash } });
    if (existing) {
      this.logger.debug(`Duplicate webhook skipped: ${eventType} ${entityId}`);
      return { queued: false, skipped: true };
    }

    const event = await this.prisma.webhookEvent.create({
      data: {
        organizationId:   orgId ?? undefined,
        eventType,
        zohoEntityId:     entityId !== 'unknown' ? entityId : undefined,
        eventHash:        hash,
        payload:          payload as never,
        processingStatus: 'pending',
      },
    });

    // Process synchronously (MVP — no queue)
    await this.process(event.id, orgId, eventType, entityId, payload);

    return { queued: true };
  }

  private async process(
    eventId: string,
    orgId: string | null,
    eventType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ) {
    try {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { processingStatus: 'processing' },
      });

      switch (eventType) {
        case 'estimate_updated':
          await this.handleEstimateUpdated(orgId, payload);
          break;
        case 'invoice_created':
          await this.handleInvoiceCreated(orgId, payload);
          break;
        case 'payment_added':
        case 'customerpayment_added':
          await this.handlePaymentAdded(orgId, payload);
          break;
        default:
          this.logger.debug(`Unhandled webhook type: ${eventType}`);
      }

      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { processingStatus: 'success', processedAt: new Date() },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Webhook processing failed [${eventType}]: ${msg}`);
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          processingStatus: 'failed',
          errorMessage: msg,
          retryCount: { increment: 1 },
        },
      });
    }
  }

  // ------------------------------------------------------------------
  // estimate_updated → check if accepted, log on quote
  // ------------------------------------------------------------------
  private async handleEstimateUpdated(orgId: string | null, payload: Record<string, unknown>) {
    const data = (payload['data'] ?? payload) as Record<string, unknown>;
    const estimate = (data['estimate'] ?? data) as Record<string, unknown>;
    const estimateId  = String(estimate['estimate_id'] ?? '');
    const status      = String(estimate['status'] ?? '');
    const cfSubId     = this.extractCf(estimate, 'cf_central_subscription_id');

    // PERF_PLAN #3: the estimate changed in Zoho → drop any cached detail so the
    // documents browser doesn't serve a stale copy. Also drop the stored PDF.
    if (estimateId) {
      this.zoho.invalidateDocCache(orgId, 'estimate', estimateId);
      await this.zoho.invalidateDocPdf(orgId, 'estimate', estimateId);
    }

    if (!estimateId || status !== 'accepted') return;

    // Update quick_quote if matched
    await this.prisma.quickQuote.updateMany({
      where: { zohoEstimateId: estimateId },
      data:  { status: 'Accepted', acceptedAt: new Date() },
    });

    // Update renewal_history if matched
    if (cfSubId) {
      await this.prisma.renewalHistory.updateMany({
        where: { subscriptionId: cfSubId, quoteId: estimateId },
        data:  { renewalStatus: 'Quoted' },
      });
    }

    this.logger.log(`Estimate ${estimateId} accepted → records updated`);
  }

  // ------------------------------------------------------------------
  // invoice_created → link invoice to renewal_history rows
  // Works for both individual quotes (1 row) and bulk batches (N rows)
  // by looking up via quoteId = estimate_id, which is always stored at
  // quote-generation time — no custom field required.
  // ------------------------------------------------------------------
  private async handleInvoiceCreated(orgId: string | null, payload: Record<string, unknown>) {
    const data    = (payload['data'] ?? payload) as Record<string, unknown>;
    const invoice = (data['invoice'] ?? data) as Record<string, unknown>;
    const invoiceId     = String(invoice['invoice_id'] ?? '');
    const invoiceNumber = String(invoice['invoice_number'] ?? '');
    const estimateId    = String((invoice['estimate_ids'] as string[] | undefined)?.[0] ?? '');

    // PERF_PLAN #3: invoice created + its source estimate now shows "invoiced" →
    // invalidate both cached details and their stored PDFs.
    if (invoiceId)  { this.zoho.invalidateDocCache(orgId, 'invoice', invoiceId);  await this.zoho.invalidateDocPdf(orgId, 'invoice', invoiceId); }
    if (estimateId) { this.zoho.invalidateDocCache(orgId, 'estimate', estimateId); await this.zoho.invalidateDocPdf(orgId, 'estimate', estimateId); }

    if (!invoiceId || !estimateId) return;

    // Update all renewal_history rows that belong to this estimate
    const updated = await this.prisma.renewalHistory.updateMany({
      where: { quoteId: estimateId, renewalStatus: 'Quoted' },
      data: {
        invoiceId,
        invoiceNumber,
        invoiceDate:   new Date(),
        renewalStatus: 'Invoiced',
      },
    });

    if (updated.count > 0) {
      // Sync last_invoice_* on all affected subscriptions
      const rows = await this.prisma.renewalHistory.findMany({
        where: { quoteId: estimateId, invoiceId },
        select: { subscriptionId: true },
      });
      await this.prisma.subscription.updateMany({
        where: { id: { in: rows.map(r => r.subscriptionId) } },
        data: { lastInvoiceId: invoiceId, lastInvoiceNumber: invoiceNumber, lastInvoiceDate: new Date() },
      });
    }

    this.logger.log(`Invoice ${invoiceNumber} → ${updated.count} renewal_history row(s) updated`);
  }

  // ------------------------------------------------------------------
  // payment_added → extend subscription dates, mark renewal Paid
  // ------------------------------------------------------------------
  private async handlePaymentAdded(orgId: string | null, payload: Record<string, unknown>) {
    const data    = (payload['data'] ?? payload) as Record<string, unknown>;
    const payment = (data['payment'] ?? data['customerpayment'] ?? data) as Record<string, unknown>;
    const paymentId     = String(payment['payment_id'] ?? payment['customerpayment_id'] ?? '');
    const invoiceIds    = (payment['invoices'] as Array<Record<string, unknown>> | undefined)
      ?.map((i) => String(i['invoice_id'])) ?? [];

    if (!paymentId || invoiceIds.length === 0) return;

    // PERF_PLAN #3: payment changes invoice status → drop cached invoice details + PDFs.
    for (const iid of invoiceIds) {
      this.zoho.invalidateDocCache(orgId, 'invoice', iid);
      await this.zoho.invalidateDocPdf(orgId, 'invoice', iid);
    }

    for (const invoiceId of invoiceIds) {
      // findMany — handles bulk batches (N rows per invoice) and individual (1 row)
      const historyRows = await this.prisma.renewalHistory.findMany({
        where: { invoiceId, renewalStatus: 'Invoiced' },
      });

      if (!historyRows.length) continue;

      // Mark all matching rows paid in one query
      await this.prisma.renewalHistory.updateMany({
        where: { invoiceId, renewalStatus: 'Invoiced' },
        data: { paymentId, paymentDate: new Date(), renewalStatus: 'Paid' },
      });

      // Update each subscription's dates / quantity
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
          // Dates UNCHANGED — only quantity increases (PRD §8A.2)
          updateData.quantity = Number(sub.quantity) + Number(historyRow.quantity);
        }

        await this.prisma.subscription.update({
          where: { id: historyRow.subscriptionId },
          data: updateData,
        });

        this.logger.log(`Payment ${paymentId} → sub ${sub.subscriptionNumber} updated (${historyRow.businessType})`);
      }
    }
  }

  // ------------------------------------------------------------------
  // Helper: extract Zoho custom field value by label
  // ------------------------------------------------------------------
  private extractCf(obj: Record<string, unknown>, label: string): string | null {
    const cfs = obj['custom_fields'] as Array<Record<string, unknown>> | undefined;
    if (!cfs) return null;
    const cf = cfs.find((f) => f['label'] === label || f['api_name'] === label);
    return cf ? String(cf['value'] ?? '') || null : null;
  }
}
