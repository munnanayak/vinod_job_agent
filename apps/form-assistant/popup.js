// fillApplication comes from fill.js, loaded before this script.
const button = document.getElementById("fill");
const result = document.getElementById("result");
const details = document.getElementById("details");
button.addEventListener("click", async () => {
  button.disabled = true;
  result.textContent = "";
  details.replaceChildren();
  try {
    const code = document.getElementById("code").value.trim();
    if (!/^[a-f0-9]{64}$/.test(code))
      throw new Error(
        "Paste the preparation code from the Job Agent dashboard.",
      );
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || !tab.url)
      throw new Error("Open the application page first.");
    // Inspect before consuming the code, so an unopened form can be corrected.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillApplication,
      args: [{}, "inspect"],
    });
    const response = await fetch(
      "https://vinod-job-agent.onrender.com/api/workflow/forms/claim",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Job-Agent-Form-Token": code,
        },
        body: JSON.stringify({ pageUrl: tab.url }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const packet = await response.json();
    if (!response.ok)
      throw new Error(packet.message || "Could not load this preparation.");
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillApplication,
      args: [packet, "fill"],
    });
    const report = execution.result;
    if (!report) throw new Error("The page changed. Prepare it again.");
    document.getElementById("code").value = "";
    result.textContent = `${report.filled.length} fields/attachments prepared. Nothing submitted. Review the form and submit yourself.`;
    for (const text of [
      ...report.filled.map((x) => `Filled: ${x}`),
      ...report.skipped,
      ...report.unanswered.map((x) => `Needs your answer: ${x}`),
    ]) {
      const li = document.createElement("li");
      li.textContent = text;
      details.append(li);
    }
  } catch (e) {
    result.textContent = e.message || "Unable to prepare this form.";
  } finally {
    button.disabled = false;
  }
});
