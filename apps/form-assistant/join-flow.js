// Shared by the service worker and JOIN content script. Bind every step to the
// approved application; a company's other vacancies are separate approvals.
function joinPageMatches(identity, value) {
  try {
    const [provider, company, job] = identity.split(":");
    const u = new URL(value),
      p = u.pathname.split("/").filter(Boolean);
    if (
      provider !== "join" ||
      u.origin !== "https://join.com" ||
      p[0] !== "companies" ||
      p[1]?.toLowerCase() !== company ||
      u.username ||
      u.password
    )
      return false;
    if (p.length === 3 && p[2] === job) return true;
    if (p[2] !== "apply" || p.length > 4) return false;
    return (
      job === "spontaneous-application" ||
      u.searchParams.get("jobId") === job.split("-")[0]
    );
  } catch {
    return false;
  }
}

function joinButtonKind(label) {
  const text = label.trim().toLowerCase();
  if (/^(apply now|apply for this (job|position))$/.test(text)) return "apply";
  if (/^(next|next step|continue|save and continue)$/.test(text)) return "next";
  if (/^(submit( application)?|send application)$/.test(text)) return "submit";
  return null;
}
