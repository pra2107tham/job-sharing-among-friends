import { buildShareInput } from '@jobdrop/api-client';
import * as Crypto from 'expo-crypto';
import { enqueueShare } from './outbox';

/**
 * The one function every capture surface will call.
 *
 * At M2 that is the in-app composer. At M3 the Android bubble and the iOS Share
 * Extension call the same path, which is why this takes a raw string and works
 * out the rest itself rather than making the caller classify the payload.
 */

const sha256 = (input: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);

export type QueuedShare = { clientShareId: string; kind: 'link' | 'text' };

/**
 * Returns as soon as the share is durably queued — deliberately not when it is
 * delivered. Doc 1 §4.3 budgets 300ms to "Sent" and the network is not in that
 * budget.
 */
export async function queueShare(raw: string, note?: string | null): Promise<QueuedShare> {
  const clientShareId = Crypto.randomUUID();
  const input = await buildShareInput(raw, sha256, { clientShareId, note: note ?? null });
  await enqueueShare(input);
  return { clientShareId, kind: input.sourceType === 'image' ? 'text' : input.sourceType };
}
