# Render workflow recovery

The API health endpoint checks connectivity with `SELECT 1`; it does not validate migrations or Google access. The workflow overview currently tolerates failed sheet reads, so it can load while form preparation fails.

For the reported `/api/workflow/forms/batch` failure, check the API service's Render logs at the request time. After deploying the error handling changes, unexpected errors include a request reference that matches the logged error name and code.

The supplied logs identify this incident as `A populated sheet row has no Job ID`. Form preparation now excludes rows without IDs; those rows cannot authorize applications. Duplicate IDs and changed headers still block preparation with an actionable 400 response. Email publishing keeps strict sheet validation.

Applying starts from **Apply next 10** and continues one form at a time, stopping after ten recorded submissions. Automatic submission is off on page load and can be enabled explicitly for the clicked batch. Scheduled discovery never starts applications. On startup the API acquires the shared workflow lock before marking unfinished discovery records as interrupted, so old records no longer show as running forever.

- `P2021` / `P2022`: run `pnpm db:migrate` with the production database environment before starting the new API build. Generate Prisma with `pnpm db:generate` before `pnpm build`.
- Google token decryption: preserve the same `TOKEN_ENCRYPTION_KEY` used to save the Google connection. If that key is lost, disconnect and reconnect Google after deploying the disconnect fix. Google status only checks that a stored connection exists.
- Google permission or sheet errors: verify `GOOGLE_SHEETS_SPREADSHEET_ID`, the tab name, and the connected account's access. Reconnect if requested permissions are missing.
- Timeouts or network failures: retry and inspect provider availability; do not treat availability-check failures as evidence a job is closed.

Backend configuration for this deployment:

```text
APP_URL=https://vinod-job-agent-1.onrender.com
GOOGLE_REDIRECT_URI=https://vinod-job-agent.onrender.com/api/integrations/google/callback
```

Frontend build configuration:

```text
VITE_API_BASE_URL=https://vinod-job-agent.onrender.com
```

The extension already targets this production API. Reload the unpacked extension after changing its files. Form preparation and report tokens are held in API memory, so restarting the API requires preparing forms again; keep one API instance until these sessions are persisted in the database.

Validation commands: `pnpm build` and `pnpm test`. A batch request prepares applications; it does not submit them. Do not use publish endpoints for deployment smoke tests.

## Supported discovery and JOIN navigation

Discovery now scans Greenhouse, Lever and Ashby boards, plus employer-written Hacker News posts that contain a direct supported application link. LinkedIn/Naukri mailbox discovery and the other aggregators are no longer called. Unsupported backlog entries are discarded during the next discovery run; existing jobs, applications and sheet rows are preserved. New exports exclude unsupported applications.

Form Assistant 0.18.0 adds JOIN. Reload the unpacked extension after updating. It recognizes the approved listing, skips archived roles, navigates matching Apply/Next steps, fills profile/CV fields and requests drafted answers for each form step. Sign-in, passwords, OTP and CAPTCHA require user input. Automatic submission, when enabled on the dashboard, waits ten seconds and is blocked while required fields or a detected CAPTCHA remain.

JOIN state stays in extension session storage for the same tab. A spontaneous application requires its own approval; a closed numbered role never falls back to it. For numbered roles, application routes must retain a matching `jobId` query parameter. If JOIN drops that identity, the extension pauses for manual continuation. Arbitrary websites and new OAuth tabs are not automated by this adapter. Live authenticated JOIN submission has not been exercised by the test suite.

## LinkedIn handoff and model-assisted navigation

Form Assistant 0.19.0 opens an approved LinkedIn job in the user's signed-in browser, identifies its external Apply button and hands off to Greenhouse, Lever, Ashby or JOIN. New-tab redirects are bound to the armed LinkedIn opener using Chrome's [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs). Approval and the profile/CV fingerprint are rechecked before issuing the destination's one-use preparation code. Unsupported external destinations remain manual. LinkedIn login is not inherited from Google OAuth. Passwords and Gmail messages are never sent to the navigation model.

JOIN requests a decision from the configured Fuelix model when ordinary Next/Apply labels are insufficient. The model sees bounded headings and button labels and can select an eligible observed non-final button ID. Validation rejects unrelated routes, submission/login/consent actions, unknown IDs and steps blocked by missing answers or CAPTCHA. The extension rechecks the DOM node and limits repeated clicks. The server caps navigation requests per application. Model failures leave navigation manual. This improves prompts and validated decisions without fine-tuning model weights. Authenticated LinkedIn/JOIN execution needs live browser validation after deployment and reloading the extension.

Form Assistant 0.20.0 adds LinkedIn Easy Apply: the approved numeric job URL is bound to its application modal; contact fields and PDF uploads use the approved profile, and step questions use saved/profile answers. Next and Review proceed only when required fields and validation checks pass. Unknown answers, login and CAPTCHA need manual input. Optional automatic submission has a cancellable ten-second review window and rechecks sheet approval. Only a recent submit followed by a success dialog records an application; the existing API stops after ten submissions. D4 Insight and other custom external forms still need adapters. These changes have automated fixture coverage; authenticated live LinkedIn submission has not been tested. Reload the unpacked extension in chrome://extensions after pulling this update.
