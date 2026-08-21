-- =====================================================================
-- Subscription Management Tool — PostgreSQL Schema
-- =====================================================================
-- Version       : 1.0 (aligned with PRD v4.0)
-- Date          : 14 May 2026
-- Author        : Hitesh (Excel Technologies)
-- Database      : PostgreSQL 15+
-- Target        : Production-ready schema for Central App
--
-- Description:
--   Centralized application schema that works alongside Zoho Books.
--   Zoho Books remains the master for customers/items/quotes/invoices/payments.
--   This schema stores Subscription lifecycle, Leads, Quick Quotes,
--   Domain mapping, Renewal history, and integration metadata.
--
-- Sections:
--   1. Extensions
--   2. Helper Functions
--   3. Sequences for Numbering (Lead, Quote, Subscription)
--   4. Core Tables (in dependency order)
--      4.1  organizations
--      4.2  zoho_cache
--      4.3  leads
--      4.4  domains
--      4.5  quick_quotes
--      4.6  quick_quote_items
--      4.7  subscriptions
--      4.8  renewal_history
--      4.9  lead_conversions
--      4.10 webhook_events
--   5. Triggers for Core Tables (updated_at auto-update)
--   6. Table & Column Comments — Core Tables
--   7. Settings & Configuration Tables (v1.1 addendum — PRD Section 5A)
--      7.1  app_settings
--      7.2  org_settings
--      7.3  email_templates
--      7.4  master_data_lists
--      7.5  user_preferences
--   8. Triggers for Settings Tables
--   9. Table & Column Comments — Settings Tables
--   10. Authentication & Audit Tables (v1.2 addendum)
--      10.1 users               (NextAuth.js compatible)
--      10.2 accounts            (OAuth provider linkage)
--      10.3 sessions            (active user sessions)
--      10.4 verification_tokens (email verification / magic links)
--      10.5 settings_audit_log  (PRD §5A.1 audit requirement)
--   11. Foreign Key Additions (link previously dangling user_id columns)
--   12. Triggers & Comments for Auth/Audit Tables
--
-- Usage (fresh install):
--   psql -U <user> -d <database> -f schema.sql
--   psql -U <user> -d <database> -f seed_default_settings.sql
--
-- Note: For development reset, uncomment the DROP block at the top.
-- =====================================================================


-- =====================================================================
-- OPTIONAL: Development Reset (DROP ALL — uncomment for fresh setup)
-- =====================================================================
-- -- Auth/Audit tables (drop first due to FK dependencies)
-- DROP TABLE IF EXISTS settings_audit_log   CASCADE;
-- DROP TABLE IF EXISTS verification_tokens  CASCADE;
-- DROP TABLE IF EXISTS sessions             CASCADE;
-- DROP TABLE IF EXISTS accounts             CASCADE;
-- DROP TABLE IF EXISTS users                CASCADE;
-- -- Settings tables
-- DROP TABLE IF EXISTS user_preferences     CASCADE;
-- DROP TABLE IF EXISTS master_data_lists    CASCADE;
-- DROP TABLE IF EXISTS email_templates      CASCADE;
-- DROP TABLE IF EXISTS org_settings         CASCADE;
-- DROP TABLE IF EXISTS app_settings         CASCADE;
-- -- Core tables
-- DROP TABLE IF EXISTS webhook_events       CASCADE;
-- DROP TABLE IF EXISTS lead_conversions     CASCADE;
-- DROP TABLE IF EXISTS renewal_history      CASCADE;
-- DROP TABLE IF EXISTS subscriptions        CASCADE;
-- DROP TABLE IF EXISTS quick_quote_items    CASCADE;
-- DROP TABLE IF EXISTS quick_quotes         CASCADE;
-- DROP TABLE IF EXISTS domains              CASCADE;
-- DROP TABLE IF EXISTS leads                CASCADE;
-- DROP TABLE IF EXISTS zoho_cache           CASCADE;
-- DROP TABLE IF EXISTS organizations        CASCADE;
-- -- Sequences and functions
-- DROP SEQUENCE IF EXISTS lead_seq;
-- DROP SEQUENCE IF EXISTS quote_seq;
-- DROP SEQUENCE IF EXISTS subscription_seq;
-- DROP FUNCTION IF EXISTS set_updated_at();
-- DROP FUNCTION IF EXISTS generate_lead_number();
-- DROP FUNCTION IF EXISTS generate_quote_number();
-- DROP FUNCTION IF EXISTS generate_subscription_number();


-- =====================================================================
-- 1. EXTENSIONS
-- =====================================================================

-- gen_random_uuid() for UUID primary keys
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- pg_trgm for fuzzy/trigram text search (used in quick search)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- citext for case-insensitive email comparison (optional but recommended)
CREATE EXTENSION IF NOT EXISTS "citext";


-- =====================================================================
-- 2. HELPER FUNCTIONS
-- =====================================================================

-- ---------------------------------------------------------------------
-- set_updated_at: Trigger function to auto-update updated_at on row change
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- Numbering functions: Generate human-readable identifiers
-- Format: <PREFIX>-<YEAR>-<4-digit-sequence>
-- Example: LD-2026-0001, QQ-2026-0042, SUB-2026-0123
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION generate_lead_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'LD-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
           LPAD(nextval('lead_seq')::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'QQ-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
           LPAD(nextval('quote_seq')::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_subscription_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'SUB-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
           LPAD(nextval('subscription_seq')::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;


-- =====================================================================
-- 3. SEQUENCES
-- =====================================================================

CREATE SEQUENCE IF NOT EXISTS lead_seq         START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS quote_seq        START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS subscription_seq START 1 INCREMENT 1;


-- =====================================================================
-- 4. TABLES
-- =====================================================================


-- ---------------------------------------------------------------------
-- 4.1  organizations
--      Stores the 4 Zoho Books organizations + their OAuth credentials.
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
    id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        VARCHAR(150) NOT NULL,
    zoho_org_id                 VARCHAR(50)  NOT NULL UNIQUE,
    data_center                 VARCHAR(20)  NOT NULL DEFAULT 'in',
    base_currency               VARCHAR(10)  NOT NULL DEFAULT 'INR',

    -- OAuth credentials (encrypted at application layer before storage)
    access_token_encrypted      TEXT,
    refresh_token_encrypted     TEXT,
    token_expires_at            TIMESTAMPTZ,
    scopes                      TEXT,

    -- Connection health
    connection_status           VARCHAR(30)  NOT NULL DEFAULT 'active',
    last_sync_at                TIMESTAMPTZ,
    is_active                   BOOLEAN      NOT NULL DEFAULT TRUE,

    -- Branding (for Quick Quote PDFs)
    metadata                    JSONB        NOT NULL DEFAULT '{}'::jsonb,

    created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_org_connection_status CHECK (
        connection_status IN ('active', 'expired', 'revoked', 'error', 'disconnected')
    ),
    CONSTRAINT chk_org_data_center CHECK (
        data_center IN ('in', 'com', 'eu', 'com.au', 'jp', 'sa')
    )
);

CREATE INDEX idx_organizations_active     ON organizations(is_active);
CREATE INDEX idx_organizations_zoho_org   ON organizations(zoho_org_id);


-- ---------------------------------------------------------------------
-- 4.2  zoho_cache
--      Lightweight cache of Zoho customers and items for fast list views
--      and quick search. Refreshed via webhooks + daily sync.
-- ---------------------------------------------------------------------
CREATE TABLE zoho_cache (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    entity_type         VARCHAR(20)   NOT NULL,
    zoho_id             VARCHAR(80)   NOT NULL,
    display_name        VARCHAR(250),
    email               CITEXT,
    phone               VARCHAR(50),
    gstin               VARCHAR(30),
    extra               JSONB         NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_zoho_cache_entity UNIQUE (organization_id, entity_type, zoho_id),
    CONSTRAINT chk_zoho_cache_entity_type CHECK (
        entity_type IN ('customer', 'item')
    )
);

CREATE INDEX idx_zoho_cache_org_type      ON zoho_cache(organization_id, entity_type);
CREATE INDEX idx_zoho_cache_email         ON zoho_cache(email) WHERE email IS NOT NULL;
CREATE INDEX idx_zoho_cache_gstin         ON zoho_cache(gstin) WHERE gstin IS NOT NULL;

-- Full-text search index for quick search (name + email + gstin)
CREATE INDEX idx_zoho_cache_search ON zoho_cache USING GIN (
    to_tsvector('english',
        coalesce(display_name, '') || ' ' ||
        coalesce(email::TEXT, '') || ' ' ||
        coalesce(gstin, '')
    )
);

-- Trigram index for fuzzy name search (powers Quick Search autocomplete)
CREATE INDEX idx_zoho_cache_name_trgm ON zoho_cache USING GIN (display_name gin_trgm_ops);


-- ---------------------------------------------------------------------
-- 4.3  leads
--      Prospects / un-converted customers. Lives ONLY in Central App.
--      Pushed to Zoho as customer only on conversion.
-- ---------------------------------------------------------------------
CREATE TABLE leads (
    id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_number                     VARCHAR(50)   NOT NULL UNIQUE DEFAULT generate_lead_number(),

    -- Contact info
    company_name                    VARCHAR(250)  NOT NULL,
    contact_name                    VARCHAR(200),
    email                           CITEXT        NOT NULL,
    phone                           VARCHAR(50),
    designation                     VARCHAR(100),

    -- Address (optional at lead stage, required at conversion)
    billing_address_line1           VARCHAR(250),
    billing_address_line2           VARCHAR(250),
    city                            VARCHAR(100),
    state                           VARCHAR(100),
    state_code                      VARCHAR(10),
    postal_code                     VARCHAR(20),
    country                         VARCHAR(100)  DEFAULT 'India',

    -- Tax info
    gstin                           VARCHAR(30),
    pan                             VARCHAR(30),

    -- Business context
    primary_domain                  VARCHAR(255),
    industry                        VARCHAR(100),
    lead_source                     VARCHAR(100),

    -- Lifecycle
    status                          VARCHAR(30)   NOT NULL DEFAULT 'New',
    assigned_to_user_id             UUID,
    estimated_close_date            DATE,
    estimated_value                 NUMERIC(12,2),

    -- Conversion tracking
    converted_to_zoho_customer_id   VARCHAR(80),
    converted_at                    TIMESTAMPTZ,
    target_organization_id          UUID          REFERENCES organizations(id) ON DELETE SET NULL,
    lost_reason                     VARCHAR(250),

    notes                           TEXT,
    metadata                        JSONB         NOT NULL DEFAULT '{}'::jsonb,

    created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_leads_status CHECK (
        status IN ('New', 'Contacted', 'Quoted', 'Negotiating',
                   'Won', 'Converted', 'Lost', 'Archived')
    ),
    CONSTRAINT chk_leads_conversion_integrity CHECK (
        (status = 'Converted' AND converted_to_zoho_customer_id IS NOT NULL AND converted_at IS NOT NULL)
        OR
        (status <> 'Converted')
    )
);

CREATE INDEX idx_leads_status         ON leads(status);
CREATE INDEX idx_leads_email          ON leads(email);
CREATE INDEX idx_leads_domain         ON leads(primary_domain) WHERE primary_domain IS NOT NULL;
CREATE INDEX idx_leads_assigned       ON leads(assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX idx_leads_close_date     ON leads(estimated_close_date) WHERE status NOT IN ('Converted', 'Lost', 'Archived');
CREATE INDEX idx_leads_zoho_customer  ON leads(converted_to_zoho_customer_id) WHERE converted_to_zoho_customer_id IS NOT NULL;

-- Full-text search index (powers Quick Search across leads)
CREATE INDEX idx_leads_search ON leads USING GIN (
    to_tsvector('english',
        coalesce(company_name, '') || ' ' ||
        coalesce(contact_name, '') || ' ' ||
        coalesce(email::TEXT, '') || ' ' ||
        coalesce(primary_domain, '') || ' ' ||
        coalesce(gstin, '')
    )
);

-- Trigram index for fuzzy company name search
CREATE INDEX idx_leads_company_trgm ON leads USING GIN (company_name gin_trgm_ops);


-- ---------------------------------------------------------------------
-- 4.4  domains
--      Maps a domain to a Zoho customer in a specific Zoho org.
--      Central source of truth for "which org owns this domain".
-- ---------------------------------------------------------------------
CREATE TABLE domains (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_name             VARCHAR(255)  NOT NULL UNIQUE,
    organization_id         UUID          NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    zoho_customer_id        VARCHAR(80)   NOT NULL,
    zoho_customer_name      VARCHAR(250),
    status                  VARCHAR(30)   NOT NULL DEFAULT 'active',
    notes                   TEXT,
    metadata                JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_domains_status CHECK (
        status IN ('active', 'inactive', 'transferred', 'lost')
    )
);

CREATE INDEX idx_domains_org_customer ON domains(organization_id, zoho_customer_id);
CREATE INDEX idx_domains_status       ON domains(status);
CREATE INDEX idx_domains_name_trgm    ON domains USING GIN (domain_name gin_trgm_ops);


-- ---------------------------------------------------------------------
-- 4.5  quick_quotes
--      Quotes for fresh sales (Quote Types 1 & 2).
--      Type 1: Lead-based (customer_type = 'lead')
--      Type 2: Cross-sell to existing customer (customer_type = 'existing')
-- ---------------------------------------------------------------------
CREATE TABLE quick_quotes (
    id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_number                    VARCHAR(50)   NOT NULL UNIQUE DEFAULT generate_quote_number(),

    -- Customer reference (one and only one of lead_id / zoho_customer_id is set)
    customer_type                   VARCHAR(20)   NOT NULL,
    lead_id                         UUID          REFERENCES leads(id) ON DELETE RESTRICT,
    zoho_customer_id                VARCHAR(80),
    zoho_customer_name              VARCHAR(250),

    -- Target Zoho org (resolved upfront for tax calc & branding)
    target_organization_id          UUID          NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

    -- Quote details
    quote_date                      DATE          NOT NULL DEFAULT CURRENT_DATE,
    validity_days                   INTEGER       NOT NULL DEFAULT 15,
    expiry_date                     DATE          NOT NULL,

    -- Pricing (computed from line items)
    subtotal                        NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount                      NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount                    NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency                        VARCHAR(10)   NOT NULL DEFAULT 'INR',

    -- Tax breakdown (India GST context)
    is_intra_state                  BOOLEAN,
    cgst_rate                       NUMERIC(5,2),
    sgst_rate                       NUMERIC(5,2),
    igst_rate                       NUMERIC(5,2),

    -- Lifecycle
    status                          VARCHAR(30)   NOT NULL DEFAULT 'Draft',
    sent_at                         TIMESTAMPTZ,
    viewed_at                       TIMESTAMPTZ,
    view_count                      INTEGER       NOT NULL DEFAULT 0,
    accepted_at                     TIMESTAMPTZ,
    rejected_at                     TIMESTAMPTZ,
    rejection_reason                TEXT,

    -- Public access (Lead-mode only)
    public_token                    VARCHAR(128)  UNIQUE,
    public_token_expires_at         TIMESTAMPTZ,

    -- Content
    terms_and_conditions            TEXT,
    notes_to_customer               TEXT,
    internal_notes                  TEXT,

    -- Revisions
    revision_of_quote_id            UUID          REFERENCES quick_quotes(id) ON DELETE SET NULL,

    -- Zoho integration (populated after push)
    zoho_estimate_id                VARCHAR(80),
    zoho_estimate_number            VARCHAR(80),
    pushed_to_zoho_at               TIMESTAMPTZ,

    -- PDF
    pdf_storage_path                TEXT,
    pdf_generated_at                TIMESTAMPTZ,

    created_by_user_id              UUID,
    created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Integrity constraints
    CONSTRAINT chk_qq_customer_type CHECK (
        customer_type IN ('lead', 'existing')
    ),
    CONSTRAINT chk_qq_status CHECK (
        status IN ('Draft', 'Sent', 'Viewed', 'Accepted', 'Rejected',
                   'Expired', 'Revised', 'Pushed_To_Zoho', 'Cancelled')
    ),
    CONSTRAINT chk_qq_customer_ref CHECK (
        (customer_type = 'lead'     AND lead_id IS NOT NULL  AND zoho_customer_id IS NULL)
        OR
        (customer_type = 'existing' AND zoho_customer_id IS NOT NULL AND lead_id IS NULL)
    ),
    CONSTRAINT chk_qq_expiry_after_date CHECK (expiry_date >= quote_date),
    CONSTRAINT chk_qq_amounts_non_negative CHECK (
        subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0 AND discount_amount >= 0
    )
);

CREATE INDEX idx_qq_lead              ON quick_quotes(lead_id)          WHERE lead_id IS NOT NULL;
CREATE INDEX idx_qq_zoho_customer     ON quick_quotes(zoho_customer_id) WHERE zoho_customer_id IS NOT NULL;
CREATE INDEX idx_qq_target_org        ON quick_quotes(target_organization_id);
CREATE INDEX idx_qq_status            ON quick_quotes(status);
CREATE INDEX idx_qq_public_token      ON quick_quotes(public_token)     WHERE public_token IS NOT NULL;
CREATE INDEX idx_qq_quote_date        ON quick_quotes(quote_date DESC);
CREATE INDEX idx_qq_expiry            ON quick_quotes(expiry_date)      WHERE status IN ('Sent', 'Viewed');
CREATE INDEX idx_qq_zoho_estimate     ON quick_quotes(zoho_estimate_id) WHERE zoho_estimate_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 4.6  quick_quote_items
--      Line items for quick quotes.
-- ---------------------------------------------------------------------
CREATE TABLE quick_quote_items (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    quick_quote_id          UUID          NOT NULL REFERENCES quick_quotes(id) ON DELETE CASCADE,
    line_order              INTEGER       NOT NULL,

    -- Item reference (optional Zoho catalog link, fallback to free-text)
    zoho_item_id            VARCHAR(80),
    item_name               VARCHAR(250)  NOT NULL,
    item_description        TEXT,
    hsn_or_sac              VARCHAR(20),

    -- Pricing
    quantity                NUMERIC(12,2) NOT NULL,
    unit_price              NUMERIC(12,2) NOT NULL,
    discount_percent        NUMERIC(5,2)  NOT NULL DEFAULT 0,
    discount_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_rate                NUMERIC(5,2)  NOT NULL DEFAULT 18,
    line_subtotal           NUMERIC(12,2) NOT NULL,
    line_tax                NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_total              NUMERIC(12,2) NOT NULL,

    -- Subscription context (used when invoice is paid to create subscription)
    is_subscription         BOOLEAN       NOT NULL DEFAULT TRUE,
    billing_cycle           VARCHAR(50),
    service_start_date      DATE,
    service_end_date        DATE,
    primary_domain          VARCHAR(255),

    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_qqi_quantity_positive   CHECK (quantity > 0),
    CONSTRAINT chk_qqi_unit_price_non_neg  CHECK (unit_price >= 0),
    CONSTRAINT chk_qqi_amounts_non_neg     CHECK (
        line_subtotal >= 0 AND line_tax >= 0 AND line_total >= 0
    ),
    CONSTRAINT chk_qqi_discount_range      CHECK (
        discount_percent >= 0 AND discount_percent <= 100
    ),
    CONSTRAINT chk_qqi_billing_cycle CHECK (
        billing_cycle IS NULL
        OR billing_cycle IN ('Monthly', 'Quarterly', 'Half-Yearly', 'Annual',
                             'Bi-annual', 'Tri-annual', 'Custom')
    ),
    CONSTRAINT chk_qqi_service_dates CHECK (
        service_start_date IS NULL OR service_end_date IS NULL
        OR service_end_date >= service_start_date
    ),
    CONSTRAINT uq_qqi_quote_line_order UNIQUE (quick_quote_id, line_order)
);

CREATE INDEX idx_qqi_quote        ON quick_quote_items(quick_quote_id);
CREATE INDEX idx_qqi_zoho_item    ON quick_quote_items(zoho_item_id) WHERE zoho_item_id IS NOT NULL;
CREATE INDEX idx_qqi_domain       ON quick_quote_items(primary_domain) WHERE primary_domain IS NOT NULL;


-- ---------------------------------------------------------------------
-- 4.7  subscriptions
--      Master subscription records. Created on lead conversion or
--      on invoice payment of fresh sale to existing customer.
-- ---------------------------------------------------------------------
CREATE TABLE subscriptions (
    id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_number         VARCHAR(50)   NOT NULL UNIQUE DEFAULT generate_subscription_number(),

    organization_id             UUID          NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    domain_id                   UUID          NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,

    -- Zoho references (cached for quick reads)
    zoho_customer_id            VARCHAR(80)   NOT NULL,
    zoho_customer_name          VARCHAR(250),
    zoho_item_id                VARCHAR(80)   NOT NULL,
    zoho_item_name              VARCHAR(250),

    -- Origin tracking (which lead / quick quote created this)
    origin_lead_id              UUID          REFERENCES leads(id)        ON DELETE SET NULL,
    origin_quick_quote_id       UUID          REFERENCES quick_quotes(id) ON DELETE SET NULL,

    -- Subscription parameters
    quantity                    NUMERIC(12,2) NOT NULL,
    subscription_price          NUMERIC(12,2) NOT NULL,
    next_renewal_price          NUMERIC(12,2),
    cost_price                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    billing_cycle               VARCHAR(50)   NOT NULL,

    start_date                  DATE          NOT NULL,
    end_date                    DATE          NOT NULL,
    next_renewal_date           DATE,
    auto_renew                  BOOLEAN       NOT NULL DEFAULT FALSE,

    -- State machine
    lifecycle_status            VARCHAR(30)   NOT NULL DEFAULT 'Pending',
    process_status              VARCHAR(30)   NOT NULL DEFAULT 'None',
    business_type               VARCHAR(30)   NOT NULL DEFAULT 'Renewal',

    -- Latest Zoho document snapshots (for fast UI display)
    last_quote_id               VARCHAR(80),
    last_quote_number           VARCHAR(80),
    last_quote_date             DATE,
    last_invoice_id             VARCHAR(80),
    last_invoice_number         VARCHAR(80),
    last_invoice_date           DATE,

    notes                       TEXT,
    metadata                    JSONB         NOT NULL DEFAULT '{}'::jsonb,

    created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_sub_lifecycle_status CHECK (
        lifecycle_status IN ('Pending', 'Active', 'Expired', 'Cancelled', 'Inactive')
    ),
    CONSTRAINT chk_sub_process_status CHECK (
        process_status IN ('None', 'Expiring Soon', 'Quoted', 'Invoiced', 'Paid')
    ),
    CONSTRAINT chk_sub_business_type CHECK (
        business_type IN ('Fresh', 'Renewal', 'Pro-rata')
    ),
    CONSTRAINT chk_sub_billing_cycle CHECK (
        billing_cycle IN ('Monthly', 'Quarterly', 'Half-Yearly', 'Annual',
                          'Bi-annual', 'Tri-annual', 'Custom')
    ),
    CONSTRAINT chk_sub_dates           CHECK (end_date >= start_date),
    CONSTRAINT chk_sub_quantity_pos    CHECK (quantity > 0),
    CONSTRAINT chk_sub_price_non_neg   CHECK (subscription_price >= 0)
);

CREATE INDEX idx_subs_org_status         ON subscriptions(organization_id, lifecycle_status);
CREATE INDEX idx_subs_domain             ON subscriptions(domain_id);
CREATE INDEX idx_subs_zoho_customer      ON subscriptions(zoho_customer_id);
CREATE INDEX idx_subs_renewal_date       ON subscriptions(next_renewal_date) WHERE lifecycle_status = 'Active';
CREATE INDEX idx_subs_end_date           ON subscriptions(end_date)          WHERE lifecycle_status = 'Active';
CREATE INDEX idx_subs_origin_lead        ON subscriptions(origin_lead_id)        WHERE origin_lead_id IS NOT NULL;
CREATE INDEX idx_subs_origin_quote       ON subscriptions(origin_quick_quote_id) WHERE origin_quick_quote_id IS NOT NULL;
CREATE INDEX idx_subs_process_status     ON subscriptions(process_status);


-- ---------------------------------------------------------------------
-- 4.8  renewal_history
--      Immutable-style audit trail of all renewal & pro-rata events.
--      Stores Quote Types 3 (Renewal) and 4 (Pro-rata).
-- ---------------------------------------------------------------------
CREATE TABLE renewal_history (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id         UUID          NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    organization_id         UUID          NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    domain_id               UUID          NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,

    business_type           VARCHAR(30)   NOT NULL,
    billing_cycle           VARCHAR(50),

    service_start_date      DATE,
    service_end_date        DATE,
    quantity                NUMERIC(12,2),
    selling_price           NUMERIC(12,2),
    cost_price              NUMERIC(12,2),
    subtotal_amount         NUMERIC(12,2),

    renewal_status          VARCHAR(30)   NOT NULL DEFAULT 'Quoted',

    -- Zoho document references
    quote_id                VARCHAR(80),
    quote_number            VARCHAR(80),
    quote_date              DATE,
    invoice_id              VARCHAR(80),
    invoice_number          VARCHAR(80),
    invoice_date            DATE,
    payment_id              VARCHAR(80),
    payment_date            DATE,

    -- Raw payload snapshots (for audit)
    raw_quote_payload       JSONB,
    raw_invoice_payload     JSONB,

    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_rh_business_type CHECK (
        business_type IN ('Renewal', 'Pro-rata', 'Fresh')
    ),
    CONSTRAINT chk_rh_renewal_status CHECK (
        renewal_status IN ('Quoted', 'Invoiced', 'Paid', 'Cancelled', 'Reversed')
    ),
    CONSTRAINT chk_rh_service_dates CHECK (
        service_start_date IS NULL OR service_end_date IS NULL
        OR service_end_date >= service_start_date
    )
);

CREATE INDEX idx_rh_subscription      ON renewal_history(subscription_id, created_at DESC);
CREATE INDEX idx_rh_status            ON renewal_history(renewal_status);
CREATE INDEX idx_rh_business_type     ON renewal_history(business_type);
CREATE INDEX idx_rh_quote_id          ON renewal_history(quote_id)   WHERE quote_id IS NOT NULL;
CREATE INDEX idx_rh_invoice_id        ON renewal_history(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_rh_org               ON renewal_history(organization_id);


-- ---------------------------------------------------------------------
-- 4.9  lead_conversions
--      Audit trail of every lead-to-Zoho-customer conversion attempt.
--      Both successful and failed conversions are recorded.
-- ---------------------------------------------------------------------
CREATE TABLE lead_conversions (
    id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id                     UUID          NOT NULL REFERENCES leads(id)        ON DELETE RESTRICT,
    quick_quote_id              UUID          REFERENCES quick_quotes(id)          ON DELETE SET NULL,
    organization_id             UUID          NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

    -- Outcome references
    zoho_customer_id            VARCHAR(80),
    zoho_estimate_id            VARCHAR(80),
    zoho_estimate_number        VARCHAR(80),
    subscription_ids            UUID[],

    -- Status
    conversion_status           VARCHAR(30)   NOT NULL,
    error_message               TEXT,
    zoho_response_payload       JSONB,

    converted_by_user_id        UUID,
    converted_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_lc_status CHECK (
        conversion_status IN ('success', 'failed', 'partial', 'rolled_back')
    )
);

CREATE INDEX idx_lc_lead          ON lead_conversions(lead_id);
CREATE INDEX idx_lc_status        ON lead_conversions(conversion_status);
CREATE INDEX idx_lc_converted_at  ON lead_conversions(converted_at DESC);


-- ---------------------------------------------------------------------
-- 4.10 webhook_events
--      Idempotent webhook event log. Every event from Zoho is recorded
--      with a unique event_hash to prevent duplicate processing.
-- ---------------------------------------------------------------------
CREATE TABLE webhook_events (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID          REFERENCES organizations(id) ON DELETE SET NULL,
    event_source        VARCHAR(50)   NOT NULL DEFAULT 'zoho_books',
    event_type          VARCHAR(100),
    zoho_entity_id      VARCHAR(80),
    event_hash          VARCHAR(128)  NOT NULL UNIQUE,
    payload             JSONB         NOT NULL,
    processing_status   VARCHAR(30)   NOT NULL DEFAULT 'pending',
    processed_at        TIMESTAMPTZ,
    error_message       TEXT,
    retry_count         INTEGER       NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_we_status CHECK (
        processing_status IN ('pending', 'processing', 'processed', 'failed', 'discarded')
    ),
    CONSTRAINT chk_we_retry_non_neg CHECK (retry_count >= 0)
);

CREATE INDEX idx_we_status              ON webhook_events(processing_status);
CREATE INDEX idx_we_org_type            ON webhook_events(organization_id, event_type);
CREATE INDEX idx_we_zoho_entity         ON webhook_events(zoho_entity_id) WHERE zoho_entity_id IS NOT NULL;
CREATE INDEX idx_we_created_at          ON webhook_events(created_at DESC);
CREATE INDEX idx_we_failed_for_retry    ON webhook_events(retry_count, created_at) WHERE processing_status = 'failed';


-- =====================================================================
-- 5. TRIGGERS — auto-update updated_at on row modification
-- =====================================================================

CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_zoho_cache_updated_at
    BEFORE UPDATE ON zoho_cache
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_domains_updated_at
    BEFORE UPDATE ON domains
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_quick_quotes_updated_at
    BEFORE UPDATE ON quick_quotes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_renewal_history_updated_at
    BEFORE UPDATE ON renewal_history
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 6. TABLE & COLUMN COMMENTS (Documentation)
-- =====================================================================

COMMENT ON TABLE  organizations           IS 'Zoho Books organizations (4 instances) with OAuth credentials and connection state.';
COMMENT ON COLUMN organizations.zoho_org_id IS 'Zoho-side organization ID, used in all Zoho API calls.';
COMMENT ON COLUMN organizations.access_token_encrypted  IS 'OAuth access token, encrypted at application layer before storage.';
COMMENT ON COLUMN organizations.refresh_token_encrypted IS 'OAuth refresh token, encrypted at application layer before storage.';

COMMENT ON TABLE  zoho_cache              IS 'Lightweight cache of Zoho customer and item data for fast list views and quick search. Refreshed via webhooks and daily sync.';
COMMENT ON COLUMN zoho_cache.entity_type  IS 'Either ''customer'' or ''item'' — the type of entity cached from Zoho.';
COMMENT ON COLUMN zoho_cache.last_synced_at IS 'When this cache row was last refreshed from Zoho. Displayed in UI for transparency.';

COMMENT ON TABLE  leads                   IS 'Prospects (un-converted customers). Lives only in Central App until conversion. Prevents Zoho customer master pollution.';
COMMENT ON COLUMN leads.lead_number       IS 'Human-readable identifier, auto-generated as LD-YYYY-NNNN.';
COMMENT ON COLUMN leads.status            IS 'Lifecycle state — New, Contacted, Quoted, Negotiating, Won, Converted, Lost, Archived.';
COMMENT ON COLUMN leads.converted_to_zoho_customer_id IS 'Zoho customer ID created on conversion. NULL until status = ''Converted''.';

COMMENT ON TABLE  domains                 IS 'Domain to Zoho-customer to organization mapping. The unique routing key for multi-org subscription lookup.';
COMMENT ON COLUMN domains.domain_name     IS 'Primary domain name (unique). Used to resolve which Zoho org a subscription belongs to.';

COMMENT ON TABLE  quick_quotes            IS 'Fresh-sale quotes (Quote Types 1 & 2). Lead-based or existing-customer cross-sell.';
COMMENT ON COLUMN quick_quotes.customer_type IS 'Either ''lead'' or ''existing''. Determines which reference column is populated.';
COMMENT ON COLUMN quick_quotes.public_token  IS 'Signed token for public quote view URL (Lead mode). NULL for existing-customer quotes.';
COMMENT ON COLUMN quick_quotes.zoho_estimate_id IS 'Set after the quote is pushed to Zoho as an Estimate document.';

COMMENT ON TABLE  quick_quote_items       IS 'Line items for quick_quotes. Each line may carry subscription-context fields used at invoice-paid time.';
COMMENT ON COLUMN quick_quote_items.is_subscription IS 'If true, a subscription record will be created when the invoice is paid.';

COMMENT ON TABLE  subscriptions           IS 'Master subscription records. Created on lead conversion or fresh-sale invoice payment.';
COMMENT ON COLUMN subscriptions.subscription_number IS 'Human-readable identifier, auto-generated as SUB-YYYY-NNNN.';
COMMENT ON COLUMN subscriptions.lifecycle_status IS 'Pending, Active, Expired, Cancelled, Inactive.';
COMMENT ON COLUMN subscriptions.process_status   IS 'None, Expiring Soon, Quoted, Invoiced, Paid.';
COMMENT ON COLUMN subscriptions.business_type    IS 'Fresh, Renewal, Pro-rata — describes the most recent transaction type.';

COMMENT ON TABLE  renewal_history         IS 'Audit trail for renewal and pro-rata events (Quote Types 3 & 4). One row per quote/invoice cycle per subscription.';
COMMENT ON COLUMN renewal_history.business_type IS 'Renewal, Pro-rata, or Fresh — describes the nature of this history event.';

COMMENT ON TABLE  lead_conversions        IS 'Audit log of every lead-to-Zoho-customer conversion attempt (success or failure).';
COMMENT ON COLUMN lead_conversions.subscription_ids IS 'Array of subscription UUIDs created as part of this conversion.';

COMMENT ON TABLE  webhook_events          IS 'Idempotent webhook event log. event_hash unique constraint prevents duplicate processing of the same Zoho event.';
COMMENT ON COLUMN webhook_events.event_hash IS 'Computed as hash of (org_id + entity_id + event_type + status). Enforces idempotency.';


-- =====================================================================
-- 7. SETTINGS & CONFIGURATION TABLES (v1.1 Addendum — PRD Section 5A)
-- =====================================================================
--
-- This section adds 5 tables for application settings, branding,
-- email templates, master data lists, and user preferences.
--
-- Tables:
--   7.1  app_settings        Global key-value settings store
--   7.2  org_settings        Per-org branding and configuration
--   7.3  email_templates     Editable email templates (global or per-org)
--   7.4  master_data_lists   Custom dropdown lists (lead sources, etc.)
--   7.5  user_preferences    Per-user UI preferences (Phase 2)
--
-- =====================================================================


-- ---------------------------------------------------------------------
-- 7.1  app_settings
--      Global application settings as key-value pairs, grouped by category.
--      JSONB value column allows any data type without schema migration.
-- ---------------------------------------------------------------------
CREATE TABLE app_settings (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    category                VARCHAR(50)   NOT NULL,
    setting_key             VARCHAR(100)  NOT NULL,
    setting_value           JSONB         NOT NULL,
    value_type              VARCHAR(20)   NOT NULL DEFAULT 'json',
    description             TEXT,
    is_sensitive            BOOLEAN       NOT NULL DEFAULT FALSE,
    is_system               BOOLEAN       NOT NULL DEFAULT FALSE,
    updated_by_user_id      UUID,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_app_settings_key UNIQUE (category, setting_key),
    CONSTRAINT chk_app_settings_value_type CHECK (
        value_type IN ('string', 'number', 'boolean', 'json', 'array', 'date')
    ),
    CONSTRAINT chk_app_settings_category CHECK (
        category IN ('quick_quote', 'subscription', 'lead', 'tax', 'email',
                     'notification', 'system', 'security', 'localization', 'general',
                     'zoho', 'conversion')
    )
);

CREATE INDEX idx_app_settings_category     ON app_settings(category);
CREATE INDEX idx_app_settings_system       ON app_settings(is_system);


-- ---------------------------------------------------------------------
-- 7.2  org_settings
--      Per-organization branding, PDF settings, tax defaults, and
--      configuration overrides. One row per Zoho organization.
-- ---------------------------------------------------------------------
CREATE TABLE org_settings (
    id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                 UUID          NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

    -- Branding / display
    legal_name                      VARCHAR(250),
    display_name                    VARCHAR(250),
    logo_url                        TEXT,
    brand_color                     VARCHAR(20)   DEFAULT '#1F2937',

    -- Header info (for PDFs / invoices)
    address_line1                   VARCHAR(250),
    address_line2                   VARCHAR(250),
    city                            VARCHAR(100),
    state                           VARCHAR(100),
    state_code                      VARCHAR(10),         -- for GST place-of-supply
    postal_code                     VARCHAR(20),
    country                         VARCHAR(100)  DEFAULT 'India',
    gstin                           VARCHAR(30),
    pan                             VARCHAR(30),
    phone                           VARCHAR(50),
    email                           CITEXT,
    website                         VARCHAR(250),

    -- PDF behavior / appearance
    pdf_template                    VARCHAR(50)   NOT NULL DEFAULT 'modern',
    pdf_footer_text                 TEXT,
    pdf_show_cost_price             BOOLEAN       NOT NULL DEFAULT FALSE,
    pdf_show_internal_notes         BOOLEAN       NOT NULL DEFAULT FALSE,
    pdf_watermark                   VARCHAR(50),         -- 'DRAFT', 'DUPLICATE', or NULL
    signature_image_url             TEXT,

    -- Tax defaults
    default_tax_rate                NUMERIC(5,2)  NOT NULL DEFAULT 18.0,
    supplier_state                  VARCHAR(100),
    supplier_state_code             VARCHAR(10),

    -- Bank details (for invoice/quote footer)
    bank_name                       VARCHAR(100),
    bank_account_number             VARCHAR(50),
    bank_ifsc                       VARCHAR(20),
    bank_account_holder             VARCHAR(250),

    -- Email overrides (per-org from/reply-to and signature)
    email_from_address              CITEXT,
    email_reply_to                  CITEXT,
    email_signature_html            TEXT,

    -- Quote defaults override (per-org)
    quote_validity_days             INTEGER,
    quote_terms_and_conditions      TEXT,
    quote_notes_to_customer         TEXT,

    -- Flexible overrides (per-org overrides of any global app_settings)
    settings_overrides              JSONB         NOT NULL DEFAULT '{}'::jsonb,

    metadata                        JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_by_user_id              UUID,         -- FK to users(id) added in §11.5
    updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_org_settings_pdf_template CHECK (
        pdf_template IN ('modern', 'classic', 'minimal', 'compact')
    ),
    CONSTRAINT chk_org_settings_tax_rate CHECK (
        default_tax_rate >= 0 AND default_tax_rate <= 100
    ),
    CONSTRAINT chk_org_settings_validity CHECK (
        quote_validity_days IS NULL OR quote_validity_days > 0
    )
);

CREATE INDEX idx_org_settings_org ON org_settings(organization_id);


-- ---------------------------------------------------------------------
-- 7.3  email_templates
--      Editable email templates. Global if organization_id IS NULL;
--      per-org override otherwise.
-- ---------------------------------------------------------------------
CREATE TABLE email_templates (
    id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                 UUID          REFERENCES organizations(id) ON DELETE CASCADE,

    -- Identification
    template_key                    VARCHAR(80)   NOT NULL,
    template_name                   VARCHAR(200)  NOT NULL,
    category                        VARCHAR(50)   NOT NULL,
    language                        VARCHAR(10)   NOT NULL DEFAULT 'en',

    -- Content (with placeholders like {{customer_name}}, {{quote_number}})
    subject                         VARCHAR(500)  NOT NULL,
    body_html                       TEXT          NOT NULL,
    body_text                       TEXT,                       -- plain-text fallback

    -- UI helper — list of placeholder names available in this template
    available_placeholders          JSONB         NOT NULL DEFAULT '[]'::jsonb,

    -- Metadata
    description                     TEXT,
    is_active                       BOOLEAN       NOT NULL DEFAULT TRUE,
    is_system                       BOOLEAN       NOT NULL DEFAULT FALSE,

    updated_by_user_id              UUID,
    created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_email_templates UNIQUE (organization_id, template_key, language),
    CONSTRAINT chk_email_templates_category CHECK (
        category IN ('quote', 'renewal', 'pro_rata', 'payment', 'conversion',
                     'lead', 'admin_alert', 'system', 'welcome',
                     'subscription', 'customer', 'notification')
    )
);

CREATE INDEX idx_email_templates_key       ON email_templates(template_key);
CREATE INDEX idx_email_templates_category  ON email_templates(category);
CREATE INDEX idx_email_templates_org       ON email_templates(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_email_templates_active    ON email_templates(is_active);


-- ---------------------------------------------------------------------
-- 7.4  master_data_lists
--      Editable dropdown lists used across the app — lead sources,
--      industries, lost reasons, subscription categories, tags, etc.
-- ---------------------------------------------------------------------
CREATE TABLE master_data_lists (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    list_type           VARCHAR(50)   NOT NULL,
    item_value          VARCHAR(200)  NOT NULL,
    item_label          VARCHAR(250),
    display_order       INTEGER       NOT NULL DEFAULT 0,
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    is_system           BOOLEAN       NOT NULL DEFAULT FALSE,
    metadata            JSONB         NOT NULL DEFAULT '{}'::jsonb,

    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_master_data UNIQUE (list_type, item_value),
    CONSTRAINT chk_master_data_list_type CHECK (
        list_type IN ('lead_source', 'industry', 'lost_reason',
                      'subscription_category', 'item_category', 'tag',
                      'gst_rate', 'billing_cycle', 'state', 'country',
                      'currency', 'designation', 'rejection_reason')
    )
);

CREATE INDEX idx_master_data_type      ON master_data_lists(list_type);
CREATE INDEX idx_master_data_active    ON master_data_lists(list_type, is_active);
CREATE INDEX idx_master_data_order     ON master_data_lists(list_type, display_order);


-- ---------------------------------------------------------------------
-- 7.5  user_preferences
--      Per-user UI preferences (theme, default landing page, filters, etc.)
--      FK to users(id) added in Section 11.
-- ---------------------------------------------------------------------
CREATE TABLE user_preferences (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID          NOT NULL,            -- FK to users.id added in Section 11
    preference_key      VARCHAR(100)  NOT NULL,
    preference_value    JSONB         NOT NULL,

    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_preferences UNIQUE (user_id, preference_key)
);

CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);


-- =====================================================================
-- 8. TRIGGERS FOR SETTINGS TABLES (auto-update updated_at)
-- =====================================================================

CREATE TRIGGER trg_app_settings_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_org_settings_updated_at
    BEFORE UPDATE ON org_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_templates_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_master_data_lists_updated_at
    BEFORE UPDATE ON master_data_lists
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 9. COMMENTS FOR SETTINGS TABLES
-- =====================================================================

COMMENT ON TABLE  app_settings IS 'Global application settings as key-value pairs, grouped by category. JSONB value column allows any data type without schema migration.';
COMMENT ON COLUMN app_settings.category IS 'Setting category: quick_quote, subscription, lead, tax, email, notification, system, security, localization, general.';
COMMENT ON COLUMN app_settings.setting_key IS 'Unique key within category. Example: ''default_validity_days'' under ''quick_quote''.';
COMMENT ON COLUMN app_settings.is_sensitive IS 'If true, value is sensitive (mask in UI/logs, encrypt at application layer if needed).';
COMMENT ON COLUMN app_settings.is_system IS 'If true, this is a system setting that should not be deleted — only edited.';

COMMENT ON TABLE  org_settings IS 'Per-organization branding, PDF settings, tax defaults, and configuration overrides. One row per Zoho organization.';
COMMENT ON COLUMN org_settings.supplier_state_code IS 'GST state code (e.g., ''27'' for Maharashtra). Used to determine intra-state vs inter-state for tax calculation.';
COMMENT ON COLUMN org_settings.pdf_template IS 'Visual style of generated quote/invoice PDFs: modern, classic, minimal, compact.';
COMMENT ON COLUMN org_settings.settings_overrides IS 'JSONB blob for per-org overrides of any global app_settings value.';
COMMENT ON COLUMN org_settings.pdf_show_cost_price IS 'If true, internal cost price column appears on PDFs (for internal docs only).';

COMMENT ON TABLE  email_templates IS 'Editable email templates. Global default if organization_id is NULL; per-org override otherwise. Looked up by (organization_id, template_key, language).';
COMMENT ON COLUMN email_templates.template_key IS 'Stable identifier: quote_sent, quote_viewed, quote_accepted, renewal_reminder_60, renewal_reminder_30, payment_received, etc.';
COMMENT ON COLUMN email_templates.is_system IS 'System templates cannot be deleted (required for core notifications). They can be edited.';
COMMENT ON COLUMN email_templates.available_placeholders IS 'JSONB array of placeholder names this template supports (for UI helper). Example: ["customer_name", "quote_number", "total_amount"].';

COMMENT ON TABLE  master_data_lists IS 'Custom dropdown lists used across the app — lead sources, industries, lost reasons, categories, tags.';
COMMENT ON COLUMN master_data_lists.list_type IS 'Type of list this row belongs to (lead_source, industry, lost_reason, etc.).';
COMMENT ON COLUMN master_data_lists.is_system IS 'System defaults cannot be deleted, only deactivated (set is_active = false).';
COMMENT ON COLUMN master_data_lists.display_order IS 'Sort order within the list. Lower numbers appear first.';

COMMENT ON TABLE  user_preferences IS 'Per-user UI preferences (theme, date format, default landing page, saved filters, etc.). FK to users(id) added in Section 11.';
COMMENT ON COLUMN user_preferences.user_id IS 'User UUID. FK constraint to users(id) added in Section 11.';
COMMENT ON COLUMN user_preferences.preference_key IS 'Preference identifier: theme, date_format, time_zone, default_landing_page, sidebar_density, etc.';


-- =====================================================================
-- 10. AUTHENTICATION & AUDIT TABLES (v1.2 addendum)
--     Addresses pre-implementation audit blockers:
--       B1 — No users table for auth (login/me endpoints can't work)
--       B2 — No settings_audit_log table for PRD §5A.1 audit requirement
--     Schema is NextAuth.js (Auth.js v5) compatible.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 10.1  users
--       Application user accounts. Standard NextAuth.js shape + app-level
--       role and is_active fields used by RBAC (PRD §5A.3.10 Phase 2).
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    email               CITEXT        NOT NULL UNIQUE,
    email_verified      TIMESTAMPTZ,
    name                VARCHAR(200),
    image_url           TEXT,

    -- Local-password auth (optional — used when not using OAuth/magic link)
    password_hash       TEXT,                                  -- bcrypt/argon2 hash; NULL if OAuth-only
    password_changed_at TIMESTAMPTZ,

    -- Application-level role (Phase 2 RBAC; MVP all users are 'Admin')
    role                VARCHAR(30)   NOT NULL DEFAULT 'Admin',

    -- Lifecycle
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    failed_login_count  INTEGER       NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,

    -- Optional 2FA (Phase 2)
    totp_secret_encrypted TEXT,
    totp_enabled        BOOLEAN       NOT NULL DEFAULT FALSE,

    -- Personal info / preferences quick-access
    phone               VARCHAR(50),
    signature_html      TEXT,

    metadata            JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_users_role CHECK (
        role IN ('Admin', 'Sales', 'Manager', 'Viewer')
    )
);

CREATE INDEX idx_users_email   ON users(email);
CREATE INDEX idx_users_active  ON users(is_active);
CREATE INDEX idx_users_role    ON users(role);


-- ---------------------------------------------------------------------
-- 10.2  accounts
--       Linked OAuth identities per user (e.g., Google, Microsoft).
--       One user can have multiple OAuth accounts. Required by NextAuth.js.
-- ---------------------------------------------------------------------
CREATE TABLE accounts (
    id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider                    VARCHAR(50)   NOT NULL,       -- 'google', 'microsoft', 'credentials'
    provider_account_id         VARCHAR(255)  NOT NULL,
    type                        VARCHAR(30)   NOT NULL,       -- 'oauth', 'email', 'credentials'

    -- Provider tokens (encrypted)
    access_token_encrypted      TEXT,
    refresh_token_encrypted     TEXT,
    expires_at                  TIMESTAMPTZ,
    token_type                  VARCHAR(30),
    scope                       TEXT,
    id_token_encrypted          TEXT,
    session_state               VARCHAR(255),

    created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_accounts_provider UNIQUE (provider, provider_account_id)
);

CREATE INDEX idx_accounts_user ON accounts(user_id);


-- ---------------------------------------------------------------------
-- 10.3  sessions
--       Active session tokens (database-strategy NextAuth sessions).
--       Decision: Q6.4 — 24-hour idle timeout (seeded in app_settings).
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token   VARCHAR(255)  NOT NULL UNIQUE,
    user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ   NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user        ON sessions(user_id);
CREATE INDEX idx_sessions_expires     ON sessions(expires_at);


-- ---------------------------------------------------------------------
-- 10.4  verification_tokens
--       Email verification / magic-link / password-reset tokens.
-- ---------------------------------------------------------------------
CREATE TABLE verification_tokens (
    identifier      VARCHAR(255)  NOT NULL,                   -- typically email
    token           VARCHAR(255)  NOT NULL,
    purpose         VARCHAR(30)   NOT NULL DEFAULT 'email_verify',
    expires_at      TIMESTAMPTZ   NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    PRIMARY KEY (identifier, token),
    CONSTRAINT chk_verification_purpose CHECK (
        purpose IN ('email_verify', 'magic_link', 'password_reset', '2fa_setup')
    )
);

CREATE INDEX idx_verification_tokens_identifier ON verification_tokens(identifier);
CREATE INDEX idx_verification_tokens_expires    ON verification_tokens(expires_at);


-- ---------------------------------------------------------------------
-- 10.5  settings_audit_log
--       PRD §5A.1: "Audit everything — हर settings change log हो (who/when/what)"
--       Captures every change to app_settings, org_settings, email_templates,
--       master_data_lists. Insert-only (no UPDATE/DELETE allowed from app).
-- ---------------------------------------------------------------------
CREATE TABLE settings_audit_log (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was changed
    entity_type         VARCHAR(50)   NOT NULL,   -- 'app_settings', 'org_settings', 'email_templates', 'master_data_lists'
    entity_id           UUID,                     -- row id of changed record (NULL for global key-value ops)
    setting_category    VARCHAR(50),              -- e.g. 'quick_quote', 'subscription', 'tax'
    setting_key         VARCHAR(150),             -- e.g. 'default_validity_days'

    -- Who changed it
    user_id             UUID          REFERENCES users(id) ON DELETE SET NULL,
    user_email_snapshot VARCHAR(200),             -- denormalized email at time of change (preserved if user deleted)

    -- What happened
    action              VARCHAR(20)   NOT NULL,   -- 'create', 'update', 'delete'
    old_value           JSONB,
    new_value           JSONB,
    change_summary      TEXT,                     -- human-readable, e.g. 'Quote validity changed from 15 to 30 days'

    -- Context
    ip_address          INET,
    user_agent          TEXT,
    request_id          UUID,                     -- correlation id across services

    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_audit_action CHECK (action IN ('create', 'update', 'delete')),
    CONSTRAINT chk_audit_entity_type CHECK (
        entity_type IN ('app_settings', 'org_settings', 'email_templates',
                        'master_data_lists', 'organizations', 'users')
    )
);

CREATE INDEX idx_audit_log_entity    ON settings_audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_user      ON settings_audit_log(user_id);
CREATE INDEX idx_audit_log_category  ON settings_audit_log(setting_category, setting_key);
CREATE INDEX idx_audit_log_created   ON settings_audit_log(created_at DESC);


-- =====================================================================
-- 11. FOREIGN KEY ADDITIONS
--     Wire previously dangling user_id columns to users(id).
--     Run AFTER section 10 (users table must exist first).
-- =====================================================================

-- 11.1  leads.assigned_to_user_id → users.id (SET NULL on user delete to preserve lead history)
ALTER TABLE leads
    ADD CONSTRAINT fk_leads_assigned_user
    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 11.2  quick_quotes.created_by_user_id → users.id (SET NULL — quote survives user deletion)
ALTER TABLE quick_quotes
    ADD CONSTRAINT fk_qq_created_by_user
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 11.3  lead_conversions.converted_by_user_id → users.id
ALTER TABLE lead_conversions
    ADD CONSTRAINT fk_lc_converted_by_user
    FOREIGN KEY (converted_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 11.4  app_settings.updated_by_user_id → users.id
ALTER TABLE app_settings
    ADD CONSTRAINT fk_app_settings_updated_by_user
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 11.5  org_settings.updated_by_user_id → users.id
ALTER TABLE org_settings
    ADD CONSTRAINT fk_org_settings_updated_by_user
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 11.6  user_preferences.user_id → users.id (CASCADE — preferences die with user)
ALTER TABLE user_preferences
    ADD CONSTRAINT fk_user_preferences_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;


-- =====================================================================
-- 12. TRIGGERS & COMMENTS FOR AUTH/AUDIT TABLES
-- =====================================================================

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- settings_audit_log is insert-only; no updated_at trigger.
-- Application/DB-level guard: REVOKE UPDATE, DELETE ON settings_audit_log FROM app_user;

COMMENT ON TABLE  users IS 'Application user accounts. NextAuth.js-compatible. MVP: all users default to Admin role; full RBAC in Phase 2 (PRD §5A.3.10).';
COMMENT ON COLUMN users.email IS 'CITEXT — case-insensitive unique. Used as login identifier.';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt or Argon2 hash. NULL when user only authenticates via OAuth provider.';
COMMENT ON COLUMN users.role IS 'RBAC role. MVP enforces only Admin path; Phase 2 introduces Sales/Manager/Viewer scoping.';
COMMENT ON COLUMN users.totp_secret_encrypted IS 'AES-encrypted TOTP secret for 2FA (Phase 2).';
COMMENT ON COLUMN users.locked_until IS 'If set, account locked from login until this time (failed login lockout).';

COMMENT ON TABLE  accounts IS 'OAuth provider linkage per user. A single user can have multiple linked accounts (Google + Microsoft + credentials).';
COMMENT ON COLUMN accounts.provider IS 'OAuth provider identifier: google, microsoft, credentials.';
COMMENT ON COLUMN accounts.provider_account_id IS 'Stable user ID returned by the provider (e.g., Google sub claim).';

COMMENT ON TABLE  sessions IS 'Active user sessions. Database session strategy (NextAuth). Cleaned up via cron when expires_at < NOW().';
COMMENT ON COLUMN sessions.session_token IS 'Opaque random token (>=32 bytes base64). Stored as cookie on client.';
COMMENT ON COLUMN sessions.expires_at IS 'Session idle timeout. Seeded value 24h (decision Q6.4).';

COMMENT ON TABLE  verification_tokens IS 'Single-use tokens for email verification, magic-link login, password reset, 2FA setup.';
COMMENT ON COLUMN verification_tokens.purpose IS 'Why this token exists. Restricts what flow can consume it.';

COMMENT ON TABLE  settings_audit_log IS 'Append-only audit trail for settings changes (PRD §5A.1). INSERT-only at application layer; revoke UPDATE/DELETE on app DB role.';
COMMENT ON COLUMN settings_audit_log.entity_type IS 'Which settings table was affected.';
COMMENT ON COLUMN settings_audit_log.user_email_snapshot IS 'Email at time of change. Preserved if user is later deleted (FK uses SET NULL).';
COMMENT ON COLUMN settings_audit_log.old_value IS 'JSONB of the previous state of the affected row/key.';
COMMENT ON COLUMN settings_audit_log.new_value IS 'JSONB of the new state. For deletes, NULL.';
COMMENT ON COLUMN settings_audit_log.request_id IS 'Correlation ID propagated across services for trace linking.';


-- =====================================================================
-- SEED DATA HINTS (Optional — examples for default settings population)
-- =====================================================================
-- These are EXAMPLES — copy/adapt to a separate seed.sql file as needed.
--
-- -- Example 1: Default Quick Quote validity (15 days)
-- INSERT INTO app_settings (category, setting_key, setting_value, value_type, description, is_system)
-- VALUES ('quick_quote', 'default_validity_days', '15'::jsonb, 'number',
--         'Default validity period for new quick quotes (in days)', true);
--
-- -- Example 2: Renewal reminder schedule
-- INSERT INTO app_settings (category, setting_key, setting_value, value_type, description, is_system)
-- VALUES ('subscription', 'renewal_reminder_days', '[60, 30, 15, 7]'::jsonb, 'array',
--         'Days before expiry to send renewal reminders', true);
--
-- -- Example 3: Default lead sources
-- INSERT INTO master_data_lists (list_type, item_value, item_label, display_order, is_system)
-- VALUES
--   ('lead_source', 'website',    'Website',     1, true),
--   ('lead_source', 'referral',   'Referral',    2, true),
--   ('lead_source', 'cold_call',  'Cold Call',   3, true),
--   ('lead_source', 'linkedin',   'LinkedIn',    4, true),
--   ('lead_source', 'trade_show', 'Trade Show',  5, true),
--   ('lead_source', 'other',      'Other',       99, true);
--
-- -- Example 4: GST rates
-- INSERT INTO master_data_lists (list_type, item_value, item_label, display_order, is_system)
-- VALUES
--   ('gst_rate', '0',  '0%',  1, true),
--   ('gst_rate', '5',  '5%',  2, true),
--   ('gst_rate', '12', '12%', 3, true),
--   ('gst_rate', '18', '18%', 4, true),
--   ('gst_rate', '28', '28%', 5, true);
--
-- -- Example 5: System email template stub
-- INSERT INTO email_templates (template_key, template_name, category, subject, body_html, is_system, available_placeholders)
-- VALUES ('quote_sent', 'Quote Sent to Customer', 'quote',
--         'Your quote {{quote_number}} from {{company_name}}',
--         '<p>Dear {{customer_name}},</p><p>Please find attached quote {{quote_number}}.</p>',
--         true,
--         '["customer_name", "quote_number", "total_amount", "company_name", "validity_date"]'::jsonb);
--
-- For a comprehensive seed file, see: seed_default_settings.sql (separate file)


-- =====================================================================
-- END OF SCHEMA
-- =====================================================================
-- After running this file:
--   1. Verify all 20 tables created: \dt
--   2. Verify all indexes:           \di
--   3. Run seed_default_settings.sql to populate defaults (settings + master data)
--   4. Create first admin user (manual INSERT into users with hashed password)
--   5. Insert one organization row with Zoho OAuth credentials
--   6. Insert corresponding org_settings row (branding/PDF/tax defaults)
--   7. Run the Zoho customer/item initial sync job
--   8. Begin onboarding leads and creating quick quotes
--
-- Total objects:
--   Tables:    20  (10 core + 5 settings + 4 auth + 1 audit)
--   Indexes:   75+
--   Triggers:  14
--   Sequences: 3
--   Functions: 4
-- =====================================================================
