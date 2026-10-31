# Online Training Tracker

Static HTML pages (GitHub Pages) + Supabase database, Google sign-in.

| Page | Who | What |
|---|---|---|
| `index.html` | all registered users | People search / directory |
| `person.html?id=…` | all registered users | One person's training page (what the QR code opens) |
| `report.html` | managers, admins | Overall compliance report with charts, filters and CSV exports |
| `admin.html` | admins | Personnel, training records, courses, job functions, training matrix, **Access & roles**, CSV import, QR badges |

Only Google accounts listed under **Admin → Access & roles** can sign in. Everyone else sees "Not registered".

```
index.html  person.html  report.html  admin.html
assets/   config.js  app.css  common.js  report.js  admin.js
supabase/ schema.sql  sample-data.sql
```

---

## Deployment — about 30 minutes

### 1. Supabase project
1. Go to <https://supabase.com> → **New project**. Pick the region closest to your users and save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, press **Run**.
3. Make yourself the first admin — new query, with your own Google email:
   ```sql
   insert into public.app_users (email, full_name, role)
   values ('you@gmail.com', 'Your Name', 'admin');
   ```
4. *(Optional)* run `supabase/sample-data.sql` to get test data (5 "SAMPLE-" people). The cleanup line is at the bottom of that file.
5. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key**.

### 2. Google sign-in
1. <https://console.cloud.google.com> → create a project (any name).
2. **APIs & Services → OAuth consent screen**: User type **External**, fill in app name and your email. Then **Publish app** (otherwise only listed test users can sign in). Basic scopes (email, profile) do not need Google verification.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorized redirect URI: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.
5. Back in Supabase: **Authentication → Sign In / Providers → Google** → enable, paste both values, save.
6. In the same list, **turn OFF the Email provider** (and any other provider). Only Google sign-in should be possible.

### 3. Point the pages at Supabase
Edit `assets/config.js` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` from step 1.5. (The anon key is meant to be public; the database rules do the protecting.)

### 4. GitHub Pages
1. Create a new repository on GitHub, e.g. `training-tracker`. It must be **public** on a free GitHub plan (Pages on private repos needs a paid plan). No data lives in the repo — it is all in Supabase.
2. **Add file → Upload files**, drag in everything from this folder (keep the `assets` and `supabase` folders), commit.
3. **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, Branch `main`, folder `/ (root)` → Save.
4. After a minute the site is at `https://YOUR-USER.github.io/training-tracker/`.

### 5. Tell Supabase the site address
**Authentication → URL Configuration**:
- **Site URL**: `https://YOUR-USER.github.io/training-tracker/`
- **Redirect URLs** → add: `https://YOUR-USER.github.io/training-tracker/**`

### 6. First sign-in and set-up
1. Open the site, **Sign in with Google** with the email from step 1.3.
2. Admin → **Job functions**, **Courses**, **Training matrix** (click cells to set **M**, then *Save changes*).
3. Admin → **Personnel** (or **Import CSV** for bulk — download the template, fill it from Excel, save as *CSV UTF-8*).
4. Admin → **Training records** (or Import CSV).
5. Admin → **Access & roles**: add each Google email and pick **Viewer**, **Manager** or **Admin**. *Add several* takes a pasted list.
6. Personnel → **Print QR badges (filtered)** prints a sheet of CR80-size badges (photo, name, QR) for whoever is in the current filter.

---

## How things work

- **Roles**: Viewer = all person pages. Manager = Viewer + report + people directory. Admin = Manager + administration. Untick *Active* to suspend someone without deleting them. The database refuses to remove, demote or suspend the last active admin.
- **Status** of each person × course:
  `Valid` · `Due soon` (expires within 30 days, still counts as in date) · `Expired` · `Not done`.
  **Compliance** = in date ÷ mandatory courses from the matrix. Courses taken that are not mandatory for the person's job function show under *Other training on record* with their expiry, but don't affect compliance.
- **Expiry** is filled from the course *Validity (months)* when a record is added; admins can override it. Empty validity = never expires.
- **Photos** are cropped to 4:5, resized, and stored in a private Supabase bucket; pages load them through short-lived links.
- **Dates** use Qatar time for "today".

## Good to know

- **Free Supabase projects pause after about a week with no activity.** Unpause from the dashboard, or use a paid plan for anything people rely on daily.
- Backups: Admin → Report → *Export people summary*, or Supabase **Database → Backups** (paid) / `Table editor → Export CSV`.
- The report page is limited to managers in the interface; viewers can technically read the same underlying data they already see person by person, so treat "viewer" as trusted read-only.
- To change the 30-day "due soon" window, change `+ 30` in `v_training_status` (schema.sql, re-run that view) **and** `DUE_SOON_DAYS` in `assets/config.js`.
- Contact line on person pages: `CONTACT_LINE` in `assets/config.js`.
