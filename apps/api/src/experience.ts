import { textContent } from "./workflow-rules.js";

export function maxJobExperience() {
  const value = Number(process.env.JOB_MAX_EXPERIENCE_YEARS ?? "3");
  if (!Number.isFinite(value) || value < 0)
    throw new Error("JOB_MAX_EXPERIENCE_YEARS must be a nonnegative number");
  return value;
}

// Unknown requirements stay reviewable. Ranges use their lower bound; company
// age, benefits and optional qualifications are not candidate requirements.
export function experienceRequirements(description: string) {
  const text = textContent(description);
  const requirements: { years: number; evidence: string }[] = [];
  const number =
    "(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)";
  const pattern = new RegExp(
    `\\b(${number})(?:\\s*(?:[-–—]|to)\\s*${number})?\\s*\\+?\\s*(?:years?|yrs?)\\b`,
    "gi",
  );
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    twelve: 12,
    fifteen: 15,
  };
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, match.index! - 100), match.index);
    const after = text.slice(
      match.index! + match[0].length,
      match.index! + match[0].length + 130,
    );
    const clause = after.split(/[.;!?]/)[0];
    if (/^\s*ago\b/i.test(after)) continue;
    if (/\b\d+\s+$/.test(before)) continue; // malformed range such as "3 5 years"
    if (
      !/experience|expertise|building|developing|engineering|working|hands[- ]on|track record|\bin\b|\bwith\b/i.test(
        clause,
      ) &&
      !/experience\s*:\s*(?:at least|minimum|over)?\s*$/i.test(before)
    )
      continue;
    if (
      /\b(?:we have|we bring|with over|for over|company has|organisation with|organization with|built on|consulting partner with)(?:\s+(?:more than|over))?\s*$/i.test(
        before,
      )
    )
      continue;
    if (
      /With more than\s*$/i.test(before) &&
      /^\s+of experience,?\s+we\b/i.test(after)
    )
      continue;
    if (
      /\bcompany\b[^.;]{0,60}$/i.test(before) &&
      !/candidate|you|require/i.test(before)
    )
      continue;
    if (/\b(?:up to|upto|maximum|within|last|past|next)\s*$/i.test(before))
      continue;
    const section = text
      .slice(0, match.index)
      .match(
        /(?:preferred qualifications|preferred skills|nice[- ]to[- ]have|bonus points|minimum qualifications|required qualifications|requirements|must[- ]have)/gi,
      )
      ?.at(-1);
    if (section && /preferred|nice|bonus/i.test(section)) continue;
    if (
      /^\s*(?:preferred|desirable|is a plus|would be a plus)/i.test(clause) ||
      /\bpreferred but not required\b/i.test(clause)
    )
      continue;
    // Alternative education/experience paths need manual review.
    if (
      /\bor\b[^.;]{0,70}\d+\+?\s*years?[^.;]{0,40}equivalent/i.test(
        text.slice(Math.max(0, match.index! - 120), match.index! + 160),
      )
    )
      continue;
    const years = words[match[1].toLowerCase()] ?? Number(match[1]);
    if (years > 20) continue; // often a company age or a damaged "2–3" range
    requirements.push({
      years,
      evidence: `${before.slice(-65)}${match[0]}${clause}`.trim(),
    });
  }
  return requirements;
}

export function experienceFits(description: string) {
  return experienceRequirements(description).every(
    (r) => r.years <= maxJobExperience(),
  );
}
