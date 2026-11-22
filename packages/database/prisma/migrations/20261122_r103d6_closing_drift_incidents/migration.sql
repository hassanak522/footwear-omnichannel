CREATE TABLE "BranchClosingDriftIncident" (
  "id" UUID NOT NULL,
  "reviewId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "closingDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "changedSections" JSONB NOT NULL,
  "currentIssues" JSONB NOT NULL,
  "ownerId" UUID,
  "resolutionNote" VARCHAR(2000),
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" UUID,
  CONSTRAINT "BranchClosingDriftIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BranchClosingDriftIncident_reviewId_key"
ON "BranchClosingDriftIncident"("reviewId");

CREATE INDEX "BranchClosingDriftIncident_locationId_status_lastDetectedAt_idx"
ON "BranchClosingDriftIncident"("locationId","status","lastDetectedAt");