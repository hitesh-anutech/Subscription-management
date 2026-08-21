import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ZohoService } from '../zoho/zoho.service';
import { EmailService } from '../email/email.service';
import { SettingsService } from '../settings/settings.service';
import { ConversionsService } from '../conversions/conversions.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly zoho: ZohoService,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
    private readonly conversions: ConversionsService,
  ) {}

  // ------------------------------------------------------------------
  // Expiry Status Sync — runs every day at 00:05 IST (18:35 UTC)
  // ------------------------------------------------------------------
  @Cron('35 18 * * *', { timeZone: 'UTC' })
  async syncExpiryStatuses() {
    this.logger.log('[Cron] syncExpiryStatuses starting');
    try {
      const result = await this.subscriptions.syncExpiryStatuses();
      this.logger.log(`[Cron] syncExpiryStatuses: ${result.expiringSoon} expiring soon, ${result.expired} expired`);
    } catch (err) {
      this.logger.error('[Cron] syncExpiryStatuses failed', err instanceof Error ? err.stack : err);
    }
  }

  // ------------------------------------------------------------------
  // Renewal Reminder Emails — runs every day at 07:00 IST (01:30 UTC)
  // ------------------------------------------------------------------
  @Cron('30 1 * * *', { timeZone: 'UTC' })
  async sendRenewalReminders() {
    this.logger.log('[Cron] sendRenewalReminders starting');

    try {
      const rawDays = await this.settings.get('subscription', 'renewal_reminder_days');
      const reminderDays = (rawDays ?? '60,30,15,7')
        .split(',')
        .map((d) => parseInt(d.trim(), 10))
        .filter((d) => !isNaN(d) && d > 0);

      const emailEnabled = await this.settings.get('notification', 'channel_email_enabled');
      if (emailEnabled === 'false') {
        this.logger.log('[Cron] Email channel disabled — skipping reminders');
        return;
      }

      let sent = 0;
      const today = new Date();

      for (const days of reminderDays) {
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() + days);
        const dateStr = targetDate.toISOString().split('T')[0];

        const subs = await this.prisma.subscription.findMany({
          where: {
            lifecycleStatus: { in: ['Active', 'Expiring_Soon'] },
            endDate: {
              gte: new Date(`${dateStr}T00:00:00Z`),
              lt:  new Date(`${dateStr}T23:59:59Z`),
            },
          },
          include: { domain: { select: { domainName: true } } },
        });

        for (const sub of subs) {
          try {
            const toEmail = await this.getCustomerEmail(sub.zohoCustomerId, sub.organizationId);
            if (!toEmail) continue;

            await this.email.sendFromTemplate('renewal_reminder_' + days as never, toEmail, {
              customer_name:       sub.zohoCustomerName ?? toEmail,
              subscription_number: sub.subscriptionNumber,
              item_name:           sub.zohoItemName ?? sub.zohoItemId,
              end_date:            sub.endDate.toLocaleDateString('en-IN'),
            }, { organizationId: sub.organizationId });
            sent++;
          } catch (emailErr) {
            this.logger.warn(`Reminder email failed for sub ${sub.subscriptionNumber}: ${String(emailErr)}`);
          }
        }

        this.logger.log(`[Cron] ${days}-day reminder: ${subs.length} subs found, sent ${sent} so far`);
      }

      this.logger.log(`[Cron] sendRenewalReminders complete: ${sent} emails sent`);
    } catch (err) {
      this.logger.error('[Cron] sendRenewalReminders failed', err instanceof Error ? err.stack : err);
    }
  }

  // ------------------------------------------------------------------
  // Daily Zoho Sync — runs every day at 03:00 IST (21:30 UTC prev day)
  // ------------------------------------------------------------------
  @Cron('30 21 * * *', { timeZone: 'UTC' })
  async dailyZohoSync() {
    this.logger.log('[Cron] dailyZohoSync starting');

    try {
      const orgs = await this.prisma.organization.findMany({
        where: { isActive: true, connectionStatus: 'active' },
        select: { id: true, name: true },
      });

      for (const org of orgs) {
        try {
          const [customers, items] = await Promise.all([
            this.zoho.syncCustomers(org.id),
            this.zoho.syncItems(org.id),
          ]);
          await this.prisma.organization.update({
            where: { id: org.id },
            data: { lastSyncAt: new Date() },
          });
          this.logger.log(
            `[Cron] Synced org "${org.name}": ${customers.synced} customers, ${items.synced} items`,
          );
        } catch (orgErr) {
          this.logger.error(`[Cron] Sync failed for org "${org.name}": ${String(orgErr)}`);
        }
      }

      this.logger.log(`[Cron] dailyZohoSync complete — ${orgs.length} orgs processed`);
    } catch (err) {
      this.logger.error('[Cron] dailyZohoSync failed', err instanceof Error ? err.stack : err);
    }
  }

  // ------------------------------------------------------------------
  // Pull-Based Invoice Status Sync — runs every 2 hours
  // ------------------------------------------------------------------
  @Cron('0 */2 * * *')
  async syncPendingInvoicesStatus() {
    this.logger.log('[Cron] syncPendingInvoicesStatus starting');
    try {
      const pendingQuotes = await this.prisma.quickQuote.findMany({
        where: {
          zohoInvoiceStatus: { in: ['sent', 'invoiced', 'overdue', 'partially_paid', 'draft'] },
          zohoEstimateId: { not: null },
        },
        select: { id: true, quoteNumber: true },
      });

      this.logger.log(`[Cron] Found ${pendingQuotes.length} pending invoices to sync`);

      for (const quote of pendingQuotes) {
        try {
          const res = await this.conversions.refreshQuoteInvoiceStatus(quote.id);
          this.logger.log(`[Cron] Synced status for quote ${quote.quoteNumber}: ${res.zohoInvoiceStatus}`);
        } catch (err) {
          this.logger.error(`[Cron] Sync failed for quote ${quote.quoteNumber}: ${String(err)}`);
        }
      }
      this.logger.log('[Cron] syncPendingInvoicesStatus complete');
    } catch (err) {
      this.logger.error('[Cron] syncPendingInvoicesStatus failed', err instanceof Error ? err.stack : err);
    }
  }

  // ------------------------------------------------------------------
  // Helper: get email for a Zoho customer from cache
  // ------------------------------------------------------------------
  private async getCustomerEmail(zohoCustomerId: string, orgId: string): Promise<string | null> {
    const cached = await this.prisma.zohoCache.findFirst({
      where: { organizationId: orgId, entityType: 'customer', zohoId: zohoCustomerId },
      select: { email: true },
    });
    return cached?.email ?? null;
  }
}
