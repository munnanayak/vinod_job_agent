import { apiUrl } from "./api-url";
import React, { useEffect, useState } from "react";

type Row = { question: string; answer: string; hint?: string; saved: boolean };
type Loaded = {
  saved: { question: string; answer: string }[];
  standard: { question: string; suggestion: string; hint: string }[];
};

async function call(method: "GET" | "PUT", body?: unknown): Promise<Loaded> {
  const response = await fetch(apiUrl("workflow/answers"), {
    method,
    headers: { "Content-Type": "application/json", "X-Job-Agent": "1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message || `Request failed (${response.status})`);
  return data as Loaded;
}

export function Answers() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const show = (data: Loaded) =>
    setRows([
      // Standard questions you have not answered yet come first.
      ...data.standard.map((s) => ({
        question: s.question,
        answer: s.suggestion,
        hint: s.hint,
        saved: false,
      })),
      ...data.saved.map((s) => ({ ...s, saved: true })),
    ]);
  useEffect(() => {
    call("GET").then(show, (e) => setError((e as Error).message));
  }, []);

  const update = (index: number, change: Partial<Row>) =>
    setRows(
      (current) =>
        current?.map((row, i) => (i === index ? { ...row, ...change } : row)) ??
        null,
    );
  async function save() {
    if (!rows) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // An emptied answer that was saved before is removed.
      const answers = rows
        .filter((r) => r.question.trim() && (r.answer.trim() || r.saved))
        .map((r) => ({ question: r.question.trim(), answer: r.answer.trim() }));
      show(await call("PUT", { answers }));
      setNotice("Saved. The agent uses these answers on every form from now.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!rows)
    return (
      <section className="panel" role="status">
        {error || "Loading your answers…"}
      </section>
    );
  const open = rows.filter((r) => !r.saved);
  const group = (title: string, note: string, saved: boolean) => (
    <section className="panel">
      <h2>{title}</h2>
      <p>{note}</p>
      {rows.map((row, i) =>
        row.saved !== saved ? null : (
          <label className="answer" key={i}>
            {row.hint !== undefined || row.saved ? (
              row.question
            ) : (
              <input
                placeholder="The question, as forms usually word it"
                value={row.question}
                onChange={(e) => update(i, { question: e.target.value })}
              />
            )}
            <input
              maxLength={500}
              placeholder={row.hint || "Your answer"}
              value={row.answer}
              onChange={(e) => update(i, { answer: e.target.value })}
            />
          </label>
        ),
      )}
      {!saved && (
        <button
          type="button"
          onClick={() =>
            setRows([...rows, { question: "", answer: "", saved: false }])
          }
        >
          + Add another question
        </button>
      )}
    </section>
  );
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      {group(
        `To answer (${open.length})`,
        "Common questions on application forms. Answers already filled in are suggestions from your profile: check them, fill in the rest, and leave blank anything you want to answer yourself each time. Nothing here is used until you click Save.",
        false,
      )}
      {group(
        `Saved (${rows.length - open.length})`,
        "The agent matches these to a form's questions by meaning, not exact wording, and picks the matching dropdown option. Answers you give on real forms are added here when you submit. Clear an answer and save to delete it.",
        true,
      )}
      <footer className="save-bar">
        <span className={error ? "problem" : ""}>
          {error
            ? `Not saved. ${error}`
            : "Visa, legal, salary, consent and demographic questions are only ever answered from this list."}
        </span>
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save answers"}
        </button>
      </footer>
    </>
  );
}
