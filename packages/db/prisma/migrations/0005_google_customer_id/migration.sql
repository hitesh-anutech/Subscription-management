-- Migration 0005: Add Google Customer ID fields to domains table
-- Stores the Google Workspace Reseller customer ID fetched via Google Reseller API

ALTER TABLE "domains"
  ADD COLUMN IF NOT EXISTS "google_customer_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "google_synced_at"   TIMESTAMPTZ;

COMMENT ON COLUMN "domains"."google_customer_id" IS 'Google Workspace Reseller unique customer ID (e.g. C01abc123)';
COMMENT ON COLUMN "domains"."google_synced_at"   IS 'Timestamp of last successful Google Reseller API sync';
