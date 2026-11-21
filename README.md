# Ishanga Scheduler (North Bharat)

Mobile-first scheduler for Ishangas: track who is part of which Satsang / Mandala / IEO Initiation / Interview activity, let Ishangas opt in themselves, keep full history, and export everything to Excel.

**Stack (all free tier):** React + Vite + Tailwind · Supabase (Postgres, Auth, Row Level Security) · Vercel or Netlify for hosting.

## 1. Set up Supabase (one time)

1. Create a free project at https://supabase.com.
2. Open **SQL Editor** → paste the whole of [supabase/schema.sql](supabase/schema.sql) → **Run**.
   This creates the tables, security rules and seed data (Ishanga types, attributes, activity types and roles).
   Then do the same with [supabase/002_interviews.sql](supabase/002_interviews.sql) (interview booking module),
   [supabase/003_reassign_interviewer.sql](supabase/003_reassign_interviewer.sql),
   [supabase/004_meet_and_calendar.sql](supabase/004_meet_and_calendar.sql) and
   [supabase/005_auto_link_logins.sql](supabase/005_auto_link_logins.sql),
   [supabase/006_remove_min_notice.sql](supabase/006_remove_min_notice.sql) and
   [supabase/007_candidate_booking_lock.sql](supabase/007_candidate_booking_lock.sql),
   [supabase/008_satsang_visibility.sql](supabase/008_satsang_visibility.sql) and
   [supabase/009_ishanga_clusters.sql](supabase/009_ishanga_clusters.sql) and
   [supabase/010_exclusive_ishanga_types.sql](supabase/010_exclusive_ishanga_types.sql), in that order.
3. **Project Settings → API**: copy the *Project URL* and the *anon public* key.
4. Optional: **Authentication → Providers → Email** — turn off "Confirm email" if you don't want users to confirm their email.
5. **Authentication → URL Configuration**: set *Site URL* to your deployed URL and add `http://localhost:5173` under *Redirect URLs*.
6. **Sign in with Google** – in [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials → Create credentials → OAuth client ID**
   (type *Web application*). Add the authorised redirect URI shown in Supabase under **Authentication → Providers → Google**
   (looks like `https://<project>.supabase.co/auth/v1/callback`). Paste the Client ID and Secret into that Supabase page and enable Google.

## 2. Run locally

```bash
cp .env.example .env      # then fill in the two values
npm install
npm run dev
```

On Windows PowerShell, use `npm.cmd` if scripts are blocked.

## 3. Deploy (free)

**Vercel:** import the Git repo → framework *Vite* → add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` → Deploy.
**Netlify:** build command `npm run build`, publish directory `dist`, same env vars.
SPA routing is handled by `vercel.json` / `public/_redirects`.

## 4. First login

- The **first person to sign up becomes Admin** automatically.
- Everyone after that gets the *Pending* role (no access) until an admin assigns a role in **Settings → Users**.
- In **Settings → Users**, link each login to their Ishanga profile so they can opt in to activities themselves.

## Import the Ishanga roster

After applying migrations `008_satsang_visibility.sql` and `009_ishanga_clusters.sql`, sign in with a user who can manage people, open **Ishangas → Import CSV**, and select the latest roster CSV. The import maps the first Center column to Center, preserves the second Center separately, sets Region to **North Region**, and assigns clusters from State. It retains both emails, gender, training language, batch, expertise, and responsibility notes; `IE & Satsang` adds the Satsang type and IE attribute. Matching records are updated by name plus phone or a matching email with the same name/phone.

## Test users

To create one login for each seeded app role, run `demo/create-test-users.mjs` against a test Supabase project. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `TEST_USER_PASSWORD` in your terminal environment first. The service-role key bypasses row-level security; never use a production key or commit it to the repository.

The script creates or refreshes these accounts: `ishanga-scheduler-test-admin@example.com`, `ishanga-scheduler-test-coordinator@example.com`, `ishanga-scheduler-test-viewer@example.com`, `ishanga-scheduler-test-ishanga@example.com`, and `ishanga-scheduler-test-pending@example.com`. They all use the password from `TEST_USER_PASSWORD`. The Ishanga account is linked to a test person with all configured Ishanga types.

On Windows PowerShell, run `node demo/create-test-users.mjs` after setting those three environment variables in the current terminal.

## 5. Google Calendar invites (optional, free)

When an Ishanga taps **Confirm** on an interview, two Google Calendar events are created from a dedicated Google account
(e.g. `ishanga.interviews@gmail.com`): one for the Ishanga (with candidate details) and one for the candidate (time + Meet link only,
so the candidate never sees who the interviewer is). Both have a 30-minute reminder.

1. **Google account & API**
   - Create/choose a Google account that will own the events.
   - In [Google Cloud Console](https://console.cloud.google.com/): create a project → **APIs & Services → Library** → enable **Google Calendar API**.
   - **OAuth consent screen**: External, add yourself as a test user, then **Publish app** (otherwise the token expires after 7 days).
   - **Credentials → Create credentials → OAuth client ID** → type *Web application* → add redirect URI `https://developers.google.com/oauthplayground`. Copy the Client ID and Secret.
2. **Refresh token**
   - Open [OAuth Playground](https://developers.google.com/oauthplayground) → ⚙ → tick *Use your own OAuth credentials* → paste Client ID/Secret.
   - Scope: `https://www.googleapis.com/auth/calendar.events` → *Authorize APIs* (sign in with the dedicated account) → *Exchange authorization code for tokens* → copy the **Refresh token**.
3. **Deploy the function** – Supabase Dashboard → **Edge Functions → Deploy a new function → Via editor**, name it `calendar-sync`,
   paste [supabase/functions/calendar-sync/index.ts](supabase/functions/calendar-sync/index.ts), deploy. In the function's settings turn **off** "Enforce JWT verification".
4. **Secrets** – Edge Functions → **Secrets**: add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
   `WEBHOOK_SECRET` (any long random text) and optionally `GOOGLE_CALENDAR_ID` (defaults to `primary`).
5. **Webhook** – Database → **Webhooks → Create**: table `interview_bookings`, events *Insert* + *Update*, type *Supabase Edge Functions* → `calendar-sync`,
   add HTTP header `x-webhook-secret` = the same `WEBHOOK_SECRET`.

Status is shown on each interview ("📅 Calendar invites sent", missing email, or an error). Without this setup everything else still works;
people can use the "Add to calendar" buttons instead.

## How it fits together

| Concept | Where to manage | Notes |
|---|---|---|
| Ishanga types (SPS, Satsang, …) | Settings → Ishanga types | A person can hold several. "Training prerequisite" enforces e.g. *only SPS Ishangas can be interviewed for Satsang training*. |
| Attributes (Ashram, Fulltime, Borrowed, IE, …) | Settings → Attributes | Any number per person. |
| Activity types & roles | Settings → Activity types & roles | Each role lists which Ishanga types are eligible (empty = anyone), how many people are needed, and whether self opt-in is allowed. Eligibility is enforced in the database too. |
| App roles & permissions | Settings → App roles | Admin, Coordinator, Dashboard Viewer, Ishanga, Pending — add more as needed. |
| Activities | Activities | Create one-off or repeating (weekly / fortnightly / monthly). |
| Scheduling | Activity page | Coordinators assign people (with "busy that day" warning); Ishangas opt in; statuses: opted in → confirmed → completed. |
| Interview candidates | Interview activity page | For activity types marked "Tracks candidates". |
| Dashboard | Home | Personal schedule + open opt-ins for everyone; central coverage / by-person view for roles with *See central dashboard*. |
| Excel export | Home or Settings → Export | All people, full schedule history, activities, candidates and settings. |

### Adding a new activity in future
Settings → Activity types & roles → **+ Activity type**, then add its roles and eligibility. No code change needed.
