import { textContent } from "./workflow-rules.js";

export type AlertJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
};

const JOB_LINK =
  /https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^\s"'<>/]*-)?(\d{6,})[^\s"'<>]*/gi;
// Lines in alert emails that are never a title, company or location.
const NOISE =
  /^(-{3,}|_{3,}|view job:?.*|your job alert.*|(new )?jobs from your other alerts?|(.+ )?jobs in [a-z .,()-]+|top job picks for you|manage alerts:?.*|.*new jobs? (match|for).*|jobs? you may be interested in.*|see all jobs.*|this company is actively hiring|actively recruiting|easy apply|promoted|be an early applicant|apply with .*|\d+ (school )?(alumni|connections?|applicants?).*|.*(alumni|connections?) work(s)? here|you('|’)d be a top applicant|new|unsubscribe.*|manage (your )?job alerts.*|linkedin|©.*|this email was intended for.*|learn why we included this.*|you are receiving .*|.*\bago$)$/i;

const clean = (line: string) => textContent(line).replace(/\s+/g, " ").trim();

function fromLines(lines: string[], id: string, url: string): AlertJob | null {
  const useful = lines
    .map(clean)
    .filter(
      (l) => l && l.length < 160 && !NOISE.test(l) && !/^https?:\/\//i.test(l),
    );
  if (!useful.length) return null;
  const [title, second = "", third = ""] = useful;
  // HTML alerts often put "Company · Location" on one line.
  const [company, location] = second.includes("·")
    ? second.split("·").map(clean)
    : [second, third];
  if (!title || !company) return null;
  return { id, title, company, location: location || "Not specified", url };
}

/** Jobs listed in a LinkedIn job-alert or "X is hiring" email. */
export function parseAlert(
  text: string,
  html: string,
  subject = "",
): AlertJob[] {
  const jobs = new Map<string, AlertJob>();
  const canonical = (id: string) => `https://www.linkedin.com/jobs/view/${id}/`;
  // Plain-text part: "Title / Company / Location / … / View job: <url>" blocks.
  if (text) {
    const lines = text.split(/\r?\n/);
    let block: string[] = [];
    for (const line of lines) {
      const ids = [...line.matchAll(JOB_LINK)].map((m) => m[1]);
      if (!ids.length) {
        block.push(line);
        continue;
      }
      for (const id of ids) {
        const job = !jobs.has(id) && fromLines(block, id, canonical(id));
        if (job) jobs.set(id, job);
      }
      block = [];
    }
  }
  // HTML part: the job link wraps the title; company and location follow it.
  if (!jobs.size && html) {
    const withBreaks = html
      .replace(
        /<a\b[^>]*href="([^"]*)"[^>]*>/gi,
        (_, href: string) => `\n@@LINK ${href.replace(/&amp;/g, "&")}\n`,
      )
      .replace(
        /<(br|\/p|\/div|\/td|\/tr|\/a|\/h\d|\/li|\/span)\b[^>]*>/gi,
        "\n",
      );
    const lines = withBreaks
      .split("\n")
      .map((l) => (l.startsWith("@@LINK ") ? l : textContent(l)));
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("@@LINK ")) continue;
      const id = [...lines[i].matchAll(JOB_LINK)][0]?.[1];
      if (!id || jobs.has(id)) continue;
      const after: string[] = [];
      for (let j = i + 1; j < lines.length && after.length < 12; j++) {
        if (lines[j].startsWith("@@LINK ")) {
          if ([...lines[j].matchAll(JOB_LINK)][0]?.[1] === id) continue; // Same job, e.g. logo then title.
          break;
        }
        after.push(lines[j]);
      }
      const job = fromLines(after, id, canonical(id));
      if (job) jobs.set(id, job);
    }
  }
  // Single-job emails: "Company is hiring a Title" in the subject.
  if (!jobs.size) {
    const m = /^(.+?) is hiring (?:an? )?(.+?)(?: - LinkedIn)?$/i.exec(
      clean(subject),
    );
    const id = [...`${text} ${html}`.matchAll(JOB_LINK)][0]?.[1];
    if (m && id)
      jobs.set(id, {
        id,
        company: m[1],
        title: m[2],
        location: "Not specified",
        url: canonical(id),
      });
  }
  return [...jobs.values()];
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9+#. ]/g, " ")
      .split(/\s+/)
      .filter(
        (w) => w && !["-", "the", "and", "of", "for", "a", "an"].includes(w),
      ),
  );

/** Whether two job titles describe the same role (same company assumed). */
export function sameRole(a: string, b: string) {
  const x = words(a),
    y = words(b);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(x.size, y.size) >= 0.75;
}

/** Likely Greenhouse/Lever/Ashby board names for a company, e.g. "Hevo Data" → hevodata, hevo-data, hevo. */
export function boardCandidates(company: string) {
  const base = company
    .toLowerCase()
    .replace(
      /\b(inc|llc|ltd|pvt|private|limited|technologies|technology|solutions|software|labs?|hq|india|global)\b\.?/g,
      " ",
    )
    .replace(/[^a-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!base.length) return [];
  return [...new Set([base.join(""), base.join("-"), base[0]])].filter(
    (c) => c.length >= 3,
  );
}
