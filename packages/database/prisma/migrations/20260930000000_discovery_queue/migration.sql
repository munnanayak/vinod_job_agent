CREATE TABLE "DiscoveryState" (
    "source" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DiscoveryState_pkey" PRIMARY KEY ("source")
);
CREATE TABLE "DiscoveryPending" (
    "id" TEXT NOT NULL,
    "posting" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscoveryPending_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DiscoveryPending_createdAt_idx" ON "DiscoveryPending"("createdAt");
