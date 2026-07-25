# Doc 5 — Native capture surfaces (M3)

The gesture the product exists for: get a job from wherever you found it to all your
groups, without opening JobDrop. Doc 1 §4 is the design; this is what was built, what is
verified, and what is not.

---

## What is verified, and what is not

Be clear-eyed about this before you build a device.

| Layer                                           | Status                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Config plugin → native project wiring           | **Verified.** `pnpm check:prebuild` asserts 17 things about the generated manifest, entitlements and extension plist, and runs in CI |
| TypeScript bridge, credential sync, queue drain | **Verified.** Typechecks, lints, and bundles for iOS, Android and web                                                                |
| Server-side dedupe of hashless native shares    | **Verified.** Integration tests against the real schema                                                                              |
| **Kotlin (bubble, queue, uploader)**            | **Not compiled.** No Android SDK in the build environment                                                                            |
| **Swift (Share Extension, App Group storage)**  | **Not compiled.** Needs macOS                                                                                                        |

So: the plumbing is proven, the native code is written but has never run. Expect to spend
a session with a real device fixing small things — a missing import, a layout constant, a
permission timing issue. Nothing in the architecture should need to change.

The one piece deliberately left manual is noted under [Known gaps](#known-gaps).

## Android — the bubble

`modules/jobdrop-share/android/`. A foreground service holding `SYSTEM_ALERT_WINDOW` that
inflates a 48dp circle through `WindowManager`.

**Plain Android views, not React in the overlay.** It has to appear instantly, work when
the app process is dead, and send without a JS runtime — doc 1 §4.3 budgets 300ms for the
whole gesture and a React context costs more than that by itself.

Three ways in, in descending order of reliability:

1. **Drag a link onto it.** Cross-app drag and drop delivers a real `ClipData` and has no
   platform caveats. This is the gesture the product was designed around.
2. **Tap to send the clipboard.** Best-effort. Since Android 10 an app may only read the
   clipboard while it holds focus, so the bubble briefly makes its window focusable to
   try. OEM builds vary; when it comes back empty the app opens instead of failing
   silently.
3. **The share sheet.** `ACTION_SEND` reaches the main activity and lands in the same
   queue. This one always works, which is why it is not optional — OEM skins (MIUI,
   ColorOS, Funtouch) aggressively kill overlay services, so the bubble is a bonus on top
   of the share sheet, never a dependency.

Dragging the bubble to the bottom hides it for four hours. A bubble the user cannot get
rid of gets the app uninstalled.

**The queue lives in `EncryptedSharedPreferences`**, not plain prefs, because it sits
beside a Supabase access token — the bubble needs one to POST while the app is dead.
Delivery is a `WorkManager` job, so it survives process death, reboots and being offline.

## iOS — the Share Extension

`plugins/share-extension/ShareViewController.swift`.

**There is no bubble on iOS and there never will be.** No app may draw over other apps.
This is not a limitation to engineer around; it is the platform. Doc 1 §4.1 says so and
the capture screen tells the user so directly rather than leaving them hunting for a
switch.

The closest iOS gets is Share → JobDrop, so the extension is built to make those two taps
feel like one: **it has already sent by the time the sheet is visible.** The only control
is Undo. There is no "post" button, because a post button would make it three taps.

The extension is a separate process, so it talks to the app through an **App Group**
(`group.app.jobdrop.client`) holding the same queue and credentials. If the upload does
not finish before the sheet dismisses, the entry stays queued and the app drains it on
next launch. The share is never lost.

## Why neither platform canonicalises URLs

Doc 1 §8 makes URL canonicalisation the thing dedupe depends on — the same LinkedIn job
arrives in five different shapes. Reimplementing those rules in TypeScript, Kotlin **and**
Swift would guarantee they drift, and drift here means duplicate cards, which is the exact
failure dedupe exists to prevent.

So native surfaces send `raw_input` with **no hash at all**, and the ingest worker settles
identity: it canonicalises, hashes, and folds the job into an existing one if that hash is
taken (`merge_job_posts`, `0016_merge_job_posts.sql`). The JS composer still hashes
client-side as a fast path, and the worker corrects it if it disagrees.

That also means the worker is now load-bearing for dedupe, not just enrichment. Without it
running, two people sharing the same link get two cards.

## Idempotency across three queues

A share can exist in the native queue, the JS outbox, and in flight, simultaneously. Every
entry carries a `clientShareId` generated at capture time, and `share_job` is idempotent on
`(sharer_id, client_share_id)` — so a replay collapses server-side instead of
double-posting. `drainNativeShares()` deliberately carries the native id over rather than
minting a new one, which is what makes "the bubble sent it but failed to dequeue it" safe.

## Known gaps

- **The Xcode extension target is not created automatically.** The plugin writes every
  file into `ios/JobDropShareExtension/` and configures both entitlements, but adding a
  _target_ to the `.pbxproj` needs project manipulation the plugin does not do yet. Either
  add the target once in Xcode, or adopt `expo-share-extension`, which exists to do
  exactly this. Everything else is in place.
- **Image shares** are accepted by the Android intent filter but not yet parsed — OCR is
  M4. They will queue and enrich as `partial`.
- **The bubble's long-press panel** (choose specific groups) is v1.1. Long-press currently
  opens the composer.
- **Apple sign-in in the extension** is not needed — the extension reuses the app's token
  and never authenticates on its own.

## Building it

Native code means Expo Go is no longer enough:

```bash
cd apps/mobile
npx expo prebuild --clean          # regenerate android/ and ios/
npx eas build --profile development --platform android
```

EAS compiles iOS in the cloud, so no Mac is needed for the build itself — only for adding
that one Xcode target.

After any change to `plugins/withJobDropShare.js`:

```bash
pnpm check:prebuild                # 17 assertions on the generated projects
```
