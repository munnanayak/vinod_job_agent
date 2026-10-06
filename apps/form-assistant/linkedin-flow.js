// Find the job's action, including newer LinkedIn top-card markup.
function linkedinApplyButtons(root) {
  const candidates = [
    ...root.querySelectorAll(
      '.jobs-apply-button,[data-control-name="jobdetails_topcard_inapply"],.job-details-jobs-unified-top-card button,.job-details-jobs-unified-top-card a,button[aria-label*="Apply"],a[aria-label*="Apply"]',
    ),
  ].filter(
    (el) =>
      !el.disabled &&
      el.getAttribute("aria-disabled") !== "true" &&
      el.getClientRects().length &&
      /^(easy apply|apply)(?:\s|$)/i.test(
        (el.innerText || el.getAttribute("aria-label") || "").trim(),
      ),
  );
  // Nested wrappers and duplicate sticky top cards may represent the same action.
  const nodes = candidates.filter(
    (el) => !candidates.some((other) => other !== el && el.contains(other)),
  );
  if (nodes.length > 1) {
    const keys = new Set(
      nodes.map(
        (el) =>
          `${/easy apply/i.test(el.innerText || el.getAttribute("aria-label") || "")}:${el.getAttribute("href") || ""}`,
      ),
    );
    if (keys.size === 1) return [nodes[0]];
  }
  return nodes;
}

// The approved LinkedIn job URL must remain unchanged throughout Easy Apply.
function linkedinJobIdentity(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ["linkedin.com", "www.linkedin.com"].includes(u.hostname) &&
      /^\/jobs\/view\/\d+\/?$/.test(u.pathname)
      ? `linkedin:jobs:${u.pathname.split("/")[3]}`
      : null;
  } catch {
    return null;
  }
}
function linkedinStepAction(label) {
  const text = label.trim().replace(/\s+/g, " ").toLowerCase();
  if (["next", "continue", "review", "review application"].includes(text))
    return "next";
  if (text === "submit application") return "submit";
  return null;
}
async function linkedinEasyApply({ code, auto, button, ask, show, panel }) {
  const identity = linkedinJobIdentity(location.href);
  if (!identity) return show("Open the exact approved LinkedIn job URL.");
  button.click();
  let packet,
    previous = "",
    busy = false,
    stopped = false;
  let submitAt = 0,
    countdown = 0,
    cancelled = false,
    lastClick = 0;
  const counts = new Map();
  const trackedSubmits = new WeakSet();
  const visible = (el) => el.getClientRects().length && !el.disabled;
  const add = (label, action) => {
    const el = document.createElement("button");
    el.textContent = label;
    el.addEventListener("click", action);
    panel.append(el);
  };
  const finish = async (type) => {
    const result = await ask({ type, token: packet.reportToken });
    if (!result?.ok) {
      show(result?.error || "Could not record application status.");
      return;
    }
    stopped = true;
    if (result.data?.next)
      location.href = result.data.next + (auto ? "&auto=1" : "");
    else
      show(
        result.data?.paused
          ? "10 applications completed. Start another batch from the dashboard."
          : "This batch has no further ready applications.",
      );
  };
  const tick = async () => {
    if (busy || stopped) return;
    if (linkedinJobIdentity(location.href) !== identity) {
      stopped = true;
      return show("Job changed. Open the approved job again to continue.");
    }
    busy = true;
    try {
      const modal = document.querySelector(
        '.jobs-easy-apply-modal[role="dialog"], [role="dialog"] .jobs-easy-apply-content',
      );
      const confirmation = document.querySelector(
        '.artdeco-modal[role="dialog"], [role="dialog"]',
      );
      if (
        packet &&
        submitAt &&
        Date.now() - submitAt < 300000 &&
        confirmation &&
        /your application was sent|application (was |has been )?(successfully )?(sent|submitted)/i.test(
          confirmation.innerText,
        )
      ) {
        await finish("submitted");
        return;
      }
      if (!modal) {
        show(
          "Open this job’s Easy Apply form. Sign-in and CAPTCHA need your input.",
        );
        return;
      }
      if (
        submitAt &&
        Date.now() - submitAt < 300000 &&
        /application (was |has been )?(successfully )?(sent|submitted)|your application was sent/i.test(
          modal.innerText,
        )
      ) {
        await finish("submitted");
        return;
      }
      if (!packet) {
        const questions = fillApplication({ identity }, "questions");
        const result = await ask({ type: "claim", token: code, questions });
        if (!result?.ok) {
          stopped = true;
          show(result?.error || "Prepare this job again.");
          return;
        }
        packet = result.data;
        if (packet.identity !== identity)
          throw Error("Application identity changed.");
        history.replaceState(null, "", location.href.split("#")[0]);
      }
      const controls = [
        ...modal.querySelectorAll("input,textarea,select"),
      ].filter(visible);
      const buttons = [...modal.querySelectorAll("button")].filter(visible);
      const signature =
        controls
          .map(
            (el) =>
              `${el.id}:${el.name}:${el.type}:${[...(el.labels || [])].map((x) => x.textContent).join(" ")}`,
          )
          .join("|") + buttons.map((el) => el.textContent.trim()).join("|");
      if (signature !== previous) {
        const questions = fillApplication(packet, "questions");
        const result = await ask({
          type: "draft",
          token: packet.reportToken,
          questions,
        });
        if (!result?.ok) {
          show(result?.error || "Could not check approval and answers.");
          return;
        }
        packet.answers = { ...packet.answers, ...result.data.answers };
        packet.remembered = [
          ...new Set([
            ...(packet.remembered || []),
            ...(result.data.remembered || []),
          ]),
        ];
        if (controls.length) fillApplication(packet);
        previous = signature;
        countdown = 0;
        return; // Allow upload, input validation and page state to settle.
      }
      const missing = fillApplication(packet, "unanswered");
      // LinkedIn sometimes marks requirements only in a label, not the DOM required attribute.
      for (const el of controls) {
        const label = [...(el.labels || [])]
          .map((x) => x.textContent)
          .join(" ");
        if (
          /\*/.test(label) &&
          !el.value &&
          !["file", "hidden", "radio", "checkbox"].includes(el.type)
        )
          missing.push(label);
      }
      const invalid =
        controls.some(
          (el) =>
            el.getAttribute("aria-invalid") === "true" ||
            (el.validity && !el.validity.valid),
        ) ||
        [
          ...modal.querySelectorAll(
            '.artdeco-inline-feedback--error,[role="alert"]',
          ),
        ].some((el) => visible(el) && el.textContent.trim());
      const captcha = [
        ...document.querySelectorAll(
          'iframe[src*="captcha"],.g-recaptcha,[data-sitekey],input[type="password"],input[autocomplete="one-time-code"]',
        ),
      ].some(visible);
      const next = buttons.filter(
        (el) => linkedinStepAction(el.textContent) === "next",
      );
      const submits = buttons.filter(
        (el) => linkedinStepAction(el.textContent) === "submit",
      );
      const blocked = missing.length || invalid || captcha;
      show(
        blocked
          ? `Needs your input${missing.length ? ": " + [...new Set(missing)].join(", ") : ": check validation, login or CAPTCHA"}.`
          : submits.length
            ? auto && !cancelled && !submitAt
              ? "Ready to submit. Automatic submission has a 10-second review window."
              : "Review the application and submit on LinkedIn."
            : "Filling and navigating this approved application.",
      );
      add("Fill again", () => {
        previous = "";
      });
      add("Skip this job", () => {
        if (!busy) {
          busy = true;
          void finish("skip").finally(() => {
            busy = false;
          });
        }
      });
      if (blocked) {
        countdown = 0;
        return;
      }
      if (
        next.length === 1 &&
        !submits.length &&
        Date.now() - lastClick > 4000 &&
        (counts.get(signature) || 0) < 3
      ) {
        lastClick = Date.now();
        counts.set(signature, (counts.get(signature) || 0) + 1);
        next[0].click();
        return;
      }
      if (submits.length === 1) {
        // Manual submissions are tracked, but only a real confirmation records success.
        if (!trackedSubmits.has(submits[0])) {
          trackedSubmits.add(submits[0]);
          submits[0].addEventListener(
            "click",
            () => {
              submitAt = Date.now();
            },
            { once: true },
          );
        }
        if (auto && !cancelled && !submitAt) {
          add("Cancel automatic submission", () => {
            cancelled = true;
            countdown = 0;
          });
          if (!countdown) countdown = Date.now() + 10000;
          if (Date.now() >= countdown) {
            const checked = await ask({
              type: "draft",
              token: packet.reportToken,
              questions: [],
            });
            if (!checked?.ok) {
              cancelled = true;
              show(checked?.error || "Approval check failed.");
              return;
            }
            if (
              linkedinJobIdentity(location.href) !== identity ||
              !submits[0].isConnected ||
              submits[0].disabled ||
              document.querySelector(
                '.jobs-easy-apply-modal[role="dialog"], [role="dialog"] .jobs-easy-apply-content',
              ) !== modal ||
              [...modal.querySelectorAll("input,textarea,select")].some(
                (el) =>
                  el.getAttribute("aria-invalid") === "true" ||
                  (el.validity && !el.validity.valid),
              ) ||
              fillApplication(packet, "unanswered").length
            )
              return;
            submitAt = Date.now();
            submits[0].click();
          }
        }
      } else countdown = 0;
    } catch (error) {
      show(error.message || "Continue this step manually.");
    } finally {
      busy = false;
    }
  };
  await tick();
  const expires = Date.now() + 3 * 3600000;
  const timer = setInterval(() => {
    if (stopped || Date.now() >= expires) clearInterval(timer);
    else void tick();
  }, 1500);
}
