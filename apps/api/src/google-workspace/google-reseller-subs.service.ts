import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleWorkspaceService, GoogleCustomer, GoogleSubscription } from './google-workspace.service';

interface GoogleSubscriptionExtended extends GoogleSubscription {
  customerDomain?: string;
  suspensionReasons?: string[];
}

const APP_ITEM_SUFFIX = ' - User License (Resale)';

// Google API returns timestamps as milliseconds-since-epoch strings (e.g. "1609459200000")
function parseGoogleTs(ts: string | number | undefined | null): Date | null {
  if (ts == null || ts === '' || ts === '0') return null;
  const n = Number(ts);
  if (!isFinite(n) || n === 0) return null;
  const d = new Date(n);
  return isNaN(d.getTime()) ? null : d;
}

type Slot = 1 | 2;

// ------------------------------------------------------------------
// Job tracking
// ------------------------------------------------------------------
export interface ResellerJob {
  jobId: string;
  type: 'fetch_subscriptions' | 'fetch_customers';
  status: 'running' | 'done' | 'error';
  total: number;
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  slot?: Slot | 'both';
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface ListParams {
  orgId?: string;
  reconciliationStatus?: string;
  googleStatus?: string;
  resellerSlot?: number;
  skuName?: string;
  hasFlag?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

const SORT_FIELD_MAP: Record<string, string> = {
  customerDomain: 'customerDomain',
  orgName: 'orgName',
  skuName: 'skuName',
  seatsLicensed: 'seatsLicensed',
  googleStatus: 'googleStatus',
  resellerSlot: 'resellerSlot',
  reconciliationStatus: 'reconciliationStatus',
  subscriptionFetchedAt: 'subscriptionFetchedAt',
  customerId: 'customerId',
  googleCreationTime: 'googleCreationTime',
  customerFetchedAt: 'customerFetchedAt',
  appSeats: 'appSeats',
  countryCode: 'countryCode',
  contactName: 'contactName',
  planName: 'planName',
};

export interface ReconcileResult {
  matched: number;
  notMatched: number;
  skipped: number;
  total: number;
}

// Concurrent pool: distributes items across N workers running in parallel.
// Each worker processes its items sequentially with `delayMs` between calls.
async function concurrentPool<T>(
  items: T[],
  concurrency: number,
  delayMs: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queues: T[][] = Array.from({ length: concurrency }, () => []);
  items.forEach((item, i) => queues[i % concurrency].push(item));

  await Promise.all(
    queues.map(async (queue) => {
      for (let i = 0; i < queue.length; i++) {
        await worker(queue[i], i);
        if (i < queue.length - 1) await sleep(delayMs);
      }
    }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeJobId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
// Batch size for Prisma $transaction — keeps statement count manageable
const UPDATE_CHUNK = 100;

@Injectable()
export class GoogleResellerSubsService {
  private readonly logger = new Logger(GoogleResellerSubsService.name);
  private readonly jobs = new Map<string, ResellerJob>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleWorkspaceService,
  ) {}

  // ------------------------------------------------------------------
  // Job management
  // ------------------------------------------------------------------
  getJobStatus(jobId: string): ResellerJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  private registerJob(job: ResellerJob): void {
    this.jobs.set(job.jobId, job);
    setTimeout(() => this.jobs.delete(job.jobId), JOB_TTL_MS);
  }

  // ------------------------------------------------------------------
  // Org resolution
  // ------------------------------------------------------------------
  private async resolveOrgId(orgId?: string): Promise<string> {
    if (orgId) return orgId;
    const orgs = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!orgs.length) throw new BadRequestException('No active organization found');
    return orgs[0].id;
  }

  // ------------------------------------------------------------------
  // Build subscription upsert data object
  // ------------------------------------------------------------------
  private buildSubData(
    sub: GoogleSubscriptionExtended,
    orgId: string,
    slot: Slot,
    resellerEmail: string | null,
    now: Date,
  ) {
    return {
      organizationId: orgId,
      customerId: sub.customerId,
      customerDomain: sub.customerDomain ?? '',
      skuId: sub.skuId,
      skuName: sub.skuName ?? null,
      googleStatus: sub.status,
      planName: sub.plan?.planName ?? null,
      isCommitmentPlan: sub.plan?.isCommitmentPlan ?? null,
      seatsLicensed: sub.seats?.numberOfSeats ?? null,
      seatsMaximum: sub.seats?.maximumNumberOfSeats ?? null,
      renewalType: sub.renewalSettings?.renewalType ?? null,
      isInTrial: sub.trialSettings?.isInTrial ?? null,
      trialEndTime: parseGoogleTs(sub.trialSettings?.trialEndTime),
      googleCreationTime: parseGoogleTs(sub.creationTime),
      suspensionReasons: sub.suspensionReasons ?? [],
      resellerSlot: slot,
      resellerEmail,
      subscriptionFetchedAt: now,
    };
  }

  // ------------------------------------------------------------------
  // Batch upsert — one findMany + one createMany + chunked $transaction
  // For 5000 subs: ~51 DB queries instead of 10,000
  // ------------------------------------------------------------------
  private async batchUpsert(
    subs: GoogleSubscriptionExtended[],
    orgId: string,
    slot: Slot,
    resellerEmail: string | null,
  ): Promise<{ inserted: number; updated: number }> {
    if (!subs.length) return { inserted: 0, updated: 0 };

    const now = new Date();
    const subIds = subs.map((s) => s.subscriptionId);

    // 1. Load existing records for these subscriptionIds in ONE query
    const existing = await this.prisma.googleResellerSubscription.findMany({
      where: { organizationId: orgId, googleSubscriptionId: { in: subIds } },
      select: { id: true, googleSubscriptionId: true },
    });
    const existingMap = new Map(existing.map((r) => [r.googleSubscriptionId, r.id]));

    const toInsert = subs.filter((s) => !existingMap.has(s.subscriptionId));
    const toUpdate = subs.filter((s) => existingMap.has(s.subscriptionId));

    // 2. Batch insert (single query)
    if (toInsert.length) {
      await this.prisma.googleResellerSubscription.createMany({
        data: toInsert.map((s) => ({
          ...this.buildSubData(s, orgId, slot, resellerEmail, now),
          googleSubscriptionId: s.subscriptionId,
        })),
        skipDuplicates: true,
      });
    }

    // 3. Batch update in chunks of 100 (avoids huge transactions)
    for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK) {
      const chunk = toUpdate.slice(i, i + UPDATE_CHUNK);
      await this.prisma.$transaction(
        chunk.map((s) =>
          this.prisma.googleResellerSubscription.update({
            where: { id: existingMap.get(s.subscriptionId)! },
            data: this.buildSubData(s, orgId, slot, resellerEmail, now),
          }),
        ),
      );
    }

    this.logger.log(
      `batchUpsert slot ${slot}: ${toInsert.length} inserted, ${toUpdate.length} updated`,
    );
    return { inserted: toInsert.length, updated: toUpdate.length };
  }

  // ------------------------------------------------------------------
  // Fetch subscriptions — start background job, return jobId immediately
  // ------------------------------------------------------------------
  async fetchAllSubscriptions(params: {
    slot?: Slot;
    orgId?: string;
  }): Promise<{ jobId: string; status: string }> {
    const orgId = await this.resolveOrgId(params.orgId);
    const job: ResellerJob = {
      jobId: makeJobId('grs_sub'),
      type: 'fetch_subscriptions',
      status: 'running',
      total: 0,
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      slot: params.slot ?? 'both',
      startedAt: Date.now(),
    };
    this.registerJob(job);
    setImmediate(() => void this._runSubscriptionFetch(job.jobId, orgId, params.slot));
    this.logger.log(`Subscription fetch job ${job.jobId} started (slot: ${job.slot})`);
    return { jobId: job.jobId, status: 'started' };
  }

  private async _runSubscriptionFetch(
    jobId: string,
    orgId: string,
    slot?: Slot,
  ): Promise<void> {
    const job = this.jobs.get(jobId)!;
    const slots: Slot[] = slot ? [slot] : [1, 2];

    try {
      for (const s of slots) {
        const connected = await this.google.isConnected(s);
        if (!connected) {
          this.logger.warn(`Slot ${s} not connected — skipping`);
          continue;
        }

        const resellerEmail = await this.google.getResellerEmail(s);
        let subs: GoogleSubscriptionExtended[];
        try {
          subs = (await this.google.fetchAllSubscriptionsForSlot(s)) as GoogleSubscriptionExtended[];
        } catch (slotErr) {
          const msg = (slotErr as Error).message ?? String(slotErr);
          throw new Error(`Slot ${s} fetch failed — ${msg}`);
        }
        this.logger.log(`Slot ${s}: ${subs.length} subscriptions from Google`);

        job.total += subs.length;

        const { inserted, updated } = await this.batchUpsert(subs, orgId, s, resellerEmail);
        job.inserted += inserted;
        job.updated += updated;
        job.processed += subs.length;
      }

      job.status = 'done';
      job.completedAt = Date.now();
      this.logger.log(
        `Subscription fetch job ${jobId} done: ${job.inserted} inserted, ${job.updated} updated`,
      );
    } catch (err) {
      job.status = 'error';
      job.error = (err as Error).message;
      job.completedAt = Date.now();
      this.logger.error(`Subscription fetch job ${jobId} failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------
  // Single subscription refresh (synchronous — just one row)
  // ------------------------------------------------------------------
  async refreshSubscription(id: string): Promise<{ updated: boolean }> {
    const row = await this.prisma.googleResellerSubscription.findUnique({
      where: { id },
      select: { organizationId: true, googleSubscriptionId: true, customerId: true, resellerSlot: true },
    });
    if (!row) throw new NotFoundException(`GoogleResellerSubscription ${id} not found`);

    const slot = row.resellerSlot as Slot;
    const subs = (await this.google.fetchAllSubscriptionsForSlot(
      slot,
      row.customerId,
    )) as GoogleSubscriptionExtended[];
    const sub = subs.find((s) => s.subscriptionId === row.googleSubscriptionId);
    if (!sub) {
      this.logger.warn(`Subscription ${row.googleSubscriptionId} not found in Google API`);
      return { updated: false };
    }

    const resellerEmail = await this.google.getResellerEmail(slot);
    await this.prisma.googleResellerSubscription.update({
      where: { id },
      data: this.buildSubData(sub, row.organizationId, slot, resellerEmail, new Date()),
    });

    return { updated: true };
  }

  // ------------------------------------------------------------------
  // Fetch customer data — BULK: background job with concurrent pool
  // ------------------------------------------------------------------
  async startCustomerFetch(params: {
    forceRefresh?: boolean;
    orgId?: string;
  }): Promise<{ jobId: string; total: number }> {
    const orgId = await this.resolveOrgId(params.orgId);

    const where: Record<string, unknown> = { organizationId: orgId };
    if (!params.forceRefresh) where.customerFetchedAt = null;

    const rows = await this.prisma.googleResellerSubscription.findMany({
      where,
      select: { id: true, customerId: true, resellerSlot: true },
      orderBy: { customerDomain: 'asc' },
    });

    if (!rows.length) return { jobId: '', total: 0 };

    const uniqueCustomers = new Set(rows.map((r) => r.customerId)).size;
    const job: ResellerJob = {
      jobId: makeJobId('grs_cust'),
      type: 'fetch_customers',
      status: 'running',
      total: uniqueCustomers,
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      startedAt: Date.now(),
    };
    this.registerJob(job);
    setImmediate(() => void this._runCustomerFetch(job.jobId, rows));
    this.logger.log(
      `Customer fetch job ${job.jobId} started: ${uniqueCustomers} unique customers across ${rows.length} rows`,
    );
    return { jobId: job.jobId, total: uniqueCustomers };
  }

  private async _runCustomerFetch(
    jobId: string,
    rows: Array<{ id: string; customerId: string; resellerSlot: number }>,
  ): Promise<void> {
    const job = this.jobs.get(jobId)!;

    try {
      // Deduplicate: one API call per unique customerId
      const uniqueMap = new Map<string, { customerId: string; slot: Slot }>();
      for (const row of rows) {
        if (!uniqueMap.has(row.customerId)) {
          uniqueMap.set(row.customerId, { customerId: row.customerId, slot: row.resellerSlot as Slot });
        }
      }
      const uniqueList = [...uniqueMap.values()];

      // Concurrent pool of 5 workers, 120ms min delay per worker between calls.
      // For 2000 unique customers: ~2000/5 workers × 120ms = ~48 seconds
      // vs. sequential 200ms: 2000 × 200ms = 400 seconds
      const CONCURRENCY = 5;
      const WORKER_DELAY_MS = 120;
      const customerData = new Map<string, GoogleCustomer | null>();

      await concurrentPool(uniqueList, CONCURRENCY, WORKER_DELAY_MS, async ({ customerId, slot }) => {
        const customer = await this.google.fetchCustomerById(customerId, slot);
        customerData.set(customerId, customer);
        job.processed++;
      });

      // Batch apply to all rows (including duplicates sharing a customerId)
      const toUpdate: Array<{ id: string; customer: GoogleCustomer }> = [];
      for (const row of rows) {
        const customer = customerData.get(row.customerId);
        if (customer) toUpdate.push({ id: row.id, customer });
        else job.skipped++;
      }

      const now = new Date();
      for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK) {
        const chunk = toUpdate.slice(i, i + UPDATE_CHUNK);
        await this.prisma.$transaction(
          chunk.map(({ id, customer }) =>
            this.prisma.googleResellerSubscription.update({
              where: { id },
              data: {
                orgName: customer.postalAddress?.organizationName ?? null,
                contactName: customer.postalAddress?.contactName ?? null,
                alternateEmail: customer.alternateEmail ?? null,
                countryCode: customer.postalAddress?.countryCode ?? null,
                customerCreationTime: parseGoogleTs(customer.customerCreationTime),
                resourceUiUrl: customer.resourceUiUrl ?? null,
                customerFetchedAt: now,
              },
            }),
          ),
        );
        job.updated += chunk.length;
      }

      job.status = 'done';
      job.completedAt = Date.now();
      this.logger.log(
        `Customer fetch job ${jobId} done: ${job.updated} rows updated, ${job.skipped} skipped`,
      );
    } catch (err) {
      job.status = 'error';
      job.error = (err as Error).message;
      job.completedAt = Date.now();
      this.logger.error(`Customer fetch job ${jobId} failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------
  // Single-row customer refresh (synchronous — just one row)
  // ------------------------------------------------------------------
  async fetchCustomerData(params: { id: string }): Promise<{ updated: number; skipped: number }> {
    const row = await this.prisma.googleResellerSubscription.findUnique({
      where: { id: params.id },
      select: { id: true, customerId: true, resellerSlot: true },
    });
    if (!row) throw new NotFoundException(`GoogleResellerSubscription ${params.id} not found`);

    const customer = await this.google.fetchCustomerById(row.customerId, row.resellerSlot as Slot);
    if (!customer) return { updated: 0, skipped: 1 };

    await this.prisma.googleResellerSubscription.update({
      where: { id: row.id },
      data: {
        orgName: customer.postalAddress?.organizationName ?? null,
        contactName: customer.postalAddress?.contactName ?? null,
        alternateEmail: customer.alternateEmail ?? null,
        countryCode: customer.postalAddress?.countryCode ?? null,
        customerCreationTime: parseGoogleTs(customer.customerCreationTime),
        resourceUiUrl: customer.resourceUiUrl ?? null,
        customerFetchedAt: new Date(),
      },
    });
    return { updated: 1, skipped: 0 };
  }

  // ------------------------------------------------------------------
  // Reconciliation
  // ------------------------------------------------------------------
  async reconcile(params: { id?: string; orgId?: string }): Promise<ReconcileResult> {
    const orgId = await this.resolveOrgId(params.orgId);

    const rows = await this.prisma.googleResellerSubscription.findMany({
      where: {
        organizationId: orgId,
        ...(params.id ? { id: params.id } : { reconciliationStatus: { not: 'excluded' } }),
      },
      select: { id: true, customerDomain: true, additionalDomains: true, skuName: true, seatsLicensed: true },
    });

    let matched = 0, notMatched = 0, skipped = 0;
    for (const row of rows) {
      const result = await this.reconcileRow(row);
      if (result === 'matched') matched++;
      else if (result === 'not_matched') notMatched++;
      else skipped++;
    }

    this.logger.log(`reconcile done: ${matched} matched, ${notMatched} not matched, ${skipped} skipped`);
    return { matched, notMatched, skipped, total: rows.length };
  }

  private async reconcileRow(
    row: { id: string; customerDomain: string; additionalDomains: string[]; skuName: string | null; seatsLicensed: number | null },
  ): Promise<'matched' | 'not_matched' | 'skipped'> {
    const current = await this.prisma.googleResellerSubscription.findUnique({
      where: { id: row.id },
      select: { reconciliationStatus: true },
    });
    if (current?.reconciliationStatus === 'excluded') return 'skipped';

    // Step 1: domain lookup — cross-org (Google subs and app domains may be under different orgs)
    let domains: Array<{ id: string; domainName: string }> = [];
    let usedAlias = false;

    domains = await this.prisma.domain.findMany({
      where: { domainName: { equals: row.customerDomain, mode: 'insensitive' } },
      select: { id: true, domainName: true },
    });

    if (!domains.length && row.additionalDomains.length > 0) {
      for (const alias of row.additionalDomains) {
        domains = await this.prisma.domain.findMany({
          where: { domainName: { equals: alias, mode: 'insensitive' } },
          select: { id: true, domainName: true },
        });
        if (domains.length) { usedAlias = true; break; }
      }
    }

    if (!domains.length) {
      await this.prisma.googleResellerSubscription.update({
        where: { id: row.id },
        data: { reconciliationStatus: 'not_matched', reconciliationFlags: [], matchedDomainId: null, matchedSubscriptionId: null, matchedDomainName: null, appSeats: null, reconciledAt: new Date() },
      });
      return 'not_matched';
    }

    // Step 2: subscription match — extract plan tier to handle two Zoho naming formats
    const strippedSkuName = (row.skuName ?? '').replace(APP_ITEM_SUFFIX, '').trim();
    const planTier = strippedSkuName.replace(/^google workspace\s*[-–]?\s*/i, '').trim();
    const searchTerm = planTier || strippedSkuName || 'Google Workspace';
    const domainIds = domains.map((d) => d.id);

    const appSub = await this.prisma.subscription.findFirst({
      where: {
        domainId: { in: domainIds },
        zohoItemName: { contains: searchTerm, mode: 'insensitive' },
        lifecycleStatus: { notIn: ['Cancelled', 'Inactive'] },
      },
      select: { id: true, quantity: true, zohoItemName: true, domainId: true },
      orderBy: { createdAt: 'desc' },
    });

    const flags: string[] = [];
    if (usedAlias) flags.push('domain_alias_match');

    const matchedDomain = appSub
      ? (domains.find((d) => d.id === appSub.domainId) ?? domains[0])
      : domains[0];

    if (appSub) {
      const appSeats = Number(appSub.quantity);
      if (row.seatsLicensed !== null && row.seatsLicensed !== appSeats) flags.push('seats_mismatch');
      await this.prisma.googleResellerSubscription.update({
        where: { id: row.id },
        data: { reconciliationStatus: 'matched', reconciliationFlags: flags, matchedDomainId: matchedDomain.id, matchedSubscriptionId: appSub.id, matchedDomainName: matchedDomain.domainName, appSeats, reconciledAt: new Date() },
      });
      return 'matched';
    }

    await this.prisma.googleResellerSubscription.update({
      where: { id: row.id },
      data: { reconciliationStatus: 'not_matched', reconciliationFlags: flags, matchedDomainId: matchedDomain.id, matchedSubscriptionId: null, matchedDomainName: matchedDomain.domainName, appSeats: null, reconciledAt: new Date() },
    });
    return 'not_matched';
  }

  // ------------------------------------------------------------------
  // Import Customer UIDs from CSV
  // ------------------------------------------------------------------
  async importCustomerUids(
    items: Array<{ customerId: string; customerUid: string }>,
    orgId?: string,
  ): Promise<{ updated: number; notFound: number; total: number; notFoundIds: string[] }> {
    const resolvedOrgId = await this.resolveOrgId(orgId);
    let updated = 0, notFound = 0;
    const notFoundIds: string[] = [];

    for (const item of items) {
      const cid = item.customerId.trim();
      const uid = item.customerUid.trim();
      if (!cid || !uid) continue;
      const result = await this.prisma.googleResellerSubscription.updateMany({
        where: { organizationId: resolvedOrgId, customerId: cid },
        data: { customerUid: uid },
      });
      if (result.count > 0) updated += result.count;
      else { notFound++; notFoundIds.push(cid); }
    }

    this.logger.log(`importCustomerUids: ${updated} rows updated, ${notFound} not found`);
    return { updated, notFound, total: items.length, notFoundIds };
  }

  async updateCustomerUid(id: string, customerUid: string): Promise<{ id: string; customerUid: string | null }> {
    const row = await this.prisma.googleResellerSubscription.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException(`GoogleResellerSubscription ${id} not found`);
    return this.prisma.googleResellerSubscription.update({
      where: { id },
      data: { customerUid: customerUid.trim() || null },
      select: { id: true, customerUid: true },
    });
  }

  async updateAdditionalDomains(id: string, domains: string[]): Promise<{ id: string; additionalDomains: string[] }> {
    const row = await this.prisma.googleResellerSubscription.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException(`GoogleResellerSubscription ${id} not found`);
    const cleaned = domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
    await this.prisma.googleResellerSubscription.update({ where: { id }, data: { additionalDomains: cleaned } });
    return { id, additionalDomains: cleaned };
  }

  async setExcluded(id: string, excluded: boolean): Promise<{ id: string; reconciliationStatus: string }> {
    const row = await this.prisma.googleResellerSubscription.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException(`GoogleResellerSubscription ${id} not found`);
    return this.prisma.googleResellerSubscription.update({
      where: { id },
      data: { reconciliationStatus: excluded ? 'excluded' : 'not_matched', reconciledAt: new Date() },
      select: { id: true, reconciliationStatus: true },
    });
  }

  // ------------------------------------------------------------------
  // Paginated list with filters
  // ------------------------------------------------------------------
  async list(params: ListParams) {
    const orgId = await this.resolveOrgId(params.orgId);
    const { reconciliationStatus, googleStatus, resellerSlot, skuName, hasFlag, search, page = 1, limit = 50, sortBy, sortDir = 'asc' } = params;

    const where: Record<string, unknown> = { organizationId: orgId };
    if (reconciliationStatus) where.reconciliationStatus = reconciliationStatus;
    if (googleStatus) where.googleStatus = googleStatus;
    if (resellerSlot) where.resellerSlot = resellerSlot;
    if (skuName) where.skuName = { contains: skuName, mode: 'insensitive' };
    if (hasFlag) where.reconciliationFlags = { has: hasFlag };
    if (search) {
      where.OR = [
        { customerDomain: { contains: search, mode: 'insensitive' } },
        { orgName: { contains: search, mode: 'insensitive' } },
        { customerId: { contains: search, mode: 'insensitive' } },
        { alternateEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.googleResellerSubscription.findMany({
        where,
        orderBy: sortBy && SORT_FIELD_MAP[sortBy]
          ? [{ [SORT_FIELD_MAP[sortBy]]: sortDir }]
          : [{ customerDomain: 'asc' }, { skuName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          matchedDomain: { select: { id: true, domainName: true } },
          matchedSubscription: { select: { id: true, subscriptionNumber: true, zohoItemName: true, lifecycleStatus: true } },
        },
      }),
      this.prisma.googleResellerSubscription.count({ where }),
    ]);

    const [matchedCount, notMatchedCount, excludedCount] = await Promise.all([
      this.prisma.googleResellerSubscription.count({ where: { organizationId: orgId, reconciliationStatus: 'matched' } }),
      this.prisma.googleResellerSubscription.count({ where: { organizationId: orgId, reconciliationStatus: 'not_matched' } }),
      this.prisma.googleResellerSubscription.count({ where: { organizationId: orgId, reconciliationStatus: 'excluded' } }),
    ]);

    return {
      rows, total, page, limit,
      totalPages: Math.ceil(total / limit),
      summary: { matched: matchedCount, notMatched: notMatchedCount, excluded: excludedCount, all: matchedCount + notMatchedCount + excludedCount },
    };
  }

  async listSkuNames(orgId?: string): Promise<string[]> {
    const resolvedOrgId = await this.resolveOrgId(orgId);
    const rows = await this.prisma.googleResellerSubscription.findMany({
      where: { organizationId: resolvedOrgId, skuName: { not: null } },
      select: { skuName: true },
      distinct: ['skuName'],
      orderBy: { skuName: 'asc' },
    });
    return rows.map((r) => r.skuName!).filter(Boolean);
  }
}
