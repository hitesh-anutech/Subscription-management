-- Migration 0007: Add google_reseller_email to domains
ALTER TABLE "domains"
  ADD COLUMN IF NOT EXISTS "google_reseller_email" VARCHAR(255);
