import type { Posting } from "./sources.js";

export function normalizeLocation(value: string) {
  return value
    .toLowerCase()
    .replace(/bangalore/g, "bengaluru")
    .replace(/\b(usa|us|united states of america)\b/g, "united states")
    .replace(/\b(uk|gb|great britain)\b/g, "united kingdom")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function postingIdentity(
  p: Pick<Posting, "company" | "title" | "location">,
) {
  return [
    p.company.toLowerCase().trim(),
    p.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""),
    normalizeLocation(p.location),
  ].join("|");
}

// Round-robin across source/board buckets; strongest skill matches first within each bucket.
export function selectPostings(
  postings: Posting[],
  limit: number,
  score: (p: Posting) => number,
) {
  const buckets = new Map<string, Posting[]>();
  const scores = new Map(postings.map((p) => [p, score(p)]));
  for (const p of postings) {
    const key = `${p.source}:${p.board}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(p);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values())
    bucket.sort((a, b) => scores.get(b)! - scores.get(a)!);
  const selected: Posting[] = [];
  while (selected.length < limit) {
    let added = false;
    for (const bucket of buckets.values()) {
      const next = bucket.shift();
      if (next) {
        selected.push(next);
        added = true;
      }
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}
