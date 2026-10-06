// Only this extension's service worker talks to the Job Agent API.
importScripts("join-flow.js");
const API = "https://vinod-job-agent.onrender.com/api/workflow/forms";

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const call = async () => {
    if (message.type === "linkedin-arm") {
      const page = new URL(sender.tab?.url ?? "");
      if (
        !sender.tab?.id ||
        !["www.linkedin.com", "linkedin.com"].includes(page.hostname) ||
        !/^\/jobs\/view\/\d+\/?$/.test(page.pathname) ||
        !/^[a-f0-9]{64}$/.test(message.token ?? "")
      )
        throw new Error("Open the exact approved LinkedIn job first.");
      await chrome.storage.session.set({
        [`linkedin-bridge-${sender.tab.id}`]: {
          token: message.token,
          pageUrl: page.href.split("#")[0],
          auto: message.auto === true,
          expires: Date.now() + 5 * 60_000,
        },
      });
      return {};
    }
    if (["join-save", "join-load", "join-clear"].includes(message.type)) {
      const pageUrl = sender.url ?? sender.tab?.url;
      if (
        !sender.tab?.id ||
        !pageUrl ||
        !["https://join.com", "https://app.whitecarrot.io"].includes(
          new URL(pageUrl).origin,
        )
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
      "resolve",
      "plan",
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
        path === "plan"
          ? {
              observation: {
                ...message.observation,
                pageUrl: sender.tab?.url?.split("#")[0],
              },
            }
          : path === "resolve"
            ? {
                pageUrl: sender.tab?.url?.split("#")[0],
                applicationUrl: message.applicationUrl,
              }
            : path === "claim" || path === "closed"
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
  void chrome.storage.session.remove(`linkedin-bridge-${tabId}`);
});

// Apply may open a new tab before its final URL is known. Listen for the URL
// update and bind it only to the armed approved job in its opener tab.
const resolvingLinkedIn = new Set();
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!change.url) return;
  void (async () => {
    let sourceId = tabId;
    let key = `linkedin-bridge-${sourceId}`;
    let state = (await chrome.storage.session.get(key))[key];
    if (!state && tab.openerTabId !== undefined) {
      sourceId = tab.openerTabId;
      key = `linkedin-bridge-${sourceId}`;
      state = (await chrome.storage.session.get(key))[key];
    }
    if (!state || state.expires < Date.now()) return;
    if (resolvingLinkedIn.has(sourceId)) return;
    const target = new URL(change.url);
    if (
      ![
        "job-boards.greenhouse.io",
        "boards.greenhouse.io",
        "jobs.lever.co",
        "jobs.eu.lever.co",
        "jobs.ashbyhq.com",
        "join.com",
        "app.whitecarrot.io",
      ].includes(target.hostname) ||
      target.protocol !== "https:"
    )
      return;
    resolvingLinkedIn.add(sourceId);
    try {
      const response = await fetch(`${API}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Job-Agent-Form-Token": state.token,
        },
        body: JSON.stringify({
          pageUrl: state.pageUrl,
          applicationUrl: target.href,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.message || "Could not resolve application.");
      await chrome.storage.session.remove(key);
      const url = data.openUrl || data.next;
      if (url) {
        await chrome.tabs.update(tabId, {
          url: url + (state.auto ? "&auto=1" : ""),
        });
        if (target.href.split("#")[0] === url.split("#")[0])
          await chrome.tabs.reload(tabId);
      }
    } catch (error) {
      await chrome.storage.session.remove(key);
      console.warn(
        "LinkedIn Apply handoff failed; prepare the job again:",
        error.message,
      );
    } finally {
      resolvingLinkedIn.delete(sourceId);
    }
  })();
});
