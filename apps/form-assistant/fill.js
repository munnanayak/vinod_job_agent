// Classic script (no modules): loaded into application pages and the popup.
// Chrome may also serialize fillApplication into a tab, so it must stay self-contained.

/* eslint-disable no-unused-vars */
function fillApplication(packet, mode = "fill") {
  function identity(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== "https:" || u.username || u.password || u.port)
        return null;
      const p = u.pathname.split("/").filter(Boolean);
      if (
        ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(
          u.hostname,
        ) &&
        u.pathname === "/embed/job_app"
      ) {
        const board = u.searchParams.get("for") ?? "",
          token = u.searchParams.get("token") ?? "";
        return /^[a-z0-9_-]+$/i.test(board) && /^\d+$/.test(token)
          ? `greenhouse:${board.toLowerCase()}:${token}`
          : null;
      }
      if (
        ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(
          u.hostname,
        ) &&
        p.length === 3 &&
        p[1] === "jobs" &&
        /^[a-z0-9_-]+$/i.test(p[0]) &&
        /^\d+$/.test(p[2])
      )
        return `greenhouse:${p[0].toLowerCase()}:${p[2]}`;
      if (
        ["jobs.lever.co", "jobs.eu.lever.co", "jobs.ashbyhq.com"].includes(
          u.hostname,
        ) &&
        p.length >= 2 &&
        p.length <= 3 &&
        /^[a-z0-9._-]+$/i.test(p[0]) &&
        /^[a-z0-9-]{8,}$/i.test(p[1]) &&
        (!p[2] || ["apply", "application"].includes(p[2]))
      )
        return `${u.hostname}:${p[0].toLowerCase()}:${p[1]}`;
    } catch {}
    return null;
  }
  const current = identity(location.href);
  if (!current || (packet.identity && packet.identity !== current))
    throw new Error(
      "Wrong or unsupported application page. Open the exact dashboard link.",
    );

  // The question text for a field: its own label, else the nearest label-like
  // element in an ancestor that doesn't also contain the field.
  const question = (el) => {
    const grouped = el.type === "radio" || el.type === "checkbox";
    // For a radio button or checkbox, the labels of the options are not the question.
    const optionLabel = (x) =>
      grouped &&
      x.tagName === "LABEL" &&
      ["radio", "checkbox"].includes(x.control?.type);
    let node = el.parentElement;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const candidate = [
        ...node.querySelectorAll(
          "label,legend,[class*='label'],[class*='title'],[class*='question-text'],.text",
        ),
      ].find(
        (x) =>
          !x.contains(el) &&
          !optionLabel(x) &&
          x.textContent.trim() &&
          !x.querySelector("input,textarea,select"),
      );
      if (candidate) return candidate.textContent;
    }
    return "";
  };
  const label = (el) => {
    // Radio/checkbox labels are option texts ("Yes"); use the group's question.
    const grouped = el.type === "radio" || el.type === "checkbox";
    const explicit = grouped
      ? ""
      : [...(el.labels ?? [])].map((x) => x.textContent).join(" ");
    const aria = el.getAttribute("aria-label") ?? "";
    const byId = (el.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    return (
      explicit ||
      aria ||
      byId ||
      question(el) ||
      el.name ||
      el.id ||
      el.placeholder ||
      ""
    )
      .replace(/[*✱]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
  };
  const norm = (text) =>
    text
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\(.*?\)/g, "")
      .trim();
  const visible = (el) => {
    const style = getComputedStyle(el);
    return (
      !el.closest('[hidden],[inert],[aria-hidden="true"]') &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      el.getClientRects().length > 0
    );
  };
  const fileVisible = (el) =>
    visible(el) ||
    [...(el.labels ?? [])].some(visible) ||
    visible(el.parentElement ?? el);
  const available = [...document.querySelectorAll("input,textarea")].filter(
    (el) =>
      !el.disabled &&
      !el.readOnly &&
      // Sites often hide the real file, radio and checkbox inputs behind a styled label.
      (["file", "radio", "checkbox"].includes(el.type)
        ? fileVisible(el)
        : visible(el)),
  );
  if (!available.length)
    throw new Error(
      "No accessible form fields found yet. Open the site's application form first; embedded forms need manual entry.",
    );
  const textLike = (el) =>
    [
      "text",
      "email",
      "tel",
      "url",
      "textarea",
      "search",
      "date",
      "number",
      "",
    ].includes(el.type) || el.tagName === "TEXTAREA";

  const selects = [...document.querySelectorAll("select")].filter(
    (el) => !el.disabled && visible(el),
  );
  const isChoice = (el) => el.type === "radio" || el.type === "checkbox";
  // Yes/No questions built from plain buttons instead of inputs (Ashby).
  const pressed = (b) =>
    b.getAttribute("aria-pressed") === "true" ||
    b.getAttribute("aria-checked") === "true" ||
    /(^|[\s_-])(active|selected|checked)([\s_-]|$)/i.test(b.className);
  const toggles = (() => {
    const groups = new Map();
    for (const b of document.querySelectorAll("button")) {
      const text = b.textContent.trim();
      if (b.disabled || !visible(b) || !text || text.length > 30) continue;
      groups.set(b.parentElement, [...(groups.get(b.parentElement) ?? []), b]);
    }
    const has = (list, word) =>
      list.some((b) => b.textContent.trim().toLowerCase() === word);
    return [...groups.values()]
      .filter((list) => list.length <= 4 && has(list, "yes") && has(list, "no"))
      .map((buttons) => ({
        buttons,
        raw: question(buttons[0])
          .replace(/[*✱]+/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300),
      }))
      .filter((t) => t.raw);
  })();
  // Turns an answer such as "2026-11-01", "30 days" or "immediately" into a date.
  const toDate = (text) => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
    if (/immediate|right away|asap/i.test(text)) return new Date();
    const span = /(\d+)\s*(day|week|month)/i.exec(text);
    if (span) {
      const days = { day: 1, week: 7, month: 30 }[span[2].toLowerCase()];
      return new Date(Date.now() + +span[1] * days * 86_400_000);
    }
    const time = Date.parse(text);
    return Number.isNaN(time) ? null : new Date(time);
  };
  // Date boxes: a real date input, or a text box whose hint is a date pattern.
  const datePattern = (el) =>
    el.type === "date"
      ? "yyyy-mm-dd"
      : (/^(mm|dd|yyyy)([/.\- ])(mm|dd)\2(yyyy|dd)$/i.exec(
          (el.placeholder ?? "").trim(),
        )?.[0] ?? "");
  const formatDate = (date, pattern) =>
    pattern
      .toLowerCase()
      .replace("yyyy", String(date.getFullYear()))
      .replace("mm", String(date.getMonth() + 1).padStart(2, "0"))
      .replace("dd", String(date.getDate()).padStart(2, "0"));
  // The text beside one radio button or checkbox.
  const optionText = (el) =>
    (
      [...(el.labels ?? [])].map((x) => x.textContent).join(" ") ||
      el.value ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // What a searchable dropdown shows as selected ("" when nothing is). Its
  // typing box stays empty after an option is picked.
  const chosenText = (el) => {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const picked = [
        ...node.querySelectorAll(
          "[class*='single-value'],[class*='multi-value__label']",
        ),
      ];
      if (picked.length)
        return picked.map((x) => x.textContent.trim()).join(" | ");
      // Stop before reaching an ancestor that also holds other questions.
      if (
        node.querySelectorAll("input:not([type='hidden']),select,textarea")
          .length > 1
      )
        break;
    }
    return "";
  };
  const chosen = (el) => Boolean(chosenText(el));
  // Personal and demographic questions: only ever filled with your own earlier answer.
  const demographic = (el, raw) =>
    /gender|race|ethnic|hispanic|latino|veteran|disabilit|orientation|pronoun|transgender|lgbt/i.test(
      raw,
    ) ||
    Boolean(
      el.closest(
        "[class*='eeoc'],[id*='eeoc'],[class*='demographic'],[id*='demographic']",
      ),
    );
  // Required questions that still have no answer.
  const unanswered = () =>
    [...document.querySelectorAll("input,textarea,select")]
      .filter(
        (el) =>
          visible(el) &&
          !el.disabled &&
          (el.required || el.getAttribute("aria-required") === "true") &&
          (el.type === "radio" && el.name
            ? !document.querySelector(
                `input[type="radio"][name="${CSS.escape(el.name)}"]:checked`,
              )
            : el.type === "checkbox" && el.name
              ? // A "select all that apply" group is answered once any box is ticked.
                !document.querySelector(
                  `input[type="checkbox"][name="${CSS.escape(el.name)}"]:checked`,
                )
              : el.type === "checkbox" || el.type === "radio"
                ? !el.checked
                : el.type === "file"
                  ? !el.files?.length
                  : el.getAttribute("role") === "combobox"
                    ? !chosen(el)
                    : !el.value),
      )
      .map(label)
      .filter((text, i, all) => text && all.indexOf(text) === i);
  if (mode === "unanswered") return unanswered();
  // Dropdowns that are still empty. Plain ones are returned with their options;
  // searchable ones are marked so content.js can open them and read the options.
  if (mode === "dropdowns") {
    for (const el of available) {
      const raw = label(el);
      if (el.getAttribute("role") === "combobox" && raw && !chosen(el))
        el.dataset.jobAgentOpen = raw;
    }
    // Radio and checkbox groups with nothing ticked yet.
    const groups = new Map();
    for (const el of available.filter(isChoice)) {
      const raw = label(el);
      const option = optionText(el);
      if (!raw || !option) continue;
      const group = groups.get(raw) ?? { options: [], ticked: false };
      group.options.push(option);
      group.ticked ||= el.checked;
      groups.set(raw, group);
    }
    return [
      ...selects
        .filter((el) => !el.value)
        .map((el) => ({
          question: label(el),
          options: [...el.options]
            .map((o) => o.textContent.trim())
            .filter(Boolean),
        })),
      ...[...groups]
        .filter(([, group]) => !group.ticked)
        .map(([question, group]) => ({ question, options: group.options })),
      ...toggles
        .filter((t) => !t.buttons.some(pressed))
        .map((t) => ({
          question: t.raw,
          options: t.buttons.map((b) => b.textContent.trim()),
        })),
    ].filter((x) => x.question && x.options.length && x.options.length <= 200);
  }

  // Every question on the form, sent to the API for profile, saved or drafted answers.
  if (mode === "questions")
    return [
      ...new Set(
        [...available.filter((el) => textLike(el) || isChoice(el)), ...selects]
          .map(label)
          .concat(toggles.map((t) => t.raw))
          .filter(Boolean),
      ),
    ].slice(0, 80);
  // The answers currently on the form, so they can be reused on later forms.
  if (mode === "snapshot") {
    const entries = new Map();
    for (const el of available) {
      if (el.type === "file" || el.type === "password") continue;
      const question = label(el);
      if (isChoice(el)) {
        if (el.checked)
          entries.set(
            question,
            entries.has(question)
              ? `${entries.get(question)} | ${optionText(el)}`
              : optionText(el),
          );
      } else if (textLike(el)) {
        const answer =
          el.getAttribute("role") === "combobox"
            ? chosenText(el)
            : el.value.trim();
        if (answer) entries.set(question, answer);
      }
    }
    for (const el of selects) {
      const answer = el.selectedOptions[0]?.textContent.trim();
      if (el.value && answer) entries.set(label(el), answer);
    }
    for (const t of toggles) {
      const on = t.buttons.find(pressed);
      if (on) entries.set(t.raw, on.textContent.trim());
    }
    return [...entries]
      .filter(([question, answer]) => question && answer.length <= 500)
      .map(([question, answer]) => ({ question, answer }))
      .slice(0, 80);
  }
  if (mode === "inspect")
    return { identity: current, fields: available.length };

  const result = { filled: [], skipped: [], unanswered: [], attached: false };
  const fields = packet.fields ?? {};
  const answers = packet.answers ?? {};
  // Questions you answered yourself on an earlier form.
  const remembered = new Set(packet.remembered ?? []);
  const guarded = (el, raw) => !remembered.has(raw) && demographic(el, raw);
  const mark = (el) => {
    el.style.outline = "2px solid #e0a400";
    el.style.outlineOffset = "1px";
  };
  const source = (raw) =>
    remembered.has(raw)
      ? `${raw} (your earlier answer)`
      : `${raw} (drafted — check it)`;
  const setValue = (el, value) => {
    const prototype =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    // Enter the text the way typing does, with focus before and blur after:
    // many forms only record a field when they see those events.
    el.focus();
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    let typed = false;
    try {
      el.select();
      typed =
        document.execCommand("insertText", false, value) && el.value === value;
    } catch {}
    if (!typed) {
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, value);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: value,
        }),
      );
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    // Mark what the agent filled so you can review it at a glance.
    mark(el);
  };
  for (const el of available) {
    const raw = label(el);
    const name = norm(raw);
    if (el.type === "file") {
      if (packet.noResume) continue;
      // Greenhouse labels its upload button "Attach"; the field id says resume.
      const about = `${name} ${el.id} ${el.name}`.toLowerCase();
      const context = (el.closest("div")?.textContent ?? "").toLowerCase();
      if (
        result.attached ||
        !/(resume|\bcv\b)/.test(about) ||
        /cover/.test(about) ||
        /autofill/.test(context.slice(0, 200))
      )
        continue;
      if (el.files?.length) {
        result.skipped.push("Existing resume attachment preserved");
        continue;
      }
      const accept = (el.accept || "").toLowerCase();
      if (
        accept &&
        !accept
          .split(",")
          .some((x) =>
            [".pdf", "application/pdf", "application/*", "*/*"].includes(
              x.trim(),
            ),
          )
      ) {
        result.skipped.push(
          "Resume field does not accept PDF; upload manually",
        );
        continue;
      }
      const r = packet.resume;
      if (
        !r ||
        r.mimeType !== "application/pdf" ||
        r.base64.length > 15_000_000
      )
        throw new Error("Invalid resume attachment.");
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
        throw new Error("Resume is not a PDF.");
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], r.fileName.replace(/[^a-zA-Z0-9._-]/g, "_"), {
          type: "application/pdf",
        }),
      );
      el.files = transfer.files;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      result.attached = true;
      result.filled.push("Resume attached — check the site shows the file");
      continue;
    }
    if (isChoice(el)) {
      // Radio buttons and checkboxes: your earlier choice, or an option the
      // agent picked from the group's own list.
      const want = remembered.has(raw) || packet.exact ? answers[raw] : "";
      if (
        want &&
        !el.checked &&
        want.split(" | ").some((w) => same(w, optionText(el)))
      ) {
        el.click();
        mark(el.labels?.[0] ?? el);
        if (!result.filled.includes(source(raw)))
          result.filled.push(source(raw));
      }
      continue;
    }
    if (!textLike(el)) continue;
    const key = /^(full name|name|your name|legal name|candidate name)$/.test(
      name,
    )
      ? "name"
      : /^(first name|given name|preferred first name)$/.test(name)
        ? "firstName"
        : /^(last name|family name|surname)$/.test(name)
          ? "lastName"
          : /^(e ?mail|email address|your email)$/.test(name)
            ? "email"
            : /^(phone|phone number|mobile|mobile number|telephone|contact number)$/.test(
                  name,
                )
              ? "phone"
              : /^(github|github url|github profile|github profile url)$/.test(
                    name,
                  )
                ? "githubUrl"
                : /^(linkedin|linkedin url|linkedin profile|linkedin profile url)$/.test(
                      name,
                    )
                  ? "linkedinUrl"
                  : /^(portfolio|portfolio url|portfolio website|website|personal website|other website)$/.test(
                        name,
                      )
                    ? "portfolioUrl"
                    : /^(country|country code|country of residence)$/.test(name)
                      ? "country"
                      : null;
    const value = key ? fields[key] : answers[raw];
    if (!value || (!key && guarded(el, raw))) continue;
    // Searchable dropdowns need an option picked, which takes time:
    // content.js does that for the fields marked here.
    if (el.getAttribute("role") === "combobox") {
      if (!chosen(el) && !value.includes(" | ")) {
        el.dataset.jobAgentChoice = value;
        el.dataset.jobAgentLabel = raw;
        // Your own earlier answer must match an option exactly.
        if (packet.exact || (!key && remembered.has(raw)))
          el.dataset.jobAgentExact = "1";
      }
      continue;
    }
    if (el.value) {
      result.skipped.push(`${raw}: existing value preserved`);
      continue;
    }
    const pattern = datePattern(el);
    const date = pattern ? toDate(value) : null;
    if (pattern && !date) continue; // Not a date the box would accept.
    setValue(el, date ? formatDate(date, pattern) : value);
    result.filled.push(key ? raw : source(raw));
  }
  for (const t of toggles) {
    const want = remembered.has(t.raw) || packet.exact ? answers[t.raw] : "";
    const button =
      want && !t.buttons.some(pressed)
        ? t.buttons.find((b) => same(b.textContent, want))
        : null;
    if (!button) continue;
    button.click();
    mark(button);
    result.filled.push(source(t.raw));
  }
  for (const el of selects) {
    const raw = label(el);
    const country = /^(country|country code|country of residence)$/.test(
      norm(raw),
    );
    const value = country ? fields.country : answers[raw];
    if (!value || el.value || (!country && guarded(el, raw))) continue;
    const option = [...el.options].find((o) => same(o.textContent, value));
    if (!option) continue;
    el.value = option.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    mark(el);
    result.filled.push(country ? raw : source(raw));
  }
  result.unanswered = unanswered();
  if (!result.attached && !packet.noResume)
    result.skipped.push(
      "No compatible empty resume field found; attach your CV manually if needed",
    );
  return result;
}
