// Only this extension's service worker talks to the Job Agent API.
importScripts("join-flow.js");
const API = "https://vinod-job-agent.onrender.com/api/workflow/forms";

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const call = async () => {
    if (["join-save", "join-load", "join-clear"].includes(message.type)) {
      const pageUrl = sender.url ?? sender.tab?.url;
      if (
        !sender.tab?.id ||
        !pageUrl ||
        new URL(pageUrl).origin !== "https://join.com"
      )
        throw new Error("Invalid JOIN tab.");
      const key = `join-session-${sender.tab.id}`;
      if (message.type === "join-clear") {
        await chrome.storage.session.remove(key);
        return {};
      }
      if (message.type === "join-save") {
        if (
          !/^[a-f0-9]{64}$/.test(message.packet?.reportToken ?? "") ||
          !joinPageMatches(message.packet.identity, pageUrl)
        )
          throw new Error("Wrong JOIN application.");
        await chrome.storage.session.set({
          [key]: {
            ...message.packet,
            auto: message.auto === true,
            expires: Math.min(
              message.packet.expires || Date.now() + 3 * 3_600_000,
              Date.now() + 3 * 3_600_000,
            ),
          },
        });
        return {};
      }
      const entry = (await chrome.storage.session.get(key))[key];
      if (!entry || entry.expires <= Date.now()) return null;
      if (!joinPageMatches(entry.identity, pageUrl)) return { blocked: true };
      return entry;
    }
    if (!/^[a-f0-9]{64}$/.test(message.token ?? ""))
      throw new Error("Invalid form code.");
    const path = [
      "claim",
      "closed",
      "submitted",
      "skip",
      "answers",
      "options",
      "draft",
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
            : path === "options" || path === "draft"
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
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`join-session-${tabId}`);
});
