import "reflect-metadata";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Database } from "./database.js";
import { GoogleIntegration } from "./google.js";
import { JobWorkflow } from "./workflow.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
// This process owns its loop; the API's optional embedded scheduler can coexist.
process.env.SCHEDULER_ENABLED = "false";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
@Module({ providers: [Database, GoogleIntegration, JobWorkflow] })
class WorkerModule {}
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
const workflow = app.get(JobWorkflow);
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
try {
  do {
    try {
      await workflow.scheduledRun();
    } catch {
      console.error(
        "Scheduled run failed; check database connectivity and the dashboard run history.",
      );
    }
    if (process.argv.includes("--once")) break;
    // Small waits keep signal handling responsive.
    for (let seconds = 0; seconds < 600 && !stopping; seconds++)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopping);
} finally {
  await app.close();
}
