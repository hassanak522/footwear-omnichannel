CREATE TABLE "HqClosingSlaBreach" (
    "id" UUID NOT NULL,
    "escalationId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "priority" TEXT NOT NULL,
    "slaHours" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HqClosingSlaBreach_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HqClosingSlaBreach_escalationId_key"
ON "HqClosingSlaBreach"("escalationId");

CREATE INDEX "HqClosingSlaBreach_status_detectedAt_idx"
ON "HqClosingSlaBreach"("status","detectedAt");

CREATE INDEX "HqClosingSlaBreach_locationId_detectedAt_idx"
ON "HqClosingSlaBreach"("locationId","detectedAt");

ALTER TABLE "HqClosingSlaBreach"
ADD CONSTRAINT "HqClosingSlaBreach_escalationId_fkey"
FOREIGN KEY ("escalationId")
REFERENCES "HqClosingEscalation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;