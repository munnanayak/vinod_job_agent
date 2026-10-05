import {
  BadRequestException,
  ConflictException,
  Injectable,
  PreconditionFailedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Database } from "./database.js";
import { JobWorkflow } from "./workflow.js";
import { digest } from "./workflow-rules.js";
import { chooseOptions, draftAnswers, standardQuestions } from "./answers.js";

// Check the provider's live listing before opening a saved application link.
// Network errors and rate limits are not evidence that a job has closed.
export async function formJobOpen(
  identity: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const [provider, board, id] = identity.split(":");
  const url =
    provider === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}`
      : provider.includes("lever.co")
        ? `https://${provider === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${encodeURIComponent(board)}/${encodeURIComponent(id)}?mode=json`
        : `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`;
  const response = await request(url, {
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok)
    throw new Error(
      `Could not check job availability (${response.status}); retry later.`,
    );
  const data = await response.json();
  if (provider === "jobs.ashbyhq.com") {
    if (!Array.isArray(data.jobs))
      throw new Error("Could not check job availability; retry later.");
    return data.jobs.some(
      (job: { id: string; isListed?: boolean }) =>
        job.id === id && job.isListed !== false,
    );
  }
  if (String(data.id) !== id)
    throw new Error("Could not check job availability; retry later.");
  return true;
}

// Job-specific binding, not just an ATS hostname. No generic site automation.
export function formTarget(
  value: string,
): { identity: string; url: string; provider: string } | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port)
      return null;
    const parts = u.pathname.split("/").filter(Boolean);
    // Greenhouse's own copy of a form that companies embed on their careers site.
    if (
      ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(
        u.hostname,
      ) &&
      u.pathname === "/embed/job_app"
    ) {
      const board = u.searchParams.get("for") ?? "",
        token = u.searchParams.get("token") ?? "";
      if (/^[a-z0-9_-]+$/i.test(board) && /^\d+$/.test(token))
        return {
          provider: "Greenhouse",
          identity: `greenhouse:${board.toLowerCase()}:${token}`,
          url: `https://job-boards.greenhouse.io/embed/job_app?for=${board.toLowerCase()}&token=${token}`,
        };
      return null;
    }
    if (
      ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(
        u.hostname,
      ) &&
      parts.length === 3 &&
      parts[1] === "jobs" &&
      /^[a-z0-9_-]+$/i.test(parts[0]) &&
      /^\d+$/.test(parts[2])
    ) {
      return {
        provider: "Greenhouse",
        identity: `greenhouse:${parts[0].toLowerCase()}:${parts[2]}`,
        url: `https://job-boards.greenhouse.io/embed/job_app?for=${parts[0].toLowerCase()}&token=${parts[2]}`,
      };
    }
    if (
      ["jobs.lever.co", "jobs.eu.lever.co", "jobs.ashbyhq.com"].includes(
        u.hostname,
      ) &&
      parts.length >= 2 &&
      parts.length <= 3 &&
      /^[a-z0-9._-]+$/i.test(parts[0]) &&
      /^[a-z0-9-]{8,}$/i.test(parts[1]) &&
      (!parts[2] || ["apply", "application"].includes(parts[2]))
    ) {
      const provider = u.hostname === "jobs.ashbyhq.com" ? "Ashby" : "Lever";
      return {
        provider,
        identity: `${u.hostname}:${parts[0].toLowerCase()}:${parts[1]}`,
        url: `https://${u.hostname}/${parts[0]}/${parts[1]}/${provider === "Lever" ? "apply" : "application"}`,
      };
    }
  } catch {}
  return null;
}

// A question with the company's name taken out, so "Have you worked at GitLab?"
// is recognised when the next company asks the same thing.
export function answerKey(question: string, company: string) {
  const name = company.trim().toLowerCase();
  let text = question.toLowerCase();
  if (name.length >= 3) text = text.split(name).join("{company}");
  return text
    .replace(/[^a-z0-9{}]+/g, " ")
    .trim()
    .slice(0, 300);
}

// Questions whose answer depends on the job's country. A form's answer to one
// of these is not reused word for word on the next form: your standing answers
// (one for India, one for other countries) decide it for each job.
export const COUNTRY_DEPENDENT =
  /authori[sz]ed|sponsor|\bvisa\b|work permit|eligible to work|right to work|legally (able|eligible|permitted)/i;

export class FormSessions {
  private entries = new Map<
    string,
    { jobId: string; fingerprint: string; identity: string; expires: number }
  >();
  discard(code: string) {
    this.entries.delete(code);
  }
  issue(
    jobId: string,
    fingerprint: string,
    identity: string,
    now = Date.now(),
  ) {
    for (const [k, v] of this.entries)
      if (v.expires <= now) this.entries.delete(k);
    if (this.entries.size >= 100)
      throw new ConflictException(
        "Too many open form preparations. Wait for older ones to expire.",
      );
    const code = randomBytes(32).toString("hex");
    this.entries.set(code, {
      jobId,
      fingerprint,
      identity,
      expires: now + 10 * 60_000,
    });
    return { code, expiresAt: new Date(now + 10 * 60_000).toISOString() };
  }
  consume(code: string, pageUrl: string, now = Date.now()) {
    const entry = this.entries.get(code);
    if (!entry || entry.expires <= now) {
      this.entries.delete(code);
      throw new BadRequestException(
        "Preparation expired or was already used. Prepare the form again.",
      );
    }
    if (formTarget(pageUrl)?.identity !== entry.identity)
      throw new BadRequestException(
        "Wrong application page. Open the exact job linked from the dashboard.",
      );
    this.entries.delete(code); // Claim synchronously, before any await.
    return entry;
  }
  consumeClosed(code: string, pageUrl: string, now = Date.now()) {
    const entry = this.entries.get(code);
    if (!entry || entry.expires <= now)
      throw new BadRequestException("Preparation expired or was already used.");
    const u = new URL(pageUrl);
    const [provider, board, id] = entry.identity.split(":");
    if (
      provider !== "greenhouse" ||
      u.protocol !== "https:" ||
      u.port ||
      u.username ||
      u.password ||
      !["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(
        u.hostname,
      ) ||
      !(
        (u.pathname === "/embed/job_board" &&
          u.searchParams.get("for")?.toLowerCase() === board) ||
        u.pathname.toLowerCase() === `/${board}`
      ) ||
      u.searchParams.get("error") !== "true"
    )
      throw new BadRequestException("Not this job's closed-listing redirect.");
    return this.consume(
      code,
      `https://job-boards.greenhouse.io/${board}/jobs/${id}`,
      now,
    );
  }
}

type Reviewed = Awaited<ReturnType<JobWorkflow["reviewedFormJob"]>>;

// When the form-specific names are not set, split the full name: first word, then the rest.
const nameParts = (name: string) => {
  const [first = "", ...rest] = name.trim().split(/\s+/);
  return { first, last: rest.join(" ") };
};

const fieldsFor = (p: Reviewed["profile"]) => ({
  name: p.name,
  firstName: p.firstName || nameParts(p.name).first,
  lastName: p.lastName || nameParts(p.name).last,
  email: p.email,
  phone: p.phone,
  portfolioUrl: p.portfolioUrl,
  githubUrl: p.githubUrl,
  linkedinUrl: p.linkedinUrl,
  currentCity: p.currentCity,
  country: p.country,
});

@Injectable()
export class FormAssistant {
  private sessions = new FormSessions();
  // After a form is filled, lets the extension report "I submitted it" for that one job.
  private reports = new Map<
    string,
    { jobId: string; company: string; expires: number }
  >();
  constructor(
    private readonly workflow: JobWorkflow,
    private readonly db: Database,
  ) {}
  private fingerprint(data: Reviewed) {
    return digest({
      job: data.job.id,
      url: data.job.url,
      profile: data.profile,
      resume: data.resume.sha256,
    });
  }
  private target(data: Reviewed) {
    // Greenhouse jobs listed on a company's own site open Greenhouse's copy of the same form.
    const { source, board, externalId, url } = data.job;
    return formTarget(
      source === "greenhouse" && board && /^\d+$/.test(externalId)
        ? `https://job-boards.greenhouse.io/${board}/jobs/${externalId}`
        : url,
    );
  }
  async prepare(jobId: string) {
    const data = await this.workflow.reviewedFormJob(jobId);
    const target = this.target(data);
    if (!target)
      throw new PreconditionFailedException(
        `${data.job.company} · ${data.job.title}: This job links to a site the Form Assistant cannot fill. It supports Greenhouse, Lever and Ashby application URLs. Use Email your CV if a confirmed hiring email is available, or open the job link and apply manually.`,
      );
    const session = this.sessions.issue(
      jobId,
      this.fingerprint(data),
      target.identity,
    );
    return {
      ...session,
      jobId,
      company: data.job.company,
      title: data.job.title,
      url: target.url,
      // The extension reads the code from the address; the page itself cannot use it.
      openUrl: `${target.url}#job-agent=${session.code}`,
      provider: target.provider,
      fields: fieldsFor(data.profile),
      resume: {
        fileName: data.resume.fileName,
        sizeBytes: data.resume.sizeBytes,
      },
      instructions:
        "Open the application. The Form Assistant fills it automatically; review every field, answer what is left, solve any CAPTCHA and submit yourself.",
    };
  }
  // Each dashboard click permits at most ten submissions, one form at a time.
  private appliedThisSession = 0;
  private applying = false;
  private sessionLimit() {
    return 10;
  }
  // Jobs you chose to skip in the form tab, so the queue doesn't offer them again.
  private passed = new Set<string>();
  /** Prepares approved jobs that have a supported application form, in queue order. */
  async batch(limit: number, restart = false) {
    if (restart) {
      this.passed.clear();
      this.appliedThisSession = 0;
      this.applying = true;
    }
    const skipped: { jobId: string; reason: string }[] = [];
    const ids = (
      await this.workflow.approvedFormJobIds((jobId, reason) =>
        skipped.push({ jobId, reason }),
      )
    ).filter((id) => !this.passed.has(id));
    const ready: Awaited<ReturnType<FormAssistant["prepare"]>>[] = [];
    const excludedCount = skipped.length;
    for (const id of ids) {
      if (ready.length >= limit) break;
      let prepared: Awaited<ReturnType<FormAssistant["prepare"]>> | undefined;
      try {
        prepared = await this.prepare(id);
        const target = formTarget(prepared.url)!;
        if (!(await formJobOpen(target.identity))) {
          this.sessions.discard(prepared.code);
          this.passed.add(id);
          skipped.push({ jobId: id, reason: "This job is no longer open." });
          continue;
        }
        ready.push(prepared);
      } catch (e) {
        if (prepared) this.sessions.discard(prepared.code);
        this.passed.add(id);
        skipped.push({ jobId: id, reason: (e as Error).message });
      }
    }
    return {
      ready,
      skipped,
      remaining: Math.max(
        0,
        ids.length - ready.length - (skipped.length - excludedCount),
      ),
    };
  }
  async claim(code: string, pageUrl: string, questions: string[] = []) {
    const session = this.sessions.consume(code, pageUrl);
    // Recheck live sheet approval and the exact profile/CV immediately before use.
    const data = await this.workflow.reviewedFormJob(session.jobId);
    if (this.fingerprint(data) !== session.fingerprint)
      throw new ConflictException(
        "Profile, CV or application changed. Prepare the form again.",
      );
    const reportToken = randomBytes(32).toString("hex");
    const now = Date.now();
    for (const [k, v] of this.reports)
      if (v.expires <= now) this.reports.delete(k);
    this.reports.set(reportToken, {
      jobId: session.jobId,
      company: data.job.company,
      expires: now + 3 * 3_600_000,
    });
    // Answers that came from your own standing answers, matched by meaning.
    const remembered: string[] = [];
    const answers = await draftAnswers(
      data.profile,
      {
        ...data.job,
        appliedBefore: await this.appliedTo(data.job.company),
      },
      questions,
      await this.bank(),
      remembered,
    );
    // The same question answered on an earlier form wins over anything drafted.
    try {
      const keys = new Map(
        questions.map((q) => [answerKey(q, data.job.company), q]),
      );
      keys.delete("");
      const saved = await this.db.client.savedAnswer.findMany({
        where: { key: { in: [...keys.keys()] } },
      });
      for (const item of saved) {
        const question = keys.get(item.key)!;
        if (COUNTRY_DEPENDENT.test(question)) continue;
        answers[question] = item.answer;
        if (!remembered.includes(question)) remembered.push(question);
      }
    } catch {
      // Saved answers are optional; the form is still filled from the profile.
    }
    return {
      identity: session.identity,
      reportToken,
      fields: fieldsFor(data.profile),
      answers,
      remembered,
      resume: {
        fileName: data.resume.fileName,
        mimeType: "application/pdf",
        base64: Buffer.from(data.resume.content).toString("base64"),
      },
    };
  }
  async submitted(reportToken: string) {
    const report = this.reports.get(reportToken);
    if (!report || report.expires <= Date.now())
      throw new BadRequestException(
        "This form session expired. Mark it applied in the dashboard.",
      );
    this.reports.delete(reportToken);
    try {
      await this.workflow.markFormSubmitted(report.jobId);
    } catch (error) {
      this.reports.set(reportToken, report);
      throw error;
    }
    this.passed.add(report.jobId);
    this.appliedThisSession++;
    if (this.appliedThisSession >= this.sessionLimit()) {
      this.applying = false;
      return { ok: true, next: null, paused: this.appliedThisSession };
    }
    return { ok: true, next: await this.next() };
  }
  /** Chooses among a dropdown's options when your profile determines the answer. */
  async options(
    reportToken: string,
    questions: { question: string; options: string[] }[],
  ) {
    const report = this.reports.get(reportToken);
    if (!report || report.expires <= Date.now())
      throw new BadRequestException("This form session expired.");
    const data = await this.workflow.reviewedFormJob(report.jobId);
    return chooseOptions(
      data.profile,
      {
        ...data.job,
        appliedBefore: await this.appliedTo(data.job.company),
      },
      questions,
      await this.bank(),
    );
  }
  // Whether an application to this company is already recorded here.
  private async appliedTo(company: string) {
    try {
      return (
        (await this.db.client.jobApplication.count({
          where: {
            status: { in: ["SENT", "REPLIED", "APPLIED_MANUALLY"] },
            job: { company: { equals: company, mode: "insensitive" } },
          },
        })) > 0
      );
    } catch {
      return false;
    }
  }
  // Everything you have answered yourself: on the dashboard or on earlier forms.
  private async bank() {
    try {
      return await this.db.client.savedAnswer.findMany({
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: { question: true, answer: true },
      });
    } catch {
      return [];
    }
  }
  /** Your standing answers, plus common questions you have not answered yet. */
  async standing() {
    const saved = await this.db.client.savedAnswer.findMany({
      orderBy: { question: "asc" },
    });
    const profile = await this.db.client.candidateProfile.findUnique({
      where: { ownerKey: "local" },
    });
    const known = new Set(saved.map((s) => s.key));
    return {
      saved: saved.map(({ question, answer }) => ({ question, answer })),
      standard: profile
        ? standardQuestions(profile).filter(
            (s) => !known.has(answerKey(s.question, "")),
          )
        : [],
    };
  }
  /** Saves answers from the dashboard; an empty answer deletes that question. */
  async saveStanding(entries: { question: string; answer: string }[]) {
    for (const { question, answer } of entries) {
      const key = answerKey(question, "");
      if (!key) continue;
      if (!answer.trim())
        await this.db.client.savedAnswer.deleteMany({ where: { key } });
      else
        await this.db.client.savedAnswer.upsert({
          where: { key },
          create: { key, question, answer: answer.trim() },
          update: { question, answer: answer.trim() },
        });
    }
    return this.standing();
  }
  /** Stores what you answered on a form, for the next form that asks the same question. */
  async remember(
    reportToken: string,
    entries: { question: string; answer: string }[],
  ) {
    const report = this.reports.get(reportToken);
    if (!report || report.expires <= Date.now())
      throw new BadRequestException("This form session expired.");
    let saved = 0;
    for (const { question, answer } of entries) {
      const key = answerKey(question, report.company);
      if (!key || COUNTRY_DEPENDENT.test(question)) continue;
      await this.db.client.savedAnswer.upsert({
        where: { key },
        create: { key, question, answer },
        update: { question, answer },
      });
      saved++;
    }
    return { ok: true, saved };
  }
  /** You chose not to apply to the job in this tab: move on to the next one. */
  async skip(reportToken: string) {
    const report = this.reports.get(reportToken);
    if (!report || report.expires <= Date.now())
      throw new BadRequestException("This form session expired.");
    this.reports.delete(reportToken);
    this.passed.add(report.jobId);
    return { ok: true, next: await this.next() };
  }
  async closed(code: string, pageUrl: string) {
    const session = this.sessions.consumeClosed(code, pageUrl);
    this.passed.add(session.jobId);
    return { ok: true, next: await this.next() };
  }
  // The next approved job's one-use link, so the same tab can continue the queue.
  private async next() {
    if (!this.applying || this.appliedThisSession >= this.sessionLimit())
      return null;
    try {
      return (await this.batch(1)).ready[0]?.openUrl ?? null;
    } catch {
      return null;
    }
  }
}
