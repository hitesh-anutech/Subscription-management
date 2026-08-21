/* eslint-disable no-console */
/**
 * Seed script
 * --------------------------------------------------------------------
 * 1. Runs `seed_defaults.sql` (app_settings, master_data_lists, email_templates).
 * 2. Creates the bootstrap admin user from ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD env vars.
 *
 * Idempotent — safe to re-run. Uses ON CONFLICT DO NOTHING for settings,
 * and upsert for the admin user.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrypt as scryptCallback, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

/**
 * scrypt-based password hash. Format: `scrypt:$<saltHex>:$<hashHex>`.
 * Sprint 1 placeholder — Sprint 2 will swap to argon2 via @node-rs/argon2.
 */
async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(plaintext, salt, 64)) as Buffer;
  return `scrypt:$${salt.toString('hex')}:$${derived.toString('hex')}`;
}

async function runDefaultsSql() {
  const sqlPath = resolve(__dirname, 'seed_defaults.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  // Split on semicolon-newline boundaries that aren't inside JSON strings.
  // Simpler: run the whole file via $executeRawUnsafe — psql-style.
  // Prisma supports multi-statement raw via $executeRawUnsafe on Postgres
  // only when there's exactly one statement. So we split conservatively.
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  let executed = 0;
  for (const stmt of statements) {
    // Skip pure comment blocks (lines starting with --)
    const code = stmt
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim();
    if (!code) continue;
    try {
      await prisma.$executeRawUnsafe(code);
      executed++;
    } catch (err) {
      // ON CONFLICT DO NOTHING handles dupes; only re-throw real errors
      if (err instanceof Error && /duplicate key/i.test(err.message)) {
        continue;
      }
      throw err;
    }
  }
  console.log(`  ✓ Executed ${executed} statements from seed_defaults.sql`);
}

async function createBootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME ?? 'Admin';
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!email || !password) {
    console.log('  ⚠ ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD not set — skipping admin user creation');
    return;
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name,
      passwordHash,
      role: 'Admin',
      emailVerified: new Date(),
    },
  });

  console.log(`  ✓ Bootstrap admin: ${user.email} (id=${user.id})`);
}

const EMAIL_TEMPLATES = [
  {
    templateKey: 'quote_sent',
    templateName: 'Quote Sent to Customer',
    category: 'quote' as const,
    subject: 'Your quote {{quote_number}} from {{company_name}}',
    bodyHtml: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
<p>Dear {{customer_name}},</p>
<p>Thank you for your interest. Please find attached quote <strong>{{quote_number}}</strong>, valid until {{validity_date}}.</p>
<p>Total amount: <strong>{{total_amount}}</strong></p>
<p>You can view, accept, or reject this quote online:<br><a href="{{quote_link}}">{{quote_link}}</a></p>
<p>Regards,<br>{{sender_name}}<br>{{company_name}}</p>
</div>`,
    availablePlaceholders: ['customer_name', 'quote_number', 'validity_date', 'total_amount', 'quote_link', 'sender_name', 'company_name'],
  },
  {
    templateKey: 'quote_viewed',
    templateName: 'Quote Viewed Notification (Internal)',
    category: 'quote' as const,
    subject: 'Quote {{quote_number}} viewed by {{customer_name}}',
    bodyHtml: `<p>Hi {{sender_name}},</p>
<p>Quote <strong>{{quote_number}}</strong> sent to {{customer_name}} was just viewed (view #{{view_count}}).</p>`,
    availablePlaceholders: ['sender_name', 'quote_number', 'customer_name', 'view_count'],
  },
  {
    templateKey: 'quote_accepted',
    templateName: 'Quote Accepted Notification (Internal)',
    category: 'quote' as const,
    subject: 'Quote {{quote_number}} accepted by {{customer_name}}',
    bodyHtml: `<p>Hi {{sender_name}},</p>
<p>Quote <strong>{{quote_number}}</strong> was accepted by {{customer_name}}.</p>
<p>Next step: <a href="{{conversion_link}}">Convert to Customer</a></p>`,
    availablePlaceholders: ['sender_name', 'quote_number', 'customer_name', 'conversion_link'],
  },
  {
    templateKey: 'renewal_reminder_60',
    templateName: 'Renewal Reminder — 60 days',
    category: 'subscription' as const,
    subject: 'Your subscription {{subscription_number}} expires in 60 days',
    bodyHtml: `<p>Dear {{customer_name}},</p>
<p>This is a friendly reminder that your subscription <strong>{{subscription_number}}</strong> ({{item_name}}) expires on <strong>{{end_date}}</strong>.</p>
<p>Please contact us to plan renewal.</p>`,
    availablePlaceholders: ['customer_name', 'subscription_number', 'item_name', 'end_date'],
  },
  {
    templateKey: 'renewal_reminder_30',
    templateName: 'Renewal Reminder — 30 days',
    category: 'subscription' as const,
    subject: 'Renewal due: {{subscription_number}} expires in 30 days',
    bodyHtml: `<p>Dear {{customer_name}},</p>
<p>Your subscription <strong>{{subscription_number}}</strong> expires on <strong>{{end_date}}</strong> (30 days from today).</p>
<p>Reach out to lock in renewal pricing.</p>`,
    availablePlaceholders: ['customer_name', 'subscription_number', 'end_date'],
  },
  {
    templateKey: 'renewal_reminder_15',
    templateName: 'Renewal Reminder — 15 days',
    category: 'subscription' as const,
    subject: 'Action needed: {{subscription_number}} expires in 15 days',
    bodyHtml: `<p>Dear {{customer_name}},</p>
<p>Your subscription <strong>{{subscription_number}}</strong> expires on <strong>{{end_date}}</strong> — just 15 days away.</p>
<p>Please confirm renewal to avoid service interruption.</p>`,
    availablePlaceholders: ['customer_name', 'subscription_number', 'end_date'],
  },
  {
    templateKey: 'renewal_reminder_7',
    templateName: 'Renewal Reminder — 7 days (Urgent)',
    category: 'subscription' as const,
    subject: 'Urgent: {{subscription_number}} expires in 7 days',
    bodyHtml: `<p>Dear {{customer_name}},</p>
<p><strong>Urgent:</strong> Your subscription <strong>{{subscription_number}}</strong> expires in 7 days on <strong>{{end_date}}</strong>.</p>
<p>Renew now to avoid service disruption.</p>`,
    availablePlaceholders: ['customer_name', 'subscription_number', 'end_date'],
  },
  {
    templateKey: 'welcome_post_conversion',
    templateName: 'Welcome Email (Post-Conversion)',
    category: 'customer' as const,
    subject: 'Welcome to {{company_name}}, {{customer_name}}!',
    bodyHtml: `<p>Dear {{customer_name}},</p>
<p>Welcome aboard! Your account has been activated and your subscription <strong>{{subscription_number}}</strong> is now live.</p>
<p>Reach out anytime — we are here to help.</p>`,
    availablePlaceholders: ['customer_name', 'company_name', 'subscription_number'],
  },
  {
    templateKey: 'conversion_failed_admin',
    templateName: 'Conversion Failed Alert (Admin)',
    category: 'system' as const,
    subject: 'ALERT: Lead conversion failed for {{lead_name}}',
    bodyHtml: `<p>Lead conversion failed.</p>
<ul>
<li>Lead: {{lead_name}} ({{lead_number}})</li>
<li>Reason: {{error_message}}</li>
<li>Step: {{failed_step}}</li>
<li>Retry count: {{retry_count}}</li>
</ul>
<p><a href="{{conversion_log_link}}">View conversion log</a></p>`,
    availablePlaceholders: ['lead_name', 'lead_number', 'error_message', 'failed_step', 'retry_count', 'conversion_log_link'],
  },
];

async function seedEmailTemplates() {
  let created = 0;
  for (const t of EMAIL_TEMPLATES) {
    const existing = await prisma.emailTemplate.findFirst({
      where: { templateKey: t.templateKey, organizationId: null, language: 'en' },
    });
    if (!existing) {
      await prisma.emailTemplate.create({
        data: {
          templateKey: t.templateKey,
          templateName: t.templateName,
          category: t.category,
          language: 'en',
          subject: t.subject,
          bodyHtml: t.bodyHtml,
          isSystem: true,
          availablePlaceholders: t.availablePlaceholders,
        },
      });
      created++;
    }
  }
  console.log(`  ✓ ${created} email templates created (${EMAIL_TEMPLATES.length - created} already present)`);
}

async function main() {
  console.log('🌱 Seeding database...');

  console.log('• Defaults (app_settings + master_data_lists)');
  await runDefaultsSql();

  console.log('• Email templates');
  await seedEmailTemplates();

  console.log('• Bootstrap admin user');
  await createBootstrapAdmin();

  console.log('✓ Seed complete.');
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
