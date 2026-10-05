// Job-specific binding, not just an ATS hostname. No generic site automation.
export function formTarget(
  value: string,
): { identity: string; url: string; provider: string } | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port)
      return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (
      u.hostname === "join.com" &&
      parts.length === 3 &&
      parts[0] === "companies" &&
      /^[a-z0-9_-]+$/i.test(parts[1]) &&
      (/^\d+-[a-z0-9-]+$/i.test(parts[2]) ||
        parts[2] === "spontaneous-application")
    ) {
      return {
        provider: "JOIN",
        identity: `join:${parts[1].toLowerCase()}:${parts[2]}`,
        url: `https://join.com/companies/${parts[1]}/${parts[2]}`,
      };
    }
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

export function autofillTarget(job: {
  source: string;
  board: string;
  externalId: string;
  url: string;
}) {
  return formTarget(
    job.source === "greenhouse" && job.board && /^\d+$/.test(job.externalId)
      ? `https://job-boards.greenhouse.io/${job.board}/jobs/${job.externalId}`
      : job.url,
  );
}
