# Project Status — Likelyfad Studio

Snapshot taken 2026-09-01 on branch `feature/admin-dashboard` (HEAD `6ddba62`).
Everything below was verified by running it, not read off the docs.

---

## 1. Position

`feature/admin-dashboard` is **28 commits ahead of `master`, none pushed**.
`origin/master...HEAD` = 0/28. Master last moved 2026-08-20; this branch's last
commit was 2026-08-26.

This branch is the entire "accounts release": credits, payments, the admin
dashboard, and a security pass.

### Committed work, in four arcs

| Arc | Commits | State |
|-----|---------|-------|
| Credits + Razorpay + fal pricing | `196cdd6`, `6aef1e3` | Done |
| Admin dashboard, Phases 0-4 | `e83c69c` -> `97c45ea` (~23) | Done — gate, shell, generation log, stats board, user list, moderation feed, audit log |
| Security hardening | `9bfa188` -> `32db9a3` (4) | Done — local FS routes off by default, sessions on Comfy + assistant, metered the free-spending routes, Windows path blocklist |
| Media leak fix | `6ddba62` | Done — imageResize/gifEncoder no longer write base64 into saved workflows |

### Other branches

- `feature/supabase-client-wiring` — 0 ahead / 9 behind: already merged.
- `feature/remove-byo-keys` — 0 ahead / 0 behind master: identical, can be deleted.
- `develop` — **does not exist**, despite CLAUDE.md naming it the primary branch.

---

## 2. Uncommitted work — four separable units, ~1,800 lines

1. **Scheduled maintenance** (untracked)
   - `src/lib/maintenance/guard.ts` (73), `sweep.ts` (234)
   - `src/app/api/cron/maintenance/route.ts` (78)
   - `src/lib/maintenance/__tests__/{guard,sweep}.test.ts` (386 total)
   - `supabase/migrations/0011_maintenance.sql` (105)

2. **`supabase/migrations/0012_fix_settlement.sql`** (173, untracked)
   `settle_pending_charges` has been broken since 0004 — `FOR UPDATE` on an
   aggregate query, which Postgres rejects at plan time and plpgsql only plans
   at first call. It is the first statement in the only function that debits
   credits for a workflow. **No workflow run has ever been billed.** 0012 writes
   off the accumulated backlog, then fixes the function, in that order.

3. **Quickstart templates restored** — `src/lib/quickstart/templates.ts`, +522
   lines. All six presets (Product Shot, Model Product, Colour Variations,
   Background Swap, Style Transfer, Scene Composite) had been deleted while
   every consumer still expected them.

4. **Test-infra fix** — `vitest.config.mts`, `package.json`, and 19 test files.
   Below Node 22.12 a transitive CommonJS/ESM conflict inside jsdom killed the
   test worker, and vitest reported the affected files as "no tests" rather than
   as failures — so they left the run instead of breaking it. Among them was the
   admin gate's own test file. Fixing collection surfaced 183 real failures,
   all now fixed. `engines.node` pinned to `>=22.12`; NODE_OPTIONS set in the
   config because pool workers inherit the environment but not execArgv.

Plus `CHANGELOG.md` (+77) and `CLAUDE.md` (+230) documenting the above.

---

## 3. Verification run 2026-09-01

| Check | Result |
|-------|--------|
| `npm run build` | **PASSES**, exit 0 |
| `npm run test:run` | **PASSES** — 136 files, 2,778 passed, 2 skipped, exit 0, 57s |
| `npx tsc --noEmit` | **258 errors — all 258 in test files, 0 in production source.** `tsc` is in no npm script, so nothing enforces this either way. |
| `npm run lint` | **BROKEN.** `next lint` was removed in Next 16. No `eslint` dependency, no config file. The script has been dead and silent. |

Scale: 479 TS/TSX source files, 136 test files, 50 API routes, 12 migrations.

---

## 4. Gaps

### 4.1 Nothing runs in CI
`.github/workflows/` contains only `claude.yml` (responds to `@claude`
mentions) and `update-docs.yml` (dispatches to the docs repo on merge). No
workflow runs tests or the build. `CLAUDE.md:888` claims `catalog.test.ts`
"Runs in CI" — it does not. This is exactly the gap that let the vitest
silent-skip hide for as long as it did.

### 4.2 The billing fix is inert until the SQL runs
0011 and 0012 exist only as files in the working tree. Until they are applied
to the live Supabase project, settlement still fails on every call and
`pending_charges` keeps accumulating.

### 4.3 Nothing schedules the maintenance route
The app runs behind its own `server.js`, so there is no platform cron.
`POST /api/cron/maintenance` needs an external hourly caller and `CRON_SECRET`
set, or abandoned charges never settle and retention never applies.

### 4.4 Route auth — 50 routes
Everything that spends money or touches user data is guarded: admin (8), Comfy
(6), chat, generate, generate/poll, llm, quickstart x2, fal-async, cron, credits
and `likelyfad/*` (via `getAuthedContext` or Razorpay signature), local FS
routes behind `requireLocal` and off by default.

Still open:

- `/api/images/[id]` — serves stored images by id with **no ownership check**.
  Same shape as the poll-route bug already fixed in `18ce15a`.
- `/api/models`, `/api/models/[modelId]`, `/api/providers/fal/models`,
  `/api/providers/replicate/models` — unauthenticated, and they spend provider
  keys on catalogue calls. Cheap and cached, but the same class as `7a7074e`.
- `/api/env-status`, `/api/community-workflows` (x2) — low risk, but they
  answer to anyone.

### 4.5 Doc drift in CLAUDE.md
- Says `develop` is the primary branch and all PRs target it. No `develop`
  branch exists.
- Says `catalog.test.ts` "Runs in CI". Nothing runs in CI.

---

## 5. Next steps, in order

1. Commit the four uncommitted units separately (one task = one commit, per
   CLAUDE.md) and push the branch. 28 commits of finished work currently exist
   in one place only.
2. Run `0011_maintenance.sql` then `0012_fix_settlement.sql` against the live
   database. This is the step that starts billing.
3. Point a scheduler at `POST /api/cron/maintenance`, hourly, with
   `CRON_SECRET` set.
4. Add a CI workflow running `test:run` and `build` on PRs to master.
5. Fix or delete the `lint` script, and decide whether the 258 test-file type
   errors get fixed or explicitly excluded from `tsc`.
6. Add an ownership check to `/api/images/[id]`.
7. Correct the two stale claims in CLAUDE.md (section 4.5).

---

## 6. The structural lesson

Nothing in this project exercises SQL against a real database. Everything
around settlement is mocked, so the whole credit system was green against a
function that had never once succeeded — for its entire life. Steps 2 and 4
above are patches. A smoke test that runs the migrations against a throwaway
Postgres and calls each SQL function is the thing that would catch the next one.
