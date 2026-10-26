-- Migration 0009: Add customer_uid to google_reseller_subscriptions
-- Customer UID is not available via API; imported from Google Console CSV download.
-- Used to generate working Partner Sales Console links.
ALTER TABLE "google_reseller_subscriptions"
  ADD COLUMN IF NOT EXISTS "customer_uid" VARCHAR(100);

CREATE INDEX IF NOT EXISTS "grs_customer_uid_idx" ON "google_reseller_subscriptions" ("customer_uid");
