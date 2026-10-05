CREATE TABLE "CandidateProfile" (
 "id" TEXT NOT NULL,
 "ownerKey" TEXT NOT NULL DEFAULT 'local',
 "name" TEXT NOT NULL,
 "currentTitle" TEXT NOT NULL,
 "yearsOfExperience" DOUBLE PRECISION NOT NULL,
 "locations" TEXT[] NOT NULL,
 "remotePreference" BOOLEAN NOT NULL,
 "targetRoles" TEXT[] NOT NULL,
 "excludedRoles" TEXT[] NOT NULL,
 "minimumSalary" DOUBLE PRECISION,
 "currency" TEXT NOT NULL,
 "noticePeriodDays" INTEGER,
 "workAuthorization" TEXT NOT NULL,
 "skills" TEXT[] NOT NULL,
 "education" JSONB NOT NULL,
 "experience" JSONB NOT NULL,
 "projects" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CandidateProfile_ownerKey_key" ON "CandidateProfile"("ownerKey");
