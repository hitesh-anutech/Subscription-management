import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { GoogleApiClient } from './google-api.client';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const RESELLER_CONSOLE_BASE = 'https://channelservices.cloud.google.com/customers';
const INTER_DOMAIN_DELAY_MS = 500;
const SYNC_JOB_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface SyncJobResult {
  domainId: string;
  domainName?: string;
  success: boolean;
  error?: string;
}

export interface SyncJob {
  jobId: string;
  status: 'running' | 'done';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  results: SyncJobResult[];
  startedAt: number;
  completedAt?: number;
}

export interface GoogleCustomer {
  kind: string;
  customerId: string;
  customerDomain: string;
  postalAddress?: {
    contactName?: string;
    organizationName?: string;
    countryCode?: string;
  };
  alternateEmail?: string;
  resourceUiUrl?: string;
  customerCreationTime?: string;
}

export interface GoogleSubscription {
  kind: string;
  customerId: string;
  subscriptionId: string;
  skuId: string;
  skuName?: string;
  status: string;
  plan?: { planName: string; isCommitmentPlan?: boolean };
  seats?: { numberOfSeats?: number; maximumNumberOfSeats?: number };
  renewalSettings?: { renewalType: string };
  trialSettings?: { isInTrial?: boolean; trialEndTime?: string };
  creationTime?: string;
}

interface GoogleSubscriptionsResponse {
  kind: string;
  subscriptions: GoogleSubscription[];
  nextPageToken?: string;
}

type Slot = 1 | 2;

// ------------------------------------------------------------------
// Key name helpers per slot
// ------------------------------------------------------------------
function key(name: string, slot: Slot): string {
  return slot === 1 ? name : `${name}_2`;
}

@Injectable()
export class GoogleWorkspaceService {
  private readonly logger = new Logger(GoogleWorkspaceService.name);

  private cachedToken: Record<Slot, { token: string; expiresAt: number } | null> = {
    1: null,
    2: null,
  };

  private readonly syncJobs = new Map<string, SyncJob>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------
  // Per-slot credential helpers
  // ------------------------------------------------------------------

  private async getClientId(slot: Slot): Promise<string> {
    const fromDb = await this.settings.get('google', key('client_id', slot));
    const envKey = slot === 1 ? 'GOOGLE_CLIENT_ID' : 'GOOGLE_CLIENT_ID_2';
    const fromEnv = this.config.get<string>(envKey, '');
    const value = fromDb || fromEnv;
    if (!value) throw new BadRequestException(
      `Google Client ID (Reseller ${slot}) not configured. Go to Settings → Google Workspace.`,
    );
    return value;
  }

  private async getClientSecret(slot: Slot): Promise<string> {
    const fromDb = await this.settings.get('google', key('client_secret', slot));
    const envKey = slot === 1 ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_SECRET_2';
    const fromEnv = this.config.get<string>(envKey, '');
    const value = fromDb || fromEnv;
    if (!value) throw new BadRequestException(
      `Google Client Secret (Reseller ${slot}) not configured. Go to Settings → Google Workspace.`,
    );
    return value;
  }

  private async getRefreshToken(slot: Slot): Promise<string | null> {
    return this.settings.get('google', key('refresh_token', slot));
  }

  async getResellerEmail(slot: Slot): Promise<string | null> {
    return this.settings.get('google', key('reseller_email', slot));
  }

  private getRedirectUri(): string {
    return (
      this.config.get<string>('GOOGLE_REDIRECT_URI') ??
      'http://localhost:3001/api/google-workspace/auth/callback'
    );
  }

  // ------------------------------------------------------------------
  // Token management
  // ------------------------------------------------------------------

  private async getAccessToken(slot: Slot): Promise<string> {
    const cached = this.cachedToken[slot];
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }
    return this.refreshAccessToken(slot);
  }

  private async refreshAccessToken(slot: Slot): Promise<string> {
    const refreshToken = await this.getRefreshToken(slot);
    if (!refreshToken) throw new UnauthorizedException(
      `Google Workspace Reseller ${slot} not connected. Go to Settings → Google Workspace.`,
    );

    const [clientId, clientSecret] = await Promise.all([
      this.getClientId(slot),
      this.getClientSecret(slot),
    ]);

    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });

    let resp: { access_token: string; expires_in: number };
    try {
      const { data } = await axios.post<{ access_token: string; expires_in: number }>(
        GOOGLE_TOKEN_URL,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
      );
      resp = data;
    } catch (err) {
      this.logger.error(`Google token refresh failed (slot ${slot})`, err instanceof Error ? err.stack : err);
      throw new UnauthorizedException(`Google token refresh failed (Reseller ${slot}) — reconnect in Settings`);
    }

    this.cachedToken[slot] = {
      token: resp.access_token,
      expiresAt: Date.now() + resp.expires_in * 1000,
    };
    return resp.access_token;
  }

  private buildClient(slot: Slot): GoogleApiClient {
    return new GoogleApiClient({
      getAccessToken: () => this.getAccessToken(slot),
      onTokenExpired: () => this.refreshAccessToken(slot),
    });
  }

  // ------------------------------------------------------------------
  // OAuth flow
  // ------------------------------------------------------------------

  async buildAuthorizeUrl(slot: Slot = 1): Promise<string> {
    const clientId = await this.getClientId(slot);
    const redirectUri = this.getRedirectUri();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'https://www.googleapis.com/auth/apps.order',
      access_type: 'offline',
      prompt: 'consent',
      state: String(slot),
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async completeOAuth(code: string, slot: Slot = 1): Promise<{ success: boolean }> {
    if (!code) throw new BadRequestException('Missing authorization code');

    const [clientId, clientSecret] = await Promise.all([
      this.getClientId(slot),
      this.getClientSecret(slot),
    ]);
    const redirectUri = this.getRedirectUri();

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });

    let resp: { access_token: string; refresh_token?: string; expires_in: number };
    try {
      const { data } = await axios.post<typeof resp>(
        GOOGLE_TOKEN_URL,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
      );
      resp = data;
    } catch (err) {
      this.logger.error(`Google OAuth token exchange failed (slot ${slot})`, err instanceof Error ? err.stack : err);
      throw new UnauthorizedException(`Google token exchange failed (slot ${slot}) — check credentials`);
    }

    if (!resp.access_token) {
      throw new UnauthorizedException(`Google response missing access_token: ${JSON.stringify(resp)}`);
    }

    this.cachedToken[slot] = {
      token: resp.access_token,
      expiresAt: Date.now() + resp.expires_in * 1000,
    };

    if (resp.refresh_token) {
      await this.settings.set('google', key('refresh_token', slot), resp.refresh_token, {
        sensitive: true,
        description: `Google OAuth refresh token (Reseller ${slot}, encrypted)`,
      });
    }

    this.logger.log(`Google OAuth completed (slot ${slot})`);
    return { success: true };
  }

  async disconnect(slot: Slot = 1): Promise<{ success: boolean }> {
    await this.settings.set('google', key('refresh_token', slot), '', {
      sensitive: false,
      description: `Google OAuth refresh token (Reseller ${slot})`,
    });
    this.cachedToken[slot] = null;
    this.logger.log(`Google Workspace Reseller ${slot} disconnected`);
    return { success: true };
  }

  async isConnected(slot: Slot = 1): Promise<boolean> {
    const token = await this.getRefreshToken(slot);
    return !!(token && token.length > 0);
  }

  async getStatus(): Promise<{
    slot1: { connected: boolean; resellerEmail: string | null };
    slot2: { connected: boolean; resellerEmail: string | null };
    connected: boolean;
  }> {
    const [c1, c2, e1, e2] = await Promise.all([
      this.isConnected(1),
      this.isConnected(2),
      this.getResellerEmail(1),
      this.getResellerEmail(2),
    ]);
    return {
      slot1: { connected: c1, resellerEmail: e1 },
      slot2: { connected: c2, resellerEmail: e2 },
      connected: c1 || c2,
    };
  }

  // ------------------------------------------------------------------
  // Core API operations
  // ------------------------------------------------------------------

  /**
   * Fetch Google customer by domain name.
   * Tries Slot 1 first; if not found (404) tries Slot 2.
   * Stores resellerEmail of the winning slot.
   */
  async fetchAndSaveCustomer(domainId: string): Promise<{
    googleCustomerId: string;
    customerDomain: string;
    consoleUrl: string;
    googleData: Record<string, unknown>;
    subscriptions: GoogleSubscription[];
    resellerEmail: string | null;
  }> {
    const domain = await this.prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);

    const [slot1Connected, slot2Connected] = await Promise.all([
      this.isConnected(1),
      this.isConnected(2),
    ]);

    if (!slot1Connected && !slot2Connected) {
      throw new UnauthorizedException(
        'Google Workspace connected nahi hai. Settings → Google Workspace mein connect karein.',
      );
    }

    let customer: GoogleCustomer | null = null;
    let winningSlot: Slot = 1;
    let subscriptions: GoogleSubscription[] = [];

    // Helper: fetch customer + subscriptions for a slot; returns null on any error
    const trySlot = async (slot: Slot): Promise<{ customer: GoogleCustomer; subs: GoogleSubscription[] } | null> => {
      try {
        const c = await this.buildClient(slot).get<GoogleCustomer>(`/customers/${domain.domainName}`);
        let subs: GoogleSubscription[] = [];
        try {
          const resp = await this.buildClient(slot).get<GoogleSubscriptionsResponse>('/subscriptions', {
            customerId: c.customerId,
          });
          subs = resp.subscriptions ?? [];
        } catch {
          // subscriptions fetch failed — customer still found
        }
        return { customer: c, subs };
      } catch (err) {
        const status = (err as AxiosError)?.response?.status;
        this.logger.warn(`Reseller ${slot}: "${domain.domainName}" fetch failed HTTP ${status ?? 'err'}`);
        return null;
      }
    };

    // Try Slot 1
    if (slot1Connected) {
      const result = await trySlot(1);
      if (result) {
        if (result.subs.length > 0 || !slot2Connected) {
          // Slot 1 has subscriptions (or no Slot 2 to fall back to) — use it
          customer = result.customer;
          subscriptions = result.subs;
          winningSlot = 1;
        } else {
          // Slot 1 found the customer but 0 subscriptions — try Slot 2
          this.logger.warn(
            `Reseller 1 found "${domain.domainName}" but 0 subscriptions — trying Reseller 2`,
          );
        }
      }
    }

    // Try Slot 2 if Slot 1 didn't find active subscriptions
    if (!customer && slot2Connected) {
      const result = await trySlot(2);
      if (result) {
        customer = result.customer;
        subscriptions = result.subs;
        winningSlot = 2;
      }
    }

    if (!customer) {
      throw new NotFoundException(
        `No Subscription Found — "${domain.domainName}" kisi bhi reseller account mein nahi mila.`,
      );
    }

    const resellerEmail = await this.getResellerEmail(winningSlot);

    // Build metadata snapshot
    const googleSnapshot = {
      customerId: customer.customerId,
      customerDomain: customer.customerDomain,
      alternateEmail: customer.alternateEmail ?? null,
      resourceUiUrl: customer.resourceUiUrl ?? null,
      postalAddress: customer.postalAddress ?? null,
      resellerEmail,
      resellerSlot: winningSlot,
      subscriptions: subscriptions.map((s) => ({
        subscriptionId: s.subscriptionId,
        skuId: s.skuId,
        skuName: s.skuName ?? null,
        status: s.status,
        plan: s.plan ?? null,
        seats: s.seats ?? null,
        renewalSettings: s.renewalSettings ?? null,
        trialSettings: s.trialSettings ?? null,
        creationTime: s.creationTime ?? null,
      })),
    };

    const existingMeta = (domain.metadata as Record<string, unknown>) ?? {};
    await this.prisma.domain.update({
      where: { id: domainId },
      data: {
        googleCustomerId: customer.customerId,
        googleSyncedAt: new Date(),
        googleResellerEmail: resellerEmail,
        metadata: { ...existingMeta, google: googleSnapshot },
      },
    });

    this.logger.log(`Google customer ${customer.customerId} saved for domain ${domain.domainName} (Reseller ${winningSlot})`);

    return {
      googleCustomerId: customer.customerId,
      customerDomain: customer.customerDomain,
      consoleUrl: this.getResellerConsoleUrl(customer.customerId),
      googleData: googleSnapshot,
      subscriptions,
      resellerEmail,
    };
  }

  async listSubscriptionsForDomain(domainId: string): Promise<{
    googleCustomerId: string | null;
    consoleUrl: string | null;
    subscriptions: GoogleSubscription[];
    syncedAt: Date | null;
  }> {
    const domain = await this.prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);

    if (!domain.googleCustomerId) {
      return { googleCustomerId: null, consoleUrl: null, subscriptions: [], syncedAt: null };
    }

    // Use whichever slot is stored in metadata, fallback to slot 1
    const meta = (domain.metadata as Record<string, unknown>)?.google as Record<string, unknown> | undefined;
    const storedSlot = (meta?.resellerSlot as number) === 2 ? 2 : 1;
    const connected = await this.isConnected(storedSlot);
    const slot: Slot = connected ? storedSlot : (await this.isConnected(1) ? 1 : 2);

    const client = this.buildClient(slot);
    let subscriptions: GoogleSubscription[] = [];
    try {
      const resp = await client.get<GoogleSubscriptionsResponse>('/subscriptions', {
        customerId: domain.googleCustomerId,
      });
      subscriptions = resp.subscriptions ?? [];
    } catch (err) {
      this.logger.error(`Subscription list failed for customerId ${domain.googleCustomerId}`, err instanceof Error ? err.message : err);
    }

    return {
      googleCustomerId: domain.googleCustomerId,
      consoleUrl: this.getResellerConsoleUrl(domain.googleCustomerId),
      subscriptions,
      syncedAt: domain.googleSyncedAt,
    };
  }

  getResellerConsoleUrl(googleCustomerId: string): string {
    return `${RESELLER_CONSOLE_BASE}/${googleCustomerId}`;
  }

  async startBulkSync(params: {
    domainIds?: string[];
    syncAll?: boolean;
  }): Promise<{ jobId: string; total: number }> {
    const [c1, c2] = await Promise.all([this.isConnected(1), this.isConnected(2)]);
    if (!c1 && !c2) throw new UnauthorizedException('Google Workspace connected nahi hai. Settings → Google Workspace mein connect karein.');

    let ids: string[];
    if (params.syncAll) {
      const rows = await this.prisma.subscription.findMany({
        where: {
          zohoItemName: { contains: 'Google Workspace', mode: 'insensitive' },
          lifecycleStatus: { notIn: ['Cancelled', 'Inactive'] },
        },
        select: { domainId: true },
        distinct: ['domainId'],
      });
      ids = rows.map((r) => r.domainId);
    } else {
      ids = [...new Set(params.domainIds ?? [])];
    }

    if (!ids.length) throw new BadRequestException('No domains to sync');

    const jobId = `gsync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: SyncJob = {
      jobId, status: 'running',
      total: ids.length, processed: 0, succeeded: 0, failed: 0,
      results: [], startedAt: Date.now(),
    };
    this.syncJobs.set(jobId, job);

    // Fire-and-forget — runs after HTTP response is sent
    setImmediate(() => void this.runBulkSync(jobId, ids));

    // Auto-cleanup after TTL
    setTimeout(() => this.syncJobs.delete(jobId), SYNC_JOB_TTL_MS);

    this.logger.log(`Bulk sync job ${jobId} started: ${ids.length} domains`);
    return { jobId, total: ids.length };
  }

  private async runBulkSync(jobId: string, ids: string[]): Promise<void> {
    const job = this.syncJobs.get(jobId);
    if (!job) return;

    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await this.fetchAndSaveCustomer(ids[i]);
        job.succeeded++;
        job.results.push({ domainId: ids[i], domainName: res.customerDomain, success: true });
      } catch (err) {
        job.failed++;
        job.results.push({ domainId: ids[i], success: false, error: (err as Error).message });
      }
      job.processed = i + 1;
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, INTER_DOMAIN_DELAY_MS));
    }

    job.status = 'done';
    job.completedAt = Date.now();
    this.logger.log(`Bulk sync job ${jobId} done: ${job.succeeded}/${job.total} succeeded`);
  }

  getSyncJobStatus(jobId: string): SyncJob | null {
    return this.syncJobs.get(jobId) ?? null;
  }

  async getDomainGoogleData(domainId: string): Promise<{
    googleCustomerId: string | null;
    consoleUrl: string | null;
    syncedAt: Date | null;
    googleData: Record<string, unknown> | null;
    resellerEmail: string | null;
  }> {
    const domain = await this.prisma.domain.findUnique({
      where: { id: domainId },
      select: { googleCustomerId: true, googleSyncedAt: true, googleResellerEmail: true, metadata: true },
    });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);

    const googleCustomerId = domain.googleCustomerId ?? null;
    const googleData = ((domain.metadata as Record<string, unknown>)?.google as Record<string, unknown>) ?? null;
    return {
      googleCustomerId,
      consoleUrl: googleCustomerId ? this.getResellerConsoleUrl(googleCustomerId) : null,
      syncedAt: domain.googleSyncedAt ?? null,
      googleData,
      resellerEmail: domain.googleResellerEmail ?? null,
    };
  }
}
