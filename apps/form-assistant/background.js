// Only this extension's service worker talks to the Job Agent API.
importScripts("join-flow.js");
const API = "https://vinod-job-agent.onrender.com/api/workflow/forms";

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const call = async () => {
    if (message.type === "external-enable") {
      let pending = (
        await chrome.storage.session.get(
          `external-pending-${sender.tab?.id || message.tabId}`,
        )
      )[`external-pending-${sender.tab?.id || message.tabId}`];
      const tab = await chrome.tabs.get(message.tabId);
      if (!pending) {
        const direct = (
          await chrome.storage.session.get(`linkedin-bridge-${tab.id}`)
        )[`linkedin-bridge-${tab.id}`];
        const opener =
          tab.openerTabId === undefined
            ? null
            : (
                await chrome.storage.session.get(
                  `linkedin-bridge-${tab.openerTabId}`,
                )
              )[`linkedin-bridge-${tab.openerTabId}`];
        const armed = direct || opener;
        if (armed) pending = { ...armed, url: tab.url };
      }
      if (
        !(await chrome.permissions.contains({
          origins: [`${new URL(tab.url).origin}/*`],
        }))
      )
        throw Error("Enable this employer site in the extension first.");
      if (
        !pending ||
        pending.expires < Date.now() ||
        new URL(tab.url).origin !== new URL(pending.url).origin
      )
        throw Error("Prepare the LinkedIn Apply link again.");
      const response = await fetch(`${API}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Job-Agent-Form-Token": pending.token,
        },
        body: JSON.stringify({
          pageUrl: pending.pageUrl,
          applicationUrl: pending.url,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.message || "Could not prepare destination.");
      await chrome.storage.session.remove(`external-pending-${tab.id}`);
      await chrome.storage.session.remove(`linkedin-bridge-${tab.id}`);
      if (tab.openerTabId !== undefined)
        await chrome.storage.session.remove(
          `linkedin-bridge-${tab.openerTabId}`,
        );
      await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
      await chrome.tabs.update(tab.id, {
        url: data.openUrl + (pending.auto ? "&auto=1" : ""),
      });
      await chrome.tabs.reload(tab.id);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["fill.js", "external-content.js"],
      });
      return {};
    }
    if (
      ["external-save", "external-load", "external-clear"].includes(
        message.type,
      )
    ) {
      if (!sender.tab?.id) throw Error("Missing application tab.");
      const url = new URL(sender.tab.url);
      url.hash = "";
      const key = `external-session-${sender.tab.id}`;
      if (message.type === "external-clear") {
        await chrome.storage.session.remove(key);
        return {};
      }
      if (message.type === "external-save") {
        const packet = message.packet;
        if (
          !packet?.identity?.startsWith("external:") ||
          !/^[a-f0-9]{64}$/.test(packet.reportToken || "") ||
          (packet.identity !== `external:${encodeURIComponent(url.href)}` &&
            !packet.pages?.includes(url.href))
        )
          throw Error("Wrong application page.");
        await chrome.storage.session.set({
          [key]: {
            ...packet,
            expires: Math.min(
              packet.expires || Date.now() + 10800000,
              Date.now() + 10800000,
            ),
          },
        });
        return {};
      }
      const entry = (await chrome.storage.session.get(key))[key];
      if (!entry || entry.expires < Date.now()) return null;
      return entry.identity === `external:${encodeURIComponent(url.href)}` ||
        entry.pages?.includes(url.href)
        ? entry
        : null;
    }
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
  void chrome.storage.session.remove(`external-pending-${tabId}`);
  void chrome.storage.session.remove(`external-session-${tabId}`);
});

// Apply may open a new tab before its final URL is known. Listen for the URL
// update and bind it only to the armed approved job in its opener tab.
const resolvingLinkedIn = new Set();
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  resumeExternal(tabId, change, tab);
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
    ) {
      if (
        target.protocol === "https:" &&
        !["linkedin.com", "www.linkedin.com"].includes(target.hostname)
      ) {
        await chrome.storage.session.set({
          [`external-pending-${tabId}`]: { ...state, url: target.href },
        });
        await chrome.action.setBadgeText({ tabId, text: "GO" });
        if (
          await chrome.permissions.contains({ origins: [`${target.origin}/*`] })
        )
          await chrome.runtime.sendMessage({ type: "external-enable", tabId });
      }
      return;
    }
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

// Resume only a prepared application in a site the user enabled.
function resumeExternal(tabId, change, tab) {
  if (change.status !== "complete" || !tab.url?.startsWith("https:")) return;
  void (async () => {
    const u = new URL(tab.url);
    u.hash = "";
    const entry = (
      await chrome.storage.session.get(`external-session-${tabId}`)
    )[`external-session-${tabId}`];
    if (!entry && !/#job-agent=[a-f0-9]{64}/.test(tab.url)) return;
    if (
      entry &&
      entry.identity !== `external:${encodeURIComponent(u.href)}` &&
      !entry.pages?.includes(u.href)
    )
      return;
    if (!(await chrome.permissions.contains({ origins: [`${u.origin}/*`] })))
      return;
    if (
      [
        "www.linkedin.com",
        "linkedin.com",
        "join.com",
        "app.whitecarrot.io",
        "jobs.lever.co",
        "jobs.eu.lever.co",
        "jobs.ashbyhq.com",
        "boards.greenhouse.io",
        "job-boards.greenhouse.io",
      ].includes(u.hostname)
    )
      return;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["fill.js", "external-content.js"],
    });
  })().catch(() => {});
}
