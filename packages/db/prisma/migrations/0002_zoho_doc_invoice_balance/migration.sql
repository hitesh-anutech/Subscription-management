-- Add invoice_balance column to zoho_customer_docs
ALTER TABLE zoho_customer_docs ADD COLUMN IF NOT EXISTS invoice_balance DOUBLE PRECISION;
