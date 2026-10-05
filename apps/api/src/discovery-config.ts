import type { Posting } from "./sources.js";

export const MARKETS: Record<string, { name: string; currency: string }> = {
  in: { name: "India", currency: "INR" },
  us: { name: "United States", currency: "USD" },
  gb: { name: "United Kingdom", currency: "GBP" },
  ca: { name: "Canada", currency: "CAD" },
  au: { name: "Australia", currency: "AUD" },
  de: { name: "Germany", currency: "EUR" },
  fr: { name: "France", currency: "EUR" },
  nl: { name: "Netherlands", currency: "EUR" },
  sg: { name: "Singapore", currency: "SGD" },
  nz: { name: "New Zealand", currency: "NZD" },
  at: { name: "Austria", currency: "EUR" },
  be: { name: "Belgium", currency: "EUR" },
  br: { name: "Brazil", currency: "BRL" },
  it: { name: "Italy", currency: "EUR" },
  mx: { name: "Mexico", currency: "MXN" },
  pl: { name: "Poland", currency: "PLN" },
  za: { name: "South Africa", currency: "ZAR" },
  es: { name: "Spain", currency: "EUR" },
  ch: { name: "Switzerland", currency: "CHF" },
};

export function integerSetting(
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

export function countries(
  name: string,
  fallback: string,
  supported?: string[],
) {
  const raw = process.env[name]?.trim() || fallback;
  const result = [
    ...new Set(
      (raw === "all" && supported ? supported : raw.split(","))
        .map((s) => s.trim().toLowerCase())
        .map((s) => (s === "uk" ? "gb" : s)),
    ),
  ];
  if (
    result.some(
      (s) => !/^[a-z]{2}$/.test(s) || (supported && !supported.includes(s)),
    )
  )
    throw new Error(`${name} contains an unsupported country code`);
  return result;
}

export function discoveryConfig() {
  const locationScope =
    process.env.DISCOVERY_LOCATION_SCOPE?.trim() || "profile";
  if (!["profile", "worldwide"].includes(locationScope))
    throw new Error("DISCOVERY_LOCATION_SCOPE must be profile or worldwide");
  const seniority = process.env.JOB_SENIORITY?.trim() || "junior-mid";
  if (!["junior-mid", "all"].includes(seniority))
    throw new Error("JOB_SENIORITY must be junior-mid or all");
  return {
    locationScope,
    seniority,
    adzunaCountries: countries("ADZUNA_COUNTRIES", "all", Object.keys(MARKETS)),
    adzunaPages: integerSetting("ADZUNA_PAGES", 2, 1, 10),
    adzunaRequestsPerRun: integerSetting("ADZUNA_REQUESTS_PER_RUN", 18, 1, 100),
    googleCountries: countries(
      "GOOGLE_JOBS_COUNTRIES",
      "in,us,gb,ca,au,de,sg,ae",
    ),
    googleRequestsPerRun: integerSetting(
      "GOOGLE_JOBS_REQUESTS_PER_RUN",
      4,
      1,
      50,
    ),
    googleMonthlyLimit: integerSetting(
      "GOOGLE_JOBS_MONTHLY_LIMIT",
      100,
      1,
      10000,
    ),
    adzunaConfigured: Boolean(
      process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim(),
    ),
    googleJobsConfigured: Boolean(process.env.SERPAPI_API_KEY?.trim()),
  };
}

export type SearchProfile = { targetRoles: string[] };
export type SearchState = { cursor: number; requests: number[] };
export type SearchContext = {
  profile: SearchProfile;
  state: SearchState;
  saveState: (state: SearchState) => Promise<void>;
  savePostings?: (postings: Posting[]) => Promise<void>;
  errors: string[];
};

// Reservations are persisted before each request so restarts cannot reset quotas.
export async function reserveRequest(
  context: SearchContext,
  provider: "adzuna" | "google",
  now = Date.now(),
) {
  const day = 86_400_000;
  context.state.requests = context.state.requests.filter(
    (at) => at > now - 31 * day,
  );
  const count = (days: number) =>
    context.state.requests.filter((at) => at > now - days * day).length;
  const limited =
    provider === "adzuna"
      ? count(1) >= 250 || count(7) >= 1000 || count(31) >= 2500
      : count(31) >= discoveryConfig().googleMonthlyLimit;
  if (limited) {
    context.errors.push(
      `${provider}: request budget reached; remaining searches continue on a later run`,
    );
    return false;
  }
  context.state.requests.push(now);
  await context.saveState(context.state);
  return true;
}

export function searchQueries(profile: SearchProfile) {
  return [...new Set(profile.targetRoles.map((r) => r.trim()).filter(Boolean))];
}
