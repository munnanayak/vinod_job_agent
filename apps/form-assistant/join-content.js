// JOIN navigation is scoped to one approved application in this tab.
(async () => {
  const ask = (message) =>
    new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  const code = /(?:^#|&)job-agent=([a-f0-9]{64})/.exec(location.hash)?.[1];
  let packet = (await ask({ type: "join-load" }))?.data;
  if (!code && !packet) return;
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:white;color:#173e2d;padding:16px;border:2px solid #265942;border-radius:10px;max-width:380px;font:14px/1.5 system-ui";
  const panel = banner.attachShadow({ mode: "open" });
  const show = (text) => {
    panel.textContent = text;
    if (!banner.isConnected) document.body.append(banner);
  };
  const button = (text, action) => {
    const node = document.createElement("button");
    node.textContent = text;
    node.style.cssText = "margin:8px 6px 0 0;padding:8px;cursor:pointer";
    node.addEventListener("click", action);
    panel.append(node);
  };
  let busy = false,
    stopped = false;
  if (packet?.blocked) {
    show(
      "JOIN did not retain the approved job identity in this route. Continue manually or return to the exact approved listing; Job Agent will not select another vacancy.",
    );
    return;
  }
  const finish = async (type, token) => {
    if (busy || stopped) return;
    busy = true;
    const response = await ask({ type, token });
    if (!response?.ok) {
      show(response?.error || "Could not update application status. Retry.");
      busy = false;
      return;
    }
    stopped = true;
    await ask({ type: "join-clear" });
    if (response.data?.next)
      location.href = response.data.next + (packet?.auto ? "&auto=1" : "");
    else
      show(
        response.data?.paused
          ? "10 applications completed. Click Apply next 10 for another batch."
          : "No further approved supported applications are ready.",
      );
  };
  const closed = () =>
    /this job is no longer available|was archived or the deadline has passed/i.test(
      document.body.innerText,
    );
  if (code && closed()) {
    show("This role is closed. Skipping to the next approved job…");
    await finish("closed", code);
    return;
  }
  try {
    if (code) {
      let questions = [];
      try {
        questions = fillApplication({}, "questions");
      } catch {}
      const response = await ask({ type: "claim", token: code, questions });
      if (!response?.ok)
        throw Error(response?.error || "Could not prepare JOIN application.");
      packet = response.data;
      packet.expires = Date.now() + 3 * 3_600_000;
      packet.auto = /(?:^#|&)auto=1(?:&|$)/.test(location.hash);
      const saved = await ask({ type: "join-save", packet, auto: packet.auto });
      if (!saved?.ok)
        throw Error(
          saved?.error || "Could not retain application across steps.",
        );
      history.replaceState(null, "", location.href.split("#")[0]);
    }
    let previous = "",
      lastNavigation = 0,
      autoSubmitAt = 0,
      cancelled = false;
    const inspect = async () => {
      if (busy || stopped) return;
      if (!joinPageMatches(packet.identity, location.href)) {
        show(
          "This page cannot be linked to the approved job. Open the exact job again; other roles need separate approval.",
        );
        return;
      }
      if (closed()) {
        show("This role is closed. Skipping…");
        await finish("skip", packet.reportToken);
        return;
      }
      const text = document.body.innerText;
      if (
        /thank you for applying|application (was |has been )?(successfully )?(submitted|received)/i.test(
          text,
        ) &&
        packet.submitAt &&
        Date.now() - packet.submitAt < 300000
      ) {
        await finish("submitted", packet.reportToken);
        return;
      }
      const login =
        /\/authentication\b/.test(location.pathname) ||
        Boolean(
          document.querySelector(
            'input[type="password"],input[autocomplete="one-time-code"]',
          ),
        );
      if (login) {
        try {
          fillApplication({ ...packet, resume: undefined }, "fill");
        } catch {}
        show(
          "Complete JOIN sign-in, OTP or CAPTCHA yourself. Job Agent will resume filling this approved application after login.",
        );
        button("Skip this job", () => finish("skip", packet.reportToken));
        return;
      }
      const signature =
        location.href +
        [...document.querySelectorAll("input,textarea,select")]
          .map((el) => `${el.name}:${el.type}:${el.getClientRects().length}`)
          .join("|");
      if (signature !== previous) {
        previous = signature;
        busy = true;
        try {
          const questions = fillApplication(packet, "questions");
          const response = await ask({
            type: "draft",
            token: packet.reportToken,
            questions,
          });
          if (response?.ok)
            packet.answers = { ...packet.answers, ...response.data.answers };
        } catch {}
        try {
          fillApplication(packet, "fill");
        } catch {}
        busy = false;
      }
      let missing = [],
        inspected = false;
      try {
        missing = fillApplication(packet, "unanswered");
        inspected = true;
      } catch {}
      const buttons = [
        ...document.querySelectorAll('button,a,input[type="submit"]'),
      ].filter((el) => !el.disabled && el.getClientRects().length);
      const next = buttons.find((el) =>
        ["apply", "next"].includes(
          joinButtonKind(el.textContent || el.value || ""),
        ),
      );
      const submit = buttons.find(
        (el) => joinButtonKind(el.textContent || el.value || "") === "submit",
      );
      const captcha = Boolean(
        document.querySelector(
          'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,[data-sitekey]',
        ),
      );
      show(
        missing.length
          ? `Needs your answers: ${missing.join(", ")}. Fill these to continue.`
          : submit &&
              inspected &&
              packet.auto &&
              !cancelled &&
              !captcha &&
              !packet.submitAt
            ? `Automatic submission in ${autoSubmitAt ? Math.max(0, Math.ceil((autoSubmitAt - Date.now()) / 1000)) : 10} seconds. Cancel below to review manually.`
            : "Your saved details are filled where recognized. Review each step. Login and CAPTCHA need your input.",
      );
      button("Fill again", () => {
        previous = "";
      });
      button("Skip this job", () => finish("skip", packet.reportToken));
      if (submit)
        button("I submitted it", () => finish("submitted", packet.reportToken));
      // Move through non-final form steps only. Never select another vacancy.
      if (next && !missing.length && Date.now() - lastNavigation > 5000) {
        const href = next.getAttribute("href");
        if (
          !href ||
          joinPageMatches(packet.identity, new URL(href, location.href).href)
        ) {
          lastNavigation = Date.now();
          next.click();
        }
      }
      if (submit)
        button("Submit application", async () => {
          if (missing.length || !inspected) return;
          packet.submitAt = Date.now();
          await ask({ type: "join-save", packet, auto: packet.auto });
          submit.click();
        });
      if (
        submit &&
        inspected &&
        packet.auto &&
        !cancelled &&
        !packet.submitAt &&
        !missing.length &&
        !captcha
      ) {
        if (!autoSubmitAt) autoSubmitAt = Date.now() + 10000;
        button("Cancel automatic submission", () => {
          cancelled = true;
        });
        if (Date.now() >= autoSubmitAt) {
          packet.submitAt = Date.now();
          await ask({ type: "join-save", packet, auto: packet.auto });
          submit.click();
        }
      } else autoSubmitAt = 0;
    };
    // Capture manual submissions so only a recent submission can confirm success.
    document.addEventListener(
      "click",
      async (event) => {
        const el =
          event.target instanceof Element &&
          event.target.closest('button,input[type="submit"]');
        if (
          el &&
          joinButtonKind(el.textContent || el.value || "") === "submit"
        ) {
          packet.submitAt = Date.now();
          await ask({ type: "join-save", packet, auto: packet.auto });
        }
      },
      true,
    );
    await inspect();
    const timer = setInterval(() => {
      if (stopped || Date.now() > (packet.expires || Date.now() + 1))
        clearInterval(timer);
      else void inspect();
    }, 1500);
  } catch (error) {
    show(error.message || "Could not fill this JOIN form.");
  }
})();
