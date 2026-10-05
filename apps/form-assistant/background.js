// Only this extension's service worker talks to the Job Agent API.
const API = "https://vinod-job-agent.onrender.com/api/workflow/forms";

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const call = async () => {
    if (!/^[a-f0-9]{64}$/.test(message.token ?? ""))
      throw new Error("Invalid form code.");
    const path = [
      "claim",
      "closed",
      "submitted",
      "skip",
      "answers",
      "options",
    ].includes(message.type)
      ? message.type
      : null;
    if (!path) throw new Error("Unknown request.");
    const response = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Job-Agent-Form-Token": message.token,
      },
      // The page address comes from Chrome, not from the page, so it can't be spoofed.
      body: JSON.stringify(
        path === "claim" || path === "closed"
          ? {
              pageUrl: sender.tab?.url?.split("#")[0],
              questions: message.questions ?? [],
            }
          : path === "answers"
            ? { answers: message.answers ?? [] }
            : path === "options"
              ? { questions: message.questions ?? [] }
              : {},
      ),
      signal: AbortSignal.timeout(120000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        data.message || "Job Agent API refused the request. Is it running?",
      );
    return data;
  };
  call().then(
    (data) => reply({ ok: true, data }),
    (e) => reply({ ok: false, error: e.message }),
  );
  return true;
});
