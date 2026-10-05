import "../apps/api/node_modules/reflect-metadata/Reflect.js";
import { mkdir, writeFile } from "node:fs/promises";
import { Database } from "../apps/api/dist/database.js";
import { GoogleIntegration } from "../apps/api/dist/google.js";
import {
  experienceFits,
  experienceRequirements,
} from "../apps/api/dist/experience.js";
import { parseReviewRows } from "../apps/api/dist/workflow-rules.js";

process.loadEnvFile(new URL("../.env", import.meta.url));
const expectedId = process.argv.find((a) => a.startsWith("--sheet="))?.slice(8);
if (
  !expectedId ||
  !process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.includes(expectedId)
)
  throw new Error(
    "Pass --sheet=<expected spreadsheet ID> matching the configured sheet.",
  );
const db = new Database();
try {
  const google = new GoogleIntegration(db);
  await db.client.$transaction(
    async (tx) => {
      const [lock] =
        await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(4815162342::bigint) AS acquired`;
      if (!lock.acquired)
        throw new Error("Discovery is running. Retry once it finishes.");
      const rows = await google.readSheet();
      parseReviewRows(rows);
      const jobs = await tx.jobOpening.findMany({
        where: { id: { in: rows.slice(1).map((r) => r[0]) } },
      });
      const byId = new Map(jobs.map((j) => [j.id, j]));
      const excluded = rows.flatMap((row, index) => {
        const job = byId.get(row[0]);
        return index && job && !experienceFits(job.description)
          ? [
              {
                index,
                id: job.id,
                title: job.title,
                review: row[1],
                requirements: experienceRequirements(job.description),
                row,
              },
            ]
          : [];
      });
      console.log(
        JSON.stringify({
          jobsBefore: rows.length - 1,
          remove: excluded.length,
          approvedRemoved: excluded.filter((j) => j.review === "APPROVED")
            .length,
          apply: process.argv.includes("--apply"),
        }),
      );
      if (!process.argv.includes("--apply") || !excluded.length) return;
      await mkdir(new URL("../.local/backups/", import.meta.url), {
        recursive: true,
      });
      const backup = new URL(
        `../.local/backups/sheet-experience-${Date.now()}.json`,
        import.meta.url,
      );
      await writeFile(
        backup,
        JSON.stringify({ spreadsheetId: expectedId, rows, excluded }, null, 2),
        { mode: 0o600 },
      );
      const current = await google.readSheet();
      if (JSON.stringify(current) !== JSON.stringify(rows))
        throw new Error("Sheet changed during audit. Retry with fresh rows.");
      await google.deleteSheetRows(excluded.map((j) => j.index));
      const remaining = await google.readSheet();
      const expected = rows.filter(
        (_, i) => !excluded.some((j) => j.index === i),
      );
      if (JSON.stringify(remaining) !== JSON.stringify(expected))
        throw new Error(
          "Verification mismatch. Inspect the backup and current sheet.",
        );
      console.log(
        JSON.stringify({
          removed: excluded.length,
          remaining: remaining.length - 1,
          backup: backup.pathname,
        }),
      );
    },
    { timeout: 120000 },
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await db.client.$disconnect();
}
