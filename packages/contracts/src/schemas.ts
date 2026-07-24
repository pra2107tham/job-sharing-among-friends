/**
 * Validation shared by every client.
 *
 * These mirror CHECK constraints in the migrations. When one changes, change
 * both — the database is the authority, this is the fast feedback for the user.
 */

import { z } from 'zod';

/** Mirrors profiles.handle_format in 0002_profiles.sql. */
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, 'Use 3-20 letters, numbers or underscores');

export const displayNameSchema = z.string().trim().min(1).max(60);

export const groupNameSchema = z.string().trim().min(1).max(60);

/** 6 random bytes rendered as hex by the DB default. */
export const joinCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-f0-9]{12}$/, 'That does not look like a valid invite code');

export const messageBodySchema = z.string().trim().min(1).max(4000);

export const profileUpdateSchema = z.object({
  handle: handleSchema,
  display_name: displayNameSchema,
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/**
 * A share as it leaves the device.
 *
 * `client_share_id` is generated before the network is touched (doc 1 §4.3) so
 * that a retry, a double-tap, or a queued offline send collapses server-side
 * instead of duplicating.
 */
export const sharePayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('link'),
    url: z.string().url(),
    note: z.string().trim().max(500).optional(),
    client_share_id: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('text'),
    text: z.string().trim().min(1).max(20000),
    note: z.string().trim().max(500).optional(),
    client_share_id: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('image'),
    /** Local URI before upload; the server receives a storage path. */
    uri: z.string().min(1),
    note: z.string().trim().max(500).optional(),
    client_share_id: z.string().uuid(),
  }),
]);

export type SharePayload = z.infer<typeof sharePayloadSchema>;
