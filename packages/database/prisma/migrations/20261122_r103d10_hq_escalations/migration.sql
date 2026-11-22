CREATE TABLE "HqClosingEscalation" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "closingDate" DATE NOT NULL,
    "ownerId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'HIGH',
    "note" VARCHAR(2000) NOT NULL,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "HqClosingEscalation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HqClosingEscalation_locationId_closingDate_key"
ON "HqClosingEscalation"("locationId", "closingDate");

CREATE INDEX "HqClosingEscalation_status_updatedAt_idx"
ON "HqClosingEscalation"("status", "updatedAt");

CREATE INDEX "HqClosingEscalation_ownerId_status_idx"
ON "HqClosingEscalation"("ownerId", "status");

ALTER TABLE "HqClosingEscalation"
ADD CONSTRAINT "HqClosingEscalation_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HqClosingEscalation"
ADD CONSTRAINT "HqClosingEscalation_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;