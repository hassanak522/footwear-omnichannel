CREATE TABLE "PosClearanceAllocation" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "saleLineId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosClearanceAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PosClearanceAllocation_quantity_check"
      CHECK ("quantity" > 0),
    CONSTRAINT "PosClearanceAllocation_amounts_check"
      CHECK (
        "grossAmount" >= 0
        AND "discountAmount" >= 0
        AND "netAmount" >= 0
        AND "grossAmount" = "discountAmount" + "netAmount"
      )
);

CREATE UNIQUE INDEX "PosClearanceAllocation_saleLineId_key"
ON "PosClearanceAllocation"("saleLineId");

CREATE INDEX "PosClearanceAllocation_saleId_idx"
ON "PosClearanceAllocation"("saleId");

CREATE INDEX "PosClearanceAllocation_campaignId_createdAt_idx"
ON "PosClearanceAllocation"("campaignId","createdAt");

CREATE INDEX "PosClearanceAllocation_variantId_idx"
ON "PosClearanceAllocation"("variantId");

ALTER TABLE "PosClearanceAllocation"
ADD CONSTRAINT "PosClearanceAllocation_saleId_fkey"
FOREIGN KEY ("saleId") REFERENCES "PosSale"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PosClearanceAllocation"
ADD CONSTRAINT "PosClearanceAllocation_saleLineId_fkey"
FOREIGN KEY ("saleLineId") REFERENCES "PosSaleLine"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PosClearanceAllocation"
ADD CONSTRAINT "PosClearanceAllocation_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "ClearanceCampaign"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;