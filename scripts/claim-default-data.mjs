#!/usr/bin/env node
/**
 * Claim the pre-authentication data for a real account.
 *
 *   node scripts/claim-default-data.mjs --list
 *   node scripts/claim-default-data.mjs --email you@example.com --dry-run
 *   node scripts/claim-default-data.mjs --email you@example.com
 *
 * Rows written before OAuth existed carry user_id 'default' (NULL after
 * migration 0001) and their storage objects live under `default/...`. This
 * assigns those rows to a user and moves the objects to `<uid>/...` so the
 * storage RLS policy — which compares the first path segment to auth.uid() —
 * lets them through.
 *
 * Uses the service-role key, so it deliberately bypasses RLS. Run it once,
 * after 0001_auth_rls.sql, and after signing in at least once so the account
 * exists.
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const EMAIL = flag("email");
const UID_ARG = flag("uid");
const DRY = has("dry-run");
const LIST = has("list");
const BUCKET = "project-media";
const LEGACY = "default";

// ─── credentials ────────────────────────────────────────────────────

function readEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const fileEnv = readEnvLocal();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !SVC) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(URL_, SVC, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── accounts ───────────────────────────────────────────────────────

async function listUsers() {
  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw new Error(`Cannot list users: ${error.message}`);
  return data.users;
}

if (LIST) {
  const users = await listUsers();
  if (!users.length) {
    console.log("No accounts yet — sign in through the app once, then re-run.");
  } else {
    console.log("Accounts:");
    for (const u of users) {
      console.log(`  ${u.id}  ${u.email ?? "(no email)"}  created ${u.created_at}`);
    }
  }
  process.exit(0);
}

if (!EMAIL && !UID_ARG) {
  console.error(
    "Pass --email you@example.com (or --uid <uuid>). Use --list to see accounts."
  );
  process.exit(1);
}

let uid = UID_ARG;
if (!uid) {
  const users = await listUsers();
  const match = users.find((u) => (u.email ?? "").toLowerCase() === EMAIL.toLowerCase());
  if (!match) {
    console.error(
      `No account with email ${EMAIL}. Sign in through the app first, or use --list.`
    );
    process.exit(1);
  }
  uid = match.id;
}

console.log(`Claiming unowned data for ${EMAIL ?? uid} (${uid})`);
if (DRY) console.log("DRY RUN — nothing will be written.\n");

// ─── rows ───────────────────────────────────────────────────────────

let changed = 0;

async function claimRows(table) {
  const { data: rows, error } = await db.from(table).select("id").is("user_id", null);
  if (error) {
    // cost_events/templates only gained user_id in migration 0001.
    console.log(`  ${table}: skipped (${error.message})`);
    return;
  }
  if (!rows.length) {
    console.log(`  ${table}: nothing unowned`);
    return;
  }
  if (DRY) {
    console.log(`  ${table}: would claim ${rows.length} row(s)`);
    return;
  }
  const { error: upErr } = await db.from(table).update({ user_id: uid }).is("user_id", null);
  if (upErr) console.log(`  ${table}: FAILED — ${upErr.message}`);
  else {
    console.log(`  ${table}: claimed ${rows.length} row(s)`);
    changed += rows.length;
  }
}

console.log("\nRows");
for (const t of ["projects", "media", "cost_events", "templates"]) {
  await claimRows(t);
}

// ─── storage ────────────────────────────────────────────────────────

/** Recursively collect every object key beneath a prefix. */
async function walk(prefix) {
  const found = [];
  const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${prefix}: ${error.message}`);
  for (const entry of data ?? []) {
    const child = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A real object has metadata; a folder placeholder does not.
    if (entry.id) found.push(child);
    else found.push(...(await walk(child)));
  }
  return found;
}

console.log("\nStorage");
let objects = [];
try {
  objects = await walk(LEGACY);
} catch (err) {
  console.log(`  could not walk ${LEGACY}/: ${err.message}`);
}

if (!objects.length) {
  console.log(`  nothing under ${LEGACY}/`);
} else {
  console.log(`  ${objects.length} object(s) under ${LEGACY}/`);
  let moved = 0;
  let failed = 0;
  for (const from of objects) {
    const to = `${uid}/${from.slice(LEGACY.length + 1)}`;
    if (DRY) {
      console.log(`    would move ${from} → ${to}`);
      continue;
    }
    const { error } = await db.storage.from(BUCKET).move(from, to);
    if (error) {
      // Already moved by an earlier run is not a failure worth shouting about.
      if (/exists/i.test(error.message)) {
        console.log(`    skip (target exists) ${to}`);
      } else {
        console.log(`    FAILED ${from} → ${to}: ${error.message}`);
        failed++;
      }
      continue;
    }
    moved++;
  }
  if (!DRY) console.log(`  moved ${moved}, failed ${failed}`);
}

// media.storage_path recorded the old key, so rewrite the prefix to match.
if (!DRY) {
  const { data: rows, error } = await db
    .from("media")
    .select("id, storage_path")
    .like("storage_path", `${LEGACY}/%`);
  if (error) {
    console.log(`\n  media.storage_path: could not read — ${error.message}`);
  } else if (rows.length) {
    let fixed = 0;
    for (const row of rows) {
      const next = `${uid}/${row.storage_path.slice(LEGACY.length + 1)}`;
      const { error: e } = await db
        .from("media")
        .update({ storage_path: next })
        .eq("id", row.id);
      if (!e) fixed++;
    }
    console.log(`\n  media.storage_path: rewrote ${fixed}/${rows.length}`);
  }
}

console.log(
  DRY
    ? "\nDry run complete — re-run without --dry-run to apply."
    : `\nDone. ${changed} row(s) claimed.`
);
