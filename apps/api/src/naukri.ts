import { createHash } from "node:crypto";
import { textContent } from "./workflow-rules.js";

export type NaukriJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  url: string;
};

// Alert emails shorten long names with "...".
const clean = (line: string) =>
  textContent(line)
    .replace(/\s+/g, " ")
    .replace(/\s*(\.{3}|…)$/, "")
    .trim();

/**
 * Jobs listed in a Naukri job-alert email. Each job is one linked card whose
 * text runs: title, company, rating (optional), location, salary, tags.
 * Naukri's pages are never opened; the card's own link is kept for you to click.
 */
export function parseNaukriAlert(html: string): NaukriJob[] {
  const jobs = new Map<string, NaukriJob>();
  for (const match of html.matchAll(
    /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = match[1].replace(/&amp;/g, "&");
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (host !== "naukri.com" && !host.endsWith(".naukri.com")) continue;
    const lines = match[2]
      .replace(/<[^>]+>/g, "\n")
      .split("\n")
      .map(clean)
      .filter(Boolean);
    // Buttons and footer links ("Apply", "Unsubscribe") carry one short text.
    if (lines.length < 3) continue;
    const [title, company, ...rest] = lines;
    const details = rest.filter((l) => !/^\d(\.\d)?$/.test(l)); // Company rating.
    const location = details[0] ?? "";
    const salary = details[1] ?? "";
    if (!title || !company || !location) continue;
    // The link is a per-email tracking address; the same job keeps one id per email position.
    let key = url;
    try {
      const data = JSON.parse(new URL(url).searchParams.get("data") ?? "{}");
      if (data.communicationId && data.clickPosition !== undefined)
        key = `${data.communicationId}:${data.clickPosition}`;
    } catch {}
    const id = createHash("sha256").update(key).digest("hex").slice(0, 24);
    if (!jobs.has(id))
      jobs.set(id, {
        id,
        title,
        company,
        location,
        salary: /lacs|lakh|disclosed|\d/i.test(salary)
          ? salary
          : "Not disclosed",
        url,
      });
  }
  return [...jobs.values()];
}
