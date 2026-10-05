CREATE TABLE "GoogleConnection" ("id" TEXT PRIMARY KEY DEFAULT 'local', "email" TEXT NOT NULL, "encryptedRefreshToken" TEXT NOT NULL, "scopes" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "JobOpening" (
"id" TEXT PRIMARY KEY, "source" TEXT NOT NULL, "board" TEXT NOT NULL, "externalId" TEXT NOT NULL,
"company" TEXT NOT NULL, "title" TEXT NOT NULL, "location" TEXT NOT NULL, "salary" TEXT NOT NULL DEFAULT 'Not disclosed',
"url" TEXT NOT NULL UNIQUE, "description" TEXT NOT NULL, "email" TEXT NOT NULL DEFAULT '', "emailEvidence" TEXT NOT NULL DEFAULT '',
"matchScore" INTEGER, "matchReason" TEXT NOT NULL DEFAULT 'Not analyzed', "matchedSkills" TEXT[] NOT NULL, "missingSkills" TEXT[] NOT NULL,
"review" TEXT NOT NULL DEFAULT 'PENDING', "sheetExportedAt" TIMESTAMP(3), "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("source", "board", "externalId")
);
CREATE TABLE "PublishBatch" ("id" TEXT PRIMARY KEY, "fingerprint" TEXT NOT NULL, "snapshot" JSONB NOT NULL, "state" TEXT NOT NULL DEFAULT 'PREVIEW', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL, "result" JSONB);
CREATE TABLE "JobApplication" (
"id" TEXT PRIMARY KEY, "jobId" TEXT NOT NULL UNIQUE REFERENCES "JobOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
"batchId" TEXT NOT NULL, "status" TEXT NOT NULL, "recipient" TEXT NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "resumeHash" TEXT NOT NULL,
"gmailMessageId" TEXT, "gmailThreadId" TEXT, "detail" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "JobNotification" ("id" TEXT PRIMARY KEY, "jobId" TEXT NOT NULL, "title" TEXT NOT NULL, "snippet" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
