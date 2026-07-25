# Doc 4 — Setup: getting JobDrop running for real

Everything here is done in your own accounts, on your own machine. **None of these
values should be sent to anyone — not pasted into a chat, not committed to git.**

You do not need to prove to anybody that you did it right. Run:

```bash
pnpm doctor
```

It reads your config where it lives, checks it, and tells you what is wrong. It never
prints a secret, so its output is safe to share when you want help.

---

## What is actually secret

Worth being precise, because most of this is not:

| Value                           | Secret?              | Why                                                                                                        |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | No                   | Public address of your project                                                                             |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | No                   | Ships inside the app bundle. Anyone with the app has it. **Row level security** is what protects your data |
| Google OAuth client ID + secret | **Yes** (the secret) | Both go into the **Supabase dashboard**, never into this repo. The app never sees either one               |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Yes**              | Bypasses every RLS policy. Only ever on the ingest worker's host                                           |
| `DATABASE_URL` (hosted)         | **Yes**              | Contains the database password                                                                             |

The one mistake that actually hurts is putting a service role key anywhere with an
`EXPO_PUBLIC_` prefix — that compiles it into the app and hands every user full read/write
on every table. `pnpm doctor` fails loudly on this specific case.

---

## 1. Create the Supabase project

1. supabase.com → **New project**. Pick the region closest to your friends
   (`ap-south-1` for India). Free tier is fine at this size.
2. Save the database password somewhere safe — you need it in step 4 and it is not
   shown again.
3. **Project Settings → Data API** → copy the **Project URL**.
4. **Project Settings → API keys** → copy the **anon / public** key.
   Do **not** copy the `service_role` key here.

```bash
cp .env.example .env
```

Fill in the only two values the app needs:

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

That is the whole client configuration. Google credentials go in the Supabase
dashboard (step 3), not here.

## 2. Apply the schema

The migrations in `supabase/migrations/` are the whole database — tables, row level
security, the share RPC and the views. Two ways to apply them:

**Without installing anything** (fine for the first time):

```bash
pnpm db:bundle > schema.sql
```

Open the Supabase dashboard → **SQL Editor** → paste the file → **Run**. Read it first if
you like; it is ordinary SQL with comments explaining each decision.

**With the CLI** (better once you are applying migrations regularly, because it tracks
which ones have run):

```bash
npx supabase link --project-ref <your-ref>
npx supabase db push
```

Verify either way:

```bash
pnpm doctor      # checks the expected tables and views now exist
```

## 3. Google sign-in

The app does not talk to Google directly — it uses Supabase's OAuth endpoint. So
you need **one** OAuth client, and it is configured in the Supabase dashboard
rather than in this repo. Nothing goes in `.env`.

**Google Cloud Console → APIs & Services:**

1. **OAuth consent screen** — External. Add your own email under _Test users_. A
   friends-only app never needs Google's verification review.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   Under _Authorised redirect URIs_ add exactly:

   ```
   https://<your-ref>.supabase.co/auth/v1/callback
   ```

3. Copy the **client ID** and **client secret**.

**Supabase dashboard → Authentication → Providers → Google:**

4. Enable it, paste the client ID and secret, save.

**Supabase dashboard → Authentication → URL Configuration → Redirect URLs**, add:

```
jobdrop://auth-callback
exp://127.0.0.1:8081/--/auth-callback
http://localhost:8081
```

The first is the installed app, the second is Expo Go during development (your
LAN IP may differ — the terminal prints the exact `exp://` URL when you run
`pnpm start`), the third is the web build.

Apple sign-in needs a paid Apple Developer account and only matters when you
submit to the App Store. Skip it — the button hides itself off iOS.

```bash
pnpm doctor      # confirms Google is actually enabled on your project
```

## 4. The ingest worker

Without it everything still works — shared links just stay bare, with no role, company or
HR email filled in. Run it anywhere that can reach the database.

Supabase dashboard → **Project Settings → Database → Connection string → URI**. Use the
**session pooler** URI, and substitute your database password.

```bash
cd services/ingest
DATABASE_URL='postgresql://...' pnpm start
```

For anything long-lived, deploy it to Fly.io, Railway or a small VPS with `DATABASE_URL`
set as a secret in that platform's config. It is a single Node process with no inbound
ports.

## 5. Run the app

```bash
pnpm install
pnpm doctor              # everything green before you start
cd apps/mobile
pnpm start               # then press w for web, or scan the QR with Expo Go
```

Native builds (needed for a real device, and for M3's share extension and bubble) go
through EAS, which compiles iOS in the cloud so you do not need a Mac:

```bash
npx eas build --profile development --platform android
```

Set the same two `EXPO_PUBLIC_*` values as **EAS environment variables** so cloud builds
get them — `.env` is not uploaded.

Expo Go works for everything in M0-M2. A development build is only needed at M3, when the
Android bubble and the iOS Share Extension add native code.

---

## When something breaks

Run `pnpm doctor` first; it catches most misconfigurations by itself. If you need help,
share:

- the `pnpm doctor` output (safe — contains no secrets)
- the actual error message from the app or the worker
- what you were doing when it happened

Never share the key itself. If a key has been exposed anywhere — a screenshot, a chat, a
commit — rotate it in the Supabase dashboard. Rotating the anon key is harmless; rotating
the service role key means updating the worker's environment.
