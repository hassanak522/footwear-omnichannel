CREATE TABLE "HqCorrectiveAction" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "escalationId" UUID,
    "ownerId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "evidence" VARCHAR(4000),
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HqCorrectiveAction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HqCorrectiveAction_locationId_fkey"
        FOREIGN KEY ("locationId") REFERENCES "Location"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HqCorrectiveAction_ownerId_fkey"
        FOREIGN KEY ("ownerId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HqCorrectiveAction_escalationId_fkey"
        FOREIGN KEY ("escalationId") REFERENCES "HqClosingEscalation"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "HqCorrectiveAction_locationId_status_idx"
ON "HqCorrectiveAction"("locationId", "status");

CREATE INDEX "HqCorrectiveAction_ownerId_status_idx"
ON "HqCorrectiveAction"("ownerId", "status");

CREATE INDEX "HqCorrectiveAction_dueAt_status_idx"
ON "HqCorrectiveAction"("dueAt", "status");

CREATE INDEX "HqCorrectiveAction_escalationId_idx"
ON "HqCorrectiveAction"("escalationId");