-- Migration 0006: Add 'google' to allowed app_settings categories
ALTER TABLE "app_settings"
  DROP CONSTRAINT IF EXISTS "chk_app_settings_category";

ALTER TABLE "app_settings"
  ADD CONSTRAINT "chk_app_settings_category" CHECK (
    category IN ('quick_quote', 'subscription', 'lead', 'tax', 'email',
                 'notification', 'system', 'security', 'localization', 'general',
                 'zoho', 'conversion', 'google')
  );
