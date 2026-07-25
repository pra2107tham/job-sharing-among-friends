#!/usr/bin/env node
/**
 * Configuration self-check.
 *
 * This exists because nobody should have to send their Supabase keys or OAuth
 * client IDs to anyone — not to a teammate, not into a chat window — just to
 * find out whether they pasted them in correctly. Run this instead: it checks
 * the values where they live and tells you exactly what is wrong.
 *
 *   pnpm doctor
 *
 * It NEVER prints a secret. Values are reported by shape ("looks like a JWT",
 * "wrong project ref"), never by content. That means the output is safe to
 * paste anywhere when you need help.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(repoRoot, '.env');

const results = [];
const record = (status, name, detail, fix) => results.push({ status, name, detail, fix });
const pass = (n, d) => record('pass', n, d);
const warn = (n, d, fix) => record('warn', n, d, fix);
const fail = (n, d, fix) => record('fail', n, d, fix);

/** Minimal .env parser — no dependency, and we only need KEY=value. */
function loadEnv(path) {
  if (!existsSync(path)) return null;
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Decode a JWT payload without verifying — we only inspect claims. */
function jwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const fileEnv = loadEnv(envPath);
// Real environment wins, so CI and hosted builds can be checked the same way.
const env = { ...(fileEnv ?? {}), ...process.env };

// ---------------------------------------------------------------- env file --

if (!fileEnv) {
  warn(
    '.env file',
    'not found',
    'cp .env.example .env — or set the variables in your shell / EAS secrets',
  );
} else {
  pass('.env file', 'found');
}

// ------------------------------------------------------------ safety check --
// The most damaging possible misconfiguration, so it is checked first and loud.

const leakedServiceKeys = Object.keys(env).filter(
  (k) => k.startsWith('EXPO_PUBLIC_') && /SERVICE_ROLE|SECRET|PRIVATE/i.test(k),
);
if (leakedServiceKeys.length) {
  fail(
    'no secrets in the client bundle',
    `${leakedServiceKeys.join(', ')} would be compiled into the app`,
    'Anything prefixed EXPO_PUBLIC_ ships to every user. Rename it and keep it server-side only.',
  );
} else {
  pass('no secrets in the client bundle', 'no EXPO_PUBLIC_ secret-looking keys');
}

const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (serviceKey) {
  const payload = jwtPayload(serviceKey);
  if (payload?.role && payload.role !== 'service_role') {
    warn('service role key', `set, but its role claim is "${payload.role}"`, undefined);
  } else {
    pass('service role key', 'set (server-side only — never in the app)');
  }
}

// -------------------------------------------------------------- supabase url --

const url = env.EXPO_PUBLIC_SUPABASE_URL;
let projectRef = null;

if (!url) {
  fail('EXPO_PUBLIC_SUPABASE_URL', 'missing', 'Supabase dashboard → Project Settings → Data API');
} else if (/127\.0\.0\.1|localhost/.test(url)) {
  warn(
    'EXPO_PUBLIC_SUPABASE_URL',
    'still points at localhost (the .env.example default)',
    'Replace with your project URL: https://<ref>.supabase.co',
  );
} else {
  const match = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
  if (match) {
    projectRef = match[1];
    pass('EXPO_PUBLIC_SUPABASE_URL', 'valid project URL');
  } else {
    fail(
      'EXPO_PUBLIC_SUPABASE_URL',
      'does not look like https://<ref>.supabase.co',
      'Copy it exactly from Project Settings → Data API → Project URL (no trailing path)',
    );
  }
}

// -------------------------------------------------------------- anon key --

const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!anonKey) {
  fail(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'missing',
    'Supabase dashboard → Project Settings → API keys → anon / public',
  );
} else {
  const payload = jwtPayload(anonKey);
  if (!payload) {
    // Newer projects issue sb_publishable_... keys instead of a JWT.
    if (anonKey.startsWith('sb_publishable_')) {
      pass('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'publishable key format');
    } else {
      fail(
        'EXPO_PUBLIC_SUPABASE_ANON_KEY',
        'is neither a JWT nor a publishable key',
        'Make sure you copied the whole value — they are long and easy to truncate',
      );
    }
  } else if (payload.role === 'service_role') {
    fail(
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'this is the SERVICE ROLE key, not the anon key',
      'The service role key bypasses all row level security. Never put it in the app. ' +
        'Rotate it in the dashboard now, then use the anon key here.',
    );
  } else if (payload.role !== 'anon') {
    warn('EXPO_PUBLIC_SUPABASE_ANON_KEY', `unexpected role claim "${payload.role}"`, undefined);
  } else if (projectRef && payload.ref && payload.ref !== projectRef) {
    fail(
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'belongs to a different project than the URL',
      'The URL and the key must come from the same Supabase project',
    );
  } else if (payload.exp && payload.exp * 1000 < Date.now()) {
    fail('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'expired', 'Generate a new anon key in the dashboard');
  } else {
    pass('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'valid anon key for this project');
  }
}

// -------------------------------------------------------- google sign-in --
// Google is configured inside the Supabase dashboard, not here — the app uses
// Supabase's OAuth endpoint rather than talking to Google directly. So there is
// nothing to validate locally; the only thing worth flagging is a leftover
// client ID, which means someone followed older instructions.

const staleGoogleKeys = Object.keys(env).filter((k) => /^EXPO_PUBLIC_GOOGLE_.*CLIENT_ID$/.test(k));
if (staleGoogleKeys.length) {
  warn(
    'Google client IDs in .env',
    `${staleGoogleKeys.length} set but unused`,
    'Google is configured in the Supabase dashboard now (Authentication -> Providers -> Google). Safe to delete these lines.',
  );
}

// ---------------------------------------------------- reachability + schema --

async function checkRemote() {
  if (!url || !anonKey || /127\.0\.0\.1|localhost/.test(url)) return;

  let spec;
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(12_000),
    });

    if (response.status === 401 || response.status === 403) {
      fail(
        'Supabase reachable',
        `rejected the anon key (HTTP ${response.status})`,
        'The URL and key are probably from different projects',
      );
      return;
    }
    if (!response.ok) {
      fail('Supabase reachable', `HTTP ${response.status}`, 'Check the project is not paused');
      return;
    }

    pass('Supabase reachable', 'API responded');
    spec = await response.json();
  } catch (err) {
    fail(
      'Supabase reachable',
      err instanceof Error ? err.message : String(err),
      'Check the URL, and that you are online',
    );
    return;
  }

  // The OpenAPI spec lists every table PostgREST exposes, which tells us whether
  // the migrations have actually been applied to this project.
  const exposed = new Set(Object.keys(spec?.definitions ?? spec?.components?.schemas ?? {}));
  const expected = [
    'profiles',
    'groups',
    'group_members',
    'messages',
    'job_posts',
    'shares',
    'job_status',
    'group_overview',
    'feed_items',
  ];
  const missing = expected.filter((t) => !exposed.has(t));

  if (exposed.size === 0) {
    warn(
      'schema applied',
      'could not read the API spec',
      'Verify manually in the dashboard that the tables exist',
    );
  } else if (missing.length === expected.length) {
    fail(
      'schema applied',
      'none of the expected tables exist',
      'Apply the migrations: pnpm db:bundle > schema.sql, then paste into the Supabase SQL editor',
    );
  } else if (missing.length) {
    fail(
      'schema applied',
      `missing: ${missing.join(', ')}`,
      'Some migrations have not been applied. Re-run the bundle from the missing one onward.',
    );
  } else {
    pass('schema applied', `${expected.length} expected tables and views present`);
  }

  // Is Google actually enabled on the project? The settings endpoint is public
  // and says which providers are on, which is the thing people forget.
  try {
    const settings = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(12_000),
    });
    if (settings.ok) {
      const body = await settings.json();
      if (body?.external?.google) {
        pass('Google sign-in enabled', 'the project accepts Google');
      } else {
        fail(
          'Google sign-in enabled',
          'Google is not turned on for this project',
          'Supabase dashboard -> Authentication -> Providers -> Google: enable it and paste the web client ID + secret',
        );
      }
    }
  } catch {
    warn('Google sign-in enabled', 'could not read auth settings', undefined);
  }

  // ingest_jobs must NOT be reachable: RLS-enabled with no policies is how the
  // worker queue stays server-only.
  if (exposed.has('ingest_jobs')) {
    const probe = await fetch(`${url.replace(/\/$/, '')}/rest/v1/ingest_jobs?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);

    if (probe?.ok) {
      const rows = await probe.json().catch(() => null);
      if (Array.isArray(rows) && rows.length > 0) {
        fail(
          'ingest_jobs is server-only',
          'anonymous clients can read the worker queue',
          'Check that 0008_ingest.sql ran and RLS is enabled on ingest_jobs',
        );
      } else {
        pass('ingest_jobs is server-only', 'no rows readable anonymously');
      }
    } else {
      pass('ingest_jobs is server-only', 'anonymous access refused');
    }
  }
}

// --------------------------------------------------------------- ingest env --

const dbUrl = env.DATABASE_URL;
if (!dbUrl) {
  warn(
    'DATABASE_URL',
    'not set',
    'Only needed by services/ingest. Without the worker, shared links stay bare (no title/company).',
  );
} else if (/127\.0\.0\.1|localhost/.test(dbUrl)) {
  pass('DATABASE_URL', 'local harness (fine for development)');
} else if (dbUrl.includes('supabase.')) {
  pass('DATABASE_URL', 'points at Supabase (worker can run)');
} else {
  warn('DATABASE_URL', 'set, but not recognisably local or Supabase', undefined);
}

// ------------------------------------------------------------------ report --

await checkRemote();

const icon = { pass: '  ok  ', warn: ' warn ', fail: ' FAIL ' };
console.log('\nJobDrop configuration check\n');

for (const r of results) {
  console.log(`[${icon[r.status]}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  if (r.fix && r.status !== 'pass') console.log(`           ↳ ${r.fix}`);
}

const failed = results.filter((r) => r.status === 'fail').length;
const warned = results.filter((r) => r.status === 'warn').length;

console.log(
  `\n${results.length - failed - warned} ok, ${warned} warning(s), ${failed} failure(s).`,
);

if (failed) {
  console.log('\nFix the failures above, then run `pnpm doctor` again.');
  console.log('This output contains no secrets — it is safe to share if you need help.\n');
  process.exit(1);
}

console.log(
  warned
    ? '\nNo blocking problems. Warnings are things that will bite later.\n'
    : '\nEverything checks out.\n',
);
