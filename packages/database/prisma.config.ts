import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";
config({ path: "../../.env" });
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DIRECT_URL?.trim() || env("DATABASE_URL") },
});
