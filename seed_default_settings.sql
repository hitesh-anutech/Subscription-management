-- =====================================================================
-- Subscription Management Tool — Default Settings Seed
-- =====================================================================
-- Version       : 1.0  (aligned with schema.sql v1.2 and
--                       01_OPEN_QUESTIONS_RESOLUTION.md)
-- Date          : 15 May 2026
-- Author        : Hitesh (Excel Technologies)
--
-- Purpose:
--   Populates app_settings with the 18+ decisions captured in
--   01_OPEN_QUESTIONS_RESOLUTION.md, plus seeds master_data_lists
--   (lead sources, industries, lost reasons, GST rates, billing cycles)
--   and a minimal set of system email_templates.
--
--   Without this file, background jobs (renewal reminders, lead
--   auto-archive, webhook retries, conversion retries) would read NULL
--   on first run.
--
-- Usage:
--   psql -U <user> -d <database> -f seed_default_settings.sql
--
-- Idempotency:
--   All INSERTs use ON CONFLICT DO NOTHING so this file can be re-run
--   safely. To FORCE update, run with --set FORCE_UPDATE=1 (see bottom).
-- =====================================================================


-- =====================================================================
-- 1. APP_SETTINGS  — Global key-value runtime configuration
-- =====================================================================

INSERT INTO app_settings (category, setting_key, setting_value, value_type, description, is_system) VALUES

-- ---------------------------------------------------------------------
-- Quick Quote settings (PRD §5A.3.2)
-- ---------------------------------------------------------------------
('quick_quote', 'default_validity_days', '15'::jsonb, 'number',
 'Default validity period for new quick quotes, in days (Decision Q1.1).', TRUE),

('quick_quote', 'public_token_expiry_days', '30'::jsonb, 'number',
 'Public quote token expires 30 days after quote_date — outlives validity by 15 days for grace viewing (Decision Q5.10).', TRUE),

('quick_quote', 'number_format', '"QQ-YYYY-NNNN"'::jsonb, 'string',
 'Quote numbering format (Decision Q5.1). DB function generate_quote_number() implements this.', TRUE),

('quick_quote', 'lead_number_format', '"LD-YYYY-NNNN"'::jsonb, 'string',
 'Lead numbering format (Decision Q5.2).', TRUE),

('quick_quote', 'subscription_number_format', '"SUB-YYYY-NNNN"'::jsonb, 'string',
 'Subscription numbering format (Decision Q5.3).', TRUE),

('quick_quote', 'auto_expire_action', '"mark_expired"'::jsonb, 'string',
 'Action when a quote crosses validity: mark_expired | send_reminder.', TRUE),

('quick_quote', 'max_discount_percent', '50'::jsonb, 'number',
 'Maximum discount percentage allowed on a quote line item.', TRUE),

-- ---------------------------------------------------------------------
-- Subscription lifecycle (PRD §5A.3.5)
-- ---------------------------------------------------------------------
('subscription', 'renewal_reminder_days', '[60, 30, 15, 7]'::jsonb, 'array',
 'Days before subscription end_date to send renewal reminders (Decision Q1.2).', TRUE),

('subscription', 'expiry_grace_days', '60'::jsonb, 'number',
 'Days after end_date a subscription remains in "Expired" before auto-mark Inactive (Decision Q1.4).', TRUE),

('subscription', 'auto_renew_default', 'false'::jsonb, 'boolean',
 'Default value of auto_renew flag when a new subscription is created.', TRUE),

('subscription', 'prorata_method', '"daily"'::jsonb, 'string',
 'Pro-rata calculation method: daily | monthly (Decision Q5.9).', TRUE),

('subscription', 'prorata_rounding', '"nearest"'::jsonb, 'string',
 'Rounding rule for pro-rata amounts: nearest | up | down.', TRUE),

-- ---------------------------------------------------------------------
-- Lead management (PRD §5A.3.6)
-- ---------------------------------------------------------------------
('lead', 'auto_archive_days', '180'::jsonb, 'number',
 'Days of inactivity after which a lead is auto-archived (Decision Q1.3).', TRUE),

('lead', 'duplicate_detection', '"warn"'::jsonb, 'string',
 'Behavior on duplicate email at lead creation: warn | block | allow.', TRUE),

('lead', 'assignment_method', '"manual"'::jsonb, 'string',
 'Default lead assignment method: manual | round_robin.', TRUE),

-- ---------------------------------------------------------------------
-- Tax & GST (PRD §5A.3.7)
-- ---------------------------------------------------------------------
('tax', 'default_gst_rate', '18'::jsonb, 'number',
 'Default GST rate for new line items, as a percentage (Decision Q5.4).', TRUE),

('tax', 'tax_mode', '"exclusive"'::jsonb, 'string',
 'Tax-exclusive vs inclusive pricing default (Decision Q5.5).', TRUE),

('tax', 'reverse_charge_enabled', 'false'::jsonb, 'boolean',
 'Apply Reverse Charge Mechanism (RCM) by default.', TRUE),

-- ---------------------------------------------------------------------
-- Localization (PRD §5A.3.12 — Phase 2 except defaults)
-- ---------------------------------------------------------------------
('localization', 'currency', '"INR"'::jsonb, 'string',
 'Base currency for the app (Decision Q5.6 — INR only in Phase 1).', TRUE),

('localization', 'timezone', '"Asia/Kolkata"'::jsonb, 'string',
 'Default timezone for date/time display and cron schedules (Decision Q5.7).', TRUE),

('localization', 'date_format', '"DD/MM/YYYY"'::jsonb, 'string',
 'Default date display format (Decision Q5.8).', TRUE),

('localization', 'number_format', '"indian_lakhs"'::jsonb, 'string',
 'Number grouping format: indian_lakhs | international.', TRUE),

-- ---------------------------------------------------------------------
-- Zoho integration (PRD §5A.3.1 + Zoho Integration Spec)
-- ---------------------------------------------------------------------
('zoho', 'api_rate_limit_per_min', '80'::jsonb, 'number',
 'Zoho API throttle, requests per minute per org. Zoho hard limit is 100/min (Decision Q4.5).', TRUE),

('zoho', 'webhook_max_retries', '5'::jsonb, 'number',
 'Maximum retries for failed webhook event processing (Decision Q4.4).', TRUE),

('zoho', 'webhook_retry_intervals_seconds', '[60, 300, 1800, 7200, 86400]'::jsonb, 'array',
 'Exponential backoff intervals for webhook retry: 1m, 5m, 30m, 2h, 24h (Decision Q4.4).', TRUE),

('zoho', 'daily_full_sync_cron', '"0 3 * * *"'::jsonb, 'string',
 'Cron expression for the daily backup full sync (3 AM IST by default).', TRUE),

('zoho', 'daily_sync_entities', '["customers", "items", "estimates", "invoices", "payments"]'::jsonb, 'array',
 'Which Zoho entities are part of the daily sync. Removing items reduces API quota use.', TRUE),

-- ---------------------------------------------------------------------
-- Conversion (lead → customer)  (PRD §9 / Decision Q1.10)
-- ---------------------------------------------------------------------
('conversion', 'max_auto_retries', '3'::jsonb, 'number',
 'Max auto-retry attempts for a failed lead-conversion job (Decision Q1.10).', TRUE),

('conversion', 'retry_intervals_seconds', '[5, 30, 300]'::jsonb, 'array',
 'Backoff intervals for conversion retry: 5s, 30s, 5m (Decision Q1.10).', TRUE),

('conversion', 'auto_convert_on_accept', 'false'::jsonb, 'boolean',
 'If true, conversion job triggers automatically on quote acceptance. If false, sales user must confirm manually (Decision Q1.5).', TRUE),

-- ---------------------------------------------------------------------
-- Security (PRD §5A.3.10 — Phase 2 RBAC; MVP enforces defaults)
-- ---------------------------------------------------------------------
('security', 'password_min_length', '12'::jsonb, 'number',
 'Minimum password length for local credentials (Decision Q6.3).', TRUE),

('security', 'password_require_mixed_case', 'true'::jsonb, 'boolean',
 'Require both upper and lower case in passwords.', TRUE),

('security', 'password_require_number', 'true'::jsonb, 'boolean',
 'Require at least one digit in passwords.', TRUE),

('security', 'password_require_symbol', 'true'::jsonb, 'boolean',
 'Require at least one symbol in passwords.', TRUE),

('security', 'session_idle_timeout_hours', '24'::jsonb, 'number',
 'Idle hours before a session expires (Decision Q6.4).', TRUE),

('security', 'failed_login_lockout_attempts', '5'::jsonb, 'number',
 'Failed login attempts before account is locked.', TRUE),

('security', 'failed_login_lockout_minutes', '15'::jsonb, 'number',
 'Lockout duration in minutes after exceeding failed_login_lockout_attempts.', TRUE),

-- ---------------------------------------------------------------------
-- Notifications (PRD §5A.3.8)
-- ---------------------------------------------------------------------
('notification', 'channel_inapp_enabled', 'true'::jsonb, 'boolean',
 'Show in-app notifications.', TRUE),

('notification', 'channel_email_enabled', 'true'::jsonb, 'boolean',
 'Send email notifications.', TRUE),

('notification', 'digest_mode', '"realtime"'::jsonb, 'string',
 'Notification delivery mode: realtime | daily_digest.', TRUE),

('notification', 'quiet_hours_start', '"22:00"'::jsonb, 'string',
 'Quiet hours start (HH:MM, IST).', TRUE),

('notification', 'quiet_hours_end', '"08:00"'::jsonb, 'string',
 'Quiet hours end (HH:MM, IST).', TRUE)

ON CONFLICT (category, setting_key) DO NOTHING;


-- =====================================================================
-- 2. MASTER_DATA_LISTS — Dropdown options
-- =====================================================================

-- ---------- Lead Sources ----------
INSERT INTO master_data_lists (list_type, item_value, item_label, display_order, is_system) VALUES
('lead_source', 'website',     'Website',     1, TRUE),
('lead_source', 'referral',    'Referral',    2, TRUE),
('lead_source', 'cold_call',   'Cold Call',   3, TRUE),
('lead_source', 'linkedin',    'LinkedIn',    4, TRUE),
('lead_source', 'trade_show',  'Trade Show',  5, TRUE),
('lead_source', 'partner',     'Partner',     6, TRUE),
('lead_source', 'inbound',     'Inbound Inquiry', 7, TRUE),
('lead_source', 'outbound',    'Outbound Campaign', 8, TRUE),
('lead_source', 'other',       'Other',       99, TRUE)
ON CONFLICT (list_type, item_value) DO NOTHING;

-- ---------- Industries ----------
INSERT INTO master_data_lists (list_type, item_value, item_label, display_order, is_system) VALUES
('industry', 'it_services',        'IT Services',                1, TRUE),
('industry', 'manufacturing',      'Manufacturing',              2, TRUE),
('industry', 'retail',             'Retail / E-commerce',        3, TRUE),
('industry', 'healthcare',         'Healthcare',                 4, TRUE),
('industry', 'education',          'Education',                  5, TRUE),
('industry', 'finance',            'Finance / Banking',          6, TRUE),
('industry', 'real_estate',        'Real Estate',                7, TRUE),
('industry', 'logistics',          'Logistics / Transportation', 8, TRUE),
('industry', 'media',              'Media / Entertainment',      9, TRUE),
('industry', 'consulting',         'Consulting',                10, TRUE),
('industry', 'non_profit',         'Non-Profit',                11, TRUE),
('industry', 'government',         'Government',                12, TRUE),
('industry', 'other',              'Other',                     99, TRUE)
ON CONFLICT (list_type, item_value) DO NOTHING;

-- ---------- Lost Reasons ----------
INSERT INTO master_data_lists (list_type, item_value, item_label, display_order, is_system) VALUES
('lost_reason', 'budget',          'Budget',                 1, TRUE),
('lost_reason', 'competitor',      'Lost to Competitor',     2, TRUE),
('lost_reason', 'timing',          'Timing',                 3, TRUE),
('lost_reason', 'no_decision',     'No Decision Made',       4, TRUE),
('lost_reason', 'not_qualified',   'Not Qualified',          5, TRUE),
('lost_reason', 'no_response',     'No Response',            6, TRUE),
('lost_reason', 'requirement_change','Requirement Changed',  7, TRUE),
('lost_reason', 'other',           'Other',                 99, TRUE)
ON CONFLICT (list_type, item_value) DO NOTHING;

-- ---------- GST Rates ----------
INSERT INTO master_data_lists (list_type, item_value, item_label, display_order, is_system) VALUES
('gst_rate', '0',  '0% (Exempt / Nil)',  1, TRUE),
('gst_rate', '5',  '5%',                 2, TRUE),
('gst_rate', '12', '12%',                3, TRUE),
('gst_rate', '18', '18% (Standard)',     4, TRUE),
('gst_rate', '28', '28%',                5, TRUE)
ON CONFLICT (list_type, item_value) DO NOTHING;

-- ---------- Billing Cycles ----------
INSERT INTO master_data_lists (list_type, item_value, item_label, display_order, is_system) VALUES
('billing_cycle', 'monthly',     'Monthly',          1, TRUE),
('billing_cycle', 'quarterly',   'Quarterly',        2, TRUE),
('billing_cycle', 'half_yearly', 'Half-Yearly',      3, TRUE),
('billing_cycle', 'annual',      'Annual',           4, TRUE),
('billing_cycle', 'biennial',    'Biennial (2 yr)',  5, TRUE),
('billing_cycle', 'triennial',   'Triennial (3 yr)', 6, TRUE),
('billing_cycle', 'one_time',    'One-Time',         7, TRUE)
ON CONFLICT (list_type, item_value) DO NOTHING;

-- ---------- Currencies (Phase 1 INR-only; INR seeded as default) ----------
INSERT INTO master_data_lists (list_type, item_value, item_label, display_order, is_system, is_active) VALUES
('currency', 'INR', 'Indian Rupee (₹)', 1, TRUE, TRUE),
('currency', 'USD', 'US Dollar ($)',    2, TRUE, FALSE),  -- inactive until Phase 2 multi-currency
('currency', 'EUR', 'Euro (€)',         3, TRUE, FALSE),
('currency', 'GBP', 'British Pound (£)', 4, TRUE, FALSE)
ON CONFLICT (list_type, item_value) DO NOTHING;

-- ---------- Indian States (GST state codes — required for intra/inter-state determination) ----------
INSERT INTO master_data_lists (list_type, item_value, item_label, display_order, is_system) VALUES
('state', '01', 'Jammu & Kashmir',        1,  TRUE),
('state', '02', 'Himachal Pradesh',       2,  TRUE),
('state', '03', 'Punjab',                 3,  TRUE),
('state', '04', 'Chandigarh',             4,  TRUE),
('state', '05', 'Uttarakhand',            5,  TRUE),
('state', '06', 'Haryana',                6,  TRUE),
('state', '07', 'Delhi',                  7,  TRUE),
('state', '08', 'Rajasthan',              8,  TRUE),
('state', '09', 'Uttar Pradesh',          9,  TRUE),
('state', '10', 'Bihar',                  10, TRUE),
('state', '11', 'Sikkim',                 11, TRUE),
('state', '12', 'Arunachal Pradesh',      12, TRUE),
('state', '13', 'Nagaland',               13, TRUE),
('state', '14', 'Manipur',                14, TRUE),
('state', '15', 'Mizoram',                15, TRUE),
('state', '16', 'Tripura',                16, TRUE),
('state', '17', 'Meghalaya',              17, TRUE),
('state', '18', 'Assam',                  18, TRUE),
('state', '19', 'West Bengal',            19, TRUE),
('state', '20', 'Jharkhand',              20, TRUE),
('state', '21', 'Odisha',                 21, TRUE),
('state', '22', 'Chhattisgarh',           22, TRUE),
('state', '23', 'Madhya Pradesh',         23, TRUE),
('state', '24', 'Gujarat',                24, TRUE),
('state', '27', 'Maharashtra',            27, TRUE),
('state', '29', 'Karnataka',              29, TRUE),
('state', '30', 'Goa',                    30, TRUE),
('state', '32', 'Kerala',                 32, TRUE),
('state', '33', 'Tamil Nadu',             33, TRUE),
('state', '34', 'Puducherry',             34, TRUE),
('state', '36', 'Telangana',              36, TRUE),
('state', '37', 'Andhra Pradesh',         37, TRUE),
('state', '38', 'Ladakh',                 38, TRUE)
ON CONFLICT (list_type, item_value) DO NOTHING;


-- =====================================================================
-- 3. EMAIL_TEMPLATES — Minimal system templates
-- =====================================================================
-- These are starter templates; full template editor in PRD §5A.3.4.
-- All placeholders use {{handlebars}} syntax.

INSERT INTO email_templates
    (template_key, template_name, category, language, subject, body_html,
     is_system, available_placeholders)
VALUES

('quote_sent', 'Quote Sent to Customer', 'quote', 'en',
 'Your quote {{quote_number}} from {{company_name}}',
 '<p>Dear {{customer_name}},</p>'
 '<p>Thank you for your interest. Please find attached quote <strong>{{quote_number}}</strong>, '
 'valid until {{validity_date}}.</p>'
 '<p>Total amount: <strong>{{total_amount}}</strong></p>'
 '<p>You can view, accept, or reject this quote online: <a href="{{quote_link}}">{{quote_link}}</a></p>'
 '<p>Regards,<br>{{sender_name}}<br>{{company_name}}</p>',
 TRUE,
 '["customer_name", "quote_number", "validity_date", "total_amount", "quote_link", "sender_name", "company_name"]'::jsonb),

('quote_viewed', 'Quote Viewed Notification (Internal)', 'quote', 'en',
 'Quote {{quote_number}} viewed by {{customer_name}}',
 '<p>Hi {{sender_name}},</p>'
 '<p>Quote <strong>{{quote_number}}</strong> sent to {{customer_name}} '
 'was just viewed (view #{{view_count}}).</p>',
 TRUE,
 '["sender_name", "quote_number", "customer_name", "view_count"]'::jsonb),

('quote_accepted', 'Quote Accepted Notification (Internal)', 'quote', 'en',
 'Quote {{quote_number}} accepted by {{customer_name}}',
 '<p>Hi {{sender_name}},</p>'
 '<p>Quote <strong>{{quote_number}}</strong> was just accepted by {{customer_name}}.</p>'
 '<p>Next step: <a href="{{conversion_link}}">Convert to Customer</a> in Zoho.</p>',
 TRUE,
 '["sender_name", "quote_number", "customer_name", "conversion_link"]'::jsonb),

('renewal_reminder_60', 'Renewal Reminder — 60 days', 'subscription', 'en',
 'Your subscription {{subscription_number}} expires in 60 days',
 '<p>Dear {{customer_name}},</p>'
 '<p>This is a friendly reminder that your subscription '
 '<strong>{{subscription_number}}</strong> ({{item_name}}) expires on '
 '<strong>{{end_date}}</strong>.</p>'
 '<p>Please contact us to plan renewal.</p>',
 TRUE,
 '["customer_name", "subscription_number", "item_name", "end_date"]'::jsonb),

('renewal_reminder_30', 'Renewal Reminder — 30 days', 'subscription', 'en',
 'Renewal due: {{subscription_number}} expires in 30 days',
 '<p>Dear {{customer_name}},</p>'
 '<p>Your subscription <strong>{{subscription_number}}</strong> '
 'expires on <strong>{{end_date}}</strong> (30 days from today).</p>'
 '<p>Reach out to lock in renewal pricing.</p>',
 TRUE,
 '["customer_name", "subscription_number", "end_date"]'::jsonb),

('renewal_reminder_15', 'Renewal Reminder — 15 days', 'subscription', 'en',
 'Action needed: {{subscription_number}} expires in 15 days',
 '<p>Dear {{customer_name}},</p>'
 '<p>Your subscription <strong>{{subscription_number}}</strong> '
 'expires on <strong>{{end_date}}</strong> — just 15 days away.</p>'
 '<p>Please confirm renewal to avoid service interruption.</p>',
 TRUE,
 '["customer_name", "subscription_number", "end_date"]'::jsonb),

('renewal_reminder_7', 'Renewal Reminder — 7 days (Urgent)', 'subscription', 'en',
 'Urgent: {{subscription_number}} expires in 7 days',
 '<p>Dear {{customer_name}},</p>'
 '<p><strong>Urgent:</strong> Your subscription '
 '<strong>{{subscription_number}}</strong> expires in 7 days on '
 '<strong>{{end_date}}</strong>.</p>'
 '<p>Renew now to avoid service disruption.</p>',
 TRUE,
 '["customer_name", "subscription_number", "end_date"]'::jsonb),

('payment_received', 'Payment Received Confirmation', 'payment', 'en',
 'Payment received — {{invoice_number}}',
 '<p>Dear {{customer_name}},</p>'
 '<p>We have received your payment of <strong>{{amount}}</strong> '
 'against invoice <strong>{{invoice_number}}</strong>. Thank you.</p>',
 TRUE,
 '["customer_name", "amount", "invoice_number"]'::jsonb),

('welcome_post_conversion', 'Welcome Email (Post-Conversion)', 'customer', 'en',
 'Welcome to {{company_name}}, {{customer_name}}!',
 '<p>Dear {{customer_name}},</p>'
 '<p>Welcome aboard! Your account has been activated and your subscription '
 '<strong>{{subscription_number}}</strong> is now live.</p>'
 '<p>Reach out anytime — we are here to help.</p>',
 TRUE,
 '["customer_name", "company_name", "subscription_number"]'::jsonb),

('conversion_failed_admin', 'Conversion Failed Alert (Admin)', 'system', 'en',
 'ALERT: Lead conversion failed for {{lead_name}}',
 '<p>Lead conversion failed.</p>'
 '<ul>'
 '<li>Lead: {{lead_name}} ({{lead_number}})</li>'
 '<li>Reason: {{error_message}}</li>'
 '<li>Step: {{failed_step}}</li>'
 '<li>Retry count: {{retry_count}}</li>'
 '</ul>'
 '<p><a href="{{conversion_log_link}}">View conversion log</a></p>',
 TRUE,
 '["lead_name", "lead_number", "error_message", "failed_step", "retry_count", "conversion_log_link"]'::jsonb)

ON CONFLICT (template_key, language, organization_id) DO NOTHING;


-- =====================================================================
-- 4. VERIFICATION
-- =====================================================================
-- After running, sanity-check key seeded values:

-- SELECT category, setting_key, setting_value
-- FROM app_settings
-- WHERE is_system = TRUE
-- ORDER BY category, setting_key;

-- SELECT list_type, COUNT(*) AS items
-- FROM master_data_lists
-- WHERE is_system = TRUE
-- GROUP BY list_type
-- ORDER BY list_type;

-- SELECT template_key, template_name
-- FROM email_templates
-- WHERE is_system = TRUE
-- ORDER BY template_key;


-- =====================================================================
-- END OF SEED
-- =====================================================================
-- Expected totals after a clean install + seed:
--   app_settings rows:        40+
--   master_data_lists rows:   80+  (sources/industries/lost-reasons/gst/cycles/currencies/states)
--   email_templates rows:     10   (system, English, global)
-- =====================================================================
