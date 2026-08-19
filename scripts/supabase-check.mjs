#!/usr/bin/env node
/**
 * Supabase connection check for Likelyfad Studio.
 *
 *   node scripts/supabase-check.mjs            # read-only checks
 *   node scripts/supabase-check.mjs --write    # also probe writes (cleans up)
 *   node scripts/supabase-check.mjs --app      # also check the running dev server
 *
 * Never prints key material — only lengths, roles and project refs.
 * Exits non-zero if any check fails, so it works in CI.
 */

import fs from "fs";
import path from "path";

const args = new Set(process.argv.slice(2));
const DO_WRITE = args.has("--write");
const DO_APP = args.has("--app");
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const TABLES = ["projects", "media", "templates", "cost_events"];
const BUCKET = "project-media";

let failures = 0;
const ok = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };
const warn = (m) => console.log(`  \x1b[33mWARN\x1b[0m  ${m}`);
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

// ─── env ────────────────────────────────────────────────────────────

function readEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    // dotenv strips a single matching pair of surrounding quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const fileEnv = readEnvLocal();
const env = (k) => process.env[k] || fileEnv[k] || "";

const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const ANON = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SVC = env("SUPABASE_SERVICE_ROLE_KEY");

head("1. Environment");
for (const [name, val] of [
  ["NEXT_PUBLIC_SUPABASE_URL", URL_],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON],
  ["SUPABASE_SERVICE_ROLE_KEY", SVC],
]) {
  if (!val) bad(`${name} is missing`);
  else ok(`${name} present (${val.length} chars)`);
}
if (failures) {
  console.log("\nCannot continue without all three variables.");
  process.exit(1);
}

let host;
try {
  host = new globalThis.URL(URL_).host;
  ok(`URL parses, host = ${host}`);
} catch {
  bad(`URL is not a valid URL`);
  process.exit(1);
}

function jwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
  } catch {
    return null;
  }
}

const anonClaims = jwtPayload(ANON);
const svcClaims = jwtPayload(SVC);
const urlRef = host.split(".")[0];

for (const [name, claims, wantRole] of [
  ["anon key", anonClaims, "anon"],
  ["service key", svcClaims, "service_role"],
]) {
  if (!claims) { bad(`${name} is not a decodable JWT`); continue; }
  if (claims.role !== wantRole) bad(`${name} has role "${claims.role}", expected "${wantRole}"`);
  else ok(`${name} role = ${claims.role}`);
  if (claims.ref !== urlRef) bad(`${name} is for project "${claims.ref}" but URL points at "${urlRef}"`);
  else ok(`${name} project ref matches the URL`);
  if (claims.exp && claims.exp * 1000 < Date.now()) bad(`${name} expired`);
}

// ─── REST ───────────────────────────────────────────────────────────

const headersFor = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

async function selectOne(key, table) {
  const r = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, { headers: headersFor(key) });
  const body = await r.text();
  return { status: r.status, body };
}

head("2. Tables (read)");
for (const [label, key] of [["anon", ANON], ["service", SVC]]) {
  for (const table of TABLES) {
    try {
      const { status, body } = await selectOne(key, table);
      if (status === 200) {
        const rows = JSON.parse(body);
        ok(`[${label}] ${table} → 200, ${rows.length} row(s) visible`);
      } else {
        bad(`[${label}] ${table} → ${status} ${body.slice(0, 120)}`);
      }
    } catch (e) {
      bad(`[${label}] ${table} → network error: ${e.message}`);
    }
  }
}

head("3. Expected columns");
{
  const r = await fetch(
    `${URL_}/rest/v1/projects?select=id,name,workflow_json,edge_style,node_count,incurred_cost&limit=1`,
    { headers: headersFor(SVC) }
  );
  if (r.status === 200) ok("projects has every column the app selects (incl. incurred_cost)");
  else bad(`projects column check → ${r.status} ${(await r.text()).slice(0, 160)}`);
}

head("4. Storage bucket");
{
  const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { ...headersFor(SVC), "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1 }),
  });
  if (r.status === 200) ok(`bucket "${BUCKET}" reachable`);
  else bad(`bucket "${BUCKET}" → ${r.status} ${(await r.text()).slice(0, 160)}`);
}

// ─── writes ─────────────────────────────────────────────────────────

if (DO_WRITE) {
  head("5. Write probe (temporary rows, cleaned up)");
  const id = `__supabase_check_${process.pid}__`;
  const objectPath = `default/${id}/probe.txt`;
  try {
    const up = await fetch(`${URL_}/rest/v1/projects?on_conflict=id`, {
      method: "POST",
      headers: {
        ...headersFor(SVC),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ id, name: "supabase-check probe", workflow_json: {} }),
    });
    if (up.ok) ok(`projects upsert → ${up.status}`);
    else bad(`projects upsert → ${up.status} ${(await up.text()).slice(0, 160)}`);

    const put = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: "POST",
      headers: { ...headersFor(SVC), "Content-Type": "text/plain" },
      body: "probe",
    });
    if (put.ok) ok(`storage upload → ${put.status}`);
    else bad(`storage upload → ${put.status} ${(await put.text()).slice(0, 160)}`);
  } finally {
    await fetch(`${URL_}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: "DELETE",
      headers: headersFor(SVC),
    }).catch(() => {});
    const del = await fetch(`${URL_}/rest/v1/projects?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: headersFor(SVC),
    }).catch(() => null);
    if (del && del.ok) ok("probe rows cleaned up");
    else warn("cleanup may have failed — check for a __supabase_check_ row");
  }

  head("6. Anon write exposure");
  {
    const id = `__anon_probe_${process.pid}__`;
    const r = await fetch(`${URL_}/rest/v1/projects?on_conflict=id`, {
      method: "POST",
      headers: {
        ...headersFor(ANON),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ id, name: "anon probe", workflow_json: {} }),
    });
    if (r.ok) {
      warn(
        "the anon key can WRITE to projects — it ships to every browser, so anyone " +
          "holding it can modify your data. Consider RLS policies."
      );
      await fetch(`${URL_}/rest/v1/projects?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: headersFor(SVC),
      }).catch(() => {});
    } else {
      ok(`anon writes are blocked (${r.status}) — RLS is doing its job`);
    }
  }
}

// ─── app routes ─────────────────────────────────────────────────────

if (DO_APP) {
  head("7. App routes");
  const check = async (label, url, init) => {
    try {
      const r = await fetch(url, init);
      const body = await r.text();
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      if (r.ok && !parsed?.error) ok(`${label} → ${r.status}`);
      else bad(`${label} → ${r.status} ${body.slice(0, 160)}`);
      return parsed;
    } catch (e) {
      bad(`${label} → not reachable at ${APP_URL} (${e.message}). Is \`npm run dev\` running?`);
      return null;
    }
  };

  const list = await check("GET /api/likelyfad/projects", `${APP_URL}/api/likelyfad/projects`);
  if (list?.projects?.length) {
    console.log(`        ${list.projects.length} project(s):`);
    for (const p of list.projects.slice(0, 10)) {
      console.log(`          ${p.name} — ${p.node_count} nodes — ${p.id}`);
    }
  }
  await check("GET /api/likelyfad/templates", `${APP_URL}/api/likelyfad/templates`);

  const px =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const id = `__supabase_check_${process.pid}__`;
  await check("POST /api/likelyfad/projects", `${APP_URL}/api/likelyfad/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name: "supabase-check probe", workflow_json: {}, node_count: 0 }),
  });
  await check("POST /api/likelyfad/media", `${APP_URL}/api/likelyfad/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: id, mediaId: "probe", imageData: px, folder: "generations" }),
  });
  const got = await check(
    "GET  /api/likelyfad/media",
    `${APP_URL}/api/likelyfad/media?projectId=${id}&mediaId=probe&type=image`
  );
  if (got?.image === px) ok("media round-trips byte-identical");
  else if (got) bad("media came back but does not match what was uploaded");
  await check(
    "DELETE /api/likelyfad/projects/:id",
    `${APP_URL}/api/likelyfad/projects/${id}`,
    { method: "DELETE" }
  );
}

// ─── summary ────────────────────────────────────────────────────────

console.log("");
if (failures === 0) {
  console.log("\x1b[32mSupabase connection OK.\x1b[0m");
  process.exit(0);
} else {
  console.log(`\x1b[31m${failures} check(s) failed.\x1b[0m`);
  process.exit(1);
}
