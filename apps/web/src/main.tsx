import { apiUrl } from "./api-url";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { candidateProfileSchema } from "@job-agent/types";
import type { CandidateProfile, CandidateProfileInput } from "@job-agent/types";
import { Workflow } from "./workflow.js";
import { Answers } from "./answers.js";
import "./style.css";
const empty: CandidateProfileInput = {
  name: "",
  email: "",
  phone: "",
  portfolioUrl: "",
  githubUrl: "",
  firstName: "",
  lastName: "",
  linkedinUrl: "",
  currentCity: "",
  country: "",
  summary: "",
  currentTitle: "",
  yearsOfExperience: 0,
  locations: [],
  remotePreference: null,
  targetRoles: [],
  excludedRoles: [],
  minimumSalary: null,
  currency: "INR",
  noticePeriodDays: null,
  workAuthorization: "",
  skills: [],
  education: [],
  experience: [],
  projects: [],
};
async function request(
  method = "GET",
  body?: CandidateProfileInput,
): Promise<CandidateProfile | null> {
  const response = await fetch(apiUrl("profile"), {
    method,
    headers: { "Content-Type": "application/json", "X-Job-Agent": "1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 400
        ? "Please check your profile fields and try again."
        : "Could not reach your profile. Check that the API and database are running.",
    );
  return (await response.json()).profile;
}
function App() {
  const [page, setPage] = useState<"overview" | "profile" | "answers" | "jobs">(
    new URLSearchParams(location.search).has("google") ? "jobs" : "overview",
  );
  const [saved, setSaved] = useState<CandidateProfile | null>(null);
  const [draft, setDraft] = useState<CandidateProfileInput>(empty);
  const [resume, setResume] = useState<{
    fileName: string;
    sizeBytes: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const profile = await request();
      const resumeResponse = await fetch(apiUrl("resume"));
      if (!resumeResponse.ok)
        throw new Error("Could not load resume information.");
      setResume((await resumeResponse.json()).resume);
      setSaved(profile);
      if (profile) {
        const { id, createdAt, updatedAt, ...input } = profile;
        setDraft(input);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update<K extends keyof CandidateProfileInput>(
    key: K,
    value: CandidateProfileInput[K],
  ) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setNotice("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const result = candidateProfileSchema.safeParse(draft);
    if (!result.success) {
      setError(
        result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(" · "),
      );
      return;
    }
    setSaving(true);
    try {
      const profile = await request("PUT", result.data);
      setSaved(profile);
      setDirty(false);
      setNotice("Your profile is saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const field = (
    label: string,
    key:
      | "name"
      | "currentTitle"
      | "currency"
      | "workAuthorization"
      | "email"
      | "phone"
      | "portfolioUrl"
      | "githubUrl"
      | "firstName"
      | "lastName"
      | "linkedinUrl"
      | "currentCity"
      | "country",
    required = false,
  ) => (
    <label>
      {label}
      <input
        required={required}
        maxLength={key === "workAuthorization" ? 500 : 200}
        value={draft[key]}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );
  const list = (
    label: string,
    key: "skills" | "locations" | "targetRoles" | "excludedRoles",
    placeholder: string,
  ) => (
    <label>
      {label}
      <input
        placeholder={placeholder}
        value={draft[key].join(",")}
        onChange={(event) => update(key, event.target.value.split(","))}
        onBlur={() =>
          update(key, draft[key].map((value) => value.trim()).filter(Boolean))
        }
      />
      <small>Separate entries with commas</small>
    </label>
  );
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          j<span>Job Agent</span>
        </a>
        <div className="workspace">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page === "overview" ? "active" : ""}
            onClick={() => setPage("overview")}
          >
            ◫ <span>Overview</span>
          </button>
          <button
            className={page === "profile" ? "active" : ""}
            onClick={() => setPage("profile")}
          >
            ◎ <span>My profile</span>
          </button>
          <button
            className={page === "jobs" ? "active" : ""}
            onClick={() => setPage("jobs")}
          >
            ⇄ <span>Jobs &amp; publish</span>
          </button>
          <button
            className={page === "answers" ? "active" : ""}
            onClick={() => setPage("answers")}
          >
            ✎ <span>Form answers</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="dot" /> Local workspace
          <small>Runs on your computer</small>
        </div>
      </aside>
      <main>
        <header>
          <span>Your career, with intention.</span>
          <span className="badge">NOTHING IS SENT WITHOUT YOUR APPROVAL</span>
        </header>
        {loading ? (
          <section className="panel" role="status">
            Loading your workspace…
          </section>
        ) : (
          <>
            <div className="heading">
              <div>
                <span className="eyebrow">
                  {page === "overview"
                    ? "YOUR NEXT CHAPTER"
                    : page === "jobs"
                      ? "THREE STEPS"
                      : page === "answers"
                        ? "ANSWER ONCE"
                        : "THE STARTING POINT"}
                </span>
                <h1>
                  {page === "overview"
                    ? saved
                      ? `Welcome back, ${saved.name.split(" ")[0]}.`
                      : "Good opportunities start with you."
                    : page === "jobs"
                      ? "Find, approve and apply."
                      : page === "answers"
                        ? "Your answers to form questions."
                        : "Tell your professional story."}
                </h1>
                <p>
                  {page === "overview"
                    ? "A thoughtful job search, built around your experience and ambitions."
                    : page === "jobs"
                      ? "The agent finds jobs. You approve the ones you want, then it fills the applications and you confirm each one."
                      : page === "answers"
                        ? "Questions that application forms keep asking. Answer them once here and the agent fills them on every form."
                        : "Your agent will use these facts to find and explain relevant opportunities."}
                </p>
              </div>
              {page === "overview" && (
                <button className="primary" onClick={() => setPage("profile")}>
                  {saved ? "Edit your profile" : "Create your profile"} ↗
                </button>
              )}
            </div>
            {error && (
              <div className="error" role="alert">
                {error}{" "}
                {!dirty && (
                  <button onClick={() => void load()}>Retry connection</button>
                )}
              </div>
            )}
            {notice && (
              <div className="success" role="status">
                {notice}
              </div>
            )}
            {page === "overview" ? (
              <>
                <div className="stats">
                  <article>
                    <span>Profile status</span>
                    <strong>{saved ? "Ready" : "Not started"}</strong>
                    <small>
                      {saved
                        ? "Your foundation is in place"
                        : "Let’s get to know you"}
                    </small>
                  </article>
                  <article>
                    <span>Skills in your toolkit</span>
                    <strong>{saved?.skills.length ?? "—"}</strong>
                    <small>Grounded in your real experience</small>
                  </article>
                  <article>
                    <span>Target roles</span>
                    <strong>{saved?.targetRoles.length ?? "—"}</strong>
                    <small>Focus your next move</small>
                  </article>
                </div>
                <div className="overview-grid">
                  <section className="panel story">
                    <span className="eyebrow">BUILT AROUND YOU</span>
                    <h2>
                      {saved
                        ? saved.currentTitle
                        : "The right fit starts with the full picture."}
                    </h2>
                    <p>
                      {saved
                        ? `${saved.yearsOfExperience} years of experience · ${saved.remotePreference === null ? "Work preference not set" : saved.remotePreference ? "Open to remote work" : "Location-based opportunities"}`
                        : "Add your skills, experience, and preferences. This becomes the foundation for every future job match."}
                    </p>
                    <div className="chips">
                      {saved?.skills.map((skill) => (
                        <span key={skill}>{skill}</span>
                      ))}
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPage("profile")}
                    >
                      {saved ? "Review your profile" : "Build my profile"} →
                    </button>
                  </section>
                  <section className="panel">
                    <span className="eyebrow">YOUR WORKSPACE ROADMAP</span>
                    <ol className="roadmap">
                      <li className="current">
                        <strong>01 · Your profile</strong>
                        <span>
                          {saved
                            ? "Saved and ready to build on"
                            : "Add the facts that make you, you"}
                        </span>
                      </li>
                      <li>
                        <strong>02 · Discover & match</strong>
                        <span>Find jobs and understand your fit</span>
                      </li>
                      <li>
                        <strong>03 · Prepare & track</strong>
                        <span>Review applications before taking action</span>
                      </li>
                    </ol>
                  </section>
                </div>
                <div className="note">
                  Discovery, sheet review and publishing live under Jobs &amp;
                  publish. Nothing is sent without your approval.
                </div>
              </>
            ) : page === "jobs" ? (
              <Workflow />
            ) : page === "answers" ? (
              <Answers />
            ) : (
              <form onSubmit={save}>
                <fieldset disabled={saving}>
                  <section className="panel">
                    <h2>The essentials</h2>
                    <p>A clear introduction to your professional background.</p>
                    <div className="form-grid">
                      {field("Full name", "name", true)}
                      {field("Email", "email")}
                      {field("Phone", "phone")}
                      {field("Portfolio URL", "portfolioUrl")}
                      {field("GitHub URL", "githubUrl")}
                      {field("LinkedIn URL", "linkedinUrl")}
                      {field("First name (for application forms)", "firstName")}
                      {field("Last name (for application forms)", "lastName")}
                      {field("Current city", "currentCity")}
                      {field("Country (e.g. India)", "country")}
                      <label>
                        Professional summary
                        <textarea
                          maxLength={3000}
                          value={draft.summary}
                          onChange={(e) => update("summary", e.target.value)}
                        />
                      </label>
                      {field(
                        "Current / professional title",
                        "currentTitle",
                        true,
                      )}
                      <label>
                        Years of experience
                        <input
                          type="number"
                          min="0"
                          max="70"
                          step="0.01"
                          required
                          value={draft.yearsOfExperience}
                          onChange={(e) =>
                            update("yearsOfExperience", Number(e.target.value))
                          }
                        />
                      </label>
                      {list(
                        "Skills",
                        "skills",
                        "React, TypeScript, PostgreSQL",
                      )}
                    </div>
                  </section>
                  <section className="panel">
                    <h2>Resume attachment</h2>
                    {resume ? (
                      <>
                        <p>
                          {resume.fileName} ·{" "}
                          {Math.ceil(resume.sizeBytes / 1024)} KB
                        </p>
                        <a href={apiUrl("resume/file")}>
                          Download original PDF
                        </a>
                        <p>
                          This is your original CV. Profile edits do not change
                          its contents. Approved email applications attach this
                          file.
                        </p>
                      </>
                    ) : (
                      <p>No PDF has been imported yet.</p>
                    )}
                  </section>
                  <section className="panel">
                    <h2>Your next role</h2>
                    <div className="form-grid">
                      {list(
                        "Target roles",
                        "targetRoles",
                        "Full Stack Developer, Frontend Engineer",
                      )}
                      {list(
                        "Excluded roles",
                        "excludedRoles",
                        "Roles you want to avoid",
                      )}
                      {list(
                        "Preferred locations",
                        "locations",
                        "Hyderabad, Bengaluru",
                      )}
                      <label>
                        Remote work preference
                        <select
                          value={
                            draft.remotePreference === null
                              ? ""
                              : String(draft.remotePreference)
                          }
                          onChange={(e) =>
                            update(
                              "remotePreference",
                              e.target.value === ""
                                ? null
                                : e.target.value === "true",
                            )
                          }
                        >
                          <option value="">Not specified</option>
                          <option value="true">Open to remote</option>
                          <option value="false">On-site / hybrid only</option>
                        </select>
                      </label>
                      <label>
                        Minimum annual salary (optional)
                        <input
                          type="number"
                          min="0"
                          value={draft.minimumSalary ?? ""}
                          onChange={(e) =>
                            update(
                              "minimumSalary",
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                      </label>
                      {field(
                        "Salary currency (3 letters only, e.g. INR)",
                        "currency",
                        true,
                      )}
                      <label>
                        Notice period in days (optional)
                        <input
                          type="number"
                          min="0"
                          max="365"
                          value={draft.noticePeriodDays ?? ""}
                          onChange={(e) =>
                            update(
                              "noticePeriodDays",
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                      </label>
                      {field("Work authorization", "workAuthorization")}
                    </div>
                  </section>
                  <section className="panel">
                    <h2>Experience</h2>
                    <p>Only include experience you actually have.</p>
                    {draft.experience.map((item, i) => (
                      <div className="entry" key={i}>
                        <label>
                          Company
                          <input
                            required
                            value={item.company}
                            onChange={(e) =>
                              update(
                                "experience",
                                draft.experience.map((x, n) =>
                                  n === i
                                    ? { ...x, company: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          Title
                          <input
                            required
                            value={item.title}
                            onChange={(e) =>
                              update(
                                "experience",
                                draft.experience.map((x, n) =>
                                  n === i ? { ...x, title: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          Responsibilities and achievements
                          <textarea
                            value={item.details}
                            onChange={(e) =>
                              update(
                                "experience",
                                draft.experience.map((x, n) =>
                                  n === i
                                    ? { ...x, details: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            update(
                              "experience",
                              draft.experience.filter((_, n) => n !== i),
                            )
                          }
                        >
                          Remove experience
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        update("experience", [
                          ...draft.experience,
                          { company: "", title: "", details: "" },
                        ])
                      }
                    >
                      + Add experience
                    </button>
                  </section>
                  <section className="panel">
                    <h2>Education</h2>
                    {draft.education.map((item, i) => (
                      <div className="entry" key={i}>
                        <label>
                          Institution
                          <input
                            required
                            value={item.institution}
                            onChange={(e) =>
                              update(
                                "education",
                                draft.education.map((x, n) =>
                                  n === i
                                    ? { ...x, institution: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          Qualification
                          <input
                            required
                            value={item.qualification}
                            onChange={(e) =>
                              update(
                                "education",
                                draft.education.map((x, n) =>
                                  n === i
                                    ? { ...x, qualification: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          Graduation year (optional)
                          <input
                            type="number"
                            min="1950"
                            max="2100"
                            value={item.year ?? ""}
                            onChange={(e) =>
                              update(
                                "education",
                                draft.education.map((x, n) =>
                                  n === i
                                    ? {
                                        ...x,
                                        year: e.target.value
                                          ? Number(e.target.value)
                                          : null,
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            update(
                              "education",
                              draft.education.filter((_, n) => n !== i),
                            )
                          }
                        >
                          Remove education
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        update("education", [
                          ...draft.education,
                          { institution: "", qualification: "", year: null },
                        ])
                      }
                    >
                      + Add education
                    </button>
                  </section>
                  <section className="panel">
                    <h2>Projects</h2>
                    {draft.projects.map((item, i) => (
                      <div className="entry" key={i}>
                        <label>
                          Project name
                          <input
                            required
                            value={item.name}
                            onChange={(e) =>
                              update(
                                "projects",
                                draft.projects.map((x, n) =>
                                  n === i ? { ...x, name: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          What you built
                          <textarea
                            value={item.details}
                            onChange={(e) =>
                              update(
                                "projects",
                                draft.projects.map((x, n) =>
                                  n === i
                                    ? { ...x, details: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            update(
                              "projects",
                              draft.projects.filter((_, n) => n !== i),
                            )
                          }
                        >
                          Remove project
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        update("projects", [
                          ...draft.projects,
                          { name: "", details: "" },
                        ])
                      }
                    >
                      + Add project
                    </button>
                  </section>
                  <footer className="save-bar">
                    <span className={error ? "problem" : ""}>
                      {error
                        ? `Not saved. ${error}`
                        : dirty
                          ? "You have unsaved changes"
                          : saved
                            ? "Profile saved to your workspace"
                            : "Your profile stays in your database"}
                    </span>
                    <button className="primary" type="submit">
                      {saving ? "Saving…" : "Save profile"}
                    </button>
                  </footer>
                </fieldset>
              </form>
            )}
          </>
        )}
        <footer className="page-footer">
          JOB AGENT <span>A more intentional next step.</span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
