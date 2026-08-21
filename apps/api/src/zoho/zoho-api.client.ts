import { Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';

/**
 * ZohoApiClient — one instance per Zoho org.
 *
 * Per Zoho Integration Spec §11:
 *   - Rate limit: 80 req/min (Zoho hard limit 100/min, leave headroom)
 *   - Retry: 5xx + 429 with exponential backoff (1s, 2s, 4s)
 *   - 401 → call onTokenExpired callback for refresh, retry once
 *
 * Consumers inject this via `ZohoApiClientFactory.forOrg(orgId)`.
 */
export interface ZohoApiClientOptions {
  apiBaseUrl: string;          // e.g. https://www.zohoapis.in/books/v3
  organizationId: string;      // Zoho's organization_id (mandatory query param)
  getAccessToken: () => Promise<string>;   // fetches & decrypts current token
  onTokenExpired: () => Promise<string>;   // refreshes token, returns new access token
  rateLimitPerMinute?: number;             // default 80
}

export class ZohoApiClient {
  private readonly logger = new Logger('ZohoApiClient');
  private readonly axios: AxiosInstance;
  private readonly limiter: Bottleneck;
  private readonly opts: ZohoApiClientOptions;

  constructor(opts: ZohoApiClientOptions) {
    this.opts = opts;
    const perMin = opts.rateLimitPerMinute ?? 80;

    this.limiter = new Bottleneck({
      reservoir: perMin,
      reservoirRefreshAmount: perMin,
      reservoirRefreshInterval: 60_000,
      // PERF_PLAN #6d: raised 5→8 for burst throughput on multi-row detail fetches.
      // Still bounded by the 80/min reservoir above, so we stay within Zoho's limit.
      maxConcurrent: 8,
    });

    this.axios = axios.create({
      baseURL: opts.apiBaseUrl,
      timeout: 30_000,
      headers: { Accept: 'application/json' },
      // Decode responses as UTF-8 ourselves. axios/Node otherwise mis-decodes Zoho's
      // emoji dropdown options (e.g. "✅ Support Paid") as Windows-1252 → double-encoded
      // mojibake, so the value never matches Zoho on write-back ("Invalid value" errors).
      responseType: 'arraybuffer',
      transformResponse: [(data: unknown) => {
        if (data == null) return data;
        const text = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : typeof data === 'string'
            ? data
            : Buffer.from(data as ArrayBuffer).toString('utf8');
        if (!text) return undefined;
        try { return JSON.parse(text); } catch { return text; }
      }],
    });

    // Inject org_id query param on every request
    this.axios.interceptors.request.use(async (cfg) => {
      const token = await opts.getAccessToken();
      cfg.headers.Authorization = `Zoho-oauthtoken ${token}`;
      cfg.params = { ...(cfg.params ?? {}), organization_id: opts.organizationId };
      return cfg;
    });

    // 401 → refresh once
    this.axios.interceptors.response.use(
      (r) => r,
      async (error: AxiosError) => {
        const cfg = error.config as AxiosRequestConfig & { _retried401?: boolean };
        if (error.response?.status === 401 && cfg && !cfg._retried401) {
          this.logger.warn('401 from Zoho — refreshing token and retrying once');
          cfg._retried401 = true;
          const fresh = await opts.onTokenExpired();
          cfg.headers = cfg.headers ?? {};
          (cfg.headers as Record<string, string>).Authorization = `Zoho-oauthtoken ${fresh}`;
          return this.axios.request(cfg);
        }
        return Promise.reject(error);
      },
    );

    // Backoff retry for 5xx + 429
    axiosRetry(this.axios, {
      retries: 3,
      retryDelay: (count) => Math.min(1000 * 2 ** (count - 1), 8000),
      retryCondition: (err) => {
        const status = err.response?.status ?? 0;
        return axiosRetry.isNetworkError(err) || status >= 500 || status === 429;
      },
      onRetry: (count, err) => {
        this.logger.warn(
          `Retry ${count}/3 for ${err.config?.url} (status=${err.response?.status ?? 'network'})`,
        );
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get<T = any>(path: string, params?: Record<string, unknown>) {
    return this.limiter.schedule(() =>
      this.axios.get<T>(path, { params }).then((r) => r.data),
    );
  }

  /**
   * Fetch a raw binary body (e.g. a document PDF via `?accept=pdf`).
   * Bypasses the instance's UTF-8 `transformResponse` (which would mangle the
   * bytes) and returns the response as a Node Buffer. Still rate-limited.
   */
  async getBinary(path: string, params?: Record<string, unknown>): Promise<Buffer> {
    return this.limiter.schedule(() =>
      this.axios
        .get(path, {
          params,
          responseType: 'arraybuffer',
          transformResponse: [(d: unknown) => d],
        })
        .then((r) => Buffer.from(r.data as ArrayBuffer)),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  post<T = any>(path: string, body: unknown, params?: Record<string, unknown>, config?: Record<string, unknown>) {
    return this.limiter.schedule(() =>
      this.axios.post<T>(path, body, { params, ...config }).then((r) => r.data),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  put<T = any>(path: string, body: unknown, params?: Record<string, unknown>) {
    return this.limiter.schedule(() =>
      this.axios.put<T>(path, body, { params }).then((r) => r.data),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete<T = any>(path: string, params?: Record<string, unknown>) {
    return this.limiter.schedule(() =>
      this.axios.delete<T>(path, { params }).then((r) => r.data),
    );
  }
}
