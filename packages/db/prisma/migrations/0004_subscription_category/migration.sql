-- Add subscription_category column to subscriptions table
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS subscription_category VARCHAR(100);
