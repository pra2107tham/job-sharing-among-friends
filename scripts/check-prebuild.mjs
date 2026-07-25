#!/usr/bin/env node
/**
 * Asserts that the native capture surfaces survive `expo prebuild`.
 *
 * The Kotlin and Swift in modules/jobdrop-share cannot be compiled here — that
 * needs an Android SDK and a Mac. But the config plugin that wires them into
 * the native projects is plain JavaScript, and prebuild runs anywhere. So the
 * one thing that is both checkable and easy to silently break — does the
 * generated manifest actually contain the permissions, the service and the
 * share-sheet filter — gets checked on every CI run.
 *
 * Without this, a plugin regression would only surface on a real device build,
 * which is exactly where feedback is slowest.
 *
 *   pnpm check:prebuild
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(repoRoot, 'apps', 'mobile');

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, detail });

console.log('Running expo prebuild (this regenerates android/ and ios/)…\n');

rmSync(join(appDir, 'android'), { recursive: true, force: true });
rmSync(join(appDir, 'ios'), { recursive: true, force: true });

try {
  execFileSync('npx', ['expo', 'prebuild', '--no-install', '--clean'], {
    cwd: appDir,
    stdio: 'pipe',
    timeout: 15 * 60 * 1000,
  });
} catch (err) {
  console.error('prebuild failed:\n', err.stdout?.toString() ?? err.message);
  process.exit(1);
}

// --------------------------------------------------------------- Android --

const manifestPath = join(appDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';

check('AndroidManifest generated', manifest.length > 0);

for (const permission of [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
]) {
  check(`permission ${permission.split('.').pop()}`, manifest.includes(permission));
}

check(
  'share sheet intent filter',
  manifest.includes('android.intent.action.SEND'),
  'JobDrop must appear in the Android share menu — this is the capture path that always works',
);
check('share filter accepts text', manifest.includes('android:mimeType="text/plain"'));
check('deep link scheme', manifest.includes('android:scheme="jobdrop"'));

// ------------------------------------------------------------------- iOS --

const iosRoot = join(appDir, 'ios');
const extensionDir = join(iosRoot, 'JobDropShareExtension');

for (const file of [
  'ShareViewController.swift',
  'ShareStore.swift',
  'ShareUploader.swift',
  'Info.plist',
  'JobDropShareExtension.entitlements',
]) {
  check(`extension file ${file}`, existsSync(join(extensionDir, file)));
}

const extensionPlist = existsSync(join(extensionDir, 'Info.plist'))
  ? readFileSync(join(extensionDir, 'Info.plist'), 'utf8')
  : '';

check('extension is a share extension', extensionPlist.includes('com.apple.share-services'));
check(
  'extension accepts web URLs',
  extensionPlist.includes('NSExtensionActivationSupportsWebURLWithMaxCount'),
);

// The App Group is the only channel between the extension process and the app.
// Without it the extension can capture a share and then has nowhere to put it.
const appEntitlements = ['JobDrop', 'jobdrop']
  .map((name) => join(iosRoot, name, `${name}.entitlements`))
  .find((p) => existsSync(p));

const entitlements = appEntitlements ? readFileSync(appEntitlements, 'utf8') : '';
check(
  'app has the shared App Group',
  entitlements.includes('group.app.jobdrop.client'),
  'The extension and the app cannot share a queue without it',
);

const extEntitlements = existsSync(join(extensionDir, 'JobDropShareExtension.entitlements'))
  ? readFileSync(join(extensionDir, 'JobDropShareExtension.entitlements'), 'utf8')
  : '';
check('extension has the same App Group', extEntitlements.includes('group.app.jobdrop.client'));

// ---------------------------------------------------------------- report --

console.log();
let failed = 0;
for (const c of checks) {
  console.log(`[${c.ok ? '  ok  ' : ' FAIL '}] ${c.name}`);
  if (!c.ok) {
    failed += 1;
    if (c.detail) console.log(`           ↳ ${c.detail}`);
  }
}

// android/ and ios/ are generated and gitignored; leaving them behind makes
// later `git status` noisy and can confuse Metro.
rmSync(join(appDir, 'android'), { recursive: true, force: true });
rmSync(join(appDir, 'ios'), { recursive: true, force: true });

console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);

if (failed) {
  console.log('\nThe config plugin is not wiring up the native capture surfaces correctly.');
  process.exit(1);
}
