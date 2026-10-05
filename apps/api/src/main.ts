import "reflect-metadata";
import { config } from "dotenv";
import {
  BadRequestException,
  NotFoundException,
  StreamableFile,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Put,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ApiErrors } from "./api-errors.js";
import { Database } from "./database.js";
import { GoogleIntegration } from "./google.js";
import { FormAssistant } from "./forms.js";
import { JobWorkflow } from "./workflow.js";
import { WorkflowController } from "./workflow.controller.js";
import { candidateProfileSchema } from "@job-agent/types";
config({ path: "../../.env" });
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.",
  );
@Controller()
class ProfileController {
  constructor(private readonly db: Database) {}
  @Get("health")
  async health() {
    try {
      await this.db.client.$queryRaw`SELECT 1`;
      return { status: "ok", database: "connected" };
    } catch {
      throw new ServiceUnavailableException("Database unavailable");
    }
  }
  @Get("resume")
  async resume() {
    const resume = await this.db.client.resume.findFirst({
      where: { candidate: { ownerKey: "local" } },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
        updatedAt: true,
      },
    });
    return { resume };
  }
  @Get("resume/file")
  async resumeFile() {
    const resume = await this.db.client.resume.findFirst({
      where: { candidate: { ownerKey: "local" } },
    });
    if (!resume)
      throw new NotFoundException("No resume has been imported yet.");
    return new StreamableFile(Buffer.from(resume.content), {
      type: "application/pdf",
      disposition: `attachment; filename="${resume.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      length: resume.sizeBytes,
    });
  }
  @Get("profile")
  async read() {
    const profile = await this.db.client.candidateProfile.findUnique({
      where: { ownerKey: "local" },
    });
    if (!profile) return { profile: null };
    const { ownerKey, ...result } = profile;
    return { profile: result };
  }
  @Put("profile")
  async save(@Body() body: unknown) {
    const parsed = candidateProfileSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({
        message: "Please check your profile fields.",
        issues: parsed.error.issues,
      });
    const { ownerKey, ...profile } =
      await this.db.client.candidateProfile.upsert({
        where: { ownerKey: "local" },
        create: { ...parsed.data, ownerKey: "local" },
        update: parsed.data,
      });
    return { profile };
  }
}
@Module({
  controllers: [ProfileController, WorkflowController],
  providers: [Database, GoogleIntegration, JobWorkflow, FormAssistant],
})
class AppModule {}
const app = await NestFactory.create(AppModule);
app.useGlobalFilters(new ApiErrors());
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
const allowOrigin = (origin: string) => {
  if (!origin) return true;
  const origins = new Set(
    [
      process.env.APP_URL,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      ...(process.env.CORS_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      ...(process.env.RENDER_EXTERNAL_HOSTNAME
        ? [`https://${process.env.RENDER_EXTERNAL_HOSTNAME}`]
        : []),
      ...(process.env.API_PUBLIC_URL
        ? [new URL(process.env.API_PUBLIC_URL).origin]
        : []),
      ...(process.env.FRONTEND_URL
        ? [new URL(process.env.FRONTEND_URL).origin]
        : []),
    ].filter(Boolean) as string[],
  );
  if (origins.has(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".onrender.com") ||
      host.endsWith(".render.com")
    );
  } catch {
    return false;
  }
};
app.setGlobalPrefix("api");
app.enableCors(
  (
    req: { url: string; headers: Record<string, string | undefined> },
    callback: (error: Error | null, options: object) => void,
  ) => {
    const origin = req.headers.origin ?? "";
    const extensionClaim =
      /^\/api\/workflow\/forms\/(claim|closed|submitted|skip|answers|options)$/.test(
        req.url,
      ) && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    const allow = extensionClaim || allowOrigin(origin);
    callback(null, {
      origin: allow ? origin || true : false,
      methods: ["GET", "PUT", "POST", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "X-Job-Agent",
        "X-Job-Agent-Form-Token",
        "Authorization",
      ],
      credentials: true,
    });
  },
);
// Require a custom header for mutations, and accept only trusted frontend origins.
// This blocks cross-site forms/fetches from triggering local publication.
app.use(
  (
    req: {
      url: string;
      method: string;
      headers: Record<string, string | undefined>;
    },
    res: { status: (n: number) => { json: (v: unknown) => void } },
    next: () => void,
  ) => {
    const origin = req.headers.origin ?? "";
    const hosts = new Set([
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      ...(process.env.RENDER_EXTERNAL_HOSTNAME
        ? [process.env.RENDER_EXTERNAL_HOSTNAME]
        : []),
      ...(process.env.API_PUBLIC_URL
        ? [new URL(process.env.API_PUBLIC_URL).host]
        : []),
      ...(process.env.FRONTEND_URL
        ? [new URL(process.env.FRONTEND_URL).host]
        : []),
    ]);
    if (!hosts.has(req.headers.host ?? ""))
      return res.status(403).json({ message: "Unrecognized host" });
    const extensionClaim =
      /^\/api\/workflow\/forms\/(claim|closed|submitted|skip|answers|options)$/.test(
        req.url,
      ) &&
      req.method === "POST" &&
      /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin ?? "") &&
      /^[a-f0-9]{64}$/.test(req.headers["x-job-agent-form-token"] ?? "");
    if (
      !extensionClaim &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.headers["x-job-agent"] !== "1" || (origin && !allowOrigin(origin)))
    ) {
      return res
        .status(403)
        .json({ message: "Use the Job Agent dashboard for this action" });
    }
    next();
  },
);
app.enableShutdownHooks();
await app.listen(port, process.env.PORT ? "0.0.0.0" : "127.0.0.1");
