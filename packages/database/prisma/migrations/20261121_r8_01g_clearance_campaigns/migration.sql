-- CreateTable
CREATE TABLE "ClearanceCampaign" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClearanceCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceCampaignVariant" (
    "campaignId" UUID NOT NULL,
    "variantId" UUID NOT NULL,

    CONSTRAINT "ClearanceCampaignVariant_pkey" PRIMARY KEY ("campaignId","variantId")
);

-- CreateTable
CREATE TABLE "ClearanceCampaignBranch" (
    "campaignId" UUID NOT NULL,
    "locationId" UUID NOT NULL,

    CONSTRAINT "ClearanceCampaignBranch_pkey" PRIMARY KEY ("campaignId","locationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceCampaign_code_key" ON "ClearanceCampaign"("code");

-- CreateIndex
CREATE INDEX "ClearanceCampaign_status_startsAt_endsAt_idx" ON "ClearanceCampaign"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ClearanceCampaignVariant_variantId_idx" ON "ClearanceCampaignVariant"("variantId");

-- CreateIndex
CREATE INDEX "ClearanceCampaignBranch_locationId_idx" ON "ClearanceCampaignBranch"("locationId");

-- AddForeignKey
ALTER TABLE "ClearanceCampaignVariant" ADD CONSTRAINT "ClearanceCampaignVariant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ClearanceCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceCampaignBranch" ADD CONSTRAINT "ClearanceCampaignBranch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ClearanceCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
