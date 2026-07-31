# Doc 6 — First run on macOS

Getting JobDrop onto a real iPhone and a real Android device, from a clean clone.

Read [doc 4](04-setup.md) for what each key is and why. This is the ordered runbook.

**Set expectations first:** the Kotlin and Swift in this repo have never been compiled
(doc 5). The TypeScript, the database and the config plugin are all verified, but the first
native build is expected to surface small errors. [§7](#7-expect-to-fix) lists the ones
most likely to hit you and the one-line fix for each.

---

## 1. Keys — where to get them, what goes where

Only **two values** ever go in `.env`. Everything else lives in a dashboard.

| What                            | Where you get it                                                    | Where it goes                        |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| Project URL                     | Supabase → Project Settings → Data API                              | `.env`                               |
| anon / public key               | Supabase → Project Settings → API keys                              | `.env`                               |
| Google client ID **and** secret | Google Cloud → APIs & Services → Credentials                        | **Supabase dashboard**, never `.env` |
| Database URL                    | Supabase → Settings → Database → Connection string → session pooler | worker's environment only            |

### 1a. Supabase project

1. supabase.com → **New project**. Region `ap-south-1` if your friends are in India.
2. Save the database password — it is shown once and you need it in §5.
3. **Project Settings → Data API** → copy the **Project URL**.
4. **Project Settings → API keys** → copy the **anon / public** key.
   Not `service_role`. `pnpm doctor` fails hard if you paste that one by mistake.

### 1b. Google sign-in — one OAuth client, configured in Supabase

The app never talks to Google directly, so no Google credential ships in the bundle.

1. Google Cloud Console → **OAuth consent screen** → External. Add your own email under
   _Test users_. A friends-only app never needs Google's verification review.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   Under _Authorised redirect URIs_ add exactly:
   ```
   https://<your-ref>.supabase.co/auth/v1/callback
   ```
3. Copy the client ID and client secret.
4. **Supabase → Authentication → Providers → Google** → enable, paste both, save.

### 1c. Redirect allow list

**Supabase → Authentication → URL Configuration → Redirect URLs.** Add all three:

```
jobdrop://auth-callback
exp://127.0.0.1:8081/--/auth-callback
http://localhost:8081
```

The first is the installed app, the second is the dev server (your LAN IP may differ — the
terminal prints the exact `exp://` URL), the third is web.

### 1d. The `.env`

```bash
cp .env.example .env
```

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

---

## 2. Clone and install

```bash
git clone https://github.com/pra2107tham/job-sharing-among-friends.git
cd job-sharing-among-friends
git checkout claude/job-sharing-app-emg6ye

corepack enable            # gives you the pinned pnpm
pnpm install
```

Prerequisites, all via Homebrew except the two App Store items:

```bash
brew install node watchman cocoapods
brew install --cask android-studio temurin@17
xcode-select --install
```

- **Xcode** from the App Store, then open it once to accept the licence.
- **Android Studio** → SDK Manager → install _Android SDK Platform 36_ and
  _Android SDK Build-Tools_. Then add to `~/.zshrc`:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
```

Check the config before building anything:

```bash
pnpm doctor
```

It reads `.env`, validates it, pings your project and confirms the schema is applied. It
prints no secrets, so its output is safe to paste anywhere if you get stuck.

---

## 3. Apply the schema

```bash
pnpm db:bundle > schema.sql
```

Supabase dashboard → **SQL Editor** → paste → **Run**. It is one transaction; either all 16
migrations apply or none do.

```bash
pnpm doctor      # now confirms the tables and views exist
```

---

## 4. Sanity check on web first

Do this before touching native. It proves your keys, schema and auth all work, and takes
two minutes:

```bash
cd apps/mobile
pnpm web
```

Sign in with Google, pick a handle, create a group, paste a job link into the composer.
The card appears immediately as a bare link. If that works, everything server-side is
correct and any native failure is purely native.

---

## 5. Run the enrichment worker

Without it, cards stay bare and **dedupe does not happen** — two people sharing the same
link get two cards. Keep it running in a second terminal while testing:

```bash
cd services/ingest
DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' pnpm start
```

Watch the card in the app change from a bare URL to a role and company within a few
seconds. That is the whole pipeline working.

---

## 6. Native builds

Native code means Expo Go no longer applies. Generate the native projects once:

```bash
cd apps/mobile
npx expo prebuild --clean
```

`android/` and `ios/` are generated and gitignored — never hand-edit them, edit
`plugins/withJobDropShare.js` and re-run prebuild.

### Android

```bash
npx expo run:android            # emulator or USB device with debugging on
```

Then in the app: **You → Quick sharing → Open settings**, grant _Display over other apps_,
come back, **Turn on bubble**.

What to test, in order of how likely it is to work:

1. **Share sheet** — open Chrome, long-press a job link, Share → JobDrop. Most reliable path.
2. **Drag onto the bubble** — long-press a link and drag it onto the floating circle. This
   is the gesture the product was designed around.
3. **Tap the bubble** — sends your clipboard. Android may refuse the clipboard read; if it
   does, the app opens instead, which is the intended fallback, not a bug.
4. **Drag the bubble to the bottom** — hides it for four hours.
5. **Airplane mode, then share** — it should still say sent, and deliver when you reconnect.

### iOS

```bash
npx expo run:ios                # simulator
```

**Start in the Simulator, not on your phone.** Two capabilities this app uses — App Groups
and Sign in with Apple — require a **paid** Apple Developer account ($99/yr) to provision
on a physical device. The Simulator does not enforce that, so you can test the whole Share
Extension for free there.

If you want it on your actual iPhone with a free Apple ID, remove Sign in with Apple first
(you are using Google anyway):

```jsonc
// apps/mobile/app.json → expo.ios
"usesAppleSignIn": true   // ← delete this line, then re-run prebuild
```

App Groups still will not provision on a free account, which means the extension cannot
hand shares to the app. The in-app composer still works.

#### The one manual step

The config plugin writes every extension file and both entitlements, but it does not create
the Xcode _target_. Once, in Xcode:

1. `open ios/JobDrop.xcworkspace`
2. **File → New → Target → Share Extension**. Name it `JobDropShareExtension`.
   Decline the "activate scheme" prompt.
3. Xcode generates its own stub files — **delete them**, then drag in the four already
   sitting in `ios/JobDropShareExtension/`: `ShareViewController.swift`,
   `ShareStore.swift`, `ShareUploader.swift`, `Info.plist`. Tick the extension target only.
4. Select the extension target → **Signing & Capabilities** → **+ Capability** →
   **App Groups** → tick `group.app.jobdrop.client`. Do the same on the main app target.
5. Build and run.

This survives `expo prebuild --clean` only if you commit `ios/`, which the repo
deliberately does not. If you end up re-running prebuild often, swap the plugin for
`expo-share-extension`, which creates the target automatically.

Then test: Safari → any job posting → **Share → JobDrop**. The sheet should say _Sent to
your groups_ almost immediately, with Undo, and dismiss itself.

---

## 7. Expect to fix

In rough order of likelihood. None of these are architectural.

**`androidx.security:security-crypto:1.1.0-alpha06` fails to resolve.** That pin could not
be verified from the build environment. In
`apps/mobile/modules/jobdrop-share/android/build.gradle`, try `1.1.0-alpha07`, or fall back
to stable `1.0.0`. If neither resolves, the file to look at is `ShareStore.kt` — it is the
only consumer.

**Kotlin compile errors in `BubbleService.kt`.** Most likely an import or an API-level
guard. The file is heavily commented; the logic is sound even where the syntax may not be.

**`FOREGROUND_SERVICE_TYPE_SPECIAL_USE` rejected.** Android 14+ wants a justification
string, which is in the module's `AndroidManifest.xml`. If Play Console later objects, that
property is where the explanation lives.

**The bubble does not appear after granting permission.** Check the overlay grant actually
took (`Settings → Apps → JobDrop → Display over other apps`), then that the foreground
notification is showing. On MIUI/ColorOS also enable _Autostart_ — those skins kill overlay
services aggressively. The share sheet keeps working regardless, which is why it is the
path that always works.

**Swift build fails on `ShareStore` not found.** The extension target needs its own copy of
the file compiled into it — check step 3 above ticked the extension target, not the app.

**Google sign-in returns "no session".** Almost always a missing redirect URL. Compare what
the terminal prints with what is in Supabase's allow list, exactly.

**Metro cannot resolve a module.** Add it to `apps/mobile/package.json` at the version in
`node_modules/expo/bundledNativeModules.json`. Do not switch pnpm linkers — `.npmrc`
explains why hoisting breaks this layout.

---

## 8. When you report back

Most useful to me:

- `pnpm doctor` output (safe — no secrets in it)
- the actual build error, from the first failure, not the last
- which of the five Android tests in §6 passed

Never paste a key. If one leaks anywhere, rotate it in the Supabase dashboard — rotating
the anon key costs nothing.
