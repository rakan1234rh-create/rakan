# AGENTS.md

## Cursor Cloud specific instructions

### What this is
ATHAR / مرصاد is a **single static SPA**: the entire app (HTML + CSS + JS, ~17k lines) lives in `index.html`. There is **no build step and no `package.json`**. Front-end deps load from CDNs at runtime. See `README.md` for the full product/architecture overview.

### Backend
The app talks to a **hosted Supabase project** (no local backend to start). The connection is hard-coded in the `CONFIGURATION` block of `index.html` (`SUPABASE_URL`, `SUPABASE_ANON`). Optional Cloudflare R2 attachments are **skipped on `localhost`** by default (see `README.md` for the `mirsad_force_r2_local` override).

### Run it (dev)
Serve the repo root over HTTP and open in a browser — any static server works:

```
python3 -m http.server 4173
```

Then open `http://localhost:4173/index.html`. Opening via `file://` breaks the Supabase/R2 flows, so always use an HTTP server.

### Test login
A dedicated test admin account exists in the Supabase project for verifying the authenticated app:

- Email: `cursor-devtest@athar.local`
- Password: `CursorDev#2026`
- Role: `admin` (active)

The app authenticates via Supabase Auth; login by email or by employee number (`devtest`). Gotcha: the project has **email confirmation enabled**, so if you ever need to seed another auth user, create it via the GoTrue signup endpoint and then set `auth.users.email_confirmed_at` (a raw bcrypt insert verifies in SQL but GoTrue still rejects it). The profile must exist in `public.users` with `auth_uid` linked and `is_active = true`.

### Lint / checks
These node scripts use only built-ins (no install needed) and validate the large inline `<script>`:

- `node scripts/check-syntax.cjs` — inline JS syntax check (prints `syntax OK`).
- `node scripts/extract-and-check.js` — same via `node --check` (prints `ok`).

Note: `scripts/check-html-structure.js` and `scripts/check-appwrap.js` are **naive regex diagnostics**; they report false "MISMATCH"/non-zero depth because they don't account for tags inside JS strings — they are not pass/fail gates. `scripts/acorn-check.js` requires the `acorn` package (not installed, no lockfile) — skip unless you install it manually.

### Deploy (reference only, not for dev)
`main` auto-deploys to GitHub Pages (`CNAME` → `athar.app`) and Supabase Edge Functions via `.github/workflows/`. The Pages workflow runs `npm install sharp @resvg/resvg-js` only to regenerate icons — not needed locally.
