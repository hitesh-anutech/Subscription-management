-- CreateTable
CREATE TABLE "subscription_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "created_by_email" VARCHAR(250) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_comments_subscription_id_idx" ON "subscription_comments"("subscription_id");

-- AddForeignKey
ALTER TABLE "subscription_comments" ADD CONSTRAINT "subscription_comments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
