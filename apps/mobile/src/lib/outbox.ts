import AsyncStorage from '@react-native-async-storage/async-storage';
import { shareJob, type ShareInput } from '@jobdrop/api-client';
import { supabase } from './supabase';

/**
 * The durable share queue (doc 1 §4.3).
 *
 * The rule the whole product rests on: the user must never wait on the network
 * to share. A share is written here first and confirmed to the user
 * immediately; delivery happens after, and survives the app being killed, the
 * phone being offline, and the request failing halfway.
 *
 * AsyncStorage rather than SecureStore: this is not secret, it can exceed 2KB,
 * and it must be readable at cold start before any auth work has happened.
 *
 * Idempotency is what makes retrying safe — every entry carries a
 * clientShareId, and share_job (0014_share_rpc.sql) collapses replays.
 */

const KEY = 'jobdrop.outbox.v1';
const MAX_ATTEMPTS = 8;

export type OutboxEntry = ShareInput & {
  queuedAt: string;
  attempts: number;
  lastError?: string;
};

type Listener = (entries: OutboxEntry[]) => void;

let listeners: Listener[] = [];
let flushing = false;

async function read(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    // A corrupt queue must not brick sharing forever. Losing a queued share is
    // bad; refusing every future share is worse.
    return [];
  }
}

async function write(entries: OutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(entries));
  for (const listener of listeners) listener(entries);
}

export function subscribeToOutbox(listener: Listener): () => void {
  listeners.push(listener);
  void read().then(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Queue a share and kick a flush. Resolves as soon as it is durable. */
export async function enqueueShare(input: ShareInput): Promise<void> {
  const entries = await read();
  entries.push({ ...input, queuedAt: new Date().toISOString(), attempts: 0 });
  await write(entries);
  void flushOutbox();
}

export type FlushResult = { sent: number; failed: number; remaining: number };

/**
 * Attempt delivery of everything queued, oldest first.
 *
 * Stops at the first failure rather than grinding through the whole queue:
 * failures here are almost always "no network", and the ordering of shares is
 * worth preserving.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0, remaining: (await read()).length };
  flushing = true;

  let sent = 0;
  let failed = 0;

  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return { sent: 0, failed: 0, remaining: (await read()).length };

    for (;;) {
      const entries = await read();
      const entry = entries[0];
      if (!entry) break;

      try {
        await shareJob(supabase, entry);
        await write(entries.slice(1));
        sent += 1;
      } catch (err) {
        const attempts = entry.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);

        if (attempts >= MAX_ATTEMPTS) {
          // Give up rather than blocking every later share behind a poison
          // entry. The user sees the count drop; the share is genuinely lost.
          await write(entries.slice(1));
          failed += 1;
          continue;
        }

        await write([{ ...entry, attempts, lastError: message }, ...entries.slice(1)]);
        failed += 1;
        break;
      }
    }
  } finally {
    flushing = false;
  }

  return { sent, failed, remaining: (await read()).length };
}

export async function outboxCount(): Promise<number> {
  return (await read()).length;
}

/** Test/debug affordance; not wired to any UI. */
export async function clearOutbox(): Promise<void> {
  await write([]);
}
