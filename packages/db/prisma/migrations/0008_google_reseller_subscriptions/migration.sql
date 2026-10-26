-- Migration 0008: Google Reseller Subscriptions reconciliation table

CREATE TABLE "google_reseller_subscriptions" (
  "id"                      UUID        NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"         UUID        NOT NULL,

  -- From Google /subscriptions API
  "google_subscription_id"  VARCHAR(100) NOT NULL,
  "customer_id"             VARCHAR(100) NOT NULL,
  "customer_domain"         VARCHAR(255) NOT NULL,
  "sku_id"                  VARCHAR(100) NOT NULL,
  "sku_name"                VARCHAR(255),
  "google_status"           VARCHAR(50)  NOT NULL,
  "plan_name"               VARCHAR(100),
  "is_commitment_plan"      BOOLEAN,
  "seats_licensed"          INTEGER,
  "seats_maximum"           INTEGER,
  "renewal_type"            VARCHAR(100),
  "is_in_trial"             BOOLEAN,
  "trial_end_time"          TIMESTAMPTZ,
  "google_creation_time"    TIMESTAMPTZ,
  "suspension_reasons"      TEXT[]       NOT NULL DEFAULT '{}',
  "reseller_slot"           INTEGER      NOT NULL,
  "reseller_email"          VARCHAR(255),
  "subscription_fetched_at" TIMESTAMPTZ,

  -- From Google /customers/{customerId} API
  "org_name"                VARCHAR(255),
  "contact_name"            VARCHAR(255),
  "alternate_email"         VARCHAR(255),
  "country_code"            VARCHAR(10),
  "customer_creation_time"  TIMESTAMPTZ,
  "resource_ui_url"         VARCHAR(500),
  "customer_fetched_at"     TIMESTAMPTZ,

  -- Manually entered alias domains for reconciliation fallback
  "additional_domains"      TEXT[]       NOT NULL DEFAULT '{}',

  -- Reconciliation
  "reconciliation_status"   VARCHAR(20)  NOT NULL DEFAULT 'not_matched',
  "reconciliation_flags"    TEXT[]       NOT NULL DEFAULT '{}',
  "matched_domain_id"       UUID,
  "matched_subscription_id" UUID,
  "matched_domain_name"     VARCHAR(255),
  "app_seats"               INTEGER,
  "reconciled_at"           TIMESTAMPTZ,

  "created_at"              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT "google_reseller_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_grs_org_sub_id" UNIQUE ("organization_id", "google_subscription_id"),
  CONSTRAINT "grs_organization_fk" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "grs_matched_domain_fk" FOREIGN KEY ("matched_domain_id")
    REFERENCES "domains"("id") ON DELETE SET NULL,
  CONSTRAINT "grs_matched_subscription_fk" FOREIGN KEY ("matched_subscription_id")
    REFERENCES "subscriptions"("id") ON DELETE SET NULL
);

CREATE INDEX "grs_org_recon_status_idx" ON "google_reseller_subscriptions" ("organization_id", "reconciliation_status");
CREATE INDEX "grs_customer_domain_idx"  ON "google_reseller_subscriptions" ("customer_domain");
CREATE INDEX "grs_google_status_idx"    ON "google_reseller_subscriptions" ("google_status");
CREATE INDEX "grs_matched_domain_idx"   ON "google_reseller_subscriptions" ("matched_domain_id");
CREATE INDEX "grs_matched_sub_idx"      ON "google_reseller_subscriptions" ("matched_subscription_id");
