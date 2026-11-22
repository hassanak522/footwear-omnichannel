CREATE TABLE "BranchClosingReview" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "closingDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REVIEW_ACKNOWLEDGED',
    "snapshot" JSONB NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "signedById" UUID NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BranchClosingReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BranchClosingReview_locationId_closingDate_key"
ON "BranchClosingReview"("locationId", "closingDate");

CREATE INDEX "BranchClosingReview_locationId_signedAt_idx"
ON "BranchClosingReview"("locationId", "signedAt");