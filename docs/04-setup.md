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

| Value                            | Secret? | Why                                                                                                        |
| -------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`       | No      | Public address of your project                                                                             |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`  | No      | Ships inside the app bundle. Anyone with the app has it. **Row level security** is what protects your data |
| `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` | No      | Also in the bundle by design                                                                               |
| Google OAuth **client secret**   | **Yes** | Not needed by this app at all — mobile and web use PKCE. If you were given one, don't use it               |
| `SUPABASE_SERVICE_ROLE_KEY`      | **Yes** | Bypasses every RLS policy. Only ever on the ingest worker's host                                           |
| `DATABASE_URL` (hosted)          | **Yes** | Contains the database password                                                                             |

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

Fill in:

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

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

You need **three** OAuth clients because Google treats each platform separately.

Google Cloud Console → **APIs & Services → Credentials**:

1. Configure the **OAuth consent screen** first (External, add your own email as a test
   user). You do not need verification for a friends-only app.
2. **Create credentials → OAuth client ID** three times:

| Type            | What it asks for        | Value                                              |
| --------------- | ----------------------- | -------------------------------------------------- |
| Web application | Authorised redirect URI | `https://<your-ref>.supabase.co/auth/v1/callback`  |
| iOS             | Bundle ID               | `app.jobdrop.client` (from `apps/mobile/app.json`) |
| Android         | Package name + SHA-1    | `app.jobdrop.client`, SHA-1 from `eas credentials` |

3. Put the three client IDs in `.env` as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
   `..._IOS_CLIENT_ID`, `..._ANDROID_CLIENT_ID`.
4. In Supabase → **Authentication → Providers → Google**: enable it, and paste the **web**
   client ID and its client secret **there** (that secret stays in Supabase, never in
   `.env`).

Apple sign-in is only needed when you submit to the App Store; skip it until then.

```bash
pnpm doctor      # confirms all three client IDs have the right shape
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

Set the same `EXPO_PUBLIC_*` values as **EAS environment variables** so cloud builds get
them — `.env` is not uploaded.

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
