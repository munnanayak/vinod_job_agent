CREATE TABLE "SavedAnswer" (
    "key" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedAnswer_pkey" PRIMARY KEY ("key")
);
