import { existsSync } from "node:fs";
const root = new URL("../", import.meta.url);
const env = new URL(".env", root);
if (existsSync(env)) process.loadEnvFile(env);
let problems = 0;
for (const key of [
  "DATABASE_URL",
  "ADZUNA_APP_ID",
  "ADZUNA_APP_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "SERPAPI_API_KEY",
]) {
  console.log(
    `${key}: ${process.env[key]?.trim() ? "configured (not validated)" : "not configured"}`,
  );
}
const base = `http://127.0.0.1:${process.env.API_PORT || 3000}/api`;
for (const path of ["health", "integrations/google/status", "workflow"]) {
  try {
    const response = await fetch(`${base}/${path}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (path === "health") console.log(`Database: ${data.database}`);
    if (path === "integrations/google/status")
      console.log(
        `Gmail: ${data.connected ? (data.needsReconnect ? "reconnect required" : "connected") : "not connected"}`,
      );
    if (path === "workflow") {
      console.log(
        `Discovery: ${data.settings.locationScope}; ${data.settings.adzunaCountries.length} Adzuna markets; ${data.queued} queued jobs`,
      );
      console.log(
        `Schedule: ${data.settings.runEveryHours ? `every ${data.settings.runEveryHours} hours while a scheduler is running` : "disabled"}`,
      );
      for (const source of data.sourceHealth)
        console.log(
          `${source.board}: ${source.enabled ? "enabled" : "disabled"}; last scan ${source.lastScannedAt || "never"}; ${source.lastError || "no recorded error"}`,
        );
    }
  } catch (error) {
    problems++;
    console.log(
      `${path}: unavailable (${error instanceof Error ? error.message : "request failed"})`,
    );
  }
}
process.exitCode = problems ? 1 : 0;
