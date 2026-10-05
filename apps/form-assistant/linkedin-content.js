// Existing LinkedIn login stays in the user's browser. Only the dashboard's
// one-use code can arm an external Apply handoff; Easy Apply stays manual.
(async () => {
  const code = /(?:^#|&)job-agent=([a-f0-9]{64})/.exec(location.hash)?.[1];
  if (!code) return;
  const auto = /(?:^#|&)auto=1(?:&|$)/.test(location.hash);
  const ask = (message) =>
    new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:white;color:#173e2d;padding:16px;border:2px solid #265942;max-width:380px;font:14px/1.5 system-ui";
  const panel = banner.attachShadow({ mode: "open" });
  const show = (text) => {
    panel.textContent = text;
    if (!banner.isConnected) document.body.append(banner);
  };
  const skip = () => {
    const button = document.createElement("button");
    button.textContent = "Skip to next approved job";
    button.addEventListener("click", async () => {
      const response = await ask({ type: "closed", token: code });
      if (!response?.ok) {
        show(response?.error || "Prepare this job again.");
        return;
      }
      if (response.data?.next)
        location.href = response.data.next + (auto ? "&auto=1" : "");
      else show("No further approved supported jobs are ready.");
    });
    panel.append(button);
  };
  show(
    "Looking for this job’s external Apply link. Complete LinkedIn login manually if requested.",
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      /no longer accepting applications|job is no longer available/i.test(
        document.body.innerText,
      )
    ) {
      const response = await ask({ type: "closed", token: code });
      if (response?.ok && response.data?.next)
        location.href = response.data.next + (auto ? "&auto=1" : "");
      else {
        show("This job is closed.");
        skip();
      }
      return;
    }
    const buttons = [
      ...document.querySelectorAll(
        '.jobs-apply-button,[data-control-name="jobdetails_topcard_inapply"]',
      ),
    ].filter((el) => !el.disabled && el.getClientRects().length);
    if (buttons.length === 1) {
      const button = buttons[0],
        label = (
          button.innerText ||
          button.getAttribute("aria-label") ||
          ""
        ).trim();
      if (/easy apply/i.test(label)) {
        show(
          "LinkedIn Easy Apply is not supported yet. Apply manually or skip this job.",
        );
        skip();
        return;
      }
      if (!/^apply\b/i.test(label)) {
        show(
          "This button is not an identifiable Apply action. Continue manually.",
        );
        skip();
        return;
      }
      const href = button.getAttribute("href");
      if (
        href &&
        !["www.linkedin.com", "linkedin.com"].includes(
          new URL(href, location.href).hostname,
        )
      ) {
        const response = await ask({
          type: "resolve",
          token: code,
          applicationUrl: new URL(href, location.href).href,
        });
        const url = response?.data?.openUrl || response?.data?.next;
        if (response?.ok && url) location.href = url + (auto ? "&auto=1" : "");
        else {
          show(
            response?.error || "The external role is closed or unavailable.",
          );
          skip();
        }
        return;
      }
      const response = await ask({ type: "linkedin-arm", token: code, auto });
      if (!response?.ok) {
        show(response?.error || "Could not follow Apply.");
        skip();
        return;
      }
      show(
        "Following this job’s Apply button. Supported forms will continue automatically; other sites need manual completion.",
      );
      button.click();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  show(
    "No unique Apply button was found. Sign in and prepare the job again, or skip it.",
  );
  skip();
})();
