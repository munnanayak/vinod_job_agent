import { createHash, randomBytes } from "node:crypto";
export const HEADERS = [
  "Job ID",
  "Review",
  "Company",
  "Role",
  "Location",
  "Salary",
  "Job URL",
  "Official Email",
  "Email Source",
  "Email Evidence",
  "Email Use Confirmed",
  "Match Score",
  "Match Reason",
  "Matched Skills",
  "Missing Skills",
  "Application Method",
  "Status",
  "Last Reply",
  "Discovered At",
  "Source",
];
// Normalize common title variants without making unrelated engineering roles equivalent.
export function roleWords(title: string) {
  return title
    .toLowerCase()
    .replace(/\bnode\.?js\b/g, "nodejs")
    .replace(/\breact\.js\b/g, "react")
    .replace(/full[\s-]?stack/g, "fullstack")
    .replace(/front[\s-]?end/g, "frontend")
    .replace(/back[\s-]?end/g, "backend")
    .replace(/artificial intelligence|generative ai|genai|llm/g, "ai")
    .replace(/\b(developer|engineering|swe)\b/g, "engineer")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim()
    .split(/\s+/);
}
export function targetRole(title: string, roles?: string[]) {
  if (roles?.length) {
    const words = new Set(roleWords(title));
    return roles.some((role) => {
      const wanted = roleWords(role).filter(
        (w) => !/^(junior|jr|mid|senior|sr|ii|iii)$/.test(w),
      );
      return wanted.length > 0 && wanted.every((word) => words.has(word));
    });
  }
  return (
    (/\bfull[\s-]?stack\b/i.test(title) &&
      /\b(developer|engineer|swe|software)\b/i.test(title)) ||
    (/\b(?:AI|artificial intelligence|generative AI|genAI|LLM)\b/i.test(
      title,
    ) &&
      /\bengineer(?:ing)?\b/i.test(title))
  );
}
// Junior and mid-level only: skip senior, lead and management titles.
export function seniorityFits(title: string) {
  if (process.env.JOB_SENIORITY === "all") return true;
  return !/\b(senior|sr|staff|principal|lead|leader|manager|director|head|vp|vice president|architect|distinguished|fellow|founding engineer)\b/i.test(
    title,
  );
}
// Employers who ask for no automated or AI-written applications never get auto-sent email.
export function forbidsAutomation(description: string) {
  return /\bno (automated|automatic|ai[- ]?generated|ai[- ]?written|bot|mass)\b[^.]{0,30}\b(applications?|submissions?|emails?)\b|\b(do not|don't|please don't) (use|send) (ai|automat|bots?)|\bno (recruiters|agencies)\b[^.]{0,20}\b(bots?|automation)/i.test(
    description,
  );
}
export function safeUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function textContent(html: string) {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function applicationEmail(description: string, hiringPost = false) {
  // Only explicit instructions to email a CV/application; generic contact and
  // accommodations addresses are never promoted to an application recipient.
  // A hiring post written by the employer (e.g. HN "Who is hiring") may also
  // say "email us at…" or use a hiring mailbox such as jobs@.
  description = description
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, "@")
    .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, ".");
  for (const match of description.matchAll(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  )) {
    const before = description.slice(
      Math.max(0, match.index! - 160),
      match.index,
    );
    const evidence = description.slice(
      Math.max(0, match.index! - 160),
      match.index! + match[0].length + 80,
    );
    const explicit =
      /\b(send|email|submit)\b.{0,100}\b(resume|cv|application)\b|\b(apply)\b.{0,70}\b(email|via|at|to)\b/i.test(
        before,
      );
    const posted =
      hiringPost &&
      (/\b(e-?mail|contact|reach|write to|send|apply|interested)\b/i.test(
        before.slice(-80),
      ) ||
        /^(jobs?|careers?|hiring|hr|recruit\w*|talent|people|join\w*|work)@/i.test(
          match[0],
        ));
    if (
      (explicit || posted) &&
      !/accommodat|disabilit|privacy|accessib|no.?reply|security/i.test(
        evidence,
      )
    )
      // "name@firm.comRegards": text glued on after the address is cut off
      // where a capital letter follows the lower-case ending.
      return {
        email: match[0].replace(/(\.[a-z]{2,})[A-Z].*$/, "$1").toLowerCase(),
        emailEvidence: evidence,
      };
  }
  return { email: "", emailEvidence: "" };
}
export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function parseReviewRows(values: string[][]) {
  if (!values.length || HEADERS.some((h, i) => values[0][i] !== h))
    throw new Error(
      "Sheet headers changed. Restore the original header order before publishing.",
    );
  const map = new Map<string, string[]>();
  for (const row of values.slice(1)) {
    if (row.every((cell) => !String(cell).trim())) continue;
    if (!row[0]) throw new Error("A populated sheet row has no Job ID.");
    if (map.has(row[0]))
      throw new Error(
        "Duplicate Job ID in the sheet. Remove the duplicate before publishing.",
      );
    map.set(
      row[0],
      Array.from({ length: HEADERS.length }, (_, i) => String(row[i] ?? "")),
    );
  }
  return map;
}
export function approved(row: string[] | undefined) {
  return row?.[1]?.trim().toUpperCase() === "APPROVED";
}
export function unchanged(row: string[], expected: string[]) {
  return [0, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 18, 19].every(
    (i) => row[i] === expected[i],
  );
}
export function messageRaw(
  from: string,
  to: string,
  subject: string,
  body: string,
  filename: string,
  pdf: Uint8Array,
) {
  const email = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
  if (!email.test(from) || !email.test(to))
    throw new Error("Invalid sender or recipient email");
  if (Buffer.from(pdf).subarray(0, 5).toString() !== "%PDF-")
    throw new Error("Resume is not a PDF");
  const boundary = "jobagent_" + randomBytes(16).toString("hex");
  const b64 = (value: Uint8Array | string) =>
    Buffer.from(value as string)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? "";
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject.replace(/[\r\n]/g, " ")).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(body),
    `--${boundary}`,
    "Content-Type: application/pdf",
    `Content-Disposition: attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
    "Content-Transfer-Encoding: base64",
    "",
    b64(pdf),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}
export function plainMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
) {
  const email = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
  if (!email.test(from) || !email.test(to))
    throw new Error("Invalid sender or recipient email");
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject.replace(/[\r\n]/g, " ")).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? "",
    "",
  ].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}
