// Run from the repository root; candidate data stays outside source control.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { config } from "dotenv";
import { createDatabase } from "@job-agent/database";
import { candidateProfileSchema } from "@job-agent/types";
config({ path: ".env", quiet: true });
const [profilePath, resumePath] = process.argv.slice(2);
if (!profilePath || !resumePath)
  throw new Error(
    "Usage: node apps/api/scripts/import-profile.mjs <profile.json> <resume.pdf>",
  );
const input = candidateProfileSchema.parse(
  JSON.parse(await readFile(profilePath, "utf8")),
);
const content = await readFile(resumePath);
if (
  content.subarray(0, 5).toString() !== "%PDF-" ||
  content.length > 10 * 1024 * 1024
)
  throw new Error("A PDF of at most 10 MB is required.");
const db = createDatabase(process.env.DATABASE_URL);
try {
  const previous = await db.candidateProfile.findUnique({
    where: { ownerKey: "local" },
    include: { resume: true },
  });
  if (previous) {
    await mkdir(".local/backups", { recursive: true });
    const { resume, ...profile } = previous;
    const prefix = `.local/backups/profile-${Date.now()}`;
    await writeFile(`${prefix}.json`, JSON.stringify(profile, null, 2), {
      mode: 0o600,
    });
    if (resume)
      await writeFile(`${prefix}.pdf`, resume.content, { mode: 0o600 });
  }
  const file = {
    fileName: basename(resumePath),
    mimeType: "application/pdf",
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.length,
    content,
  };
  await db.$transaction(async (tx) => {
    const profile = await tx.candidateProfile.upsert({
      where: { ownerKey: "local" },
      create: { ...input, ownerKey: "local" },
      update: input,
    });
    await tx.resume.upsert({
      where: { candidateId: profile.id },
      create: { ...file, candidateId: profile.id },
      update: file,
    });
  });
  console.log(
    "Profile and original PDF imported. Previous data, if any, was backed up under .local/backups.",
  );
} finally {
  await db.$disconnect();
}
