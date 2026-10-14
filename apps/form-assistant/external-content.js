// One prepared employer tab, bounded observations and verified non-final actions.
(async () => {
  if (globalThis.jobAgentExternalRunning) return;
  globalThis.jobAgentExternalRunning = true;
  const ask = (message) =>
    new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  const code = /(?:^#|&)job-agent=([a-f0-9]{64})/.exec(location.hash)?.[1];
  let packet = (await ask({ type: "external-load" }))?.data;
  if (!code && !packet) {
    globalThis.jobAgentExternalRunning = false;
    return;
  }
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:16px;background:white;color:#173e2d;border:2px solid #265942;max-width:380px;font:14px/1.5 system-ui";
  const panel = banner.attachShadow({ mode: "open" });
  document.body.append(banner);
  const show = (text) => {
    panel.textContent = text;
  };
  const visible = (el) =>
    el.getClientRects().length &&
    !el.disabled &&
    el.getAttribute("aria-disabled") !== "true";
  let busy = false,
    previous = "",
    stopped = false,
    submitAt = 0;
  const expiry = Date.now() + 10800000,
    attempts = new Map();
  const canonical = () => location.href.split("#")[0];
  try {
    if (code) {
      const result = await ask({ type: "claim", token: code, questions: [] });
      if (!result?.ok)
        throw Error(result?.error || "Prepare this application again.");
      packet = { ...result.data, pages: [], expires: expiry };
      if (!packet.identity?.startsWith("external:"))
        throw Error("Use the supported site adapter for this application.");
      const saved = await ask({ type: "external-save", packet });
      if (!saved?.ok)
        throw Error(
          saved?.error || "Could not retain this application session.",
        );
      history.replaceState(null, "", canonical());
    }
    const finish = async (type) => {
      const response = await ask({ type, token: packet.reportToken });
      if (!response?.ok)
        return show(response?.error || "Could not record the application.");
      stopped = true;
      await ask({ type: "external-clear" });
      if (response.data?.next) location.href = response.data.next;
      else
        show(
          response.data?.paused
            ? "10 applications completed."
            : "No more ready applications in this batch.",
        );
    };
    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        if (
          `external:${encodeURIComponent(canonical())}` !== packet.identity &&
          !packet.pages.includes(canonical())
        ) {
          stopped = true;
          return show(
            "This route was not verified as the next application step. Continue manually.",
          );
        }
        const login = [
          ...document.querySelectorAll(
            'input[type="password"],input[autocomplete="one-time-code"],iframe[src*="captcha"],[data-sitekey]',
          ),
        ].some(visible);
        if (login)
          return show(
            "Complete login, OTP or CAPTCHA manually. The agent will resume afterward.",
          );
        if (
          submitAt &&
          Date.now() - submitAt < 300000 &&
          /application (was |has been )?(successfully )?(submitted|received)|thank you for applying/i.test(
            document.body.innerText,
          )
        ) {
          await finish("submitted");
          return;
        }
        // A unique application form prevents filling newsletter, search or login fields.
        const forms = [
          ...document.querySelectorAll('form,main,[role="main"]'),
        ].filter(
          (el) =>
            el.querySelector('input:not([type="hidden"]),textarea,select') &&
            visible(el),
        );
        const roots = forms.filter(
          (el) => !forms.some((other) => other !== el && el.contains(other)),
        );
        let root = roots.length === 1 ? roots[0] : null;
        if (!root && !roots.length) {
          const norm = (text) =>
            text
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .trim();
          const title = norm(packet.jobTitle || "");
          const matchingTitle =
            title &&
            [...document.querySelectorAll("h1,h2")].some((el) =>
              norm(el.textContent).includes(title),
            );
          const inputs = [
            ...document.querySelectorAll(
              'input:not([type="hidden"]),textarea,select',
            ),
          ].filter(visible);
          if (
            matchingTitle &&
            (inputs.length === 0 ||
              (inputs.length === 1 && inputs[0].type === "email"))
          )
            root = document.body;
        }
        if (!root)
          return show(
            "No unique application form found. Open the form or continue this step manually.",
          );
        document
          .querySelectorAll("[data-job-agent-form]")
          .forEach((el) => el.removeAttribute("data-job-agent-form"));
        root.setAttribute("data-job-agent-form", "");
        const questions = fillApplication(packet, "questions");
        const signature =
          canonical() +
          JSON.stringify(questions) +
          [...root.querySelectorAll("button,a")]
            .filter(visible)
            .map((el) => el.textContent.trim())
            .join("|");
        if (signature !== previous) {
          const result = await ask({
            type: "draft",
            token: packet.reportToken,
            questions,
          });
          if (!result?.ok)
            return show(result?.error || "Approval check failed.");
          packet.answers = { ...packet.answers, ...result.data.answers };
          packet.remembered = [
            ...new Set([
              ...(packet.remembered || []),
              ...(result.data.remembered || []),
            ]),
          ];
          if (root.querySelector("input,textarea,select"))
            fillApplication(packet);
          previous = signature;
          return;
        }
        const missing = fillApplication(packet, "unanswered");
        for (const el of root.querySelectorAll("input,textarea,select")) {
          const label = [...(el.labels || [])]
            .map((x) => x.textContent)
            .join(" ");
          if (
            visible(el) &&
            /\*/.test(label) &&
            !el.value &&
            !["file", "hidden", "radio", "checkbox"].includes(el.type)
          )
            missing.push(label);
        }
        const invalid = [
          ...root.querySelectorAll("input,textarea,select"),
        ].some(
          (el) =>
            visible(el) &&
            (el.getAttribute("aria-invalid") === "true" ||
              (el.validity && !el.validity.valid)),
        );
        show(
          missing.length || invalid
            ? `Needs your input: ${missing.join(", ") || "check validation errors"}`
            : "Details filled where recognized. Checking the next application step. Final submission needs your review.",
        );
        const skip = document.createElement("button");
        skip.textContent = "Skip this job";
        skip.addEventListener("click", () => void finish("skip"));
        panel.append(skip);
        if (missing.length || invalid) return;
        const nodes = [
          ...root.querySelectorAll('button,a,input[type="submit"]'),
        ]
          .filter(visible)
          .slice(0, 40);
        for (const el of nodes)
          if (
            /^(submit( application)?|send application|apply now)$/i.test(
              (el.textContent || el.value || "").trim(),
            )
          ) {
            el.addEventListener(
              "click",
              () => {
                submitAt = Date.now();
              },
              { once: true },
            );
          }
        if ((attempts.get(signature) || 0) >= 3) return;
        const buttons = nodes.map((el, id) => ({
          id,
          label: (el.textContent || el.value || "").trim().slice(0, 200),
          href: el.getAttribute("href")
            ? new URL(el.getAttribute("href"), location.href).href
            : "",
          withinForm: true,
        }));
        const result = await ask({
          type: "plan",
          token: packet.reportToken,
          observation: {
            pageUrl: canonical(),
            heading: (document.querySelector("h1,h2")?.textContent || "").slice(
              0,
              1000,
            ),
            login: false,
            captcha: false,
            missing: [],
            buttons,
          },
        });
        attempts.set(signature, (attempts.get(signature) || 0) + 1);
        const candidate = buttons.find((b) => b.id === result?.data?.buttonId),
          el = nodes[result?.data?.buttonId];
        if (
          result?.ok &&
          result.data.action === "click" &&
          candidate &&
          el?.isConnected &&
          visible(el) &&
          (el.textContent || el.value || "").trim().slice(0, 200) ===
            candidate.label &&
          (!candidate.href ||
            new URL(candidate.href).origin === location.origin) &&
          !/submit|send|apply now/i.test(candidate.label)
        ) {
          packet.pages = result.data.pages || packet.pages;
          const saved = await ask({ type: "external-save", packet });
          if (saved?.ok && !fillApplication(packet, "unanswered").length) {
            if (candidate.href) location.href = candidate.href;
            else el.click();
          }
        }
      } catch (error) {
        show(error.message || "Continue this step manually.");
      } finally {
        busy = false;
      }
    };
    await tick();
    const timer = setInterval(() => {
      if (stopped || Date.now() > expiry) clearInterval(timer);
      else void tick();
    }, 2500);
  } catch (error) {
    show(error.message);
  }
})();
