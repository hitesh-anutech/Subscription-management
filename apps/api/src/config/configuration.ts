import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // 32 bytes base64 = 44 chars + optional padding
  ENCRYPTION_KEY: z
    .string()
    .min(32, 'ENCRYPTION_KEY must be at least 32 bytes (base64)'),

  // Zoho — optional fallbacks (UI settings take priority over these)
  ZOHO_CLIENT_ID: z.string().optional().default(''),
  ZOHO_CLIENT_SECRET: z.string().optional().default(''),
  ZOHO_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:3001/api/auth/zoho/callback'),
  ZOHO_DATA_CENTER: z.enum(['in', 'com', 'eu', 'com.au', 'jp', 'sa']).default('in'),
  ZOHO_API_BASE_URL: z.string().url().default('https://www.zohoapis.in/books/v3'),
  ZOHO_ACCOUNTS_URL: z.string().url().default('https://accounts.zoho.in'),

  // Bootstrap admin — used only by seed script on first run
  ADMIN_EMAIL: z.string().email().optional().default('admin@example.com'),
  ADMIN_NAME: z.string().optional().default('Admin'),
  ADMIN_INITIAL_PASSWORD: z.string().min(8).optional().default('ChangeMe!2026'),
});

export type AppConfig = z.infer<typeof schema>;

export const configuration = (): AppConfig => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment configuration:');
    parsed.error.issues.forEach((issue) => {
      // eslint-disable-next-line no-console
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }
  return parsed.data;
};
