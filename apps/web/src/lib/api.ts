/**
 * Lightweight API client for the Next.js app.
 * Sprint 2 will swap to openapi-typescript generated client.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export type ApiError = {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
};

/**
 * Extract a human-readable message from any API error response.
 * Handles both the custom `{ error: { message } }` shape (AllExceptionsFilter)
 * and the plain `{ message }` shape (ValidationPipe, older endpoints).
 */
export function extractApiError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (b.error && typeof b.error === 'object') {
      const msg = (b.error as Record<string, unknown>).message;
      if (typeof msg === 'string' && msg) return msg;
    }
    if (typeof b.message === 'string' && b.message) return b.message;
    if (Array.isArray(b.message) && b.message.length > 0) {
      const first = b.message[0];
      if (typeof first === 'string' && first) return first;
    }
  }
  return fallback;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    credentials: 'include',
  });

  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* non-JSON error */
    }
    const message = body?.error?.message ?? `${res.status} ${res.statusText}`;
    const error = new Error(message) as Error & { status?: number; body?: ApiError };
    error.status = res.status;
    error.body = body;
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export const SESSION_COOKIE = 'subs_session';

// Server-side API client — use in Server Components / page.tsx to forward the session cookie.
export function createServerApi(sessionToken: string) {
  const authHeader = { Cookie: `${SESSION_COOKIE}=${sessionToken}` };
  return {
    get:    <T>(path: string)               => request<T>(path, { headers: authHeader }),
    post:   <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST',   headers: authHeader, body: body ? JSON.stringify(body) : undefined }),
    put:    <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT',    headers: authHeader, body: body ? JSON.stringify(body) : undefined }),
    patch:  <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH',  headers: authHeader, body: body ? JSON.stringify(body) : undefined }),
    delete: <T>(path: string)               => request<T>(path, { method: 'DELETE', headers: authHeader }),
  };
}

// ----------------------- Domain types (subset for Sprint 1) -----------------------

export type Organization = {
  id: string;
  name: string;
  zohoOrgId: string;
  dataCenter: string;
  baseCurrency: string;
  connectionStatus: 'active' | 'expired' | 'revoked' | 'error' | 'disconnected';
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
  isActive: boolean;
  scopes: string | null;
  createdAt: string;
  updatedAt: string;
  orgSettings?: {
    emailFromAddress?: string | null;
    emailReplyTo?: string | null;
    smtpUser?: string | null;
    isSmtpConfigured?: boolean;
    displayName?: string | null;
  } | null;
};

export type OrganizationsListResponse = {
  organizations: Organization[];
};

export type ConnectZohoResponse = {
  authorize_url: string;
};

export type OrgHealth = {
  organization_id: string;
  name: string;
  connection_status: string;
  token_expires_at: string | null;
  token_expired: boolean;
  last_sync_at: string | null;
  scopes: string | null;
};
