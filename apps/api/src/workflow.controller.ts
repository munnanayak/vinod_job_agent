import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Redirect,
  Res,
} from "@nestjs/common";
import { GoogleIntegration } from "./google.js";
import { FormAssistant } from "./forms.js";
import { JobWorkflow } from "./workflow.js";

const app = () => process.env.APP_URL ?? "http://localhost:5173";

@Controller()
export class WorkflowController {
  constructor(
    private readonly google: GoogleIntegration,
    private readonly workflow: JobWorkflow,
    private readonly forms: FormAssistant,
  ) {}

  @Get("integrations/google/status")
  status() {
    return this.google.status();
  }

  @Get("integrations/google/connect")
  @Redirect()
  connect(
    @Res({ passthrough: true })
    response: {
      setHeader: (name: string, value: string) => void;
    },
  ) {
    const url = this.google.authUrl();
    const state = new URL(url).searchParams.get("state");
    response.setHeader(
      "Set-Cookie",
      `job_agent_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/integrations/google; Max-Age=600`,
    );
    return { url };
  }

  @Get("integrations/google/callback")
  @Redirect()
  async callback(
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
    @Headers("cookie") cookie?: string,
    @Res({ passthrough: true })
    response?: { setHeader: (name: string, value: string) => void },
  ) {
    try {
      if (error) throw new Error(`Google sign-in was cancelled (${error}).`);
      const browserState = /(?:^|;\s*)job_agent_oauth=([a-f0-9]+)/.exec(
        cookie ?? "",
      )?.[1];
      response?.setHeader(
        "Set-Cookie",
        "job_agent_oauth=; HttpOnly; SameSite=Lax; Path=/api/integrations/google; Max-Age=0",
      );
      await this.google.complete(code, state, browserState);
      return { url: `${app()}/?google=connected` };
    } catch (e) {
      const message =
        (e as { response?: { message?: string } }).response?.message ??
        (e as Error).message;
      return {
        url: `${app()}/?google=error&message=${encodeURIComponent(message)}`,
      };
    }
  }

  @Post("integrations/google/disconnect")
  async disconnect() {
    await this.google.disconnect();
    return { connected: false };
  }

  @Get("workflow")
  overview() {
    return this.workflow.overview();
  }

  @Get("workflow/answers")
  answers() {
    return this.forms.standing();
  }

  @Put("workflow/answers")
  saveAnswers(@Body() body: { answers?: unknown }) {
    const entries = (Array.isArray(body?.answers) ? body.answers : [])
      .filter(
        (e): e is { question: string; answer: string } =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as { question?: unknown }).question === "string" &&
          typeof (e as { answer?: unknown }).answer === "string" &&
          (e as { question: string }).question.length <= 500 &&
          (e as { answer: string }).answer.length <= 500,
      )
      .slice(0, 300)
      .map(({ question, answer }) => ({ question, answer }));
    return this.forms.saveStanding(entries);
  }

  @Post("workflow/forms/prepare/:jobId")
  prepareForm(@Param("jobId") jobId: string) {
    return this.forms.prepare(jobId);
  }

  @Post("workflow/forms/batch")
  batchForms(@Body() body: { limit?: unknown; restart?: unknown }) {
    const limit =
      typeof body?.limit === "number" && Number.isFinite(body.limit)
        ? Math.min(Math.max(1, Math.floor(body.limit)), 25)
        : 10;
    return this.forms.batch(limit, body?.restart === true);
  }

  // Called only by the Form Assistant extension (see the origin check in main.ts).
  @Post("workflow/forms/claim")
  claimForm(
    @Headers("x-job-agent-form-token") token: string,
    @Body() body: { pageUrl?: unknown; questions?: unknown },
  ) {
    const questions = Array.isArray(body?.questions)
      ? body.questions
          .filter((q): q is string => typeof q === "string" && q.length <= 500)
          .slice(0, 80)
      : [];
    if (
      !/^[a-f0-9]{64}$/.test(token ?? "") ||
      typeof body?.pageUrl !== "string" ||
      body.pageUrl.length > 2000
    )
      throw new BadRequestException("Invalid preparation code or page URL.");
    return this.forms.claim(token, body.pageUrl, questions);
  }

  @Post("workflow/forms/submitted")
  formSubmitted(@Headers("x-job-agent-form-token") token: string) {
    if (!/^[a-f0-9]{64}$/.test(token ?? ""))
      throw new BadRequestException("Invalid form session.");
    return this.forms.submitted(token);
  }

  @Post("workflow/forms/closed")
  formClosed(
    @Headers("x-job-agent-form-token") token: string,
    @Body() body: { pageUrl?: unknown },
  ) {
    if (
      !/^[a-f0-9]{64}$/.test(token ?? "") ||
      typeof body?.pageUrl !== "string" ||
      body.pageUrl.length > 2000
    )
      throw new BadRequestException("Invalid preparation code or page URL.");
    return this.forms.closed(token, body.pageUrl);
  }

  @Post("workflow/forms/answers")
  formAnswers(
    @Headers("x-job-agent-form-token") token: string,
    @Body() body: { answers?: unknown },
  ) {
    if (!/^[a-f0-9]{64}$/.test(token ?? ""))
      throw new BadRequestException("Invalid form session.");
    const text = (v: unknown, max: number): v is string =>
      typeof v === "string" && v.trim().length > 0 && v.length <= max;
    const entries = (Array.isArray(body?.answers) ? body.answers : [])
      .filter(
        (e): e is { question: string; answer: string } =>
          typeof e === "object" &&
          e !== null &&
          text((e as { question?: unknown }).question, 500) &&
          text((e as { answer?: unknown }).answer, 500),
      )
      .slice(0, 80)
      .map(({ question, answer }) => ({ question, answer }));
    return this.forms.remember(token, entries);
  }

  @Post("workflow/forms/options")
  formOptions(
    @Headers("x-job-agent-form-token") token: string,
    @Body() body: { questions?: unknown },
  ) {
    if (!/^[a-f0-9]{64}$/.test(token ?? ""))
      throw new BadRequestException("Invalid form session.");
    const short = (v: unknown): v is string =>
      typeof v === "string" && v.trim().length > 0 && v.length <= 300;
    const questions = (Array.isArray(body?.questions) ? body.questions : [])
      .filter(
        (q): q is { question: string; options: string[] } =>
          typeof q === "object" &&
          q !== null &&
          short((q as { question?: unknown }).question) &&
          Array.isArray((q as { options?: unknown }).options) &&
          (q as { options: unknown[] }).options.length <= 200 &&
          (q as { options: unknown[] }).options.every(short),
      )
      .slice(0, 30)
      .map(({ question, options }) => ({ question, options }));
    return this.forms.options(token, questions);
  }

  @Post("workflow/forms/skip")
  formSkipped(@Headers("x-job-agent-form-token") token: string) {
    if (!/^[a-f0-9]{64}$/.test(token ?? ""))
      throw new BadRequestException("Invalid form session.");
    return this.forms.skip(token);
  }

  @Post("workflow/run")
  run() {
    return this.workflow.run("manual");
  }

  @Post("workflow/discover")
  discover() {
    return this.workflow.discover();
  }

  @Post("workflow/export")
  export() {
    return this.workflow.export();
  }

  @Post("workflow/preview")
  preview() {
    return this.workflow.preview();
  }

  @Post("workflow/publish/:batchId")
  publish(
    @Param("batchId") batchId: string,
    @Body() body: { fingerprint?: unknown },
  ) {
    if (typeof body?.fingerprint !== "string")
      throw new BadRequestException("Missing preview fingerprint.");
    return this.workflow.publish(batchId, body.fingerprint);
  }

  @Post("workflow/replies")
  replies() {
    return this.workflow.checkReplies();
  }

  @Post("workflow/applications/:id/applied")
  async applied(@Param("id") id: string) {
    await this.workflow.markApplied(id);
    return { ok: true };
  }
}
