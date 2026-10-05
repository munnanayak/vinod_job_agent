import { apiUrl } from "./api-url";
import React, { useEffect, useState } from "react";

type Status = {
  connected: boolean;
  needsReconnect?: boolean;
  email: string | null;
  sheetUrl: string | null;
};
type Overview = {
  pendingExport: number;
  queued: number;
  sourceHealth: {
    board: string;
    enabled: boolean;
    lastScannedAt: string | null;
    lastError: string;
  }[];
  jobs: {
    id: string;
    company: string;
    title: string;
    location: string;
    url: string;
    email: string;
    matchScore: number | null;
    matchReason: string;
    sheetExportedAt: string | null;
    application: { status: string } | null;
  }[];
  applications: {
    id: string;
    status: string;
    recipient: string;
    detail: string;
    updatedAt: string;
    job: { id: string; company: string; title: string; url: string };
  }[];
  notifications: {
    id: string;
    title: string;
    snippet: string;
    createdAt: string;
  }[];
  runs: {
    id: string;
    trigger: string;
    startedAt: string;
    finishedAt: string | null;
    error: string;
    summary: RunSummary | null;
  }[];
  boards: number;
  sentToday: number;
  running: boolean;
  settings: {
    autoSend: boolean;
    minScore: number;
    dailyCap: number;
    runEveryHours: number;
    discoveryLimit: number;
    locationScope: string;
    adzunaConfigured: boolean;
    adzunaCountries: string[];
    googleJobsConfigured: boolean;
    googleCountries: string[];
  };
};
type RunSummary = {
  discovery: {
    boardsScanned: number;
    aggregators: string[];
    newBoards: number;
    scanned: number;
    relevant: number;
    added: number;
    withEmail: number;
    linkedIn?: {
      emails: number;
      jobs: number;
      added: number;
      foundOnCompanyBoard: number;
      note: string;
    };
    errors: string[];
  };
  sending: {
    sent: string[];
    failed: string[];
    skipped: number;
    capReached: boolean;
  };
  sheet: { exported?: number; error?: string; rowsWithoutId?: number } | null;
  replies: { newReplies: number } | null;
};
type Batch = {
  ready: {
    jobId: string;
    company: string;
    title: string;
    provider: string;
    openUrl: string;
    expiresAt: string;
  }[];
  skipped: { jobId: string; reason: string }[];
  remaining: number;
};
type Preview = {
  batchId: string;
  fingerprint: string;
  expiresAt: string;
  sender: string;
  resume: { fileName: string; sizeBytes: number };
  counts: { approved: number; pending: number; rejected: number; rows: number };
  items: {
    jobId: string;
    company: string;
    title: string;
    url: string;
    method: "EMAIL" | "MANUAL";
    note: string;
    recipient: string;
    subject: string;
    body: string;
  }[];
  excluded: { jobId: string; company: string; title: string; reason: string }[];
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Job-Agent": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join(", ")
      : data.message;
    throw new Error(message || `Request failed (${response.status})`);
  }
  return data as T;
}

const labels: Record<string, string> = {
  SENT: "Sent",
  SENDING: "Sending",
  FAILED: "Failed",
  SEND_UNCERTAIN: "Check Gmail — delivery uncertain",
  REPLIED: "Replied",
  MANUAL_ACTION_REQUIRED: "Waiting for you to apply",
  APPLIED_MANUALLY: "Applied manually",
};

export function Workflow() {
  const [status, setStatus] = useState<Status | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [prepared, setPrepared] = useState<{
    code: string;
    expiresAt: string;
    company: string;
    title: string;
    url: string;
    openUrl: string;
    provider: string;
    fields: {
      name: string;
      email: string;
      phone: string;
      portfolioUrl: string;
      githubUrl: string;
    };
    resume: { fileName: string; sizeBytes: number };
    instructions: string;
  } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(() => {
    try {
      return localStorage.getItem("job-agent-auto-submit") === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    try {
      const [s, o] = await Promise.all([
        api<Status>("integrations/google/status"),
        api<Overview>("workflow"),
      ]);
      setStatus(s);
      setOverview(o);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("google") === "connected")
      setNotice("Google account connected.");
    if (params.get("google") === "error")
      setError(params.get("message") ?? "Google sign-in failed.");
    if (params.has("google")) history.replaceState(null, "", location.pathname);
    void refresh();
    // Applications finish in other tabs: keep the counts and tracking list current.
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, []);

  // Results and messages can be off-screen when a button is clicked: bring them into view.
  const reveal = (id?: string) =>
    setTimeout(() => {
      const target = id && document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }, 50);

  async function run(name: string, work: () => Promise<string | void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const message = await work();
      if (message) {
        setNotice(message);
        reveal();
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      reveal();
    } finally {
      setBusy("");
    }
  }

  const runAgent = () =>
    run("agent", async () => {
      const r = await api<RunSummary>("workflow/run", {});
      const added = r.discovery.added;
      if (!added)
        return r.discovery.scanned
          ? `Checked ${r.discovery.scanned} postings: no new matching jobs this time.`
          : "No new jobs: every source was already checked in the last few hours. Try again later.";
      return (
        `Found ${added} new job${added === 1 ? "" : "s"}` +
        (r.sheet?.exported !== undefined
          ? ` and added ${r.sheet.exported} to your sheet.` +
            (r.sheet.rowsWithoutId
              ? ` ${r.sheet.rowsWithoutId} non-empty sheet row(s) still need a Job ID before previewing.`
              : "") +
            " Next: approve the ones you want in the sheet (step 2)."
          : r.sheet?.error
            ? `, but the sheet could not be updated: ${r.sheet.error}`
            : ". Connect Google to send them to your review sheet.")
      );
    });
  const exportSheet = () =>
    run("export", async () => {
      const r = await api<{ exported: number; rowsWithoutId: number }>(
        "workflow/export",
        {},
      );
      return (
        `${r.exported} rows added to your sheet.` +
        (r.rowsWithoutId
          ? ` ${r.rowsWithoutId} non-empty sheet row(s) still need a Job ID before previewing.`
          : "") +
        " Review them there, then preview."
      );
    });
  const makePreview = () =>
    run("preview", async () => {
      setPreview(null);
      setPreview(await api<Preview>("workflow/preview", {}));
      reveal("email-preview");
    });
  const publish = () => {
    if (!preview) return;
    const emails = preview.items.filter((i) => i.method === "EMAIL").length;
    const manual = preview.items.length - emails;
    if (
      !confirm(
        `Send ${emails} email application(s) with your CV, and record ${manual} manual application task(s)?`,
      )
    )
      return;
    void run("publish", async () => {
      const r = await api<{ results: { status: string }[] }>(
        `workflow/publish/${preview.batchId}`,
        {
          fingerprint: preview.fingerprint,
        },
      );
      setPreview(null);
      const count = (s: string) =>
        r.results.filter((x) => x.status === s).length;
      return `Published: ${count("SENT")} sent, ${count("MANUAL_ACTION_REQUIRED")} manual, ${count("SEND_UNCERTAIN")} delivery uncertain, ${count("SKIPPED")} already submitted.`;
    });
  };
  const replies = () =>
    run("replies", async () => {
      const r = await api<{ checked: number; newReplies: number }>(
        "workflow/replies",
        {},
      );
      return `Checked ${r.checked} sent application(s); ${r.newReplies} new repl${r.newReplies === 1 ? "y" : "ies"}.`;
    });

  const startApplying = () => {
    // Opened during the click so Chrome allows it; pointed at the job once it is prepared.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      setError(
        "Chrome blocked the new tab. Allow pop-ups for this page (icon at the right of the address bar), then click Start applying again.",
      );
      reveal();
      return;
    }
    void run("batch", async () => {
      setBatch(null);
      try {
        const r = await api<Batch>("workflow/forms/batch", {
          limit: 1,
          restart: true,
        });
        setBatch(r);
        const first = r.ready[0];
        if (!first) {
          tab.close();
          return r.skipped.length
            ? `None of your approved jobs could be prepared: ${r.skipped[0].reason}`
            : "No approved jobs with a supported application form. Approve Greenhouse, Lever or Ashby jobs in your sheet first.";
        }
        tab.opener = null;
        tab.location.href = first.openUrl + (autoSubmit ? "&auto=1" : "");
        return `Opened ${first.title} · ${first.company} in a new tab. ${r.remaining} more approved job(s) will follow in that same tab, one after another.`;
      } catch (e) {
        tab.close();
        throw e;
      }
    });
  };
  const prepareForm = (jobId: string) =>
    run("form", async () => {
      setPrepared(null);
      setPrepared(await api("workflow/forms/prepare/" + jobId, {}));
    });

  const connected = Boolean(status?.connected);
  const jobs = overview?.jobs ?? [];
  const applications = overview?.applications ?? [];
  const applied = applications.filter((a) =>
    ["SENT", "REPLIED", "APPLIED_MANUALLY"].includes(a.status),
  ).length;
  const waiting = applications.filter(
    (a) => a.status === "MANUAL_ACTION_REQUIRED",
  ).length;
  const previewEmails =
    preview?.items.filter((i) => i.method === "EMAIL").length ?? 0;
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}

      <div className="stats four">
        <article>
          <span>Jobs found</span>
          <strong>
            {jobs.length}
            {jobs.length === 100 ? "+" : ""}
          </strong>
          <small>Matching your profile</small>
        </article>
        <article>
          <span>Applied</span>
          <strong>{applied}</strong>
          <small>Emails sent and forms you submitted</small>
        </article>
        <article>
          <span>Waiting for you</span>
          <strong>{waiting}</strong>
          <small>Approved, not applied yet</small>
        </article>
        <article>
          <span>Recruiter replies</span>
          <strong>{overview?.notifications.length ?? 0}</strong>
          <small>Found in your Gmail</small>
        </article>
      </div>

      <section className="panel account">
        {status?.needsReconnect && (
          <div className="error" role="alert">
            To read your LinkedIn job alerts, Job Agent needs read-only Gmail
            access. Click <strong>Disconnect</strong>, then{" "}
            <strong>Connect Google</strong> and tick every permission.
          </div>
        )}
        {connected ? (
          <div className="row">
            <p>
              <span className="dot" />
              Google connected as <strong>{status?.email}</strong>
            </p>
            <button
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  "disconnect",
                  async () =>
                    void (await api("integrations/google/disconnect", {})),
                )
              }
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="row">
            <p>
              Connect Google first. The agent uses your Google Sheet as the
              review list and your Gmail to send approved applications.
            </p>
            <a
              className="button primary"
              href={apiUrl("integrations/google/connect")}
            >
              Connect Google
            </a>
          </div>
        )}
      </section>

      <ol className="flow">
        <li className="panel">
          <span className="num">1</span>
          <div>
            <div className="row">
              <div>
                <span className="eyebrow">STEP 1 · THE AGENT DOES THIS</span>
                <h2>Find new jobs</h2>
              </div>
              <button
                className="primary"
                disabled={Boolean(busy) || overview?.running}
                onClick={runAgent}
              >
                {busy === "agent" || overview?.running
                  ? "Searching…"
                  : "Find new jobs"}
              </button>
            </div>
            <p>
              Searches {overview?.boards ?? "the"} company job boards, Hacker
              News, Himalayas, RemoteOK, Remotive and your LinkedIn and Naukri
              job-alert emails, plus configured Adzuna and Google Jobs markets.
              Roles come from your profile.{" "}
              {overview?.settings.locationScope === "worldwide"
                ? "Worldwide discovery includes relocation opportunities; review location and work authorization before applying."
                : "Discovery follows your profile location preferences."}{" "}
              Jobs are added to your Google Sheet when connected. This step
              never applies to anything.
              {overview?.settings.runEveryHours
                ? ` It also runs by itself every ${overview.settings.runEveryHours} hours while the API is running and the computer is awake.`
                : ""}
            </p>
            <p>
              Adzuna:{" "}
              {overview?.settings.adzunaConfigured
                ? `${overview.settings.adzunaCountries.length} markets, rotated within request limits`
                : "needs ADZUNA_APP_ID and ADZUNA_APP_KEY"}
              . Google Jobs:{" "}
              {overview?.settings.googleJobsConfigured
                ? `${overview.settings.googleCountries.length} markets via SerpApi`
                : "needs SERPAPI_API_KEY"}
              . {overview?.queued ?? 0} fetched jobs waiting for processing.
            </p>
            {overview?.sourceHealth?.map((source) => (
              <small className="run" key={source.board}>
                {source.board}:{" "}
                {source.enabled
                  ? source.lastScannedAt
                    ? `last checked ${new Date(source.lastScannedAt).toLocaleString()}`
                    : "not checked yet"
                  : "disabled"}
                {source.lastError ? ` — ${source.lastError}` : ""}
              </small>
            ))}
            {connected && Boolean(overview?.pendingExport) && (
              <button disabled={Boolean(busy)} onClick={exportSheet}>
                {busy === "export"
                  ? "Adding rows…"
                  : `Add ${overview?.pendingExport} found job(s) to the sheet`}
              </button>
            )}
            {overview?.runs.slice(0, 3).map((r) => (
              <small key={r.id} className="run">
                {new Date(r.startedAt).toLocaleString()} ·{" "}
                {r.trigger === "schedule" ? "automatic" : "you clicked"} ·{" "}
                {r.error
                  ? `failed: ${r.error}`
                  : r.summary
                    ? `${r.summary.discovery.added} new jobs` +
                      (r.summary.discovery.linkedIn?.emails
                        ? ` (${r.summary.discovery.linkedIn.added} from LinkedIn alerts)`
                        : "") +
                      (r.summary.discovery.errors.length
                        ? `, ${r.summary.discovery.errors.length} sources failed`
                        : "")
                    : "running…"}
              </small>
            ))}
          </div>
        </li>

        <li className="panel">
          <span className="num">2</span>
          <div>
            <div className="row">
              <div>
                <span className="eyebrow">STEP 2 · YOU DO THIS</span>
                <h2>Approve the jobs you want</h2>
              </div>
              {status?.sheetUrl && (
                <a
                  className="button primary"
                  href={status.sheetUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Google Sheet ↗
                </a>
              )}
            </div>
            <ul className="rules">
              <li>
                In the <strong>Review</strong> column, type{" "}
                <strong>APPROVED</strong> for each job you want to apply to.
                Leave the others, or type REJECTED.
              </li>
              <li>
                If a row has an <strong>Official Email</strong> and you want
                your CV emailed there, also type <strong>YES</strong> in{" "}
                <strong>Email Use Confirmed</strong>.
              </li>
              <li>
                Don’t change the other columns. Edited rows are skipped for
                safety.
              </li>
            </ul>
          </div>
        </li>

        <li className="panel">
          <span className="num">3</span>
          <div>
            <span className="eyebrow">
              STEP 3 · THE AGENT PREPARES, YOU CONFIRM
            </span>
            <h2>Apply to approved jobs</h2>
            <p>There are two ways to apply, depending on the job.</p>
            <div className="ways">
              <div className="way">
                <span className="pill go">Most jobs</span>
                <h3>Apply on company forms</h3>
                <p>
                  For Greenhouse, Lever and Ashby jobs. The first approved job
                  opens in a new tab and the Form Assistant extension fills it.
                  After each application is submitted, the next job opens in
                  that same tab by itself and is recorded here. The agent stops
                  after 3 applications; click Start applying again for the next
                  3.
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={autoSubmit}
                    onChange={(e) => {
                      setAutoSubmit(e.target.checked);
                      try {
                        localStorage.setItem(
                          "job-agent-auto-submit",
                          e.target.checked ? "1" : "0",
                        );
                      } catch {}
                    }}
                  />
                  Submit automatically when every required field is filled
                </label>
                <small className="hint">
                  {autoSubmit
                    ? "Applications go to employers without you reading them first, including the drafted answers. Forms with a missing answer or a CAPTCHA wait for you."
                    : "You check each form and click Submit on the site yourself."}
                </small>
                <p>
                  <button
                    className="primary"
                    disabled={Boolean(busy) || !connected}
                    onClick={startApplying}
                  >
                    {busy === "batch" ? "Preparing…" : "Start applying"}
                  </button>
                </p>
              </div>
              <div className="way">
                <span className="pill">Only jobs with a hiring email</span>
                <h3>Email your CV</h3>
                <p>
                  Shows every email exactly as it will be sent from your Gmail,
                  with your CV attached. Nothing goes out until you click Send.
                  Approved jobs without an email are added to{" "}
                  <strong>Your applications</strong> for you to apply yourself.
                </p>
                <button
                  className="primary"
                  disabled={Boolean(busy) || !connected}
                  onClick={makePreview}
                >
                  {busy === "preview" ? "Reading sheet…" : "Preview emails"}
                </button>
              </div>
            </div>

            {batch?.skipped.map((x) => (
              <small key={x.jobId} className="run">
                Skipped {x.jobId.slice(0, 8)}: {x.reason}
              </small>
            ))}
            {batch && batch.remaining > 0 && (
              <small className="run">
                {batch.remaining} more approved form job(s) after these.
              </small>
            )}

            {preview && (
              <div className="result" id="email-preview">
                <h3>
                  {preview.items.length} approved job
                  {preview.items.length === 1 ? "" : "s"}: {previewEmails} by
                  email, {preview.items.length - previewEmails} to apply
                  yourself
                </h3>
                <p>
                  {preview.counts.rows} rows in sheet ·{" "}
                  {preview.counts.approved} approved · {preview.counts.pending}{" "}
                  pending · {preview.counts.rejected} rejected. Emails go from{" "}
                  {preview.sender} with {preview.resume.fileName} (
                  {Math.ceil(preview.resume.sizeBytes / 1024)} KB). This preview
                  expires at {new Date(preview.expiresAt).toLocaleTimeString()}.
                </p>
                {preview.items.map((item) => (
                  <article className="entry mail" key={item.jobId}>
                    <div className="row">
                      <strong>
                        {item.title} · {item.company}
                      </strong>
                      <span
                        className={`pill ${item.method === "EMAIL" ? "go" : ""}`}
                      >
                        {item.method === "EMAIL"
                          ? "Email + CV"
                          : "Apply yourself"}
                      </span>
                    </div>
                    <small>{item.note}</small>
                    {item.method === "EMAIL" ? (
                      <>
                        <small>
                          To: <strong>{item.recipient}</strong> · Subject:{" "}
                          {item.subject} · Attachment: {preview.resume.fileName}
                        </small>
                        <pre>{item.body}</pre>
                      </>
                    ) : (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        Open application page ↗
                      </a>
                    )}
                  </article>
                ))}
                {preview.excluded.length > 0 && (
                  <>
                    <h3>Left out</h3>
                    {preview.excluded.map((x) => (
                      <p key={x.jobId}>
                        <strong>
                          {x.title} · {x.company}
                        </strong>{" "}
                        — {x.reason}
                      </p>
                    ))}
                  </>
                )}
                <div className="save-bar">
                  <span>This sends only the emails shown above.</span>
                  <button
                    className="primary"
                    disabled={Boolean(busy) || !preview.items.length}
                    onClick={publish}
                  >
                    {busy === "publish"
                      ? "Sending…"
                      : previewEmails
                        ? `Send ${previewEmails} email${previewEmails === 1 ? "" : "s"}`
                        : "Save to Your applications"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </li>
      </ol>

      {prepared && (
        <section className="panel" aria-label="Form preparation">
          <span className="eyebrow">FORM READY · YOU SUBMIT</span>
          <h2>
            {prepared.title} · {prepared.company}
          </h2>
          <p>{prepared.instructions}</p>
          <p>
            {prepared.provider} · CV: {prepared.resume.fileName} (
            {Math.ceil(prepared.resume.sizeBytes / 1024)} KB) · Contact:{" "}
            {prepared.fields.name} · {prepared.fields.email} ·{" "}
            {prepared.fields.phone}
          </p>
          <div className="actions">
            <a
              className="button primary"
              href={prepared.openUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open &amp; fill application ↗
            </a>
            <a href={apiUrl("resume/file")}>Download CV</a>
            <button onClick={() => setPrepared(null)}>Close</button>
          </div>
          <small className="hint">
            The link works once, until{" "}
            {new Date(prepared.expiresAt).toLocaleTimeString()}. If the form is
            not filled automatically, click the Form Assistant extension icon on
            that tab and paste this code:
          </small>
          <div className="actions">
            <input
              readOnly
              aria-label="One-use preparation code"
              value={prepared.code}
              onFocus={(e) => e.target.select()}
            />
            <button
              disabled={Boolean(busy)}
              onClick={() =>
                run("copy", async () => {
                  await navigator.clipboard.writeText(prepared.code);
                  return "Preparation code copied.";
                })
              }
            >
              Copy code
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="row">
          <div>
            <span className="eyebrow">TRACKING</span>
            <h2>Your applications</h2>
          </div>
          <button disabled={Boolean(busy) || !connected} onClick={replies}>
            {busy === "replies" ? "Checking…" : "Check for replies"}
          </button>
        </div>
        {overview?.notifications.map((n) => (
          <div className="success" key={n.id}>
            <strong>{n.title}</strong> — {n.snippet}
          </div>
        ))}
        {!applications.length && (
          <p>
            Nothing here yet. Jobs appear here after you approve them in the
            sheet and apply in step 3.
          </p>
        )}
        {applications.map((a) => (
          <div className="entry" key={a.id}>
            <div className="row">
              <strong>
                {a.job.title} · {a.job.company}
              </strong>
              <span
                className={`pill ${a.status === "SENT" || a.status === "REPLIED" ? "go" : a.status === "FAILED" ? "bad" : ""}`}
              >
                {labels[a.status] ?? a.status}
              </span>
            </div>
            <small>{a.detail}</small>
            {a.status === "MANUAL_ACTION_REQUIRED" && (
              <div className="actions">
                <a href={a.job.url} target="_blank" rel="noreferrer">
                  Open application ↗
                </a>
                <a href={apiUrl("resume/file")}>Download CV</a>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => prepareForm(a.job.id)}
                >
                  {busy === "form" ? "Preparing…" : "Fill the form for me"}
                </button>
                <button
                  disabled={Boolean(busy)}
                  onClick={() =>
                    run(
                      "applied",
                      async () =>
                        void (await api(
                          `workflow/applications/${a.id}/applied`,
                          {},
                        )),
                    )
                  }
                >
                  I submitted it
                </button>
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="row">
          <div>
            <span className="eyebrow">FOR REFERENCE</span>
            <h2>Jobs found ({jobs.length})</h2>
          </div>
          {jobs.length > 8 && (
            <button onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${jobs.length}`}
            </button>
          )}
        </div>
        <p>
          The same jobs are in your Google Sheet, where you approve them. Newest
          first.
        </p>
        {(showAll ? jobs : jobs.slice(0, 8)).map((j) => (
          <div className="entry" key={j.id}>
            <div className="row">
              <a href={j.url} target="_blank" rel="noreferrer">
                <strong>
                  {j.title} · {j.company}
                </strong>
              </a>
              <span className="pill">
                {j.matchScore === null
                  ? "Not scored"
                  : `${j.matchScore}% match`}
              </span>
            </div>
            <small>
              {j.location} ·{" "}
              {j.email ? `Hiring email: ${j.email}` : "Apply on the job page"} ·{" "}
              {j.application
                ? (labels[j.application.status] ?? j.application.status)
                : j.sheetExportedAt
                  ? "In your sheet"
                  : "Not in sheet yet"}
            </small>
            <p>{j.matchReason}</p>
          </div>
        ))}
      </section>
    </>
  );
}
