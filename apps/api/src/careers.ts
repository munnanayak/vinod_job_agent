import { publicPage } from "./public-page.js";
import { applicationEmail, textContent } from "./workflow-rules.js";

const AGENT = "JobAgent/0.1 (personal job search assistant)";
const HIRING_BOX =
  /^(jobs?|careers?|hiring|hr|recruit\w*|talent\w*|people|join\w*|work|apply|resumes?|cv)@/i;
const NEVER =
  /^(no-?reply|privacy|security|abuse|legal|support|help|billing|sales|press|media|info|hello|contact|admin|webmaster|dpo|gdpr|accessibility|accommodations?)@/i;

async function text(url: string) {
  try {
    return await publicPage(url, new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return null;
  }
}

async function disallowed(origin: string) {
  const robots = await text(`${origin}/robots.txt`);
  if (!robots) return [] as string[];
  const rules: string[] = [];
  let applies = false;
  for (const raw of robots.body.split("\n")) {
    const line = raw.split("#")[0].trim();
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(field))
      applies = value === "*" || /jobagent/i.test(value);
    else if (applies && /^disallow$/i.test(field) && value) rules.push(value);
  }
  return rules;
}

/**
 * The company's own website, found by trying its name as a web address and
 * accepting a site only when its title names that company. No search service is
 * used. A similarly named firm fails the title check.
 */
export async function guessCompanyWebsite(company: string) {
  const words = company
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        !/^(private|limited|ltd|pvt|inc|llc|gmbh|sa|srl|bv|ag|the)$/.test(w),
    );
  const full = words.join("");
  const core = words
    .filter(
      (w) =>
        !/^(technologies|technology|solutions|software|labs|group|consulting|systems|services|holding|india)$/.test(
          w,
        ),
    )
    .join("");
  const labels = [...new Set([full, core])].filter((l) => l.length >= 4);
  const tries = labels.flatMap((label) =>
    ["com", "in", "io", "ai", "co"].map((tld) => `https://${label}.${tld}/`),
  );
  const pages = await Promise.all(tries.map((url) => text(url)));
  for (const page of pages) {
    if (!page) continue;
    const head = [
      /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.body)?.[1] ?? "",
      /<meta[^>]+(?:name="description"|property="og:site_name")[^>]*content="([^"]*)"/i.exec(
        page.body,
      )?.[1] ?? "",
    ]
      .join(" ")
      .toLowerCase();
    const seen = new Set(head.replace(/[^a-z0-9]+/g, " ").split(" "));
    if (
      words.every((w) => seen.has(w)) ||
      (full.length >= 6 && head.replace(/[^a-z0-9]+/g, "").includes(full))
    )
      return `https://${new URL(page.finalUrl).hostname.replace(/^www\./, "")}`;
  }
  return "";
}

const sameSite = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

/**
 * Looks for a hiring mailbox published on the company's own careers or contact
 * page. Only addresses at the company's own domain are accepted; nothing is guessed.
 */
export async function findHiringEmail(website: string) {
  const origin = new URL(website).origin;
  const domain = new URL(origin).hostname.replace(/^www\./, "");
  const blocked = await disallowed(origin);
  for (const path of [
    "/careers",
    "/career",
    "/jobs",
    "/join-us",
    "/contact",
    "/contact-us",
    "/",
  ]) {
    if (blocked.some((rule) => path.startsWith(rule) && rule !== "/")) continue;
    if (blocked.includes("/")) break;
    const page = await text(`${origin}${path}`);
    if (
      !page ||
      !sameSite(new URL(page.finalUrl).hostname.replace(/^www\./, ""), domain)
    )
      continue;
    const plain = textContent(page.body);
    const careersPage = !path.startsWith("/contact") && path !== "/";
    for (const match of `${page.body} ${plain}`.matchAll(
      /(?:mailto:)?([A-Z0-9._%+-]+@([A-Z0-9-]+\.)+[A-Z]{2,})/gi,
    )) {
      const email = match[1].toLowerCase();
      const host = email.split("@")[1];
      // Normally only the company's own domain counts. A hiring mailbox shown on
      // its careers page is also accepted when the company uses a second domain.
      if (
        NEVER.test(email) ||
        (!sameSite(host, domain) && !(careersPage && HIRING_BOX.test(email)))
      )
        continue;
      // A page being named careers is not evidence that every address accepts CVs.
      if (!HIRING_BOX.test(email) && applicationEmail(plain).email !== email)
        continue;
      const at = plain.toLowerCase().indexOf(email);
      const evidence =
        at >= 0
          ? plain.slice(Math.max(0, at - 160), at + email.length + 80)
          : `Listed on ${page.finalUrl}`;
      return {
        email,
        evidence: evidence.slice(0, 400),
        sourceUrl: page.finalUrl,
      };
    }
  }
  return null;
}
