import { maxJobExperience } from "./experience.js";
import { setTimeout as delay } from "node:timers/promises";
import {
  discoveryConfig,
  MARKETS,
  reserveRequest,
  searchQueries,
  type SearchContext,
} from "./discovery-config.js";
import { safeUrl, targetRole, textContent } from "./workflow-rules.js";

export type Posting = {
  source: string;
  board: string;
  externalId: string;
  company: string;
  title: string;
  location: string;
  salary: string;
  url: string;
  description: string;
  startup: boolean;
  // Not stored: used to find new boards and the company's own website.
  links: string[];
  website: string;
  hiringPost: boolean;
};
export type BoardRef = { source: string; board: string; company: string };

const AGENT = "JobAgent/0.1 (personal job search assistant)";
const STARTUP =
  /\b(start-?up|seed|series [a-c]|y ?combinator|\(yc [swf]\d\d\)|yc-backed|early[- ]stage)\b/i;
// Hosts that are never a company's own website.
const NOT_COMPANY =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|himalayas\.app|remoteok\.com|remotive\.com|adzuna\.[a-z.]+|linkedin\.com|twitter\.com|x\.com|github\.com|gitlab\.com|youtube\.com|youtu\.be|glassdoor\.[a-z.]+|facebook\.com|instagram\.com|medium\.com|ycombinator\.com|wellfound\.com|angel\.co|notion\.site|notion\.so|google\.com|forms\.gle|bit\.ly|workable\.com|crunchbase\.com|techcrunch\.com|calendly\.com|typeform\.com|tally\.so|apple\.com|microsoft\.com|wikipedia\.org|w3\.org|schema\.org|breezy\.hr|recruitee\.com|smartrecruiters\.com|workday\.com|myworkdayjobs\.com)$/i;

export async function getJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": AGENT,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`${new URL(url).host} returned ${response.status}`);
  return response.json();
}

function decode(html: string) {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

export function linksIn(html: string) {
  return [
    ...new Set(decode(html).match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []),
  ].map((l) => l.replace(/[.,;:]+$/, ""));
}

// Finds the company's own website with one web search. A result is accepted
// only when the site's name matches the company's, so a similarly named firm
// is never mistaken for the employer.
export async function searchCompanyWebsite(company: string): Promise<string> {
  const key = process.env.SERPAPI_API_KEY?.trim();
  const name = company
    .toLowerCase()
    .replace(
      /\b(inc|llc|ltd|pvt|private|limited|gmbh|technologies|technology|solutions|software|labs|group|consulting|systems|services|holding|india|ai|hq|sa|srl|bv|ag)\b|[^a-z0-9]/g,
      "",
    );
  if (!key || name.length < 3) return "";
  const params = new URLSearchParams({
    engine: "google",
    api_key: key,
    q: company
      .replace(
        /\b(private limited|pvt\.? ltd\.?|limited|ltd\.?|inc\.?|llc|gmbh)\b/gi,
        "",
      )
      .trim(),
    num: "10",
    hl: "en",
  });
  const data = await getJson(`https://serpapi.com/search.json?${params}`);
  // Google's own company panel, when present, names the official site.
  const links = [
    String(data.knowledge_graph?.website ?? "").replace(/^http:/, "https:"),
    ...(data.organic_results ?? []).map((r: any) => String(r.link ?? "")),
  ];
  for (const link of links) {
    try {
      const url = new URL(link);
      if (url.protocol !== "https:" || NOT_COMPANY.test(url.hostname)) continue;
      const labels = url.hostname.replace(/^www\./, "").split(".");
      // example.com, example.co.uk and careers.example.com all give "example".
      const at =
        labels.length >= 3 &&
        /^(co|com|net|org|gov|ac)$/.test(labels[labels.length - 2])
          ? labels.length - 3
          : labels.length - 2;
      const site = (labels[at] ?? "").replace(/[^a-z0-9]/g, "");
      if (site.length >= 3 && (name.startsWith(site) || site.startsWith(name)))
        return `https://${labels.slice(at).join(".")}`;
    } catch {}
  }
  return "";
}

export function companyWebsite(links: string[]) {
  for (const link of links) {
    try {
      const url = new URL(link);
      if (url.protocol === "https:" && !NOT_COMPANY.test(url.hostname))
        return url.origin;
    } catch {}
  }
  return "";
}

// Greenhouse, Lever and Ashby board links found in any posting become new boards to scan.
export function boardsIn(links: string[]): { source: string; board: string }[] {
  const found = new Map<string, { source: string; board: string }>();
  for (const link of links) {
    let m =
      /(?:job-)?boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?(?:embed\/job_board\?for=)?([a-z0-9-]+)/i.exec(
        link,
      );
    if (m && !["embed", "v1"].includes(m[1].toLowerCase()))
      found.set(`greenhouse:${m[1]}`, { source: "greenhouse", board: m[1] });
    m = /jobs\.lever\.co\/([a-z0-9-]+)/i.exec(link);
    if (m) found.set(`lever:${m[1]}`, { source: "lever", board: m[1] });
    m = /jobs\.ashbyhq\.com\/([a-z0-9._-]+)/i.exec(link);
    if (m) found.set(`ashby:${m[1]}`, { source: "ashby", board: m[1] });
  }
  return [...found.values()].map((b) => ({
    ...b,
    board: b.board.toLowerCase(),
  }));
}

function posting(
  p: Omit<Posting, "links" | "website" | "hiringPost" | "startup"> &
    Partial<Posting>,
  html = "",
): Posting {
  const links = p.links ?? linksIn(html || p.description);
  return {
    startup: STARTUP.test(p.description),
    hiringPost: false,
    ...p,
    title: p.title.replace(/\s+/g, " ").trim().slice(0, 200),
    company:
      p.company.replace(/\s+/g, " ").trim().slice(0, 200) || "Unknown company",
    location: p.location.trim().slice(0, 200) || "Not specified",
    links,
    website: p.website ?? companyWebsite(links),
  };
}

export async function fetchBoard(
  b: BoardRef & { startup?: boolean },
): Promise<Posting[]> {
  if (b.source === "greenhouse") {
    const data = await getJson(
      `https://boards-api.greenhouse.io/v1/boards/${b.board}/jobs?content=true`,
    );
    return (data.jobs ?? []).map((j: any) => {
      const html = decode(String(j.content ?? ""));
      const url = String(j.absolute_url ?? "");
      const own =
        url && !/greenhouse\.io/i.test(url) ? new URL(url).origin : "";
      const p = posting(
        {
          source: "greenhouse",
          board: b.board,
          externalId: String(j.id),
          company: j.company_name || b.company,
          title: String(j.title ?? ""),
          location: j.location?.name ?? "",
          salary: "Not disclosed",
          url,
          description: textContent(html),
        },
        html,
      );
      return {
        ...p,
        website: own || p.website,
        startup: p.startup || Boolean(b.startup),
      };
    });
  }
  if (b.source === "lever") {
    const data = await getJson(
      `https://api.lever.co/v0/postings/${b.board}?mode=json`,
    );
    return (Array.isArray(data) ? data : []).map((j: any) => {
      const range = j.salaryRange;
      const html = [
        j.description,
        ...(j.lists ?? []).map((l: any) => `${l.text}: ${l.content}`),
        j.additional,
      ].join(" ");
      const p = posting(
        {
          source: "lever",
          board: b.board,
          externalId: String(j.id),
          company: b.company,
          title: String(j.text ?? ""),
          location:
            j.categories?.location ||
            (j.workplaceType === "remote" ? "Remote" : ""),
          salary:
            range?.min && range?.max
              ? `${range.currency ?? ""} ${range.min}–${range.max} ${range.interval ?? ""}`.trim()
              : "Not disclosed",
          url: String(j.hostedUrl ?? ""),
          description: textContent(String(html ?? "")),
        },
        String(html ?? ""),
      );
      return { ...p, startup: p.startup || Boolean(b.startup) };
    });
  }
  if (b.source === "ashby") {
    const data = await getJson(
      `https://api.ashbyhq.com/posting-api/job-board/${b.board}?includeCompensation=true`,
    );
    return (data.jobs ?? [])
      .filter((j: any) => j.isListed !== false)
      .map((j: any) => {
        const places = [
          j.location,
          ...(j.secondaryLocations ?? []).map((l: any) => l.location),
        ].filter(Boolean);
        return posting(
          {
            source: "ashby",
            board: b.board,
            externalId: String(j.id),
            company: b.company,
            title: String(j.title ?? ""),
            location:
              places.join(" / ") +
              (j.isRemote && !/remote/i.test(places.join(" "))
                ? " / Remote"
                : ""),
            salary: j.compensation?.compensationTierSummary || "Not disclosed",
            url: String(j.jobUrl ?? ""),
            description: String(
              j.descriptionPlain ??
                textContent(String(j.descriptionHtml ?? "")),
            ),
            startup: true, // Ashby is used almost exclusively by startups.
          },
          String(j.descriptionHtml ?? ""),
        );
      });
  }
  throw new Error(`Unsupported board source ${b.source}`);
}

// Monthly "Ask HN: Who is hiring?" thread: startup hiring posts written by the employer.
async function hackerNews(context: SearchContext): Promise<Posting[]> {
  const search = await getJson(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who%20is%20hiring&hitsPerPage=3",
  );
  const story = (search.hits ?? []).find((h: any) =>
    /who is hiring/i.test(h.title),
  );
  if (!story) return [];
  const thread = await getJson(
    `https://hn.algolia.com/api/v1/items/${story.objectID}`,
  );
  const out: Posting[] = [];
  for (const c of thread.children ?? []) {
    const html = String(c.text ?? "");
    if (!html) continue;
    const header = textContent(html.split(/<p>/i)[0]);
    const segments = header
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const role = segments.find((s) =>
      targetRole(s, context.profile.targetRoles),
    );
    if (!role) continue;
    out.push({
      ...posting(
        {
          source: "hackernews",
          board: `whoishiring-${story.objectID}`,
          externalId: String(c.id),
          company: segments[0]
            .replace(/https?:\/\/\S+/g, "")
            .replace(/\(.*?\)/g, "")
            .trim(),
          title: role,
          location:
            segments
              .filter((s) =>
                /remote|onsite|on-site|hybrid|india|bangalore|bengaluru|hyderabad|worldwide|anywhere|global/i.test(
                  s,
                ),
              )
              .join(" / ") || "Not specified",
          salary:
            segments.find((s) => /[$€£₹]\s?\d|\d+\s?k\b|lpa|ctc/i.test(s)) ??
            "Not disclosed",
          url: `https://news.ycombinator.com/item?id=${c.id}`,
          description: textContent(html),
          startup: true,
        },
        html,
      ),
      hiringPost: true,
    });
  }
  return out;
}

async function himalayas(context: SearchContext): Promise<Posting[]> {
  const out: Posting[] = [];
  const queries = searchQueries(context.profile).map((q) =>
    new URLSearchParams({ q }).toString(),
  );
  for (const query of queries)
    for (let offset = 0; offset < 60; offset += 20) {
      const data = await getJson(
        `https://himalayas.app/jobs/api/search?${query}&limit=20&offset=${offset}`,
      );
      const jobs = data.jobs ?? [];
      for (const j of jobs) {
        const html = String(j.description ?? "");
        const places: string[] = j.locationRestrictions ?? [];
        out.push(
          posting(
            {
              source: "himalayas",
              board: "search",
              externalId: String(j.guid),
              company: String(j.companyName ?? ""),
              title: String(j.title ?? ""),
              location: places.length
                ? `Remote, ${places.join(", ")}`
                : "Remote (worldwide)",
              salary:
                j.minSalary && j.maxSalary
                  ? `${j.currency ?? ""} ${j.minSalary}–${j.maxSalary} ${j.salaryPeriod ?? ""}`.trim()
                  : "Not disclosed",
              url: String(j.applicationLink ?? j.guid),
              description: textContent(html),
            },
            html,
          ),
        );
      }
      if (jobs.length < 20) break;
    }
  return out;
}

async function remoteOk(): Promise<Posting[]> {
  const data = await getJson("https://remoteok.com/api");
  return (Array.isArray(data) ? data.slice(1) : []).map((j: any) =>
    posting(
      {
        source: "remoteok",
        board: "all",
        externalId: String(j.id),
        company: String(j.company ?? ""),
        title: String(j.position ?? ""),
        location: j.location ? `Remote, ${j.location}` : "Remote",
        salary:
          j.salary_min && j.salary_max
            ? `USD ${j.salary_min}–${j.salary_max}`
            : "Not disclosed",
        url: String(j.url ?? ""),
        description: textContent(String(j.description ?? "")),
      },
      String(j.description ?? ""),
    ),
  );
}

async function remotive(): Promise<Posting[]> {
  const data = await getJson("https://remotive.com/api/remote-jobs?limit=300");
  return (data.jobs ?? []).map((j: any) =>
    posting(
      {
        source: "remotive",
        board: "software-dev",
        externalId: String(j.id),
        company: String(j.company_name ?? ""),
        title: String(j.title ?? ""),
        location: `Remote, ${j.candidate_required_location || "Worldwide"}`,
        salary: j.salary || "Not disclosed",
        url: String(j.url ?? ""),
        description: textContent(String(j.description ?? "")),
      },
      String(j.description ?? ""),
    ),
  );
}

// Rotate country/role/page combinations across runs within persisted provider budgets.
export async function adzuna(context: SearchContext): Promise<Posting[]> {
  const id = process.env.ADZUNA_APP_ID?.trim();
  const key = process.env.ADZUNA_APP_KEY?.trim();
  if (!id || !key) return [];
  const config = discoveryConfig();
  const plan = Array.from(
    { length: config.adzunaPages },
    (_, i) => i + 1,
  ).flatMap((page) =>
    searchQueries(context.profile).flatMap((what) =>
      config.adzunaCountries.map((country) => ({ page, what, country })),
    ),
  );
  const out: Posting[] = [];
  for (let n = 0; n < Math.min(plan.length, config.adzunaRequestsPerRun); n++) {
    const { page, what, country } = plan[context.state.cursor % plan.length];
    // 25/minute, including across process restarts. Failed calls also consume quota.
    const last = context.state.requests.at(-1) ?? 0;
    await delay(Math.max(0, 2500 - (Date.now() - last)));
    if (!(await reserveRequest(context, "adzuna"))) break;
    const start = out.length;
    try {
      const params = new URLSearchParams({
        app_id: id,
        app_key: key,
        what,
        results_per_page: "50",
        max_days_old: "21",
        sort_by: "date",
        "content-type": "application/json",
      });
      const data = await getJson(
        `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params}`,
      );
      for (const j of data.results ?? []) {
        if (!j.id || !safeUrl(String(j.redirect_url ?? ""))) continue;
        out.push(
          posting({
            source: "adzuna",
            board: country,
            externalId: String(j.id),
            company: String(j.company?.display_name ?? ""),
            title: textContent(String(j.title ?? "")),
            location: `${String(j.location?.display_name ?? "")}, ${MARKETS[country].name}`,
            salary:
              j.salary_min != null && j.salary_max != null
                ? `${MARKETS[country].currency} ${Math.round(j.salary_min)}–${Math.round(j.salary_max)}`
                : "Not disclosed",
            url: String(j.redirect_url),
            description: textContent(String(j.description ?? "")),
          }),
        );
      }
    } catch (e) {
      // Never include credential-bearing request URLs or provider response bodies.
      context.errors.push(`adzuna:${country}:page${page}: ${providerError(e)}`);
      if (/returned (401|403|429)/.test(providerError(e))) break;
    }
    // Store results before moving the cursor, so a crash cannot skip fetched jobs.
    await context.savePostings?.(out.slice(start));
    context.state.cursor = (context.state.cursor + 1) % plan.length;
    await context.saveState(context.state);
  }
  return out;
}

function providerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  return /^[a-z0-9.-]+ returned \d{3}$/.test(message)
    ? message
    : "Request failed (network or response format)";
}

export async function googleJobs(context: SearchContext): Promise<Posting[]> {
  const key = process.env.SERPAPI_API_KEY?.trim();
  if (!key) return [];
  const config = discoveryConfig();
  const plan = searchQueries(context.profile).flatMap((q) =>
    config.googleCountries.map((country) => ({ q, country })),
  );
  const out: Posting[] = [];
  // First-page breadth is deliberate: Google returns at most ten results per query.
  for (let n = 0; n < Math.min(plan.length, config.googleRequestsPerRun); n++) {
    const { q, country } = plan[context.state.cursor % plan.length];
    if (!(await reserveRequest(context, "google"))) break;
    const start = out.length;
    try {
      const name =
        MARKETS[country]?.name ||
        new Intl.DisplayNames(["en"], { type: "region" }).of(
          country.toUpperCase(),
        ) ||
        country;
      const params = new URLSearchParams({
        engine: "google_jobs",
        api_key: key,
        q: `${q} junior 0-${maxJobExperience()} years experience in ${name}`,
        gl: country === "gb" ? "uk" : country,
        hl: "en",
      });
      const data = await getJson(`https://serpapi.com/search.json?${params}`);
      if (data.error && !Array.isArray(data.jobs_results)) {
        context.errors.push(
          `google-jobs:${country}: provider returned no results or an error; check the provider dashboard`,
        );
      }
      for (const j of data.jobs_results ?? []) {
        const links = (j.apply_options ?? [])
          .map((a: any) => String(a.link ?? ""))
          .filter(safeUrl);
        const url =
          links.find((link: string) => boardsIn([link]).length) ||
          links[0] ||
          String(j.share_link ?? "");
        if (!j.job_id || !safeUrl(url)) continue;
        out.push(
          posting({
            source: "google-jobs",
            board: country,
            externalId: String(j.job_id),
            company: String(j.company_name ?? ""),
            title: String(j.title ?? ""),
            // "Anywhere" from a country-specific Google query isn't proof of worldwide eligibility.
            location: `${String(j.location ?? "Not specified")}, ${name}`,
            salary: String(j.detected_extensions?.salary ?? "Not disclosed"),
            url,
            description: textContent(String(j.description ?? "")),
            links,
            website: "",
          }),
        );
      }
    } catch (e) {
      context.errors.push(`google-jobs:${country}: ${providerError(e)}`);
      if (/returned (401|403|429)/.test(providerError(e))) break;
    }
    // Store results before moving the cursor, so a crash cannot skip fetched jobs.
    await context.savePostings?.(out.slice(start));
    context.state.cursor = (context.state.cursor + 1) % plan.length;
    await context.saveState(context.state);
  }
  return out;
}

// Minimum hours between calls, respecting each aggregator's published usage limits.
export const AGGREGATORS: {
  name: string;
  everyHours: number;
  run: (context: SearchContext) => Promise<Posting[]>;
  // Sources that need keys are not counted as scanned until the keys exist.
  ready?: () => boolean;
}[] = [
  {
    name: "google-jobs",
    everyHours: 6,
    run: googleJobs,
    ready: () => Boolean(process.env.SERPAPI_API_KEY?.trim()),
  },
  { name: "hackernews", everyHours: 6, run: hackerNews },
  { name: "himalayas", everyHours: 6, run: himalayas },
  { name: "remoteok", everyHours: 3, run: remoteOk },
  { name: "remotive", everyHours: 6, run: remotive },
  {
    name: "adzuna",
    everyHours: 6,
    run: adzuna,
    ready: () =>
      Boolean(
        process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim(),
      ),
  },
];

// Startup and Indian company boards verified to respond on 2026-09-26.
export const SEED_BOARDS: (BoardRef & { startup: boolean })[] = [
  ...[
    "sarvam=Sarvam AI",
    "composio=Composio",
    "plane=Plane",
    "atlan=Atlan",
    "nango=Nango",
    "airbyte=Airbyte",
  ].map((e) => ({ source: "ashby", e })),
  ...[
    "groww=Groww",
    "slice=slice",
    "inmobi=InMobi",
    "glance=Glance",
    "observeai=Observe.AI",
    "zenoti=Zenoti",
    "druva=Druva",
    "gitlab=GitLab",
    "databricks=Databricks",
    "coinbase=Coinbase",
    "elastic=Elastic",
  ].map((e) => ({ source: "greenhouse", e })),
  ...[
    "cred=CRED",
    "meesho=Meesho",
    "fampay=FamPay",
    "fi=Fi Money",
    "hevodata=Hevo Data",
    "mindtickle=Mindtickle",
    "pocketfm=Pocket FM",
    "porter=Porter",
    "peoplegrove=PeopleGrove",
    "paytm=Paytm",
  ].map((e) => ({ source: "lever", e })),
].map(({ source, e }) => {
  const [board, company] = e.split("=");
  return {
    source,
    board,
    company,
    startup: !["gitlab", "databricks", "coinbase", "elastic", "paytm"].includes(
      board,
    ),
  };
});
