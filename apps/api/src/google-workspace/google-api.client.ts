import { Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

const RESELLER_BASE_URL = 'https://reseller.googleapis.com/apps/reseller/v1';

export interface GoogleApiClientOptions {
  getAccessToken: () => Promise<string>;
  onTokenExpired: () => Promise<string>;
}

/**
 * GoogleApiClient — HTTP client for Google Workspace Reseller API.
 *
 * - Bearer token auth (OAuth 2.0)
 * - 401 → auto-refresh once per request
 * - 30s timeout
 */
export class GoogleApiClient {
  private readonly logger = new Logger('GoogleApiClient');
  private readonly axios: AxiosInstance;
  private readonly opts: GoogleApiClientOptions;

  constructor(opts: GoogleApiClientOptions) {
    this.opts = opts;

    this.axios = axios.create({
      baseURL: RESELLER_BASE_URL,
      timeout: 30_000,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });

    // Inject Bearer token on every request
    this.axios.interceptors.request.use(async (cfg) => {
      const token = await opts.getAccessToken();
      cfg.headers.Authorization = `Bearer ${token}`;
      return cfg;
    });

    // 401 → refresh once
    this.axios.interceptors.response.use(
      (r) => r,
      async (error: AxiosError) => {
        const cfg = error.config as AxiosRequestConfig & { _retried401?: boolean };
        if (error.response?.status === 401 && cfg && !cfg._retried401) {
          this.logger.warn('401 from Google — refreshing token and retrying once');
          cfg._retried401 = true;
          const fresh = await opts.onTokenExpired();
          cfg.headers = cfg.headers ?? {};
          (cfg.headers as Record<string, string>).Authorization = `Bearer ${fresh}`;
          return this.axios.request(cfg);
        }
        return Promise.reject(error);
      },
    );
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const { data } = await this.axios.get<T>(path, { params });
    return data;
  }
}
