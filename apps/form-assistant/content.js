// Runs on Greenhouse, Lever and Ashby pages. Does nothing unless the page was
// opened from the Job Agent dashboard with a one-time #job-agent=<code>, or a
// form filled earlier in this tab is waiting for its confirmation page.
(async () => {
  const PENDING = "job-agent-report";
  const PREPARING = "job-agent-preparing";
  const closedRedirect = () =>
    ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(
      location.hostname,
    ) &&
    (location.pathname === "/embed/job_board" ||
      /^\/[a-z0-9_-]+\/?$/i.test(location.pathname)) &&
    new URL(location.href).searchParams.get("error") === "true";
  let preparation = null;
  try {
    preparation = JSON.parse(sessionStorage.getItem(PREPARING) ?? "null");
  } catch {}
  const directMatch = /(?:^#|&)job-agent=([a-f0-9]{64})/.exec(location.hash);
  const match =
    directMatch ||
    (closedRedirect() &&
    preparation?.expires > Date.now() &&
    /^[a-f0-9]{64}$/.test(preparation.code)
      ? ["", preparation.code]
      : null);
  // Set after a form is filled. It can only mark that one job as applied or skipped.
  const pending = (() => {
    try {
      const p = JSON.parse(sessionStorage.getItem(PENDING) ?? "null");
      return p &&
        p.expires > Date.now() &&
        /^[a-f0-9]{64}$/.test(p.token) &&
        typeof p.job === "string"
        ? p
        : null;
    } catch {
      return null;
    }
  })();
  if (!match && !pending) return;
  // Chosen on the dashboard: submit by itself when nothing required is missing.
  const auto = match
    ? directMatch
      ? /(?:^#|&)auto=1(?:&|$)/.test(location.hash)
      : preparation.auto === true
    : pending.auto === true;

  const banner = document.createElement("div");
  banner.setAttribute("role", "status");
  // Drawn in its own shadow tree so the site's styles can't distort it.
  const panel = banner.attachShadow({ mode: "open" });
  banner.style.cssText =
    "all:initial;display:block;position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:380px;max-height:60vh;overflow:auto;background:#fff;color:#1d3b2f;border:2px solid #265942;border-radius:10px;padding:14px 16px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.2)";
  const show = (html) => {
    panel.innerHTML = `<strong>Job Agent · 0.21.0</strong><br>${html}`;
    if (!banner.isConnected) document.body.append(banner);
  };
  const escape = (t) =>
    String(t).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const ask = (message) =>
    new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Records this job as applied ("submitted") or passed over ("skip"), then
  // continues with the next approved job in this same tab.
  let settled = false;
  const finish = async (type, token) => {
    settled = true;
    sessionStorage.removeItem(PENDING);
    sessionStorage.removeItem(PREPARING);
    const done = await ask({ type, token });
    if (!done?.ok)
      return show(escape(done?.error ?? "Could not update Job Agent."));
    const did =
      type === "submitted"
        ? "Application submitted and marked as applied."
        : "Skipped.";
    const next = done.data?.next;
    if (
      typeof next === "string" &&
      /^https:\/\/(job-boards\.greenhouse\.io|jobs\.(eu\.)?lever\.co|jobs\.ashbyhq\.com)\//.test(
        next,
      )
    ) {
      show(`${did} Opening your next approved job…`);
      setTimeout(() => {
        location.href = next + (auto ? "&auto=1" : "");
      }, 1500);
    } else if (done.data?.paused)
      show(
        `${did} That is ${done.data.paused} applications in this round, so the agent has stopped. Click Apply next 10 on the dashboard for the next round.`,
      );
    else show(`${did} No more approved jobs to open. You can close this tab.`);
  };

  const submitButton = () =>
    [
      ...document.querySelectorAll(
        'button[type="submit"],input[type="submit"],button',
      ),
    ].find(
      (b) =>
        !b.disabled &&
        b.getClientRects().length &&
        /^submit\b/i.test((b.textContent || b.value || "").trim()),
    );
  // The form this tab is waiting on, kept across the page change after Submit.
  let current = pending;
  const noteSubmit = () => {
    if (!current) return;
    current.submitAt = Date.now();
    try {
      sessionStorage.setItem(PENDING, JSON.stringify(current));
    } catch {}
  };
  const justSubmitted = (p) =>
    Boolean(p.submitAt) && Date.now() - p.submitAt < 5 * 60_000;
  // The site's own confirmation after Submit. A thank-you text only counts once
  // the form's Submit button is gone, so wording on the form itself is never
  // mistaken for one. It must be this job's page, or follow a Submit click.
  const submittedPage = (p) =>
    (/\/(confirmation|thanks)\b/.test(location.pathname) ||
      (!submitButton() &&
        /thank you for applying|thanks for applying|application (was |has been )?(successfully )?(submitted|received)|successfully submitted your application/i.test(
          (document.body.innerText ?? "").slice(0, 20000),
        ))) &&
    (location.href.includes(p.job) || justSubmitted(p));
  // Marks the job as applied as soon as the site confirms the submission.
  const watch = (p) => {
    const timer = setInterval(() => {
      // Not tied to sessionStorage: some sites clear it when the form is submitted.
      if (p.expires < Date.now() || settled) return clearInterval(timer);
      if (!submittedPage(p)) return;
      clearInterval(timer);
      void finish("submitted", p.token);
    }, 1000);
  };

  if (!match) {
    watch(pending);
    // Submit led to a new page that is not a recognised confirmation: ask once.
    if (justSubmitted(pending))
      setTimeout(() => {
        if (settled || submitButton()) return;
        show(
          `Did your application go through?<br>` +
            `<button id="job-agent-done" style="margin:8px 4px 0 0;padding:8px 12px;border-radius:8px;border:0;background:#265942;color:#fff;font-weight:600;cursor:pointer">Yes, it was submitted</button>` +
            `<button id="job-agent-close" style="margin:8px 4px 0 0;padding:8px 12px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer">No</button>`,
        );
        panel
          .querySelector("#job-agent-done")
          .addEventListener("click", () => finish("submitted", pending.token));
        panel
          .querySelector("#job-agent-close")
          .addEventListener("click", () => banner.remove());
      }, 5000);
    return;
  }
  const token = match[1];
  sessionStorage.setItem(
    PREPARING,
    JSON.stringify({ code: token, auto, expires: Date.now() + 10 * 60_000 }),
  );
  history.replaceState(null, "", location.href.split("#")[0]); // Remove the code from the address.
  show("Waiting for the application form…");

  // The options of this dropdown's own open list. Another question's list, and
  // hidden lists such as the phone field's country codes, are never used.
  const optionsOf = (el) => {
    const listId =
      el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    let menu = listId ? document.getElementById(listId) : null;
    for (
      let node = el.parentElement, depth = 0;
      !menu && node && depth < 6;
      depth++, node = node.parentElement
    )
      if (node.querySelector('[role="option"]')) menu = node;
    return menu
      ? [...menu.querySelectorAll('[role="option"]')].filter(
          (o) => o.getClientRects().length,
        )
      : [];
  };
  const key = (name) =>
    new KeyboardEvent("keydown", { key: name, code: name, bubbles: true });
  // A full press and release, as a mouse click produces. Greenhouse's dropdowns
  // open only on the complete sequence, not on mousedown or a key press alone.
  const press = (node) => {
    for (const type of ["mousedown", "mouseup", "click"])
      node.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window,
        }),
      );
  };
  const control = (el) => el.closest("[class*='control']") ?? el;
  const expanded = (el) => el.getAttribute("aria-expanded") === "true";
  // Closes a list the way clicking its box again does.
  const close = (el) => {
    if (expanded(el)) press(control(el));
    if (expanded(el)) el.dispatchEvent(key("Escape"));
    el.blur();
  };
  // Only one list is open at a time, like a person using the form.
  const closeOthers = (el) => {
    for (const other of document.querySelectorAll(
      'input[role="combobox"][aria-expanded="true"]',
    ))
      if (other !== el) close(other);
  };
  // Opens the dropdown without typing and returns its options.
  const openList = async (el) => {
    closeOthers(el);
    const wait = async () => {
      for (let i = 0; i < 5; i++) {
        await sleep(150);
        if (optionsOf(el).length) break;
      }
      return optionsOf(el);
    };
    if (!expanded(el)) press(control(el));
    let options = await wait();
    if (!options.length && !expanded(el)) {
      // Other dropdown libraries open on a key press.
      el.focus();
      el.dispatchEvent(key("ArrowDown"));
      options = await wait();
    }
    return options;
  };
  // Puts text in the box the way the keyboard does; forms ignore other ways.
  const typeInto = (el, text) => {
    el.focus();
    let typed = false;
    try {
      el.select();
      typed = text
        ? document.execCommand("insertText", false, text)
        : document.execCommand("delete");
    } catch {}
    if (typed && el.value === text) return;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(el, text);
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  };
  // Opens a searchable dropdown just to read what can be chosen.
  const readOptions = async (el) => {
    const options = (await openList(el)).map((o) => o.textContent.trim());
    close(el);
    return [...new Set(options.filter(Boolean))];
  };

  // Picks an option: first from the dropdown's own list, then, for search boxes
  // and long lists (city, school), by typing a search. Returns "" when an option
  // was chosen, otherwise a short reason shown in the notes.
  const choose = async (el, text, exact) => {
    const want = text.trim().toLowerCase();
    const name = (o) => o.textContent.trim().toLowerCase();
    const words = want.match(/[a-z0-9]{3,}/g) ?? [];
    // "India" also finds "India +91". On search results a looser match is
    // allowed: "IIT, Kharagpur" finds "Indian Institute of Technology (IIT) - Kharagpur".
    const find = (options, searched) =>
      options.find((o) => name(o) === want) ??
      (exact
        ? undefined
        : (options.find((o) => name(o).startsWith(want)) ??
          (searched
            ? (options.find((o) => name(o).includes(want)) ??
              (words.length
                ? options.find((o) => words.every((w) => name(o).includes(w)))
                : undefined))
            : undefined)));
    let seen = await openList(el);
    let hit = find(seen, false);
    // A short list that shows its options is only ever selected from. Typing is
    // for search boxes and long lists, which show more once you search.
    if (!hit && (!seen.length || seen.length >= 50)) {
      // Search with the whole answer, then with its parts ("Kharagpur", "IIT").
      const queries = [
        ...new Set([
          text.trim(),
          ...text
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length >= 3)
            .reverse(),
        ]),
      ];
      for (const query of queries) {
        if (!expanded(el)) press(control(el));
        typeInto(el, query);
        for (let i = 0; i < 10 && !hit; i++) {
          await sleep(250);
          const options = optionsOf(el);
          if (options.length) seen = options;
          hit = find(options, true);
          // The results have loaded and hold no match: try the next search.
          if (!hit && options.length && i >= 3) break;
        }
        if (hit) break;
      }
    }
    if (hit) {
      hit.click();
      const box = control(el);
      box.style.outline = "2px solid #e0a400";
      box.style.outlineOffset = "1px";
      await sleep(150);
      close(el);
      return "";
    }
    // Nothing matched: leave the question untouched for you.
    if (el.value) typeInto(el, "");
    close(el);
    return seen.length
      ? `"${text}" is not among its ${seen.length} options (first: ${seen[0].textContent.trim().slice(0, 40)})`
      : `its list did not open${document.hasFocus() ? "" : " (this tab was not the active window)"}`;
  };

  try {
    // Lever and Ashby render the form after load; wait up to 20 seconds for fields.
    let questions = null;
    for (let i = 0; i < 40 && !questions; i++) {
      if (closedRedirect()) {
        show("This job is no longer open. Skipping…");
        await finish("closed", token);
        return;
      }
      try {
        questions = fillApplication({}, "questions");
      } catch {
        await sleep(500);
      }
    }
    if (!questions)
      throw new Error(
        "No application form appeared. Click the site's Apply button, then fill manually.",
      );
    show("Filling your details and drafting answers…");
    const claim = await ask({ type: "claim", token, questions });
    if (!claim?.ok)
      throw new Error(claim?.error ?? "Could not reach Job Agent.");
    sessionStorage.removeItem(PREPARING);
    const result = fillApplication(claim.data, "fill");
    // Picks the options that fillApplication marked on searchable dropdowns.
    const pickMarked = async () => {
      for (const el of document.querySelectorAll("[data-job-agent-choice]")) {
        const { jobAgentLabel, jobAgentChoice, jobAgentExact } = el.dataset;
        delete el.dataset.jobAgentChoice;
        const problem = await choose(el, jobAgentChoice, jobAgentExact === "1");
        if (!problem)
          result.filled.push(
            `${jobAgentLabel} (chosen from the list — check it)`,
          );
        else result.skipped.push(`${jobAgentLabel}: ${problem}`);
      }
    };
    await pickMarked();
    // Dropdowns that are still empty: read their options and let Job Agent
    // choose the one your profile supports, if any.
    try {
      show("Reading the remaining multiple-choice questions…");
      const open = fillApplication(
        { identity: claim.data.identity },
        "dropdowns",
      );
      for (const el of document.querySelectorAll("[data-job-agent-open]")) {
        const question = el.dataset.jobAgentOpen;
        delete el.dataset.jobAgentOpen;
        const options = await readOptions(el);
        if (options.length && options.length <= 200)
          open.push({ question, options });
      }
      if (open.length) {
        const picked = await ask({
          type: "options",
          token: claim.data.reportToken,
          questions: open.slice(0, 30),
        });
        const answers = picked?.ok ? (picked.data?.answers ?? {}) : {};
        if (Object.keys(answers).length) {
          const more = fillApplication(
            {
              identity: claim.data.identity,
              answers,
              remembered: picked.data?.remembered ?? [],
              exact: true,
              noResume: true,
            },
            "fill",
          );
          result.filled.push(...more.filled);
          await pickMarked();
        }
      }
    } catch {
      // Optional step: what could not be chosen stays for you.
    }
    result.unanswered = fillApplication(
      { identity: claim.data.identity },
      "unanswered",
    );
    const waiting = {
      token: claim.data.reportToken,
      job: claim.data.identity.split(":").pop(),
      auto,
      expires: Date.now() + 3 * 3_600_000,
    };
    current = waiting;
    sessionStorage.setItem(PENDING, JSON.stringify(waiting));
    watch(waiting);
    // When Submit is clicked, remember what was answered on this form so the
    // same questions are filled on later forms.
    // Only forms you submit yourself teach the agent; ones it submits alone do not.
    let byAgent = false;
    const remember = () => {
      if (byAgent) return;
      try {
        const answers = fillApplication(
          { identity: claim.data.identity },
          "snapshot",
        );
        if (answers.length)
          void ask({ type: "answers", token: waiting.token, answers });
      } catch {}
    };
    // Every Submit is noted, so the confirmation page after it is recognised.
    const submitting = () => {
      noteSubmit();
      remember();
    };
    document.addEventListener("submit", submitting, true);
    document.addEventListener(
      "click",
      (event) => {
        const pressed =
          event.target instanceof Element &&
          event.target.closest('button,input[type="submit"]');
        if (
          pressed &&
          /^submit\b/i.test((pressed.textContent || pressed.value || "").trim())
        )
          submitting();
      },
      true,
    );

    const submit = submitButton();
    const willSubmit = auto && submit && !result.unanswered.length;
    const list = (title, items) =>
      items.length
        ? `<br><em>${title}</em><ul style="margin:4px 0 0 18px;padding:0">${items.map((x) => `<li>${escape(x)}</li>`).join("")}</ul>`
        : "";
    const button = (id, text, primary) =>
      `<button id="${id}" style="margin:8px 4px 0 0;padding:8px 12px;border-radius:8px;cursor:pointer;${primary ? "border:0;background:#265942;color:#fff;font-weight:600" : "border:1px solid #ccc;background:#fff"}">${text}</button>`;
    show(
      `<div id="job-agent-auto" style="font-weight:600">${
        willSubmit
          ? `Submitting by itself in <span id="job-agent-count">10</span> seconds… ${button("job-agent-cancel", "Don't submit")}`
          : auto
            ? result.unanswered.length
              ? "Not submitted: required answers are missing. Fill them and click the site's Submit."
              : "Not submitted: no Submit button found. Click the site's Submit yourself."
            : "Nothing was submitted."
      }</div>` +
        `Filled ${result.filled.length} fields (outlined in yellow).` +
        list("Needs your answer", result.unanswered) +
        list("Filled", result.filled) +
        list("Notes", result.skipped) +
        `<br>Answer what is missing: your answers are remembered and filled in on later forms.` +
        `<br>Submit from here or on the site. Job Agent then marks this job as applied and opens your next approved job.<br>` +
        button("job-agent-submit", "Submit application", true) +
        button("job-agent-done", "I submitted it") +
        button("job-agent-skip", "Skip this job") +
        button("job-agent-close", "Close"),
    );
    const on = (id, action) =>
      panel.querySelector(`#${id}`)?.addEventListener("click", action);
    on("job-agent-close", () => banner.remove());
    on("job-agent-done", () => finish("submitted", waiting.token));
    on("job-agent-submit", async () => {
      const status = panel.querySelector("#job-agent-auto");
      const site = submitButton();
      if (!site) {
        status.textContent =
          "No Submit button found on this page. Submit on the site, then click I submitted it.";
        return;
      }
      site.click();
      status.textContent = "Submit clicked. Waiting for the site to confirm…";
      await sleep(12000);
      if (!settled)
        status.textContent =
          "The site has not confirmed the application. Look for a highlighted error or a CAPTCHA on the form, fix it and submit again.";
    });
    on("job-agent-skip", () => finish("skip", waiting.token));
    if (willSubmit) {
      const status = panel.querySelector("#job-agent-auto");
      let cancelled = false;
      on("job-agent-cancel", () => {
        cancelled = true;
        status.textContent =
          "Automatic submit cancelled. Click the site's Submit when you are ready.";
      });
      // The pause also lets the site finish uploading the CV.
      for (let seconds = 10; seconds > 0 && !cancelled; seconds--) {
        const count = panel.querySelector("#job-agent-count");
        if (count) count.textContent = String(seconds);
        await sleep(1000);
      }
      // Check once more right before submitting: the site may have cleared a field.
      const missing = cancelled
        ? []
        : fillApplication({ identity: claim.data.identity }, "unanswered");
      if (missing.length)
        status.textContent = `Not submitted: "${missing[0]}" is empty. Fill it and click the site's Submit.`;
      else if (!cancelled && submit.isConnected) {
        byAgent = true;
        submit.click();
        byAgent = false;
        status.textContent = "Submit clicked. Waiting for the site to confirm…";
        await sleep(12000);
        if (!settled)
          status.textContent =
            "The site has not confirmed the application. Look for a highlighted error or a CAPTCHA on the form, fix it and click the site's Submit.";
      }
    }
  } catch (e) {
    show(
      `${escape(e.message)}<br><button id="job-agent-close" style="margin-top:8px">Close</button>`,
    );
    panel
      .querySelector("#job-agent-close")
      .addEventListener("click", () => banner.remove());
  }
})();
